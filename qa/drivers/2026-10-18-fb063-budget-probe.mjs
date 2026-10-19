// FB-063 — layout budget probe on /accounting/invoice-tracking (READ-ONLY).
import puppeteer from 'puppeteer';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const L = await (await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
})).json();
if (!L.token) { console.log('LOGIN FAILED'); process.exit(1); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForSelector('.record-table', { timeout: 30000 });
await sleep(1800);

const budget = await page.evaluate(() => {
  const wrap = document.querySelector('.invoice-tracking-page .record-table-wrap') ?? document.querySelector('.record-table-wrap');
  const table = wrap.querySelector('table');
  const measureOneLine = (label) => {
    const probe = document.createElement('span');
    probe.textContent = label;
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;';
    const th = table.querySelector('thead th');
    probe.style.font = getComputedStyle(th).font;
    probe.style.letterSpacing = getComputedStyle(th).letterSpacing;
    probe.style.textTransform = getComputedStyle(th).textTransform;
    document.body.appendChild(probe);
    const w = Math.ceil(probe.getBoundingClientRect().width);
    probe.remove();
    return w;
  };
  const ths = [...table.querySelectorAll('thead th')].map((th) => {
    const label = (th.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      label,
      width: Math.round(th.getBoundingClientRect().width),
      oneLineLabel: measureOneLine(label),
      pad: getComputedStyle(th).padding,
    };
  });
  return {
    wrapClientWidth: wrap.clientWidth,
    wrapScrollWidth: wrap.scrollWidth,
    tableWidth: Math.round(table.getBoundingClientRect().width),
    tableMinWidth: getComputedStyle(table).minWidth,
    tableWidthCss: getComputedStyle(table).width,
    ths,
  };
});

console.log('wrapper clientWidth:', budget.wrapClientWidth, 'scrollWidth:', budget.wrapScrollWidth);
console.log('table width:', budget.tableWidth, '(css width:', budget.tableWidthCss, ', min-width:', budget.tableMinWidth, ')');
console.log('column budget (width | one-line label need incl. 24px pad):');
let sumW = 0, sumNeed = 0;
for (const t of budget.ths) {
  sumW += t.width;
  sumNeed += t.oneLineLabel + 24;
  console.log(`  ${String(t.width).padStart(4)}px | need ${String(t.oneLineLabel + 24).padStart(4)}px | "${t.label}"`);
}
console.log(`SUM width=${sumW} · SUM one-line need=${sumNeed}`);
await browser.close();
console.log('PROBE EXIT 0');
