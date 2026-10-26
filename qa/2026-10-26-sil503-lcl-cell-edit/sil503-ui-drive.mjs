// SIL-503 — UI DRIVEN verification on the LOCAL dev stack (backend :3002,
// vite :7195, both served from THIS worktree fix-lcl-cell-edit).
//
// Drive /shipments-detail at 1440×900 as tiepvv (CUS):
//   a) the lot row's SỐ TỜ KHAI cell opens the SHARED documents editor
//      (heading names the LÔ, lot hint) and a number-only save POSTs the
//      shipment declaration — DB proof: shipment_declarations row;
//   b) the unallocated lot's "Nhập BKS thực" trigger opens the BKS thực
//      editor and saves through updateLclTruck — DB proof:
//      shipments.actual_truck_no;
//   c) an FCL row on the same board keeps its per-cont documents editor
//      (opened + cancelled, nothing written — parity is behavioural).
//
// Fixture: one fresh LCL lot via POST /api/shipments/quick (product path,
// idempotency-keyed) — never touches other lanes' seed data.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const BASE = process.env.QA_BASE || 'http://localhost:7195';
const API = process.env.QA_API || 'http://localhost:3002/api';
const BILL = `SIL503LCL${Date.now().toString().slice(-6)}`;
const DECLARATION = `TK-SIL503-${Date.now().toString().slice(-6)}`;
const PLATE = '29H-503.55';

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const flush = () => fs.writeFileSync(path.join(HERE, 'ui-driver.log'), `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const die = (step, obj = {}) => { log(`STOP_${step}`, obj); flush(); process.exit(2); };

function localPassword() {
  const txt = fs.readFileSync(path.join(REPO, 'testplan', 'testaccounts.txt'), 'utf8');
  const idx = txt.indexOf('\nlocal:');
  const segment = idx >= 0 ? txt.slice(idx) : txt;
  const match = segment.match(/^[ \t]*password:[ \t]*(\S+)/m);
  if (!match) throw new Error('local password not found in testplan/testaccounts.txt');
  return match[1];
}

const health = await (await fetch(`${API}/health`)).json();
log('health', { status: health.status, buildHash: health.buildHash });
if (health.status !== 'ok') die('health');

// ── Fixture: fresh LCL lot (product path) ──────────────────────────────────
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: localPassword() }),
});
if (!loginRes.ok) die('login', { status: loginRes.status });
const { token, user } = await loginRes.json();
log('login', { username: user?.username, role: user?.role });

const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
const createRes = await fetch(`${API}/shipments/quick`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'Idempotency-Key': `sil503-ui-${BILL}`,
  },
  body: JSON.stringify({
    customerId: 41,
    blNumber: BILL,
    tradeDirection: 'IMPORT',
    cargoMode: 'LCL',
    expectedDeliveryDate: tomorrow,
    customerNotes: 'SIL-503 QA fixture',
  }),
});
if (!createRes.ok && createRes.status !== 200) die('fixture_create', { status: createRes.status, body: (await createRes.text()).slice(0, 400) });
const lot = await createRes.json();
log('fixture_lot', { id: lot.id, shipmentCode: lot.shipmentCode, cargoMode: lot.cargoMode });
const LOT_SEARCH = BILL;

// ── Browser ────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

const shot = (name) => page.screenshot({ path: path.join(HERE, `ui-${name}.png`) });
const text = () => page.evaluate(() => document.body.innerText);
const waitForText = async (needle, label) => {
  for (let i = 0; i < 40; i += 1) {
    if ((await text()).includes(needle)) return true;
    await sleep(250);
  }
  die('wait_text', { needle, label });
};

// (a) Lot row: SỐ TỜ KHAI click → editor → save → cell shows the number.
await page.goto(`${BASE}/shipments-detail?searchSuffix=${LOT_SEARCH}&dateScope=all`, { waitUntil: 'networkidle0' });
await waitForText(LOT_SEARCH, 'lot row on the board');
await shot('lot-board-before');
log('board_lot_row_visible', { search: LOT_SEARCH });

const lotTr = await page.evaluateHandle((bill) => {
  return [...document.querySelectorAll('tr')].find((tr) => tr.textContent.includes(bill));
}, LOT_SEARCH);
if (!lotTr || !(await lotTr.asElement())) die('lot_row_missing');

const declCellTextBefore = await page.evaluate((tr) => tr.querySelector('td[data-label="Số tờ khai"]')?.textContent ?? null, lotTr);
log('declaration_cell_before', { text: declCellTextBefore });
// The unallocated state also pins the pending label + the SIL-503 entry action.
const vehicleCellBefore = await page.evaluate((tr) => tr.querySelector('td[data-label="Phân xe"]')?.textContent ?? null, lotTr);
log('vehicle_cell_before', { text: vehicleCellBefore });

// Click the Số tờ khai cell trigger (the mounting documents trigger).
await page.evaluate((tr) => {
  const cell = tr.querySelector('td[data-label="Số tờ khai"]');
  const btn = cell?.querySelector('button');
  if (!btn) throw new Error('no documents trigger in the Số tờ khai cell');
  btn.click();
}, lotTr);
await waitForText('Chỉnh sửa chứng từ và hãng tàu', 'documents editor open');
const heading = await page.evaluate(() => document.querySelector('.shipment-container-ledger__editor-heading')?.textContent ?? null);
log('documents_editor_heading', { heading });
await shot('declaration-editor-open');

// The heading must name the LOT (Bill/Booking), never "Container số 1".
if (!heading || !heading.includes(BILL)) die('editor_heading_not_lot', { heading });

// Type the declaration number and save.
await page.evaluate((value) => {
  const input = [...document.querySelectorAll('.shipment-container-ledger__inline-editor label')]
    .find((label) => label.textContent.includes('Số tờ khai'))?.querySelector('input');
  if (!input) throw new Error('no Số tờ khai input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, DECLARATION);
await sleep(150);
await page.evaluate(() => {
  const save = [...document.querySelectorAll('.shipment-container-ledger__inline-editor button')]
    .find((button) => button.textContent.includes('Lưu'));
  if (!save) throw new Error('no Lưu button');
  save.click();
});
await waitForText(DECLARATION, 'declaration number rendered back into the cell');
// The save refetches rows — the old <tr> node is detached; re-query fresh.
const declCellTextAfter = await page.evaluate((bill) => {
  const tr = [...document.querySelectorAll('tr')].find((candidate) => candidate.textContent.includes(bill));
  return tr?.querySelector('td[data-label="Số tờ khai"]')?.textContent ?? null;
}, LOT_SEARCH);
log('declaration_cell_after', { text: declCellTextAfter });
await shot('declaration-after-save');

// (b) The unallocated lot row: "Nhập BKS thực" → editor → save → plate shows.
const nhapTrigger = await page.evaluateHandle((bill) => {
  const tr = [...document.querySelectorAll('tr')].find((candidate) => candidate.textContent.includes(bill));
  const cell = tr?.querySelector('td[data-label="Phân xe"]');
  return [...(cell?.querySelectorAll('button') ?? [])].find((button) => button.getAttribute('aria-label')?.startsWith('Nhập BKS thực'));
}, LOT_SEARCH);
if (!nhapTrigger || !(await nhapTrigger.asElement())) die('nhap_bks_trigger_missing', { vehicleCellBefore });
await page.evaluate((el) => el.click(), nhapTrigger);
await waitForText('BKS thực là biển số xe chạy thực tế', 'BKS thực editor open');
await shot('bks-thuc-editor-open');
await page.evaluate((value) => {
  const input = document.querySelector('.shipment-container-ledger__inline-editor .searchable-select input, .shipment-container-ledger__inline-editor input[role="combobox"], .shipment-container-ledger__inline-editor input');
  if (!input) throw new Error('no BKS input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, PLATE);
await sleep(150);
// Click Lưu directly — a programmatic click lands regardless of the
// suggestion popover, mirroring the FB-093a save contract.
await page.evaluate((plate) => {
  const save = [...document.querySelectorAll('.shipment-container-ledger__inline-editor button')]
    .find((button) => button.textContent.includes('Lưu'));
  if (!save) {
    throw new Error(`no Lưu button; editors=${document.querySelectorAll('.shipment-container-ledger__inline-editor').length}; body=${document.body.innerText.slice(0, 300)}`);
  }
  save.click();
}, PLATE);
await waitForText('BKS Thực', 'vehicle cell refresh');
for (let i = 0; i < 40; i += 1) {
  const composite = await page.evaluate((bill, plate) => {
    const tr = [...document.querySelectorAll('tr')].find((candidate) => candidate.textContent.includes(bill));
    return tr?.querySelector('td[data-label="Phân xe"] strong')?.textContent ?? null;
  }, LOT_SEARCH, PLATE);
  if (composite && composite.includes(PLATE)) { log('vehicle_cell_after', { composite }); break; }
  await sleep(250);
  if (i === 39) die('bks_not_rendered');
}
await shot('bks-thuc-after-save');

// (c) FCL parity on the same board: open + cancel, nothing written.
// FCL 318 (SHP-2610-00021) is READ-ONLY here: the editor opens, is asserted,
// and is cancelled — no write lands on the shared fixture.
await page.goto(`${BASE}/shipments-detail?searchSuffix=SIL502UI&dateScope=all`, { waitUntil: 'networkidle0' });
await waitForText('SIL502UI', 'FCL row on the board');
const fclTr = await page.evaluateHandle(() => {
  return [...document.querySelectorAll('tr')].find((tr) => tr.querySelector('td[data-label="Số tờ khai"]') && tr.textContent.includes('SILU5001029'));
}, );
if (!fclTr || !(await fclTr.asElement())) die('fcl_row_missing');
await page.evaluate((tr) => {
  const cell = tr.querySelector('td[data-label="Số tờ khai"]');
  const btn = cell?.querySelector('button');
  if (!btn) throw new Error('FCL row lost its documents trigger');
  btn.click();
}, fclTr);
await waitForText('Chỉnh sửa chứng từ và hãng tàu', 'FCL documents editor open');
const fclHeading = await page.evaluate(() => document.querySelector('.shipment-container-ledger__editor-heading')?.textContent ?? null);
log('fcl_editor_heading', { heading: fclHeading });
const fclHint = await page.evaluate(() => [...document.querySelectorAll('.shipment-container-ledger__inline-editor small')]
  .map((small) => small.textContent).find((t) => t?.includes('Số tờ khai')) ?? null);
log('fcl_declaration_hint', { hint: fclHint });
if (!fclHint || !fclHint.includes('từng container')) die('fcl_hint_changed', { fclHint });
await shot('fcl-editor-open');
await page.keyboard.press('Escape');
await sleep(300);
log('fcl_editor_cancelled');

if (consoleErrors.length) log('console_errors', { errors: consoleErrors.slice(0, 5) });
else log('console_clean');
await browser.close();
fs.writeFileSync(path.join(HERE, 'ui-assertions.json'), JSON.stringify({
  bill: BILL, declaration: DECLARATION, plate: PLATE, lotId: lot.id,
  declarationCellBefore: declCellTextBefore, declarationCellAfter: declCellTextAfter,
  vehicleCellBefore, heading, fclHeading, fclHint, consoleErrors,
}, null, 2));
log('DONE');
flush();
