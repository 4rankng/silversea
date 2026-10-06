// Card 20261006_391 — LOCAL UI rung (AC2): both customer CSV exports on
// /customers — the strip "Xuất Excel" (all filtered rows) and the bulk-bar
// "Xuất CSV đã chọn" (after keyboard-selecting a row) — report success via
// toast. Both exports are client-side file builds (lib/csv, no API call),
// read-only: the customers-table identity is captured unchanged around the
// driver by the invoking shell.
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { status: health.status, buildHash: health.buildHash, note: 'dev = live source, not a deployed cut' });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login admin failed: ${login.status}`);
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
log('login', { user: 'admin', role: 'ADMIN (local demo)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  await page.setRequestInterception(true);
  page.on('request', (req) => { void req.continue(); });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/customers`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for the table to carry rows, then find the strip export button.
  await page.waitForSelector('tr.customers-row', { timeout: 30000 });
  const findButtonByText = async (text) => {
    for (const b of await page.$$('button')) {
      const t = await b.evaluate((el) => (el.textContent || '').trim());
      if (t.includes(text)) return b;
    }
    return null;
  };

  const stripBtn = await findButtonByText('Xuất Excel');
  if (!stripBtn) throw new Error('strip export button not found');
  await stripBtn.click();
  await page.waitForFunction(
    () => (document.querySelector('.toast--success')?.textContent || '').includes('Đã xuất danh sách khách hàng'),
    { timeout: 15000 },
  );
  const toast1 = await page.evaluate(() => (document.querySelector('.toast--success')?.textContent || '').trim());
  log('strip-toast-assert', { toastText: toast1, matchesExpected: toast1.includes('Đã xuất danh sách khách hàng') });
  await page.screenshot({ path: `${QA}/2026-10-06_card20261006391_ui-customers-strip-toast.png` });
  log('screenshot-strip', { path: 'qa/2026-10-06_card20261006391_ui-customers-strip-toast.png' });

  // Select the first row (trusted click on a non-interactive cell → the row
  // selection contract, card 20260929_207), then export the selection.
  const taxCell = await page.$('tr.customers-row .customers-mono-cell');
  if (!taxCell) throw new Error('customer row cell not found');
  await taxCell.click();
  await page.waitForSelector('.customers-bulkbar', { timeout: 15000 });
  const selectedCount = await page.$eval('.customers-bulkbar strong', (el) => el.textContent || '');
  log('row-selected', { bulkbarCount: selectedCount });

  const selBtn = await findButtonByText('Xuất CSV đã chọn');
  if (!selBtn) throw new Error('bulk-bar export button not found');
  await selBtn.click();
  await page.waitForFunction(
    () => (document.querySelector('.toast--success')?.textContent || '').includes('Đã xuất khách hàng đã chọn'),
    { timeout: 15000 },
  );
  const toast2 = await page.evaluate(() => [...document.querySelectorAll('.toast--success')].map((t) => (t.textContent || '').trim()).pop());
  log('selected-toast-assert', { toastText: toast2, matchesExpected: toast2.includes('Đã xuất khách hàng đã chọn') });
  await page.screenshot({ path: `${QA}/2026-10-06_card20261006391_ui-customers-selected-toast.png` });
  log('screenshot-selected', { path: 'qa/2026-10-06_card20261006391_ui-customers-selected-toast.png' });

  log('api-identity', {
    note: 'both exports build the file client-side (lib/csv) — no export API call exists; customers table captured unchanged by the invoking shell',
  });
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
writeFileSync(`${QA}/2026-10-06_card20261006391_ui-customers-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
console.log('DRIVER OK');
