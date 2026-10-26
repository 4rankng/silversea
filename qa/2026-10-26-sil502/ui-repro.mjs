// SIL-502 repro (SPEC a) — create a lot WITH tờ khai through the real
// quick-create form, then read the CHỨNG TỰ cell on the Tổng quan workboard.
import puppeteer from 'puppeteer-core';
import { writeFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:7185';
const API = process.env.API_URL || 'http://localhost:3012';
const TS = Date.now();
const BILL = `SIL502UI${TS}`;
const DECL = `502UI-${TS}`;
const CONT = 'SILU5001029'; // valid ISO 6346 check digit

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
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 160)); });
const shot = (name) => page.screenshot({ path: `../qa/2026-10-26-sil502/${name}.png` }).then(() => console.log('SHOT', name));

const step = async (name, fn) => {
  try { await fn(); } catch (e) { await shot(`fail-${name}`); throw new Error(`STEP ${name}: ${e.message}`); }
};

await step('open-form', async () => {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('[data-field-id="shipment-customer"] input', { timeout: 20000 });
});

await step('customer', async () => {
  await page.click('[data-field-id="shipment-customer"] input');
  await page.type('[data-field-id="shipment-customer"] input', 'LONG MINH');
  await page.waitForSelector('[role="option"]', { timeout: 10000 });
  const options = await page.$$('[role="option"]');
  await options[0].click();
});

const pickRacOption = async (scopeSel, optionText) => {
  await page.click(`${scopeSel} button[aria-haspopup="listbox"], ${scopeSel} [role="button"]`);
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 8000 });
  const opts = await page.$$('[role="listbox"] [role="option"]');
  for (const o of opts) {
    const t = (await o.evaluate((el) => el.textContent)) || '';
    if (t.includes(optionText)) { await o.click(); return; }
  }
  throw new Error(`option "${optionText}" not found`);
};

await step('direction', async () => {
  await pickRacOption('[data-field-id="shipment-trade-direction"]', 'Nhập khẩu');
});

await step('bill', async () => {
  await page.click('input[placeholder="Nhập số Bill (hàng Nhập)"]');
  await page.type('input[placeholder="Nhập số Bill (hàng Nhập)"]', BILL);
});

await step('declaration', async () => {
  const input = await page.$('input[aria-label="Số tờ khai"]');
  if (!input) throw new Error('declaration chip input not found');
  await input.click();
  await input.type(DECL);
  await page.keyboard.press('Enter');
  await page.waitForFunction((d) => document.body.innerText.includes(d), {}, DECL);
});

await step('container', async () => {
  const numInput = await page.waitForSelector('input[aria-label="Số container"]', { timeout: 8000 });
  await numInput.type(CONT);
  // Card 20261002_272: Tab LEAVING the number field opens the type picker.
  await page.keyboard.press('Tab');
  await page.waitForSelector('[role="listbox"] [role="option"]', { timeout: 8000 });
  const opts = await page.$$('[role="listbox"] [role="option"]');
  await opts[0].click();
});

const fillCombobox = async (label) => {
  await page.evaluate((lb) => {
    const input = [...document.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === lb);
    input.focus();
  }, label);
  await page.keyboard.press('ArrowDown');
  await new Promise((r) => setTimeout(r, 350));
  await page.keyboard.press('Enter');
  await new Promise((r) => setTimeout(r, 350));
};

await step('container-context', async () => {
  await fillCombobox('Nhà máy');
  await fillCombobox('Tuyến đường');
  await fillCombobox('Cảng nâng');
  await fillCombobox('Cảng hạ');
});

await step('appointment', async () => {
  const d = await page.$('#shipment-bulk-appointment-date');
  await d.click(); await d.type('01112026');
  const t = await page.$('#shipment-bulk-appointment-time');
  await t.click(); await t.type('0800');
  const applyBtn = await page.$$eval('button', (btns) => {
    const b = btns.find((el) => (el.textContent || '').includes('Áp dụng cho'));
    if (b) { b.click(); return true; }
    return false;
  });
  if (!applyBtn) throw new Error('apply button not found');
  await new Promise((r) => setTimeout(r, 400));
});

await step('save', async () => {
  const btns = await page.$$('button');
  let clicked = false;
  for (const b of btns) {
    const t = (await b.evaluate((el) => el.textContent)) || '';
    if (t.includes('Tạo lô hàng')) { await b.click(); clicked = true; break; }
  }
  if (!clicked) throw new Error('save button not found');
  await page.waitForFunction(() => /\/shipments\/\d+$/.test(location.pathname), { timeout: 45000 });
});
const detailUrl = page.url();
const shipmentId = Number(detailUrl.match(/\/shipments\/(\d+)$/)[1]);
console.log('CREATED lot id:', shipmentId, 'url:', detailUrl);
await shot('after-create-detail');

// post-create VIEW: is tờ khai visible on the land page?
const detailText = await page.evaluate(() => document.body.innerText);
console.log('DETAIL_SHOWS_DECL:', detailText.includes(DECL));
await shot('detail-viewport');

await step('overview', async () => {
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector(`#cus-inline-documents-${shipmentId}`, { timeout: 25000 });
});
const row = await page.$(`#cus-inline-documents-${shipmentId}`);
await row.evaluate((el) => el.scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 500));
const cellText = await row.evaluate((el) => el.textContent);
console.log('OVERVIEW_CELL_TEXT:', JSON.stringify(cellText));
console.log('OVERVIEW_SHOWS_DECL:', cellText.includes(DECL));
await shot('after-create-overview');

writeFileSync('../qa/2026-10-26-sil502/ui-repro-result.json', JSON.stringify({
  ts: new Date().toISOString(), shipmentId, bill: BILL, declaration: DECL, container: CONT,
  detailUrl, detailShowsDeclaration: detailText.includes(DECL), overviewCellText: cellText,
  overviewShowsDeclaration: cellText.includes(DECL),
}, null, 2));
await browser.close();
console.log('OK');
