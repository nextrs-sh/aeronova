import { defineConfig, devices } from '@playwright/test';

/*
 * E2E runs against the production build (`pnpm test:e2e` builds first).
 * Dedicated ports keep it independent of a local `pnpm dev` session.
 */
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 3200);
const API_PORT = Number(process.env.E2E_API_PORT ?? 4210);
const baseURL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
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
      command: 'pnpm --filter @aeronova/retailing-api start',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: {
        RETAILING_API_PORT: String(API_PORT),
        RETAILING_API_HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @aeronova/web exec next start --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: baseURL,
      env: { RETAILING_API_URL: `http://127.0.0.1:${API_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
