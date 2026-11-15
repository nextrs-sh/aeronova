#!/usr/bin/env node
/**
 * Run a command (normally `next build`) with the retailing API reachable.
 *
 * Destination pages are prerendered from the API at build time. If
 * RETAILING_API_URL already answers /health, it is used as-is. Otherwise, when
 * it points at this machine, a local API instance is started for the duration
 * of the command and stopped afterwards.
 */
import { spawn } from 'node:child_process';

const apiUrl = process.env.RETAILING_API_URL ?? 'http://127.0.0.1:4010';
const [command, ...args] = process.argv.slice(2);
if (!command) {
  console.error('usage: with-retailing-api.mjs <command> [...args]');
  process.exit(2);
}

async function isHealthy() {
  try {
    const response = await fetch(new URL('/health', apiUrl), { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

let api;
if (!(await isHealthy())) {
  const { hostname, port } = new URL(apiUrl);
  if (!['127.0.0.1', 'localhost'].includes(hostname)) {
    console.error(`Retailing API at ${apiUrl} is unreachable; start it or fix RETAILING_API_URL.`);
    process.exit(1);
  }
  console.warn(`[with-retailing-api] starting a local retailing API on ${apiUrl}`);
  api = spawn('pnpm', ['--filter', '@velasia/retailing-api', 'start'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      RETAILING_API_HOST: hostname,
      RETAILING_API_PORT: port || '80',
      LOG_LEVEL: 'warn',
    },
  });
  const deadline = Date.now() + 30_000;
  while (!(await isHealthy())) {
    if (Date.now() > deadline || api.exitCode !== null) {
      console.error('[with-retailing-api] the retailing API did not become healthy.');
      api.kill('SIGTERM');
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const child = spawn(command, args, {
  stdio: 'inherit',
  env: { ...process.env, RETAILING_API_URL: apiUrl },
});
const stopApi = () => api?.kill('SIGTERM');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    child.kill(signal);
    stopApi();
  });
}
child.on('exit', (code, signal) => {
  stopApi();
  process.exit(code ?? (signal ? 1 : 0));
});
