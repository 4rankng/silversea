// Follow-up: the QA's second label 'PHÍ CHI HỘ (CÓ HÓA ĐƠN)' straddles the
// dock edge near scrollLeft ≈ 975–1100 on the filtered board — verify the
// sweep hides it there too (read-only).
import { createRequire } from 'node:module';
const require = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require('puppeteer');

const BASE = 'https://vantai.tingting.vip';
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
});
const { token } = await login.json();
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
await page.goto(`${BASE}/accounting/ghep-bo-debit`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => { localStorage.setItem('token', t); }, token);
await page.goto(`${BASE}/accounting/ghep-bo-debit`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.debit-merge__pane', { timeout: 20000 });
const SEARCH = 'input[type="search"][aria-label="Tìm lô theo số Bill, container hoặc khách hàng"]';
await page.type(SEARCH, '9000', { delay: 80 });
await new Promise((r) => setTimeout(r, 600));
for (const pos of [900, 975, 1050, 1100, 1200]) {
  await page.evaluate((v) => { document.querySelector('.debit-merge__pane').scrollLeft = v; }, pos);
  await new Promise((r) => setTimeout(r, 450));
  const state = await page.evaluate(() => {
    const table = document.querySelector('.debit-merge__table');
    const edge = table.querySelector('thead th[data-sticky-last]').getBoundingClientRect().right;
    return {
      scrollLeft: document.querySelector('.debit-merge__pane').scrollLeft,
      edge: Math.round(edge * 10) / 10,
      labels: [...table.querySelectorAll('thead th:not([data-sticky]) .debit-merge__head-label')].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          text: el.textContent.slice(0, 24),
          straddle: r.left < edge - 0.5 && r.right > edge + 0.5,
          occluded: el.hasAttribute('data-occluded'),
          vis: getComputedStyle(el).visibility,
        };
      }).filter((l) => l.straddle),
    };
  });
  console.log(JSON.stringify({ pos, ...state }));
}
await browser.close();
