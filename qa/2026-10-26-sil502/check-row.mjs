// SIL-502 repro driver — read the CHỨNG TỰ cell of a given lot on the CUS
// Tổng quan workboard. Usage: node check-row.mjs <shipmentId> [--screenshot name]
import puppeteer from 'puppeteer-core';
import { readFileSync, writeFileSync } from 'node:fs';

const [shipmentId, shotName] = process.argv.slice(2);
const BASE = process.env.BASE_URL || 'http://localhost:7185';
const API = process.env.API_URL || 'http://localhost:3012';

const loginRes = await fetch(`${API}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
const { token } = await loginRes.json();
if (!token) throw new Error('login failed');

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,900'],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)); });

await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForSelector(`#cus-inline-documents-${shipmentId}`, { timeout: 20000 });

const cell = await page.$eval(`#cus-inline-documents-${shipmentId}`, (el) => el.textContent);
console.log('CELL_TEXT:', JSON.stringify(cell));

if (shotName) {
  const row = await page.$(`#cus-inline-documents-${shipmentId}`);
  await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: shotName });
  writeFileSync(shotName.replace(/\.png$/, '.txt'), `CELL_TEXT for lot ${shipmentId}: ${JSON.stringify(cell)}\nURL: ${page.url()}\n`);
  console.log('SCREENSHOT:', shotName);
}

await browser.close();
