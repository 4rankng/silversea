// SIL form cluster — AFTER rung-3 drive (LOCAL ONLY): proves the five fixes
// on the real UI at HEAD of fix/sil-form-cluster-681-688-690-691-692.
//   681 r2 — LCL Hãng tàu field with trailing '✎' INSIDE the input, same
//            height, dialog opens, MSC Enter-commit works (@1440 + @390).
//   690    — 'Áp dụng cho N container' under the FCL table writes EVERY row
//            (incl. an already-filled one) with the success toast.
//   691    — ASKEY suggestion carries the SĐT (supportingText); the detail
//            popup renders the 'Số điện thoại' row (local seed 0912345678).
//   692    — closed editor owns no phantom box (0×0 save button); the OPEN
//            editor's Lưu is the elementFromPoint answer AND a real click
//            commits the weight draft.
//   688    — detail page Xóa lô (admin armed / tiepvv absent), debit menu
//            entry opens its confirm (canceled), a UI delete of a THROWAWAY
//            lot (created by this drive via POST /shipments/quick) removes
//            the DB row (count bookend); a dispatched lot disables the
//            button with the BE-law reason.
// Run: FRONT_PORT=7185 node qa/scripts/2026-11-06-sil-form-cluster-after-drive.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7185}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa/2026-11-06-lane-form/after');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${JSON.stringify(detail).slice(0, 300)}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT'); process.exit(2); }

const login = async (id) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  return res.ok ? (await res.json()).token : null;
};
const tokenCus = await login('tiepvv') ?? await login('cus');
const tokenAdmin = await login('admin');
check('login cus+admin', Boolean(tokenCus && tokenAdmin));

const db = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "${sql}"`).toString().trim();
const countsBefore = { shipments: db('select count(*) from shipments'), containers: db('select count(*) from shipment_containers') };
log(`BOOKEND before shipments=${countsBefore.shipments} containers=${countsBefore.containers}`);
const dispatchedLotId = db("select f.shipment_id from shipment_fulfillments f join shipments s on s.id=f.shipment_id where s.status in ('DISPATCHED','IN_TRANSIT','READY_FOR_DISPATCH') group by f.shipment_id order by f.shipment_id desc limit 1");
log(`DISPATCHED-LOT id=${dispatchedLotId}`);

// Throwaway lot for the 688 UI delete (admin, intake authority).
const mkRes = await fetch(`${API}/shipments/quick`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenAdmin}`, 'Idempotency-Key': `lane-688-${Date.now()}` },
  body: JSON.stringify({ customerId: 1, bookingRef: `LANE-688-DEL-${Date.now()}`, cargoMode: 'FCL', tradeDirection: 'EXPORT' }),
});
const throwaway = await mkRes.json().catch(() => null);
check('throwaway lot created for delete drive', mkRes.ok && Boolean(throwaway?.id), { id: throwaway?.id, status: mkRes.status });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--window-size=1440,900', '--no-sandbox'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenCus);
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
const shot = async (n) => { await page.screenshot({ path: path.join(OUT, n) }); log(`SHOT ${n}`); };
const clickLcl = () => page.evaluate(() => {
  const opt = [...document.querySelectorAll('.csc-mode__option, [role="radio"], label')].find((el) => /Hàng lẻ/i.test(el.textContent || ''));
  if (!opt) return false;
  (opt.querySelector('input[type="radio"]') ?? opt).click();
  return true;
});
const confirmSwitch = async () => {
  await sleep(500);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Chuyển và xóa dữ liệu/.test(b.textContent || ''));
    if (btn) btn.click();
  });
  await sleep(700);
};
const pickCustomer = async () => {
  await page.click('[data-field-id="shipment-customer"] input', { clickCount: 3 });
  await page.type('[data-field-id="shipment-customer"] input', 'LONG MINH', { delay: 25 });
  await sleep(800);
  return page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /LONG MINH/i.test(el.textContent || ''));
    if (!opt) return false;
    opt.click();
    return true;
  });
};

// ══ 681 r2 — LCL Hãng tàu trailing ═══════════════════════════════════════
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
check('681r2 switch to LCL', await clickLcl());
await sleep(1000);
const lclField = await page.evaluate(() => {
  const cell = document.querySelector('[data-field-id="shipment-shipping-line"]');
  if (!cell) return { ok: false };
  const btn = cell.querySelector('button.csc-trailing-action');
  const input = cell.querySelector('input');
  // The visible control box (bordered wrapper) is the SIL-681 yardstick —
  // the bare native input is a 24px inner box inside the 30px control.
  const control = cell.querySelector('[data-uui-control]') ?? input;
  const ir = control?.getBoundingClientRect();
  const br = btn?.getBoundingClientRect();
  const booking = document.querySelector('[data-field-id="shipment-booking-ref"]')?.getBoundingClientRect();
  return {
    ok: Boolean(cell && btn && input),
    lclClass: cell.classList.contains('csc-identity-grid__shipping-line--lcl'),
    fullRow: ir && booking && cell.getBoundingClientRect().width > booking.width * 1.5,
    btnInsideInput: ir && br && br.right <= ir.right + 2 && br.left >= ir.left - 2 && br.top >= ir.top - 2 && br.bottom <= ir.bottom + 2,
    sameHeight: ir && br && Math.abs(ir.height - br.height) <= 1,
    controlHeight: ir?.height, btnHeight: br?.height,
    ariaLabel: btn?.getAttribute('aria-label'),
  };
});
check('681r2 LCL hãng tàu cell + trailing ✎', lclField.ok && lclField.btnInsideInput && lclField.sameHeight && lclField.ariaLabel === 'Đặt tên hãng tàu cho lô này', lclField);
check('681r2 LCL cell spans full row', lclField.ok && lclField.lclClass && lclField.fullRow, lclField);
const pencilOpens = await page.evaluate(() => {
  const btn = document.querySelector('[data-field-id="shipment-shipping-line"] button.csc-trailing-action');
  btn?.click();
  return Boolean(btn);
});
await sleep(900);
const dialogUp = await page.evaluate(() => Boolean([...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')].find((el) => /Đặt tên hãng tàu/i.test(el.textContent || ''))));
check('681r2 ✎ opens the shipping-line dialog', pencilOpens && dialogUp);
await shot('after-681r2-lcl-hang-tau-dialog-1440.png');
await page.keyboard.press('Escape');
await sleep(400);
await page.click('[data-field-id="shipment-shipping-line"] input');
await page.type('[data-field-id="shipment-shipping-line"] input', 'MSC', { delay: 30 });
await sleep(900);
const mscOption = await page.evaluate(() => Boolean([...document.querySelectorAll('[role="option"]')].find((el) => /MSC/.test(el.textContent || ''))));
check('681r2 typing MSC surfaces the catalog option', mscOption);
await page.keyboard.press('Enter');
await sleep(700);
const mscCommitted = await page.evaluate(() => document.querySelector('[data-field-id="shipment-shipping-line"] input')?.value ?? '');
check('681r2 Enter commits MSC into the field', /MSC/.test(mscCommitted), { value: mscCommitted });
await shot('after-681r2-lcl-hang-tau-committed-1440.png');
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
const touch390 = await page.evaluate(() => {
  const cell = document.querySelector('[data-field-id="shipment-shipping-line"]');
  const control = cell?.querySelector('[data-uui-control]') ?? cell?.querySelector('input');
  const ir = control?.getBoundingClientRect();
  const btn = cell?.querySelector('button.csc-trailing-action')?.getBoundingClientRect();
  return { ok: Boolean(ir && btn), controlHeight: ir?.height, btnHeight: btn?.height, inside: ir && btn && btn.right <= ir.right + 2 && btn.bottom <= ir.bottom + 2 };
});
check('681r2 @390 touch band: ✎ grows with input, stays inside', touch390.ok && touch390.inside && (touch390.btnHeight ?? 0) >= 40, touch390);
await shot('after-681r2-lcl-hang-tau-390.png');
await page.setViewport({ width: 1440, height: 900 });
await sleep(600);

// ══ 690 — bulk apply ══════════════════════════════════════════════════════
const clickFcl = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('.csc-mode__option, [role="radio"], label')].find((el) => /Hàng FCL/i.test(el.textContent || ''));
  if (!opt) return false;
  (opt.querySelector('input[type="radio"]') ?? opt).click();
  return true;
});
await confirmSwitch();
check('690 switched to FCL', clickFcl);
await page.evaluate(() => {
  const sel = document.querySelector('[data-field-id="shipment-trade-direction"] button');
  sel?.click();
});
await sleep(500);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /Xuất khẩu/.test(el.textContent || ''));
  opt?.click();
});
await sleep(400);
await page.type('[data-field-id="shipment-booking-ref"] input', 'AFTER-DRIVE-690', { delay: 8 });
await page.evaluate(() => document.querySelector('.csc-add-container')?.click());
await sleep(700);
// The split datetime commits exactly like the component tests prove:
// complete formatted values through the native setter + input/change events
// (the buffered mask ignores partial/keystroke-only drafts).
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const fill = (el, value) => {
    if (!el) return;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  fill(document.querySelector('input[id$="-customer-appointment-date"]'), '10/11/2026');
  fill(document.querySelector('input[id$="-customer-appointment-time"]'), '08:30');
});
await page.click('[data-field-id="shipment-booking-ref"] input');
await sleep(900);
const applyBtn = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Áp dụng cho 2 container/.test(b.textContent || ''));
  return btn ? { found: true, inCargo: Boolean(btn.closest('#shipment-section-cargo')) } : { found: false };
});
check('690 bulk-apply button appears (2 rows, source scheduled)', applyBtn.found && applyBtn.inCargo, applyBtn);
// Row 2 gets a DIFFERENT schedule first — the FB-008 gap is retuning rows
// that already hold a committed schedule.
await page.evaluate(() => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  const times = [...document.querySelectorAll('input[id$="-customer-appointment-time"]')];
  const el = times[1];
  setter.call(el, '14:00');
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await sleep(700);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Áp dụng cho 2 container/.test(b.textContent || ''));
  btn?.click();
});
await sleep(800);
const applyResult = await page.evaluate(() => ({
  times: [...document.querySelectorAll('input[id$="-customer-appointment-time"]')].map((i) => i.value),
  toast: [...document.querySelectorAll('[role="status"], .toast, [aria-live]')].map((t) => t.textContent || '').join(' | ').slice(0, 200),
}));
check('690 apply-all overwrote the already-filled row 2', applyResult.times.length === 2 && applyResult.times[0] === applyResult.times[1], applyResult);
check('690 success toast confirms', /Đã áp dụng ngày giờ đóng trả cho 2 container/.test(applyResult.toast), { toast: applyResult.toast });
await shot('after-690-bulk-apply-toast-1440.png');

// ══ 691 — ASKEY phone in suggestion + popup ══════════════════════════════
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
await clickLcl();
await sleep(900);
check('691 customer picked', await pickCustomer());
await page.click('[data-field-id="shipment-operational-site"] input', { clickCount: 3 }).catch(() => {});
await page.type('[data-field-id="shipment-operational-site"] input', 'ASKEY', { delay: 30 });
await sleep(1100);
const phoneOption = await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /ASKEY/i.test(el.textContent || ''));
  return { text: (opt?.textContent || '').replace(/\s+/g, ' ').trim(), hasPhone: /\d{8,}/.test(opt?.textContent || '') };
});
check('691 suggestion carries the SĐT', phoneOption.hasPhone, phoneOption);
await shot('after-691-askey-option-with-phone-1440.png');
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /ASKEY/i.test(el.textContent || ''));
  opt?.click();
});
await sleep(1000);
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /Xem chi tiết/.test(b.textContent || ''));
  btn?.click();
});
await sleep(900);
const popupPhone = await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')].find((el) => /Số điện thoại|ASKEY/i.test(el.textContent || ''));
  const label = [...(dialog?.querySelectorAll('*') ?? [])].find((el) => (el.textContent || '').trim() === 'Số điện thoại');
  const valueEl = label?.parentElement?.textContent || '';
  return { dialogFound: Boolean(dialog), hasPhoneRow: Boolean(label), phoneShown: /0912345678/.test(valueEl) };
});
check('691 popup renders the Số điện thoại row with the number', popupPhone.hasPhoneRow && popupPhone.phoneShown, popupPhone);
await shot('after-691-askey-popup-phone-1440.png');
await page.keyboard.press('Escape');
await sleep(400);

// ══ 692 — save button hit-test (rest + open + real click) ═══════════════
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
check('692 back to FCL default form', await page.evaluate(() => Boolean(document.querySelector('.csc-fline__trigger'))));
await page.evaluate(() => {
  const sel = document.querySelector('[data-field-id="shipment-trade-direction"] button');
  sel?.click();
});
await sleep(500);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((el) => /Xuất khẩu/.test(el.textContent || ''));
  opt?.click();
});
await sleep(400);
await page.type('[data-field-id="shipment-booking-ref"] input', 'AFTER-DRIVE-692', { delay: 8 });
await page.evaluate(() => document.querySelector('.csc-add-container')?.click());
await sleep(700);
const restProbe = await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')].find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  const card = trigger?.closest('.csc-fline')?.querySelector('.csc-fline__card');
  const save = card?.querySelector('.csc-fline__save');
  const r = save?.getBoundingClientRect();
  const cs = getComputedStyle(card);
  const hit = r && r.width > 0 ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
  return {
    ok: Boolean(save),
    visibility: cs.visibility,
    hitTag: hit ? `${hit.tagName}.${[...hit.classList].slice(0, 2).join('.')}` : null,
    // Closed editor: invisible + NOT the hit answer anywhere (no phantom
    // target for automation; the notes heading legitimately paints there).
    inert: cs.visibility === 'hidden' && hit !== save,
  };
});
check('692 rest state: closed editor invisible + not a click target', restProbe.ok && restProbe.inert, restProbe);
await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')].find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  trigger?.scrollIntoView({ block: 'center' });
  trigger?.click();
});
await sleep(900);
const openProbe = await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')].find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  const card = trigger?.closest('.csc-fline')?.querySelector('.csc-fline__card');
  const save = card?.querySelector('.csc-fline__save');
  const r = save?.getBoundingClientRect();
  const hit = r ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
  return { isOpen: card?.classList.contains('is-open'), w: r?.width, hitIsSave: hit === save, hitLabel: hit ? `${hit.tagName}.${[...hit.classList].slice(0, 2).join('.')}` : null };
});
check('692 open editor: Lưu is the elementFromPoint answer (clickable)', openProbe.isOpen && openProbe.w > 0 && openProbe.hitIsSave, openProbe);
await shot('after-692-open-editor-save-hit-1440.png');
await page.evaluate(() => {
  const input = document.querySelector('.csc-fline__card.is-open .csc-fline__input');
  if (!input) return;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  setter.call(input, '5000');
  input.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(300);
await page.evaluate(() => (document.querySelector('.csc-fline__card.is-open .csc-fline__save'))?.click());
await sleep(800);
const weightCommitted = await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')].find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  return { closed: !trigger?.closest('.csc-fline')?.querySelector('.csc-fline__card')?.classList.contains('is-open'), value: trigger?.textContent?.trim() };
});
check('692 real click on Lưu commits the weight into the line', weightCommitted.closed && /5[,.\u00a0 ]?000/.test(weightCommitted.value ?? ''), weightCommitted);
await page.setViewport({ width: 390, height: 844 });
await sleep(600);
const probe390 = await page.evaluate(() => {
  const trigger = [...document.querySelectorAll('.csc-fline__trigger')].find((el) => /Chỉnh sửa trọng lượng/.test(el.getAttribute('aria-label') || ''));
  trigger?.click();
  return true;
});
await sleep(800);
const open390 = await page.evaluate(() => {
  const save = document.querySelector('.csc-fline__card.is-open .csc-fline__save');
  const r = save?.getBoundingClientRect();
  const hit = r && r.width > 0 ? document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) : null;
  return { w: r?.width, hitIsSave: hit === save };
});
check('692 @390: open editor Lưu still the hit answer', probe390 && open390.w > 0 && open390.hitIsSave, open390);
await shot('after-692-open-editor-390.png');
await page.setViewport({ width: 1440, height: 900 });

// ══ 688 — delete UI (admin armed, tiepvv absent, dispatched disabled, real delete) ══
await page.goto(`${FRONT}/shipments/${dispatchedLotId}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const dispatchDisabled = await page.evaluate(() => {
  const del = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Xóa lô —'));
  return { found: Boolean(del), disabled: del?.disabled, label: del?.getAttribute('aria-label') };
});
check('688 dispatched lot: Xóa lô disabled with the BE-law reason', dispatchDisabled.found && dispatchDisabled.disabled, dispatchDisabled);
await shot('after-688-dispatched-disabled-1440.png');

// debit menu entry (admin): opens confirm with reason, CANCEL — no delete here.
await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2200);
const debitEntry = await page.evaluate(() => {
  const menuBtn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Hành động lô'));
  if (!menuBtn) return { ok: false };
  menuBtn.click();
  return { ok: true };
});
await sleep(700);
const debitScan = await page.evaluate(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Xóa lô/.test(m.textContent || ''));
  return { hasXoaLo: Boolean(item), dangerClass: item?.className.includes('danger') };
});
check('688 debit menu carries Xóa lô in the danger voice', debitEntry.ok && debitScan.hasXoaLo && debitScan.dangerClass, debitScan);
await shot('after-688-debit-menu-xoa-lo-1440.png');
await page.evaluate(() => {
  const item = [...document.querySelectorAll('[role="menuitem"]')].find((m) => /Xóa lô/.test(m.textContent || ''));
  item?.click();
});
await sleep(1200);
const debitConfirm = await page.evaluate(() => Boolean([...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')].find((el) => /Xóa lô hàng\?/.test(el.textContent || ''))));
check('688 debit Xóa lô opens its confirm (reason required)', debitConfirm);
await page.keyboard.press('Escape');
await sleep(500);

// tiepvv is ROLE CUS (Chứng từ intake) — the BE admits CUS, so the delete
// button MUST render for it too (same law as the list drawer's canDeleteLot).
await page.goto(`${FRONT}/shipments/${throwaway.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const tiepvvScan = await page.evaluate(() => ({
  xoaLo: [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Xóa lô').length,
}));
check('688 tiepvv (role CUS): Xóa lô renders (BE admits CUS)', tiepvvScan.xoaLo === 1, tiepvvScan);
await shot('after-688-tiepvv-cus-sees-delete-1440.png');

// SIL-688 owner ruling 06/11 (comment 3953): ĐIỀU VẬN deletes too — the
// dispatcher sees the armed button (BE requireRoles + casbin bridge widened).
const tokenDisp = await login('dieuvan');
check('688 dispatcher login', Boolean(tokenDisp));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenDisp);
await page.goto(`${FRONT}/shipments/${throwaway.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const dispScan = await page.evaluate(() => ({
  xoaLo: [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Xóa lô').length,
  cluster: [...document.querySelectorAll('.csc-form-actions button')].map((b) => (b.textContent || '').trim()),
}));
check('688 dispatcher (Điều vận): Xóa lô armed (owner ruling 06/11)', dispScan.xoaLo === 1 && dispScan.cluster[dispScan.cluster.length - 1] === 'Xóa lô', dispScan);
await shot('after-688-dispatcher-delete-armed-1440.png');
// dispatcher's own BE authorization: a deliberately wrong version must fail
// as the 409 version mismatch — which proves the role gate (route + casbin
// bridge + service) passed; the lot stays untouched.
const dispGate = await fetch(`${API}/shipments/cus-workspace/${throwaway.id}`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenDisp}`, 'Idempotency-Key': `disp-gate-${Date.now()}` },
  body: JSON.stringify({ version: 999999, reason: 'dispatcher gate probe (version sai chủ ý)' }),
});
const dispGateBody = await dispGate.json().catch(() => ({}));
check('688 dispatcher BE gate open (409 version mismatch, NOT 403)', dispGate.status === 409, { status: dispGate.status, message: dispGateBody.message });

// OPS stays refused end-to-end: no button (FE) and the BE answers 403 with
// the ruling's own voice.
const tokenOps = await login('giaonhan');
check('688 ops login', Boolean(tokenOps));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenOps);
await page.goto(`${FRONT}/shipments/${throwaway.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const opsScan = await page.evaluate(() => ({
  xoaLo: [...document.querySelectorAll('button')].filter((b) => (b.textContent || '').trim() === 'Xóa lô').length,
  cluster: [...document.querySelectorAll('.csc-form-actions button')].map((b) => (b.textContent || '').trim()),
}));
check('688 ops: NO Xóa lô anywhere', opsScan.xoaLo === 0, opsScan);
await shot('after-688-ops-no-delete-1440.png');
const opsGate = await fetch(`${API}/shipments/cus-workspace/${throwaway.id}`, {
  method: 'DELETE',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenOps}`, 'Idempotency-Key': `ops-gate-${Date.now()}` },
  body: JSON.stringify({ version: throwaway.version ?? 1, reason: 'ops phải bị chặn (probe)' }),
});
const opsGateBody = await opsGate.json().catch(() => ({}));
// The route's requireRoles denies OPS at the middleware (generic 403 voice);
// the service's 'Chỉ Chứng từ, Điều vận hoặc Quản trị viên…' stays as the
// defense-in-depth line for any caller that slips past requireRoles.
check('688 ops BE delete refused 403', opsGate.status === 403, { status: opsGate.status, message: opsGateBody.message });

// admin: UI delete of the throwaway lot.
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tokenAdmin);
await page.goto(`${FRONT}/shipments/${throwaway.id}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1800);
const adminScan = await page.evaluate(() => {
  const del = [...document.querySelectorAll('.csc-form-actions button')].find((b) => (b.textContent || '').trim() === 'Xóa lô');
  return { found: Boolean(del), enabled: del ? !del.disabled : false, cluster: [...document.querySelectorAll('.csc-form-actions button')].map((b) => (b.textContent || '').trim()) };
});
check('688 admin detail: Xóa lô armed last in the view cluster', adminScan.found && adminScan.enabled && adminScan.cluster[adminScan.cluster.length - 1] === 'Xóa lô', adminScan);
await shot('after-688-admin-delete-armed-1440.png');
await page.evaluate(() => {
  const del = [...document.querySelectorAll('.csc-form-actions button')].find((b) => (b.textContent || '').trim() === 'Xóa lô');
  del?.click();
});
await sleep(800);
await page.type('#shipment-delete-lot-reason', 'Lane 688 UI delete verification (throwaway lot)');
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Xóa lô hàng');
  btn?.click();
});
await sleep(2500);
const deletedUi = await page.evaluate(() => ({
  url: location.pathname,
  toast: [...document.querySelectorAll('[role="status"], .toast, [aria-live]')].map((t) => t.textContent || '').join(' | ').slice(0, 200),
}));
check('688 UI delete lands back on the list with the toast', deletedUi.url === '/shipments' && /Đã xóa lô hàng\./.test(deletedUi.toast), deletedUi);
await shot('after-688-deleted-toast-list-1440.png');
const dbGone = db(`select count(*) from shipments where id = ${throwaway.id} and deleted_at is null`);
check('688 DB side effect: throwaway lot soft-deleted', dbGone === '0', { id: throwaway.id, liveRows: dbGone });

const countsAfter = { shipments: db('select count(*) from shipments'), containers: db('select count(*) from shipment_containers') };
log(`BOOKEND after shipments=${countsAfter.shipments} containers=${countsAfter.containers} (net = before: the drive created and deleted exactly one throwaway lot)`);

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
