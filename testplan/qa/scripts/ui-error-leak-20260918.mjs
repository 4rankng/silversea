// TC-ERRMSG driver (local dev, 2026-09-18): the create-lot save banner must not
// leak internal field paths and must not repeat one problem per row.
//
// Reproduces the user's report: five container rows with the number filled and
// "Loại container" left blank, then "Tạo lô hàng". Before the fix the banner read
// "containers.containerTypeId: Loại container là bắt buộc" five times.
//
// Usage: node testplan/qa/scripts/ui-error-leak-20260918.mjs
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'http://localhost:7174';
const API = process.env.API_URL || 'http://localhost:3001/api';
const ROWS = Number(process.env.ROWS || 5);
const DIR = process.env.OUT_DIR || 'qa/2026-09-18-error-leak';
mkdirSync(DIR, { recursive: true });
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const LOGFILE = `${DIR}/ui-driver.log`;
const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOGFILE, lines.join('\n') + '\n');
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login thanhdc ok — ${BASE}, ${ROWS} container rows, blank Loại container`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1200 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 40000 });
    // Ad-hoc flow ("Lệnh chạy ngoài"): the raw customer name is free text, so the
  // form reaches the container validation without depending on the catalog
  // picker — which is what the customer's screenshot showed.
  await page.click('xpath/.//label[normalize-space()="Lệnh chạy ngoài"]');
  await sleep(500);
  const CUSTOMER = 'input[role="combobox"][placeholder="Chọn hoặc gõ tên mới"]';
  await page.waitForSelector(CUSTOMER, { timeout: 15000 });
  await page.click(CUSTOMER);
  await page.keyboard.type('Khach QA Adhoc');
  await page.keyboard.press('Tab');
  await sleep(400);

  for (let i = 1; i < ROWS; i += 1) {
    const addButtons = await page.$$('xpath/.//button[normalize-space()="Thêm container"]');
    await addButtons[0].click();
    await sleep(200);
  }
  const numbers = await page.$$('input[aria-label="Số container"]');
  log(`container number inputs rendered: ${numbers.length}`);
  for (let i = 0; i < numbers.length; i += 1) {
    await numbers[i].click();
    await page.keyboard.type(`ABCD-12345${String(i).padStart(2, '0')}`);
  }
  await page.screenshot({ path: `${DIR}/${STAMP}_01-before-submit.png` });

  await page.click('xpath/.//button[normalize-space()="Tạo lô hàng"]');
  await page.waitForSelector('.csc-submit-error', { timeout: 30000 });
  await sleep(600);
  const banner = await page.evaluate(() => document.querySelector('.csc-submit-error')?.textContent?.trim() ?? null);
  log('banner', banner);
  await page.screenshot({ path: `${DIR}/${STAMP}_02-banner.png` });
  await page.screenshot({ path: `${DIR}/${STAMP}_03-banner-clip.png`, clip: await page.evaluate(() => {
    const box = document.querySelector('.csc-submit-error')?.getBoundingClientRect();
    return box ? { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 } : { x: 0, y: 0, width: 1200, height: 200 };
  }) });

  if (!banner) failed = 'no save banner rendered';
  else {
    if (/containers|containerTypeId/.test(banner)) failed = `internal path leaked: ${banner}`;
    if (!banner.includes('Loại container là bắt buộc')) failed = `expected the Vietnamese message, got: ${banner}`;
    if ((banner.match(/Loại container là bắt buộc/g) ?? []).length !== 1) failed = `message repeated: ${banner}`;
    if (!/Container 1, 2, 3, 4, 5/.test(banner)) failed = `rows not grouped: ${banner}`;
  }
} finally {
  await browser.close();
}

if (failed) {
  log(`FAIL ${failed}`);
  process.exitCode = 1;
} else {
  log('PASS — banner is one grouped Vietnamese sentence with no internal field path');
}
log(`artifact driver log: ${LOGFILE}`);
