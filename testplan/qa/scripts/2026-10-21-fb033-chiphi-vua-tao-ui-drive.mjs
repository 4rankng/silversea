// FB-033 (card 211026014819) — chi phí VỪA TẠO bị khóa sửa/xóa — UI drive.
// Path: opsqa login → /ops/orders (date=2026-10-20) → "Khai chi phí" → save →
// /ops/wallet → Sửa (edit) the just-created row → Xóa (delete) it.
// LOCAL ONLY: vite 7177 → api 3303 (this lane's stack; :7175/:3002 belong to other tasks).
//   node testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = process.env.API ?? 'http://localhost:3002/api';
const OUT = 'qa/2026-10-21_fb033-chiphi-khoa';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log('[drive]', ...a);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'opsqa', password: 'Abc123' }),
}).then(r => r.json());
if (!login?.token) throw new Error('login opsqa failed: ' + JSON.stringify(login).slice(0, 200));
log('login ok, role=' + login.user?.role + ' id=' + login.user?.id);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const errors = [];
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

const shot = (name) => page.screenshot({ path: `${OUT}/ui-${name}.png` });
const text = () => page.evaluate(() => document.body.innerText);

// ── 1. /ops/orders, set date to 2026-10-20, open Khai chi phí on SHP-2610-18937
await page.goto(`${BASE}/ops/orders`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(3000);
// The date control is a SPLIT DD / MM / YYYY input with a buffered draft —
// drive the segments with REAL key events (the draft emits on segment entry).
const ddHandle = await page.$('input[placeholder="DD"]');
if (!ddHandle) throw new Error('DD segment not found');
await ddHandle.click({ clickCount: 3 });
await page.keyboard.type('20', { delay: 60 });
await sleep(600);
const mmHandle = await page.$('input[placeholder="MM"]');
if (mmHandle) { await mmHandle.click({ clickCount: 3 }); await page.keyboard.type('10', { delay: 60 }); }
const yyHandle = await page.$('input[placeholder="YYYY"]');
if (yyHandle) { await yyHandle.click({ clickCount: 3 }); await page.keyboard.type('2026', { delay: 60 }); }
await page.keyboard.press('Escape');
log('segments typed 20/10/2026');
await sleep(3000);
let bodyText = await text();
const TARGET_REF = process.env.FB033_REF ?? 'FB105-276FD0-EXP';
log('orders date=2026-10-20 rows visible:', bodyText.includes(TARGET_REF));
const khaiClicked = await page.evaluate((ref) => {
  const row = [...document.querySelectorAll('tr, article, li, section')].find(el => el.textContent?.includes(ref) && el.querySelector('button'));
  if (!row) return false;
  const btn = [...row.querySelectorAll('button')].find(b => /khai chi phí/i.test(b.textContent || ''));
  if (!btn) return false;
  btn.click();
  return true;
}, TARGET_REF);
if (!khaiClicked) throw new Error('Khai chi phí button not found on the ' + TARGET_REF + ' row');
await sleep(1500);
bodyText = await text();
log('modal open:', /Khai báo chi phí/.test(bodyText));
await shot('1-orders-dialog-open');
// ── 2. Fill the no-invoice fee row: type, amount, fee name, note
// The Loại phí control renders as a role=combobox INPUT (type-to-search).
// Pick a REAL active no-invoice type from the catalog — an invented name only
// leaves the listbox at "Không tìm thấy kết quả" and never commits.
const catalog = await fetch(`${API}/ops/expense-types`, { headers: { Authorization: `Bearer ${login.token}` } }).then(r => r.json());
const noInvoiceType = (catalog.items ?? []).find(t => t.requiresInvoice !== true);
if (!noInvoiceType) throw new Error('no no-invoice expense type in catalog');
log('using type:', noInvoiceType.code, '/', noInvoiceType.name);
const picked = await page.evaluate(() => {
  const block = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Phí không hóa đơn');
  if (!block) return { ok: false, why: 'no-invoice block not found' };
  const rowEl = block.querySelector('[aria-label^="Khoản"]') ?? block;
  const combo = rowEl.querySelector('input[role="combobox"]') ?? rowEl.querySelector('[role="combobox"]');
  if (!combo) return { ok: false, why: 'combobox input not found' };
  combo.focus();
  return { ok: true };
});
if (!picked.ok) throw new Error('fee-row combobox: ' + picked.why);
await sleep(500);
await page.keyboard.type(noInvoiceType.name, { delay: 30 });
await sleep(1100);
let optPicked = await page.evaluate((label) => {
  const opts = [...document.querySelectorAll('[role="option"]')].filter(o => o.getAttribute('aria-disabled') !== 'true');
  const hit = opts.find(o => (o.textContent || '').includes(label));
  if (!hit) return false;
  hit.click();
  return true;
}, noInvoiceType.name);
if (!optPicked) {
  optPicked = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('[role="option"]')].filter(o => o.getAttribute('aria-disabled') !== 'true');
    if (!opts.length) return false;
    opts[0].click();
    return true;
  });
  log('WARN: exact option not found; picked first available option =', optPicked);
}
await sleep(800);
// Verify the commit: the row's "Chọn loại phí." error must be gone.
const typeCommitted = await page.evaluate(() => {
  const block = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Phí không hóa đơn');
  return !/Chọn loại phí\./.test(block?.textContent || '');
});
log('type committed (no "Chọn loại phí." error):', typeCommitted);
if (!typeCommitted) throw new Error('expense type did not commit in the draft row');
await sleep(600);
const filled = await page.evaluate(() => {
  const block = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Phí không hóa đơn');
  const rowEl = block.querySelector('[aria-label^="Khoản"]') ?? block;
  const set = (el, value) => {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const num = rowEl.querySelector('input[placeholder="0"]');
  const name = [...rowEl.querySelectorAll('input')].find(i => /Tên khoản chi/i.test(i.closest('label')?.textContent || ''));
  const note = [...rowEl.querySelectorAll('textarea')].find(t => /Ghi chú/i.test(t.closest('label')?.textContent || ''));
  if (!num) return { ok: false, why: 'amount input not found' };
  set(num, '15000');
  if (name) set(name, 'FB033-UI');
  if (note) set(note, 'FB-033 UI repro — vừa tạo kiểm tra Sửa/Xóa');
  return { ok: true };
});
if (!filled.ok) throw new Error('fill row: ' + filled.why);
await sleep(400);
await shot('2-dialog-filled');
const saveClicked = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button[type="submit"]')].find(b => /Lưu/.test(b.textContent || ''));
  if (!btn || btn.disabled) return false;
  btn.click();
  return true;
});
log('save clicked:', saveClicked);
await sleep(3000);
// The duplicate-cont head-up (card 141026230720) may intercept the first save:
// confirm it once ("Tiếp tục lưu" = duplicateConfirmed) and wait for the save.
const dupConfirmed = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /Tiếp tục lưu/.test(b.textContent || ''));
  if (!btn) return false;
  btn.click();
  return true;
});
if (dupConfirmed) { log('duplicate head-up confirmed (Tiếp tục lưu)'); await sleep(3500); }
bodyText = await text();
log('after save — toast "Đã ghi nhận khoản chi":', /Đã ghi nhận khoản chi/.test(bodyText), '| modal still open:', /Khai báo chi phí/.test(bodyText));
await shot('3-after-save');
if (/Khai báo chi phí/.test(bodyText)) {
  // capture the modal's own error text before aborting
  const modalText = await page.evaluate(() => document.querySelector('[class*="ops-modal"]')?.innerText?.slice(0, 600) ?? '');
  log('MODAL TEXT AFTER SAVE ATTEMPT:', JSON.stringify(modalText));
}

// ── 3. /ops/wallet — find the fresh row IN THE HISTORY SECTION, assert Sửa/Xóa
await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => /Lịch sử chi phí/.test(document.body.innerText), { timeout: 30000 });
// Scope every row lookup to the history section — the Sổ quỹ table above it
// also renders a tr per cash event and once carried the same fee text.
await page.waitForFunction(() => {
  const section = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Lịch sử chi phí');
  return !!section && [...section.querySelectorAll('tr')].some(el => /FB033-UI/.test(el.textContent || ''));
}, { timeout: 25000 }).catch(() => log('WARN: FB033-UI row not present in history within 25s'));
await sleep(1200);
const freshFound = await page.evaluate(() => {
  const section = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Lịch sử chi phí');
  const row = [...(section?.querySelectorAll('tr') ?? [])].find(el => /FB033-UI/.test(el.textContent || ''));
  if (!row) return { found: false };
  const edit = [...row.querySelectorAll('button')].find(b => /^Sửa khoản chi/.test(b.getAttribute('aria-label') || ''));
  const del = [...row.querySelectorAll('button')].find(b => /^Xóa khoản chi/.test(b.getAttribute('aria-label') || ''));
  const lockText = row.querySelector('.ops-row-lock')?.textContent ?? null;
  return { found: true, hasEdit: !!edit, editDisabled: edit ? edit.disabled : null, hasDelete: !!del, deleteDisabled: del ? del.disabled : null, lockText, rowText: row.innerText.replace(/\s+/g, ' ').slice(0, 300) };
});
log('WALLET fresh row:', JSON.stringify(freshFound));
await shot('4-wallet-fresh-row');
if (!freshFound.found) throw new Error('fresh FB033-UI row not found in wallet list');
if (!freshFound.hasEdit || !freshFound.hasDelete) throw new Error('Sửa/Xóa buttons missing on the just-created row: ' + JSON.stringify(freshFound));

// click Sửa
await page.evaluate(() => {
  const section = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Lịch sử chi phí');
  const row = [...(section?.querySelectorAll('tr') ?? [])].find(el => /FB033-UI/.test(el.textContent || ''));
  const edit = [...row.querySelectorAll('button')].find(b => /^Sửa khoản chi/.test(b.getAttribute('aria-label') || ''));
  edit.click();
});
await sleep(1800);
bodyText = await text();
log('edit dialog open:', /Sửa khoản chi ·/.test(bodyText));
await shot('5-edit-dialog-open');
const editFilled = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('[role="dialog"], form')].find(el => /Sửa khoản chi ·/.test(el.textContent || ''));
  if (!dlg) return false;
  const ta = [...dlg.querySelectorAll('textarea')].find(t => /Lý do điều chỉnh/i.test(t.closest('label')?.textContent || ''));
  if (!ta) return false;
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'FB-033 UI drive — sửa khoản vừa tạo');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
});
log('edit reason filled:', editFilled);
await shot('6-edit-dialog-filled');
const editSaved = await page.evaluate(() => {
  const dlg = [...document.querySelectorAll('form')].find(el => /Sửa khoản chi ·/.test(el.textContent || ''));
  const btn = [...(dlg?.querySelectorAll('button[type="submit"]') ?? [])].find(b => /Lưu/.test(b.textContent || '') && !b.disabled);
  if (!btn) return false;
  btn.click();
  return true;
});
log('edit Lưu clicked:', editSaved);
await sleep(3500);
bodyText = await text();
log('after edit — toast "Đã cập nhật khoản chi":', /Đã cập nhật khoản chi/.test(bodyText), '| dialog still open:', /Sửa khoản chi ·/.test(bodyText));
await shot('7-after-edit-save');

// ── 4. delete the same row (Xóa → reason prompt → confirm)
await page.evaluate(() => {
  const section = [...document.querySelectorAll('section')].find(el => el.getAttribute('aria-label') === 'Lịch sử chi phí');
  const row = [...(section?.querySelectorAll('tr') ?? [])].find(el => /FB033-UI/.test(el.textContent || ''));
  if (!row) throw new Error('row gone before delete');
  const del = [...row.querySelectorAll('button')].find(b => /^Xóa khoản chi/.test(b.getAttribute('aria-label') || ''));
  del.click();
});
await sleep(1200);
bodyText = await text();
log('delete reason prompt open:', /Nhập lý do/.test(bodyText) || /Lý do xóa/.test(bodyText));
await shot('8-delete-prompt');
await page.evaluate(() => {
  const dlg = document.querySelector('[aria-label="Nhập lý do"]');
  const ta = dlg?.querySelector('textarea');
  if (!ta) throw new Error('reason textarea not found');
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, 'FB-033 UI drive cleanup');
  ta.dispatchEvent(new Event('input', { bubbles: true }));
});
await sleep(400);
await page.evaluate(() => {
  const dlg = document.querySelector('[aria-label="Nhập lý do"]');
  const btn = [...dlg.querySelectorAll('button')].find(b => /Xóa|Xác nhận/.test(b.textContent || '') && !b.disabled);
  if (!btn) throw new Error('confirm button not found/disabled');
  btn.click();
});
await sleep(3500);
bodyText = await text();
log('after delete — FB033-UI row still in list:', /FB033-UI/.test(bodyText), '| toast "Đã hủy":', /Đã hủy/.test(bodyText));
await shot('9-after-delete');

console.log('\n=== DRIVER SUMMARY ===');
console.log(JSON.stringify({ freshFound, errors: errors.slice(0, 10) }, null, 1));
await browser.close();
console.log('EXIT 0');
