#!/usr/bin/env node
/**
 * Milestone 7 — Node.js production-mode baseline for Velasia Airways.
 *
 *   node benchmarks/node-baseline/run-baseline.mjs [--label NAME] [--vus 20] [--duration 60s]
 *     [--scenarios a,b,c] [--soak 30m] [--soak-vus 30]
 *
 * Starts the production builds exactly as the images run them (bundled API with `node`, the
 * Next.js standalone server) on a fresh TalaDB file with synthetic fixtures, pins each process
 * to its own CPUs with `taskset` (API 0-1, web 2-3, k6 4-5), and for each scenario runs a cold
 * pass then a measured warm pass while sampling both services' /metrics every 2 s. Afterwards it
 * stops both services gracefully and checks the database end to end (`db-tool verify`): a result
 * only counts if no order invariant, allocation, or payment record is broken.
 *
 * Results (raw k6 summaries, metric samples, summary.json, summary.md) go to
 * benchmarks/node-baseline/results/<label>/. Requires `pnpm build` and k6 (K6 env var or PATH).
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { cpus, freemem, homedir, release, totalmem } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const { values } = parseArgs({
  options: {
    label: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    vus: { type: 'string', default: '20' },
    duration: { type: 'string', default: '60s' },
    warmup: { type: 'string', default: '15s' },
    scenarios: { type: 'string' },
    soak: { type: 'string' },
    'soak-vus': { type: 'string', default: '30' },
    /** Also run the burst-and-recovery profile (k6/burst.js) after the scenarios. */
    burst: { type: 'boolean', default: false },
    /** Where the TalaDB file lives: a disk directory (default) or a tmpfs such as /tmp. */
    'db-dir': { type: 'string', default: join(homedir(), '.cache') },
  },
});
const SCENARIOS = values.scenarios?.split(',') ?? [
  'home',
  'destination',
  'cached',
  'flight-search',
  'route-handler',
  'offers',
  'comparison',
  'shopping-session',
  'server-action',
  'checkout',
  'payment',
  'manage-booking',
  'my-trips',
  'mixed',
];
const K6 = process.env.K6 ?? join(homedir(), '.cache/velasia-m7/k6/k6');
const API_PORT = 4400;
const WEB_PORT = 3400;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const TODAY = '2026-12-01';
const out = join(here, 'results', values.label);
mkdirSync(join(out, 'k6'), { recursive: true });
const work = mkdtempSync(join(values['db-dir'], 'velasia-bench-'));
const dbPath = join(work, 'velasia.db');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function start(name, cpuList, args, env, cwd) {
  const child = spawn('taskset', ['-c', cpuList, process.execPath, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => (log += chunk));
  child.stderr.on('data', (chunk) => (log += chunk));
  child.exited = new Promise((resolve) =>
    child.once('exit', (code, signal) => resolve({ code, signal })),
  );
  child.log = () => log;
  child.label = name;
  return child;
}

async function waitFor(url, child, timeoutMs = 60_000) {
  const started = performance.now();
  for (;;) {
    if (child.exitCode !== null) throw new Error(`${child.label} exited:\n${child.log()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return performance.now() - started;
    } catch {
      // not listening yet
    }
    if (performance.now() - started > timeoutMs) throw new Error(`${child.label} not ready`);
    await sleep(25);
  }
}

const gauge = (text, pattern) => {
  const match = pattern.exec(text);
  return match ? Number(match[1]) : null;
};
async function sample(scenario) {
  const [api, web] = await Promise.all([
    fetch(`${API}/metrics`).then((r) => r.text()),
    fetch(`${WEB}/api/internal/metrics`).then((r) => r.text()),
  ]);
  const cpu = (text, service) =>
    (gauge(
      text,
      new RegExp(`process_cpu_seconds_total\\{service="${service}",mode="user"\\} ([\\d.e+-]+)`),
    ) ?? 0) +
    (gauge(
      text,
      new RegExp(`process_cpu_seconds_total\\{service="${service}",mode="system"\\} ([\\d.e+-]+)`),
    ) ?? 0);
  return {
    t: Date.now(),
    scenario,
    apiRssMb:
      gauge(api, /process_resident_memory_bytes\{service="retailing-api"\} (\d+)/) / 2 ** 20,
    apiHeapMb:
      gauge(api, /nodejs_heap_bytes\{service="retailing-api",kind="used"\} (\d+)/) / 2 ** 20,
    apiCpuS: cpu(api, 'retailing-api'),
    apiLoopP99Ms:
      (gauge(
        api,
        /nodejs_eventloop_delay_seconds\{service="retailing-api",quantile="0.99"\} ([\d.e+-]+)/,
      ) ?? 0) * 1000,
    apiQueueDepth: gauge(api, /velasia_writer_queue_depth (\d+)/),
    dbBytes: gauge(api, /velasia_taladb_file_bytes (\d+)/),
    sessionsInMemory: gauge(api, /velasia_memory_store_entries\{store="sessions"\} (\d+)/),
    webRssMb: gauge(web, /process_resident_memory_bytes\{service="web"\} (\d+)/) / 2 ** 20,
    webHeapMb: gauge(web, /nodejs_heap_bytes\{service="web",kind="used"\} (\d+)/) / 2 ** 20,
    webCpuS: cpu(web, 'web'),
    webLoopP99Ms:
      (gauge(web, /nodejs_eventloop_delay_seconds\{service="web",quantile="0.99"\} ([\d.e+-]+)/) ??
        0) * 1000,
  };
}

function k6(scenario, { vus, duration, file, script = 'scenarios.js' }) {
  const args = [
    '-c',
    '4,5',
    K6,
    'run',
    '--quiet',
    '--summary-export',
    file,
    '-e',
    `SCENARIO=${scenario}`,
    '-e',
    `WEB=${WEB}`,
    '-e',
    `API=${API}`,
    '-e',
    `FIXTURES=${join(work, 'fixtures.json')}`,
    '-e',
    `ACTION=${join(work, 'action.json')}`,
    '-e',
    `VUS=${vus}`,
    '-e',
    `DURATION=${duration}`,
    join(here, 'k6', script),
  ];
  return new Promise((resolve) => {
    const child = spawn('taskset', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (c) => (log += c));
    child.stderr.on('data', (c) => (log += c));
    child.once('exit', (code) => resolve({ code, log }));
  });
}

async function measured(scenario, vus, duration, kind) {
  const samples = [];
  const before = await sample(scenario);
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await sleep(2_000);
      if (sampling) samples.push(await sample(scenario));
    }
  })();
  const file = join(out, 'k6', `${scenario}${kind === 'cold' ? '.cold' : ''}.json`);
  const run = await k6(scenario, { vus, duration, file });
  sampling = false;
  await sampler;
  const after = await sample(scenario);
  const summary = JSON.parse(readFileSync(file, 'utf8'));
  const m = summary.metrics;
  const duration_ = m.iteration_duration;
  const reqs = m.http_reqs?.count ?? 0;
  const elapsedS = (after.t - before.t) / 1000;
  const apiCpu = after.apiCpuS - before.apiCpuS;
  const webCpu = after.webCpuS - before.webCpuS;
  const max = (key) => Math.max(...[before, ...samples, after].map((s) => s[key] ?? 0));
  return {
    scenario,
    kind,
    vus,
    k6Exit: run.code,
    requests: reqs,
    rps: reqs / elapsedS,
    iterations: m.iterations?.count ?? 0,
    httpP50Ms: m.http_req_duration?.med,
    httpP95Ms: m.http_req_duration?.['p(95)'],
    httpP99Ms: m.http_req_duration?.['p(99)'],
    iterationP50Ms: duration_?.med,
    failedRate: m.http_req_failed?.value ?? m.http_req_failed?.rate ?? 0,
    correctRate: m.velasia_correct?.value ?? m.velasia_correct?.rate ?? null,
    inventoryConflicts: m.velasia_inventory_conflicts?.count ?? 0,
    apiCpuS: apiCpu,
    webCpuS: webCpu,
    rpsPerCpu: reqs / Math.max(apiCpu + webCpu, 0.001),
    apiCpuUtil: apiCpu / elapsedS,
    webCpuUtil: webCpu / elapsedS,
    apiRssMaxMb: max('apiRssMb'),
    webRssMaxMb: max('webRssMb'),
    apiHeapMaxMb: max('apiHeapMb'),
    webHeapMaxMb: max('webHeapMb'),
    apiLoopP99MaxMs: max('apiLoopP99Ms'),
    webLoopP99MaxMs: max('webLoopP99Ms'),
    apiQueueDepthMax: max('apiQueueDepth'),
    steps: Object.fromEntries(
      Object.entries(m)
        .filter(([name]) => name.startsWith('velasia_step_'))
        .map(([name, v]) => [
          name.replace('velasia_step_', '').replace('_ms', ''),
          { p50: v.med, p95: v['p(95)'], p99: v['p(99)'], count: v.count },
        ]),
    ),
    samples,
    k6Log: run.code === 0 ? undefined : run.log.slice(-2000),
  };
}

// ---------------------------------------------------------------------------------------------
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const environment = {
  date: new Date().toISOString(),
  commit: git('rev-parse', 'HEAD'),
  dirty: git('status', '--porcelain').length > 0,
  node: process.version,
  next: JSON.parse(readFileSync(join(root, 'apps/web/node_modules/next/package.json'), 'utf8'))
    .version,
  k6: execFileSync(K6, ['version'], { encoding: 'utf8' }).trim(),
  kernel: release(),
  cpu: cpus()[0].model,
  logicalCpus: cpus().length,
  memoryGb: Math.round(totalmem() / 2 ** 30),
  freeMemoryGbAtStart: Math.round((freemem() / 2 ** 30) * 10) / 10,
  pinning: { api: 'cpus 0-1', web: 'cpus 2-3', k6: 'cpus 4-5' },
  config: {
    today: TODAY,
    paymentProviderDelayMs: 0,
    durability: 'flush_every_write',
    vus: Number(values.vus),
    duration: values.duration,
    warmup: values.warmup,
  },
  taladbStart: 'fresh file, then fixtures (see fixtures)',
  taladbDir: values['db-dir'],
  taladbFilesystem: execFileSync('stat', ['-f', '-c', '%T', values['db-dir']], {
    encoding: 'utf8',
  }).trim(),
};

const apiEnv = {
  NODE_ENV: 'production',
  TALADB_PATH: dbPath,
  RETAILING_API_HOST: '127.0.0.1',
  RETAILING_API_PORT: String(API_PORT),
  VELASIA_TODAY: TODAY,
  ACCOUNT_REGISTRATION: 'enabled',
  PAYMENT_PROVIDER_DELAY_MS: '0',
  LOG_LEVEL: 'warn',
};
const webEnv = {
  NODE_ENV: 'production',
  PORT: String(WEB_PORT),
  HOSTNAME: '127.0.0.1',
  RETAILING_API_URL: API,
  SITE_URL: WEB,
  VELASIA_TODAY: TODAY,
};

console.log(`[bench] results → ${out}`);
const api = start('api', '0,1', ['dist/server.mjs'], apiEnv, join(root, 'apps/retailing-api'));
const apiStartupMs = await waitFor(`${API}/health/ready`, api);
const web = start(
  'web',
  '2,3',
  ['apps/web/server.js'],
  webEnv,
  join(root, 'apps/web/.next/standalone'),
);
const webStartupMs = await waitFor(`${WEB}/api/internal/health/ready`, web);
console.log(
  `[bench] startup: api ${apiStartupMs.toFixed(0)} ms, web ${webStartupMs.toFixed(0)} ms`,
);

execFileSync(
  process.execPath,
  [join(here, 'lib/seed.mjs'), API, join(work, 'fixtures.json'), '40', '10'],
  { stdio: 'inherit' },
);
execFileSync(
  process.execPath,
  [join(here, 'lib/capture-action.mjs'), WEB, join(work, 'action.json')],
  { stdio: 'inherit', cwd: root },
);
const fixtures = JSON.parse(readFileSync(join(work, 'fixtures.json'), 'utf8'));
const fixtureSummary = {
  itineraries: fixtures.itineraries.length,
  bookings: fixtures.bookings.length,
  accounts: fixtures.accounts.length,
  linkedBookings: fixtures.accounts.reduce((sum, a) => sum + a.orders, 0),
  dbBytesAfterSeed: statSync(dbPath).size,
};

const results = [];
for (const scenario of SCENARIOS) {
  console.log(
    `[bench] ${scenario}: cold ${values.warmup}, then ${values.duration} × ${values.vus} VUs`,
  );
  results.push(await measured(scenario, Number(values.vus), values.warmup, 'cold'));
  const warm = await measured(scenario, Number(values.vus), values.duration, 'warm');
  results.push(warm);
  console.log(
    `[bench]   ${warm.rps.toFixed(1)} req/s, p50 ${warm.httpP50Ms?.toFixed(1)} ms, p95 ${warm.httpP95Ms?.toFixed(1)} ms, p99 ${warm.httpP99Ms?.toFixed(1)} ms, correct ${((warm.correctRate ?? 0) * 100).toFixed(2)}%`,
  );
}
let soak = null;
if (values.soak) {
  console.log(`[bench] soak: mixed, ${values.soak} × ${values['soak-vus']} VUs`);
  soak = await measured('mixed', Number(values['soak-vus']), values.soak, 'soak');
  console.log(`[bench]   soak ${soak.rps.toFixed(1)} req/s, p99 ${soak.httpP99Ms?.toFixed(1)} ms`);
}

let burst = null;
if (values.burst) {
  console.log('[bench] burst: 60 s × 10 VUs, 60 s × 80 VUs, 60 s × 10 VUs (mixed)');
  const file = join(out, 'k6', 'burst.json');
  const samples = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      await sleep(2_000);
      if (sampling) samples.push(await sample('burst'));
    }
  })();
  const run = await k6('mixed', { vus: 10, duration: '60s', file, script: 'burst.js' });
  sampling = false;
  await sampler;
  const m = JSON.parse(readFileSync(file, 'utf8')).metrics;
  const phase = (name) => {
    const d = m[`http_req_duration{scenario:${name}}`] ?? {};
    return {
      requests: m[`http_reqs{scenario:${name}}`]?.count ?? 0,
      rps: (m[`http_reqs{scenario:${name}}`]?.count ?? 0) / 60,
      p50Ms: d.med,
      p95Ms: d['p(95)'],
      p99Ms: d['p(99)'],
      correctRate:
        m[`velasia_correct{scenario:${name}}`]?.value ??
        m[`velasia_correct{scenario:${name}}`]?.rate ??
        null,
    };
  };
  burst = {
    k6Exit: run.code,
    calm: phase('calm'),
    burst: phase('burst'),
    recovery: phase('recovery'),
    apiQueueDepthMax: Math.max(0, ...samples.map((s) => s.apiQueueDepth ?? 0)),
    apiRssMaxMb: Math.max(0, ...samples.map((s) => s.apiRssMb ?? 0)),
    webRssMaxMb: Math.max(0, ...samples.map((s) => s.webRssMb ?? 0)),
    webLoopP99MaxMs: Math.max(0, ...samples.map((s) => s.webLoopP99Ms ?? 0)),
    samples,
  };
  for (const name of ['calm', 'burst', 'recovery']) {
    const p = burst[name];
    console.log(
      `[bench]   ${name}: ${p.rps.toFixed(1)} req/s, p95 ${p.p95Ms?.toFixed(1)} ms, p99 ${p.p99Ms?.toFixed(1)} ms`,
    );
  }
}

// Graceful stop, then the end-to-end integrity check of what the load wrote.
web.kill('SIGTERM');
api.kill('SIGTERM');
const [webExit, apiExit] = await Promise.all([web.exited, api.exited]);
const dbBytesAtEnd = statSync(dbPath).size;
let integrity;
try {
  integrity = JSON.parse(
    execFileSync(process.execPath, ['dist/db-tool.mjs', 'verify', '--db', dbPath], {
      cwd: join(root, 'apps/retailing-api'),
      encoding: 'utf8',
    }),
  );
} catch (error) {
  integrity = { ok: false, error: String(error.stdout ?? error.message).slice(0, 4000) };
}

const report = {
  environment,
  startup: { apiReadyMs: apiStartupMs, webReadyMs: webStartupMs },
  fixtures: fixtureSummary,
  results: results.map(({ samples, ...rest }) => rest),
  soak: soak ? (({ samples, ...rest }) => rest)(soak) : null,
  burst: burst ? (({ samples, ...rest }) => rest)(burst) : null,
  shutdown: { web: webExit, api: apiExit },
  dbBytesAtEnd,
  integrity,
};
writeFileSync(join(out, 'summary.json'), `${JSON.stringify(report, null, 2)}\n`);
writeFileSync(
  join(out, 'samples.json'),
  `${JSON.stringify([...results, ...(soak ? [soak] : []), ...(burst ? [{ scenario: 'mixed', kind: 'burst', samples: burst.samples }] : [])].map(({ scenario, kind, samples }) => ({ scenario, kind, samples })))}\n`,
);
writeFileSync(join(out, 'api.log'), api.log());
writeFileSync(join(out, 'web.log'), web.log());

const f = (n, d = 1) => (n === null || n === undefined || Number.isNaN(n) ? '–' : n.toFixed(d));
const rows = [...results.filter((r) => r.kind === 'warm'), ...(soak ? [soak] : [])].map(
  (r) =>
    `| ${r.scenario}${r.kind === 'soak' ? ' (soak)' : ''} | ${r.vus} | ${f(r.rps)} | ${f(r.rpsPerCpu)} | ${f(r.httpP50Ms)} | ${f(r.httpP95Ms)} | ${f(r.httpP99Ms)} | ${f(r.failedRate * 100, 2)}% | ${f((r.correctRate ?? 0) * 100, 2)}% | ${r.inventoryConflicts} | ${f(r.apiCpuUtil, 2)} / ${f(r.webCpuUtil, 2)} | ${f(r.apiRssMaxMb, 0)} / ${f(r.webRssMaxMb, 0)} | ${f(r.apiLoopP99MaxMs)} / ${f(r.webLoopP99MaxMs)} |`,
);
writeFileSync(
  join(out, 'summary.md'),
  [
    `# Node.js baseline — ${values.label}`,
    '',
    `Commit \`${environment.commit}\`${environment.dirty ? ' (working tree had uncommitted changes)' : ''}; Node ${environment.node}; Next.js ${environment.next}; ${environment.k6}.`,
    `${environment.cpu}, ${environment.logicalCpus} CPUs, ${environment.memoryGb} GB; API on CPUs 0-1, web on 2-3, k6 on 4-5. TalaDB on ${environment.taladbFilesystem}.`,
    `Startup to ready: API ${f(apiStartupMs, 0)} ms, web ${f(webStartupMs, 0)} ms. Integrity after the run: **${integrity.ok ? 'OK' : 'FAILED'}**${integrity.violations ? ` (${integrity.violations.length} violations)` : ''}.`,
    '',
    '| Scenario | VUs | req/s | req/CPU-s | p50 ms | p95 ms | p99 ms | HTTP failed | Correct | Inventory conflicts | CPU (api / web, cores) | RSS max MB (api / web) | Loop p99 max ms (api / web) |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n'),
);
rmSync(work, { recursive: true, force: true });
console.log(`[bench] done; integrity ${integrity.ok ? 'OK' : 'FAILED'}`);
process.exit(integrity.ok ? 0 : 1);
