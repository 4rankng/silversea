// Card 388 — STAGING line-box sweep (admin, READ-ONLY). Build must be 5b43005e.
import puppeteer from 'puppeteer';
const BASE = 'https://vantai.tingting.vip';
const SCREENS = [
  ['expenses-ops', '/expenses?view=ops', 7],
  ['expenses-default', '/expenses', 4],
  ['accounting-expenses-ops', '/accounting/expenses?view=ops', 4],
  ['invoice-tracking', '/accounting/invoice-tracking', 4],
  ['phoi-phieu', '/accounting/phoi-phieu', 4],
  ['debt', '/debt', 4],
  ['payables', '/payables', 4],
];
const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
console.log('login ok:', Boolean(token));
const health = await fetch(`${BASE}/api/health`).then((x) => x.json());
console.log('buildHash:', health.buildHash, 'expected 5b43005e');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
let total = 0; let wrappedTotal = 0;
for (const [name, path, widthCount] of SCREENS) {
  const widths = [375, 640, 767, 1280, 1440, 1920, 2560].slice(0, widthCount === 4 ? 3 : widthCount).concat(widthCount === 4 ? [1280, 1440, 1920, 2560] : [1280, 1440, 1920, 2560]);
  const list = widthCount === 7 ? [375, 640, 767, 1280, 1440, 1920, 2560] : [1280, 1440, 1920, 2560];
  for (const width of list) {
    await page.setViewport({ width, height: 1000 });
    await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await new Promise((res) => setTimeout(res, 6000));
    const out = await page.evaluate(() => {
      const lines = (el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tops = new Set();
        for (const rect of range.getClientRects()) if (rect.width > 2) tops.add(Math.round(rect.top));
        return tops.size;
      };
      const amounts = [...document.querySelectorAll('span.money.expense-amount')];
      const monies = [...document.querySelectorAll('.money')];
      const wrappedAmounts = amounts.map((el) => ({ t: (el.textContent || '').trim().slice(0, 20), lines: lines(el) })).filter((d) => d.lines > 1);
      const wrappedMonies = monies.map((el) => ({ t: (el.textContent || '').trim().slice(0, 20), lines: lines(el) })).filter((d) => d.lines > 1);
      return {
        amountEls: amounts.length, wrappedAmounts,
        moneyEls: monies.length, wrappedMonies: wrappedMonies.slice(0, 4), wrappedMoneyCount: wrappedMonies.length,
        hOverflow: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    total += out.moneyEls; wrappedTotal += out.wrappedMoneyCount + out.wrappedAmounts.length;
    console.log(JSON.stringify({ name, width, ...out, verdict: out.wrappedMoneyCount + out.wrappedAmounts.length ? 'FAIL' : 'ok' }));
    if (out.wrappedMoneyCount + out.wrappedAmounts.length > 0) {
      fs.mkdirSync('testplan/qa/evidence/2026-10-06_card388-staging', { recursive: true });
      await page.screenshot({ path: `testplan/qa/evidence/2026-10-06_card388-staging/${name}-${width}.png`, fullPage: true });
    }
  }
}
console.log(`STAGING TOTAL: ${total} .money elements measured, ${wrappedTotal} wrapped`);
await browser.close();
