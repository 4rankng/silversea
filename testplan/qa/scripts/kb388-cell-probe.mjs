import puppeteer from 'puppeteer';
const BASE = process.env.QA_FRONTEND_ORIGIN ?? 'http://localhost:7175';
const r = await fetch('http://localhost:3002/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await r.json()).token;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto(`${BASE}/accounting/expenses?view=ops`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.expense-register-table td.num', { timeout: 20000 }).catch(() => {});
await new Promise((res) => setTimeout(res, 2000));
const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
console.log('BODY:', bodyText.replace(/\n+/g, ' | '));
const out = await page.evaluate(() => {
  const all = [...document.querySelectorAll('.expense-register-table td.num')];
  const td = all.find((c) => /50\.000 ₫/.test(c.textContent || '')) ?? all[0];
  if (!td) return { found: false };
  const btn = td.querySelector('button');
  const lineBoxes = (el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return [...range.getClientRects()].filter((x) => x.width > 2).map((x) => ({ top: Math.round(x.top), w: Math.round(x.width), h: Math.round(x.height) }));
  };
  const bcs = btn ? getComputedStyle(btn) : null;
  return {
    tdHtml: td.innerHTML.slice(0, 300),
    tdRects: lineBoxes(td),
    btn: btn ? {
      ws: bcs.whiteSpace, display: bcs.display, padding: bcs.padding, fontSize: bcs.fontSize,
      btnRects: lineBoxes(btn),
      textRects: (() => { const range = document.createRange(); range.selectNodeContents(btn); return [...range.getClientRects()].map((x) => ({ top: Math.round(x.top), w: Math.round(x.width) })); })(),
      btnWidth: btn.getBoundingClientRect().width,
    } : null,
    tdWidth: td.getBoundingClientRect().width,
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
