// SIL-522 (+ SIL-521 điểm 4) UI drive — Tạo lô từ UI không còn gửi
// declarationNumber; endpoint trả 201 (build feb07747 đã 400 vì key lạ).
//
// Surfaces:
//   A. Form tạo lô /shipments/new (CUS thanhdc): điền tối thiểu (khách hàng
//      catalog + 1 dòng cont có loại/số) → bấm "Lưu nháp" → chặn POST
//      /api/shipments/quick thật: body KHÔNG có key declarationNumber /
//      declarationNumbers; response 201; FE điều hướng sang /shipments/:id.
//   B. Form sửa lô /shipments/:id/edit — hết input/strip Số tờ khai cấp lô.
//   C. Dialog quick-edit 'Chứng từ' (Tổng quan) — còn Bill/Booking, hết
//      '+ Thêm tờ khai' và mọi input Số tờ khai cấp lô.
//   D. DB side-effect: GET /api/shipments/:id (auth) sau khi tạo — lô tồn tại
//      đúng dữ liệu UI gửi, containers không có tờ khai.
// Read-only đối với data có sẵn: chỉ đụng lot mới tạo riêng cho drive.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-27-sil522-uicreate-no-decl-key.mjs
// Output: qa/2026-10-27_sil521-fe-landing/*.png + assertions JSON + driver log.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const API = process.env.QA_API_URL || 'http://localhost:3002/api';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil521-fe-landing');
mkdirSync(OUT, { recursive: true });
const log = [];
const assertions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function assert(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail: detail ?? null });
  log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) process.exitCode = 1;
}

// ISO 6346 check digit for an owner code + serial (10 chars).
function iso6346CheckDigit(ten) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const map = new Map();
  let value = 10;
  for (const ch of alphabet) { map.set(ch, value); value += value % 11 === 0 ? 2 : 1; }
  let sum = 0;
  [...ten].forEach((ch, i) => { sum += (map.get(ch) ?? Number(ch)) * 2 ** i; });
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}
const contBase = `TSTU${Date.now().toString().slice(-6)}`;
const CONT = `${contBase}${iso6346CheckDigit(contBase)}`;
const BL = `BLSIL522${Date.now().toString().slice(-8)}`;

// ─── API: login + catalog (chỉ để LẤY tên khách hàng + loại cont) ──────────
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await loginRes.json();
assert('api login thanhdc (CUS)', Boolean(token));
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const boot = await (await fetch(`${API}/catalogs/bootstrap`, { headers: auth })).json();
const customer = boot.customers[0];
const containerType = boot.containerTypes.find((t) => /20DC/i.test(`${t.code} ${t.name}`)) ?? boot.containerTypes[0];
assert('bootstrap customer + container type', Boolean(customer?.name && containerType?.id), { customer: customer?.name, type: containerType?.code ?? null });

// ─── Browser ────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();

// Capture the REAL POST /shipments/quick wire the UI sends.
let quickPost = null;
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().includes('/api/shipments/quick')) {
    quickPost = { url: req.url(), body: req.postData() ?? null };
  }
});
let quickResponse = null;
page.on('response', async (res) => {
  if (res.request().method() === 'POST' && res.url().includes('/api/shipments/quick')) {
    quickResponse = { status: res.status() };
  }
});

await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'thanhdc');
await page.type('input[name="password"]', 'Abc123');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 45000 });
assert('browser login thanhdc', true, { url: page.url() });

// ─── A. Form tạo lô: điền + Lưu nháp ────────────────────────────────────────
await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await page.waitForSelector('#shipment-section-identity', { timeout: 45000 });
} catch {
  const diag = await page.evaluate(() => ({
    path: window.location.pathname,
    h1: document.querySelector('h1')?.textContent ?? null,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 160)),
    body: document.body.innerText.slice(0, 300),
  }));
  await page.screenshot({ path: resolve(OUT, 'sil522-debug-newpage.png') });
  log.push(`DEBUG /shipments/new — ${JSON.stringify(diag)}`);
  await browser.close();
  writeFileSync(resolve(OUT, 'ui-driver-sil522.log'), `${log.join('\n')}\nEXIT=1\n`);
  console.error(log.join('\n'));
  process.exit(1);
}
await sleep(700);

// A1. Khách hàng — searchable field: gõ tên → click option khớp.
const customerInputHandle = await page.$('[data-field-id="shipment-customer"] input');
assert('customer input reachable', Boolean(customerInputHandle));
await customerInputHandle.click({ clickCount: 3 });
await customerInputHandle.type(String(customer.name).slice(0, 24), { delay: 30 });
await sleep(900);
const pickedCustomer = await page.evaluate((name) => {
  const options = [...document.querySelectorAll('[role="option"]')];
  const match = options.find((o) => (o.textContent ?? '').includes(String(name).slice(0, 12)));
  if (!match) return { picked: false, seen: options.slice(0, 4).map((o) => o.textContent.slice(0, 40)) };
  match.click();
  return { picked: true };
}, customer.name);
assert('customer option picked from listbox', pickedCustomer.picked, pickedCustomer.seen ?? null);
await sleep(500);

// A1b. Hình thức XNK = Nhập khẩu (trigger button → option portal).
const dirTriggerFound = await page.evaluate(() => {
  const wrap = document.querySelector('[data-field-id="shipment-trade-direction"]');
  const trigger = [...wrap.querySelectorAll('button')].find((b) => (b.getAttribute('aria-haspopup') ?? '') === 'listbox')
    ?? wrap.querySelector('button');
  if (!trigger) return false;
  trigger.click();
  return true;
});
assert('trade direction trigger clicked', dirTriggerFound);
await sleep(700);
const pickedDirection = await page.evaluate(() => {
  const options = [...document.querySelectorAll('[role="option"]')].filter((o) => o.getClientRects().length > 0);
  const match = options.find((o) => o.textContent.trim() === 'Nhập khẩu');
  if (!match) return { picked: false, texts: options.map((o) => o.textContent.trim().slice(0, 20)) };
  match.click();
  return { picked: true };
});
assert('trade direction Nhập khẩu picked', pickedDirection.picked === true, pickedDirection.texts ?? null);
await sleep(600);

// A1c. Số Bill (IMPORT gate mở field).
const typedBill = await page.evaluate((value) => {
  const wrap = document.querySelector('[data-field-id="shipment-booking-ref"]');
  const input = wrap?.querySelector('input');
  if (!input || input.disabled) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, BL);
assert('Số Bill typed', typedBill);

// A2. Dòng container: loại (combobox input trong row) + số cont. Drive từng
// bước có verify: focus combobox → gõ code filter → click option khớp trong
// popover → đọc lại giá trị input để chắc chắn đã chọn.
const typeCombo = await page.$('.csc-container-row input[aria-label="Loại container"]');
assert('container type combobox reachable', Boolean(typeCombo));
await typeCombo.click();
await typeCombo.type(String(containerType.code).slice(0, 8), { delay: 40 });
await sleep(900);
const chooseTypeInPopover = await page.evaluate((code) => {
  const options = [...document.querySelectorAll('[role="option"]')]
    .filter((o) => o.getClientRects().length > 0);
  const needle = String(code ?? '');
  const match = options.find((o) => (o.textContent ?? '').includes(needle) && o.getAttribute('aria-disabled') !== 'true');
  if (!match) return { picked: false, optionCount: options.length, texts: options.slice(0, 6).map((o) => o.textContent.trim().slice(0, 30)) };
  match.click();
  return { picked: true, choseText: match.textContent.trim() };
}, containerType.code);
assert('container type option picked in popover', chooseTypeInPopover.picked === true, chooseTypeInPopover);
await sleep(600);
const rowTypeValue = await page.evaluate(() => (
  document.querySelector('.csc-container-row input[aria-label="Loại container"]')?.value ?? null
));
assert('container type committed on the row combobox', Boolean(rowTypeValue && rowTypeValue.trim() !== ''), rowTypeValue);
await sleep(300);
const typedCont = await page.evaluate((value) => {
  const rowEl = document.querySelector('.csc-container-row');
  const input = [...rowEl.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') ?? '').includes('Số container') || (i.placeholder ?? '').toUpperCase().includes('MSKU'));
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, CONT);
assert('container number typed', typedCont);

await page.screenshot({ path: resolve(OUT, 'sil522-form-filled-before-submit.png') });

// A3. Bấm "Lưu nháp" → POST thật.
const draftBtnClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu nháp');
  if (!btn) return false;
  btn.click();
  return true;
});
assert('Lưu nháp clicked', draftBtnClicked);

// A4. Chờ điều hướng sang /shipments/:id (create thành công → detail page).
try {
  await page.waitForFunction(() => /\/shipments\/\d+/.test(window.location.pathname), { timeout: 30000 });
} catch {
  const diag = await page.evaluate(() => ({
    path: window.location.pathname,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 160)),
  }));
  await page.screenshot({ path: resolve(OUT, 'sil522-after-submit-NOLAND.png') });
  log.push(`NAV FAIL — ${JSON.stringify(diag)}`);
}
await sleep(800);
await page.screenshot({ path: resolve(OUT, 'sil522-after-submit-detail.png') });

const lotIdFromUrl = await page.evaluate(() => (window.location.pathname.match(/\/shipments\/(\d+)/) ?? [])[1] ?? null);

assert('UI POST /shipments/quick captured', Boolean(quickPost && quickResponse));
let body = null;
try { body = JSON.parse(quickPost?.body ?? 'null'); } catch { body = null; }
assert('UI create payload có body JSON', Boolean(body));
assert('SIL-522 pin: payload KHÔNG có declarationNumber', body != null && !('declarationNumber' in body), body ? Object.keys(body).sort().slice(0, 40) : null);
assert('SIL-521 pin: payload KHÔNG có declarationNumbers', body != null && !('declarationNumbers' in body));
assert('HTTP 201 từ POST /shipments/quick (đã là 400 ở build feb07747)', quickResponse?.status === 201, quickResponse);
assert('FE điều hướng sang detail /shipments/:id', Boolean(lotIdFromUrl), lotIdFromUrl);
const lotId = Number(lotIdFromUrl);
if (!lotId) {
  log.push('ABORT: no lot id — B/C bỏ qua (create chưa landing).');
  writeFileSync(resolve(OUT, 'assertions-sil522-uicreate.json'), JSON.stringify({ lotId: null, container: CONT, quickPost: quickPost ? { url: quickPost.url } : null, quickStatus: quickResponse?.status ?? null, assertions }, null, 2));
  writeFileSync(resolve(OUT, 'ui-driver-sil522.log'), `${log.join('\n')}\nEXIT=1\n`);
  console.log(log.join('\n'));
  await browser.close();
  process.exit(1);
}

// ─── D. DB side-effect qua API đọc lại ──────────────────────────────────────
if (lotId) {
  const detail = await (await fetch(`${API}/shipments/cus-workspace/${lotId}`, { headers: auth })).json();
  const lotConts = detail.containers ?? [];
  assert('DB: lot tồn tại với cont vừa tạo', lotConts.some((c) => c.containerNumber === CONT), lotConts.map((c) => c.containerNumber));
  assert('DB: cont không mang tờ khai (per-cont trống)', lotConts.every((c) => c.declarationNumber == null), lotConts.map((c) => c.declarationNumber ?? null));
}

// ─── B. Form sửa lô: hết input Số tờ khai cấp lô ────────────────────────────
await page.setViewport({ width: 1440, height: 900 });
await page.goto(`${FE}/shipments/${lotId}/edit`, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await page.waitForSelector('#shipment-section-identity', { timeout: 45000 });
} catch {
  const diag = await page.evaluate(() => ({
    path: window.location.pathname,
    h1: document.querySelector('h1')?.textContent ?? null,
    body: document.body.innerText.slice(0, 250),
  }));
  await page.screenshot({ path: resolve(OUT, 'sil522-debug-editpage.png') });
  log.push(`DEBUG edit — ${JSON.stringify(diag)}`);
  writeFileSync(resolve(OUT, 'ui-driver-sil522.log'), `${log.join('\n')}\nEXIT=1\n`);
  console.error(log.join('\n'));
  await browser.close();
  process.exit(1);
}
await sleep(700);
const editProbe = await page.evaluate(() => ({
  strip: Boolean(document.querySelector('.csc-declaration-strip')),
  fieldId: Boolean(document.querySelector('[data-field-id="shipment-declarations"]')),
  bulk: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sửa hàng loạt'),
  declInput: Boolean(document.querySelector('#shipment-section-identity input[aria-label="Số tờ khai"]')),
}));
assert('edit form: NO strip / field / bulk / input Số tờ khai', !editProbe.strip && !editProbe.fieldId && !editProbe.bulk && !editProbe.declInput, editProbe);
await page.screenshot({ path: resolve(OUT, 'sil522-editform-no-decl.png') });

// ─── C. Dialog 'Chứng từ' ở Tổng quan /shipments: còn Bill/Booking, hết Thêm tờ khai ───
const searchTail = BL.slice(-6);
await page.goto(`${FE}/shipments?searchSuffix=${encodeURIComponent(searchTail)}`, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await page.waitForSelector(`#cus-inline-documents-${lotId}`, { timeout: 30000 });
} catch { /* handled by the click probe below */ }
await sleep(800);
// Ô Chứng từ của DÒNG LÔ (documents quick-edit) — nút cell có id riêng
// `cus-inline-documents-<shipmentId>` (CusShipmentRow).
const opened = await page.evaluate((lotIdNum) => {
  const btn = document.querySelector(`#cus-inline-documents-${lotIdNum}`)
    ?? [...document.querySelectorAll('button')].find((b) => /^cus-inline-documents-/.test(b.id));
  if (!btn) return { r: 'trigger-missing', rows: document.querySelectorAll('table tbody tr').length, docButtons: [...document.querySelectorAll('button[id^="cus-inline-documents-"]')].length };
  btn.click();
  return { r: 'clicked' };
}, lotId);
assert('Chứng từ cell clicked', opened.r === 'clicked', opened);
try {
  await page.waitForSelector('.modal__content, [role="dialog"]', { timeout: 20000 });
} catch { /* handled by probe below */ }
await sleep(700);
const dialogProbe = await page.evaluate(() => {
  const root = document.querySelector('.modal__content') ?? document.querySelector('[role="dialog"]');
  if (!root) return { open: false };
  return {
    open: true,
    heading: root.querySelector('h1,h2,[class*="title"]')?.textContent?.trim() ?? null,
    addDecl: [...root.querySelectorAll('button')].some((b) => b.textContent.trim() === '+ Thêm tờ khai'),
    declInput: Boolean(root.querySelector('input[aria-label="Số tờ khai"]')),
    declLabels: [...root.querySelectorAll('label span, label')].map((l) => l.textContent.trim()).filter((t) => t.includes('tờ khai')),
    hasBill: [...root.querySelectorAll('label')].some((l) => l.textContent.includes('Số Bill') || l.textContent.includes('Số Booking')),
  };
});
assert('Chứng từ dialog mở', dialogProbe.open === true, dialogProbe);
assert('dialog: HẾT nút "+ Thêm tờ khai"', dialogProbe.open && !dialogProbe.addDecl);
assert('dialog: HẾT input Số tờ khai', dialogProbe.open && !dialogProbe.declInput && (dialogProbe.declLabels ?? []).length === 0, dialogProbe.declLabels ?? null);
assert('dialog: còn Số Bill/Booking', dialogProbe.open && dialogProbe.hasBill);
await page.screenshot({ path: resolve(OUT, 'sil522-chungtu-dialog-no-decl.png') });

await browser.close();
writeFileSync(resolve(OUT, 'assertions-sil522-uicreate.json'), JSON.stringify({ lotId, container: CONT, customer: customer.name, quickPost: quickPost ? { url: quickPost.url, bodyKeys: body ? Object.keys(body).sort() : null } : null, quickStatus: quickResponse?.status ?? null, assertions }, null, 2));
writeFileSync(resolve(OUT, 'ui-driver-sil522.log'), `${log.join('\n')}\nEXIT=${process.exitCode ?? 0}\n`);
console.log(log.join('\n'));
console.log(`EXIT=${process.exitCode ?? 0}`);
