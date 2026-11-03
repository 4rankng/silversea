// SIL-660 — rung-3 UI drive (LOCAL ONLY): ô "Số tờ khai" CẤP LÔ trên tab
// HÀNG LẺ của form Tạo lô (owner ruling 02/11). Khách báo: tab LCL mất
// trường nhập tờ khai từ 0a20bd1c (SIL-521) vì không có bảng container.
//   PHASE=before — worktree đang ở base (stashed): assert tab LCL KHÔNG có ô
//                  (tái hiện defect) + ảnh trước.
//   PHASE=after  — worktree có SIL-660: tạo lô LCL với tờ khai qua UI thật,
//                  assert persist DB (shipment_declarations), ledger Chứng từ
//                  hiện số, edit prefill + update, view mode disabled.
// Stack: frontend 7190 → backend 3012, DB dùng chung dev :5441 (ss-prod-db).
// Run: node qa/scripts/2026-11-03-sil660-lcl-declaration-ui-drive.mjs
// Env: FRONT_PORT (7190), API_PORT (3012), PHASE (before|after).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PHASE = process.env.PHASE ?? 'after';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7190}`;
const API = `http://localhost:${process.env.API_PORT ?? 3012}/api`;
const OUT = path.resolve('qa/2026-11-03_sil660');
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

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=cus');

const dbDecl = (sid) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select id || '|' || coalesce(declaration_number,'<NULL>') from shipment_declarations where shipment_id=${sid} order by id"`,
).toString().trim() || '(no rows)';

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') log(`CONSOLE-ERR ${msg.text().slice(0, 200)}`); });
page.on('response', (res) => {
  if (res.url().includes('/api/shipments') && res.request().method() !== 'GET') {
    log(`API ${res.request().method()} ${res.url().replace(FRONT, '')} → ${res.status()}`);
  }
});

const lclField = () => page.evaluate(() => Boolean(document.querySelector('[data-field-id="shipment-lcl-declaration-number"]')));

async function gotoCreateLcl() {
  // Inject the token BEFORE any app-shell load (puppeteer-spa-auth law).
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

if (PHASE === 'before') {
  await gotoCreateLcl();
  const beforeHasField = await lclField();
  check('BEFORE: tab HÀNG LẺ KHÔNG có ô Số tờ khai (defect khách báo, 0a20bd1c)', beforeHasField === false, `hasField=${beforeHasField}`);
  await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
  await sleep(400);
  await shot(page, 'sil660-before-lcl-tab-no-declaration-field');
  await browser.close();
  log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
  process.exit(failures === 0 ? 0 : 1);
}

// ── PHASE=after ──────────────────────────────────────────────────────────────
const TK = `TK660-${Date.now().toString().slice(-8)}`;
// Unique per run: the server REJECTS a duplicate Số Bill across active lots
// (SHIPMENT_REFERENCE_DUPLICATE → 409 — rung evidence the guard works).
const BILL = `BL660-${Date.now().toString().slice(-6)}`;
let shipmentId = null;

// 1. Create: field exists on the LCL tab.
await gotoCreateLcl();
check('AFTER: tab HÀNG LẺ có ô Số tờ khai', await lclField() === true);
await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
await sleep(300);
await shot(page, 'sil660-after-create-lcl-field');

// 2. Fill the full LCL form through the REAL controls.
await pickFirstOption('Khách hàng');
// Hình thức XNK: portal select — pick 'Nhập khẩu' BY NAME and verify it
// committed (an empty direction silently downgrades the save to a partial
// draft and the edit round then hits full validation).
await page.evaluate(() => document.getElementById('shipment-trade-direction')?.click());
await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="option"]')).some((o) => o.textContent.includes('Nhập khẩu')), { timeout: 10000 });
await page.evaluate(() => Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent.includes('Nhập khẩu')).click());
await page.waitForFunction(() => document.getElementById('shipment-trade-direction')?.textContent.includes('Nhập khẩu'), { timeout: 5000 });
// Số Bill/Booking (IMPORT gate).
await page.evaluate(() => document.querySelector('[data-field-id="shipment-booking-ref"] input')?.focus());
await page.type('[data-field-id="shipment-booking-ref"] input', BILL, { delay: 20 });
// Tuyến đường: catalog pick (required for catalog LCL).
await pickFirstOption('Tuyến đường');
// Nhà máy + Kho: typed custom text (FB-105 both accept free text).
for (const [fieldId, text] of [
  ['shipment-operational-site', 'NM Sil660 UI'],
  ['shipment-pickup-warehouse', 'Kho CFS Sil660'],
]) {
  await page.evaluate((id) => document.querySelector(`[data-field-id="${id}"] input`)?.focus(), fieldId);
  await page.type(`[data-field-id="${fieldId}"] input`, text, { delay: 20 });
  await page.evaluate(() => document.activeElement?.blur());
  await sleep(200);
}
// Quy cách đóng gói: combobox accepts typed custom values.
await page.evaluate(() => document.querySelector('[data-field-id="shipment-package-type"] input')?.focus());
await page.type('[data-field-id="shipment-package-type"] input', 'Pallet Sil660', { delay: 20 });
await page.evaluate(() => document.activeElement?.blur());
// Số lượng + Trọng lượng + Thể tích.
await page.type('[data-field-id="shipment-package-count"] input', '6', { delay: 20 });
await page.type('[data-field-id="shipment-cargo-weight"] input', '420', { delay: 20 });
await page.type('[data-field-id="shipment-cargo-volume"] input', '2.4', { delay: 20 });
// Ngày giờ đóng trả (segmented).
const segs = ['hh', 'mm', 'dd', 'mm2', 'yyyy'];
const segVals = { hh: '09', mm: '30', dd: '05', mm2: '11', yyyy: '2026' };
for (const key of segs) {
  const sel = `[data-field-id="shipment-lcl-closing-at"] input[data-seg="${key}"]`;
  await page.click(sel);
  await page.type(sel, segVals[key], { delay: 30 });
}
// ⭐ SỐ TỜ KHAI — the SIL-660 field itself.
await page.type('[data-field-id="shipment-lcl-declaration-number"] input', TK, { delay: 20 });
const typedTk = await page.$eval('[data-field-id="shipment-lcl-declaration-number"] input', (el) => el.value);
check('Ô Số tờ khai nhận đúng giá trị đã gõ', typedTk === TK, typedTk);
await shot(page, 'sil660-after-create-filled');

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
      customerIssue: document.body.textContent.includes('Chọn khách hàng.'),
      customerValue: document.querySelector('[role="combobox"][aria-labelledby]')?.textContent?.slice(0, 40) ?? null,
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
// identity columns (a direction-less save would be a partial DRAFT, not the
// intake the ruling describes).
const declRows = dbDecl(shipmentId);
const lotCols = execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select coalesce(trade_direction,'<NULL>') || '|' || coalesce(bl_number,'<NULL>') || '|' || cargo_mode from shipments where id=${shipmentId}"`,
).toString().trim();
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `AFTER lot ${shipmentId} shipment_declarations (create):\n${declRows}\nlot columns: ${lotCols}\n`);
check('DB: shipment_declarations có row với số đã nhập', declRows.includes(`|${TK}`), declRows.replace(/\n/g, ' '));
check('DB: lô lưu đúng Nhập khẩu + Bill + LCL', lotCols === `IMPORT|${BILL}|LCL`, lotCols);

// 5. Read-side A: the detail page IS the view workspace — the LCL
// declaration input renders the persisted value, disabled (SIL-481 law;
// input VALUES are not body text, so assert the input itself).
const viewDecl = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input');
  return input ? { value: input.value, disabled: input.disabled } : null;
});
check('View/detail: ô Số tờ khai hiện giá trị đã lưu + disabled', Boolean(viewDecl?.value === TK && viewDecl?.disabled), JSON.stringify(viewDecl));
await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
await sleep(300);
await shot(page, 'sil660-after-detail-view-disabled');

// 6. Edit round: prefill + update.
await page.goto(`${FRONT}/shipments/${shipmentId}/edit`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input'), { timeout: 20000 });
await sleep(600);
const prefilled = await page.$eval('[data-field-id="shipment-lcl-declaration-number"] input', (el) => el.value);
check('Edit: prefill đúng số đã lưu', prefilled === TK, prefilled);
await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
await sleep(300);
await shot(page, 'sil660-after-edit-prefill');
const TK2 = `${TK}-B`;
// Select-all via the native value setter (a puppeteer triple-click does not
// reliably select inside the UTextField).
await page.evaluate(() => {
  const el = document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(el, '');
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
const declInput = await page.$('[data-field-id="shipment-lcl-declaration-number"] input');
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
const viewState = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id="shipment-lcl-declaration-number"] input');
  return input ? { value: input.value, disabled: input.disabled } : null;
});
if (viewState) {
  check('View mode (post-edit): hiện giá trị mới + disabled', viewState.value === TK2 && viewState.disabled === true, JSON.stringify(viewState));
  await page.evaluate(() => document.getElementById('shipment-section-cargo')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await shot(page, 'sil660-after-view-mode-disabled');
} else {
  check('View mode (post-edit): form read-only không render ô input', false, 'input not found');
  await shot(page, 'sil660-after-view-mode-disabled');
}

// 8. Read-side B: ledger Chứng từ (Tổng quan /shipments — CusShipmentRow,
// SIL-657 merged cell) renders the lot's số tờ khai. Search first — the
// queue-ranked list may page the fresh lot out of page 1.
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
await shot(page, 'sil660-after-ledger-chungtu');

// 9. Read-side C: dispatch handoffs/data-status aggregate (docs.declarationNumbers
// merges both stores — SIL-657). Requires a DISPATCHER+ account (cus is read-
// scoped away from dispatch). A fresh DRAFT-saved lot sits OUTSIDE the active
// dispatch plan window, so an empty row set is a scope note (the merge itself
// is pinned by the BE unit test sil657-declaration-number-sync.test.ts), not
// a SIL-660 failure — the API-level truth asserted here is the detail GET.
const dvRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
});
if (dvRes.ok) {
  const dvToken = (await dvRes.json()).token;
  const plan = await fetch(`${API}/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(TK)}`, { headers: { Authorization: `Bearer ${dvToken}` } }).then((r) => r.json());
  const rows = Array.isArray(plan?.items) ? plan.items : [];
  const matched = rows.some((r) => JSON.stringify(r.docs?.declarationNumbers ?? []).includes(TK2) || JSON.stringify(r).includes(TK2));
  if (rows.length === 0) {
    log(`NOTE dispatch-detail-plan-rows q=${TK}: 0 row — lô DRAFT ngoài window kế hoạch chi tiết xe (docs.declarationNumbers merge được pin BE sil657-declaration-number-sync.test.ts). Không phải fail SIL-660.`);
  } else {
    check('Dispatch handoffs/data-status: docs.declarationNumbers mang số đã nhập', matched, `rows=${rows.length}`);
  }
  fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
    `\nGET /shipments/dispatch-detail-plan-rows?q=${TK}:\n${JSON.stringify(rows.map((r) => ({ code: r.shipmentCode, docs: r.docs })), null, 2).slice(0, 2000)}\n`);
} else {
  check('Dispatch aggregate assert (dieuvan login)', false, `login status ${dvRes.status}`);
}

// 10. API identity for the detail GET declarations.
const detail = await fetch(`${API}/shipments/${shipmentId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `\nGET /shipments/${shipmentId} declarations:\n${JSON.stringify(detail.declarations)}\n`);
check('API detail trả declarations đúng số', JSON.stringify(detail.declarations).includes(TK2), TK2);

await browser.close();
log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
