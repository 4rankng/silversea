// FB-014 (card 201026112500, R26 standing repro) — BEFORE drive on the UNFIXED
// local build (:7175, main bf3a0ff9 lineage). Read-only.
//
// Repro verbatim: "Ở màn Điều vận: CLICK VÀO 1 LÔ (row lot) chỉ mở QUICK-VIEW
// (popup xem nhanh)" — expected: reach /dispatch-detail (Kế hoạch Chi tiết).
//
// Steps:
//  1. dieuvan → /dispatch, wait for the master-plan grid rows.
//  2. Click the row's lot-detail affordance ('Chi tiết' quick-view trigger)
//     → record what opens (quick-view drawer? URL change?).
//  3. Close it, click the ROW body (non-button cell) → record navigation.
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
await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
await page.goto(`${BASE}/dispatch`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(3000);

const rowCount = await page.evaluate(() => document.querySelectorAll('.master-plan-grid__row').length);
log('grid_rows', { rowCount });
if (rowCount === 0) { log('BLOCKED_no_rows', {}); await page.screenshot({ path: `${OUT}/before_ui-00-dispatch-empty.png` }); process.exit(3); }
await page.screenshot({ path: `${OUT}/before_ui-01-dispatch-grid.png` });

// Step 2 — the lot-detail affordance QA clicked ('Chi tiết' quick-view trigger).
await page.evaluate(() => {
  const btn = document.querySelector('.master-plan-grid__container-detail-trigger');
  btn?.scrollIntoView({ block: 'center' });
});
await sleep(300);
await page.click('.master-plan-grid__container-detail-trigger');
await sleep(1500);
const afterDetailClick = await page.evaluate(() => ({
  url: location.pathname + location.search,
  quickViewDrawerOpen: Boolean(document.querySelector('.dispatch-container-detail-drawer')),
  dialogRole: Boolean(document.querySelector('[role="dialog"]')),
  drawerHeading: document.querySelector('.dispatch-container-detail-drawer h2, .dispatch-container-detail-drawer [class*="title"]')?.textContent?.trim() ?? null,
}));
log('click_chi_tiet_trigger', afterDetailClick);
await page.screenshot({ path: `${OUT}/before_ui-02-click-lot-quickview.png` });
fs.writeFileSync(`${OUT}/before_dom-02-click-lot-quickview.txt`, await page.evaluate(() => document.body.innerText));

// Close the drawer for step 3.
await page.keyboard.press('Escape');
await sleep(800);
const drawerStillOpen = await page.evaluate(() => Boolean(document.querySelector('.dispatch-container-detail-drawer')));
if (drawerStillOpen) {
  const closeBtn = await page.$('.dispatch-container-detail-drawer button[aria-label="Đóng"], .dispatch-container-detail-drawer [class*="close"]');
  await closeBtn?.click();
  await sleep(800);
}

// Step 3 — click the ROW body (a plain data cell, no button) like QA's "click vào 1 lô".
const afterRowClick = await page.evaluate(() => {
  const row = document.querySelector('.master-plan-grid__row');
  if (!row) return { rowFound: false };
  const cells = [...row.querySelectorAll('td')];
  const plain = cells.find((td) => !td.querySelector('button, input, select, textarea') && !td.className.includes('--action') && !td.className.includes('--select'));
  if (!plain) return { rowFound: true, plainCell: false };
  plain.click();
  return { rowFound: true, plainCell: true, cellLabel: tdLabel(plain) };
  function tdLabel(td) { return td.getAttribute('data-label') ?? ''; }
});
await sleep(1500);
const urlAfterRowClick = await page.evaluate(() => location.pathname + location.search);
log('click_row_body', { ...afterRowClick, urlAfter: urlAfterRowClick, navigatedToDispatchDetail: urlAfterRowClick.includes('/dispatch-detail') });
await page.screenshot({ path: `${OUT}/before_ui-03-click-row-body.png` });

log('verdict_before', {
  quickViewOnDetailTrigger: afterDetailClick.quickViewDrawerOpen,
  rowBodyNavigates: urlAfterRowClick.includes('/dispatch-detail'),
  expected_navigate_to_dispatch_detail: false,
  consoleErrors: errors,
});
fs.writeFileSync(`${OUT}/before_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8');
await browser.close();
log('done', {});
