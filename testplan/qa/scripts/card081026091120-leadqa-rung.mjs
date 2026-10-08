// Card 081026091120 — lead staging QA on cut 9f8f86ba: the dispatch assignment
// dialog's note field names its lot-level scope. Read-only: open the dialog,
// assert the hint, close via Hủy.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb091120-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '9f8f86ba' });
if (!String(health.buildHash || '').startsWith('9f8f86ba')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  log('list', { rows });
  if (!rows) throw new Error('dispatch-detail list empty');

  // Open the assignment/note dialog: iterate candidate cells until one
  // hit-tests clean (scrollIntoView + re-measure per candidate).
  let cellPt = null;
  for (let attempt = 0; attempt < 6 && !cellPt; attempt++) {
    cellPt = await page.evaluate((skip) => {
      const all = [...document.querySelectorAll('button')].filter((e) => e.offsetParent !== null);
      let btns = all.filter((b) => /Sửa ô điều phối/.test(b.getAttribute('aria-label') || ''));
      if (!btns.length && skip === 0) {
        // inventory dump: what dispatch-cell triggers exist?
        const inv = all.map((b) => b.getAttribute('aria-label') || (b.textContent || '').trim().slice(0, 30)).filter((t) => /điều phối|Ghi chú|dispatch/i.test(t)).slice(0, 10);
        return { err: 'no Sửa ô điều phối buttons', inventory: inv };
      }
      const btn = btns[skip];
      if (!btn) return { err: 'no more candidates', total: btns.length };
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const hit = document.elementsFromPoint(r.x + r.width / 2, r.y + r.height / 2)[0];
      if (!hit || !(hit === btn || btn.contains(hit))) return { err: 'covered', skip };
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), label: (btn.getAttribute('aria-label') || btn.textContent || '').trim().slice(0, 60) };
    }, attempt);
    if (cellPt.err || !cellPt.x) { log('cell-skip', { attempt, ...cellPt }); cellPt = null; await sleep(600); }
  }
  log('cell-probe', cellPt);
  if (!cellPt || cellPt.err || !cellPt.x) throw new Error('no openable dispatch cell');
  await page.mouse.move(cellPt.x, cellPt.y); await page.mouse.down(); await page.mouse.up();
  let dlgOpen = false;
  for (let i = 0; i < 10 && !dlgOpen; i++) { await sleep(1000); dlgOpen = await page.evaluate(() => Boolean(document.querySelector('[role="dialog"]'))); }
  if (!dlgOpen) throw new Error('dialog did not open');
  await sleep(1200);
  const scan = await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const text = (dlg?.textContent || '').replace(/\s+/g, ' ');
    return {
      hasLabel: text.includes('Ghi chú thêm'),
      hasHint: text.includes('Ghi chú dùng chung cả lô'),
      hintText: (text.match(/Ghi chú dùng chung cả lô[^.]*\./) ?? [''])[0].trim(),
    };
  });
  log('dialog-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-dialog-hint.png` });
  // close non-mutating
  await page.evaluate(() => {
    const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
    const b = dlg ? [...dlg.querySelectorAll('button')].find((x) => /^(Hủy|Đóng|Huỷ)$/i.test((x.textContent || '').trim())) : null;
    if (b) b.click();
  });
  if (scan.hasLabel && scan.hasHint) log('PASS-scope-hint', scan);
  else { log('FAIL', scan); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
