/** One-off DOM probe #2 for SIL-516: overflow sources + editor markup. */
import puppeteer from 'puppeteer-core';

const BASE = 'http://localhost:7175';
const BILL = 'R40B2-LCL03';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const res = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const { token } = await res.json();

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });
await page.goto(`${BASE}/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-31&searchSuffix=${encodeURIComponent(BILL)}`, { waitUntil: 'networkidle0', timeout: 45000 });
await page.waitForFunction((b) => document.body.innerText.includes(b), { timeout: 20000 }, BILL);
await new Promise((r) => setTimeout(r, 500));

const overflow = await page.evaluate(() => {
  const region = document.querySelector('.shipment-container-ledger');
  const table = region.querySelector('table');
  const tableRight = table.getBoundingClientRect().right;
  const regionRight = region.getBoundingClientRect().right;
  const offenders = [];
  for (const el of region.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > tableRight + 0.5) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className).slice(0, 80),
        right: +r.right.toFixed(1),
        overTablePx: +(r.right - tableRight).toFixed(1),
        overRegionPx: +(r.right - regionRight).toFixed(1),
        text: el.textContent.trim().slice(0, 30),
      });
    }
  }
  return { tableRight: +tableRight.toFixed(1), regionRight: +regionRight.toFixed(1), regionScrollW: region.scrollWidth, regionClientW: region.clientWidth, offenders };
});

// open the editor and dump markup + trigger/placeholder geometry
await page.evaluate((bill) => {
  const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')].find((tr) => tr.textContent.includes(bill));
  row.querySelector('button[aria-label*="BKS thực"]').click();
}, BILL);
await new Promise((r) => setTimeout(r, 500));
const editor = await page.evaluate((bill) => {
  const row = [...document.querySelectorAll('.shipment-container-ledger tbody tr')].find((tr) => tr.textContent.includes(bill));
  const card = row.querySelector('.shipment-container-ledger__inline-editor');
  return {
    markup: card ? card.outerHTML.slice(0, 2200) : null,
    comboboxParts: card ? [...card.querySelectorAll('*')].slice(0, 40).map((el) => ({ tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 60), w: +el.getBoundingClientRect().width.toFixed(1), scrollW: el.scrollWidth, clientW: el.clientWidth })) : null,
  };
}, BILL);
console.log(JSON.stringify(overflow, null, 1));
console.log('--- markup ---');
console.log(editor.markup);
console.log('--- widths ---');
console.log(JSON.stringify(editor.comboboxParts, null, 0));
await browser.close();
