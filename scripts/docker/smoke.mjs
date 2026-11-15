#!/usr/bin/env node
/**
 * Milestone 7: smoke test for the running Docker deployment.   pnpm docker:smoke
 *
 * From outside (through the proxy, like a browser) and from inside (docker compose exec):
 * public pages, live API data through the storefront, image optimisation on a read-only
 * filesystem, security headers, hidden internal endpoints, the API not published, health of all
 * three containers, non-root and read-only containers, and metrics on the internal network.
 * Exits non-zero on the first failure.
 */
import { execFileSync } from 'node:child_process';

const BASE = process.env.VELASIA_BASE_URL ?? 'http://127.0.0.1:8080';
const compose = (...args) =>
  execFileSync('sh', ['scripts/docker/compose.sh', ...args], { encoding: 'utf8' }).trim();
let failures = 0;

async function check(name, run) {
  try {
    await run();
    console.log(`ok    ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
const get = (path, init) =>
  fetch(new URL(path, BASE), { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });

await check('proxy answers its own health check', async () => {
  assert((await get('/__proxy/health')).status === 200, 'expected 200');
});
await check(
  'homepage renders with the fictional-airline disclaimer and security headers',
  async () => {
    const response = await get('/');
    assert(response.status === 200, `status ${response.status}`);
    const html = await response.text();
    assert(html.includes('Velasia'), 'brand missing');
    assert(/fictional airline/.test(html), 'disclaimer missing');
    const csp = response.headers.get('content-security-policy') ?? '';
    assert(csp.includes("frame-ancestors 'none'"), 'CSP missing');
    assert(response.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
    assert(/^[0-9a-f]{32}$/.test(response.headers.get('x-request-id') ?? ''), 'request id missing');
    assert(!response.headers.get('server')?.match(/\d/), 'server version exposed');
  },
);
await check('a prerendered destination page is served', async () => {
  assert((await get('/destinations/singapore')).status === 200, 'expected 200');
});
await check('live flight search reaches the API through the storefront', async () => {
  const response = await get('/api/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1');
  assert(response.status === 200, `status ${response.status}`);
  const body = await response.json();
  assert(Array.isArray(body.data?.legs) && body.data.legs.length > 0, 'no result legs');
  assert(response.headers.get('cache-control') === 'private, no-store', 'live data cacheable');
});
await check('a streamed request-time page renders', async () => {
  const response = await get('/flights?from=MNL&to=SIN&departureDate=2026-12-15&adults=1');
  assert(response.status === 200, `status ${response.status}`);
  assert((await response.text()).includes('</html>'), 'incomplete document');
});
await check('image optimisation works on the read-only filesystem', async () => {
  const response = await get('/_next/image?url=%2Fimages%2Fdestinations%2Fcebu.jpg&w=640&q=70', {
    headers: { accept: 'image/avif,image/webp' },
  });
  assert(response.status === 200, `status ${response.status}`);
  assert(/^image\//.test(response.headers.get('content-type') ?? ''), 'not an image');
});
await check('internal endpoints are hidden publicly', async () => {
  for (const path of ['/api/internal/health/ready', '/api/internal/metrics']) {
    assert((await get(path)).status === 404, `${path} reachable`);
  }
});
await check('no database or secret files are reachable', async () => {
  for (const path of ['/.env', '/.env.production', '/data/velasia.db', '/velasia.db']) {
    assert([400, 404].includes((await get(path)).status), `${path} reachable`);
  }
});
await check('a cross-site Server Action POST is refused', async () => {
  const response = await get('/manage-booking', {
    method: 'POST',
    headers: {
      origin: 'https://evil.example',
      'next-action': '0'.repeat(42),
      'content-type': 'text/plain',
    },
    body: '[]',
  });
  assert(response.status >= 400, `status ${response.status}`);
});
await check('the retailing API publishes no port', async () => {
  let published = '';
  try {
    published = compose('port', 'velasia-api', '4010');
  } catch {
    published = '';
  }
  assert(!/\d+$/.test(published), `published at ${published}`);
});
await check('all three containers are healthy', async () => {
  const lines = compose('ps', '--format', 'json').split('\n').filter(Boolean);
  const services = lines.flatMap((line) => {
    const parsed = JSON.parse(line);
    return Array.isArray(parsed) ? parsed : [parsed];
  });
  for (const name of ['velasia-api', 'velasia-web', 'velasia-proxy']) {
    const service = services.find((s) => s.Service === name);
    assert(service, `${name} not running`);
    assert(service.Health === 'healthy', `${name} is ${service.Health || service.State}`);
  }
});
await check('containers run as non-root on a read-only root filesystem', async () => {
  for (const name of ['velasia-api', 'velasia-web']) {
    assert(compose('exec', '-T', name, 'id', '-u') === '1000', `${name} is not uid 1000`);
    let wrote = true;
    try {
      compose('exec', '-T', name, 'sh', '-c', 'touch /app/x');
    } catch {
      wrote = false;
    }
    assert(!wrote, `${name} root filesystem is writable`);
  }
});
await check('API readiness and metrics answer on the internal network', async () => {
  const script =
    "Promise.all([fetch('http://127.0.0.1:4010/health/ready').then(r=>r.json()),fetch('http://127.0.0.1:4010/metrics').then(r=>r.text())]).then(([h,m])=>{console.log(JSON.stringify({status:h.status,schema:h.schemaVersion,metrics:/velasia_writer_queue_depth/.test(m)}))})";
  const result = JSON.parse(compose('exec', '-T', 'velasia-api', 'node', '-e', script));
  assert(result.status === 'ok' && result.schema >= 3 && result.metrics, JSON.stringify(result));
});
await check('storefront readiness reaches the API by service name', async () => {
  const script =
    "fetch('http://127.0.0.1:3000/api/internal/health/ready').then(r=>r.json()).then(b=>console.log(b.retailingApi))";
  assert(compose('exec', '-T', 'velasia-web', 'node', '-e', script) === 'ready', 'API not ready');
});

if (failures > 0) {
  console.error(`\n${failures} smoke check(s) failed`);
  process.exit(1);
}
console.log('\nsmoke test passed');
