// Card 386 v2 — production-pipeline proof: every .money renders ONE line box.
import puppeteer from 'puppeteer';
const BASE = process.env.QA_FRONTEND_ORIGIN ?? 'http://localhost:7175';
const SCREENS = [
  ['invoice-tracking', '/accounting/invoice-tracking'],
  ['debt', '/debt'],
  ['payables', '/payables'],
  ['phoi-phieu', '/accounting/phoi-phieu'],
  ['expenses-ops', '/accounting/expenses?view=ops'],
];
const WIDTHS = [1440, 375];
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
let total = 0; let wrapped = 0;
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
      const monies = [...document.querySelectorAll('.money')].slice(0, 400);
      const detail = monies.map((el) => ({ t: (el.textContent || '').trim().slice(0, 18), lines: lines(el) }));
      const bad = detail.filter((d) => d.lines > 1);
      return { count: monies.length, bad };
    });
    total += out.count; wrapped += out.bad.length;
    console.log(JSON.stringify({ name, width, moneyCount: out.count, wrapped: out.bad.length, sample: out.bad.slice(0, 4), verdict: out.bad.length ? 'FAIL' : 'ok' }));
  }
}
console.log(`TOTAL ${total} money elements measured, ${wrapped} wrapped`);
await browser.close();
