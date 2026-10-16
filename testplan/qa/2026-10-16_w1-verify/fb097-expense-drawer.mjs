// FB-097 (card 141026230740) — drawer "Thêm khoản chi" gọn + NCC autofill +
// nhập liên tục (TC-COSTUX-03/04). Rung 3 on /accounting/phoi-phieu as hoapt.
import {
  openAs, goto, shot, assertEval, clickButtonByText, api, finish, log,
} from './w1-lib.mjs';

const CARD = 'fb097';
const results = {};
const page = await openAs('hoapt');

// ── 1. Phoi-phieu board → open the Tiền đường dialog of the first trip ──
await goto(page, '/accounting/phoi-phieu', { wait: 4000 });
await shot(page, `${CARD}_01-board.png`);
results.boardRows = await assertEval(page, 'board trip rows', () =>
  document.body.innerText.match(/Nhà vận tải/g)?.length ?? 0);
results.pageLoaded = results.boardRows > 0;
if (!results.pageLoaded) { results.ABORT = 'no trips on phoi-phieu board'; await finish(CARD, results); process.exit(1); }

// Open a row's Tiền đường dialog — a trip WITH an active driver (server
// rejects driver-less trips on save) and without other QA rows.
const rowsApi = await api({ user: 'hoapt', path: '/api/expense-accounting/phoi-phieu/rows' });
const ppRows = rowsApi.json?.items ?? [];
const target = ppRows.find((row) => row.driverName && row.tripId === 78)
  ?? ppRows.find((row) => row.driverName);
results.targetTrip = target
  ? { tripId: target.tripId, bill: target.billOrBooking, driver: target.driverName, carrierSupplierId: target.carrierSupplierId }
  : null;
if (!results.targetTrip) { results.ABORT = 'no phoi-phieu row with an active driver'; await finish(CARD, results); process.exit(1); }
const opened = await page.evaluate((bill) => {
  const btns = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Xem chi tiết');
  const btn = btns.find((b) => b.closest('tr, [class*="row"], section, article')?.textContent?.includes(bill))
    ?? (btns.length === 1 ? btns[0] : null);
  if (!btn) return false;
  btn.scrollIntoView({ block: 'center' });
  btn.click();
  return true;
}, results.targetTrip.bill);
log(`CLICK "Xem chi tiết" for ${results.targetTrip.bill} -> ${opened}`);
if (!opened) { results.ABORT = 'no Xem chi tiết button'; await finish(CARD, results); process.exit(1); }
await new Promise((r) => setTimeout(r, 2500));
results.tienDuongDialog = await assertEval(page, 'tiền đường dialog', () => {
  const dlg = document.querySelector('[role="dialog"]');
  return dlg ? (dlg.querySelector('h2, [class*="title"]')?.textContent?.trim() ?? 'no-title') : null;
});

// ── 2. ＋ Thêm dòng → ExpenseCreateDrawer ──
await clickButtonByText(page, 'Thêm dòng');
await new Promise((r) => setTimeout(r, 1500));
await shot(page, `${CARD}_02-drawer.png`);
results.drawerTitle = await assertEval(page, 'drawer title', () => {
  const heads = [...document.querySelectorAll('[role="dialog"] h2, [role="dialog"] [class*="drawer"] h2')];
  return heads.map((h) => h.textContent?.trim()).filter(Boolean).slice(0, 3);
});
const drawerText = () => page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
const text1 = await drawerText();
results.contractForm = {
  ghiChoKhoanChiAbsent: !text1.includes('Ghi chú khoản chi'),
  soHoaDonVisible: text1.includes('Số hóa đơn'),
  ngayHoaDonVisible: text1.includes('Ngày hóa đơn'),
  loaiPhiSelectPresent: text1.includes('Loại chi phí lái xe'),
  ngayChiPresent: text1.includes('Ngày chi'),
  groupOptions: await page.evaluate(() => {
    const selects = [...document.querySelectorAll('[role="dialog"] select')];
    const groupSel = selects.find((s) => [...s.options].some((o) => o.label === 'Tiền đường'));
    return groupSel ? [...groupSel.options].map((o) => o.label) : null;
  }),
};
log(`CONTRACT ${JSON.stringify(results.contractForm)}`);

// ── 3. Fill a QA-named DRIVER_ROAD row ──
// Loại chi phí lái xe is a react-aria ComboBox (text input + listbox) —
// commit needs a real mouse down/up at the option's coordinates (repo law:
// synthetic .click() silently no-ops).
const loaiPicked = await (async () => {
  const inputInfo = await page.evaluate(() => {
    const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
    for (const label of document.querySelectorAll('[role="dialog"] label')) {
      if (norm(label.textContent) !== 'Loại chi phí lái xe') continue;
      let input = null;
      let ancestor = label.parentElement;
      for (let hop = 0; hop < 4 && ancestor && !input; hop++) {
        input = ancestor.querySelector('input[role="combobox"], input[type="text"]');
        ancestor = ancestor.parentElement;
      }
      if (input) return { found: true };
    }
    return { found: false };
  });
  if (!inputInfo?.found) return 'INPUT-NOT-FOUND';
  const input = await page.evaluateHandle(() => {
    const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
    const labels = [...document.querySelectorAll('[role="dialog"] label')];
    const target = labels.find((l) => norm(l.textContent) === 'Loại chi phí lái xe');
    let node = target;
    for (let hop = 0; hop < 4 && node; hop++) {
      const found = node.querySelector?.('input');
      if (found && found.type === 'text') return found;
      node = node.parentElement;
    }
    return null;
  });
  const el = input.asElement();
  if (!el) return 'HANDLE-NOT-FOUND';
  await el.click();
  await el.type('Tiền đường', { delay: 50 });
  await new Promise((r) => setTimeout(r, 900));
  const box = await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent ?? '').includes('Tiền đường'));
    if (!opt) return null;
    const r = opt.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: opt.textContent?.trim() };
  });
  if (!box) return 'OPTION-NOT-FOUND';
  await page.mouse.click(box.x, box.y);
  await new Promise((r) => setTimeout(r, 700));
  return box.text;
})();
log(`PICK loại chi phí (combobox) -> ${loaiPicked}`);
results.pickedLoai = loaiPicked;

// Tên khoản chi (TextField in a label) → QA-namespace via fee_name purge class.
const setByName = async (labelText, value) => {
  const ok = await page.evaluate((lt, v) => {
    const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
    for (const label of document.querySelectorAll('[role="dialog"] label')) {
      if (norm(label.textContent) !== lt) continue;
      let input = null;
      if (label.htmlFor) input = document.getElementById(label.htmlFor);
      if (!input) {
        let ancestor = label.parentElement;
        for (let hop = 0; hop < 4 && ancestor && !input; hop++) {
          input = ancestor.querySelector('input');
          ancestor = ancestor.parentElement;
        }
      }
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    return false;
  }, labelText, value);
  if (!ok) throw new Error(`label not found: ${labelText}`);
  await new Promise((r) => setTimeout(r, 300));
};
await setByName('Tên khoản chi', 'QA-W1 phí tiền đường fixture');
await new Promise((r) => setTimeout(r, 200));
if (loaiPicked === 'Tiền đường') {
  // The combobox option auto-fills Tên khoản chi with the option label —
  // re-assert the QA-namespace AFTER the pick so fee_name keeps the purge sig.
  await setByName('Tên khoản chi', 'QA-W1 phí tiền đường fixture');
}
const amountSet = await page.evaluate(() => {
  const norm = (t) => (t ?? '').replace(/\s*\*\s*$/, '').trim();
  for (const label of document.querySelectorAll('[role="dialog"] label')) {
    if (norm(label.textContent) === 'Thực chi (VND)') {
      let input = null;
      let ancestor = label.parentElement;
      for (let hop = 0; hop < 4 && ancestor && !input; hop++) {
        input = ancestor.querySelector('input[type="number"]');
        ancestor = ancestor.parentElement;
      }
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, '500000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
  }
  return false;
});
log(`SET Thực chi -> ${amountSet}`);
await new Promise((r) => setTimeout(r, 400));

// ── 4. Bên thực chi = Nhà cung cấp → NCC autofill or manual fallback hint ──
const supplierAutofill = await page.evaluate(() => {
  const selects = [...document.querySelectorAll('[role="dialog"] select')];
  const payer = selects.find((s) => [...s.options].some((o) => o.label === 'Nhà cung cấp'));
  if (!payer) return { error: 'no payer select' };
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
  setter.call(payer, 'SUPPLIER');
  payer.dispatchEvent(new Event('change', { bubbles: true }));
  return { options: [...payer.options].map((o) => o.label) };
});
log(`PAYER SUPPLIER -> ${JSON.stringify(supplierAutofill).slice(0, 200)}`);
await new Promise((r) => setTimeout(r, 700));
results.supplierAutofill = await assertEval(page, 'supplier autofill state', () => {
  const text = document.querySelector('[role="dialog"]')?.innerText ?? '';
  const selects = [...document.querySelectorAll('[role="dialog"] select')];
  const supplierSel = selects.find((s) => [...s.options].some((o) => o.label === 'Chọn nhà cung cấp'));
  return {
    supplierValue: supplierSel ? supplierSel.selectedOptions[0]?.label ?? '' : null,
    fallbackHint: text.includes('Chưa có nhà xe trên tuyến này — chọn thủ công'),
  };
});
// Fallback path: if no carrier supplier matched, pick one manually (contract:
// "không có nhà xe ngoài thì để trống cho người chọn tay"). The supplier
// select is the LAST native select in the drawer (appears after SUPPLIER).
if (results.supplierAutofill && typeof results.supplierAutofill === 'object' && !results.supplierAutofill.supplierValue) {
  const manual = await page.evaluate(() => {
    const selects = [...document.querySelectorAll('[role="dialog"] select')];
    const supplierSel = selects[selects.length - 1];
    if (!supplierSel || supplierSel === selects[0]) return { ok: false, reason: 'no extra select' };
    const opt = [...supplierSel.options].find((o) => o.value !== '');
    if (!opt) return { ok: false, reason: 'no supplier options' };
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
    setter.call(supplierSel, opt.value);
    supplierSel.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, picked: opt.label };
  });
  log(`MANUAL supplier pick -> ${JSON.stringify(manual)}`);
  results.supplierManualPick = manual;
  await new Promise((r) => setTimeout(r, 500));
}
await shot(page, `${CARD}_03-supplier.png`);

// ── 5. Save → drawer stays open + status line + fields reset ──
await clickButtonByText(page, 'Lưu 1 khoản chi', { exact: true });
await new Promise((r) => setTimeout(r, 2500));
results.afterSave = await assertEval(page, 'after save state', () => {
  const dlg = document.querySelector('[role="dialog"]');
  if (!dlg) return { drawerOpen: false };
  const text = dlg.innerText;
  return {
    drawerOpen: true,
    statusLine: text.includes('Đã lưu khoản chi.'),
    nameCleared: !text.includes('QA-W1 phí tiền đường fixture'),
    dongButton: [...dlg.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Đóng'),
    error: dlg.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
  };
});
await shot(page, `${CARD}_04-after-save.png`);

// ── 6. Đóng ends the session; dialog shows the new row ──
await clickButtonByText(page, 'Đóng', { exact: true });
await new Promise((r) => Promise.race([setTimeout(r, 1500)]));
await shot(page, `${CARD}_05-after-close.png`);

// ── 7. Persisted proof: the shipment's sổ chi phí carries the QA-named row ──
const entries = await api({ user: 'hoapt', path: `/api/expense-accounting/entries?shipmentId=${results.targetTrip.shipmentId ?? 7}` });
const hits = JSON.stringify(entries.json ?? []).match(/QA-W1[^"]*/g) ?? [];
results.persistedQaW1Refs = hits.slice(0, 3);
results.persistedViaApi = hits.length > 0;

await finish(CARD, results);
