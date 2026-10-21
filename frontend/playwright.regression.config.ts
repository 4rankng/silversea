/**
 * Playwright config — REGRESSION PACK (12 spec, local stack only).
 *
 * Chạy: `pnpm reg:local` (từ repo root) hoặc `pnpm --dir frontend reg:local`.
 * Stack: frontend :7175 · api :3002 (`make dev`). KHÔNG trỏ config này vào
 * staging — staging data immutable theo user rule 21/10.
 *
 * Evidence screenshot ghi vào qa/<date>-regpack/ ở repo root (helper shot()).
 */
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendRoot = path.resolve(here, '..');

export default defineConfig({
  testDir: './e2e/regression',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 4,
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  outputDir: path.join(frontendRoot, 'test-results', 'regression'),
  use: {
    baseURL: process.env.REG_BASE_URL ?? 'http://localhost:7175',
    screenshot: 'off',
    trace: 'retain-on-failure',
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
