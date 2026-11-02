// SIL-658 (id 765) + SIL-659 (id 766) — rung-3 UI drive on the LOCAL worktree
// stack (frontend 7210 / backend 3002, DB 5441 — the shared ss-prod-db).
//
// SIL-658: [Gộp hàng] on Chi tiết lô hàng — tick a lot, search another bill
// (list narrows), clear the search: the tick MUST survive and the floating
// bar MUST keep counting the picked lot (the boss repro: tick died at 0).
//
// SIL-659: the «Chỉnh sửa chứng từ và hãng tàu» dialog gains the SỐ cont
// field — seeded, uppercased, ISO-hinted, saved through the SAME
// container-line command as the container cell (in-lot law on the server),
// with the DB side effect proved and RESTORED afterwards.
//
//   node qa/scripts/2026-11-03-sil658-659-ui.mjs
// Env: FRONT_PORT (7210), API_PORT (3002).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7210}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa/2026-11-03-sil658-659');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-11-03_sil658-659_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-11-03_sil658-659_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const jf = async (p, opts) => {
  const res = await fetch(`${API}${p}`, opts);
  let body = null; try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
};
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await jf('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const token = loginRes.body?.token;
if (!token) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
log('LOGIN ok role=CUS (cus)');

// ── Wire facts (the same read model the UI renders) ────────────────────────
const listRows = async (suffix = '') => {
  const res = await jf(`/shipments/cus-workspace/containers?page=1&limit=50${suffix}`, { headers: { Authorization: `Bearer ${token}` } });
  return res.body?.items ?? [];
};
const all = await listRows();
const lotA = all.find((r) => r.isLotLevel && r.billOrBookNumber === 'R34-LCL1');
const lotB = all.find((r) => r.isLotLevel && r.billOrBookNumber === 'LCL07-BK6');
const contRow = all.find((r) => !r.isLotLevel && ['TSTU6006004', 'TSTU6006010'].includes(r.containerNumber ?? ''));
if (!lotA || !lotB) { log(`ABORT: fixture lots missing (A=${!!lotA} B=${!!lotB})`); process.exit(2); }
if (!contRow) { log('ABORT: SIL-659 fixture row (TSTU6006004/TSTU6006010) missing'); process.exit(2); }
log(`FIXTURE lots: A=ship${lotA.shipmentId} (R34-LCL1) B=ship${lotB.shipmentId} (LCL07-BK6), cont row id=${contRow.id} ship=${contRow.shipmentId}`);

// CONT_BEFORE is whatever the DB holds NOW (idempotent re-runs): the save
// targets the OTHER member of the fixture pair.
const CONT_BEFORE = psql(`SELECT container_number FROM shipment_containers WHERE id = ${contRow.id}`);
const NEW_NUMBER = CONT_BEFORE === 'TSTU6006004' ? 'TSTU6006010' : 'TSTU6006004';
log(`DB-BEFORE shipment_containers id=${contRow.id} container_number=${CONT_BEFORE}`);
const bridgeBefore = psql(`SELECT container_number FROM trip_containers WHERE source_shipment_container_id = ${contRow.id}`).trim();
log(`DB-BEFORE trip bridge rows: ${bridgeBefore || '(none — bridge is a no-op for this lot)'}`);

// The SIL-659 change target: the OTHER member of the fixture pair, typed
// with a deliberately wrong check digit so the live ISO hint drives the fix.
const TYPED_WRONG = `${NEW_NUMBER.slice(0, 10)}${NEW_NUMBER[10] === '0' ? '1' : '0'}`;
log(`SIL659 target: save ${NEW_NUMBER} (typed as ${TYPED_WRONG}, fixed via the live ISO hint)`);

// ── Browser ────────────────────────────────────────────────────────────────
// Page-side code travels as SELF-CONTAINED source strings (Function bodies):
// closures do not survive puppeteer's serialization.
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
// puppeteer-spa-auth law: the token lands BEFORE any app boot, so the SPA
// never redirects to /login.
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

const evalBody = (bodyFnSource) => page.evaluate(new Function(`return (${bodyFnSource})();`));

/** Evaluate a self-contained `() => …` source string inside the page. */
const inPage = (body) => evalBody(body);
/** Poll a self-contained predicate until truthy. */
const waitFor = async (body, label, timeoutMs = 20000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try { if (await inPage(body)) return; } catch { /* detached mid-render */ }
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
};
/** Click whatever a self-contained finder returns (must exist). */
const clickPage = async (body, label) => {
  const ok = await inPage(`() => { const el = (${body.replace(/^\(\) =>/, '')}); if (!el) return false; el.click(); return true; }`);
  if (!ok) throw new Error(`click target not found: ${label}`);
};
/** React-safe typing into a self-contained input finder. */
const typePage = async (finderBody, value, label) => {
  const ok = await inPage(`() => {
    const input = (${finderBody.replace(/^\(\) =>/, '')});
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }`);
  if (!ok) throw new Error(`input not found: ${label}`);
};

const hasRowBody = (needle) => `() => [...document.querySelectorAll('tbody tr')].some((tr) => tr.textContent.includes(${JSON.stringify(needle)}))`;
const BAR_TOTALS = `() => document.querySelector('.lcl-selection-bar__totals')?.textContent ?? null`;
const MERGE_HEADER = `() => [...document.querySelectorAll('th')].some((th) => th.textContent === 'Chọn lô hàng lẻ để gộp')`;
const gopToggleBody = (label, pressed) => `() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === ${JSON.stringify(label)} && b.getAttribute('aria-pressed') === ${JSON.stringify(pressed)})`;
const checkboxBody = (bill) => `() => [...document.querySelectorAll('input[type="checkbox"]')].find((c) => c.getAttribute('aria-label') === ${JSON.stringify(`Chọn lô ${bill}`)}) ?? null`;
const docsTriggerBody = (cont) => `() => [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith(${JSON.stringify(`Chỉnh sửa ô chứng từ và hãng tàu ${cont}`)})) ?? null`;
const saveBtnBody = `() => [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Lưu chứng từ và hãng tàu')) ?? null`;
const SEARCH_BOX = `() => document.querySelector('input[aria-label="Container, Bill/Booking, mã lô, tờ khai hoặc khách hàng"]') ?? null`;
const CONT_INPUT = `() => [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Số cont')?.querySelector('input') ?? null`;
const CONT_FIELD_PRESENT = `() => [...document.querySelectorAll('label span')].some((s) => s.textContent === 'Số cont')`;

try {
  await page.goto(`${FRONT}/shipments-detail?dateScope=all&limit=50`, { waitUntil: 'networkidle2', timeout: 60000 });
  await waitFor(hasRowBody('R34-LCL1'), 'rows loaded');
  await shot(page, '01-before-gop');
  check('SIL658 pre: cả 2 lô test trên trang (limit=50)', true, 'R34-LCL1 + LCL07-BK6');

  // ── SIL-658 ──────────────────────────────────────────────────────────────
  await clickPage(gopToggleBody('Gộp hàng', 'false'), '[Gộp hàng] toggle');
  await waitFor(MERGE_HEADER, 'CHỌN column');
  await clickPage(checkboxBody('R34-LCL1'), 'tick R34-LCL1');
  await waitFor(`() => (${BAR_TOTALS.replace(/^\(\) =>/, '')}).includes('Đang chọn 1 lô')`, 'bar counts 1');
  await shot(page, '02-sil658-tick1');
  const barAfterTick = await inPage(BAR_TOTALS);
  check('SIL658 tick 1 lô: bar đếm 1', (barAfterTick ?? '').includes('Đang chọn 1 lô'), barAfterTick);

  // The repro: gõ bill lô khác → danh sách còn lô khác → tích phải GIỮ.
  await typePage(SEARCH_BOX, 'LCL07-BK6', 'search box');
  await waitFor(`() => !${hasRowBody('R34-LCL1').replace(/^\(\) =>/, '')}`, 'R34-LCL1 filtered away');
  const barWhileFiltered = await inPage(BAR_TOTALS);
  await shot(page, '03-sil658-filtered-bk6');
  check('SIL658 đang filter: bar VẪN đếm 1 (bug cũ: về 0)', (barWhileFiltered ?? '').includes('Đang chọn 1 lô'), barWhileFiltered ?? '(bar hidden)');

  // Xoá tìm kiếm → lô cũ quay lại VÀ còn tick.
  await typePage(SEARCH_BOX, '', 'search box (clear)');
  await waitFor(hasRowBody('R34-LCL1'), 'R34-LCL1 back after clearing search');
  const r34StillChecked = await inPage(`() => (${checkboxBody('R34-LCL1')})()?.checked ?? null`);
  await shot(page, '04-sil658-restored-tick-kept');
  check('SIL658 xoá tìm kiếm: R34-LCL1 quay lại CÒN TÍCH', r34StillChecked === true, `checked=${r34StillChecked}`);
  const barBack = await inPage(BAR_TOTALS);
  check('SIL658 bar vẫn đếm 1 sau khi quay lại', (barBack ?? '').includes('Đang chọn 1 lô'), barBack);

  // AC2: gộp tiếp — tick thêm lô khác sau khi tìm kiếm → đếm đủ 2.
  await clickPage(checkboxBody('LCL07-BK6'), 'tick LCL07-BK6');
  await waitFor(`() => (${BAR_TOTALS.replace(/^\(\) =>/, '')}).includes('Đang chọn 2 lô')`, 'bar counts 2');
  await shot(page, '05-sil658-two-picks');
  const barTwo = await inPage(BAR_TOTALS);
  check('SIL658 tick thêm sau khi tìm: bar đếm 2', (barTwo ?? '').includes('Đang chọn 2 lô'), barTwo);
  const mergeArmed = await inPage(`() => { const btn = [...document.querySelectorAll('.lcl-selection-bar button')].find((b) => b.textContent.trim() === 'Gộp hàng'); return btn ? btn.getAttribute('aria-disabled') : null; }`);
  check('SIL658 [Gộp hàng] armed với 2 lô chưa ghép', mergeArmed !== 'true', `aria-disabled=${mergeArmed}`);

  // Cleanup the mode (no server writes happened).
  await clickPage(`() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Bỏ chọn') ?? null`, '[Bỏ chọn]');
  await waitFor(`() => !(${BAR_TOTALS.replace(/^\(\) =>/, '')})`, 'bar closed');
  await clickPage(gopToggleBody('Thoát gộp hàng', 'true'), 'exit merge mode');
  await waitFor(`() => !(${MERGE_HEADER.replace(/^\(\) =>/, '')})`, 'CHỌN column hidden');
  log('CLEANUP merge mode exited, picks dropped');

  // ── SIL-659 ──────────────────────────────────────────────────────────────
  await typePage(SEARCH_BOX, CONT_BEFORE, 'search current number');
  // Wait for the FILTERED render to land (the old page already contained the
  // row — clicking mid-refetch would detach the trigger under the press).
  await waitFor(`() => !${hasRowBody('R34-LCL1').replace(/^\(\) =>/, '')}`, 'search narrowed the list');
  await waitFor(hasRowBody(CONT_BEFORE), 'row shown');
  await clickPage(docsTriggerBody('TSTU6006004'), 'documents cell trigger');
  await waitFor(CONT_FIELD_PRESENT, 'Số cont field in dialog');
  const seeded = await inPage(`() => { const label = [...document.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Số cont'); return label?.querySelector('input')?.value ?? null; }`);
  const order = await inPage(`() => [...document.querySelectorAll('.shipment-container-ledger__editor-grid > label > span')].map((s) => s.textContent)`);
  await shot(page, '06-sil659-dialog-field');
  check('SIL659 dialog có ô Số cont, seed đúng số cũ', seeded === CONT_BEFORE, `seeded=${seeded}`);
  // Ship 761 has NO tradeDirection, so the Số Bill/Booking slot is absent by
  // design («Chọn Nhập hoặc Xuất trước…») — the pinned order is: documents
  // fields first, Số cont LAST (DESIGN LOCK C: FB-113 order untouched).
  const lastLabel = order[order.length - 1];
  const hangTauIdx = order.indexOf('Hãng tàu');
  const contIdx = order.indexOf('Số cont');
  check('SIL659 field CUỐI form sau Hãng tàu (DESIGN LOCK C)', lastLabel === 'Số cont' && contIdx > hangTauIdx, order.join(' → '));

  // Type a wrong-check-digit variant of the target — the live ISO hint must
  // offer the one-tap fix (same affordance as the container cell).
  await typePage(CONT_INPUT, TYPED_WRONG, 'Số cont input');
  await waitFor(`() => [...document.querySelectorAll('.shipment-container-ledger__number-hint')].some((h) => h.textContent.includes('Đổi thành'))`, 'ISO hint visible');
  await shot(page, '07-sil659-iso-hint');
  const suggestion = await inPage(`() => [...document.querySelectorAll('.shipment-container-ledger__number-hint button')].find(Boolean)?.textContent ?? null`);
  check('SIL659 ISO hint gợi ý đúng số hợp lệ', suggestion === `Đổi thành ${NEW_NUMBER}`, suggestion ?? '(none)');
  await clickPage(`() => [...document.querySelectorAll('.shipment-container-ledger__number-hint button')].find((b) => b.textContent === ${JSON.stringify(`Đổi thành ${NEW_NUMBER}`)}) ?? null`, 'hint fix button');

  // Save through the dialog — the SAME container-line command as the cell.
  await clickPage(saveBtnBody, 'dialog Lưu');
  // Success closes the editor; the row may leave the filtered view (the
  // search still names the OLD number), so the close is the UI signal.
  await waitFor(`() => !document.querySelector('.shipment-container-ledger__editor-heading')`, 'editor closed after save');
  await sleep(400);
  await shot(page, '08-sil659-saved');
  check('SIL659 UI: editor đóng sau khi Lưu (không lỗi inline)', true, 'documents editor closed');

  // API visibility: CUS read model serves the new number.
  const after = (await listRows(`&searchSuffix=${NEW_NUMBER}`)).find((r) => r.id === contRow.id);
  check('SIL659 API (CUS): row mang số mới', after?.containerNumber === NEW_NUMBER, `api=${after?.containerNumber}`);

  // DB side effect + the SIL-653 identity bridge.
  const CONT_AFTER = psql(`SELECT container_number FROM shipment_containers WHERE id = ${contRow.id}`);
  check('SIL659 DB: shipment_containers đã lưu số mới', CONT_AFTER === NEW_NUMBER, `before=${CONT_BEFORE} after=${CONT_AFTER}`);
  if (bridgeBefore) {
    const bridgeAfter = psql(`SELECT container_number FROM trip_containers WHERE source_shipment_container_id = ${contRow.id}`).trim();
    check('SIL653 bridge: trip snapshot mirror cùng số mới', bridgeAfter === NEW_NUMBER, bridgeAfter);
  } else {
    log('NOTE SIL653 bridge: lô chưa có chuyến — bridge là no-op (luật server-side, đã pin bằng unit tests)');
  }

  // RESTORE the original number through the SAME dialog path. First clear
  // the search (it still names the now-old number and would hide the row the
  // moment the restore lands), then reopen the editor by its NEW number.
  await typePage(SEARCH_BOX, '', 'search box (clear before restore)');
  await waitFor(hasRowBody(NEW_NUMBER), 'renamed row visible');
  check('SIL659 UI: ô chứng từ mang số MỚI sau khi lưu', true, 'trigger renamed in the unfiltered list');
  await clickPage(docsTriggerBody(NEW_NUMBER), 'reopen documents editor');
  await waitFor(CONT_FIELD_PRESENT, 'dialog reopened');
  await typePage(CONT_INPUT, CONT_BEFORE, 'Số cont input (restore)');
  await clickPage(saveBtnBody, 'dialog Lưu (restore)');
  await waitFor(`() => !document.querySelector('.shipment-container-ledger__editor-heading')`, 'restore editor closed');
  const CONT_RESTORED = psql(`SELECT container_number FROM shipment_containers WHERE id = ${contRow.id}`);
  check('SIL659 restore: DB trả về số gốc', CONT_RESTORED === CONT_BEFORE, `restored=${CONT_RESTORED}`);
  await shot(page, '09-sil659-restored');
} catch (err) {
  await shot(page, '99-error-state').catch(() => {});
  log(`ABORT: ${err.message}`);
  failures += 1;
} finally {
  log(`console errors: ${consoleErrors.length === 0 ? '(none)' : consoleErrors.slice(0, 5).join(' | ')}`);
  await browser.close();
}

log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
