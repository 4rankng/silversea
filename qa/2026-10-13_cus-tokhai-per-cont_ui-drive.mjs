// Card 261013200312 — rung-3 UI drive (AGENTS §9).
// CUS user on /shipments-detail ("Chi tiết lô hàng"): per-cont tờ khai
// add → copy propagation to the sibling → per-cont divergence after copy →
// single-container lot without the copy affordance.
// Stack: frontend http://localhost:7176 → backend :3003 → QA DB :5541 (ss-tokhai-qa-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3003/api';
const ART = 'qa';
const LOG = 'qa/2026-10-13_cus-tokhai-per-cont_ui-driver.log';
const SHIPMENT = 41; // BULK-EXP-0022, 2 conts, no tờ khai
const SINGLE = 6;    // 1 cont, backfilled number
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login cus: ${token ? 'OK' : 'FAIL'}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
page.on('dialog', (d) => void d.accept());

const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-10-13_cus-tokhai-per-cont_ui-${name}.png`, fullPage: false }); log(`shot ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const clickButtonByName = async (re) => {
  const ok = await page.evaluate((pattern) => {
    const re2 = new RegExp(pattern);
    const btn = [...document.querySelectorAll('button')].find((b) => {
      const label = `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`.trim();
      return re2.test(label) && !b.disabled;
    });
    if (!btn) return false;
    btn.click();
    return true;
  }, re);
  if (!ok) throw new Error(`button not found/enabled: ${re}`);
};

const setNativeInputValue = (input, value) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const typeDeclaration = async (value) => {
  await page.evaluate((val) => {
    const input = [...document.querySelectorAll('.shipment-container-ledger__inline-editor[data-mode="documents"] input')]
      .find((i) => i.maxLength === 50);
    if (!input) throw new Error('declaration input not found');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, val);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await sleep(150);
};

const openDocumentsEditor = async (rowIndex) => {
  // Triggers are labelled by container number when present; the workboard is
  // filtered to ONE lot here, so "the Nth documents trigger" is the Nth cont.
  const ok = await page.evaluate((index) => {
    const label = (b) => `${b.getAttribute('aria-label') || ''} ${b.textContent || ''}`;
    const triggers = [...document.querySelectorAll('button')]
      .filter((b) => /chứng từ và hãng tàu/i.test(label(b)))
      .filter((b) => !b.disabled);
    const trigger = triggers[index - 1];
    if (!trigger) return false;
    trigger.click();
    return true;
  }, rowIndex);
  if (!ok) throw new Error(`documents trigger #${rowIndex} not found/enabled`);
  await page.waitForSelector('.shipment-container-ledger__inline-editor[data-mode="documents"]', { visible: true, timeout: 8000 });
  await sleep(250);
};

const saveEditor = async () => { await clickButtonByName('^Lưu'); await sleep(900); };

const readCellTexts = () => page.evaluate(() => (
  [...document.querySelectorAll('td[data-label="Chứng từ & hãng tàu"]')]
    .map((td) => {
      const codes = td.querySelectorAll('.shipment-container-ledger__code');
      // [0] = bill/booking, [1] = tờ khai
      return codes[1] ? codes[1].textContent.trim() : null;
    })
    .filter((t) => t != null)
));

try {
  // ── Step 1: the workboard shows two conts without tờ khai ─────────────
  await page.goto(`${BASE}/shipments-detail?searchSuffix=BULK-EXP-0022&dateScope=all`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 15000 });
  await sleep(600);
  let cells = await readCellTexts();
  log(`step1 cells: ${JSON.stringify(cells)}`);
  if (!cells.every((t) => t === 'Chưa có tờ khai')) throw new Error(`step1 expected 2× Chưa có tờ khai, got ${JSON.stringify(cells)}`);
  await shot('01-before');

  // ── Step 2: per-cont ADD inside the documents editor ──────────────────
  await openDocumentsEditor(1);
  const fieldOk = await page.evaluate(() => {
    const input = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"] label span');
    return input ? [...document.querySelectorAll('.shipment-container-ledger__inline-editor[data-mode="documents"] label > span')].some((s) => s.textContent.trim() === 'Số tờ khai') : false;
  });
  if (!fieldOk) throw new Error('step2: Số tờ khai field missing from the documents editor');
  await typeDeclaration('QA-TK-41-A');
  await shot('02-editor-add');
  await saveEditor();
  await page.waitForFunction(() => [...document.querySelectorAll('td[data-label="Chứng từ & hãng tàu"] .shipment-container-ledger__code')].some((el) => el.textContent.trim() === 'QA-TK-41-A'), { timeout: 10000 });
  cells = await readCellTexts();
  log(`step2 cells: ${JSON.stringify(cells)}`);
  await shot('03-after-add');

  // ── Step 3: COPY propagates to the sibling container ──────────────────
  await openDocumentsEditor(1);
  await clickButtonByName('^Copy số tờ khai sang 1 cont chưa có số');
  await sleep(1000);
  await page.waitForFunction(() => [...document.querySelectorAll('td[data-label="Chứng từ & hãng tàu"] .shipment-container-ledger__code')].filter((el) => el.textContent.trim() === 'QA-TK-41-A').length === 2, { timeout: 10000 });
  cells = await readCellTexts();
  log(`step3 cells after copy: ${JSON.stringify(cells)}`);
  const toast3 = await page.evaluate(() => document.body.textContent.includes('Đã copy số tờ khai sang 1 container'));
  log(`step3 toast visible: ${toast3}`);
  await shot('04-after-copy');

  // ── Step 4: DIVERGENCE — edit the sibling's own number ────────────────
  await openDocumentsEditor(2);
  const seededCopy = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.shipment-container-ledger__inline-editor[data-mode="documents"] input')]
      .find((i) => i.maxLength === 50);
    return input ? input.value : null;
  });
  if (seededCopy !== 'QA-TK-41-A') throw new Error(`step4: sibling input should carry the copied number, got ${seededCopy}`);
  await typeDeclaration('QA-TK-41-B');
  await shot('05-editor-diverge');
  await saveEditor();
  await page.waitForFunction(() => {
    const codes = [...document.querySelectorAll('td[data-label="Chứng từ & hãng tàu"] .shipment-container-ledger__code')].map((el) => el.textContent.trim());
    return codes.includes('QA-TK-41-A') && codes.includes('QA-TK-41-B');
  }, { timeout: 10000 });
  cells = await readCellTexts();
  log(`step4 cells after divergence: ${JSON.stringify(cells)}`);
  await shot('06-after-divergence');

  // ── Step 5: single-container lot — no copy affordance ─────────────────
  await page.goto(`${BASE}/shipments-detail?searchSuffix=102250310877&dateScope=all`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.shipment-container-ledger tbody tr', { timeout: 15000 });
  await sleep(600);
  await openDocumentsEditor(1);
  const copyAbsent = await page.evaluate(() => !document.body.textContent.includes('Copy số tờ khai sang'));
  const singleValue = await page.evaluate(() => {
    const input = [...document.querySelectorAll('.shipment-container-ledger__inline-editor[data-mode="documents"] input')].find((i) => i.maxLength === 50);
    return input ? input.value : null;
  });
  log(`step5 copy affordance absent: ${copyAbsent}; seeded field: ${singleValue}`);
  if (!copyAbsent) throw new Error('step5: copy affordance must be absent on a single-container lot');
  await shot('07-single-cont-lot');

  // ── Step 6: workboard overview cell sees the union (regression guard) ─
  await page.goto(`${BASE}/shipments?searchSuffix=BULK-EXP-0022`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.cus-dashboard-table tbody tr, table tbody tr', { timeout: 15000 });
  await sleep(700);
  const overview = await page.evaluate(() => document.body.textContent.includes('QA-TK-41-A') && document.body.textContent.includes('QA-TK-41-B'));
  log(`step6 overview workboard shows both numbers: ${overview}`);
  await shot('08-overview-union');

  log('ALL STEPS PASSED');
} catch (error) {
  await shot('99-failure');
  log(`FAILURE: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
