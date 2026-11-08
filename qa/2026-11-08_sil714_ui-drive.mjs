// SIL-714 (id 834) — rung-3 UI drive (AGENTS §9).
// CUS (tiepvv) edits the actual plate (BKS) of a live EXTERNAL trip still
// awaiting its plate, from the /shipments lot DRAWER's Nhà xe / BKS cell
// (D2 click-sửa → shared 'Cập nhật biển số' dialog). QA fail (build
// 9f900f39): the CUS half had NO UI path — the panel only displayed the
// plate. Fixture: R42DIS-02 (SHP-2610-00156, trip 54 EXTERNAL CREATED,
// plate NULL).
// Stack: frontend http://localhost:7189 → backend :3005 → dev DB :5441 (ss-prod-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const BASE = 'http://localhost:7189';
const API = 'http://localhost:3005/api';
const ART = 'qa';
const LOG = 'qa/2026-11-08_sil714_ui-driver.log';
const SEARCH = 'SHP-2611-00268';
const TRIP_ID = 779323;
const PLATE = '60H-714.55';
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const dbPlate = () => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -t -A -c "select coalesce(external_plate_number,'null') from trip_carrier_info where trip_id = ${TRIP_ID};"`,
).toString().trim();

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login tiepvv: ${token ? 'OK' : 'FAIL'}`);
log(`trip ${TRIP_ID} pre-drive plate: ${dbPlate()}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());
page.on('response', async (res) => {
  if (res.url().includes('external-plate')) {
    log(`API ${res.request().method()} ${res.url()} → ${res.status()}`);
    if (res.status() >= 400) log(`API body: ${(await res.text()).slice(0, 300)}`);
  }
});

const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-11-08_sil714_ui-${name}.png`, fullPage: false }); log(`shot ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

try {
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await sleep(800);

  // Search the fixture lot, then open its drawer via the row's Chi tiết link.
  await page.evaluate((term) => {
    const input = document.querySelector('input[aria-label="Tìm lô hàng"]');
    if (!input) throw new Error('search box not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, term);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, SEARCH);
  await sleep(2500);
  await page.evaluate(() => {
    const row = document.querySelector('.cus-dashboard-row');
    const detail = row?.querySelector('button.cus-dashboard-detail');
    detail?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(1500);

  // The Nhà xe / BKS cell of the awaiting-plate external line is the
  // click-to-edit trigger (D2 quick edit — the SIL-714 r2 affordance).
  const trigger = await page.evaluate(() => {
    const btn = document.querySelector('[role="dialog"] button[aria-label^="Cập nhật biển số xe ngoài cho"]');
    return { found: Boolean(btn), aria: btn?.getAttribute('aria-label') ?? null, cellText: btn?.innerText ?? null };
  });
  log(`plate trigger: aria="${trigger.aria}" cell="${trigger.cellText}"`);
  expect(trigger.found, 'CUS drawer shows the Cập nhật biển số click-to-edit trigger on the awaiting-plate line');
  await shot('01-lot-panel-plate-trigger');

  // Open the shared dialog and save the plate.
  await page.evaluate(() => {
    const btn = document.querySelector('[role="dialog"] button[aria-label^="Cập nhật biển số xe ngoài cho"]');
    btn?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await page.waitForSelector('[role="dialog"][aria-label*="biển số"], [role="dialog"] input[aria-label*="iển số"], [role="dialog"] input', { timeout: 15000 });
  await sleep(1200);
  const dialogInfo = await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const plateDialog = dialogs.find((d) => d.innerText.includes('biển số'));
    const input = plateDialog?.querySelector('input');
    return { title: plateDialog?.getAttribute('aria-label') ?? plateDialog?.querySelector('h2, h3')?.textContent ?? null, hasInput: Boolean(input) };
  });
  log(`plate dialog: title="${dialogInfo.title}" input=${dialogInfo.hasInput}`);
  expect(dialogInfo.hasInput, 'shared Cập nhật biển số dialog opens with an input');
  await shot('02-plate-dialog');

  await page.evaluate((plate) => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const plateDialog = dialogs.find((d) => d.innerText.includes('biển số'));
    const input = plateDialog.querySelector('input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, plate);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, PLATE);
  await sleep(300);
  await page.evaluate(() => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const plateDialog = dialogs.find((d) => d.innerText.includes('biển số'));
    const save = [...plateDialog.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Lưu biển số');
    save?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await sleep(2200);

  const saved = await page.evaluate((plate) => ({
    banner: document.body.innerText.includes('Đã cập nhật biển số xe ngoài'),
    cellShowsPlate: document.querySelector('[role="dialog"]')?.innerText.includes(plate) ?? false,
  }), PLATE);
  expect(saved.banner, 'success notice Đã cập nhật biển số xe ngoài shown');
  expect(saved.cellShowsPlate, `Nhà xe / BKS cell now shows the saved plate ${PLATE}`);
  await shot('03-after-save');

  const db = dbPlate();
  log(`trip ${TRIP_ID} post-drive plate: ${db}`);
  expect(db === PLATE, `DB proof trip_carrier_info.external_plate_number=${PLATE} (got ${db})`);
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
