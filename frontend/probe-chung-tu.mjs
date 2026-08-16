// Focused probe: investigate "Chứng từ" cell behavior on /shipments as CUS.
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
await page.fill('input[name="username"], #username-input', USERNAME);
await page.fill('input[name="password"], #password-input', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

console.log('after login url:', page.url());

// inventory cell buttons by data-cell-label
const cellByLabel = await page.$$eval('[data-cell-label]', (els) =>
  els.map((e) => ({
    label: e.getAttribute('data-cell-label'),
    disabled: e.hasAttribute('disabled'),
    text: (e.textContent || '').trim().slice(0, 50),
    id: e.id,
  })),
);
console.log('cell-by-label count:', cellByLabel.length);
const byLabel = {};
cellByLabel.forEach((c) => { byLabel[c.label] = (byLabel[c.label] || 0) + 1; });
console.log('group:', byLabel);

// Try clicking the first "Chứng từ" cell
const docs = page.locator('[data-cell-label="Chứng từ"]').first();
console.log('docs count:', await docs.count(), 'disabled:', await docs.getAttribute('disabled').catch(() => null));

await docs.click();
await page.waitForTimeout(1200);

const dialogs = await page.locator('[role="dialog"]').count();
console.log('dialogs visible after click:', dialogs);

if (dialogs > 0) {
  const txt = await page.locator('[role="dialog"]').first().textContent();
  console.log('dialog text (first 200):', txt?.slice(0, 200));
}

await page.screenshot({ path: '/tmp/probe-chung-tu.png', fullPage: true });

// try the original selector that the script used
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
console.log('--- after escape, try original selector ---');
const origSel = page.locator('button:has-text("Chứng từ"), [role="button"]:has-text("Chứng từ")');
const origCount = await origSel.count();
console.log('orig selector count:', origCount);
if (origCount > 0) {
  const first = origSel.first();
  const ariaLabel = await first.getAttribute('aria-label').catch(() => null);
  const text = (await first.textContent().catch(() => '')) || '';
  console.log('first match — aria-label:', ariaLabel, 'text:', text.slice(0, 50));
  await first.click();
  await page.waitForTimeout(1200);
  const d2 = await page.locator('[role="dialog"]').count();
  console.log('after orig click, dialogs:', d2);
  if (d2 > 0) {
    const t = await page.locator('[role="dialog"]').first().textContent();
    console.log('dialog text (first 200):', t?.slice(0, 200));
  }
}

console.log('errors:', errors);
await browser.close();
