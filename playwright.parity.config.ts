import { defineConfig, devices } from '@playwright/test';

/*
 * Milestone 8: Node.js / NextRS parity suite against two running storefront containers that
 * share one retailing API (compose.dual-runtime.yaml, or two App Platform deployments):
 *
 *   docker compose -f compose.dual-runtime.yaml up --build -d --wait
 *   pnpm test:parity
 *
 * PARITY_NODE_URL / PARITY_NEXTRS_URL   storefront origins (default 127.0.0.1:8081 / :8082)
 * PARITY_TODAY                          the deployment's VELASIA_TODAY (default 2026-12-01)
 * PARITY_ACCOUNTS=enabled               also run the account test (API ACCOUNT_REGISTRATION)
 *
 * Projects: `node` and `nextrs` run tests/parity/runtime.spec.ts against one runtime each;
 * `compare` runs tests/parity/compare.spec.ts against both. One worker: the storefronts share
 * one API, and comparisons must not race the booking journeys.
 */
const nodeURL = process.env.PARITY_NODE_URL ?? 'http://127.0.0.1:8081';
const nextrsURL = process.env.PARITY_NEXTRS_URL ?? 'http://127.0.0.1:8082';
const browser = { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } };

export default defineConfig({
  testDir: './tests/parity',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-parity' }]]
    : [['list'], ['json', { outputFile: 'test-results/parity-results.json' }]],
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Manila',
    locale: 'en-PH',
  },
  projects: [
    { name: 'compare', testMatch: /compare\.spec\.ts/, use: browser },
    { name: 'node', testMatch: /runtime\.spec\.ts/, use: { ...browser, baseURL: nodeURL } },
    { name: 'nextrs', testMatch: /runtime\.spec\.ts/, use: { ...browser, baseURL: nextrsURL } },
  ],
});
