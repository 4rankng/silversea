import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for Silver Sea Staging QA
 * Tests against https://vantai.tingting.vip
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run sequentially for staging consistency
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid staging conflicts
  reporter: [
    ['html', { outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'playwright-results.json' }],
    ['list']
  ],
  use: {
    baseURL: 'https://vantai.tingting.vip',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Staging credentials
  globalSetup: './e2e/global-setup.ts',
});
