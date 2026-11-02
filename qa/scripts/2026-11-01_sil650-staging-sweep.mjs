// SIL-650 — width sweep against STAGING (build b20c724c == HEAD) to find the
// owner's exact overflow condition. READ-ONLY: POST /auth/login + GET catalog
// feeds + page render. No writes. Screenshots per width for evidence.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'https://vantai.tingting.vip';
const ART = 'testplan/assets';
const LOG = 'qa/2026-11-01_sil650-staging-sweep_ui-driver.log';
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== staging sweep ${new Date().toISOString()} ===\n`);

const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const body = await login.json().catch(() => null);
const token = body?.token;
log(`staging login admin: ${login.status} token=${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WIDTHS = [[1920, 1080], [1700, 1000], [1600, 900], [1512, 982], [1440, 900], [1366, 800], [1280, 800], [1180, 800], [1100, 800], [1024, 800]];

for (const [width, height] of WIDTHS) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/config/factories`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.factories-table tbody tr', { timeout: 30000 });
  await sleep(800);

  const m = await page.evaluate(() => {
    const doc = document.documentElement;
    const rail = !!document.querySelector('.sidebar');
    const sideW = Math.round(document.querySelector('.sidebar')?.getBoundingClientRect().width ?? -1);
    const table = document.querySelector('.factories-table');
    const scroll = document.querySelector('.cfg-page--factories .table-scroll');
    const rtWrap = document.querySelector('.record-table-wrap');
    const bar = document.querySelector('.cfg-page--factories .filter-bar');
    const wrap = document.querySelector('.cfg-page--factories .table-wrap');
    const summary = document.querySelector('.cfg-page--factories .cfg-page__summary');
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) }; };
    // Any element wider than the viewport (bleeds past the right edge)?
    const bleed = [];
    for (const el of document.querySelectorAll('.cfg-page--factories, .cfg-page--factories *')) {
      const r = el.getBoundingClientRect();
      if (r.right > window.innerWidth + 1 || r.left < -1) {
        bleed.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}@${Math.round(r.left)}..${Math.round(r.right)}`);
        if (bleed.length > 8) break;
      }
    }
    return {
      viewport: window.innerWidth,
      pageOver: doc.scrollWidth - doc.clientWidth,
      sidebar: { present: rail, width: sideW },
      tableScroll: scroll ? { over: scroll.scrollWidth - scroll.clientWidth, overflowX: getComputedStyle(scroll).overflowX } : null,
      table: table ? { w: Math.round(table.getBoundingClientRect().width), layout: getComputedStyle(table).tableLayout } : null,
      rtWrapW: rtWrap ? Math.round(rtWrap.getBoundingClientRect().width) : null,
      bar: rect(bar), wrap: rect(wrap),
      summary: summary ? { ...rect(summary), text: (summary.textContent || '').trim() } : null,
      bleed,
    };
  });
  const shot = `${ART}/sil650-staging-${width}.png`;
  await page.screenshot({ path: shot });
  const flag = (m.pageOver > 0 || m.tableScroll.over > 0 || m.bleed.length) ? ' ⚠️' : '';
  log(`w${width}: pageOver=${m.pageOver} tableScrollOver=${m.tableScroll?.over} overflowX=${m.tableScroll?.overflowX} table=${m.table?.w}/${m.table?.layout} canvas=${m.rtWrapW} sidebar=${m.sidebar.width} summaryRight=${m.summary?.right} wrapRight=${m.wrap?.right} bleed=${JSON.stringify(m.bleed)}${flag} shot=${shot}`);
  await page.close();
}
await browser.close();
log('sweep done');
console.log('sweep done');
process.exit(0);
