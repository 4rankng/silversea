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
    const lines = (el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = new Set();
      for (const rect of range.getClientRects()) tops.add(Math.round(rect.top));
      return tops.size;
    };
    const money = [...document.querySelectorAll('td.num')].filter((td) => /₫/.test(td.textContent || '') && /[0-9]/.test(td.textContent || '')).slice(0, 3);
    return {
      money: money.map((td) => ({ label: td.getAttribute('data-label'), text: (td.textContent || '').trim(), ws: getComputedStyle(td).whiteSpace, lineBoxes: lines(td) })),
      subs: [...document.querySelectorAll('.ivt-stack__sub')].filter((el) => (el.textContent || '').trim() && (el.textContent || '').trim() !== '—').slice(0, 4).map((el) => ({ text: (el.textContent || '').trim().slice(0, 34), ws: getComputedStyle(el).whiteSpace, lineBoxes: lines(el) })),
    };
  });
  console.log(`WIDTH ${width}:`, JSON.stringify(out, null, 1));
  if (width === 1440) {
    const cell = await page.$('td.num');
    if (cell) { await cell.scrollIntoView(); await new Promise((res) => setTimeout(res, 500)); await cell.screenshot({ path: 'testplan/qa/evidence/2026-10-06_card386-rework/prod-money-cell-1440.png' }); }
  }
}
await browser.close();
console.log('LINES PROBE DONE');
