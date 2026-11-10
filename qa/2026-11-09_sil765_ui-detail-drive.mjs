// SIL-765 — detail-view proof for lot SHP-2611-00426 (created with 2 kho lấy
// hàng): portal detail shows BOTH warehouses; API projects the extra row.
import puppeteer from 'puppeteer-core';
import { appendFileSync } from 'node:fs';
const BASE = 'http://localhost:7176';
const API = 'http://localhost:3003/api';
const LOG = 'qa/2026-11-09_sil765_ui-driver.log';
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }) });
const { token } = await loginRes.json();
if (!token) process.exit(1);
// API projection proof first.
const detail = await (await fetch(`${API}/shipments/779508`, { headers: { Authorization: `Bearer ${token}` } })).json();
const apiRows = detail?.shipment?.additionalPickupWarehouses;
log(`api additionalPickupWarehouses=${JSON.stringify(apiRows)}`);
const apiPass = Array.isArray(apiRows) && apiRows.length === 1 && apiRows[0].siteId === 12 && apiRows[0].siteName === 'GLC';
log(`${apiPass ? 'PASS' : 'FAIL'} API chi tiết chiếu thêm điểm kho (GLC)`);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--no-sandbox'], defaultViewport: { width: 1440, height: 1000 } });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
let failures = apiPass ? 0 : 1;
try {
  await page.goto(`${BASE}/shipments/779508`, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(3000);
  const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  log(`page: url=${page.url()} hasVICONSHIP=${text.includes('VICONSHIP')} hasGLC=${text.includes('GLC')}`);
  const both = text.includes('VICONSHIP') && text.includes('GLC');
  log(`${both ? 'PASS' : 'FAIL'} chi tiết lô hiện đủ cả 2 kho lấy hàng`);
  failures += both ? 0 : 1;
  // Scrolled evidence of the Nâng/Hạ point rows.
  await page.evaluate(() => [...document.querySelectorAll('*')].find((el) => el.textContent?.trim() === 'Nâng' && el.children.length === 0)?.scrollIntoView({ block: 'center' }));
  await sleep(500);
  await page.screenshot({ path: 'qa/2026-11-09_sil765_ui-05-detail-points-1440.png' });
  log('shot 05-detail-points-1440');
  await page.setViewport({ width: 768, height: 1024 });
  await sleep(600);
  await page.screenshot({ path: 'qa/2026-11-09_sil765_ui-06-detail-points-768.png' });
  log('shot 06-detail-points-768');
} catch (error) {
  failures += 1;
  log(`DETAIL DRIVE ERROR: ${error.message}`);
} finally {
  await browser.close();
  log(`DETAIL_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
