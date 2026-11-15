import { defineConfig, devices } from '@playwright/test';

/*
 * Milestone 7: the end-to-end journey against the Docker deployment (through the proxy), not
 * against local servers. Start the stack first:
 *
 *   COMPOSE_FILE=compose.yaml:compose.e2e.yaml pnpm docker:up
 *   pnpm test:docker
 */
const port = process.env.VELASIA_HTTP_PORT ?? '8080';
// The shared E2E helpers build URLs from this (tests/e2e/constants.ts).
process.env.E2E_WEB_PORT ??= port;

export default defineConfig({
  testDir: './tests/docker',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  timeout: 300_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report-docker' }]]
    : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    timezoneId: 'Asia/Manila',
    locale: 'en-PH',
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      grepInvert: /@mobile/,
    },
    { name: 'mobile', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
});
