// GP-03 sweep (audit £100, 2026-10-24) — rung-3 driver: the ĐV "Phân bổ nhà
// xe" dialog no longer carries a "BKS báo khách (ảo)" editor (spec 23/10 §1),
// and a ĐV save writes ONLY the BKS thực fact. AFTER-only (this worktree's
// build; the field's BEFORE existence is pinned by the removed-test history
// and the cargo-mode test's old assertions).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7185';
const API = process.env.QA_API ?? 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-24-gomhang-r39');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'gp03-sweep_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Lot 148 (kK6356464) — LCL, ungrouped, on the master plan's page 1.
const LOT_BILL = 'kK6356464';

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`front=${FRONT} api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }
const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
}).then((r) => r.json());

const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
// Known start state: a stored ảo value (the CUS's) that MUST survive the ĐV
// write untouched — the sweep's DB-side law.
await sql`update shipments set billing_truck_no = '30C-GP03', actual_truck_no = null where id = 148`;

const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('pageerror', (err) => log(`PAGEERROR ${err.message}`));
await page.goto(`${FRONT}/dispatch`, { waitUntil: 'networkidle2', timeout: 60_000 });
await page.waitForFunction((bill) => document.body.innerText.includes(bill), { timeout: 25_000 }, LOT_BILL);
await sleep(800);

// Open the row's allocation dialog (the "Phân bổ nhà xe" action cell).
const opened = await page.evaluate((bill) => {
  // Deepest-scope match: each allocation button's own row must carry the bill.
  const btns = [...document.querySelectorAll('button[aria-label="Chỉnh sửa phân bổ nhà xe"]')];
  const btn = btns.find((b) => b.closest('tr')?.textContent?.includes(bill));
  if (!btn) return false;
  btn.click();
  return true;
}, LOT_BILL);
check('GP-03: mở dialog Phân bổ nhà xe của lô LCL', opened);
await page.waitForFunction(() => document.body.innerText.includes('Phân bổ hàng lẻ hiện tại'), { timeout: 15_000 });
await sleep(600);

const fields = await page.evaluate(() => ({
  bksAo: [...document.querySelectorAll('input[role="combobox"]')].some((i) => /BKS báo khách/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? ''))),
  bksThuc: [...document.querySelectorAll('input[role="combobox"]')].some((i) => /BKS thực/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? ''))),
  debitHint: /Debit Note .* sẽ in BKS này/.test(document.body.innerText ?? ''),
}));
log(`GP-03 fields: ${JSON.stringify(fields)}`);
await page.screenshot({ path: path.join(OUT, 'gp03_after_allocation-dialog.png') });
check('GP-03: KHÔNG còn ô "BKS báo khách (ảo)" trong dialog ĐV', fields.bksAo === false);
check('GP-03: ô BKS thực vẫn còn (đúng field-set ĐV)', fields.bksThuc === true);
check('GP-03: hint Debit Note (FB-094) đã đi theo ô ảo', fields.debitHint === false);

// Save a BKS thực from the ĐV side — payload only actual; billing untouched.
const setNative = await page.evaluate(() => {
  const inputs = [...document.querySelectorAll('input[role="combobox"]')];
  const el = inputs.find((i) => /BKS thực/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? '')));
  if (!el) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  el.focus();
  setter.call(el, '29C-GP03.01');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
check('GP-03: nhập BKS thực', setNative);
await sleep(400);
// Capture the request body the FE actually sends.
let payloadSeen = null;
page.on('request', (req) => {
  if (req.url().includes('/shipments/lcl/truck') && req.method() === 'POST') {
    payloadSeen = req.postData();
  }
});
const saved = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu phân bổ');
  if (!btn) return false;
  btn.click();
  return true;
});
check('GP-03: bấm Lưu phân bổ', saved);
await sleep(1800);
const toastText = await page.evaluate(() => document.body.innerText);
check('GP-03: toast lưu thành công', /Đã lưu BKS lô lẻ/.test(toastText));
await page.screenshot({ path: path.join(OUT, 'gp03_after_save.png') });
log(`GP-03 wire payload: ${payloadSeen}`);
check('GP-03: payload ĐV chỉ chứa BKS thực (không billingTruckNo)', payloadSeen != null && !/billingTruckNo/.test(payloadSeen), String(payloadSeen));

const [db] = await sql`select id, actual_truck_no, billing_truck_no from shipments where id = ${(payloadSeen ? JSON.parse(payloadSeen).shipmentId : 148)}`;
log(`GP-03 DB: ${JSON.stringify(db)}`);
check('GP-03 DB: actual_truck_no = 29C-GP03.01', db?.actual_truck_no === '29C-GP03.01');
check('GP-03 DB: billing_truck_no của CUS GIỮ NGUYÊN (30C-GP03)', db?.billing_truck_no === '30C-GP03');

// Restore the touched fixtures to their pre-run state.
await sql`update shipments set actual_truck_no = '51C-202.63', billing_truck_no = '51C-999.99' where id = 173`;
await sql`update shipments set actual_truck_no = null, billing_truck_no = null where id = 148`;
log('fixtures restored (173, 148)');

await browser.close();
await sql.end();
log(`SUMMARY gp03: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
