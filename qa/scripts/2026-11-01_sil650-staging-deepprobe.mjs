// SIL-650 — deep overflow probe on staging: measure EVERY scroll container in
// the chain (document, .app-main, .app-body, .table-wrap, .table-scroll,
// .record-table-wrap, .filter-bar) plus per-column geometry and the counter's
// right-edge slack, across widths incl. very wide canvases (owner zoom-out /
// large monitor).
import puppeteer from 'puppeteer-core';
import { appendFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const LOG = 'qa/2026-11-01_sil650-staging-deepprobe_ui-driver.log';
mkdirSync('testplan/assets', { recursive: true });
const log = (l) => { const t = `${new Date().toISOString()} ${l}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== deep probe ${new Date().toISOString()} ===\n`);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new', args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 1196/1200 bracket the canvas=1100 container flip; 2560/2999 = very wide.
const WIDTHS = [[2999, 1000], [2560, 1080], [1999, 1000], [1920, 1080], [1440, 900], [1366, 800], [1240, 800], [1200, 800], [1196, 800], [1150, 800]];

for (const [width, height] of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/config/factories`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.factories-table tbody tr', { timeout: 30000 });
  await sleep(800);

  const m = await page.evaluate(() => {
    const probe = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      return { sw: el.scrollWidth, cw: el.clientWidth, over: el.scrollWidth - el.clientWidth, ox: getComputedStyle(el).overflowX };
    };
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) };
    };
    const table = document.querySelector('.factories-table');
    const cols = table ? [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width)) : [];
    const summary = document.querySelector('.cfg-page--factories .cfg-page__summary');
    const bar = document.querySelector('.cfg-page--factories .filter-bar');
    const barPad = bar ? getComputedStyle(bar).paddingRight : null;
    return {
      vw: window.innerWidth,
      doc: probe('html'),
      appMain: probe('.app-main'),
      appBody: probe('.app-body'),
      tableWrap: probe('.cfg-page--factories .table-wrap'),
      tableScroll: probe('.cfg-page--factories .table-scroll'),
      rtWrap: probe('.record-table-wrap'),
      filterBar: probe('.cfg-page--factories .filter-bar'),
      actions: probe('.cfg-page--factories .filter-bar__actions'),
      tableW: table ? Math.round(table.getBoundingClientRect().width) : null,
      cols,
      summaryText: summary?.textContent.trim() ?? null,
      summaryR: summary ? Math.round(summary.getBoundingClientRect().right) : null,
      barR: bar ? Math.round(bar.getBoundingClientRect().right) : null,
      barPad,
      sidebarW: Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().width ?? -1),
    };
  });
  const shot = `testplan/assets/sil650-deep-${width}.png`;
  await page.screenshot({ path: shot });
  const flag = [m.doc, m.appMain, m.appBody, m.tableScroll, m.rtWrap, m.filterBar, m.actions].some((p) => p && p.over > 0) ? ' ⚠️OVERFLOW' : '';
  log(`w${width}: doc=${m.doc?.over} appMain=${m.appMain?.over} appBody=${m.appBody?.over} wrap=${m.tableWrap?.over} scroll=${m.tableScroll?.over}(${m.tableScroll?.ox}) rtWrap=${m.rtWrap?.over} bar=${m.filterBar?.over} actions=${m.actions?.over}${flag}`);
  log(`  table=${m.tableW} cols=[${m.cols}] sidebar=${m.sidebarW} summary="${m.summaryText}" summaryR=${m.summaryR} barR=${m.barR} barPadR=${m.barPad}`);
  await page.close();
}
await browser.close();
log('deep probe done');
process.exit(0);
