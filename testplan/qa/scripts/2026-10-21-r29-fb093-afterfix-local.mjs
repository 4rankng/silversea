// R29 FB-093 — AFTER-FIX drive (rung 3) on the FIXED local build
// (worktree FE :7191, VITE_API_PROXY_TARGET → staging API vantai.tingting.vip,
// build c643ef1e backend + fix frontend). Fresh ketoan profile (no stored
// column choice): the merged group 809 CL4C-01 + 810 CL4C-02 (created by the
// staging drive) must show "Tách nhóm" WITHOUT any column-picker fiddling;
// clicking it unmerges (and restores the pre-merge state = staging cleanup).
// Usage: node testplan/qa/scripts/2026-10-21-r29-fb093-afterfix-local.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'http://localhost:7191';
const OUT = path.resolve('qa/2026-10-21-r29-verify/fb093');
fs.mkdirSync(OUT, { recursive: true });
const BILL2 = 'CL4C-02';
const MERGE_NOTE = 'Ghép cùng Bill CL4C-01';

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
const debitRows = async (token) => {
  const res = await fetch(`${API}/shipments/debit-summary`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await res.json();
  return (body?.items ?? []).filter((r) => [809, 810].includes(r.shipmentId))
    .map((r) => ({ ship: r.shipmentId, freight: r.freightAuto, note: r.freightOverrideReason, revGroup: r.revGroupId, lock: r.lockStatus }));
};

const ketoan = await login('ketoan');
const before = await debitRows(ketoan);
log('before_rows', before);
fs.writeFileSync(path.join(OUT, 'db-3-before-afterfix.json'), JSON.stringify(before, null, 2));
if (!before.every((r) => r.revGroup)) { log('ABORT: group not present on staging — run the staging merge drive first'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const unmergeCalls = [];
  page.on('response', async (res) => {
    if (/unmerge-group/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 200); } catch { /* noop */ }
      unmergeCalls.push({ status: res.status(), body: b });
      log('unmerge_api', { status: res.status(), body: b });
    }
  });
  // FRESH profile: no token, no localStorage choice — set ONLY the auth token.
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoan);
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await sleep(4000);

  const state = await page.evaluate((note) => ({
    storedChoice: localStorage.getItem('accounting-debit-hidden-cols'),
    rowsWithNote: Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes(note)).length,
    containerHeaderVisible: Array.from(document.querySelectorAll('th')).some((th) => (th.textContent || '').includes('Thông số container')),
    tachButtons: Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .map((b) => ({ aria: b.getAttribute('aria-label'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') })),
    moneyBreakdownVisible: Array.from(document.querySelectorAll('th')).some((th) => (th.textContent || '').includes('Cước thu (tự động)')),
  }), MERGE_NOTE);
  log('afterfix_board', state);
  fs.writeFileSync(path.join(OUT, 'afterfix-dom-tach-buttons.txt'), JSON.stringify(state, null, 2));
  await page.screenshot({ path: path.join(OUT, '08-afterfix-ketoan-tach-visible.png'), fullPage: true });
  record('FB-093 AFTER FIX: máy trạm mới — cột "Thông số container" tự hiện theo dữ liệu lcl → nút "Tách nhóm" thấy TRÊN BOARD cho từng dòng nhóm, kể cả CL4C-01/CL4C-02 (KT4 giữ mặc định: cột tiền breakdown vẫn ẩn)',
    state.storedChoice === null && state.rowsWithNote >= 1 && state.containerHeaderVisible
      && state.tachButtons.length >= 2
      && state.tachButtons.some((b) => (b.aria ?? '').includes('CL4C-01'))
      && state.tachButtons.some((b) => (b.aria ?? '').includes('CL4C-02'))
      && state.tachButtons.every((b) => !b.disabled && b.ariaDisabled !== 'true')
      && state.moneyBreakdownVisible === false,
    JSON.stringify({ storedChoice: state.storedChoice, rows: state.rowsWithNote, header: state.containerHeaderVisible, buttons: state.tachButtons, moneyBreakdown: state.moneyBreakdownVisible }));

  // click Tách nhóm on CL4C-02 → confirm → unmerge
  await page.evaluate((bill) => {
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .find((b) => (b.getAttribute('aria-label') || '').includes(bill));
    btn?.click();
  }, BILL2);
  await sleep(1100);
  const confirmState = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    return { open: Boolean(d), text: (d?.textContent || '').slice(0, 200) };
  });
  log('afterfix_confirm_dialog', confirmState);
  await page.screenshot({ path: path.join(OUT, '09-afterfix-tach-confirm.png') });
  if (!confirmState.open) throw new Error('after-fix confirm dialog did not open');
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Tách nhóm');
    btn?.click();
  });
  await sleep(3200);
  // wait for the board refetch: the CL4C rev-group buttons must disappear
  // (the cost-dimension "Ghép cùng Bill" note on the cost-member row may
  // legitimately persist — it belongs to the cost group, not the rev group).
  let afterUi = { rowsWithNote: -1, tachButtons: -1 };
  for (let i = 0; i < 10; i++) {
    afterUi = await page.evaluate(() => ({
      rowsWithNote: Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes('Ghép cùng Bill')).length,
      tachButtons: Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
        .map((b) => b.getAttribute('aria-label')),
    }));
    const cl4cLeft = afterUi.tachButtons.some((a) => a?.includes('CL4C'));
    if (!cl4cLeft) break;
    await sleep(900);
  }
  log('afterfix_after_tach_ui', afterUi);
  await page.screenshot({ path: path.join(OUT, '10-afterfix-after-tach.png'), fullPage: true });
  const after = await debitRows(ketoan);
  log('afterfix_rows', after);
  fs.writeFileSync(path.join(OUT, 'db-4-after-afterfix-tach.json'), JSON.stringify(after, null, 2));
  record('FB-093 AFTER FIX: click "Tách nhóm" (dòng CL4C-02) → unmerge 200 → revGroup giải tán: API cả 2 lô revGroup=null + note ghép=null; board không còn nút Tách nhóm cho CL4C',
    unmergeCalls.some((e) => e.status === 200)
      && after.every((r) => !r.revGroup) && after.every((r) => r.note == null)
      && !afterUi.tachButtons.some((a) => a?.includes('CL4C')),
    `apis=${JSON.stringify(unmergeCalls.map((e) => e.status))} rows=${JSON.stringify(after)} tachButtonsLeft=${afterUi.tachButtons.length} (nút còn lại thuộc nhóm ghép KHÁC — đúng luật; note "Ghép cùng Bill" còn 1 dòng là note NHÓM CHI PHÍ của 810 — cost group 74c58bee có TRƯỚC lane, không thuộc rev merge)`);

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'afterfix-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
