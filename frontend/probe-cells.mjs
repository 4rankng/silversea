// Verify the actual CUS cell behavior for each column — proper selector [data-cell-label=...]
import { chromium } from '@playwright/test';

const BASE = process.env.QA_BASE_URL;
const USERNAME = process.env.QA_USER;
const PASSWORD = process.env.QA_PASS;
if (!BASE || !USERNAME || !PASSWORD) {
  throw new Error('Set QA_BASE_URL, QA_USER, and QA_PASS before running this probe.');
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'vi-VN' });
const page = await ctx.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(`PAGEERROR: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`CONSOLE.ERR: ${m.text()}`); });

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('#username-input', USERNAME);
await page.fill('#password-input', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

const labels = ['Khách hàng & nhà máy', 'Chứng từ', 'Phân loại & hãng tàu', 'Tổng quan hàng hóa', 'Lịch trình & điều xe', 'Ghi chú'];
for (const label of labels) {
  const cell = page.locator(`[data-cell-label="${label}"]`).first();
  if (!(await cell.count())) {
    console.log(`[${label}] NO CELL FOUND`);
    continue;
  }
  const disabled = await cell.getAttribute('disabled');
  if (disabled !== null) {
    console.log(`[${label}] CELL DISABLED — skipping (probably read-only)`);
    continue;
  }
  await cell.click();
  await page.waitForTimeout(900);
  const dialogCount = await page.locator('[role="dialog"]').count();
  const dialogText = dialogCount > 0
    ? (await page.locator('[role="dialog"]').first().textContent() || '').slice(0, 60)
    : '';
  console.log(`[${label}] dialogs=${dialogCount} title="${dialogText.replace(/\s+/g, ' ').trim()}"`);
  if (dialogCount > 0) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
}

console.log('errors:', errors);
await browser.close();
