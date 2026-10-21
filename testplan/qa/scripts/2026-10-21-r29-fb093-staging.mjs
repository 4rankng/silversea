// R29 re-verify (2026-10-21) — FB-093: "Tách nhóm" phải có phía Kế toán
// (/accounting/chot-debit) trên mọi dòng thuộc nhóm Ghép cước thu khách,
// và click → unmerge trả tiền/note về trạng thái trước ghép. Staging c643ef1e.
// Fixture: 2 lô LCL cùng KH YUANFANG (customer 20) chưa ghép, chưa chốt:
//   809 SHP-2610-00433 (CL4C-01) + 810 SHP-2610-00434 (CL4C-02), delivery
//   2026-10-20 — nằm trong window mặc định của board kế toán (01→21/10).
// Flow: tiepvv ghép (dialog loại xe 5T) → ketoan thấy 2 nút "Tách nhóm" →
//   tách trên dòng CL4C-02 → xác nhận → nhóm giải tán, note biến mất.
// Usage: node testplan/qa/scripts/2026-10-21-r29-fb093-staging.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve('qa/2026-10-21-r29-verify/fb093');
fs.mkdirSync(OUT, { recursive: true });
const BILL1 = 'CL4C-01';
const BILL2 = 'CL4C-02';
const MERGE_NOTE = `Ghép cùng Bill ${BILL1}`;

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
    .map((r) => ({ ship: r.shipmentId, code: r.code, bill: r.billOrBookNumber, freight: r.freightAuto, note: r.freightOverrideReason, revGroup: r.revGroupId, members: r.revGroupMemberCount, lock: r.lockStatus }));
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash });
if (health?.buildHash !== 'c643ef1e' && !process.env.QA_IGNORE_BUILD) { log('ABORT: build mismatch'); process.exit(2); }

const tiepvv = await login('tiepvv');
const ketoan = await login('ketoan');
const before = await debitRows(tiepvv);
log('before_rows', before);
fs.writeFileSync(path.join(OUT, 'db-0-before.json'), JSON.stringify(before, null, 2));
if (before.some((r) => r.revGroup)) { log('ABORT: 809/810 already grouped — clean up first'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  // ══ Phase A: tiepvv ghép 2 lô ═══════════════════════════════════════════
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const mergePosts = [];
  page.on('response', async (res) => {
    if (/\/api\/shipments\/lcl\/(merge|unmerge)-/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 300); } catch { /* noop */ }
      mergePosts.push({ url: res.url(), status: res.status, body: b });
      log('lcl_api', { url: res.url(), status: res.status, body: b });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tiepvv);
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table', { timeout: 30000 });
  await sleep(2500);

  const selectRow = async (code) => page.evaluate((c) => {
    const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes(c));
    if (!td) return false;
    const tr = td.closest('tr');
    const clickable = tr?.querySelector('[data-selected]') || tr;
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Boolean(tr?.querySelector('input[type="checkbox"]'));
  }, code);
  const hasCheckbox1 = await selectRow(BILL1);
  await sleep(500);
  await selectRow(BILL2);
  await sleep(700);
  const sel = await page.evaluate(() => ({
    selected: document.querySelectorAll('[data-selected="true"]').length,
    mergeBtn: Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách'))?.disabled ?? null,
  }));
  log('selection', { hasCheckbox1, ...sel });
  await page.screenshot({ path: path.join(OUT, '01-selected-2-lots.png'), fullPage: true });
  if (sel.mergeBtn !== false) {
    // row click didn't select — fall back to clicking checkboxes
    await page.evaluate(() => {
      for (const code of ['CL4C-01', 'CL4C-02']) {
        const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes(code));
        const cb = td?.closest('tr')?.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
      }
    });
    await sleep(700);
  }
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách'));
    if (btn && !btn.disabled) btn.click();
  });
  await sleep(1200);
  const dlg = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    return { open: Boolean(d), text: (d?.textContent || '').slice(0, 200) };
  });
  log('merge_dialog', dlg);
  await page.screenshot({ path: path.join(OUT, '02-merge-dialog.png'), fullPage: true });
  if (!dlg.open) throw new Error('merge dialog did not open');

  // chọn loại xe trong combobox (options render tiếng Việt: "Xe 5 tấn" —
  // gõ '5T' làm filter rỗng list; mở list và bấm thẳng option khớp)
  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    const input = Array.from(d?.querySelectorAll('input') ?? []).find((i) => (i.placeholder || '').includes('loại xe') || i.getAttribute('role') === 'combobox') ?? Array.from(d?.querySelectorAll('input') ?? [])[0];
    input?.click();
    input?.focus();
  });
  await sleep(1300);
  const pickedClass = await page.evaluate(() => {
    const visible = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li')).filter(visible)
      .map((el) => ({ el, text: (el.textContent || '').trim() }));
    const opt = opts.find((o) => /Xe 5 tấn/.test(o.text)) ?? opts.find((o) => /5T/.test(o.text)) ?? opts[0];
    if (opt) { opt.el.click(); return opt.text.slice(0, 40); }
    return null;
  });
  await sleep(600);
  log('vehicle_class_picked', { pickedClass });
  await page.screenshot({ path: path.join(OUT, '03-merge-dialog-class-picked.png'), fullPage: true });

  await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').includes('Ghép cước thu khách'));
    btn?.click();
  });
  // wait for the group to appear
  let merged = false;
  for (let i = 0; i < 15; i++) {
    await sleep(800);
    const rows = await debitRows(tiepvv);
    if (rows.every((r) => r.revGroup)) { merged = true; break; }
  }
  const afterMerge = await debitRows(tiepvv);
  log('after_merge_rows', afterMerge);
  fs.writeFileSync(path.join(OUT, 'db-1-after-merge.json'), JSON.stringify(afterMerge, null, 2));
  await page.screenshot({ path: path.join(OUT, '04-merged-cus-board.png'), fullPage: true });
  record('FB-093 setup: ghép cước thu khách 2 lô OK (cả 2 cùng revGroup, Lô 2 = 0₫ + note ghép)',
    merged && afterMerge.filter((r) => r.revGroup).length === 2
      && String(afterMerge.find((r) => r.ship === 810)?.note ?? '').includes(MERGE_NOTE),
    JSON.stringify(afterMerge));

  await page.close();

  // ══ Phase B: ketoan /accounting/chot-debit — nút "Tách nhóm" + click ════
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1440, height: 900 });
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoan);
  await page2.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page2.waitForSelector('table', { timeout: 30000 });
  await sleep(3000);

  const ketoanState = await page2.evaluate((note) => {
    const tds = Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes(note));
    const rows = new Set(tds.map((el) => el.closest('tr')));
    const buttons = Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .map((b) => ({ aria: b.getAttribute('aria-label'), disabled: b.disabled, ariaDisabled: b.getAttribute('aria-disabled') }));
    return { rowsWithNote: rows.size, tachButtons: buttons, dateInputs: Array.from(document.querySelectorAll('#debit-board-date-range input, input[type="date"]')).map((i) => i.value) };
  }, MERGE_NOTE);
  log('ketoan_board', ketoanState);
  await page2.screenshot({ path: path.join(OUT, '05-ketoan-tach-nhom-buttons.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'ketoan-dom-tach-buttons.txt'), JSON.stringify(ketoanState, null, 2));
  record('FB-093: phía KẾ TOÁN có nút "Tách nhóm" trên MỖI dòng thuộc nhóm ghép (2 nút, aria-label nêu Số Bill)',
    ketoanState.rowsWithNote >= 2 && ketoanState.tachButtons.length >= 2
      && ketoanState.tachButtons.some((b) => (b.aria ?? '').includes(BILL2))
      && ketoanState.tachButtons.every((b) => !b.disabled && b.ariaDisabled !== 'true'),
    JSON.stringify(ketoanState.tachButtons));

  // click Tách nhóm trên dòng CL4C-02
  await page2.evaluate((bill) => {
    const btn = Array.from(document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]'))
      .find((b) => (b.getAttribute('aria-label') || '').includes(bill));
    btn?.click();
  }, BILL2);
  await sleep(1100);
  const confirmState = await page2.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    return { open: Boolean(d), text: (d?.textContent || '').slice(0, 220) };
  });
  log('tach_confirm_dialog', confirmState);
  await page2.screenshot({ path: path.join(OUT, '06-tach-confirm-dialog.png') });
  if (!confirmState.open) throw new Error('tách nhóm confirm dialog did not open');
  await page2.evaluate(() => {
    const d = document.querySelector('[role="dialog"][aria-modal], .confirm-box');
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').trim() === 'Tách nhóm');
    btn?.click();
  });
  await sleep(3000);
  const afterTachUi = await page2.evaluate((note) => ({
    rowsWithNote: Array.from(document.querySelectorAll('td')).filter((el) => (el.textContent || '').includes(note)).length,
    tachButtons: document.querySelectorAll('button[aria-label^="Tách nhóm ghép cước thu khách"]').length,
  }), MERGE_NOTE);
  log('after_tach_ui', afterTachUi);
  await page2.screenshot({ path: path.join(OUT, '07-after-tach-ketoan.png'), fullPage: true });
  const afterTach = await debitRows(tiepvv);
  log('after_tach_rows', afterTach);
  fs.writeFileSync(path.join(OUT, 'db-2-after-tach.json'), JSON.stringify(afterTach, null, 2));
  record('FB-093: click "Tách nhóm" (Kế toán) → unmerge group OK — nhóm giải tán, note ghép biến mất',
    mergePosts.some((e) => /unmerge/.test(e.url) && e.status === 200)
      && afterTach.every((r) => !r.revGroup) && afterTachUi.rowsWithNote === 0,
    `apis=${JSON.stringify(mergePosts.map((e) => `${e.url.split('/').pop()}:${e.status}`))} rows=${JSON.stringify(afterTach)}`);

  await page2.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
