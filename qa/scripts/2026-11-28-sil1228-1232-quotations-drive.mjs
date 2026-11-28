#!/usr/bin/env node
/**
 * SIL-1228 … SIL-1232 — UI drive for /config/quotations (local dev stack).
 *
 * Drives the real screen as the Quản trị viên at 1440x900 and 390x844 and
 * MEASURES the five reported defects:
 *   SIL-1228  the three filter labels share ONE label line (and one control
 *             baseline) in the filter bar.
 *   SIL-1229  the fee catalog sits in a horizontal scroll host on a phone and
 *             the THAO TÁC button is reachable by scrolling.
 *   SIL-1230  the fee columns follow their content (STT narrow, PHÂN LOẠI
 *             wide) — no equal 163px share.
 *   SIL-1231  the empty detail state is centered on both axes of the visible
 *             detail column.
 *   SIL-1232  the lag strip carries no internal jargon ("engine").
 *
 * Usage: node qa/scripts/2026-11-28-sil1228-1232-quotations-drive.mjs
 * Env:   BASE_URL (default http://localhost:7175), ADMIN_PASS (default Abc123)
 * Out:   qa/2026-11-28_sil1228-1232_quotations/
 */
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7175';
const PASS = process.env.ADMIN_PASS || 'Abc123';
const OUT = join(process.cwd(), 'qa', '2026-11-28_sil1228-1232_quotations');
mkdirSync(OUT, { recursive: true });
const LOG = join(OUT, 'ui-driver.log');

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};

const failures = [];
function check(id, ok, detail) {
  log(`${ok ? 'PASS' : 'FAIL'} ${id} ${JSON.stringify(detail)}`);
  if (!ok) failures.push(`${id}: ${JSON.stringify(detail)}`);
}

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.locator('input[type="text"], input[name="username"], input[autocomplete="username"]').fill('admin');
await page.locator('input[type="password"]').fill(PASS);
await page.locator('button[type="submit"]').click();
await page.waitForFunction(() => /\/(dashboard|config|customers|penalties|expenses)/.test(location.pathname), { timeout: 20000 });
log('login ok →', page.url());

await page.goto(`${BASE}/config/quotations`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.quotation-frames', { timeout: 20000 });
await sleep(1200);

// ── SIL-1231 — empty detail state centered in the visible column ──────────
const empty = await page.evaluate(() => {
  const detail = document.querySelector('.quotation-detail');
  const state = detail?.querySelector('[class*="empty"], h3, p');
  const stateBox = state?.getBoundingClientRect();
  const detailBox = detail?.getBoundingClientRect();
  const rows = [...document.querySelectorAll('.quotation-detail .quotation-empty, .quotation-detail [class*="empty-state"]')];
  const target = rows[0] ?? state;
  const t = target?.getBoundingClientRect();
  return {
    detailTop: detailBox?.top ?? null,
    detailBottom: detailBox?.bottom ?? null,
    detailHeight: detailBox?.height ?? null,
    stateTop: t?.top ?? null,
    stateHeight: t?.height ?? null,
    stateCenter: t ? t.top + t.height / 2 : null,
    detailCenter: detailBox ? detailBox.top + detailBox.height / 2 : null,
    viewportHeight: window.innerHeight,
  };
});
await page.screenshot({ path: join(OUT, 'ui-1440-empty.png') });
log('SIL-1231 empty-state geometry', JSON.stringify(empty));
// The state sits on the column's vertical middle: its center is within 60px
// of the visible column's center (was ~215px above it).
check('SIL-1231-R1', Math.abs(empty.stateCenter - empty.detailCenter) <= 60, empty);

// ── SIL-1228 — the three filter labels share ONE label line ───────────────
const filterLabels = await page.evaluate(() => {
  const bar = document.querySelector('.filter-bar');
  const labelBox = (el) => {
    const r = el.getBoundingClientRect();
    return { top: Math.round(r.top), height: Math.round(r.height), left: Math.round(r.left), text: el.textContent.trim() };
  };
  const customer = bar.querySelector('.ds-uui-select [data-label]');
  const dates = [...bar.querySelectorAll('label')].filter((l) => /Từ ngày|Đến ngày/.test(l.textContent));
  const controls = {
    customer: bar.querySelector('.ds-uui-select [data-uui-control="select"]')?.getBoundingClientRect(),
    date: bar.querySelector('[data-input-wrapper] [data-uui-control="date"]')?.getBoundingClientRect(),
  };
  return {
    stacked: bar.querySelector('.ds-uui-select')?.className.includes('ds-uui-select--stacked') ?? false,
    labels: [customer, ...dates].filter(Boolean).map(labelBox),
    controlTops: {
      customer: controls.customer ? Math.round(controls.customer.top) : null,
      date: controls.date ? Math.round(controls.date.top) : null,
    },
  };
});
log('SIL-1228 filter labels', JSON.stringify(filterLabels));
const labelTops = filterLabels.labels.map((l) => l.top);
check('SIL-1228-R1 stacked opt-in', filterLabels.stacked, { stacked: filterLabels.stacked });
check(
  'SIL-1228-R1 one label line',
  labelTops.length === 3 && Math.max(...labelTops) - Math.min(...labelTops) <= 2,
  { labelTops },
);
check(
  'SIL-1228-R1 one control baseline',
  filterLabels.controlTops.customer != null
    && filterLabels.controlTops.date != null
    && Math.abs(filterLabels.controlTops.customer - filterLabels.controlTops.date) <= 2,
  { controlTops: filterLabels.controlTops },
);

// ── Open a frame — the fee catalog + the lag strip ────────────────────────
await page.locator('.quotation-frames [role="option"]').click();
await page.waitForSelector('.quotation-fees', { timeout: 20000 });
await sleep(800);

// ── SIL-1232 — no internal jargon on the strip ────────────────────────────
const lag = await page.evaluate(() => {
  const el = document.querySelector('.quotation-frame-summary__lag');
  return { text: el?.textContent.trim() ?? '', hasEngine: /engine/i.test(el?.textContent ?? '') };
});
log('SIL-1232 lag strip', JSON.stringify(lag));
check('SIL-1232-R1 business wording', !lag.hasEngine && /hệ thống tra giá dầu kỳ/.test(lag.text), lag);

// ── SIL-1230 — the fee columns follow their content ───────────────────────
const columns = await page.evaluate(() => {
  const table = document.querySelector('.quotation-fees__table');
  const heads = [...table.querySelectorAll('thead th')];
  const row = table.querySelector('tbody tr');
  const cells = [...(row?.children ?? [])];
  const headWidths = heads.map((h) => Math.round(h.getBoundingClientRect().width));
  const cellWidths = cells.map((c) => Math.round(c.getBoundingClientRect().width));
  const longest = [...table.querySelectorAll('tbody tr td:nth-child(3)')]
    .map((c) => Math.round(c.getBoundingClientRect().height));
  // The TRUE line count of the routing text: one client rect per line box.
  // (The cell's own height is the row height — the tallest sibling drives
  // it — so the rect count is the only honest line measure.)
  const categoryCell = row?.children[2];
  const categoryStyle = categoryCell ? getComputedStyle(categoryCell) : null;
  const categoryContentHeight = categoryCell && categoryStyle
    ? categoryCell.clientHeight - parseFloat(categoryStyle.paddingTop) - parseFloat(categoryStyle.paddingBottom)
    : null;
  const categoryLineHeight = categoryStyle ? parseFloat(categoryStyle.lineHeight) : null;
  let categoryLines = null;
  if (categoryCell) {
    const range = document.createRange();
    range.selectNodeContents(categoryCell);
    const rects = [...range.getClientRects()].filter((r) => r.height > 1);
    categoryLines = rects.length;
  }
  const sttCellHeight = row ? Math.round(row.children[0].getBoundingClientRect().height) : null;
  const categoryCellHeight = row ? Math.round(row.children[2].getBoundingClientRect().height) : null;
  return {
    sttCellHeight,
    categoryCellHeight,
    categoryContentHeight,
    categoryLineHeight,
    categoryLines,
    headers: heads.map((h) => h.textContent.trim()),
    headWidths,
    cellWidths,
    rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
    maxCategoryCellHeight: longest.length ? Math.max(...longest) : null,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    headerWraps: heads.map((h) => Math.round(h.getBoundingClientRect().height)),
  };
});
log('SIL-1230 fee columns', JSON.stringify(columns));
await page.screenshot({ path: join(OUT, 'ui-1440-fees.png') });
check(
  'SIL-1230-R1 no equal share',
  columns.headWidths.length === 7
    && columns.headWidths[0] <= 80
    && columns.headWidths[2] >= 240
    && new Set(columns.headWidths).size > 3,
  { headWidths: columns.headWidths },
);
check(
  'SIL-1230-R2 headers do not overlap',
  columns.headerWraps.every((h) => h <= 60),
  { headerWraps: columns.headerWraps },
);
// The long routing cell wraps to at most TWO lines (the STT cell is the
// one-line baseline): three lines were the reported defect.
check('SIL-1230-R1 category cell ≤ 2 lines', columns.categoryLines != null && columns.categoryLines <= 2, {
  categoryLines: columns.categoryLines,
  categoryContentHeight: columns.categoryContentHeight,
  categoryLineHeight: columns.categoryLineHeight,
  categoryCellHeight: columns.categoryCellHeight,
});

// ── SIL-1229 — phone: the catalog scrolls and THAO TÁC is reachable ───────
await page.setViewport({ width: 390, height: 844 });
await sleep(800);
const phone = await page.evaluate(() => {
  const host = document.querySelector('.quotation-fees .table-scroll');
  const table = document.querySelector('.quotation-fees__table');
  const hostBox = host?.getBoundingClientRect();
  return {
    hostFound: !!host,
    hostOverflowX: host ? getComputedStyle(host).overflowX : null,
    hostClientWidth: host?.clientWidth ?? null,
    hostScrollWidth: host?.scrollWidth ?? null,
    tableWidth: table ? Math.round(table.getBoundingClientRect().width) : null,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    hostBox: hostBox ? { left: Math.round(hostBox.left), right: Math.round(hostBox.right) } : null,
  };
});
log('SIL-1229 phone catalog', JSON.stringify(phone));
// The table overflows INSIDE the host and the host is the scroller; the page
// itself never scrolls sideways.
check(
  'SIL-1229-R1 scroll host',
  phone.hostFound && phone.hostOverflowX === 'auto' && phone.hostScrollWidth > phone.hostClientWidth,
  phone,
);
check('SIL-1229-R1 page does not scroll sideways', phone.documentScrollWidth <= phone.viewportWidth, phone);

// Scroll the host to the THAO TÁC column and prove the button is on screen.
const actionReachable = await page.evaluate(() => {
  const host = document.querySelector('.quotation-fees .table-scroll');
  const button = [...document.querySelectorAll('.quotation-fees__table tbody button')].pop();
  if (!host || !button) return { found: false };
  host.scrollLeft = host.scrollWidth;
  const hostBox = host.getBoundingClientRect();
  const box = button.getBoundingClientRect();
  return {
    found: true,
    label: button.textContent.trim(),
    scrollLeft: Math.round(host.scrollLeft),
    scrollWidth: host.scrollWidth,
    insideHost: box.left >= hostBox.left - 1 && box.right <= hostBox.right + 1,
    buttonBox: { left: Math.round(box.left), right: Math.round(box.right), width: Math.round(box.width) },
    visible: box.width > 0 && box.height > 0,
    disabled: button.disabled,
  };
});
log('SIL-1229 THAO TÁC reachability', JSON.stringify(actionReachable));
check(
  'SIL-1229-R1 action button reachable',
  actionReachable.found && actionReachable.insideHost && actionReachable.visible,
  actionReachable,
);
// Bring the catalog into view (the phone page is a long stack) and shoot it
// with the host scrolled to the THAO TÁC column.
await page.evaluate(() => {
  document.querySelector('.quotation-fees')?.scrollIntoView({ block: 'start' });
});
await sleep(500);
await page.screenshot({ path: join(OUT, 'ui-390-fees.png') });
await page.screenshot({ path: join(OUT, 'ui-390-fees-full.png'), fullPage: true });

// Two DOM-nesting warnings are PRE-EXISTING on this screen (main renders
// the same markup): the lag strip's <p class="quotation-frame-summary__params">
// wraps FrameLagEditor's <div class="ds-field">. The drive fails on any
// OTHER console error and reports these two by name.
const preExisting = consoleErrors.filter((e) => /cannot be a descendant of|cannot contain a nested/.test(e));
const newErrors = consoleErrors.filter((e) => !/cannot be a descendant of|cannot contain a nested/.test(e));
log('console errors (pre-existing DOM-nesting):', String(preExisting.length));
log('console errors (new):', JSON.stringify(newErrors.slice(0, 10)));
check('no NEW console errors', newErrors.length === 0, { count: newErrors.length, sample: newErrors.slice(0, 3) });

await browser.close();

log(failures.length === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures.length} CHECK(S) FAILED`);
log(failures.length === 0 ? 'EXIT 0' : `EXIT 1 ${failures.join(' | ')}`);
process.exit(failures.length === 0 ? 0 : 1);
