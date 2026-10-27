// SIL-539 (board id 604) — "Hủy ghép/tách nhóm: lô tách ra còn Loại xe +
// Tuyến đường phải tự tra lại cước dự kiến từ Bảng giá, không về 'Chưa xác
// định'" — rung-3 confirmation drive on the WORKTREE build (:7176 FE + :3003
// BE with this branch's unmerge code).
//
// Pre-drive (real API, real DB, same script run):
//   merge R42RV-02 (242) + R42RV-D2 (244) → REV group (class 13 = 10T)
//   unmerge 244 → the split lot KEEPS rev_vehicle_class_id=13 and its money
//   re-lookups from the bảng giá lane (cust 1 × route 10 × 10T = 3.100.000,
//   effective 2026-10-02) instead of "chờ định giá lại".
// This script then proves the USER-VISIBLE face: the CUS settlement board's
// expanded row for R42RV-D2 shows Loại xe "10T" + a REAL price, and the money
// cell reads 3.100.000 — never "Chưa xác định".
//
//   node qa/scripts/2026-10-27-sil539-unmerge-reprice-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = 'http://localhost:7176';
const API3 = 'http://localhost:3003/api';
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-27_sil539_unmerge-reprice_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-27_sil539_unmerge-reprice_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── API leg: merge + unmerge against the branch backend (:3003) ─────────────
const login = async (base) => {
  const res = await fetch(`${base}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed (${res.status})`);
  return (await res.json()).token;
};
const token = await login(API3);
log('LOGIN ok thanhdc (via :3003)');
// The FE at :7176 proxies /api to :3002 — a :3003-issued token may carry a
// different secret when the worktree lacks the checkout's .env. The UI leg
// logs in against :3002 so the proxy accepts it.
const uiToken = await login('http://localhost:3002/api');
log('LOGIN ok thanhdc (via :3002, for the UI leg)');

// Guard: the pair must be ungrouped before we merge (idempotent re-runs).
const pre = await fetch(`${API3}/shipments/lcl/unmerge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `sil539-pre-${Date.now()}` },
  body: JSON.stringify({ shipmentId: 244, dimension: 'REV' }),
}).then((r) => r.json()).catch(() => null);
log(`PRE unmerge (noop if already split): ${JSON.stringify(pre).slice(0, 120)}`);

const mergeRes = await fetch(`${API3}/shipments/lcl/rev-group`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `sil539-merge-${Date.now()}` },
  body: JSON.stringify({ shipmentIds: [242, 244], vehicleSizeClassId: 13 }),
}).then((r) => r.json());
check('API merge 242+244 into a REV group', Boolean(mergeRes?.groupId), JSON.stringify(mergeRes).slice(0, 140));

const unmergeRes = await fetch(`${API3}/shipments/lcl/unmerge`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `sil539-split-${Date.now()}` },
  body: JSON.stringify({ shipmentId: 244, dimension: 'REV' }),
}).then((r) => r.json());
check('API unmerge splits R42RV-D2 out', unmergeRes?.leaver?.shipmentId === 244, JSON.stringify(unmergeRes).slice(0, 140));

// ── UI leg: the CUS board shows the re-looked-up money ──────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, uiToken);
await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.shipment-debit-row', { timeout: 25000 });
await sleep(800);

// Expand the split lot's detail (⋯ kebab → Mở chi tiết).
const opened = await page.evaluate(() => {
  const tr = Array.from(document.querySelectorAll('.shipment-debit-row'))
    .find((n) => (n.textContent ?? '').includes('R42RV-D2'));
  if (!tr) return false;
  const kebab = Array.from(tr.querySelectorAll('button'))
    .find((b) => (b.getAttribute('aria-label') ?? '').includes('Hành động lô R42RV-D2'));
  if (!kebab) return false;
  kebab.click();
  return true;
});
if (!opened) { log('FAIL row/kebab for R42RV-D2 not found'); process.exit(2); }
await sleep(700);
await page.evaluate(() => {
  const items = Array.from(document.querySelectorAll('[role="menuitem"]'));
  const open = items.find((b) => /Mở chi tiết lô R42RV-D2/.test(b.textContent ?? ''));
  if (open) open.click();
});
await sleep(1200);
await shot(page, 'debit-split-lot-expanded');

const facts = await page.evaluate(() => {
  const expand = document.querySelector('.shipment-debit-expand');
  const text = expand ? (expand.textContent ?? '').replace(/\s+/g, ' ') : '';
  // The drawer's price lives in an INPUT's value — read inputs, not text.
  const inputs = expand ? Array.from(expand.querySelectorAll('input')).map((i) => i.value) : [];
  const moneyRow = Array.from(document.querySelectorAll('.shipment-debit-row'))
    .find((n) => (n.textContent ?? '').includes('R42RV-D2'));
  const receivable = moneyRow?.querySelector('td[data-col="receivable"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
  const isChuaXacDinh = /Chưa xác định/.test(text) || /chờ định giá lại/.test(text);
  const hasClass10T = /10T/.test(text);
  const hasPrice = /3\.100\.000|3100000/.test(receivable ?? '') || inputs.some((v) => /^(3\.100\.000|3100000)$/.test(v.trim()));
  return { text: text.slice(0, 400), receivable, isChuaXacDinh, hasClass10T, hasPrice, inputs: inputs.filter(Boolean).slice(0, 8) };
});
check('UI split lot shows Loại xe 10T (kept, not wiped)', facts.hasClass10T, `receivable="${facts.receivable}"`);
check('UI split lot shows the re-looked-up price 3.100.000', facts.hasPrice, `inputs=${JSON.stringify(facts.inputs)}`);
check('UI no "Chưa xác định"/"chờ định giá lại" on the split lot', !facts.isChuaXacDinh, `receivable cell="${facts.receivable}"`);

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
