// Card 071026205300 (rework) — lead decision rung on cut 22837bc3 (owner
// granted decision authority 08/10). Owner round-6 (Admin batch) still sees
// '/shipments search not filtering'. Prior disproof used Điều vận + specific
// terms. This rung: ADMIN role, real keyboard typing, battery over every
// search key family (mã lô, Bill, booking, container, tên khách) compared
// against the workspace API's own filter total. Read-only.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card071026205300-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

// Live data for terms — from the SAME workspace endpoint the UI list uses
// (the search box's contract is 'Bill, Book, Cont, Tờ khai...', not mã lô).
const ws = await fetch(`${API}/shipments/cus-workspace?limit=50`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const wsItems = (ws.items ?? []).filter((x) => !x.deletedAt);
const billTerm = wsItems.find((x) => x.billOrBookNumber)?.billOrBookNumber ?? null;
const khaiTerm = wsItems.find((x) => x.declarationNumber)?.declarationNumber ?? null;
const contTerm = (wsItems.find((x) => /[A-Z]{4}\d{7}/.test(x.containerSummary || ''))?.containerSummary.match(/[A-Z]{4}\d{7}/) ?? [null])[0];
log('ws-sample', { n: wsItems.length, bill: billTerm, khai: khaiTerm, container: contTerm, sampleSummary: wsItems[0]?.containerSummary });

const wsTotal = async (term) => {
  const r = await fetch(`${API}/shipments/cus-workspace?limit=50&searchSuffix=${encodeURIComponent(term)}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  return r.total ?? (r.items ?? []).length;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const terms = [
    ['bill-or-book', billTerm],
    ['bill-partial', billTerm ? String(billTerm).slice(0, 6) : null],
    ['to-khai', khaiTerm],
    ['container', contTerm],
  ].filter(([, v]) => v);

  const results = [];
  for (const [fam, term] of terms) {
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
    let nrows = 0;
    for (let i = 0; i < 12 && !nrows; i++) { await sleep(2500); nrows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
    const unfiltered = nrows;
    const inputPt = await page.evaluate(() => {
      const vis = [...document.querySelectorAll('input')].filter((e) => e.offsetParent !== null);
      const i = vis.find((x) => /Tìm lô hàng/i.test(x.getAttribute('aria-label') || '')) ?? vis.find((x) => /Bill, Book, Cont/i.test(x.placeholder || ''));
      if (!i) return { err: 'no input', inventory: vis.map((v) => ({ aria: v.getAttribute('aria-label') || '', ph: v.placeholder || '' })).slice(0, 8) };
      const r = i.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    });
    if (inputPt.err) { log('input-miss', { fam }); continue; }
    await page.mouse.click(inputPt.x, inputPt.y);
    await page.keyboard.down('Meta'); await page.keyboard.press('KeyA'); await page.keyboard.up('Meta');
    await page.keyboard.type(String(term), { delay: 25 });
    await sleep(2500);
    const sample = await page.evaluate(() => ({
      url: location.search,
      rows: document.querySelectorAll('tbody tr').length,
      empty: (document.body.textContent || '').includes('Không có lô'),
      firstRow: (document.querySelector('tbody tr')?.textContent || '').replace(/\s+/g, ' ').slice(0, 90),
    }));
    const apiTotal = await wsTotal(String(term));
    const verdict = sample.rows === apiTotal || (apiTotal === 0 && sample.empty) ? 'FILTERED' : 'MISMATCH';
    log('term', { fam, term: String(term), unfiltered, ui: sample, apiTotal, verdict });
    results.push({ fam, verdict });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-${fam}.png` });
  }
  const bad = results.filter((r) => r.verdict === 'MISMATCH');
  if (results.length === 0) { log('INCONCLUSIVE-empty-battery', { why: 'no term family drove the UI' }); exitCode = 2; }
  else if (bad.length === 0) log('PASS-all-keys-filter', { families: results.map((r) => r.fam) });
  else { log('REPRO-found', { bad }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
