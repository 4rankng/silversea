// Card 388 — line-box sweep for the expense register's numeric cells across
// the card-mode band (<=767) and the desktop widths, on the production bundle
// (QA_FRONTEND_ORIGIN, default the dev origin).
import puppeteer from 'puppeteer';
const BASE = process.env.QA_FRONTEND_ORIGIN ?? 'http://localhost:7175';
const SCREENS = [
  ['expenses-ops', '/accounting/expenses?view=ops'],
  ['expenses-work', '/accounting/expenses?view=work'],
  ['expenses-reports', '/accounting/expenses?view=reports'],
  ['expenses-fund-book', '/accounting/expenses?view=fund-book'],
  ['expenses-list', '/expenses'],
];
const WIDTHS = [375, 640, 767, 1280, 1440, 1920, 2560];
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
let wrapped = 0;
for (const [name, path] of SCREENS) {
  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((res) => setTimeout(res, 4000));
    const out = await page.evaluate(() => {
      const lines = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set();
        for (const rect of range.getClientRects()) if (rect.width > 2) tops.add(Math.round(rect.top));
        return tops.size;
      };
      const cells = [...document.querySelectorAll('.expense-register-table td.num, .expense-register-table .num')];
      const wrappedCells = cells
        .map((td) => {
          // Measure the VALUE element's text lines: a ghost button's own box
          // (padding height) would count as a second top and lie.
          const value = td.querySelector('button') ?? td;
          return { text: (td.textContent || '').trim().slice(0, 30), lineBoxes: lines(value), tdWs: getComputedStyle(td).whiteSpace, valueWs: getComputedStyle(value).whiteSpace };
        })
        .filter((c) => c.lineBoxes > 1);
      return {
        moneyCells: cells.length,
        wrappedCells,
        hOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    const bad = out.wrappedCells.length > 0 || out.hOverflow > 1;
    if (bad) wrapped += out.wrappedCells.length;
    console.log(JSON.stringify({ name, width, ...out, verdict: bad ? 'FAIL' : 'ok' }));
    if (bad) await page.screenshot({ path: `testplan/qa/evidence/2026-10-06_card388-expense-law/sweep-${name}-${width}.png`, fullPage: true });
  }
}
console.log(wrapped === 0 ? 'SWEEP PASS — 0 wrapped money cells' : `SWEEP FAIL — ${wrapped} wrapped`);
await browser.close();
