// Card 386 rework — probe the PRODUCTION BUNDLE served by vite preview.
import puppeteer from 'puppeteer';
const BASE = process.env.QA_FRONTEND_ORIGIN ?? 'http://localhost:7175';
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
for (const width of [1440, 2560]) {
  await page.setViewport({ width, height: 1000 });
  await page.goto(`${BASE}/accounting/invoice-tracking`, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((res) => setTimeout(res, 4500));
  const out = await page.evaluate(() => {
    const lineBoxes = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      return range.getClientRects().length;
    };
    const money = [...document.querySelectorAll('td.num')].filter((td) => /[0-9]/.test(td.textContent || '') && /₫/.test(td.textContent || '')).slice(0, 3);
    const subs = [...document.querySelectorAll('.ivt-stack__sub')].slice(0, 4);
    return {
      money: money.map((td) => ({
        label: td.getAttribute('data-label'),
        text: (td.textContent || '').trim(),
        ws: getComputedStyle(td).whiteSpace,
        ow: getComputedStyle(td).overflowWrap,
        lineBoxes: lineBoxes(td),
      })),
      subs: subs.map((el) => ({ text: (el.textContent || '').trim().slice(0, 30), ws: getComputedStyle(el).whiteSpace, lineBoxes: lineBoxes(el) })),
    };
  });
  console.log(`WIDTH ${width}:`, JSON.stringify(out));
  await page.screenshot({ path: `testplan/qa/evidence/2026-10-06_card386-rework/prod-pipeline-${width}.png`, fullPage: true });
}
await browser.close();
console.log('PROD PROBE DONE');
