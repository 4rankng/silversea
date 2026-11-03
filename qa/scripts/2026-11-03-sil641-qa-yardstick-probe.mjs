// SIL-641 probe — reproduce QA's exact yardstick @1307 (comment id 3541):
// "Khách hàng 517 vs Hình thức 559 (Δ42); Số Bill 557 vs Hãng tàu 517 (Δ40);
// '+' lơ lửng ở gutter (x637); pencil ngoài ô Hãng tàu (x1249 vs mép ô 1232)".
// Enumerate every candidate box inside the four identity cells and print them,
// so the fix targets the same elements QA measured.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const FRONT = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = 'qa/2026-11-03_sil641/probe';
fs.mkdirSync(OUT, { recursive: true });

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
}).then((r) => r.json());
const token = login.token;

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1307, height: 800 } });
const page = await browser.newPage();
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), token);
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-shipping-line"]'), { timeout: 30000 });
await page.evaluate(() => {
  const fcl = Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r) => r.value === 'FCL');
  if (fcl && !fcl.checked) fcl.click();
});
await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-shipping-line"]'), { timeout: 10000 });
await new Promise((r) => setTimeout(r, 400));

const data = await page.evaluate(() => {
  const box = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') ?? '').slice(0, 80), x: +b.x.toFixed(1), w: +b.width.toFixed(1), right: +b.right.toFixed(1), y: +b.y.toFixed(1), h: +b.height.toFixed(1) };
  };
  const out = {};
  for (const id of ['shipment-customer', 'shipment-trade-direction', 'shipment-booking-ref', 'shipment-shipping-line']) {
    const cell = document.querySelector(`[data-field-id="${id}"]`);
    if (!cell) continue;
    const list = [];
    list.push({ what: 'CELL', ...box(cell) });
    // every descendant that is a "box candidate"
    const candidates = cell.querySelectorAll('div, input, button, span');
    for (const el of candidates) {
      const b = el.getBoundingClientRect();
      if (b.width < 100 || b.height < 18) continue; // only meaningful boxes
      const cls = (el.getAttribute('class') ?? '').toString();
      const label =
        el.matches('.csc-uui-field') ? 'GROUP(csc-uui-field)' :
        el.matches('.csc-control-boundary') ? 'BOUNDARY' :
        el.tagName === 'INPUT' ? 'INPUT(native)' :
        el.matches('[role="combobox"]') ? 'TRIGGER(combobox)' :
        el.matches('button') ? 'BUTTON' :
        cls.includes('csc-select-field') ? 'SELECT-WRAP' :
        cls.includes('uui-combobox__input') ? 'combo-input-wrap' :
        cls.includes('csc-searchable-field') ? 'SEARCHABLE-ROOT' :
        cls.includes('text-field-with-warning') ? 'TEXT-WRAP' : 'div/span';
      if (list.some((e) => e.x === +b.x.toFixed(1) && e.w === +b.width.toFixed(1) && e.y === +b.y.toFixed(1))) continue;
      list.push({ what: label, tag: el.tagName.toLowerCase(), x: +b.x.toFixed(1), w: +b.width.toFixed(1), right: +b.right.toFixed(1), y: +b.y.toFixed(1), h: +b.height.toFixed(1), cls: cls.slice(0, 60) });
    }
    out[id] = list;
  }
  // combobox internals: icon, paddings
  const combo = document.querySelector('[data-field-id="shipment-customer"] .csc-uui-field');
  const cs = combo ? getComputedStyle(combo) : null;
  out.comboComputed = cs ? { padding: cs.padding, border: cs.borderWidth, display: cs.display } : null;
  const icon = document.querySelector('[data-field-id="shipment-customer"] [data-combobox-search]');
  out.icon = box(icon);
  const inner = document.querySelector('[data-field-id="shipment-customer"] .uui-combobox__input');
  out.comboInnerWrap = box(inner);
  const native = document.querySelector('[data-field-id="shipment-customer"] input');
  out.comboNativeInput = box(native);
  const ncs = native ? getComputedStyle(native) : null;
  out.nativeComputed = ncs ? { padding: ncs.padding, h: ncs.height } : null;
  // text field internals
  const tin = document.querySelector('[data-field-id="shipment-booking-ref"] input');
  out.textNativeInput = box(tin);
  const tcs = tin ? getComputedStyle(tin) : null;
  out.textNativeComputed = tcs ? { padding: tcs.padding } : null;
  return out;
});
fs.writeFileSync(`${OUT}/qa-yardstick-1307.json`, JSON.stringify(data, null, 2));
for (const [id, list] of Object.entries(data)) {
  if (!Array.isArray(list)) { console.log(id, JSON.stringify(list)); continue; }
  console.log(`== ${id}`);
  for (const e of list) console.log(`  ${e.what.padEnd(22)} ${e.tag?.padEnd(6)} x=${e.x} w=${e.w} right=${e.right} y=${e.y} h=${e.h}`);
}
await browser.close();
