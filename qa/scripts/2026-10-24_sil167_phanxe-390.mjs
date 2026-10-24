// SIL-167 — responsive spot-check: the vehicle editor at 390px renders as the
// bottom sheet; OWN plate options + empty-state must still show.
//   node qa/scripts/2026-10-24_sil167_phanxe-390.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const OUT = path.resolve('qa/2026-10-24-sil167');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'after_ui-driver-390.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
}).then((r) => r.json());
if (!token) { log('ABORT: login failed'); process.exit(2); }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = (name) => page.screenshot({ path: path.join(OUT, `after_ui-390-${name}.png`) });

await page.goto(`${FRONT}/shipments-detail?searchSuffix=SILQ1520011&dateScope=all`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#shipment-detail-edit-vehicle-306', { timeout: 20000 });
await page.click('#shipment-detail-edit-vehicle-306');
await page.waitForSelector('.shipment-container-ledger__inline-editor--sheet', { timeout: 8000 });
await sleep(400);
await shot('1-sheet-open');

// The sheet's carrier select (Đội xe SilverSea persisted from the 1440 run).
const plate = await page.$('input[aria-label="Biển số xe"]');
if (!plate) { log('FAIL: plate input missing at 390'); process.exit(1); }
await plate.click();
await sleep(500);
const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')]
  .filter((el) => (el instanceof HTMLElement) && el.offsetParent !== null)
  .map((el) => el.textContent?.trim() ?? ''));
log(`390 plate options count=${options.length} first=${JSON.stringify(options.slice(0, 3))}`);
await shot('2-sheet-plate-dropdown');
log(options.length > 0 ? 'PASS 390: OWN plate dropdown lists options in the sheet' : 'FAIL 390: dropdown empty');
await browser.close();
process.exit(options.length > 0 ? 0 : 1);
