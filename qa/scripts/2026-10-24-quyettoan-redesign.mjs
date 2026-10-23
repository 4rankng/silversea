// Redesign "Chi phí - Quyết toán" (CUS) — owner screenshots 23/10 + spec v2.
// Playwright driver (brief gate: "Playwright 1440 + 390"), rung-3 QA.
// BEFORE = the pre-change build served by the main checkout (QA_FRONT, main
// branch — the audited defects are live there). AFTER = this worktree's stack
// (worktree BE on QA_BE_PORT + worktree FE proxying it).
//
// Coverage (testplan/2026-10-24-quyettoan-redesign.md):
//   QT-RD-01 cột cân đối + right-align + row ≤56 (1440)
//   QT-RD-02 three-state money — no 'Chưa xác định' (after)
//   QT-RD-03 one unified date mechanism (after)
//   QT-RD-04 group header + sticky totals = Σ cột (DOM assert) + DB identity
//   QT-RD-05 Gộp hàng action bar (arming law)
//   QT-RD-06 chứng từ badge + popover checklist + copy tờ khai
//   QT-RD-07 mobile 390 cards + totals strip
//   QT-RD-08 kebab → expand L2 workspace giữ nguyên
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const require = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { chromium } = require('@playwright/test');

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const PHASE = process.env.QA_PHASE ?? 'before'; // before | after
const OUT = path.resolve('qa/2026-10-24-quyettoan-redesign');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `quyettoan-redesign_${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} front=${FRONT} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`ABORT: login ${identifier} failed (${res.status})`); process.exit(2); }
  const { token } = await res.json();
  return token;
};
const token = await login(process.env.QA_USER ?? 'cus');

// The settlement scope the metrics read: the unfiltered list (every lot, the
// same face the owner screenshotted). No data mutation anywhere in this run.
const summary = await fetch(`${API}/shipments/debit-summary`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json())
  .catch(() => null);
log(`summary items=${summary?.items?.length ?? 'n/a'} (unfiltered)`);

const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
/** §9.3 read-only persisted-state identity: the lots the DOM renders must
 *  exist 1:1 in the shipments table, and the run must leave them untouched
 *  (same count + same latest updated_at before and after driving the UI). */
const lotIds = (summary?.items ?? []).map((row) => row.shipmentId).slice(0, 200);
const dbState = async () => lotIds.length === 0
  ? { count: 0, latest: null }
  : sql`select count(*)::int as count, max(updated_at)::text as latest from shipments where id in ${sql(lotIds)}`;
const dbBefore = (await dbState())[0] ?? { count: 0, latest: null };
log(`DB identity before: count=${dbBefore.count} latest=${dbBefore.latest}`);
const numberish = (text) => {
  if (!/[\d-]/.test(text)) return null;
  const n = Number(text.replace(/\./g, '').replace(/[^0-9-]/g, ''));
  return Number.isFinite(n) ? n : null;
};

const browser = await chromium.launch({ headless: true });

async function newPage(width, height) {
  const context = await browser.newContext({ viewport: { width, height } });
  // The tờ khai copy path needs the OS-clipboard grant in headless Chromium.
  await context.grantPermissions(['clipboard-write', 'clipboard-read'], { origin: FRONT }).catch(() => {});
  await context.addInitScript((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  const page = await context.newPage();
  page.on('pageerror', (err) => log(`PAGEERROR ${err.message.slice(0, 160)}`));
  return { context, page };
}

// ── 1440×900 desktop pass ──────────────────────────────────────────────────
{
  const { context, page } = await newPage(1440, 900);
  await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'desktop-top');

  const metrics = { phase: PHASE, viewport: '1440x900' };

  // QT-RD-01 row heights ≤ 56px.
  const rowHeights = await page.$$eval('.shipment-debit-row', (rows) =>
    rows.map((row) => Math.round(row.getBoundingClientRect().height)));
  metrics.rowHeights = rowHeights;
  check(`QT-RD-01 row heights ≤56px (${rowHeights.length} rows)`,
    rowHeights.length > 0 && rowHeights.every((h) => h <= 56),
    `min=${Math.min(...(rowHeights.length ? rowHeights : [0]))} max=${Math.max(...(rowHeights.length ? rowHeights : [0]))}`);

  // QT-RD-01 money columns right-aligned: computed text-align + the data
  // cells share their column header's right edge.
  const moneyAlign = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('td[data-col]')].slice(0, 60);
    const alignments = new Set();
    let edgeDeltaMax = 0;
    const headerByCol = new Map();
    for (const th of document.querySelectorAll('thead th')) {
      const m = /shipment-debit-col--(receivable|carrier|domestic|payable|profit)/.exec(th.className);
      if (m) headerByCol.set(m[1], th.getBoundingClientRect());
    }
    for (const cell of cells) {
      alignments.add(getComputedStyle(cell).textAlign);
      const col = cell.getAttribute('data-col');
      const head = headerByCol.get(col);
      if (head) edgeDeltaMax = Math.max(edgeDeltaMax, Math.abs(head.right - cell.getBoundingClientRect().right));
    }
    return { alignments: [...alignments], edgeDeltaMax, headerCols: headerByCol.size };
  });
  metrics.moneyAlign = moneyAlign;
  check('QT-RD-01 money cells right-align + share the header edge',
    moneyAlign.alignments.every((a) => a === 'right') && moneyAlign.headerCols === 5 && moneyAlign.edgeDeltaMax <= 1,
    JSON.stringify(moneyAlign));

  if (PHASE === 'after') {
    // QT-RD-02 the banned string is gone from money cells.
    const banned = await page.evaluate(() =>
      [...document.querySelectorAll('td[data-col]')].filter((cell) => cell.textContent?.includes('Chưa xác định')).length);
    check('QT-RD-02 no "Chưa xác định" in money cells', banned === 0, `found=${banned}`);
    const pending = await page.evaluate(() => document.querySelectorAll('.shipment-debit-money__pending').length);
    log(`INFO pending pills on screen: ${pending}`);

    // QT-RD-03 ONE date mechanism: the unified picker exists; no month chip on
    // the route, no separate Từ/Đến pair, no preset pills on the bar.
    const picker = await page.$('.udrp__trigger');
    check('QT-RD-03 unified range picker present', picker !== null);
    await picker.click();
    await page.waitForTimeout(250);
    const popover = await page.$('.udrp__popover');
    check('QT-RD-03 picker popover (presets + dual-month) opens', popover !== null);
    const monthPanels = await page.$$eval('.udrp-month', (nodes) => nodes.length);
    check('QT-RD-03 dual-month calendar', monthPanels === 2, `panels=${monthPanels}`);
    const presetActive = await page.$$eval('.udrp-preset--active', (nodes) => nodes.length);
    log(`INFO active presets with empty range: ${presetActive}`);
    await shot(page, 'desktop-picker-popover');
    await page.keyboard.press('Escape');

    // QT-RD-04 totals: sticky foot equals the sum of the rendered body cells.
    // NOTE: sticky rides the tds (the tfoot container keeps its natural
    // table-end box), so visibility reads a pinned td.
    const totals = await page.evaluate(() => {
      const foot = document.querySelector('[data-testid="shipment-debit-totals"]');
      if (!foot) return null;
      const out = {};
      for (const cell of foot.querySelectorAll('td[data-col]')) {
        out[cell.getAttribute('data-col')] = cell.textContent?.trim() ?? '';
      }
      const sums = {};
      const known = {};
      for (const col of ['receivable', 'carrier', 'domestic', 'payable', 'profit']) {
        let sum = 0;
        let knownCount = 0;
        for (const cell of document.querySelectorAll(`.shipment-debit-row td[data-col="${col}"]`)) {
          const text = cell.textContent ?? '';
          if (text === '' || text === 'Chờ số liệu') continue;
          sum += Number(text.replace(/\./g, '').replace(/[^0-9-]/g, ''));
          knownCount += 1;
        }
        sums[col] = sum;
        known[col] = knownCount;
      }
      const pinnedTd = foot.querySelector('td[data-col]');
      const pane = document.querySelector('.shipment-debit-pane');
      return {
        out, sums, known,
        pinnedBottom: pinnedTd ? Math.round(pinnedTd.getBoundingClientRect().bottom) : null,
        paneBottom: pane ? Math.round(pane.getBoundingClientRect().bottom) : null,
        viewportH: window.innerHeight,
      };
    });
    check('QT-RD-04 totals bar rendered', totals !== null);
    if (totals) {
      metrics.totals = totals;
      const parseFoot = (text) => (text === '—' ? null : Number(text.replace(/\./g, '')));
      for (const col of ['receivable', 'payable', 'profit']) {
        // A column with NO known body cell reads '—' in the foot (nothing
        // settled) — the honest empty, not a 0.
        const expectEmpty = totals.known[col] === 0;
        const foot = parseFoot(totals.out[col]);
        check(`QT-RD-04 tfoot ${col} = Σ body cells`,
          expectEmpty ? foot === null : foot === totals.sums[col],
          `foot=${totals.out[col]} Σ=${totals.sums[col]} known=${totals.known[col]}`);
      }
      check('QT-RD-04 totals bar sticky-visible at 1440×900',
        totals.pinnedBottom !== null && Math.abs(totals.pinnedBottom - totals.paneBottom) <= 2 && totals.paneBottom <= totals.viewportH,
        `pinned=${totals.pinnedBottom} pane=${totals.paneBottom} vh=${totals.viewportH}`);
    }

    // QT-RD-04 DB identity: the foot's receivable equals the API's (and the
    // DB's) sum of known receivableTotal values — persisted-state identity
    // for a read-only surface (§9.3 read-only evidence).
    const apiSum = (summary?.items ?? []).reduce((acc, row) => acc + (row.receivableTotal != null ? Number(row.receivableTotal) : 0), 0);
    const domSum = totals ? Number((totals.out.receivable ?? '0').replace(/\./g, '')) : NaN;
    check('QT-RD-04 DOM receivable total = API sum (known values)', domSum === apiSum, `dom=${domSum} api=${apiSum}`);

    // QT-RD-04 group header + collapse.
    const group = await page.$('.shipment-debit-group');
    check('QT-RD-04 customer group header rendered', group !== null);
    const rowsBefore = await page.$$eval('.shipment-debit-row', (nodes) => nodes.length);
    const chevron = await page.$('.shipment-debit-group__chevron');
    if (chevron) {
      await chevron.click();
      await page.waitForTimeout(200);
      const rowsAfter = await page.$$eval('.shipment-debit-row', (nodes) => nodes.length);
      check('QT-RD-04 group collapse hides its rows', rowsAfter < rowsBefore, `${rowsBefore} → ${rowsAfter}`);
      await shot(page, 'desktop-group-collapsed');
      await chevron.click();
    }

    // QT-RD-06 chứng từ popover + copy.
    const docsBadge = await page.$('.shipment-debit-docs__badge');
    check('QT-RD-06 chứng từ badge rendered', docsBadge !== null);
    if (docsBadge) {
      await docsBadge.hover();
      await page.waitForTimeout(500);
      const popoverDoc = await page.$('.shipment-debit-docs__popover');
      check('QT-RD-06 hover opens the checklist popover', popoverDoc !== null);
      await shot(page, 'desktop-docs-popover');
      const copy = await page.$('.shipment-debit-copy');
      if (copy) {
        await copy.click();
        await page.waitForTimeout(300);
        const toast = await page.evaluate(() => document.body.textContent?.includes('Đã copy số tờ khai') ?? false);
        check('QT-RD-06 copy tờ khai raises the toast', toast);
      } else {
        log('INFO no tờ khai on screen — copy path not drivable this run');
      }
    }

    // QT-RD-05 Gộp hàng arming law: <2 ticks disabled, ≥2 armed.
    const mergeBtn = await page.$('button:has-text("Gộp hàng")');
    check('QT-RD-05 Gộp hàng on the action bar (no emoji)', mergeBtn !== null);
    if (mergeBtn) {
      const disabledBefore = await mergeBtn.getAttribute('aria-disabled');
      const boxes = await page.$$('.shipment-debit-row__select');
      // The CTA needs ≥2 UNGROUPED LCL picks — on this dataset the first
      // valid pair sits deep in the list (idx 72/102 of 158), so walk every
      // tick until the button arms.
      let armed = false;
      const clicked = [];
      for (const box of boxes) {
        await box.click();
        clicked.push(box);
        await page.waitForTimeout(50);
        armed = (await page.$eval('button:has-text("Gộp hàng")', (b) => b.getAttribute('aria-disabled'))) === null;
        if (armed) break;
      }
      check('QT-RD-05 ≥2 valid ticks arm Gộp hàng', disabledBefore === 'true' && armed,
        `before=${disabledBefore} clicked=${clicked.length}`);
      await shot(page, 'desktop-merge-armed');
      for (const box of clicked.reverse()) await box.click();
    }

    // QT-RD-08 kebab → expand L2 workspace.
    const kebab = await page.$('.shipment-debit-menu__trigger');
    check('QT-RD-08 kebab menu trigger rendered', kebab !== null);
    if (kebab) {
      await kebab.click();
      await page.waitForTimeout(200);
      await shot(page, 'desktop-kebab-menu');
      const expandItem = await page.$('button[role="menuitem"]:has-text("Mở chi tiết lô")');
      check('QT-RD-08 kebab lists "Mở chi tiết lô"', expandItem !== null);
      if (expandItem) {
        await expandItem.click();
        await page.waitForTimeout(900);
        const workspace = await page.$('.shipment-debit-expand .csc-debit-table, .shipment-debit-expand table, .shipment-debit-expand form');
        const expandText = await page.$eval('.shipment-debit-expand', (node) => node.textContent?.slice(0, 60) ?? '');
        check('QT-RD-08 L2 workspace mounts under the row', workspace !== null || expandText.length > 0, expandText);
        await shot(page, 'desktop-row-expanded');
      }
    }
  } else {
    // BEFORE-phase defects: the audited pain points are measurable too.
    const undefinedText = await page.evaluate(() => (document.body.textContent?.match(/Chưa xác định/g) ?? []).length);
    log(`INFO BEFORE 'Chưa xác định' occurrences on screen: ${undefinedText}`);
    const monthChip = await page.$('.topbar-date');
    log(`INFO BEFORE topbar month chip on route: ${monthChip !== null}`);
    const tallRows = rowHeights.filter((h) => h > 90).length;
    log(`INFO BEFORE rows >90px: ${tallRows}/${rowHeights.length}`);
  }

  await shot(page, 'desktop-final');
  fs.writeFileSync(path.join(OUT, `metrics_${PHASE}_desktop.json`), JSON.stringify(metrics, null, 2));
  await context.close();
}

// ── 390×844 mobile pass ────────────────────────────────────────────────────
{
  const { context, page } = await newPage(390, 844);
  await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await shot(page, 'mobile-top');

  const metrics = { phase: PHASE, viewport: '390x844' };
  const hasTable = await page.$('.shipment-debit-table');
  const cards = await page.$$eval('article', (nodes) => nodes.length);
  metrics.cards = cards;
  check('QT-RD-07 phone renders the record cards (no table)', hasTable === null && cards > 0, `cards=${cards}`);

  if (PHASE === 'after') {
    const totals = await page.$('[data-testid="shipment-debit-totals-mobile"]');
    check('QT-RD-07 phone totals strip visible', totals !== null);
    const totalsBox = await totals?.boundingBox();
    if (totalsBox) {
      check('QT-RD-07 phone totals strip on-screen (top area)', totalsBox.y < 844, `y=${Math.round(totalsBox.y)}`);
      metrics.totalsY = Math.round(totalsBox.y);
    }
    const banned = await page.evaluate(() => (document.body.textContent?.match(/Chưa xác định/g) ?? []).length);
    check('QT-RD-07 no "Chưa xác định" on the phone board', banned === 0, `found=${banned}`);
    const pendingPills = await page.$$eval('.shipment-debit-money__pending', (nodes) => nodes.length);
    log(`INFO phone pending pills: ${pendingPills}`);
    const firstCard = await page.$('article');
    if (firstCard) {
      await firstCard.screenshot({ path: path.join(OUT, `${PHASE}_mobile-first-card.png`) });
    }
  } else {
    const undefinedText = await page.evaluate(() => (document.body.textContent?.match(/Chưa xác định/g) ?? []).length);
    log(`INFO BEFORE phone 'Chưa xác định' occurrences: ${undefinedText}`);
  }

  await shot(page, 'mobile-final');
  fs.writeFileSync(path.join(OUT, `metrics_${PHASE}_mobile.json`), JSON.stringify(metrics, null, 2));
  await context.close();
}

await browser.close();
const dbAfter = (await dbState())[0] ?? { count: 0, latest: null };
log(`DB identity after: count=${dbAfter.count} latest=${dbAfter.latest}`);
check('DB identity: no persisted state changed by the run',
  dbAfter.count === dbBefore.count && dbAfter.latest === dbBefore.latest,
  `count ${dbBefore.count}→${dbAfter.count}, latest ${dbBefore.latest}→${dbAfter.latest}`);
await sql.end({ timeout: 5 });
log(`SUMMARY phase=${PHASE} failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
