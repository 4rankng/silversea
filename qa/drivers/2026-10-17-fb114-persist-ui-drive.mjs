// FB-114 verify-fail (ticket 171026185348) — rung 3 evidence for the
// server-side catalog persistence. LOCAL ONLY: vite 7175 -> api 3002
// (dev-port-contract). Drives the REAL control:
//   1. open /shipments/new (FCL), click the Pencil "Đặt tên hãng tàu cho lô này"
//   2. type a brand-new name, click "Áp dụng"
//   3. assert the dialog closed and the lot field holds the trimmed name
//   4. RELOAD the page and reopen the Hãng tàu dropdown — the name must be
//      listed from the SHARED catalog (the acceptance of 171026185348)
//   5. print the /api/config/catalogs/bootstrap shippingLines entry as the
//      API/DB identity proof (the psql row capture runs beside this log)
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb114-persist';
const NAME = process.env.LINE_NAME ?? `QA UI Persist ${Date.now()}`;
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as admin'); process.exit(1); }
console.log(`LOGIN OK (admin) · name under test: "${NAME}"`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`));

const steps = [];
const check = (label, ok, detail = '') => {
  steps.push({ label, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
};

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[aria-label="Đặt tên hãng tàu cho lô này"]', { timeout: 30000 });
  await sleep(1500);

  // 1–2. open the dialog, type the new name, apply.
  await page.click('[aria-label="Đặt tên hãng tàu cho lô này"]');
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await page.type('[role="dialog"] input', NAME, { delay: 12 });
  await sleep(300);
  await page.screenshot({ path: `${SHOTS}/ui-01-dialog-typed.png` });
  const applyBtn = await page.$('[role="dialog"] button.csc-shipping-line-dialog__submit');
  await applyBtn.click();

  // 3. dialog closed + lot field holds the trimmed name.
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 20000 });
  const fieldValue = await page.$eval('[data-field-id="shipment-shipping-line"] input', (el) => el.value);
  check('dialog closed after Áp dụng', true);
  check('lot field holds the typed name', fieldValue === NAME, `field="${fieldValue}"`);
  await page.screenshot({ path: `${SHOTS}/ui-02-applied.png` });

  // 4. RELOAD — the dropdown must now list the name from the shared catalog.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-field-id="shipment-shipping-line"] input', { timeout: 30000 });
  await sleep(1500);
  await page.click('[data-field-id="shipment-shipping-line"] input');
  await sleep(800);
  const optionFound = await page.evaluate((name) => Array.from(document.querySelectorAll('[role="option"]'))
    .some((o) => (o.textContent || '').trim().includes(name)), NAME);
  check('after reload the dropdown lists the new name', optionFound);
  await page.screenshot({ path: `${SHOTS}/ui-03-after-reload-dropdown.png` });

  // 5. API identity of the shared catalog entry (same source the dropdown reads).
  const boot = await (await fetch(`${API}/catalogs/bootstrap`, {
    headers: { Authorization: `Bearer ${L.token}` },
  })).json();
  const entry = (boot.shippingLines ?? []).find((line) => line.name === NAME);
  check('bootstrap shippingLines carries the name', Boolean(entry), JSON.stringify(entry ?? null));
  const sup = await (await fetch(`${API}/suppliers?search=${encodeURIComponent(NAME)}&limit=5`, {
    headers: { Authorization: `Bearer ${L.token}` },
  })).json();
  const row = (sup.items ?? []).find((item) => item.name === NAME);
  check('supplier row exists (SHIPPING_LINE catalog source)', Boolean(row), JSON.stringify(row ? { id: row.id, name: row.name, status: row.status, types: row.types, primaryType: row.primaryType } : null));
} catch (err) {
  check('driver completed without exception', false, (err && err.message) || String(err));
  await page.screenshot({ path: `${SHOTS}/ui-error.png` }).catch(() => {});
}

await browser.close();
const failed = steps.filter((s) => !s.ok);
console.log(`\nDRIVER SUMMARY: ${steps.length - failed.length}/${steps.length} checks passed · exit ${failed.length ? 1 : 0}`);
process.exit(failed.length ? 1 : 0);
