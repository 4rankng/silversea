// Header-fit probe: measures every ledger thead th scroll/client width at
// 1440/1280/1101 to find which headers clip (R17: one line, no chop).
// Usage: node testplan/qa/scripts/2026-10-18-fb109-fb113-v2-header-fit-probe.mjs [base]
import puppeteer from 'puppeteer';
const BASE = process.argv[2] || 'http://localhost:7175';
const token = await (await fetch('http://localhost:3002/api/auth/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
})).json().then((d) => d.token);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
for (const width of [1440, 1280, 1101]) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${BASE}/shipments-detail?dateScope=all&searchSuffix=BL-001`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger thead th', { timeout: 30000 });
  const rows = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-container-ledger thead th')).map((th) => {
    const btn = th.querySelector('.table-sort-button');
    const text = (btn ?? th).textContent.trim();
    const sw = (btn ?? th).scrollWidth;
    const cw = th.clientWidth - 24; // 10px 12px padding
    return { text: text.replace(/\s+/g, ' '), needs: sw, has: cw, clips: sw > th.clientWidth };
  }));
  console.log(`width ${width}:`, JSON.stringify(rows, null, 1));
}
await browser.close();
