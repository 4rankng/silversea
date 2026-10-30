// SIL-596/598 review follow-up — drive the FREIGHT-PRESENT ≥1280 state.
// The main sweep ran freight-absent (fresh form; pricing engine needs
// customer + route + 20ft type + transport date). This pass FILLS those
// four inputs on the REAL form so FreightPreviewCard renders, then
// measures the worksheet rows (freight full-width row 2) + screenshots.
// LOCAL ONLY, read-only (no submit).
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const OUT = process.env.EVIDENCE ?? 'qa/2026-10-30_sil596-freight-present';
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED'); process.exit(1); }
console.log(`LOGIN OK (admin) — evidence dir ${OUT}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1307, height: 800 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`));

await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
await page.waitForSelector('#shipment-section-identity', { timeout: 20000 });
await sleep(600);

const pickFirstOption = async () => {
  await page.waitForSelector('[role="option"]', { timeout: 8000 });
  await sleep(250);
  await page.click('[role="option"]');
  await sleep(300);
};

// 1) customer (real catalog option — not ad-hoc)
const customerInput = 'input[data-field="shipment-customer"], [data-field="shipment-customer"] input';
await page.click(customerInput);
await page.type(customerInput, 'a', { delay: 40 });
await sleep(500);
await pickFirstOption();
console.log('customer picked');

// 2) container type (CONT20… → previewSizeClass CONT20)
const typeSel = '[data-field-id$="-type"] input';
await page.waitForSelector(typeSel, { timeout: 10000 });
await page.click(typeSel);
await page.type(typeSel, '20', { delay: 40 });
await sleep(600);
await pickFirstOption();
console.log('type picked');

// 3) route
const routeSel = '[data-field-id$="-route"] input';
await page.click(routeSel);
await page.type(routeSel, 'a', { delay: 40 });
await sleep(600);
await pickFirstOption();
console.log('route picked');

// 4) transport date + time (masked inputs — type digits only, mask inserts slashes)
const dateSel = 'input[id$="-customer-appointment-date"]';
const timeSel = 'input[id$="-customer-appointment-time"]';
await page.click(dateSel, { clickCount: 3 });
await page.keyboard.down('Control');
await page.keyboard.press('a');
await page.keyboard.up('Control');
await sleep(150);
await page.keyboard.press('Backspace');
await page.type(dateSel, '05112026', { delay: 60 });
await page.click(timeSel, { clickCount: 3 });
await page.keyboard.down('Control');
await page.keyboard.press('a');
await page.keyboard.up('Control');
await sleep(150);
await page.keyboard.press('Backspace');
await page.type(timeSel, '0800', { delay: 60 });
await page.click('body');
await sleep(2500);

const probe = await page.evaluate(() => {
  const val = (sel) => document.querySelector(sel)?.value ?? null;
  return {
    customer: val('input[data-field="shipment-customer"], [data-field="shipment-customer"] input'),
    type: val('[data-field-id$="-type"] input'),
    route: val('[data-field-id$="-route"] input'),
    date: val('input[id$="-customer-appointment-date"]'),
    time: val('input[id$="-customer-appointment-time"]'),
    freightInDom: Boolean(document.querySelector('[data-freight-preview]')),
  };
});
console.log(`PROBE: ${JSON.stringify(probe)}`);
if (!probe.freightInDom) {
  await sleep(4000);
  const again = await page.evaluate(() => Boolean(document.querySelector('[data-freight-preview]')));
  console.log(`freight after extra wait: ${again}`);
}
const freight = await page.$('[data-freight-preview]');
if (!freight) { console.log('FREIGHT NEVER RENDERED — see PROBE'); await page.screenshot({ path: `${OUT}/ui-freight-miss-1307.png`, fullPage: false }); await browser.close(); process.exit(2); }
const state = await page.evaluate(() => {
  const box = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) };
  };
  const freightEl = document.querySelector('[data-freight-preview]');
  const body = document.querySelector('.app-body');
  return {
    freightKind: freightEl?.getAttribute('data-freight-preview'),
    freight: box('[data-freight-preview]'),
    freightText: (freightEl?.textContent ?? '').slice(0, 160),
    identity: box('#shipment-section-identity'),
    mode: box('#shipment-section-mode'),
    schedule: box('#shipment-section-schedule'),
    contact: box('.csc-identity-grid--contact'),
    refs: box('.csc-identity-grid--refs'),
    workspace: box('.csc-workspace'),
    scrollbar: body ? { overflowY: body.scrollHeight - body.clientHeight } : null,
  };
});
console.log(`freight: ${JSON.stringify({ kind: state.freightKind, ...state.freight, text: state.freightText })}`);
console.log(`identity: ${JSON.stringify(state.identity)}`);
console.log(`mode: ${JSON.stringify(state.mode)} contact: ${JSON.stringify(state.contact)} refs: ${JSON.stringify(state.refs)}`);
console.log(`schedule: ${JSON.stringify(state.schedule)} scrollbarOverflow: ${state.scrollbar?.overflowY}`);
const ok = state.freight && state.freight.w >= (state.workspace ? state.workspace.w - 40 : 0);
console.log(`FREIGHT ROW FULL-WIDTH: ${ok ? 'PASS' : 'FAIL'} (freight w=${state.freight?.w} vs workspace w=${state.workspace?.w})`);
await page.screenshot({ path: `${OUT}/ui-freight-present-1307.png`, fullPage: false });
fs.writeFileSync(`${OUT}/freight-present-measurements.json`, JSON.stringify(state, null, 2));
await browser.close();
console.log('DONE');
