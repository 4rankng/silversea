// FB-002 LAN 3 (card 211026034109) — staging repro, PART 3: /shipments/new.
// Real-user FCL flow: customer + direction + booking + FCL + số cont, then the
// ô giờ (Ngày giờ đóng trả, SplitDateTimeField combinedPicker):
//   N1 click ô giờ, type "1630" only, Enter (twice) — save? wipe? feedback?
//   N2 type the date too, Enter — save? wipe? POST /shipments?
// Captures a full form snapshot around every keystroke/Enter.
// Usage: node testplan/qa/scripts/2026-10-21-fb002-lan3-staging-new.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-21-fb002-lan3');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => {
  results.push({ id, pass, detail });
  if (!pass) exitCode = 1;
  log('RESULT', { id, pass, detail });
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  const { token } = await res.json();
  return token;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });

try {
  const token = await login('tiepvv');
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const apiHits = [];
  page.on('request', (req) => {
    if (/\/api\/shipments/.test(req.url()) && !['GET', 'OPTIONS'].includes(req.method())) {
      apiHits.push({ method: req.method(), url: req.url(), body: req.postData() ?? null });
      log('mutation', { method: req.method(), url: req.url(), body: (req.postData() ?? '').slice(0, 300) });
    }
  });

  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('form.csc-workspace', { timeout: 20000 });

  const formSnapshot = () => page.evaluate(() => {
    const val = (sel) => document.querySelector(sel)?.value ?? null;
    const segs = Array.from(document.querySelectorAll('[data-seg-part] input[data-seg]'))
      .map((i) => `${i.closest('[data-seg-part]')?.getAttribute('data-seg-part')}:${i.getAttribute('data-seg')}=${i.value}`);
    const a = document.activeElement;
    return {
      url: location.pathname,
      customerText: val('[data-field-id="shipment-customer"] input') ?? val('#shipment-customer'),
      booking: val('[data-field-id="shipment-booking-ref"] input'),
      contNumber: val('input[aria-label="Số container"]'),
      contTimeSegs: segs,
      bulkTimeSegs: Array.from(document.querySelectorAll('#shipment-bulk-appointment [data-seg-part] input[data-seg]') ?? []).map((i) => `${i.getAttribute('data-seg')}=${i.value}`),
      popupOpen: Boolean(document.querySelector('.combined-datetime__popup, .date-picker__popup')),
      issueText: Array.from(document.querySelectorAll('.csc-summary [role="alert"], .csc-workspace [role="alert"]')).map((e) => e.textContent?.trim()).slice(0, 4),
      activeSeg: a?.getAttribute('data-seg') ?? null,
      activePart: a?.closest('[data-seg-part]')?.getAttribute('data-seg-part') ?? null,
      activeLabel: a?.getAttribute('aria-label') ?? null,
      requiredChip: document.querySelector('.csc-topline__required, [data-required]')?.textContent?.trim() ?? null,
    };
  });

  // ── Fill the form like a CUS: customer → direction → booking → FCL ───────
  // 1. Customer searchable select: type-ahead, pick first option.
  const customerInput = await page.$('[data-field-id="shipment-customer"] input');
  if (!customerInput) throw new Error('customer input not found');
  await customerInput.click();
  await page.keyboard.type('a', { delay: 40 });
  await sleep(700);
  let picked = await page.evaluate(() => {
    const opt = document.querySelector('.searchable-select__option, [role="option"]');
    if (opt) { opt.click(); return opt.textContent?.trim(); }
    return null;
  });
  if (!picked) {
    picked = await page.evaluate(() => {
      const opts = Array.from(document.querySelectorAll('.searchable-select__popover button, .searchable-select__popover [role="option"]'));
      if (opts.length) { opts[0].click(); return opts[0].textContent?.trim(); }
      return null;
    });
  }
  await sleep(400);
  log('customer_picked', { picked });
  await page.keyboard.press('Escape');

  // 2. Trade direction: Xuất khẩu (EXPORT) — custom UUI select: open + pick.
  await page.click('[data-field-id="shipment-trade-direction"] button, [data-field-id="shipment-trade-direction"] [role="combobox"], [data-field-id="shipment-trade-direction"] .searchable-select__trigger', { timeout: 8000 }).catch(() => {});
  await sleep(400);
  await page.evaluate(() => {
    const opt = Array.from(document.querySelectorAll('[role="option"], .searchable-select__option, .uui-select__option'))
      .find((el) => (el.textContent || '').includes('Xuất khẩu'));
    if (opt instanceof HTMLElement) { opt.click(); return; }
    const anyOpt = document.querySelector('[role="option"]');
    if (anyOpt instanceof HTMLElement) anyOpt.click();
  });
  await sleep(400);
  await page.keyboard.press('Escape');

  // 3. Booking number.
  await page.type('[data-field-id="shipment-booking-ref"] input', 'QA-FB002-LAN3', { delay: 20 });
  await sleep(200);

  // 4. FCL mode radio.
  await page.evaluate(() => {
    const label = Array.from(document.querySelectorAll('label, .csc-mode__option'))
      .find((el) => (el.textContent || '').includes('Hàng FCL'));
    const radio = label ? (label.querySelector('input') ?? (label.closest('label')?.querySelector('input'))) : null;
    const target = radio instanceof HTMLInputElement ? radio : label;
    if (target instanceof HTMLElement) target.click();
  });
  await sleep(500);
  let st = await formSnapshot();
  log('form_stage1', st);
  await page.screenshot({ path: path.join(OUT, 'N0_form-stage1.png') });

  // 5. Container number (valid ISO-6346 from lot 965).
  const contInput = await page.$('input[aria-label="Số container"]');
  if (!contInput) throw new Error('container number input not found');
  await contInput.click();
  await page.keyboard.type('TEMU1234565', { delay: 30 });
  await sleep(300);
  st = await formSnapshot();
  log('form_stage2', st);

  // ══ N1: click ô giờ, type "1630" only, Enter twice ═══════════════════════
  const timeSeg = await page.$('.csc-workspace [data-seg-part="time"] input[data-seg]');
  if (!timeSeg) throw new Error('time segment not found in create form');
  await timeSeg.click();
  await sleep(400); // combined picker opens on click
  st = await formSnapshot();
  log('N1_after_click_gio', st);
  await page.keyboard.type('1630', { delay: 110 });
  await sleep(400);
  st = await formSnapshot();
  log('N1_after_typing_1630', st);
  await page.screenshot({ path: path.join(OUT, 'N1_after-typing-1630.png') });
  apiHits.length = 0;
  await page.keyboard.press('Enter');
  await sleep(900);
  st = await formSnapshot();
  log('N1_after_enter1', { ...st, apiHits: apiHits.length });
  await page.keyboard.press('Enter');
  await sleep(900);
  st = await formSnapshot();
  log('N1_after_enter2', { ...st, apiHits: apiHits.length });
  await page.screenshot({ path: path.join(OUT, 'N1_after-enter.png') });
  const timeBeforeEnter = st.contTimeSegs.filter((s) => s.startsWith('time:'));
  record('N1 giờ-only "16:30" + Enter×2 on /shipments/new → NO create POST, typed giờ KEPT (no wipe), visible guidance',
    apiHits.length === 0 && st.contTimeSegs.some((s) => /time:hh=16|time:mm=30/.test(s)) && st.url === '/shipments/new',
    `apiHits=${apiHits.length} contTimeSegs=${JSON.stringify(st.contTimeSegs)} issues=${JSON.stringify(st.issueText)} active=${st.activePart}:${st.activeSeg} url=${st.url}`);

  // ══ N2: type the date, Enter — does the form create or stay? ═════════════
  await page.keyboard.type('22112026', { delay: 100 });
  await sleep(500);
  st = await formSnapshot();
  log('N2_after_date', st);
  await page.screenshot({ path: path.join(OUT, 'N2_after-date.png') });
  apiHits.length = 0;
  await page.keyboard.press('Enter');
  await sleep(1400);
  st = await formSnapshot();
  log('N2_after_enter', { ...st, apiHits: apiHits.length });
  await page.screenshot({ path: path.join(OUT, 'N2_after-enter.png') });
  record('N2 full "16:30 22/11/2026" + Enter on /shipments/new → không tự tạo lô (dead key ok) HOẶC create chạy — trạng thái được ghi, KHÔNG mất trắng input',
    st.url === '/shipments/new'
      ? (st.contNumber === 'TEMU1234565' && st.booking === 'QA-FB002-LAN3')
      : true,
    `apiHits=${apiHits.length} url=${st.url} contNumber=${st.contNumber} booking=${st.booking} contTimeSegs=${JSON.stringify(st.contTimeSegs)} issues=${JSON.stringify(st.issueText)}`);

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}

fs.writeFileSync(path.join(OUT, 'staging-new-driver.log'), JSON.stringify(LOG, null, 2));
fs.writeFileSync(path.join(OUT, 'staging-new-results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
