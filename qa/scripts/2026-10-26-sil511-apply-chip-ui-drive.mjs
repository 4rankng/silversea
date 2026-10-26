// SIL-511 UI drive — Form tạo lô: chip 'Áp dụng cho N container' removed.
//
// /shipments/new (1440, CUS account — shipmentCreatorOnly admits ADMIN/CUS/
// DISPATCHER/MANAGER): the FCL "Lịch & ghi chú" section must NOT render the
// '📅 Áp dụng cho N container' chip, while the rest of the schedule group
// stays intact (bulk input 'Ngày giờ đóng trả cho tất cả cont' + section
// clipboard copy affordance). Read-only: no submit, GETs + login only.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-26-sil511-apply-chip-ui-drive.mjs
// Output: qa/2026-10-26-sil511-apply-chip/*.png + JSON assertions on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7197';
// Local dev CUS account — testplan/testaccounts.txt (password line Abc123).
const QA_USER = process.env.QA_USER || 'cus';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const OUT = resolve(process.cwd(), '../qa/2026-10-26-sil511-apply-chip');
mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(user, pass) {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('request', (r) => {
    const url = r.url();
    if (url.includes('/api/')) apiCalls.push(`${r.method()} ${new URL(url).pathname}`);
  });
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  if (page.url().includes('login')) throw new Error(`login failed for ${user}`);
  return { page, apiCalls };
}

const { page, apiCalls } = await login(QA_USER, QA_PASS);
await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('#shipment-section-schedule', { timeout: 45000 });
await sleep(700);

const results = {};

// ── 1. Fresh FCL form: schedule section without the chip ───────────────────
results.fresh = await page.evaluate(() => {
  const section = document.querySelector('#shipment-section-schedule');
  const chipButton = [...section.querySelectorAll('button')]
    .find((b) => /Áp dụng cho \d+ container/.test(b.textContent));
  return {
    sectionTitle: section.querySelector('h2')?.textContent.trim() ?? null,
    applyChipPresent: Boolean(chipButton),
    applyChipText: chipButton?.textContent.trim() ?? null,
    bulkInputPresent: Boolean(section.querySelector('input[id$="-bulk-appointment-date"]')),
    bulkLabelPresent: section.textContent.includes('Ngày giờ đóng trả cho tất cả cont'),
  };
});
let sectionHandle = await page.$('#shipment-section-schedule');
await sectionHandle.screenshot({ path: resolve(OUT, 'ui-schedule-section-1440-no-chip.png') });
await sectionHandle.dispose();

// ── 2. Two containers + a scheduled source row: the OTHER apply-all paths
//      (copy-down / copy-ALL) must render while the chip stays gone. ─────────
await page.evaluate(() => {
  const setNative = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const addBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Thêm container');
  addBtn.click();
});
await sleep(400);
await page.evaluate(() => {
  const setNative = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const date = [...document.querySelectorAll('input[id$="-customer-appointment-date"]')][0];
  const time = [...document.querySelectorAll('input[id$="-customer-appointment-time"]')][0];
  setNative(date, '28/10/2026');
  setNative(time, '09:30');
});
await sleep(700);

results.withSourceRow = await page.evaluate(() => {
  const section = document.querySelector('#shipment-section-schedule');
  const sectionButtons = [...section.querySelectorAll('button')].map((b) => b.textContent.trim());
  const chipButton = [...section.querySelectorAll('button')]
    .find((b) => /Áp dụng cho \d+ container/.test(b.textContent));
  const copyAll = [...section.querySelectorAll('button')]
    .find((b) => /Copy giờ hẹn cho tất cả \d+ cont/.test(b.textContent));
  const copyDown = [...section.querySelectorAll('button')]
    .find((b) => b.textContent.includes('Copy giờ hẹn xuống cont trống'));
  const firstRowFilled = [...document.querySelectorAll('.csc-container-row')][0]?.textContent.includes('28/10/2026');
  return {
    applyChipPresent: Boolean(chipButton),
    copyAllPresent: Boolean(copyAll),
    copyAllText: copyAll?.textContent.trim() ?? null,
    copyDownPresent: Boolean(copyDown),
    sectionButtons,
    firstRowFilled,
  };
});
await page.screenshot({ path: resolve(OUT, 'ui-create-form-1440-full.png') });
sectionHandle = await page.$('#shipment-section-schedule');
await sectionHandle.screenshot({ path: resolve(OUT, 'ui-schedule-section-1440-copy-paths-no-chip.png') });
await sectionHandle.dispose();
results.mutatorApiCalls = apiCalls.filter((c) => !c.startsWith('GET ') && !c.startsWith('POST /api/auth/'));

await browser.close();
writeFileSync(resolve(OUT, 'ui-drive-assertions.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));

const ok = !results.fresh.applyChipPresent
  && results.fresh.bulkInputPresent
  && results.fresh.bulkLabelPresent
  && results.fresh.sectionTitle === 'Lịch & ghi chú'
  && !results.withSourceRow.applyChipPresent
  && results.withSourceRow.copyAllPresent
  && results.withSourceRow.copyDownPresent
  && results.withSourceRow.firstRowFilled
  && results.mutatorApiCalls.length === 0;
if (!ok) {
  console.error(`ASSERT FAILED: fresh=${JSON.stringify(results.fresh)} withSourceRow=${JSON.stringify(results.withSourceRow)}`);
  process.exit(1);
}
console.log('SIL-511 UI drive: PASS — chip removed, copy-down/copy-ALL apply paths intact');
