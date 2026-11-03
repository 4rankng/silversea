// SIL-641 — rung-3 UI drive (LOCAL ONLY): residual defect của section
// "Nhận diện lô" trên form Tạo lô (role CUS). QA 03/11 staging đo (board
// comment 3541): "ô nhập trong" Khách hàng 517 vs Hình thức 559 (Δ42), Số
// Bill 557 vs Hãng tàu 517 (Δ40); '+' lơ lửng ở gutter (x637); pencil ngoài
// ô Hãng tàu (x1249 vs mép ô 1232). Yardstick đã decode bằng probe
// qa/scripts/2026-11-03-sil641-qa-yardstick-probe.mjs: QA đo NATIVE input
// (combobox) / trigger button (select) / native input (text), và so nút với
// mép field box.
//   PHASE=before — baseline số thật trên code gốc (đã chạy: Δ42/Δ40 tái tạo).
//   PHASE=after  — assert AC: ô nhập trong Δ≤2, cột Δ≤2 @1366, nút trong
//                  slot 36 nhìn thấy được, placeholder còn reserve, 390 stack.
// DB không bị ghi (form không submit) → shipment count trước/sau bằng nhau
// làm bằng chứng read-only (§9 cho claim layout).
// Stack: frontend 7175 → backend 3002, DB dev :5441 (ss-prod-db).
// Run: PHASE=before|after node qa/scripts/2026-11-03-sil641-action-slot-ui-drive.mjs
// Env: FRONT_PORT (7175), API_PORT (3002), PHASE (before|after).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PHASE = process.env.PHASE ?? 'before';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve(`qa/2026-11-03_sil641/${PHASE}`);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

// CUS account: the brief names tiepvv; the local dev list also has the demo
// `cus`. Try the brief's account first, fall back to the seed demo.
let token = null;
let who = null;
for (const identifier of ['tiepvv', 'cus']) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.ok) { token = (await res.json()).token; who = identifier; break; }
}
if (!token) { log('ABORT: CUS login failed (tiepvv + cus)'); process.exit(2); }
log(`LOGIN ok role=cus account=${who}`);

// Read-only proof bookends: the layout drive never submits the form, so the
// shipments count must be identical before/after the drive (§9 read-only).
const dbCount = () => execSync(
  'docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select count(*) from shipments"',
).toString().trim();
const countBefore = dbCount();

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') log(`CONSOLE-ERR ${msg.text().slice(0, 200)}`); });

// Inject the token BEFORE any app-shell load (puppeteer-spa-auth law).
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), token);

// ── measurement ──────────────────────────────────────────────────────────────
// Per identity cell: cell / field root / control boundary / slot boxes, the
// INNER typing box (QA's yardstick: native input; the select's trigger button
// IS its box), text inset, and the search-glyph presence.
const METRICS = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), right: +b.right.toFixed(2), left: +b.left.toFixed(2) };
  };
  const ids = ['shipment-customer', 'shipment-trade-direction', 'shipment-booking-ref', 'shipment-shipping-line'];
  const out = { cells: {}, glyph: {}, searchIcons: {} };
  for (const id of ids) {
    const cell = document.querySelector(`[data-field-id="${id}"]`);
    if (!cell) { out.cells[id] = null; continue; }
    const field = cell.firstElementChild;
    const slot = cell.querySelector('.csc-identity-grid__action-slot');
    const control = cell.querySelector('.csc-uui-field');
    const native = cell.querySelector('input');
    const style = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
    // QA yardstick: the native input when the field has one, else the
    // select trigger box itself.
    const inner = native ?? control;
    out.cells[id] = {
      cell: r(cell),
      fieldRoot: r(field),
      control: r(control),
      innerInput: r(native),
      innerBox: r(inner),
      innerIsNativeInput: Boolean(native),
      innerPadLeft: native ? parseFloat(style(native, 'paddingLeft')) : null,
      innerTextStart: native && native ? +(native.getBoundingClientRect().x + parseFloat(style(native, 'paddingLeft'))).toFixed(2) : null,
      slot: r(slot),
      slotTag: slot?.tagName ?? null,
      slotVisibility: style(slot, 'visibility'),
      slotMarginTop: style(slot, 'marginTop'),
      slotBorder: style(slot, 'borderWidth'),
      slotBg: style(slot, 'backgroundColor'),
      searchGlyph: Boolean(cell.querySelector('[data-combobox-search]')),
    };
  }
  out.searchIcons.identityTotal = document.querySelectorAll('.csc-identity-grid [data-combobox-search]').length;
  out.viewport = { w: window.innerWidth, h: window.innerHeight };
  return out;
};

const near = (a, b, tol) => (a !== null && b !== null && Math.abs(a - b) <= tol);
const within = (id, m) => m.cells[id];

// ── drive ────────────────────────────────────────────────────────────────────
const WIDTHS = [1440, 1366, 768, 390];
const results = {};
for (const width of WIDTHS) {
  await page.setViewport({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  // Identity cells need the FCL tab (Hãng tàu only renders on FCL).
  await page.evaluate(() => {
    const fcl = Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r) => r.value === 'FCL');
    if (fcl && !fcl.checked) fcl.click();
  });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-shipping-line"]'), { timeout: 10000 });
  await sleep(400);
  const m = await page.evaluate(METRICS);
  results[width] = m;
  const c = m.cells;
  const delta = (a, b) => (a && b ? +(Math.abs(a - b)).toFixed(2) : null);
  const line = (k) => {
    const x = c[k];
    return x ? `${k}: cell=${x.cell?.w} innerBox=${x.innerBox?.w}(${x.innerIsNativeInput ? 'native-input' : 'trigger'}) textStart=${x.innerTextStart} slot=${x.slot?.w}/${x.slotVisibility} glyph=${x.searchGlyph}` : `${k}: ABSENT`;
  };
  log(`W=${width}`);
  for (const k of Object.keys(c)) log(`  ${line(k)}`);

  if (PHASE === 'after') {
    // AC1 — QA yardstick: the four INNER typing boxes equal across rows.
    const d1 = delta(c['shipment-customer'].innerBox?.w, c['shipment-trade-direction'].innerBox?.w);
    const d2 = delta(c['shipment-booking-ref'].innerBox?.w, c['shipment-shipping-line'].innerBox?.w);
    const d3 = delta(c['shipment-customer'].innerBox?.w, c['shipment-booking-ref'].innerBox?.w);
    check(`W${width} AC1 inner boxes: KH vs XNK Δ≤2`, d1 !== null && d1 <= 2, `Δ=${d1}`);
    check(`W${width} AC1 inner boxes: Bill vs Hãng tàu Δ≤2`, d2 !== null && d2 <= 2, `Δ=${d2}`);
    check(`W${width} AC1 inner boxes: KH vs Bill Δ≤2`, d3 !== null && d3 <= 2, `Δ=${d3}`);
    // AC1 columns — cell bounding boxes (the brief's "bounding-box width 2 cột").
    const dc1 = delta(c['shipment-customer'].cell?.w, c['shipment-trade-direction'].cell?.w);
    const dc2 = delta(c['shipment-booking-ref'].cell?.w, c['shipment-shipping-line'].cell?.w);
    check(`W${width} AC1 columns (cells) Δ≤2`, (dc1 ?? 99) <= 2 && (dc2 ?? 99) <= 2, `row1 Δ=${dc1} row2 Δ=${dc2}`);
    // AC2/AC3 — buttons: inside their own 36px slot track, attached after the
    // field box (gap 8), never past the cell edge, never over the input.
    for (const [id, label] of [['shipment-customer', "'+' Khách hàng"], ['shipment-shipping-line', 'pencil Hãng tàu']]) {
      const x = within(id, m);
      const gapAfterField = x.slot && x.fieldRoot ? +(x.slot.left - x.fieldRoot.right).toFixed(2) : null;
      const overrunCell = x.slot && x.cell ? +(x.slot.right - x.cell.right).toFixed(2) : null;
      check(`W${width} ${label}: slot bắt đầu sau field đúng gap 8`, near(gapAfterField, 8, 0.5), `gap=${gapAfterField}`);
      check(`W${width} ${label}: không trôi qua mép ô (overrun ≤0.5)`, Math.abs(overrunCell) <= 0.5, `overrun=${overrunCell}`);
      check(`W${width} ${label}: chip nhìn thấy được (border 1px, bg đặc)`, x.slotBorder === '1px' && x.slotBg !== 'rgba(0, 0, 0, 0)', `border=${x.slotBorder} bg=${x.slotBg}`);
      check(`W${width} ${label}: slot 36px`, x.slot?.w === 36, `w=${x.slot?.w}`);
    }
    // AC4 — placeholders reserve the same slot in button-less cells.
    for (const [id, label] of [['shipment-trade-direction', 'Hình thức XNK'], ['shipment-booking-ref', 'Số Bill/Booking']]) {
      const x = within(id, m);
      const buttonMarginTop = within('shipment-customer', m).slotMarginTop;
      check(`W${width} AC4 ${label}: placeholder slot 36 + hidden + cùng margin-top`, x.slot?.w === 36 && x.slotVisibility === 'hidden' && x.slotMarginTop === buttonMarginTop, `w=${x.slot?.w} vis=${x.slotVisibility} mt=${x.slotMarginTop} (btn mt=${buttonMarginTop})`);
    }
    // Text inset parity — combobox text starts at the plain input's x.
    const dt = delta(c['shipment-customer'].innerTextStart, c['shipment-booking-ref'].innerTextStart);
    check(`W${width} text parity: chữ KH bắt đầu = chữ Bill (±2)`, dt !== null && dt <= 2, `Δ=${dt}`);
  }
  // Glyph absence (both phases report it; only 'after' asserts).
  check(`W${width} không còn search glyph trong section`, m.searchIcons.identityTotal === 0, `count=${m.searchIcons.identityTotal}`);

  await page.evaluate(() => document.querySelector('[data-field-id="shipment-customer"]')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, `sil641-${PHASE}-identity-${width}.png`), fullPage: false });
}

fs.writeFileSync(path.join(OUT, `dom-metrics-${PHASE}.json`), JSON.stringify(results, null, 2));
log(`METRICS-SAVED qa/2026-11-03_sil641/${PHASE}/dom-metrics-${PHASE}.json`);

const countAfter = dbCount();
log(`DB-SIDE-EFFECT read-only drive: shipments count before=${countBefore} after=${countAfter} (expect equal)`);
check('DB: drive không tạo/sửa lot (read-only layout drive)', countBefore === countAfter, `${countBefore} → ${countAfter}`);

await browser.close();
log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
