// FB-063 — one-off header line-count probe on the "Bảng kê thanh toán" ledger
// (/suppliers/:id -> PayableDetailPage). READ-ONLY.
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
await page.goto(`${BASE}/suppliers/1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(2500);

const rows = await page.evaluate(() => {
  const lineCount = (el) => {
    const tops = new Set();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) tops.add(Math.round(r.top));
    }
    return tops.size;
  };
  const out = [];
  for (const table of document.querySelectorAll('table')) {
    for (const th of table.querySelectorAll('thead th')) {
      out.push({
        table: table.className || '(no-class)',
        label: (th.textContent || '').replace(/\s+/g, ' ').trim(),
        lines: lineCount(th),
        thWidth: Math.round(th.getBoundingClientRect().width),
      });
    }
  }
  return out;
});
console.log('Bảng kê thanh toán ledger headers:', rows.length);
for (const r of rows) console.log(`  ${r.lines} lines · ${r.thWidth}px · [${r.table}] "${r.label}"`);
await page.screenshot({ path: '/tmp/fb063-measure/before-payable-ledger-1440.png' });
await browser.close();
console.log('PROBE EXIT 0');
