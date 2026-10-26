/** One-off DOM probe for SIL-516 layout diagnosis (not evidence). */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const BILL = 'R40B2-LCL03';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const res = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await res.json();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-31&searchSuffix=${encodeURIComponent(BILL)}`, { waitUntil: 'networkidle0', timeout: 45000 });
await page.waitForFunction((b) => document.body.innerText.includes(b), { timeout: 20000 }, BILL);
await new Promise((r) => setTimeout(r, 500));

const out = await page.evaluate((bill) => {
  const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')].find((tr) => tr.textContent.includes(bill));
  const table = document.querySelector('.shipment-container-ledger table');
  const region = document.querySelector('.shipment-container-ledger');
  const cs = getComputedStyle(table);
  const cols = [...table.querySelectorAll('colgroup col')].map((c) => {
    const r = c.getBoundingClientRect();
    return { cls: c.className, width: +r.width.toFixed(1) };
  });
  const ths = [...table.querySelectorAll('thead th')].map((th) => {
    const r = th.getBoundingClientRect();
    return { text: th.textContent.trim().slice(0, 18), width: +r.width.toFixed(1), right: +r.right.toFixed(1) };
  });
  const tds = [...row.querySelectorAll('td,th')].map((td) => {
    const r = td.getBoundingClientRect();
    return { label: td.getAttribute('data-label'), width: +r.width.toFixed(1), right: +r.right.toFixed(1) };
  });

  // open the plate editor and dump its markup
  const btn = row.querySelector('button[aria-label*="BKS thực"]');
  btn.click();
  return { tableLayout: cs.tableLayout, tableWidth: +table.getBoundingClientRect().width.toFixed(1), tableRight: +table.getBoundingClientRect().right.toFixed(1), regionRight: +region.getBoundingClientRect().right.toFixed(1), cols, ths, tds };
}, BILL);
await new Promise((r) => setTimeout(r, 500));
const html = await page.evaluate((bill) => {
  const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')].find((tr) => tr.textContent.includes(bill));
  const card = row.querySelector('.shipment-container-ledger__inline-editor');
  return card ? card.outerHTML.slice(0, 3000) : null;
}, BILL);
console.log(JSON.stringify(out, null, 1));
console.log('--- editor markup ---');
console.log(html);
await browser.close();
