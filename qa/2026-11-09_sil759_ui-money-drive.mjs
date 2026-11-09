// SIL-759 — visual proof of the MONEY state of the road band (tạm tính định
// mức rendered + locked) after seeding road_allowances route=106 40FT=450.000.
import puppeteer from 'puppeteer-core';
import { appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3003/api';
const LOG = 'qa/2026-11-09_sil759_ui-driver.log';
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const { token } = await loginRes.json();
if (!token) process.exit(1);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 768, height: 1024 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = async (name) => {
  await page.evaluate(() => document.querySelector('section[aria-label="Chi phí chuyến"]')?.scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: `qa/2026-11-09_sil759_ui-${name}.png` });
  log(`shot ${name}`);
};
try {
  // The API must project the board row into the trip's totalRoadAllowance.
  const trip = await (await fetch(`${API}/driver/me/trips/779100`, { headers: { Authorization: `Bearer ${token}` } })).json();
  log(`api totalRoadAllowance=${trip?.totalRoadAllowance}`);
  await page.goto(`${BASE}/my-trips/779100`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  const band = await page.evaluate(() => {
    const road = document.querySelector('section[aria-label="Bảng Tiền đường"]');
    const b = road?.querySelector('[data-testid="shipment-cost-road-allowance"]');
    const moneyRow = b?.querySelector('.shipment-cost-entry__road-norm-amount');
    return {
      text: b?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      moneyRowText: moneyRow?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      moneyRowHasInput: moneyRow ? Boolean(moneyRow.querySelector('input')) : null,
      noteFollowsMoney: b ? (b.querySelector('.shipment-cost-entry__road-norm-amount')?.nextElementSibling?.querySelector('[data-testid="cost-note-row"]') != null) : null,
      roadButtons: road ? [...road.querySelectorAll('button')].map((x) => x.textContent?.trim()) : [],
    };
  });
  log(`band: ${JSON.stringify(band)}`);
  const pass = (band.moneyRowText?.includes('Tạm tính định mức') && band.moneyRowText?.includes('450.000 ₫'))
    && band.moneyRowHasInput === false
    && band.roadButtons.every((t) => !t?.includes('Thêm'));
  log(`${pass ? 'PASS' : 'FAIL'} tạm tính 450.000 ₫ khóa cứng trong khu tiền đường, không nút thêm`);
  await shot('07-road-norm-money-768');
  await page.setViewport({ width: 390, height: 844 });
  await sleep(500);
  await shot('08-road-norm-money-390');
  log(`MONEY_EXIT:${pass ? 0 : 1}`);
  process.exit(pass ? 0 : 1);
} catch (error) {
  log(`MONEY DRIVE ERROR: ${error.message}`);
  await shot('99-money-error');
  process.exit(1);
} finally {
  await browser.close();
}
