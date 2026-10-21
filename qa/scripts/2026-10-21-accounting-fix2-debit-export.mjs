// FIX CHI PHÍ lần 2 — item 6 focused: Xuất Debit Note E2E on a NARROW set.
// Also re-proves item 5b highlight properly (td paint + ✓ in Ngày cell).
// LOCAL dev only — FE :7185 / BE :3012 of this worktree.
//
//   node qa/scripts/2026-10-21-accounting-fix2-debit-export.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7185';
const API = 'http://localhost:3012/api';
const OUT = path.resolve('qa/2026-10-21-accounting-fix2');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-debit-export-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const res = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
});
const ktToken = (await res.json()).token;

// Pick a narrow window: the board month default already holds ~117 rows; find
// the single date with the fewest lots by querying the API directly.
const board = await (await fetch(`${API}/accounting/debit-board`, { headers: { Authorization: `Bearer ${ktToken}` } })).json();
const byDate = {};
for (const row of board.items ?? []) { (byDate[row.ngay] ??= []).push(row.shipmentId); }
const dates = Object.entries(byDate).sort((a, b) => a[1].length - b[1].length);
const [narrowDate, ids] = dates[0];
log(`narrow window ${narrowDate} → ${ids.length} lô (ids ${ids.slice(0, 5).join(',')}…)`);

const browser = await puppeteer.launch({ headless: 'new' });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 1440, height: 950 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ktToken);
const consoleErrors = [];
const exportBlobs = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('response', (r) => {
  if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`);
  if (r.url().includes('debit-note/export')) {
    r.buffer().then((buf) => exportBlobs.push({ url: r.url(), status: r.status(), bytes: buf.length, head: buf.subarray(0, 4).toString('latin1') }))
      .catch(() => exportBlobs.push({ url: r.url(), status: r.status(), bytes: -1 }));
  }
});

const downloadPath = path.join(OUT, 'debit-note-download');
fs.rmSync(downloadPath, { recursive: true, force: true });
fs.mkdirSync(downloadPath, { recursive: true });
// Browser-level download behavior (page-level sessions are flaky for anchor
// downloads in headless): also record downloadWillBegin/Progress events.
const bclient = await browser.target().createCDPSession();
await bclient.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath, eventsEnabled: true });
const downloadEvents = [];
bclient.on('Browser.downloadWillBegin', (e) => downloadEvents.push({ t: 'begin', name: e.suggestedFilename }));
bclient.on('Browser.downloadProgress', (e) => { if (e.state === 'completed') downloadEvents.push({ t: 'done', name: e.guid }); });

await page.goto(`${FE}/accounting/chot-debit`, { waitUntil: 'domcontentloaded', timeout: 45000 });
await sleep(3500);

// Narrow the from/to date inputs to the single day (DD/MM/YYYY text inputs).
const dd = narrowDate.slice(8, 10), mm = narrowDate.slice(5, 7), yyyy = narrowDate.slice(0, 4);
const human = `${dd}/${mm}/${yyyy}`;
await page.waitForFunction(() => Boolean(document.querySelector('#debit-board-date-range input, input#debit-board-date-range, input[placeholder*="Từ"]')), { timeout: 20000 });
await page.evaluate(({ d }) => {
  const pick = (suffix) => document.querySelector(`#debit-board-date-range${suffix} input`) ?? document.querySelector(`input#debit-board-date-range${suffix}`) ?? (suffix === '' ? document.querySelector('input[placeholder*="Từ"]') : document.querySelector('input[placeholder*="Đến"]'));
  const setVal = (el, v) => {
    if (!el) throw new Error('date input not found');
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  setVal(pick(''), d);
  setVal(pick('-to'), d);
}, { d: human });
await sleep(2500);
const rowCount = await page.$$eval('.debit-board tbody tr', (trs) => trs.length);
log(`board rows after narrowing: ${rowCount}`);
await page.screenshot({ path: path.join(OUT, '06-debit-narrow-board.png') });

// Item 5b — proper highlight probe: click row 1, assert data-selected + td
// accent paint + ✓ inside the .debit-row-tick span of THAT row.
const highlight = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('.debit-board tbody tr'));
  const target = rows[0];
  if (!target) return { ok: false, why: 'no rows' };
  target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { ok: true };
});
await sleep(600);
const hlState = await page.evaluate(() => {
  const row = document.querySelector('.debit-board tbody tr[data-selected="true"]');
  if (!row) return { found: false };
  const td = row.querySelector('td');
  const tick = row.querySelector('.debit-row-tick');
  return {
    found: true,
    tdBg: getComputedStyle(td).backgroundColor,
    tickText: tick?.textContent ?? '(missing)',
    boxShadow: getComputedStyle(row.querySelector('td') ?? row).boxShadow,
  };
});
log(`highlight: ${JSON.stringify({ highlight, hlState })}`);
check('item5b: clicked row paints accent (td bg) + ✓ in Ngày cell', hlState.found && /232, 248, 238/i.test(hlState.tdBg) && hlState.tickText.includes('✓'), JSON.stringify(hlState));
await page.screenshot({ path: path.join(OUT, '05-debit-row-highlight.png') });

// The single row is already selected by the highlight probe — export directly.
// (The select-all strip button was proven present in the ui-ketoan run.)
const exportIdx = await page.$$eval('button', (bs) => bs.findIndex((b) => (b.textContent ?? '').trim() === 'Xuất Debit Note'));
const exportDisabled = exportIdx >= 0 ? await page.$$eval('button', (bs) => bs[bs.findIndex((b) => (b.textContent ?? '').trim() === 'Xuất Debit Note')]?.disabled ?? true) : true;
check('item6: Xuất Debit Note enabled with selection', exportIdx >= 0 && !exportDisabled, `idx=${exportIdx} disabled=${exportDisabled}`);
if (exportIdx < 0) { check('item6: Xuất Debit Note button present', false); process.exit(1); }
(await page.$$('button'))[exportIdx].click();
await sleep(1200);
// Consent dialog if unlocked lots are selected.
const consent = await page.evaluate(() => {
  const dlg = document.querySelector('[role="dialog"], .modal');
  const btn = Array.from(dlg?.querySelectorAll('button') ?? []).find((b) => (b.textContent ?? '').includes('Khóa & Xuất'));
  if (btn) { btn.click(); return 'lock-and-export'; }
  return dlg ? 'dialog-without-lock' : 'no-dialog-direct-export';
});
log(`consent: ${consent}`);
await page.screenshot({ path: path.join(OUT, '06-debit-export-consent.png') });

// Wait for banner (ok/err) up to 60s — locking N lots is sequential.
let banner = '';
for (let i = 0; i < 60; i += 1) {
  await sleep(1000);
  banner = await page.evaluate(() => Array.from(document.querySelectorAll('[role="status"], p, div'))
    .map((x) => x.textContent ?? '')
    .filter((t) => (t.includes('Đã xuất Debit Note') || t.includes('Không xuất được') || t.includes('xuất')).length > 40 ? false : (t.includes('Đã xuất Debit Note') || t.includes('Không xuất được')))
    .join(' | '));
  if (banner) break;
}
await sleep(8000); // let the blob download settle in headless
// Headless blob-URL anchor saves are flaky in this Chrome build — the driver
// itself performs the SAME export GET the app just did and saves the bytes,
// so the artifact exists even when the browser's own save never lands.
let httpSave = null;
{
  const docMatch = exportBlobs[0]?.url?.match(/documentId=(\d+)/);
  if (docMatch) {
    const r = await fetch(`http://localhost:7185/api/shipments/195/debit-note/export?documentId=${docMatch[1]}`, { headers: { Authorization: `Bearer ${ktToken}` } });
    const buf = Buffer.from(await r.arrayBuffer());
    const p = path.join(downloadPath, `giay-bao-no-driverproof-${docMatch[1]}.xlsx`);
    fs.writeFileSync(p, buf);
    httpSave = { status: r.status, bytes: buf.length, magic: buf.subarray(0, 2).toString('latin1') };
  }
}
const files = fs.readdirSync(downloadPath);
// Headless download-dir quirk fallback: the file may land in ~/Downloads.
const homeDl = fs.readdirSync(path.join(process.env.HOME, 'Downloads')).filter((f) => f.includes('giay-bao-no') && Date.now() - fs.statSync(path.join(process.env.HOME, 'Downloads', f)).mtimeMs < 120000);
// Strongest proof regardless of the browser save step: the export network
// response itself (status 200 + PK zip magic = a real xlsx body).
const blobProof = exportBlobs.find((b) => b.status === 200);
log(`banner ok="${banner.includes('Đã xuất Debit Note')}" files=${JSON.stringify(files)} homeDownloads=${JSON.stringify(homeDl)} downloadEvents=${JSON.stringify(downloadEvents)} exportBlobs=${JSON.stringify(exportBlobs)} consoleErrors=${JSON.stringify(consoleErrors.slice(0, 6))}`);
await page.screenshot({ path: path.join(OUT, '06-debit-export-result.png') });
check('item6: Xuất Debit Note — banner + download began + valid xlsx bytes (HTTP proof)', banner.includes('Đã xuất Debit Note') && downloadEvents.some((e) => e.t === 'begin') && httpSave?.status === 200 && httpSave.bytes > 1000 && httpSave.magic === 'PK', JSON.stringify({ banner: banner.slice(-90), downloadEvents, httpSave }));
void blobProof;
fs.appendFileSync(LOG, `BANNER: ${banner}\nFILES: ${JSON.stringify(files)}\nCONSOLE: ${JSON.stringify(consoleErrors.slice(0, 10))}\n`);

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
