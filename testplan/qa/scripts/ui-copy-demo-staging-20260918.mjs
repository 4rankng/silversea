// Presence check for the staging copy-date demo data (2026-09-18): open the CUS
// overview at /shipments, open the seeded lot's "Chi tiết" drawer, switch the
// container ledger to edit mode and confirm the bulk-copy affordance is there.
//
// Read-only: it never clicks copy, so the seeded lot stays testable by hand.
//
// Usage: node testplan/qa/scripts/ui-copy-demo-staging-20260918.mjs
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'fs';

const BASE = process.env.BASE_URL || 'https://vantai.tingting.vip';
const API = process.env.API_URL || `${BASE}/api`;
const BL = process.env.BL || 'QACOPY-20260918071706-copy';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 150);
const DIR = process.env.OUT_DIR || 'qa/2026-09-18-copy-demo-staging';
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
log(`login thanhdc @ ${BASE} — lot ${SHIPMENT_ID} (${BL})`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1400 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments?searchSuffix=${encodeURIComponent(BL)}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(`#cus-dashboard-detail-${SHIPMENT_ID}`, { timeout: 30000 });
  log('overview row found');
  await page.screenshot({ path: `${DIR}/${STAMP}_01-overview-row.png` });

  await page.click(`#cus-dashboard-detail-${SHIPMENT_ID}`);
  await page.waitForSelector(`#cus-detail-drawer-${SHIPMENT_ID} table.cus-container-table`, { timeout: 30000 });
  await sleep(800);
  await page.screenshot({ path: `${DIR}/${STAMP}_02-drawer.png` });

  const editClicked = await page.evaluate(() => {
    const button = Array.from(document.querySelectorAll('.cus-container-edit-action')).find((node) => node.textContent?.includes('Chỉnh sửa'));
    if (!button) return false;
    button.click();
    return true;
  });
  log(`edit mode button clicked: ${editClicked}`);
  await sleep(900);

  const state = await page.evaluate(() => (Array.from(document.querySelectorAll('.cus-container-row')).map((row) => ({
    container: row.querySelector('th strong')?.textContent?.trim() ?? null,
    appointment: row.querySelector('.cus-appointment-trigger')?.textContent?.trim() ?? null,
    copyButtons: row.querySelectorAll('.cus-container-row__copy').length,
  }))));
  log('ledger rows after "Chỉnh sửa"', state);
  await page.screenshot({ path: `${DIR}/${STAMP}_03-ledger-edit-mode.png` });

  const copies = state.reduce((total, row) => total + row.copyButtons, 0);
  const dated = state.filter((row) => row.appointment && row.appointment !== 'Chọn ngày giờ').length;
  if (copies !== 1) failed = `expected exactly one copy affordance on the dated row, saw ${copies}`;
  else if (dated !== 1) failed = `expected exactly one dated row, saw ${dated}`;

  if (copies > 0) {
    await page.hover('.cus-container-row__copy');
    await sleep(400);
    const visibility = await page.evaluate(() => {
      const button = document.querySelector('.cus-container-row__copy');
      return button ? { visibility: getComputedStyle(button).visibility, title: button.getAttribute('title') } : null;
    });
    log('copy affordance', visibility);
    await page.screenshot({ path: `${DIR}/${STAMP}_04-copy-hover.png` });
  }
} finally {
  await browser.close();
}

if (failed) {
  log(`FAIL ${failed}`);
  process.exitCode = 1;
} else {
  log('PASS — the seeded lot shows the copy affordance on its dated row in the drawer ledger');
}
log(`artifact driver log: ${LOGFILE}`);
