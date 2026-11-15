import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import { API_PORT, BASE_URL, E2E_TODAY, WEB_PORT } from './tests/e2e/constants';

/*
 * E2E runs against the production build (`pnpm test:e2e` builds first).
 * Dedicated ports keep it independent of a local `pnpm dev` session.
 */
const baseURL = BASE_URL;
/** A fresh orders database per run, outside the repo; never a developer's own. */
const taladbPath =
  process.env.E2E_TALADB_PATH ?? join(tmpdir(), 'velasia-e2e', String(Date.now()), 'velasia.db');

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  // Server Action round trips (API call + redirect render) under parallel load on a laptop
  // occasionally passed 5 s; their median is far lower (see MILESTONE-3-REPORT.md).
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Manila',
    locale: 'en-PH',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'pnpm --filter @velasia/retailing-api start',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: {
        RETAILING_API_PORT: String(API_PORT),
        RETAILING_API_HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        VELASIA_TODAY: E2E_TODAY,
        // Test-only: lets specs simulate failures with the `velasia-fault` cookie.
        RETAILING_API_FAULTS: 'enabled',
        RETAILING_API_FAULT_TIMEOUT_MS: '10000',
        TALADB_PATH: taladbPath,
        // Simulated payments: outcome controls on, quick but realistic provider timings.
        PAYMENT_OUTCOME_CONTROLS: 'enabled',
        PAYMENT_PROVIDER_DELAY_MS: '150',
        PAYMENT_PROVIDER_TIMEOUT_MS: '1500',
        PAYMENT_PENDING_RESOLVE_MS: '1500',
        // The background sweep also settles undecided payments; slow it down so the specs that
        // exercise the traveller's own status check stay deterministic (it is covered by the
        // API's recovery tests).
        ORDER_SWEEP_INTERVAL_MS: '600000',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Milestone 7: the standalone server the production image runs (same Next.js server as
      // `next start`; see apps/web/scripts/copy-standalone-assets.mjs).
      command: 'node apps/web/.next/standalone/apps/web/server.js',
      url: baseURL,
      env: {
        PORT: String(WEB_PORT),
        HOSTNAME: '127.0.0.1',
        SITE_URL: baseURL,
        RETAILING_API_URL: `http://127.0.0.1:${API_PORT}`,
        VELASIA_TODAY: E2E_TODAY,
        RETAILING_API_FORWARD_FAULTS: 'enabled',
        // The standalone server runs with NODE_ENV=production: test-only controls need this.
        VELASIA_ALLOW_TEST_CONTROLS: 'enabled',
        RETAILING_API_TIMEOUT_MS: '2500',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
