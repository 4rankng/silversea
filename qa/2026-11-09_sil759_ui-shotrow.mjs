import puppeteer from 'puppeteer-core';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loginRes = await fetch('http://localhost:3003/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const { token } = await loginRes.json();
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 390, height: 844 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await page.goto('http://localhost:7176/my-trips/779100', { waitUntil: 'networkidle2', timeout: 120000 });
await sleep(2500);
await page.evaluate(() => {
  const lot = document.querySelector('section[aria-label="Bảng Chi phí lô hàng"]');
  [...lot.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí'))?.click();
});
await sleep(800);
await page.evaluate(() => document.querySelector('form.shipment-cost-entry__form')?.scrollIntoView({ block: 'center' }));
await sleep(400);
await page.screenshot({ path: 'qa/2026-11-09_sil759_ui-09-draft-row-390.png' });
console.log('shot 09-draft-row-390');
await browser.close();
