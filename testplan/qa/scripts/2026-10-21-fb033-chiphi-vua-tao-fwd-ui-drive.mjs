// FB-033 (card 211026014819) — UI drive of the FIX on the forwarder portal:
// create a chi-hộ expense (OPS with a funded advance) → the just-created row's
// Sửa/Xóa buttons must be ENABLED (no "Khoản chi đã gửi kế toán") → edit via
// the UI dialog → delete via the UI prompt. LOCAL: vite 7177 → api 3303.
//   node testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-fwd-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7177';
const API = process.env.API ?? 'http://localhost:3303/api';
const TRIP_ID = Number(process.env.TRIP_ID ?? 193772);
const OUT = 'qa/2026-10-21_fb033-chiphi-khoa';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[drive]', ...a);

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'opsqa', password: 'Abc123' }) }).then(r => r.json());
if (!login?.token) throw new Error('login opsqa failed');
log('login ok, role=' + login.user?.role);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);
const shot = (name) => page.screenshot({ path: `${OUT}/fwd-ui-${name}.png` });
const text = () => page.evaluate(() => document.body.innerText);

await page.goto(`${BASE}/my-forwarder-trips/${TRIP_ID}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => /Chi phí|Khoản|kê/i.test(document.body.innerText), { timeout: 30000 });
await sleep(3000);

// open the general expense form (the "＋ Thêm" button in the expenses header)
const opened = await page.evaluate(() => {
  const header = document.querySelector('.fwd-expenses-header');
  const btn = [...(header?.querySelectorAll('button') ?? [])].find(b => /Thêm/.test(b.textContent || ''));
  if (!btn) return false;
  btn.click();
  return true;
});
log('expense form opened:', opened);
await sleep(1200);
// the type defaults to the first catalog entry; pick the OTHER-style generic
// type explicitly via the combobox, then fill amounts + payee
const typed = await page.evaluate(() => {
  const combo = document.querySelector('#fwd-expense-type') ?? document.querySelector('.fwd-expense-form input[role="combobox"]');
  if (!combo) return { via: 'none' };
  combo.focus();
  return { via: 'combo' };
});
log('type picker:', JSON.stringify(typed));
if (typed.via === 'combo') {
  await sleep(900);
  await page.keyboard.type('Phí chi hộ khác', { delay: 30 });
  await sleep(1100);
  // React Aria commits the highlighted option on Enter; ArrowDown highlights it.
  await page.keyboard.press('ArrowDown');
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(800);
  // The committed value closes the listbox and the input shows the label only.
  const committed = await page.evaluate(() => {
    const combo = document.querySelector('#fwd-expense-type') ?? document.querySelector('.fwd-expense-form input[role="combobox"]');
    const open = !!document.querySelector('[role="listbox"]');
    return { value: combo?.value, listboxOpen: open };
  });
  log('type committed:', JSON.stringify(committed));
}
const amountSet = await page.evaluate(() => {
  const num = [...document.querySelectorAll('.fwd-expense-form input[placeholder="0"]')][0];
  if (!num) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(num, '180000');
  num.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
log('amount set:', amountSet);
const payeeSet = await page.evaluate(() => {
  const input = document.querySelector('.fwd-expense-form input[placeholder="Tên người nhận / đơn vị nhận"]');
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'FB-033 verify UI');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
log('payee set:', payeeSet);
const noteSet = await page.evaluate(() => {
  const input = document.querySelector('.fwd-expense-form input[placeholder="Mô tả lý do chi và chứng từ bổ sung"]');
  if (!input) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'FB-033 UI drive — khoản chi hộ vừa tạo');
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
log('note set:', noteSet);
// Ngày chi — the split DD/MM/YYYY buffered date control: real key events.
const dayHandle = await page.$('.fwd-expense-form input[placeholder="DD"]');
let dateSet = false;
if (dayHandle) {
  await dayHandle.click({ clickCount: 3 });
  await page.keyboard.type(String(new Date().getDate()).padStart(2, '0'), { delay: 40 });
  const mm = await page.$('.fwd-expense-form input[placeholder="MM"]');
  if (mm) { await mm.click({ clickCount: 3 }); await page.keyboard.type(String(new Date().getMonth() + 1).padStart(2, '0'), { delay: 40 }); }
  const yy = await page.$('.fwd-expense-form input[placeholder="YYYY"]');
  if (yy) { await yy.click({ clickCount: 3 }); await page.keyboard.type(String(new Date().getFullYear()), { delay: 40 }); }
  dateSet = true;
} else {
  dateSet = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.fwd-expense-form input')].find(i => /Ngày chi/.test(i.closest('label, div')?.querySelector('label')?.textContent || ''));
    if (!input) return false;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, new Date().toISOString().slice(0, 10));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  });
}
log('date set:', dateSet);
// Chứng cứ thay thế — tick the first evidence checkbox.
const evidenceSet = await page.evaluate(() => {
  const box = document.querySelector('.fwd-expense-form .fwd-evidence-option input[type="checkbox"]');
  if (!box || box.checked) return !box ? false : true;
  box.click();
  return true;
});
log('evidence ticked:', evidenceSet);
await shot('1-form-filled');
const saved = await page.evaluate(() => {
  const form = document.querySelector('.fwd-expense-form');
  const btn = [...(form?.querySelectorAll('button') ?? [])].find(b => /Lưu chi phí|Lưu điều chỉnh/.test(b.textContent || '') && !b.disabled);
  if (!btn) return false;
  btn.click();
  return true;
});
log('save clicked:', saved);
await sleep(4000);
let bodyText = await text();
const saveError = await page.evaluate(() => document.querySelector('.fwd-expense-submit-error')?.textContent?.slice(0, 300) ?? null);
log('save error (if any):', JSON.stringify(saveError));
log('after save — FB033 verify row visible:', /FB-033 verify UI|180\.000/.test(bodyText));
await shot('2-after-save');
if (saveError) { console.log('ABORT: form refused to save:', saveError); await browser.close(); process.exit(1); }

// find the just-created row and assert Sửa/Xóa are ENABLED (the fix)
const actions = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div, li, tr')].find(el => /180\.000/.test(el.textContent || '') && el.querySelector('button'));
  if (!row) return { found: false };
  const edit = [...row.querySelectorAll('button')].find(b => /Điều chỉnh|Sửa/i.test(b.getAttribute('aria-label') || b.title || ''));
  const del = [...row.querySelectorAll('button')].find(b => /Xóa/i.test(b.getAttribute('aria-label') || b.title || ''));
  return {
    found: true,
    hasEdit: !!edit, editDisabled: edit ? edit.disabled : null,
    editTitle: edit ? (edit.title || edit.getAttribute('aria-label')) : null,
    hasDelete: !!del, deleteDisabled: del ? del.disabled : null,
    lockedBanner: /đã gửi kế toán/.test(row.textContent || ''),
  };
});
log('fresh row actions:', JSON.stringify(actions));
await shot('3-row-actions');
const failures = [];
const expect = (label, cond, detail) => { log(`${cond ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!cond) failures.push(label); };
expect('fresh row has Sửa button enabled', actions.found && actions.hasEdit && actions.editDisabled === false, JSON.stringify(actions));
expect('fresh row has Xóa button enabled', actions.found && actions.hasDelete && actions.deleteDisabled === false);
expect('fresh row carries no "đã gửi kế toán" lock', actions.found && !actions.lockedBanner);

// UI edit
if (actions.hasEdit && !actions.editDisabled) {
  await page.evaluate(() => {
    const row = [...document.querySelectorAll('div, li, tr')].find(el => /180\.000/.test(el.textContent || '') && el.querySelector('button'));
    const edit = [...row.querySelectorAll('button')].find(b => /Điều chỉnh|Sửa/i.test(b.getAttribute('aria-label') || b.title || ''));
    edit.click();
  });
  await sleep(1500);
  bodyText = await text();
  log('edit dialog open:', /Điều chỉnh chi phí|Sửa khoản/.test(bodyText));
  await shot('4-edit-dialog');
  await page.evaluate(() => {
    const num = [...document.querySelectorAll('.fwd-expense-form input[placeholder="0"]')][0];
    if (num) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(num, '190000');
      num.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(400);
  const savedEdit = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    const btn = [...(form?.querySelectorAll('button') ?? [])].find(b => /Lưu điều chỉnh|Lưu chi phí/.test(b.textContent || '') && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  log('edit save clicked:', savedEdit);
  await sleep(4000);
  bodyText = await text();
  expect('UI edit landed (190.000 visible)', /190\.000/.test(bodyText));
  await shot('5-after-edit');

  // UI delete
  const delClicked = await page.evaluate(() => {
    const row = [...document.querySelectorAll('div, li, tr')].find(el => /190\.000/.test(el.textContent || '') && el.querySelector('button'));
    if (!row) return false;
    const del = [...row.querySelectorAll('button')].find(b => /Xóa/i.test(b.getAttribute('aria-label') || b.title || '') && !b.disabled);
    if (!del) return false;
    del.click();
    return true;
  });
  log('delete clicked:', delClicked);
  await sleep(1200);
  await page.evaluate(() => {
    const dlg = document.querySelector('[aria-label="Nhập lý do"]');
    const ta = dlg?.querySelector('textarea');
    if (ta) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'FB-033 UI drive cleanup');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await sleep(400);
  await page.evaluate(() => {
    const dlg = document.querySelector('[aria-label="Nhập lý do"]');
    const btn = [...(dlg?.querySelectorAll('button') ?? [])].find(b => /Xóa|Xác nhận/.test(b.textContent || '') && !b.disabled);
    if (btn) btn.click();
  });
  await sleep(4000);
  bodyText = await text();
  log('after UI delete — 190.000 still listed:', /190\.000/.test(bodyText), '| "Lý do hủy" visible:', /Lý do hủy/.test(bodyText));
  expect('UI delete landed (row voided with reason shown)', !/190\.000(?!,)/.test(bodyText) || /Lý do hủy/.test(bodyText));
  await shot('6-after-delete');
}

console.log('\n=== RESULT ===');
if (failures.length) { console.log('FAILED:', failures); console.log('console errors:', errors.slice(0, 5)); process.exit(1); }
console.log('ALL PASS — just-created chi-hộ row editable + deletable in the UI');
