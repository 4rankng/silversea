// QA R26 re-drive — FB-014 PRIMARY on STAGING build d39ee741 (fix 37838c06).
// Read-only UI drive, dieuvan (DISPATCHER) → https://vantai.tingting.vip/dispatch
//
// Contract under test (testplan/2026-10-20-fb014-lot-click-dispatch-detail.md):
//   1. Clicking a lot ROW BODY navigates to
//      /dispatch-detail?q=<Số Bill|Booking|mã lô>&date=<ngày lô> and the
//      "Kế hoạch Chi tiết Xe" board shows that day's dispatch rows (not blank).
//   2. The separate 'Chi tiết' quick-view trigger still opens the
//      "Chi tiết container" drawer (URL stays /dispatch).
//   3. Two lots on DIFFERENT days — one inside the topbar month (Oct 2026),
//      one outside it — so the `date` seeding is proven to beat the
//      topbar-month bounds.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { stagingPassword } from './creds.mjs';

const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = path.resolve(import.meta.dirname);
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const flush = () => fs.writeFileSync(`${OUT}/fb014-ui-driver.log`, `${LOG.map((e) => JSON.stringify(e)).join('\n')}\n`, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Build gate ────────────────────────────────────────────────────────────────
const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expect: 'd39ee741', base: BASE });
if (health.buildHash !== 'd39ee741') {
  log('STOP_buildHash_mismatch', { got: health.buildHash });
  flush();
  process.exit(2);
}

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: stagingPassword() }),
});
if (!loginRes.ok) { log('STOP_login', { status: loginRes.status }); flush(); process.exit(2); }
const { token, user } = await loginRes.json();
log('login', { username: user?.username, role: user?.role });

// Two lots, two days: candidate order is recon-derived (each candidate was
// pre-checked read-only: GET /shipments/dispatch-detail-plan-rows?q=…&date=…
// returns >0 rows for its own deep-link scope).
const SLOTS = [
  {
    file: '01-inmonth',
    label: 'lot inside the topbar month (Oct 2026)',
    tries: [
      { q: 'R15B3-FCL-01', day: '2026-10-12' },
      { q: 'BK-R22-TEST1', day: '2026-10-20' },
      { q: 'EGLV790671198411', day: '2026-10-06' },
    ],
  },
  {
    file: '02-outmonth',
    label: 'lot OUTSIDE the topbar month (Sep 2026)',
    tries: [
      { q: 'JJCTCHPDY260305', day: '2026-09-07' },
      { q: 'SEAB-2609-778807', day: '2026-09-24' },
      { q: 'EBKG18452303', day: '2026-09-08' },
    ],
  },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));

let detailRequests = [];
page.on('request', (req) => {
  if (req.url().includes('/dispatch-detail-plan-rows')) detailRequests.push(req.url());
});
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

/** Stamp the live URL + label into the viewport so the PNG itself carries
 *  the "URL bar" evidence (a headless capture has no browser chrome). */
const stamp = async (label) => {
  await page.evaluate((text) => {
    let el = document.getElementById('qa-url-stamp');
    if (!el) {
      el = document.createElement('div');
      el.id = 'qa-url-stamp';
      el.style.cssText = 'position:fixed;top:6px;left:6px;z-index:2147483647;background:#000;color:#4ade80;'
        + 'font:13px/1.45 ui-monospace,Menlo,monospace;padding:7px 11px;border:2px solid #4ade80;'
        + 'border-radius:4px;max-width:92vw;white-space:pre-wrap;word-break:break-all;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent = text;
  }, `${label}\nURL: ${page.url()}\nbuild d39ee741 · QA R26 · ${new Date().toISOString()}`);
};

const results = [];

for (const slot of SLOTS) {
  let done = false;
  for (const target of slot.tries) {
    if (done) break;
    const attemptId = `${slot.file}-q${target.q}`;
    detailRequests = [];

    await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(3500);

    const boardReady = await page.evaluate(() => ({
      rowCount: document.querySelectorAll('.master-plan-grid__row').length,
      heading: document.querySelector('h1.sr-only')?.textContent ?? '',
      totalText: document.body.innerText.length,
    }));
    log('dispatch_loaded', { slot: slot.file, target, ...boardReady });
    if (boardReady.rowCount === 0) {
      log('attempt_no_rows_on_board', { attemptId });
      continue;
    }

    // Narrow the board with the screen's own quick search so the target lot's
    // row is the one we click (real input, real debounce, real wire query).
    await page.type('input[aria-label="Tìm kiếm lô hàng"]', target.q, { delay: 25 });
    await sleep(2200);

    const rowRect = await page.evaluate((needle) => {
      const rows = [...document.querySelectorAll('.master-plan-grid__row')];
      const row = rows.find((r) => (r.textContent ?? '').includes(needle));
      if (!row) return { found: false, rows: rows.length };
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
      return { found: true, rows: rows.length, rowText: (row.textContent ?? '').slice(0, 220) };
    }, target.q);
    log('row_lookup', { attemptId, ...rowRect });
    if (!rowRect.found) {
      log('attempt_row_not_rendered', { attemptId });
      continue;
    }
    await sleep(600);

    // Pick a PLAIN cell of that row (no control inside) and hit-test it.
    const hit = await page.evaluate((needle) => {
      const rows = [...document.querySelectorAll('.master-plan-grid__row')];
      const row = rows.find((r) => (r.textContent ?? '').includes(needle));
      if (!row) return null;
      const tds = [...row.querySelectorAll('td')];
      const plain = tds.filter((td) => !td.querySelector('button,input,select,textarea,a,[role="button"],[role="link"]')
        && !/__(select|action)/.test(td.className));
      const pick = plain.find((td) => (td.textContent ?? '').includes(needle)) ?? plain[0] ?? null;
      if (!pick) return null;
      pick.scrollIntoView({ block: 'center', behavior: 'instant' });
      const r = pick.getBoundingClientRect();
      const x = r.left + Math.min(r.width / 2, 60);
      const y = r.top + r.height / 2;
      const hitEl = document.elementFromPoint(x, y);
      return {
        x, y,
        cellText: (pick.textContent ?? '').slice(0, 160),
        cellClass: pick.className,
        hitInsideCell: Boolean(hitEl && pick.contains(hitEl)),
        hitTag: hitEl ? `${hitEl.tagName}.${(hitEl.className || '').toString().slice(0, 60)}` : null,
        rowClass: row.className,
        rowTabIndex: row.tabIndex,
      };
    }, target.q);
    log('row_cell_hit_test', { attemptId, ...hit });
    if (!hit || !hit.hitInsideCell) {
      log('attempt_hit_test_failed', { attemptId, hit });
      continue;
    }

    await stamp(`FB-014 BEFORE row click · ${slot.label} · q=${target.q} · date=${target.day}`);
    await page.screenshot({ path: `${OUT}/fb014-${slot.file}-before.png` });

    const beforeUrl = page.url();
    await page.mouse.click(hit.x, hit.y);

    let navigated = true;
    try {
      await page.waitForFunction(() => location.pathname === '/dispatch-detail', { timeout: 15000 });
    } catch {
      navigated = false;
    }
    await sleep(3000);

    const after = await page.evaluate(() => {
      const params = new URLSearchParams(location.search);
      // Both day/month/year segments of the Từ → Đến scope (each
      // BufferedUuiDateInput owns 3 inputs; the base id is only the day one).
      const inputs = [...document.querySelectorAll('[aria-label="Khoảng ngày vận chuyển"] input')];
      const table = document.querySelector('.detailed-plan-grid');
      const bodyRows = table ? [...table.querySelectorAll('tbody tr')] : [];
      return {
        url: location.pathname + location.search,
        pathname: location.pathname,
        q: params.get('q'),
        date: params.get('date'),
        heading: document.querySelector('.detailed-plan-header__title')?.textContent ?? null,
        searchValue: document.querySelector('input[aria-label="Tìm nhanh"]')?.value ?? null,
        dateInputs: inputs.map((i) => i.value),
        topbarMonth: document.querySelector('.topbar-date__label')?.textContent ?? null,
        boardRows: bodyRows.length,
        boardFirstRowText: bodyRows[0]?.textContent?.slice(0, 220) ?? null,
        boardEmptyState: document.querySelector('.detailed-plan-grid')?.innerText.slice(0, 300) ?? null,
      };
    });
    const scopedRequest = detailRequests.find((u) => u.includes('q=') || u.includes('date='));
    const latestRequest = detailRequests[detailRequests.length - 1] ?? null;

    await stamp(`FB-014 AFTER row click · ${slot.label} · q=${target.q} · date=${target.day}`);
    await page.screenshot({ path: `${OUT}/fb014-${slot.file}-after-row-click.png` });
    fs.writeFileSync(`${OUT}/fb014-${slot.file}-dom.txt`,
      `URL: ${after.url}\nq=${after.q} date=${after.date}\nheading=${after.heading}\n`
      + `dateInputs=${JSON.stringify(after.dateInputs)} topbarMonth=${after.topbarMonth}\nboardRows=${after.boardRows}\n`
      + `wire=${scopedRequest ?? 'none'}\n\n${await page.evaluate(() => document.body.innerText)}`, 'utf8');

    const [isoY, isoM, isoD] = target.day.split('-');
    const expectedScope = `${isoD}${isoM}${isoY}`; // both fields' DD MM YYYY segments
    const scopeJoined = after.dateInputs.join('');
    const checks = {
      navigatedToDispatchDetail: navigated && after.pathname === '/dispatch-detail',
      qSeeded: after.q === target.q,
      dateSeeded: after.date === target.day,
      headingOk: after.heading === 'Kế hoạch Chi tiết Xe',
      boardPopulated: after.boardRows > 0,
      scopeMatchesDate: scopeJoined === `${expectedScope}${expectedScope}`
        || scopeJoined === `${isoD}/${isoM}/${isoY}${isoD}/${isoM}/${isoY}`,
      topbarMonthUnchanged: after.topbarMonth === 'Tháng 10/2026',
      wireCarriesScope: Boolean(scopedRequest && scopedRequest.includes(`date=${target.day}`)),
    };
    log('after_row_click', { attemptId, beforeUrl, ...after, scopedRequest: scopedRequest ?? null, latestRequest, checks, consoleErrors });

    const pass = Object.values(checks).every(Boolean);
    results.push({ slot: slot.file, label: slot.label, ...target, pass, checks, url: after.url, boardRows: after.boardRows });
    done = pass;
    if (!pass) log('attempt_incomplete', { attemptId, checks });
  }
  if (!done) results.push({ slot: slot.file, label: slot.label, pass: false, error: 'no candidate attempt passed' });
}

// ── Quick-view affordance keeps its own trigger ──────────────────────────────
await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(3500);
const triggerInfo = await page.evaluate(() => {
  const btn = document.querySelector('.master-plan-grid__container-detail-trigger');
  if (!btn) return { found: false };
  btn.scrollIntoView({ block: 'center', behavior: 'instant' });
  const r = btn.getBoundingClientRect();
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, label: btn.getAttribute('aria-label') ?? btn.textContent };
});
log('quick_view_trigger', { ...triggerInfo });
let quickView = { opened: false };
if (triggerInfo.found) {
  await page.mouse.click(triggerInfo.x, triggerInfo.y);
  await sleep(2500);
  quickView = await page.evaluate(() => ({
    drawerPresent: Boolean(document.querySelector('.dispatch-container-detail-drawer')),
    dialogTitle: document.querySelector('.dispatch-container-detail-drawer [role="dialog"] .drawer__title')?.textContent
      ?? document.querySelector('.dispatch-container-detail-drawer')?.textContent?.slice(0, 80) ?? null,
    pathname: location.pathname,
  }));
  quickView.opened = quickView.drawerPresent && quickView.pathname === '/dispatch';
  await stamp('FB-014 quick-view "Chi tiết" trigger → "Chi tiết container" drawer');
  await page.screenshot({ path: `${OUT}/fb014-03-quickview-drawer.png` });
  log('quick_view_after_click', { ...quickView });
}
results.push({ slot: '03-quickview', label: "quick-view drawer still on its own 'Chi tiết' trigger", pass: Boolean(quickView.opened), ...quickView });

log('verdict', {
  results,
  allPass: results.every((r) => r.pass),
  consoleErrors,
});
flush();
await browser.close();
log('done', {});
flush();
