// Card 379 — UI rung: debit export dialog vs spec. Local stack (HEAD tree).
// Mutation surface: creates ONE settlement round on the LOCAL DB (note carries
// the [fixture card379] predicate); no staging writes, no prod.
// The board table is unpaginated (1800+ rows) — viewport captures only.
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import { launch, shot, setViewport, logEvidence, sleep, tapAt } from './qa-20261005-lib.mjs';

const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7175';
const EV = '/Volumes/LexarSSD/projects/silversea-prod/testplan/qa/evidence/2026-10-05_card379-debit-dialog';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };

const login = async () => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  return (await r.json()).token;
};
const api = (token, path) => fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const token = await login();
const board = await api(token, '/accounting/debit-board');
const rows = board.rows ?? board.items ?? [];
const candidate = rows.find((r) => (r.thu?.tongThu ?? 0) > 0 && r.billOrBooking);
if (!candidate) throw new Error('no candidate row with charges');
log('candidate', { bill: candidate.billOrBooking, shipmentId: candidate.shipmentId, tongThu: candidate.thu?.tongThu });

const { browser, page } = await launch({ width: 1440, height: 1000 });
try {
  let ok = false;
  for (let attempt = 1; attempt <= 4 && !ok; attempt++) {
    const t = await login();
    await page.evaluateOnNewDocument((x) => { localStorage.setItem('token', x); }, t);
    await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    ok = await page.evaluate(() => document.querySelectorAll('tbody tr').length > 0);
    log('attempt', { attempt, ok });
  }
  if (!ok) throw new Error('board never rendered rows');

  // Selection is row-tap on the records list (AccountingDebitRecords), not a
  // native checkbox. Scroll into view, hit-verify the row, tap it.
  const findRow = () => page.evaluate((bill) => {
    const tr = [...document.querySelectorAll('tbody tr, [class*="records"] tr, [class*="record"] div[role="button"]')]
      .find((r) => r.innerText.includes(bill));
    if (!tr) return { retry: 'row' };
    tr.scrollIntoView({ block: 'center' });
    const r = tr.getBoundingClientRect();
    if (!(r.top >= 80 && r.bottom <= innerHeight - 80)) return { retry: 'viewport', top: Math.round(r.top) };
    return { x: Math.round(r.x + Math.min(r.width / 2, 300)), y: Math.round(r.y + r.height / 2) };
  }, candidate.billOrBooking);
  let box = null;
  for (let i = 0; i < 12 && !box; i++) { const b = await findRow(); box = b && !b.retry ? b : null; if (!box) await sleep(700); }
  if (!box) throw new Error('candidate row never settled');
  const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? `${e.tagName}.${String(e.className).slice(0, 40)}` : null; }, box);
  log('hitRow', { hit });
  await tapAt(page, box.x, box.y, { label: 'select-row', settle: 600 });
  const selectedCount = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Chọn Debit/.test(x.textContent || ''));
    return (b?.textContent || '').trim();
  });
  log('selected', { toolbar: selectedCount });
  if (!/Chọn Debit \([1-9]/.test(selectedCount)) throw new Error('row selection did not register: ' + selectedCount);

  // Open the dialog.
  const debitBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /Chọn Debit/.test(x.textContent || ''));
    if (!b) return null;
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (b.textContent || '').trim() };
  });
  if (!debitBtn) throw new Error('Chọn Debit button not found');
  await tapAt(page, debitBtn.x, debitBtn.y, { label: 'open-debit-dialog', settle: 1500 });

  const dialog = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], dialog, .debit-settlement, [class*="settlement" i]')].find((d) => d.offsetParent !== null) ?? document.querySelector('[class*="overlay" i]');
    if (!dlg) return { open: false };
    const text = (el) => (el?.textContent || '').trim().replace(/\s+/g, ' ');
    const inputs = [...dlg.querySelectorAll('input')].map((i) => ({ aria: i.getAttribute('aria-label'), type: i.type, value: i.value, checked: i.checked }));
    return { open: true, text: text(dlg).slice(0, 700), inputs };
  });
  log('dialog', dialog);
  if (!dialog.open) throw new Error('dialog did not open');
  await shot(page, `${EV}/379-debit-dialog-open-1440.png`, { full: false });

  // Choose direction THU + VAT 8% via real taps; read the live computed lines.
  const tapInDialog = (matcher) => page.evaluate((m) => {
    const dlg = [...document.querySelectorAll('[role="dialog"], dialog, [class*="overlay" i]')].pop();
    const el = [...dlg.querySelectorAll('input, button, label, span')].find((x) => m.type === 'radio'
      ? x.type === 'radio' && (x.value === m.value || x.parentElement?.textContent?.includes(m.value))
      : (x.textContent || '').trim() === m.text);
    if (!el) return null;
    const target = el.type === 'radio' ? el : el;
    target.scrollIntoView({ block: 'center' });
    const r = target.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, matcher).then((box) => box && tapAt(page, box.x, box.y, { label: matcher.value ?? matcher.text, settle: 400 }));

  const before = await page.evaluate(() => document.querySelector('[role="dialog"], [class*="overlay" i]')?.textContent?.replace(/\s+/g, ' ')?.slice(0, 600));
  await tapInDialog({ type: 'radio', value: 'Phải thu' }).catch(() => log('tap', { what: 'Phải thu', miss: true }));
  await tapInDialog({ type: 'radio', value: '8%' }).catch(() => log('tap', { what: 'vat8', miss: true }));
  await sleep(400);
  const after = await page.evaluate(() => document.querySelector('[role="dialog"], [class*="overlay" i]')?.textContent?.replace(/\s+/g, ' ')?.slice(0, 700));
  log('vatCompute', { before: before?.slice(0, 200), after });

  // Type the fixture note, then submit.
  const noteBox = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="overlay" i]')].pop();
    const inp = [...dlg.querySelectorAll('input[type="text"], textarea')].find((i) => /ghi|chú|note/i.test(i.getAttribute('aria-label') || '') || i.placeholder?.toLowerCase().includes('chú'));
    if (!inp) return null;
    inp.scrollIntoView({ block: 'center' });
    const r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (noteBox) {
    await tapAt(page, noteBox.x, noteBox.y, { label: 'note-input', settle: 300 });
    await page.keyboard.type('[fixture card379] rung', { delay: 20 });
    log('note', { typed: true });
  }
  const submitBtn = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"], [class*="overlay" i]')].pop();
    const b = [...dlg.querySelectorAll('button')].find((x) => /Xác nhận|Lưu|Tạo|Issue|Chốt/.test(x.textContent || ''));
    if (!b || b.disabled) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (b.textContent || '').trim() };
  });
  if (submitBtn) {
    await tapAt(page, submitBtn.x, submitBtn.y, { label: `submit:${submitBtn.text}`, settle: 2000 });
    log('submitted', { via: submitBtn.text });
  } else {
    log('submitted', { via: 'none-found — dialog left open, no write' });
  }
  await shot(page, `${EV}/379-debit-dialog-after-submit-1440.png`, { full: false });

  for (const width of [1280, 1920, 2560]) {
    await setViewport(page, width, 1000);
    await shot(page, `${EV}/379-chot-debit-${width}-viewport.png`, { full: false });
    log('shot', { width });
  }

  logEvidence(EV, 'driver-379.json', { candidate: { bill: candidate.billOrBooking, shipmentId: candidate.shipmentId }, dialog, log: LOG });
  console.log('DONE');
} finally {
  await browser.close();
}
// Persistence proof via DB (round + note), separate from the browser session.
const out = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -c "SELECT id, round_no, direction, date_from, date_to, note FROM debit_settlement_rounds ORDER BY id DESC LIMIT 3;" 2>&1 || true`, { encoding: 'utf8' });
console.log('DB check:\n' + out);
