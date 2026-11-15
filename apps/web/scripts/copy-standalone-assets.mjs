#!/usr/bin/env node
/* eslint-disable no-console -- a build script: its output is the point. */
/**
 * Milestone 7: complete `.next/standalone` after `next build`.
 *
 * The standalone server serves `public/` and `.next/static/` only if they sit beside it (Next.js
 * leaves copying them to the deployment, so a CDN can take them instead). Copying them here
 * makes `node .next/standalone/apps/web/server.js` — what the production image runs, and what
 * the E2E suite tests — a complete server.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const standalone = join(app, '.next', 'standalone', 'apps', 'web');
if (!existsSync(join(standalone, 'server.js'))) {
  console.error('[standalone] no .next/standalone/apps/web/server.js; is output: standalone set?');
  process.exit(1);
}
for (const [from, to] of [
  [join(app, 'public'), join(standalone, 'public')],
  [join(app, '.next', 'static'), join(standalone, '.next', 'static')],
]) {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}
console.log('[standalone] copied public/ and .next/static/ beside server.js');
