// Card 20261006_391 — LOCAL UI rung (AC1): the FuelCard "Xuất Excel" button
// on /trips/32869 (fixture: fuel supplier Petrolimex + 50 L) downloads the
// fuel voucher xlsx and now reports success via toast. Read-only rung: the
// export mutates nothing — the persisted financial-state row identity is
// captured (unchanged) around the driver by the invoking shell.
import puppeteer from 'puppeteer';
import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const DRIVER_LOG = `${QA}/2026-10-06_card20261006391_ui-fuelcard-driver.log`;
const LOG = [];
const log = (step, obj) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  // Crash-safe trail: a step that wedges leaves its last step on disk.
  appendFileSync(DRIVER_LOG, JSON.stringify(e) + '\n');
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
  const voucherResponses = [];
  page.on('request', (req) => { void req.continue(); });
  page.on('response', async (res) => {
    if (res.url().includes('/fuel-voucher/xlsx')) {
      voucherResponses.push({ status: res.status(), contentType: res.headers()['content-type'] });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips/32869`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // The fuel actions render only when the trip carries a fuel supplier —
  // finding them doubles as the fixture check.
  await page.waitForSelector('.fuel-actions button', { timeout: 30000 });
  const buttons = await page.$$('.fuel-actions button');
  let exportBtn = null;
  for (const b of buttons) {
    const t = await b.evaluate((el) => (el.textContent || '').trim());
    if (t.includes('Xuất Excel')) { exportBtn = b; break; }
  }
  if (!exportBtn) throw new Error('fuel-card export button not found');
  const before = await exportBtn.evaluate((el) => ({ text: (el.textContent || '').trim(), disabled: el.disabled }));
  log('button-before', before);

  await exportBtn.click();
  await page.waitForFunction(
    () => (document.querySelector('.toast--success')?.textContent || '').includes('Đã xuất phiếu cấp nhiên liệu ra tệp Excel.'),
    { timeout: 15000 },
  );
  const toastText = await page.evaluate(() => (document.querySelector('.toast--success')?.textContent || '').trim());
  log('toast-assert', { toastText, matchesExpected: toastText.includes('Đã xuất phiếu cấp nhiên liệu ra tệp Excel.') });
  await page.screenshot({ path: `${QA}/2026-10-06_card20261006391_ui-fuelcard-toast.png` });
  log('screenshot', { path: 'qa/2026-10-06_card20261006391_ui-fuelcard-toast.png' });

  log('api-identity', {
    voucherResponses,
    note: 'read-only export — no persisted mutation expected; financial-state row captured unchanged by the invoking shell',
  });
} finally {
  await browser.close();
}

mkdirSync(QA, { recursive: true });
appendFileSync(DRIVER_LOG, 'DRIVER OK\n');
console.log('DRIVER OK');
