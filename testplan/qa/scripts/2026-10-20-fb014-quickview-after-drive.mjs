// FB-014 (card 201026112500, QA R26 standing repro) — AFTER drive on the
// FIXED local build (:7175, this worktree). Read-only.
//
// Expected now:
//  1. Clicking the lot ROW body navigates to /dispatch-detail?q=<Số Bill |
//     Booking | shipment code>&date=<day> and the board shows the lot's rows.
//  2. The quick-view container drawer stays on its own 'Chi tiết' trigger.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb014-quickview');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, base: BASE });

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
});
if (!loginRes.ok) { console.error(`BLOCKED: login dieuvan -> ${loginRes.status}`); process.exit(2); }
const { token, user } = await loginRes.json();
log('login', { user: user?.username, role: user?.role });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
const detailPlanRequests = [];
page.on('request', (req) => {
  if (req.url().includes('/dispatch-detail-plan-rows')) detailPlanRequests.push(req.url());
});
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(3000);

const rowCount = await page.evaluate(() => document.querySelectorAll('.master-plan-grid__row').length);
log('grid_rows', { rowCount });
if (rowCount === 0) { log('BLOCKED_no_rows', {}); process.exit(3); }

// Identity of the lot whose row we will click (for the wire assertion).
// Prefer a row that carries a Bill/Booking so the deep link's q scope is
// visible; adhoc rows without any reference fall back to day scope only.
const clickedLot = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.master-plan-grid__row')];
  // Richest evidence first: a lot with an explicit "Bill: <ref>" line AND a
  // schedule (fulfillments exist on the detail board for it).
  const pick = rows.find((r) => /[A-Z]{4}[A-Z0-9]{7}/.test(r.textContent ?? ''))
    ?? rows[0];
  if (!pick) return { rowFound: false };
  const cells = [...pick.querySelectorAll('td')];
  const plain = cells.find((td) => !td.querySelector('button, input, select, textarea')
    && !td.className.includes('--action') && !td.className.includes('--select'));
  if (!plain) return { rowFound: true, plainCell: false };
  plain.click();
  return {
    rowFound: true,
    plainCell: true,
    rowText: (pick.textContent ?? '').slice(0, 200),
    tabIndex: pick.tabIndex,
    className: pick.className,
  };
});
log('clicked_row', clickedLot);
await sleep(2500);

const afterRowClick = await page.evaluate(() => ({
  url: location.pathname + location.search,
  onDispatchDetail: location.pathname === '/dispatch-detail',
  boardRows: document.querySelectorAll('tbody tr').length,
  boardText: document.body.innerText.slice(0, 1500),
}));
log('after_row_click', afterRowClick);
await page.screenshot({ path: `${OUT}/after_ui-01-row-click-dispatch-detail.png` });
fs.writeFileSync(`${OUT}/after_dom-01-dispatch-detail.txt`, await page.evaluate(() => document.body.innerText));

// The deep-linked board request must carry the lot scope (q and/or the day).
const scopedRequest = detailPlanRequests.find((u) => u.includes('q=') || u.includes('date='));
log('wire_deep_link_request', { scopedRequest: scopedRequest ?? null, allRequests: detailPlanRequests.slice(0, 3) });

// The quick-view affordance survives on its own trigger.
await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(2500);
await page.evaluate(() => {
  const btn = document.querySelector('.master-plan-grid__container-detail-trigger');
  btn?.scrollIntoView({ block: 'center' });
});
await sleep(300);
await page.click('.master-plan-grid__container-detail-trigger');
await sleep(1500);
const quickViewStillThere = await page.evaluate(() => ({
  url: location.pathname,
  quickViewDrawerOpen: Boolean(document.querySelector('.dispatch-container-detail-drawer')),
}));
log('quick_view_affordance_kept', quickViewStillThere);
await page.screenshot({ path: `${OUT}/after_ui-02-quickview-still-on-trigger.png` });

log('verdict_after', {
  rowNavigatesToDispatchDetail: afterRowClick.onDispatchDetail,
  deepLinkScoped: Boolean(scopedRequest),
  quickViewKept: quickViewStillThere.quickViewDrawerOpen,
  consoleErrors: errors,
});
fs.writeFileSync(`${OUT}/after_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
await browser.close();
log('done', {});
