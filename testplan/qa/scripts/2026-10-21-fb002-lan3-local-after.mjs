// FB-002 LAN 3 (card 211026034109) — LOCAL AFTER evidence: /shipments/new.
// Same surface/flow as the staging N-probes, against the FIXED local build
// (make dev: frontend :7175, api :3002). Port contract: 7175/3002 (env-overridable).
//   A1 incomplete form + COMPLETE datetime + Enter → save attempt RUNS
//      (validation summary paints — was a silent dead key) + inputs KEPT.
//   A2 full minimum form + Enter in ô giờ → POST /shipments creates the lot
//      carrying the typed giờ (DB proof via list refetch).
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-local-after.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const BASE = process.env.QA_BASE || 'http://localhost:7175';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-21-fb002-lan3');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); if (!pass) exitCode = 1; log('RESULT', { id, pass, detail }); };
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const token = await login('cus');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const apiHits = [];
  let lastCreateBody = null;
  page.on('request', (req) => {
    if (/\/api\/shipments\/quick$/.test(req.url()) && req.method() === 'POST') {
      apiHits.push({ method: 'POST', url: req.url() });
      lastCreateBody = req.postData();
      log('mutation', { url: req.url(), body: (req.postData() ?? '').slice(0, 400) });
    }
  });
  page.on('response', async (res) => {
    if (/\/api\/shipments\/quick$/.test(res.url()) && res.request().method() === 'POST') {
      try { log('mutation_status', { status: res.status, body: (await res.text()).slice(0, 260) }); } catch { /* noop */ }
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('form.csc-workspace', { timeout: 20000 });

  const snap = () => page.evaluate(() => {
    const segs = Array.from(document.querySelectorAll('.csc-workspace [data-seg-part] input[data-seg]'))
      .map((i) => `${i.closest('[data-seg-part]')?.getAttribute('data-seg-part')}:${i.getAttribute('data-seg')}=${i.value}`);
    return {
      url: location.pathname,
      customerText: document.querySelector('[data-field-id="shipment-customer"] input')?.value ?? null,
      booking: document.querySelector('[data-field-id="shipment-booking-ref"] input')?.value ?? null,
      contNumber: document.querySelector('input[aria-label="Số container"]')?.value ?? null,
      contTimeSegs: segs,
      summary: document.querySelector('.csc-validation-summary')?.textContent?.trim().slice(0, 220) ?? null,
      summaryCount: document.querySelector('.csc-validation-summary')?.textContent?.match(/Cần bổ sung (\d+)/)?.[1] ?? null,
      activeLabel: document.activeElement?.getAttribute('aria-label') ?? null,
    };
  });

  // ── Fill: customer, EXPORT, booking, FCL default, container number ──────
  const customerInput = await page.$('[data-field-id="shipment-customer"] input');
  await customerInput.click();
  await page.keyboard.type('k', { delay: 40 });
  await sleep(700);
  const picked = await page.evaluate(() => {
    const opt = document.querySelector('[role="option"]');
    if (opt instanceof HTMLElement) { opt.click(); return opt.textContent?.trim(); }
    return null;
  });
  await sleep(400);
  await page.keyboard.press('Escape');
  log('customer_picked', { picked });

  await page.click('[data-field-id="shipment-trade-direction"] button, [data-field-id="shipment-trade-direction"] [role="combobox"], [data-field-id="shipment-trade-direction"] .searchable-select__trigger', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"], .searchable-select__option'))
      .find((el) => (el.textContent || '').includes('Xuất khẩu'));
    if (opt instanceof HTMLElement) opt.click();
  });
  await sleep(400);
  await page.keyboard.press('Escape');
  await page.type('[data-field-id="shipment-booking-ref"] input', 'QA-FB002-LAN3-LOCAL', { delay: 15 });
  const contInput = await page.$('input[aria-label="Số container"]');
  await contInput.click();
  await page.keyboard.type('TEMU1234565', { delay: 25 });

  // ══ A1: COMPLETE datetime + Enter with the form still missing fields ═════
  const timeSeg = await page.$('.csc-workspace [data-seg-part="time"] input[data-seg]');
  await timeSeg.click();
  await sleep(400);
  await page.keyboard.type('1630', { delay: 100 });
  await sleep(300);
  await page.keyboard.type('22112026', { delay: 90 });
  await sleep(400);
  let st = await snap();
  log('A1_after_datetime', st);
  await page.screenshot({ path: path.join(OUT, 'A1_after-datetime.png') });
  apiHits.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1400);
  st = await snap();
  log('A1_after_enter', { ...st, apiHits: apiHits.length });
  await page.screenshot({ path: path.join(OUT, 'A1_after-enter.png'), fullPage: true });
  record('A1 FIXED: complete datetime + Enter → save attempt RAN (summary paints) and every typed input KEPT',
    Boolean(st.summaryCount) && st.contNumber === 'TEMU1234565' && st.booking === 'QA-FB002-LAN3-LOCAL'
      && st.contTimeSegs.some((s) => s === 'time:hh=16') && st.contTimeSegs.some((s) => s === 'date:yyyy=2026'),
    `summary=${st.summaryCount} contTimeSegs=${JSON.stringify(st.contTimeSegs)} apiHits=${apiHits.length} active=${st.activeLabel}`);
  // Fill whatever the summary names: the FCL row's five picker cells.
  for (const label of ['Loại container', 'Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ']) {
    const opened = await page.evaluate((lbl) => {
      const input = Array.from(document.querySelectorAll(`input[aria-label="${lbl}"]`))[0];
      if (input instanceof HTMLInputElement) { input.closest('td, .csc-container-cell')?.dispatchEvent(new MouseEvent('click', { bubbles: true })); input.click(); return true; }
      return false;
    }, label);
    if (!opened) continue;
    await sleep(600);
    await page.evaluate(() => {
      const opt = document.querySelector('[role="option"], .searchable-select__option, .csc-type-picker__option, .combobox-option, li[data-highlighted], [data-key]');
      if (opt instanceof HTMLElement) { opt.click(); return; }
      const btns = Array.from(document.querySelectorAll('.csc-type-picker button, [role="listbox"] button, [role="listbox"] li'));
      if (btns.length) btns[0].click();
    });
    await sleep(450);
    await page.keyboard.press('Escape');
    await sleep(250);
  }
  st = await snap();
  log('A2_prefill_done', st);

  // ══ A2: Enter in ô giờ again → the create itself should ride ═════════════
  apiHits.length = 0;
  // focus() (not click — a click on a combinedPicker field opens the popup
  // and the field law correctly spends the first Enter closing it).
  await page.evaluate(() => {
    const seg = document.querySelector('.csc-workspace [data-seg-part="date"] input[data-seg="yyyy"]');
    if (seg instanceof HTMLInputElement) seg.focus();
  });
  await sleep(250);
  await page.keyboard.press('Enter');
  await sleep(2200);
  st = await snap();
  log('A2_after_enter', { ...st, apiHits: apiHits.length });
  await page.screenshot({ path: path.join(OUT, 'A2_after-enter.png') });
  record('A2 FIXED: Enter in ô giờ submits the create — POST /shipments fired carrying the typed giờ (16:30 22/11)',
    apiHits.length > 0 && /2026-11-22T16:30/.test(lastCreateBody ?? ''),
    `apiHits=${apiHits.length} body=${(lastCreateBody ?? '').slice(0, 220)} url=${st.url}`);

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'local-after-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'local-after-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
