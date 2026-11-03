// SIL-641 AC6 — behavior check (LOCAL ONLY): the identity fields keep their
// aria + click behavior after the search-glyph removal and chip styling.
// 1. type in Khách hàng → dropdown opens, pick option → value committed.
// 2. click '+' chip → customer dialog opens (aria-label Thêm khách hàng).
// 3. click pencil chip → shipping-line dialog opens.
// Read-only: dialogs are opened then dismissed; nothing is submitted.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const FRONT = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-11-03_sil641/after';
fs.mkdirSync(OUT, { recursive: true });
const LOG = `${OUT}/behavior-check.log`;
fs.writeFileSync(LOG, '');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d) => { log(`${ok ? 'PASS' : 'FAIL'} ${n}${d ? ` — ${d}` : ''}`); if (!ok) fails += 1; };

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
}).then((r) => r.json());

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), login.token);
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-customer"]'), { timeout: 30000 });

// 1. The customer combobox still opens its dropdown on focus and commits a pick.
await page.click('[data-field-id="shipment-customer"] input');
await page.waitForFunction(() => Boolean(document.querySelector('[role="option"]')), { timeout: 10000 });
const optionCount = await page.evaluate(() => document.querySelectorAll('[role="option"]').length);
check('typing/focus opens dropdown with options', optionCount > 0, `options=${optionCount}`);
await page.evaluate(() => document.querySelector('[role="option"]').click());
await sleep(400);
const picked = await page.$eval('[data-field-id="shipment-customer"] input', (el) => el.value);
check('pick commits a value into the input', picked.trim().length > 0, `value="${picked.slice(0, 30)}"`);

// 2. The '+' chip still opens the customer quick-add dialog.
await page.evaluate(() => document.querySelector('[data-field-id="shipment-customer"] .csc-append-button')?.click());
await sleep(600);
const custDialog = await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"], .csc-customer-dialog');
  return el ? { title: el.querySelector('h2, h3, [role="heading"]')?.textContent?.trim() ?? el.textContent.slice(0, 60), visible: true } : null;
});
check("'+' opens the customer dialog", Boolean(custDialog), JSON.stringify(custDialog));
await page.screenshot({ path: `${OUT}/sil641-after-plus-dialog.png` });
await page.keyboard.press('Escape');
await sleep(400);

// 3. The pencil chip still opens the shipping-line dialog.
await page.evaluate(() => document.querySelector('[data-field-id="shipment-shipping-line"] .csc-append-button')?.click());
await sleep(600);
const shipDialog = await page.evaluate(() => {
  const el = document.querySelector('[role="dialog"], .csc-shipping-line-dialog');
  return el ? { title: el.querySelector('h2, h3, [role="heading"]')?.textContent?.trim() ?? el.textContent.slice(0, 60), visible: true } : null;
});
check('pencil opens the shipping-line dialog', Boolean(shipDialog), JSON.stringify(shipDialog));
await page.screenshot({ path: `${OUT}/sil641-after-pencil-dialog.png` });
await page.keyboard.press('Escape');
await sleep(300);

// 4. aria labels preserved.
const aria = await page.evaluate(() => ({
  plus: document.querySelector('[data-field-id="shipment-customer"] .csc-append-button')?.getAttribute('aria-label'),
  pencil: document.querySelector('[data-field-id="shipment-shipping-line"] .csc-append-button')?.getAttribute('aria-label'),
}));
check("aria-label '+' giữ nguyên", aria.plus === 'Thêm khách hàng', aria.plus);
check("aria-label pencil giữ nguyên", aria.pencil === 'Đặt tên hãng tàu cho lô này', aria.pencil);

await browser.close();
log(`RESULT ${fails === 0 ? 'GREEN' : 'RED'} failures=${fails}`);
process.exit(fails === 0 ? 0 : 1);
