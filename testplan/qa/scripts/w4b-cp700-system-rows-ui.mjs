// CP700 system-rows clause: the ROAD_ALLOWANCE row on trip 105 renders in the
// Tiền đường table with the system note and NO edit controls (view-only for
// the driver). Read-only drive; screenshots + log as evidence.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = 'https://vantai.tingting.vip'; const API = BASE + '/api';
const LOG = 'qa/2026-10-16_w4b-cp700_ui-driver.log';
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const health = await fetch(API + '/health').then((r) => r.json());
log(`HEALTH status=${health.status} buildHash=${health.buildHash} pin=1c00c17a`);
if (health.buildHash !== '1c00c17a') { log('ABORT pin'); process.exit(2); }
const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) }).then((r) => r.json()).then((j) => j.token);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login);
await page.goto(`${BASE}/my-trips/105`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const res = await page.evaluate(() => {
  const roadTable = [...document.querySelectorAll('.shipment-cost-entry__table')].find((t) => t.querySelector('h3')?.textContent?.trim() === 'Tiền đường');
  if (!roadTable) return { error: 'no road table' };
  const items = [...roadTable.querySelectorAll('li')].map((li) => ({
    name: li.querySelector('strong')?.textContent?.trim(),
    systemNote: li.innerText.includes('Hệ thống tự ghi nhận'),
    buttons: [...li.querySelectorAll('button')].map((b) => (b.innerText || '').trim()).filter(Boolean),
  }));
  return {
    roadItems: items,
    systemRows: items.filter((i) => i.systemNote),
    anySystemRowWithButtons: items.some((i) => i.systemNote && i.buttons.length > 0),
  };
});
log('SYSTEM-ROWS-UI ' + JSON.stringify(res));
await page.screenshot({ path: 'qa/2026-10-16_w4b-cp700_ui-06-system-row-road-table.png', fullPage: true });
await browser.close();
log('DONE');
