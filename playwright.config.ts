import { defineConfig, devices } from '@playwright/test';
import { API_PORT, BASE_URL, E2E_TODAY, WEB_PORT } from './tests/e2e/constants';

/*
 * E2E runs against the production build (`pnpm test:e2e` builds first).
 * Dedicated ports keep it independent of a local `pnpm dev` session.
 */
const baseURL = BASE_URL;

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
      command: 'pnpm --filter @velasia/retailing-api start',
      url: `http://127.0.0.1:${API_PORT}/health`,
      env: {
        RETAILING_API_PORT: String(API_PORT),
        RETAILING_API_HOST: '127.0.0.1',
        LOG_LEVEL: 'warn',
        AERONOVA_TODAY: E2E_TODAY,
        // Test-only: lets specs simulate failures with the `aeronova-fault` cookie.
        RETAILING_API_FAULTS: 'enabled',
        RETAILING_API_FAULT_TIMEOUT_MS: '10000',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @velasia/web exec next start --port ${WEB_PORT} --hostname 127.0.0.1`,
      url: baseURL,
      env: {
        RETAILING_API_URL: `http://127.0.0.1:${API_PORT}`,
        AERONOVA_TODAY: E2E_TODAY,
        RETAILING_API_FORWARD_FAULTS: 'enabled',
        RETAILING_API_TIMEOUT_MS: '2500',
      },
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
