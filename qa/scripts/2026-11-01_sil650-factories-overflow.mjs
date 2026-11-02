// SIL-650 (id 755) — /config/factories horizontal overflow + clipped "N mục" counter.
// Rung-3 UI drive (AGENTS §9): real Chrome, real login, real page, DOM measurements
// + screenshots. Read-only against data: the only API calls are POST /auth/login and
// GET the two catalog feeds the page itself renders from.
//
// Measures per width:
//   - page-level horizontal overflow (documentElement/app-body scrollWidth vs clientWidth)
//   - .table-scroll internal scroll (scrollWidth vs clientWidth)
//   - table + column geometry (which column eats the width)
//   - .cfg-page__summary ("N mục") right edge vs its .filter-bar and .table-wrap right
//     edges (flush/clipped detection) and text truncation
// Screenshots: testplan/assets/sil650-<phase>-<width>.png
// Stack: frontend :7175 (this worktree) → backend :3002 → dev DB :5441.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const PHASE = process.argv[2] || 'before';
const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const ART = 'testplan/assets';
const LOG = `qa/2026-11-01_sil650-factories-${PHASE}_ui-driver.log`;
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${PHASE} ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login admin: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const sites = await fetch(`${API}/shipments/operational-sites/admin`, { headers: { Authorization: `Bearer ${token}` } });
const sitesBody = await sites.json().catch(() => null);
log(`GET /api/shipments/operational-sites/admin: ${sites.status} rows=${Array.isArray(sitesBody) ? sitesBody.length : 'n/a'}`);
if (sites.status !== 200) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDTHS = [[1440, 900], [1280, 800], [1512, 982], [390, 844]];
let failures = 0;

try {
  for (const [width, height] of WIDTHS) {
    const page = await browser.newPage();
    await page.setViewport({ width, height });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/config/factories`, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForSelector('.factories-table tbody tr', { timeout: 20000 });
    await sleep(700);

    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const appBody = document.querySelector('.app-body');
      const wrap = document.querySelector('.table-wrap');
      const scroll = document.querySelector('.cfg-page--factories .table-scroll');
      const rtWrap = document.querySelector('.record-table-wrap');
      const table = document.querySelector('.factories-table');
      const bar = document.querySelector('.cfg-page--factories .filter-bar');
      const summary = document.querySelector('.cfg-page--factories .cfg-page__summary');
      const actions = document.querySelector('.cfg-page--factories .filter-bar__actions');
      const headCells = [...(table?.querySelectorAll('thead th') ?? [])].map((th) => ({
        label: (th.textContent || '').trim() || '(actions)',
        width: Math.round(th.getBoundingClientRect().width),
      }));
      const clipInfo = (sel) => [...document.querySelectorAll(sel)].slice(0, 6).map((el) => {
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), text: (el.textContent || '').slice(0, 28), clipped: el.scrollWidth > el.clientWidth + 1 };
      });
      const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
      return {
        viewport: { w: window.innerWidth, h: window.innerHeight },
        pageOverflow: { scrollW: doc.scrollWidth, clientW: doc.clientWidth, over: doc.scrollWidth - doc.clientWidth },
        appBodyOverflow: appBody ? { scrollW: appBody.scrollWidth, clientW: appBody.clientWidth, over: appBody.scrollWidth - appBody.clientWidth } : null,
        tableScroll: scroll ? { scrollW: scroll.scrollWidth, clientW: scroll.clientWidth, over: scroll.scrollWidth - scroll.clientWidth, overflowX: getComputedStyle(scroll).overflowX } : null,
        rtWrap: rtWrap ? { w: Math.round(rtWrap.getBoundingClientRect().width) } : null,
        table: table ? { w: Math.round(table.getBoundingClientRect().width), layout: getComputedStyle(table).tableLayout } : null,
        headCells,
        firstIdentity: clipInfo('.factories-table .factory-name'),
        firstAddr: clipInfo('.factories-table .factory-addr'),
        bar: rect(bar),
        wrap: rect(wrap),
        actions: rect(actions),
        summary: summary ? { ...rect(summary), text: (summary.textContent || '').trim(), clipped: summary.scrollWidth > summary.clientWidth + 1 } : null,
        rowTexts: [...(table?.querySelectorAll('tbody tr td[data-label="Mã · Tên"] .factory-name') ?? [])].slice(0, 3).map((el) => (el.textContent || '').slice(0, 40)),
      };
    });

    const shot = `${ART}/sil650-${PHASE}-${width}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    log(`w${width}: shot=${shot}`);
    log(`w${width}: pageOverflow=${JSON.stringify(m.pageOverflow)} appBody=${JSON.stringify(m.appBodyOverflow)}`);
    log(`w${width}: tableScroll=${JSON.stringify(m.tableScroll)} table=${JSON.stringify(m.table)} rtWrap=${m.rtWrap?.w}`);
    log(`w${width}: headCells=${JSON.stringify(m.headCells)}`);
    log(`w${width}: bar=${JSON.stringify(m.bar)} wrap=${JSON.stringify(m.wrap)} actions=${JSON.stringify(m.actions)}`);
    log(`w${width}: summary=${JSON.stringify(m.summary)}`);
    log(`w${width}: namesClipped=${JSON.stringify(m.firstIdentity)} addrsClipped=${JSON.stringify(m.firstAddr)}`);
    log(`w${width}: rows=${JSON.stringify(m.rowTexts)}`);

    // Overflow assertions recorded as failures for the AFTER run to clear.
    if (m.pageOverflow.over > 0 || (m.appBodyOverflow?.over ?? 0) > 0) { failures += 1; log(`w${width}: FAIL page/app-body horizontal overflow`); }
    if (m.tableScroll && m.tableScroll.over > 0) { log(`w${width}: NOTE table-scroll internal scroll ${m.tableScroll.over}px (overflow-x=${m.tableScroll.overflowX})`); }
    if (m.summary && (m.summary.clipped || (m.wrap && m.summary.right > m.wrap.right) || (m.bar && m.summary.right > m.bar.right))) {
      failures += 1; log(`w${width}: FAIL summary flush/clipped (right=${m.summary.right} wrap.right=${m.wrap?.right} bar.right=${m.bar?.right} clipped=${m.summary.clipped})`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}
log(`RESULT phase=${PHASE} failures=${failures}`);
console.log(`RESULT phase=${PHASE} failures=${failures}`);
process.exit(0);
