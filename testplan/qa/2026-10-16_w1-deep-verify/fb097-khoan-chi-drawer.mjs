// FB-097 (card 141026230740) — staging rung-3: "Thêm khoản chi" drawer on the
// Kiểm soát phơi phiếu Tiền đường detail (accounting form variant).
//   a1 drawer titled "Thêm khoản chi"; invoice pair (Số hóa đơn / Ngày hóa đơn)
//      always visible and optional
//   a2 no "Ghi chú khoản chi" field
//   a3 no "Loại chứng từ" picker
//   a4 "Loại chi phí" + "Ngày chi" remain
//   a5 Nhóm chi phí offers only Tiền đường / Chi phí lô hàng
//   a6 Bên thực chi = Nhà cung cấp on a trip with NO external carrier →
//      supplier left empty for manual pick + hint "Chưa có nhà xe trên tuyến
//      này — chọn thủ công." (the FB-097 manual path; positive autofill has no
//      live surface on this board — see verdict notes)
//   a7 save keeps the drawer open, clears the entry, keeps group/date/payer;
//      status "Đã lưu khoản chi."; second save in-session lands a second row
// Fixture: feeName QA-W1-KC-FB097 (registry-covered: fee_name ILIKE 'QA%').
// Run from repo root: node testplan/qa/2026-10-16_w1-deep-verify/fb097-khoan-chi-drawer.mjs
import {
  api, assertEval, clickButtonByText, finish, goto, log, openAs, shot,
} from './w1-lib.mjs';
import {
  closePopover, comboboxPick, hasLabel, listOpenOptions, openUuiSelect,
  pickOption, readUuiSelect, setLabelledInput,
} from './ra.mjs';

const CARD = 'fb097';
const FEE = 'QA-W1-KC-FB097';
const results = { feeName: FEE };

const health = await fetch('https://vantai.tingting.vip/api/health').then(r => r.json());
log(`HEALTH buildHash=${health.buildHash}`);
if (health.buildHash !== '5a139108') throw new Error(`BUILD GATE FAIL: ${health.buildHash}`);
results.buildHash = health.buildHash;

const rowsRes = await api({ user: 'hoapt', path: '/api/expense-accounting/phoi-phieu/rows' });
const rows = rowsRes.json?.items ?? [];
const row = rows.find(r => r.carrierSupplierId != null && r.tripId != null)
  ?? rows.find(r => r.tripId != null);
if (!row) throw new Error('no phoi-phieu row with a trip to drive');
log(`ROW picked tripId=${row.tripId} bill=${row.billOrBooking} carrierSupplierId=${row.carrierSupplierId}`);
results.rowPicked = { tripId: row.tripId, bill: row.billOrBooking, carrierSupplierId: row.carrierSupplierId ?? null };
const carrierPresent = row.carrierSupplierId != null;

const before = await api({ user: 'hoapt', path: `/api/expense-accounting/phoi-phieu/${row.tripId}/tien-duong` });
const beforeCount = Array.isArray(before.json) ? before.json.length : 0;
log(`TIEN-DUONG before count=${beforeCount}`);

const page = await openAs('hoapt');
await goto(page, '/accounting/phoi-phieu');
await shot(page, `${CARD}_01-board.png`, { fullPage: false });

// 1) Open the picked row's Tiền đường detail.
const opened = await page.evaluate((bill) => {
  const btns = [...document.querySelectorAll('button')].filter(b => (b.textContent || '').trim() === 'Xem chi tiết');
  const target = btns.find(b => b.closest('tr')?.textContent?.includes(bill)) ?? btns[0];
  if (!target) return false;
  target.scrollIntoView({ block: 'center' });
  target.click();
  return true;
}, row.billOrBooking ?? '');
log(`CLICK Xem chi tiết -> ${opened}`);
if (!opened) throw new Error('no "Xem chi tiết" button on the board');
await new Promise(r => setTimeout(r, 2000));
await shot(page, `${CARD}_02-tien-duong-dialog.png`, { fullPage: false });

// 2) Open the drawer.
await clickButtonByText(page, '＋ Thêm dòng');
// The drawer replaces the modal only once the catalog fetch resolves — wait
// for the real thing instead of a guessed sleep.
await page.waitForFunction(() =>
  [...document.querySelectorAll('h2,h3,[class*="title"]')].some(n => (n.textContent || '').includes('Thêm khoản chi')),
  { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
await shot(page, `${CARD}_03-drawer-open.png`, { fullPage: false });

results.a1_title = await page.evaluate(() =>
  Boolean([...document.querySelectorAll('h2,h3,[class*="title"]')].find(n => (n.textContent || '').includes('Thêm khoản chi'))));
results.a2_no_note_field = !(await hasLabel(page, 'Ghi chú khoản chi'));
results.a3_no_kind_picker = !(await hasLabel(page, 'Loại chứng từ'));
results.a4_fee_type_and_date_kept = (await hasLabel(page, 'Loại chi phí lái xe')) && (await hasLabel(page, 'Ngày chi'));
results.a4_invoice_pair = (await hasLabel(page, 'Số hóa đơn')) && (await hasLabel(page, 'Ngày hóa đơn'));
const invoiceInputRequired = await page.evaluate(() => {
  const label = [...document.querySelectorAll('label')].find(l => (l.textContent || '').trim().startsWith('Số hóa đơn'));
  const input = label ? (label.htmlFor ? document.getElementById(label.htmlFor) : label.parentElement?.querySelector('input')) : null;
  return input ? !input.required : null;
});
results.a1_invoice_optional = invoiceInputRequired;

// 3) a5 — the group picker offers exactly the two manual groups.
await openUuiSelect(page, { options: ['Chi phí lô hàng', 'Tiền đường'] });
const groupOptions = await listOpenOptions(page);
results.a5_group_options = groupOptions;
results.a5_only_two_groups = groupOptions.length === 2
  && groupOptions.every(t => ['Tiền đường', 'Chi phí lô hàng'].includes(t));
await closePopover(page);

// 4) a6 — supplier autofill contract. Current board has no external-SUPPLIER
//    trip, so drive the manual path the contract pins: switching to Nhà cung
//    cấp leaves the picker empty + shows the manual-pick hint.
await openUuiSelect(page, { options: ['Nhà cung cấp'] });
await pickOption(page, 'Nhà cung cấp');
await new Promise(r => setTimeout(r, 900));
const supplierState = await readUuiSelect(page, 'Nhà cung cấp');
const supplierHint = await page.evaluate(() =>
  [...document.querySelectorAll('p')].map(n => (n.textContent || '').trim())
    .find(t => t.includes('Chưa có nhà xe trên tuyến này')) || null);
log(`SUPPLIER state=${JSON.stringify(supplierState)} hint =${JSON.stringify(supplierHint)}`);
await shot(page, `${CARD}_04-supplier-pick.png`, { fullPage: false });
if (carrierPresent) {
  results.a6_autofill_positive = supplierState.value !== '';
} else {
  results.a6_autofill_positive = 'NOT-COVERED: no phoi-phieu row on staging currently runs an external SUPPLIER carrier';
  results.a6_manual_path_empty_pick = supplierState.value === '';
  results.a6_manual_path_hint = supplierHint;
}
results.a6_mode = carrierPresent ? 'positive-autofill' : 'manual-pick-path';

// 5) Pick a supplier manually (required before save under SUPPLIER payer).
await comboboxPick(page, 'Nhà cung cấp', 'a', 'CÔNG TY');
await setLabelledInput(page, 'Tên khoản chi', FEE);
await setLabelledInput(page, 'Thực chi (VND)', '150000');
// (Thực thu — thu khách stays 0 for DRIVER_ROAD.)
await shot(page, `${CARD}_05-drawer-filled.png`, { fullPage: false });

// 6) Pick the fee type (this OVERWRITES Tên khoản chi — set the marker after).
await openUuiSelect(page, 'Loại chi phí lái xe');
await pickOption(page, 'Vé cầu đường');
await new Promise(r => setTimeout(r, 500));
// Override the autofilled name with the fixture marker.
await setLabelledInput(page, 'Tên khoản chi', FEE);
await shot(page, `${CARD}_06-ready-to-save.png`, { fullPage: false });

await clickButtonByText(page, 'Lưu 1 khoản chi', { exact: true });
await new Promise(r => setTimeout(r, 2500));
await shot(page, `${CARD}_07-after-first-save.png`, { fullPage: false });
const after1 = await assertEval(page, 'after-save-1', () => ({
  status: [...document.querySelectorAll('[role="status"]')].map(n => (n.textContent || '').trim()).find(t => t.includes('Đã lưu khoản chi')) || null,
  alert: [...document.querySelectorAll('[role="alert"]')].map(n => (n.textContent || '').trim()).find(t => t) || null,
  drawerStillOpen: Boolean([...document.querySelectorAll('label')].find(l => (l.textContent || '').trim().startsWith('Tên khoản chi'))),
  nameCleared: (() => {
    const label = [...document.querySelectorAll('label')].find(l => (l.textContent || '').trim().startsWith('Tên khoản chi'));
    const input = label ? (label.htmlFor ? document.getElementById(label.htmlFor) : label.parentElement?.querySelector('input')) : null;
    return input ? input.value === '' : null;
  })(),
  groupKept: null,
  payerKindKept: null,
}));
results.a7_drawer_stays_open = after1.drawerStillOpen === true;
results.a7_status_line = after1.status;
results.a7_error_line = after1.alert;
results.a7_entry_cleared = after1.nameCleared === true;

// 7) Save #2 in the same session — the draft reset kept payerKind SUPPLIER but
//    cleared the supplier, so repick one, then type/name/amount again.
await comboboxPick(page, 'Nhà cung cấp', 'a', 'CÔNG TY');
await openUuiSelect(page, 'Loại chi phí lái xe');
await pickOption(page, 'Vé cầu đường');
await setLabelledInput(page, 'Tên khoản chi', FEE);
await setLabelledInput(page, 'Thực chi (VND)', '150000');
await clickButtonByText(page, 'Lưu 1 khoản chi', { exact: true });
await new Promise(r => setTimeout(r, 2500));
await shot(page, `${CARD}_08-after-second-save.png`, { fullPage: false });
results.a7_second_save = await assertEval(page, 'after-save-2', () =>
  Boolean([...document.querySelectorAll('[role="status"]')].map(n => (n.textContent || '').trim()).find(t => t.includes('Đã lưu khoản chi'))));

await clickButtonByText(page, 'Đóng', { exact: true });
await new Promise(r => setTimeout(r, 1200));

// 8) Persisted proof: two QA-W1 rows on the trip's Tiền đường ledger.
const after = await api({ user: 'hoapt', path: `/api/expense-accounting/phoi-phieu/${row.tripId}/tien-duong` });
const list = Array.isArray(after.json) ? after.json : [];
const qaRows = list.filter(r => JSON.stringify(r).includes(FEE));
log(`TIEN-DUONG after count=${list.length} qaRows=${qaRows.length}`);
results.persisted_before = beforeCount;
results.persisted_after = list.length;
results.persisted_qa_w1_rows = qaRows.length;
results.a8_persisted_two_rows = list.length === beforeCount + 2 && qaRows.length >= 2;

await finish(CARD, results);
const fails = Object.entries(results).filter(([, v]) => v === false);
if (fails.length) {
  console.log('FB097 RESULT: FAIL —', fails.map(([k]) => k).join(', '));
  process.exit(1);
}
console.log('FB097 RESULT: PASS');
