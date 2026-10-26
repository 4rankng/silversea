// SIL-504 UI drive — hàng lẻ vs cont distinction + cargo-cell empty label.
//
// A. /shipments (CUS board, 1440): with the month date filter active, an LCL
//    row shows the SHORT empty label "Chưa chọn hàng lẻ" (old three-line
//    "Không có hàng lẻ chạy ngày đã chọn" must be gone) and its direction
//    badge reads "Nhập lẻ" while an adjacent cont row keeps the plain
//    "Nhập". Read-only: no cell edits, GETs only.
// B. /shipments-detail (1440): the lot-level row's Nhập/Xuất cell reads
//    "Nhập lẻ" next to container rows' plain labels. Read-only (the SIL-503
//    lane owns the ledger cell render — this drive only observes).
//
// Usage: cd frontend && node ../qa/scripts/2026-10-26-sil504-ui-drive.mjs
// Output: qa/2026-10-26-sil504/*.png + JSON assertions on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
// Local dev CUS account — testplan/testaccounts.txt (local rule, password line).
const QA_USER = process.env.QA_USER || 'cus';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve(process.cwd(), '../qa/2026-10-26-sil504');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

const results = { A: {}, B: {} };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Login through the real form (shared-context storage cleared first —
 *  /login redirects authenticated sessions to their home). */
async function login(user, pass) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('/api/')) apiCalls.push(`${r.method()} ${new URL(url).pathname}`);
  });
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (page.url().includes('login')) throw new Error(`login failed for ${user}`);
  return { page, apiCalls };
}

// ── A. /shipments — badge + short empty label (1440) ───────────────────────
{
  const { page, apiCalls } = await login(QA_USER, QA_PASS);
  // Month filter mirrors the ticket screenshot (Tháng 10/2026 · 01/10–31/10);
  // containerless LCL lots have no appointment groups in any window, so the
  // cargo cell shows the day-filter empty label.
  await page.goto(`${FE}/shipments?transportDateFrom=2026-10-01&transportDateTo=2026-10-31`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.cus-dashboard-table', { timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('.cus-dashboard-table tbody tr').length > 0, { timeout: 45000 });
  await sleep(500);

  results.A = await page.evaluate(() => {
    const badges = [...document.querySelectorAll('.cus-direction-badge')].map((b) => b.textContent.trim());
    const rows = [...document.querySelectorAll('.cus-dashboard-table tbody tr')];
    const lclRowIdx = rows.findIndex((tr) => tr.querySelector('.cus-direction-badge')?.textContent.trim() === 'Nhập lẻ');
    const plainRowIdx = rows.findIndex((tr) => ['Nhập', 'Xuất'].includes(tr.querySelector('.cus-direction-badge')?.textContent.trim() ?? ''));
    const adjacentPair = lclRowIdx >= 0 && plainRowIdx >= 0 && Math.abs(lclRowIdx - plainRowIdx) === 1;
    const emptyLabel = [...document.querySelectorAll('.cus-cargo-summary__containers.cus-empty')]
      .map((el) => ({ text: el.textContent.trim(), height: el.getBoundingClientRect().height }));
    return {
      badges,
      hasLclBadge: badges.includes('Nhập lẻ') || badges.includes('Xuất lẻ'),
      hasPlainBadge: badges.includes('Nhập') || badges.includes('Xuất'),
      adjacency: { lclRowIdx, plainRowIdx, adjacentPair },
      oldLongLabelPresent: document.body.innerText.includes('Không có hàng lẻ chạy ngày đã chọn'),
      newShortLabel: emptyLabel.find((l) => l.text === 'Chưa chọn hàng lẻ') ?? null,
      fclLabelPresent: document.body.innerText.includes('Không có cont chạy ngày đã chọn'),
      emptyLabels: emptyLabel,
    };
  });
  await page.screenshot({ path: resolve(OUT, 'A-shipments-1440-lcl-cont-rows.png') });
  // POST /api/auth/* is the login itself, not a data mutation.
  results.A.mutatorApiCalls = apiCalls.filter((c) => !c.startsWith('GET ') && !c.startsWith('POST /api/auth/'));
  await page.close();
}

// ── B. /shipments-detail — lot row badge next to cont rows (1440) ──────────
{
  const { page, apiCalls } = await login(QA_USER, QA_PASS);
  await page.goto(`${FE}/shipments-detail?dateScope=all&limit=200`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger', { timeout: 45000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.shipment-container-ledger__direction').length > 0, { timeout: 45000 });
  await sleep(500);

  results.B = await page.evaluate(() => {
    const dirs = [...document.querySelectorAll('.shipment-container-ledger__direction')].map((b) => b.textContent.trim());
    return {
      directions: dirs,
      hasLotLclLabel: dirs.includes('Nhập lẻ') || dirs.includes('Xuất lẻ'),
      hasPlainLabel: dirs.includes('Nhập') || dirs.includes('Xuất'),
    };
  });
  await page.screenshot({ path: resolve(OUT, 'B-shipments-detail-1440-lot-row-badge.png') });
  results.B.mutatorApiCalls = apiCalls.filter((c) => !c.startsWith('GET ') && !c.startsWith('POST /api/auth/'));
  await page.close();
}

await browser.close();
writeFileSync(resolve(OUT, 'ui-drive-assertions.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

const aOk = results.A.hasLclBadge && results.A.hasPlainBadge && results.A.adjacency.adjacentPair
  && !results.A.oldLongLabelPresent && results.A.newShortLabel && results.A.newShortLabel.height <= 24
  && results.A.fclLabelPresent && results.A.mutatorApiCalls.length === 0;
const bOk = results.B.hasLotLclLabel && results.B.hasPlainLabel && results.B.mutatorApiCalls.length === 0;
if (!aOk || !bOk) {
  console.error(`ASSERT FAILED: A=${aOk} B=${bOk}`);
  process.exit(1);
}
console.log('SIL-504 UI drive: PASS');
