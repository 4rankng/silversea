// R29 re-verify (2026-10-21) — FB-033: a JUST-CREATED chi-hộ expense (OPS_ADVANCE,
// funded unconsumed tạm ứng) must stay Sửa/Xóa-enabled with NO "Đã lập phiếu"
// badge. Staging c643ef1e. Trip 104 (CREATED) is linked to hoangnh's shipment 257.
// Phase A (API): fund a fresh 50.000₫ advance for hoangnh (create PENDING →
//   ketoan approves = giải ngân) so the auto-offset path really fires on create.
// Phase B (UI, hoangnh): /my-forwarder-trips/104 → Thêm → chi hộ OTHER 50.000
//   OPS_ADVANCE → Lưu → assert row editable (no badge/disabled) → Sửa 45.000 →
//   Xóa (reason prompt) → voided.
// Usage: node testplan/qa/scripts/2026-10-21-r29-fb033-staging.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve('qa/2026-10-21-r29-verify/fb033');
fs.mkdirSync(OUT, { recursive: true });
const REASON_TAG = `R29 re-verify FB-033 ${new Date().toISOString().slice(0, 16)}`;
const EXPENSE_NOTE = `R29 FB-033 verify chi hộ ${new Date().toISOString().slice(11, 16).replace(':', '')}`;

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const apiCall = async (token, method, p, body, extraHeaders = {}) => {
  const res = await fetch(`${API}${p}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 300); }
  return { status: res.status, body: parsed };
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash });
if (health?.buildHash !== 'c643ef1e' && !process.env.QA_IGNORE_BUILD) { log('ABORT: build mismatch'); process.exit(2); }

// ── Phase A: fund a fresh advance for hoangnh ─────────────────────────────
const hoangnh = await login('hoangnh');
const ketoan = await login('ketoan');
// Reuse a PENDING request from a previous run of this lane (approve once).
const pendingList0 = await apiCall(hoangnh, 'GET', '/ops/wallet/advance-requests?status=PENDING&limit=50');
let mine = (pendingList0.body?.items ?? []).find((r) => (r.reason ?? '').startsWith('R29 re-verify FB-033')) ?? null;
let createdReq = mine;
if (!mine) {
  createdReq = await apiCall(hoangnh, 'POST', '/ops/wallet/advance-requests',
    { amount: '50000', reason: REASON_TAG }, { 'Idempotency-Key': crypto.randomUUID() });
  log('advance_request_created', { status: createdReq.status, body: createdReq.body });
  if (createdReq.status !== 200 && createdReq.status !== 201) { record('A: create advance request', false, JSON.stringify(createdReq.body).slice(0, 200)); process.exit(2); }
  mine = createdReq.body;
}
log('advance_request_located', { id: mine.id, version: mine.version, status: mine.status });
const approved = mine.status === 'RECORDED'
  ? { status: 'already-funded', body: { note: 'request already RECORDED from a previous attempt' } }
  : await apiCall(ketoan, 'POST', `/advance-requests/${mine.id}/approve`,
      { expectedVersion: Number(mine.version ?? 1) }, { 'Idempotency-Key': crypto.randomUUID() });
log('advance_approved', { status: approved.status, body: JSON.stringify(approved.body).slice(0, 220) });
record('FB-033 setup: 50.000₫ advance funded for hoangnh (ketoan approve = giải ngân)',
  approved.status === 200 || approved.status === 201 || approved.status === 'already-funded',
  `req=${mine.id} status=${approved.status} body=${JSON.stringify(approved.body).slice(0, 160)}`);

const walletAfter = await apiCall(hoangnh, 'GET', '/ops/wallet/summary');
log('wallet_after_fund', walletAfter.body);
fs.writeFileSync(path.join(OUT, 'setup-advance-funding.json'), JSON.stringify({ request: createdReq.body ?? createdReq, approve: approved.body, wallet: walletAfter.body }, null, 2));

// ── Phase B: UI drive as hoangnh ──────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const expensePosts = [];
  page.on('response', async (res) => {
    const m = res.request().method();
    if (/\/forwarder\/me\/expenses/.test(res.url()) && ['POST', 'PATCH', 'DELETE'].includes(m)) {
      let b = ''; try { b = (await res.text()).slice(0, 260); } catch { /* noop */ }
      expensePosts.push({ method: m, status: res.status(), body: b });
      log('expense_api', { method: m, status: res.status, body: b });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), hoangnh);
  await page.goto(`${BASE}/my-forwarder-trips/104`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const trips0 = await page.evaluate(() => ({
    url: location.pathname,
    heading: document.querySelector('h1, h2')?.textContent?.trim().slice(0, 80) ?? null,
    addBtn: Boolean(document.querySelector('.fwd-expenses-header__btn')),
    expenseCount: document.querySelectorAll('.fwd-expense-record').length,
  }));
  log('trip_open', trips0);
  await page.screenshot({ path: path.join(OUT, '01-trip-before.png'), fullPage: true });
  if (!trips0.addBtn) throw new Error('Thêm (expense) button not found');

  // open the expense form
  await page.click('.fwd-expenses-header__btn');
  await sleep(900);
  const formSet = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    if (!form) return { open: false };
    const groupInput = (labelText) => {
      const groups = Array.from(form.querySelectorAll('.form-group, [class*="FormGroup"], fieldset, div'));
      const g = groups.find((el) => Array.from(el.querySelectorAll(':scope > label, :scope > span')).some((l) => (l.textContent || '').trim().startsWith(labelText)));
      return g?.querySelector('input, select, textarea') ?? null;
    };
    const typeSel = form.querySelector('#fwd-expense-type');
    const settleSel = form.querySelector('#fwd-settlement-method');
    const amount = form.querySelector('input[type="number"]');
    return {
      open: true,
      typeTag: typeSel?.tagName ?? null, typeValue: typeSel?.value ?? null,
      settleValue: settleSel?.value ?? null, settleTag: settleSel?.tagName ?? null,
      amountValue: amount?.value ?? null,
    };
  });
  log('form_open', formSet);
  await page.screenshot({ path: path.join(OUT, '02-form-open.png'), fullPage: true });

  // pick expense type OTHER (Phí chi hộ khác) — #fwd-expense-type is a custom
  // combobox (INPUT trigger + portaled listbox), not a native select.
  const pickedType = await page.evaluate(() => {
    const trigger = document.querySelector('#fwd-expense-type');
    if (trigger instanceof HTMLElement) { trigger.click(); trigger.focus?.(); }
    return null;
  });
  await sleep(1000);
  const typeChoice = await page.evaluate(() => {
    const visible = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    let opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li, [role="listbox"] button')).filter(visible);
    if (!opts.length) opts = Array.from(document.querySelectorAll('.searchable-select__popover [role="option"], .searchable-select__popover button')).filter(visible);
    const opt = opts.find((el) => (el.textContent || '').includes('chi hộ khác'));
    if (opt instanceof HTMLElement) { opt.click(); return (opt.textContent || '').trim().slice(0, 40); }
    return null;
  });
  await sleep(500);
  log('type_picked', { pickedType, typeChoice });

  // settlement surface (default OPS_ADVANCE 'Chi hộ tạm ứng') — evidence only
  const settleText = await page.evaluate(() => {
    const btn = document.querySelector('#fwd-settlement-method');
    return btn?.textContent?.trim() ?? btn?.value ?? null;
  });
  log('settlement', { settleText });

  // amount 50000
  await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    const amount = form?.querySelector('input[type="number"]');
    if (amount instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(amount, '50000');
      amount.dispatchEvent(new Event('input', { bubbles: true }));
      amount.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });
  await sleep(300);
  const amountCheck = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    const amount = form?.querySelector('input[type="number"]');
    const typeTrigger = document.querySelector('#fwd-expense-type');
    const errors = Array.from(form?.querySelectorAll('.fwd-field-error-inline, [class*="error"]') ?? [])
      .map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 4);
    return { amountValue: amount?.value ?? null, amountReadonly: amount?.readOnly ?? null, typeNow: typeTrigger?.textContent?.trim() ?? null, errors };
  });
  log('amount_check', amountCheck);

  // invoice number — OTHER is an invoice-bearing chi-hộ fee: saving without
  // Số hóa đơn is blocked client-side ("không cho phép chi không hóa đơn").
  const invoiceOk = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    if (!form) return false;
    const labels = Array.from(form.querySelectorAll('label'));
    const lbl = labels.find((l) => /^Số hóa đơn/.test((l.textContent || '').trim()));
    const group = lbl?.closest('div');
    const input = group?.querySelector('input');
    if (!(input instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'R29-VRF-001');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  await sleep(300);
  log('invoice_filled', { invoiceOk });

  // note (Lý do chi * / Ghi chú) — located via its FormGroup label
  const noteOk = await page.evaluate((note) => {
    const form = document.querySelector('.fwd-expense-form');
    if (!form) return false;
    const labels = Array.from(form.querySelectorAll('label'));
    const lbl = labels.find((l) => /^(Lý do chi|Ghi chú)/.test((l.textContent || '').trim()));
    const group = lbl?.closest('div');
    const noteInput = group?.querySelector('input:not([type="number"]):not([type="checkbox"]), textarea');
    if (!(noteInput instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(noteInput, note);
    noteInput.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, EXPENSE_NOTE);
  await sleep(300);
  log('note_filled', { noteOk });

  // ensure settlement = OPS_ADVANCE via the custom select (default anyway)
  const settle2 = await page.evaluate(() => {
    const el = document.querySelector('#fwd-settlement-method');
    const label = el?.textContent?.trim() ?? '';
    if (label.includes('Chi hộ tạm ứng')) return 'OPS_ADVANCE (default)';
    return label || null;
  });
  await sleep(200);
  log('settlement', { settle: settle2 });

  await page.screenshot({ path: path.join(OUT, '03-form-filled.png'), fullPage: true });
  const preSave = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    const errors = Array.from(form?.querySelectorAll('.fwd-field-error-inline, .fwd-price-hint--error') ?? [])
      .map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 5);
    const amount = form?.querySelector('input[type="number"]');
    return { errors, amountValue: amount?.value ?? null };
  });
  log('pre_save', preSave);
  const saveBtn = await page.evaluateHandle(() => Array.from(document.querySelectorAll('.fwd-expense-form button')).find((b) => (b.textContent || '').includes('Lưu chi phí')));
  if (!saveBtn.asElement()) throw new Error('Lưu chi phí button not found');
  await saveBtn.asElement().click();
  await sleep(2600);

  // the just-created row
  const rowState = await page.evaluate((note) => {
    const rows = Array.from(document.querySelectorAll('.fwd-expense-record'));
    const row = rows.reverse().find((r) => (r.textContent || '').includes(note));
    if (!row) return { found: false, rowCount: rows.length };
    const badge = Array.from(row.querySelectorAll('span')).some((s) => (s.textContent || '').trim() === 'Đã lập phiếu');
    const btns = Array.from(row.querySelectorAll('button.icon-btn'));
    const editBtn = row.querySelector('button[aria-label^="Điều chỉnh"]');
    const deleteBtn = btns.filter((b) => b !== editBtn).pop();
    return {
      found: true,
      text: (row.textContent || '').slice(0, 220),
      badge,
      editDisabled: editBtn?.disabled ?? null,
      editTitle: editBtn?.getAttribute('title') ?? null,
      editAria: editBtn?.getAttribute('aria-label') ?? null,
      deleteDisabled: deleteBtn?.disabled ?? null,
      voided: (row.textContent || '').includes('Đã hủy'),
    };
  }, EXPENSE_NOTE);
  log('just_created_row', rowState);
  await page.screenshot({ path: path.join(OUT, '04-just-created.png'), fullPage: true });
  record('FB-033: chi-hộ vừa tạo KHÔNG bị khóa — Sửa/Xóa enabled, KHÔNG có badge "Đã lập phiếu"',
    rowState.found && rowState.badge === false && rowState.editDisabled === false && rowState.deleteDisabled === false && rowState.editTitle === 'Điều chỉnh chi phí',
    JSON.stringify(rowState));

  // ── edit: 50000 → 45000 ─────────────────────────────────────────────────
  await page.evaluate((note) => {
    const rows = Array.from(document.querySelectorAll('.fwd-expense-record')).reverse();
    const row = rows.find((r) => (r.textContent || '').includes(note));
    row?.querySelector('button[aria-label^="Điều chỉnh"]')?.click();
  }, EXPENSE_NOTE);
  await sleep(1000);
  const editing = await page.evaluate(() => {
    const form = document.querySelector('.fwd-expense-form');
    const btn = Array.from(form?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').includes('Lưu điều chỉnh'));
    const amount = form?.querySelector('input[type="number"]');
    if (amount instanceof HTMLInputElement) {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(amount, '45000');
      amount.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return { editMode: Boolean(btn), amountNow: amount?.value ?? null };
  });
  log('edit_mode', editing);
  if (!editing.editMode) throw new Error('edit mode did not open');
  const editSave = await page.evaluateHandle(() => Array.from(document.querySelectorAll('.fwd-expense-form button')).find((b) => (b.textContent || '').includes('Lưu điều chỉnh')));
  await editSave.asElement().click();
  await sleep(2600);
  const afterEdit = await page.evaluate((note) => {
    const rows = Array.from(document.querySelectorAll('.fwd-expense-record')).reverse();
    const row = rows.find((r) => (r.textContent || '').includes(note));
    return { found: Boolean(row), text: (row?.textContent || '').slice(0, 200), amountShown: (row?.textContent || '').match(/([\d.]+)\s*₫/)?.[1] ?? null };
  }, EXPENSE_NOTE);
  log('after_edit', afterEdit);
  await page.screenshot({ path: path.join(OUT, '05-after-edit.png'), fullPage: true });
  record('FB-033: Sửa NGAY sau tạo thành công (PATCH 200, row shows 45.000₫)',
    expensePosts.some((e) => e.method === 'PATCH' && e.status === 200) && afterEdit.found && (afterEdit.text ?? '').includes('45.000'),
    `apis=${JSON.stringify(expensePosts.map((e) => `${e.method}:${e.status}`))} row=${(afterEdit.text ?? '').slice(0, 120)}`);

  // ── delete with reason prompt ───────────────────────────────────────────
  await page.evaluate((note) => {
    const rows = Array.from(document.querySelectorAll('.fwd-expense-record')).reverse();
    const row = rows.find((r) => (r.textContent || '').includes(note));
    const editBtn = row?.querySelector('button[aria-label^="Điều chỉnh"]');
    const btns = Array.from(row?.querySelectorAll('button.icon-btn') ?? []).filter((b) => b !== editBtn);
    btns.pop()?.click();
  }, EXPENSE_NOTE);
  await sleep(900);
  const dialogState = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Nhập lý do"], .confirm-box');
    return { open: Boolean(dlg), text: (dlg?.textContent || '').slice(0, 160) };
  });
  log('reason_dialog', dialogState);
  await page.screenshot({ path: path.join(OUT, '06-delete-reason-dialog.png') });
  await page.type('[role="dialog"][aria-label="Nhập lý do"] textarea', 'R29 verify — dọn dữ liệu test', { delay: 10 });
  await sleep(300);
  await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"][aria-label="Nhập lý do"]');
    const btn = Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').includes('Xóa khoản chi'));
    btn?.click();
  });
  await sleep(2600);
  const afterDelete = await page.evaluate((note) => {
    const rows = Array.from(document.querySelectorAll('.fwd-expense-record'));
    const row = rows.find((r) => (r.textContent || '').includes(note));
    return {
      found: Boolean(row),
      voided: Boolean(row && (row.textContent || '').includes('Đã hủy')),
      reasonShown: Boolean(row && (row.textContent || '').includes('Lý do hủy')),
      text: (row?.textContent || '').slice(0, 240),
    };
  }, EXPENSE_NOTE);
  log('after_delete', afterDelete);
  await page.screenshot({ path: path.join(OUT, '07-after-delete.png'), fullPage: true });
  record('FB-033: Xóa NGAY sau sửa thành công (DELETE 200, row VOIDED + Lý do hủy)',
    expensePosts.some((e) => e.method === 'DELETE' && [200, 204].includes(e.status)) && afterDelete.voided && afterDelete.reasonShown,
    `apis=${JSON.stringify(expensePosts.map((e) => `${e.method}:${e.status}`))} row=${(afterDelete.text ?? '').slice(0, 160)}`);

  fs.writeFileSync(path.join(OUT, 'expense-api-log.json'), JSON.stringify(expensePosts, null, 2));
  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
