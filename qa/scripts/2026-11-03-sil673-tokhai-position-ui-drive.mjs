// SIL-673 — rung-3 UI drive (LOCAL ONLY): ô "Số tờ khai" (tab HÀNG LẺ) chuyển
// lên section Nhận diện lô, ngay TRÊN ô Số Bill/Booking (owner ruling 03/11).
// DISPLAY-POSITION ONLY: cùng field SIL-660 (id shipment-lcl-declaration-
// number), cùng đường persist shipment_declarations — script này chứng minh
// vị trí mới + logic không đổi (create → DB row → view disabled → edit PUT
// cùng row → ledger Chứng từ), FCL không đụng, 390 stack không vỡ.
//   PHASE=before — base code (trước fix): ô nằm ở Thông tin hàng (cột cuối,
//                  sau Thể tích), DƯỚI section Nhận diện lô. Ảnh 1366+390.
//   PHASE=after  — SIL-673: ô là con của #shipment-section-identity, DOM
//                  TRƯỚC shipment-booking-ref, cùng cột trái, hàng TRÊN.
// Stack: frontend 7190 → backend 3012, DB dùng chung dev :5441 (ss-prod-db).
// Run: PHASE=before|after node qa/scripts/2026-11-03-sil673-tokhai-position-ui-drive.mjs
// Env: FRONT_PORT (7190), API_PORT (3012), PHASE.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PHASE = process.env.PHASE ?? 'after';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7190}`;
const API = `http://localhost:${process.env.API_PORT ?? 3012}/api`;
const OUT = path.resolve('qa/2026-11-03_sil673');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ui-driver-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

// Brief-specified CUS account (testplan/testaccounts.txt NV019); cus is the
// generic CUS fallback so the drive still runs if the named account is locked.
let token = null;
let who = null;
for (const identifier of ['tiepvv', 'cus']) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.ok) { token = (await res.json()).token; who = identifier; break; }
  log(`LOGIN ${identifier} → ${res.status}`);
}
if (!token) { log('ABORT: login failed for tiepvv AND cus'); process.exit(2); }
log(`LOGIN ok role=cus account=${who}`);

const dbDecl = (sid) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select id || '|' || coalesce(declaration_number,'<NULL>') from shipment_declarations where shipment_id=${sid} order by id"`,
).toString().trim() || '(no rows)';

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1366, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') log(`CONSOLE-ERR ${msg.text().slice(0, 200)}`); });
page.on('response', (res) => {
  if (res.url().includes('/api/shipments') && res.request().method() !== 'GET') {
    log(`API ${res.request().method()} ${res.url().replace(FRONT, '')} → ${res.status()}`);
  }
});

const DECL_SEL = '[data-field-id="shipment-lcl-declaration-number"]';

// NOTE: this SPA does not survive a mid-session viewport switch (resize →
// empty body, probed 03/11) — every 390 pass must set the viewport BEFORE
// navigating (same pattern as the SIL-660 390 sweep).
async function gotoCreateLcl(width = 1366) {
  // Inject the token BEFORE any app-shell load (puppeteer-spa-auth law).
  await page.setViewport(width === 390
    ? { width: 390, height: 844, isMobile: true, hasTouch: true }
    : { width, height: 900 });
  await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => localStorage.setItem('token', t), token);
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  await page.evaluate(() => {
    const lcl = Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r) => r.value === 'LCL');
    lcl.click();
  });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-pickup-warehouse"]'), { timeout: 10000 });
}

async function pickFirstOption(labelText) {
  // Comboboxes carry react-aria generated ids: resolve visible label →
  // aria-labelledby → the combobox input (labels render as 'Khách hàng*').
  await page.waitForFunction((txt) => {
    const label = Array.from(document.querySelectorAll('label'))
      .find((l) => l.textContent.replace(/\*/g, '').trim() === txt && l.id);
    return Boolean(label && document.querySelector(`[role="combobox"][aria-labelledby="${label.id}"]`));
  }, { timeout: 15000 }, labelText);
  await page.evaluate((txt) => {
    const label = Array.from(document.querySelectorAll('label'))
      .find((l) => l.textContent.replace(/\*/g, '').trim() === txt && l.id);
    const combo = document.querySelector(`[role="combobox"][aria-labelledby="${label.id}"]`);
    combo.focus();
    combo.click();
  }, labelText);
  await page.waitForFunction(() => Boolean(document.querySelector('[role="option"]')), { timeout: 10000 });
  await page.evaluate(() => document.querySelector('[role="option"]').click());
  await sleep(300);
}

// Geometry of the two fields: section membership + DOM order + boxes.
const geometry = () => page.evaluate((sel) => {
  const decl = document.querySelector(sel);
  const booking = document.querySelector('[data-field-id="shipment-booking-ref"]');
  if (!decl || !booking) return { decl: null, booking: null };
  const section = decl.closest('section');
  const dr = decl.querySelector('input').getBoundingClientRect();
  const br = booking.querySelector('input').getBoundingClientRect();
  return {
    decl: {
      sectionId: section?.id ?? null,
      sectionHasCargoTitle: Boolean(section?.textContent.includes('Thông tin hàng')),
      sectionHasIdentityTitle: Boolean(section?.textContent.includes('Nhận diện lô')),
      domBeforeBooking: Boolean(decl.compareDocumentPosition(booking) & Node.DOCUMENT_POSITION_FOLLOWING),
      inputTop: Math.round(dr.top), inputLeft: Math.round(dr.left), inputW: Math.round(dr.width),
    },
    booking: { inputTop: Math.round(br.top), inputLeft: Math.round(br.left), inputW: Math.round(br.width) },
    docW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  };
}, DECL_SEL);

if (PHASE === 'before') {
  await gotoCreateLcl(1366);
  const g = await geometry();
  check('BEFORE: ô tờ khai thuộc section Thông tin hàng (cũ)', g.decl?.sectionHasCargoTitle === true && g.decl?.sectionHasIdentityTitle === false, JSON.stringify(g.decl));
  check('BEFORE: ô tờ khai DƯỚI ô Bill (booking.top < declaration.top)', g.booking.inputTop < g.decl.inputTop, `booking.top=${g.booking.inputTop} decl.top=${g.decl.inputTop}`);
  await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot(page, 'sil673-before-1366-tokhai-o-thong-tin-hang');
  // Fresh navigation at the phone viewport (viewport BEFORE goto — see the
  // note on gotoCreateLcl).
  await gotoCreateLcl(390);
  const g390 = await geometry();
  check('BEFORE 390: form render đủ + không tràn ngang', Boolean(g390.decl) && g390.docW <= g390.clientW + 1, `doc=${g390.docW} client=${g390.clientW}`);
  await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot(page, 'sil673-before-390-tokhai-o-thong-tin-hang');
  await browser.close();
  log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

// ── PHASE=after ──────────────────────────────────────────────────────────────
const TK = `TK673-${Date.now().toString().slice(-8)}`;
// Unique per run: the server REJECTS a duplicate Số Bill across active lots
// (SHIPMENT_REFERENCE_DUPLICATE → 409 — rung evidence the guard works).
const BILL = `BL673-${Date.now().toString().slice(-6)}`;
let shipmentId = null;

// 1. Position: identity section, DOM before Bill, row above, same left column.
await gotoCreateLcl();
const g = await geometry();
check('AFTER: ô tờ khai thuộc section Nhận diện lô (identity)', g.decl?.sectionId === 'shipment-section-identity' && g.decl?.sectionHasIdentityTitle === true, JSON.stringify(g.decl));
check('AFTER: ô tờ khai KHÔNG còn ở Thông tin hàng', g.decl?.sectionHasCargoTitle === false, JSON.stringify(g.decl));
check('AFTER: DOM — tờ khai TRƯỚC ô Số Bill/Booking', g.decl?.domBeforeBooking === true, JSON.stringify(g.decl));
check('AFTER: visual — tờ khai ở hàng TRÊN ô Bill', g.decl.inputTop < g.booking.inputTop, `decl.top=${g.decl.inputTop} booking.top=${g.booking.inputTop}`);
check('AFTER: cùng cột trái (align với ô Bill)', Math.abs(g.decl.inputLeft - g.booking.inputLeft) <= 2, `decl.left=${g.decl.inputLeft} booking.left=${g.booking.inputLeft}`);
check('AFTER @1366: không tràn ngang', g.docW <= g.clientW + 1, `doc=${g.docW} client=${g.clientW}`);
await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
await sleep(400);
await shot(page, 'sil673-after-1366-tokhai-tren-nhan-dien-lo');

// 2. Fill the full LCL form through the REAL controls (SIL-660 flow verbatim —
// the save path must be identical for the persist proof to count).
await pickFirstOption('Khách hàng');
await page.evaluate(() => document.getElementById('shipment-trade-direction')?.click());
await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="option"]')).some((o) => o.textContent.includes('Nhập khẩu')), { timeout: 10000 });
await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.includes('Nhập khẩu')).click());
await page.waitForFunction(() => document.getElementById('shipment-trade-direction')?.textContent.includes('Nhập khẩu'), { timeout: 5000 });
await page.evaluate(() => document.querySelector('[data-field-id="shipment-booking-ref"] input')?.focus());
await page.type('[data-field-id="shipment-booking-ref"] input', BILL, { delay: 20 });
await pickFirstOption('Tuyến đường');
for (const [fieldId, text] of [
  ['shipment-operational-site', 'NM Sil673 UI'],
  ['shipment-pickup-warehouse', 'Kho CFS Sil673'],
]) {
  await page.evaluate((id) => document.querySelector(`[data-field-id="${id}"] input`)?.focus(), fieldId);
  await page.type(`[data-field-id="${fieldId}"] input`, text, { delay: 20 });
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(200);
}
await page.evaluate(() => document.querySelector('[data-field-id="shipment-package-type"] input')?.focus());
await page.type('[data-field-id="shipment-package-type"] input', 'Pallet Sil673', { delay: 20 });
await page.evaluate(() => document.activeElement?.blur());
await page.type('[data-field-id="shipment-package-count"] input', '6', { delay: 20 });
await page.type('[data-field-id="shipment-cargo-weight"] input', '420', { delay: 20 });
await page.type('[data-field-id="shipment-cargo-volume"] input', '2.4', { delay: 20 });
const segs = ['hh', 'mm', 'dd', 'mm2', 'yyyy'];
const segVals = { hh: '09', mm: '30', dd: '05', mm2: '11', yyyy: '2026' };
for (const key of segs) {
  const sel = `[data-field-id="shipment-lcl-closing-at"] input[data-seg="${key}"]`;
  await page.click(sel);
  await page.type(sel, segVals[key], { delay: 30 });
}
// ⭐ SỐ TỜ KHAI — at its NEW position (identity band).
await page.type(`${DECL_SEL} input`, TK, { delay: 20 });
const typedTk = await page.$eval(`${DECL_SEL} input`, (el) => el.value);
check('Ô Số tờ khai nhận đúng giá trị đã gõ (vị trí mới)', typedTk === TK, typedTk);
await shot(page, 'sil673-after-1366-filled');

// 3. Lưu nháp → wait for the detail redirect (retry — a busy first paint can
// swallow the click; log any inline validation alert each attempt).
async function clickSaveAndWait(buttonText) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.evaluate((text) => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === text);
      btn?.click();
    }, buttonText);
    const navigated = await page.waitForFunction(
      () => /\/shipments\/\d+$/.test(location.pathname),
      { timeout: 10000 },
    ).then(() => true).catch(() => false);
    if (navigated) return;
    const alertText = await page.evaluate(() => ({
      alert: document.querySelector('[role="alert"], .csc-submit-error')?.textContent?.trim().slice(0, 240) ?? null,
      saveDisabled: Array.from(document.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Lưu nháp')?.disabled ?? null,
    }));
    log(`SAVE-RETRY ${attempt} (${buttonText}) ${JSON.stringify(alertText)} url=${page.url()}`);
  }
  throw new Error(`Save "${buttonText}" never navigated`);
}
await clickSaveAndWait('Lưu nháp');
shipmentId = Number(new URL(page.url()).pathname.split('/').pop());
log(`SAVED lot id=${shipmentId}`);
await sleep(800);

// 4. DB side-effect proof: the shipment_declarations entity row + the lot's
// identity columns (persist path UNCHANGED by SIL-673).
const declRows = dbDecl(shipmentId);
const lotCols = execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select coalesce(trade_direction,'<NULL>') || '|' || coalesce(bl_number,'<NULL>') || '|' || cargo_mode from shipments where id=${shipmentId}"`,
).toString().trim();
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `AFTER lot ${shipmentId} shipment_declarations (create):\n${declRows}\nlot columns: ${lotCols}\n`);
check('DB: shipment_declarations có row với số đã nhập', declRows.includes(`|${TK}`), declRows.replace(/\n/g, ' '));
check('DB: lô lưu đúng Nhập khẩu + Bill + LCL', lotCols === `IMPORT|${BILL}|LCL`, lotCols);

// 5. View/detail: the LCL declaration input renders the persisted value,
// disabled (SIL-481 law; input VALUES are not body text — assert the input).
const viewDecl = await page.evaluate((sel) => {
  const input = document.querySelector(`${sel} input`);
  const inputEl = input ? { value: input.value, disabled: input.disabled } : null;
  const decl = document.querySelector(sel);
  const section = decl?.closest('section');
  return { input: inputEl, sectionId: section?.id ?? null };
}, DECL_SEL);
check('View/detail: ô Số tờ khai (identity) hiện giá trị đã lưu + disabled', viewDecl.sectionId === 'shipment-section-identity' && viewDecl.input?.value === TK && viewDecl.input?.disabled === true, JSON.stringify(viewDecl));
await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot(page, 'sil673-after-1366-detail-view-disabled');

// 6. Edit round: prefill + update.
await page.goto(`${FRONT}/shipments/${shipmentId}/edit`, { waitUntil: 'networkidle2' });
await page.waitForFunction((sel) => document.querySelector(`${sel} input`), { timeout: 20000 }, DECL_SEL);
await sleep(600);
const prefilled = await page.$eval(`${DECL_SEL} input`, (el) => el.value);
check('Edit: prefill đúng số đã lưu', prefilled === TK, prefilled);
await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot(page, 'sil673-after-1366-edit-prefill');
const TK2 = `${TK}-B`;
await page.evaluate((sel) => {
  const el = document.querySelector(`${sel} input`);
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, DECL_SEL);
const declInput = await page.$(`${DECL_SEL} input`);
await declInput.type(TK2, { delay: 20 });
// Edit mode's primary save is "Lưu thay đổi" (SIL-171: Lưu nháp is create-only).
await clickSaveAndWait('Lưu thay đổi');
await sleep(800);
const declRows2 = dbDecl(shipmentId);
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `\nAFTER lot ${shipmentId} shipment_declarations (edit update):\n${declRows2}\n`);
check('DB: PUT cập nhật cùng row (không sinh row trùng)', declRows2.includes(`|${TK2}`) && declRows2.split('\n').length === 1, declRows2.replace(/\n/g, ' '));

// 7. View mode: the detail workspace renders the value, disabled.
await sleep(500);
const viewState = await page.evaluate((sel) => {
  const input = document.querySelector(`${sel} input`);
  return input ? { value: input.value, disabled: input.disabled } : null;
}, DECL_SEL);
if (viewState) {
  check('View mode (post-edit): hiện giá trị mới + disabled', viewState.value === TK2 && viewState.disabled === true, JSON.stringify(viewState));
  await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
  await sleep(300);
  await shot(page, 'sil673-after-1366-view-mode-disabled');
} else {
  check('View mode (post-edit): form read-only không render ô input', false, 'input not found');
  await shot(page, 'sil673-after-1366-view-mode-disabled');
}

// 8. Read-side: ledger Chứng từ (Tổng quan /shipments — CusShipmentRow,
// SIL-657 merged cell) renders the lot's số tờ khai.
await page.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2' });
await page.waitForSelector('input[aria-label="Tìm lô hàng"]', { timeout: 20000 });
await page.evaluate((tk) => {
  const el = document.querySelector('input[aria-label="Tìm lô hàng"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, tk);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, TK2);
await page.waitForFunction((tk) => document.body.textContent.includes(tk), { timeout: 20000 }, TK2)
  .catch(() => {});
const ledgerCell = await page.evaluate((tk) => {
  const cells = Array.from(document.querySelectorAll('[data-cell-label="Chứng từ"], .cus-multiline-cell--mono'))
    .map((n) => n.textContent.trim());
  return { body: document.body.textContent.includes(tk), cells: cells.filter((t) => t.includes(tk)).slice(0, 2) };
}, TK2);
check('Ledger Chứng từ (Tổng quan) hiện số tờ khai của lô LCL', ledgerCell.body && ledgerCell.cells.length > 0, JSON.stringify(ledgerCell));
await shot(page, 'sil673-after-1366-ledger-chungtu');

// 9. API identity for the detail GET declarations.
const detail = await fetch(`${API}/shipments/${shipmentId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `\nGET /shipments/${shipmentId} declarations:\n${JSON.stringify(detail.declarations)}\n`);
check('API detail trả declarations đúng số', JSON.stringify(detail.declarations).includes(TK2), TK2);

// 10. FCL tab unchanged: no lot-level field, per-cont column intact.
await gotoCreateFcl();
const fcl = await page.evaluate((sel) => ({
  lotField: Boolean(document.querySelector(sel)),
  tableHeaders: Array.from(document.querySelectorAll('table th')).map((th) => th.textContent.trim()),
  perContInputs: document.querySelectorAll('table input[aria-label="Số tờ khai"], table [data-field-id$="-declaration"] input').length,
}), DECL_SEL);
check('FCL: KHÔNG có ô tờ khai cấp lô (identity lô không mang ô trên FCL)', fcl.lotField === false, JSON.stringify(fcl));
check('FCL: bảng container còn cột SỐ TỜ KHAI per-cont', fcl.tableHeaders.includes('Số tờ khai') && fcl.perContInputs >= 1, JSON.stringify(fcl));
await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
await sleep(300);
await shot(page, 'sil673-after-1366-fcl-khong-doi');

async function gotoCreateFcl() {
  await page.setViewport({ width: 1366, height: 900 });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-booking-ref"]'), { timeout: 10000 });
}
// 11. 390 phone: identity stack — tờ khai full-width row, trên Bill, no h-scroll.
await gotoCreateLcl390();
const g390 = await geometry();
check('390: ô tờ khai trong identity, TRÊN ô Bill (stack)', g390.decl?.sectionId === 'shipment-section-identity' && g390.decl.inputTop < g390.booking.inputTop, JSON.stringify(g390));
check('390: không tràn ngang', g390.docW <= g390.clientW + 1, `doc=${g390.docW} client=${g390.clientW}`);
await page.evaluate(() => document.getElementById('shipment-section-identity')?.scrollIntoView({ block: 'start' }));
await sleep(400);
await shot(page, 'sil673-after-390-nhan-dien-lo-stack');

async function gotoCreateLcl390() {
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  await page.evaluate(() => {
    const lcl = Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r) => r.value === 'LCL');
    lcl.click();
  });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-pickup-warehouse"]'), { timeout: 10000 });
}

await browser.close();
log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
