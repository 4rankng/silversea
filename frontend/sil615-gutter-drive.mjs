#!/usr/bin/env node
/**
 * SIL-615 (id 719) QA drive — measures the REAL sidebar→workboard gutter on
 * /shipments at the ticket's evidence width (1307) plus 1440 / 1280 sanity
 * and the 390 phone band (layout must stay full-bleed). Screenshots +
 * numbers land in the repo-root qa/ dir per AGENTS.md §7.
 *
 * Run from frontend/: node sil615-gutter-drive.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync, appendFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:7175';
const ROOT = resolve(process.cwd(), '..');
const OUT = join(ROOT, 'qa');
const LOG = join(OUT, '2026-10-31_sil615_ui-driver.log');
mkdirSync(OUT, { recursive: true });

const log = (...a) => {
  const line = a.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(' ');
  process.stdout.write(line + '\n');
  appendFileSync(LOG, line + '\n');
};

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
await page.fill('input[type="text"], input[name="username"], input[autocomplete="username"]', 'admin');
await page.fill('input[type="password"]', process.env.ADMIN_PASS || 'Abc123');
await page.click('button[type="submit"]');
await page.waitForURL(/\/(dashboard|shipments|dispatch|trips|fleet|config)/, { timeout: 20000 });
log('login ok →', page.url());

await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.shipments-page--worksheet', { timeout: 20000 });
// let the lots query + table layout settle
await page.waitForTimeout(2500);

const measure = () => page.evaluate(() => {
  const rect = (sel) => {
    const el = document.querySelector(sel);
    return el ? (({ left, right, top, width }) => ({ left, right, top, width }))(el.getBoundingClientRect()) : null;
  };
  const sidebar = rect('.sidebar');
  const board = rect('.cus-workspace--worksheet');
  const table = rect('.cus-dashboard-table');
  const viewport = rect('.cus-dashboard-viewport');
  const appBody = document.querySelector('.app-body');
  const appBodyStyle = appBody ? getComputedStyle(appBody).paddingInline : null;
  const worksheet = document.querySelector('.shipments-page--worksheet');
  const worksheetStyle = worksheet ? getComputedStyle(worksheet).paddingInline : null;
  const wsComputed = document.querySelector('.cus-workspace--worksheet');
  const wsMargin = wsComputed ? getComputedStyle(wsComputed).marginInline : null;
  const scroller = document.querySelector('.cus-dashboard-viewport');
  const scrollMode = scroller ? { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth } : null;
  return {
    sidebar, board, table, viewport,
    gapSidebarToBoard: sidebar && board ? +(board.left - sidebar.right).toFixed(2) : null,
    gapSidebarToTable: sidebar && table ? +(table.left - sidebar.right).toFixed(2) : null,
    appBodyPaddingInline: appBodyStyle,
    worksheetPaddingInline: worksheetStyle,
    worksheetMarginInline: wsMargin,
    viewportScroll: scrollMode,
    viewportWidth: window.innerWidth,
    docWidth: document.documentElement.clientWidth,
    rows: document.querySelectorAll('.cus-dashboard-table tbody tr').length,
  };
});

const pass = async (width, height, label) => {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(1200);
  const m = await measure();
  const shot = `2026-10-31_sil615_ui-${label}.png`;
  await page.screenshot({ path: join(OUT, shot), fullPage: false });
  log(`[${label}] @${width}x${height} shot=${shot}`);
  log(`[${label}] measured:`, m);
  return m;
};

const d1307 = await pass(1307, 800, 'desktop-1307');
const d1440 = await pass(1440, 900, 'desktop-1440');
const d1280 = await pass(1280, 800, 'desktop-1280');
const m390 = await pass(390, 844, 'mobile-390');

const verdicts = {
  'SIL-615 gap ≥ 12px @1307 (sidebar visible)': d1307.gapSidebarToBoard !== null && d1307.gapSidebarToBoard >= 12,
  'SIL-615 gap ≥ 12px @1440': d1440.gapSidebarToBoard !== null && d1440.gapSidebarToBoard >= 12,
  'SIL-615 gap ≥ 12px @1280 (collapsed 48px rail)': d1280.gapSidebarToBoard !== null && d1280.gapSidebarToBoard >= 12,
  'mobile 390 full-bleed kept (board left ≈ 0)': m390.board !== null && Math.abs(m390.board.left) <= 1,
  'mobile 390 board reaches right edge': m390.board !== null && Math.abs(m390.board.right - 390) <= 1,
};
log('VERDICTS:', JSON.stringify(verdicts, null, 2));
log('console errors:', consoleErrors.length ? consoleErrors : 'none');

await browser.close();
const allPass = Object.values(verdicts).every(Boolean) && consoleErrors.length === 0;
log(allPass ? 'RESULT: PASS' : 'RESULT: FAIL');
process.exit(allPass ? 0 : 1);
