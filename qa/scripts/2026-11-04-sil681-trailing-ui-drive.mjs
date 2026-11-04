// SIL-681 — rung-3 UI drive (LOCAL ONLY): gộp icon action vào TRONG input
// (trailing action, cùng chiều cao input) cho Khách hàng '+' và Hãng tàu '✎'
// ở section "Nhận diện lô", bỏ nút rời oversize (owner 04/11, kèm ảnh).
//   PHASE=before — baseline code gốc: nút rời BÊN CẠNH input (flex sibling).
//   PHASE=after  — assert AC: nút nằm TRONG input (box nằm trong control
//                  boundary, cùng chiều cao input), không còn nút rời/slot
//                  placeholder, mép phải các ô vẫn thẳng hàng, click mở đúng
//                  dialog cũ, Enter vẫn search (MSC commit), X dịch trái,
//                  touch band 44px @768/390, 390 stack.
// DB không bị ghi (không submit form, không apply dialog) → shipment/
// customer/supplier counts trước/sau bằng nhau làm bằng chứng read-only (§9).
// Stack: frontend 7175 → backend 3002, DB dev :5441 (ss-prod-db).
// Run: PHASE=before|after FRONT_PORT=7175 node qa/scripts/2026-11-04-sil681-trailing-ui-drive.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PHASE = process.env.PHASE ?? 'before';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve(`qa/2026-11-04-lcl-trailing-actions/${PHASE}`);
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

// CUS account (brief/sil641 pattern): tiepvv first, seed demo `cus` fallback.
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

// Read-only proof bookends (§9 layout claim — no submit, no dialog apply).
const dbCount = (sql) => execSync(
  `docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "${sql}"`,
).toString().trim();
const countsBefore = {
  shipments: dbCount('select count(*) from shipments'),
  customers: dbCount('select count(*) from customers'),
  suppliers: dbCount("select count(*) from suppliers where 'SHIPPING_LINE' = any(types)"),
};
log(`DB-BEFORE shipments=${countsBefore.shipments} customers=${countsBefore.customers} shipping-line-suppliers=${countsBefore.suppliers}`);

const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
const page = await browser.newPage();
page.on('pageerror', (e) => log(`PAGEERROR ${e.message}`));
page.on('console', (msg) => { if (msg.type() === 'error') log(`CONSOLE-ERR ${msg.text().slice(0, 200)}`); });

// Inject the token BEFORE any app-shell load (puppeteer-spa-auth law).
await page.goto(`${FRONT}/login`, { waitUntil: 'domcontentloaded' });
await page.evaluate((t) => localStorage.setItem('token', t), token);

// ── measurement ──────────────────────────────────────────────────────────────
// Per identity cell: cell box, control boundary (data-uui-control), native
// typing input, the action button (aria-label — stable across phases), and
// the combobox clear (X) affordance.
const METRICS = () => {
  const r = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), right: +b.right.toFixed(2), left: +b.left.toFixed(2), top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2) };
  };
  const ids = ['shipment-customer', 'shipment-trade-direction', 'shipment-booking-ref', 'shipment-shipping-line', 'shipment-lcl-declaration-number'];
  const out = { cells: {}, legacy: {} };
  for (const id of ids) {
    const cell = document.querySelector(`[data-field-id="${id}"]`);
    if (!cell) { out.cells[id] = null; continue; }
    const control = cell.querySelector('[data-uui-control]');
    const native = cell.querySelector('input');
    const button = cell.querySelector('button[aria-label="Thêm khách hàng"], button[aria-label="Đặt tên hãng tàu cho lô này"]');
    const legacySlot = cell.querySelector('.csc-identity-grid__action-slot');
    const clearX = cell.querySelector('button[aria-label="Xoá"]');
    const style = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
    out.cells[id] = {
      cell: r(cell),
      control: r(control),
      innerInput: r(native),
      innerPadRight: native ? parseFloat(style(native, 'paddingRight')) : null,
      button: r(button),
      buttonPosition: style(button, 'position'),
      buttonZ: style(button, 'zIndex'),
      legacySlot: r(legacySlot),
      legacySlotCount: cell.querySelectorAll('.csc-identity-grid__action-slot').length,
      legacyAppendButtons: cell.querySelectorAll('.csc-append-button').length,
      placeholderCount: cell.querySelectorAll('.csc-identity-grid__action-slot--placeholder').length,
      clearX: r(clearX),
      hasPopoverListbox: Boolean(cell.querySelector('[role="listbox"]')),
    };
  }
  out.legacy.appendButtonTotal = document.querySelectorAll('.csc-append-button').length;
  out.legacy.actionSlotTotal = document.querySelectorAll('.csc-identity-grid__action-slot').length;
  out.trailing = {
    present: document.querySelectorAll('.csc-trailing-action').length,
    customer: r(document.querySelector('[data-field-id="shipment-customer"] .csc-trailing-action')),
  };
  out.viewport = { w: window.innerWidth, h: window.innerHeight };
  return out;
};

const near = (a, b, tol) => (a !== null && b !== null && Math.abs(a - b) <= tol);
const shot = async (name) => {
  await page.evaluate(() => document.querySelector('[data-field-id="shipment-customer"]')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const p = path.join(OUT, `2026-11-04_lcl-trailing-actions_ui-${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  log(`SHOT ${path.relative(process.cwd(), p)}`);
};

const setMode = async (mode) => {
  await page.evaluate((m) => {
    const radio = Array.from(document.querySelectorAll('input[name="cargo-mode"]')).find((r2) => r2.value === m);
    if (radio && !radio.checked) radio.click();
  }, mode);
};

// ── drive ────────────────────────────────────────────────────────────────────
// FCL tab @1440/768/390 (both action buttons render), then LCL @1440/390
// (Khách hàng '+' only — hãng tàu is FCL-only, SIL-678 layout).
const FCL_WIDTHS = [1440, 768, 390];
const LCL_WIDTHS = PHASE === 'after' ? [1440, 390] : [1440];
const results = {};

for (const width of FCL_WIDTHS) {
  await page.setViewport({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  await setMode('FCL');
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-shipping-line"]'), { timeout: 10000 });
  await sleep(400);
  const m = await page.evaluate(METRICS);
  results[`fcl-${width}`] = m;
  log(`W=${width} TAB=FCL legacyAppend=${m.legacy.appendButtonTotal} legacySlot=${m.legacy.actionSlotTotal} trailing=${m.trailing.present}`);

  if (PHASE === 'after') {
    const kh = m.cells['shipment-customer'];
    const ht = m.cells['shipment-shipping-line'];
    for (const [label, x] of [["'+' Khách hàng", kh], ['pencil Hãng tàu', ht]]) {
      // AC1 — trailing: the button box sits INSIDE the control boundary,
      // flush to its right edge, and is exactly the control's height.
      const inRight = near(x.button.right, x.control.right - 1, 1.5);
      const inLeft = x.button.left >= x.control.left && x.button.left >= x.control.right - 44;
      const inBand = x.button.top >= x.control.top - 0.5 && x.button.bottom <= x.control.bottom + 0.5;
      check(`W${width} ${label}: nút trong input (right edge sát mép trong)`, inRight, `btn.right=${x.button.right} ctrl.right=${x.control.right}`);
      check(`W${width} ${label}: nút trong input (trong biên trái/phải)`, inLeft, `btn.left=${x.button.left} ctrl=[${x.control.left},${x.control.right}]`);
      check(`W${width} ${label}: nút trong dải dọc của input`, inBand, `btn=[${x.button.top},${x.button.bottom}] ctrl=[${x.control.top},${x.control.bottom}]`);
      check(`W${width} ${label}: cùng chiều cao input (±1)`, near(x.button.h, x.control.h, 1), `btn.h=${x.button.h} ctrl.h=${x.control.h}`);
      check(`W${width} ${label}: không còn nút rời (legacy classes)`, x.legacyAppendButtons === 0 && x.legacySlotCount === 0, `append=${x.legacyAppendButtons} slot=${x.legacySlotCount}`);
      check(`W${width} ${label}: absolute trailing (không flex sibling)`, x.buttonPosition === 'absolute', `position=${x.buttonPosition} z=${x.buttonZ}`);
      check(`W${width} ${label}: z-index trên input (click race đã chết)`, Number(x.buttonZ) >= 30, `z=${x.buttonZ}`);
      // Text clearance: input reserves the trailing zone.
      check(`W${width} ${label}: input pr ≥ 44 (chữ không chui dưới icon)`, (x.innerPadRight ?? 0) >= 44, `pr=${x.innerPadRight}`);
    }
    // SIL-641 alignment invariant, SIL-681 mechanism: every control FILLS
    // its cell (cell width == control width), and cells in the SAME column
    // measure equal — left column vs right column end at their own cell
    // edges, which is the 6/6 grid talking, not a defect.
    const fillPairs = [
      ['shipment-customer', 'shipment-trade-direction'],
      ['shipment-booking-ref', 'shipment-shipping-line'],
    ];
    for (const [a, b] of fillPairs) {
      const fa = Math.abs((m.cells[a].cell?.w ?? 0) - (m.cells[a].control?.w ?? 0));
      const fb = Math.abs((m.cells[b].cell?.w ?? 0) - (m.cells[b].control?.w ?? 0));
      check(`W${width} ${a}/${b}: control đầy ô (Δ≤1)`, fa <= 1 && fb <= 1, `fillΔ ${a}=${+fa.toFixed(2)} ${b}=${+fb.toFixed(2)}`);
    }
    const leftW = [m.cells['shipment-customer'].cell?.w, m.cells['shipment-booking-ref'].cell?.w];
    const rightW = [m.cells['shipment-trade-direction'].cell?.w, m.cells['shipment-shipping-line'].cell?.w];
    const colParity = Math.abs((leftW[0] ?? 0) - (leftW[1] ?? 0)) <= 2 && Math.abs((rightW[0] ?? 0) - (rightW[1] ?? 0)) <= 2;
    check(`W${width} cùng cột bằng nhau (Δ≤2)`, colParity, `left=${leftW.join('/')} right=${rightW.join('/')}`);
    // Section is fully migrated — no legacy pattern left anywhere.
    check(`W${width} section hết legacy append/slot`, m.legacy.appendButtonTotal === 0 && m.legacy.actionSlotTotal === 0, `append=${m.legacy.appendButtonTotal} slot=${m.legacy.actionSlotTotal}`);
    check(`W${width} trailing actions render (2)`, m.trailing.present === 2, `count=${m.trailing.present}`);

    // AC2 — click '+' opens the customer quick-add dialog (old behavior).
    await page.click('[data-field-id="shipment-customer"] .csc-trailing-action');
    const khDialog = await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[role="dialog"], dialog')).some((d) => (d.getAttribute('aria-label') ?? d.textContent ?? '').includes('Thêm khách hàng')),
      { timeout: 8000 },
    ).then(() => true).catch(() => false);
    check(`W${width} click '+' mở dialog Thêm khách hàng`, khDialog, khDialog ? 'dialog render' : 'NO DIALOG');
    await shot(`after-kh-dialog-${width}`);
    await page.keyboard.press('Escape');
    await sleep(300);

    // AC2 — click '✎' opens the shipping-line naming dialog (old behavior).
    await page.click('[data-field-id="shipment-shipping-line"] .csc-trailing-action');
    const htDialog = await page.waitForFunction(
      () => Array.from(document.querySelectorAll('[role="dialog"], dialog')).some((d) => (d.getAttribute('aria-label') ?? d.textContent ?? '').includes('Đặt tên hãng tàu cho lô này')),
      { timeout: 8000 },
    ).then(() => true).catch(() => false);
    check(`W${width} click '✎' mở dialog Đặt tên hãng tàu`, htDialog, htDialog ? 'dialog render' : 'NO DIALOG');
    await shot(`after-ht-dialog-${width}`);
    await page.keyboard.press('Escape');
    await sleep(300);

    if (width === 1440) {
      // AC2 — Enter still searches: type MSC (seed default line), popover
      // lists it, Enter commits the unique match into the input.
      const htInput = '[data-field-id="shipment-shipping-line"] input[role="combobox"]';
      await page.click(htInput);
      await sleep(300);
      await page.type(htInput, 'MSC');
      await sleep(500);
      const optionVisible = await page.evaluate(() => {
        const opts = document.querySelectorAll('[role="option"]');
        return Array.from(opts).some((o) => (o.textContent ?? '').trim().toUpperCase().includes('MSC'));
      });
      check('Enter search: gõ MSC thấy option MSC trong popover', optionVisible, `options=${await page.evaluate(() => document.querySelectorAll('[role="option"]').length)}`);
      await shot('after-ht-type-msc-popover');
      await page.keyboard.press('Enter');
      await sleep(500);
      const committed = await page.$eval(htInput, (el) => el.value);
      check('Enter search: Enter commit MSC vào ô Hãng tàu', committed.toUpperCase().includes('MSC'), `value=${committed}`);
      // Clear (X) co-exists with the trailing action, shifted LEFT of it.
      const m2 = await page.evaluate(METRICS);
      const x = m2.cells['shipment-shipping-line'];
      const xLeftOfAction = x.clearX && x.button ? x.clearX.right <= x.button.left + 0.5 : false;
      check('Clear X dịch TRÁI nút trailing (không đè)', xLeftOfAction, `x.right=${x.clearX?.right} btn.left=${x.button?.left}`);
      await page.click('[data-field-id="shipment-shipping-line"] button[aria-label="Xoá"]');
      await sleep(300);
      const cleared = await page.$eval(htInput, (el) => el.value);
      check('Clear X vẫn xoá được giá trị', cleared === '', `value=${cleared}`);
    }
  }

  await shot(`${PHASE}-fcl-${width}`);
}

for (const width of LCL_WIDTHS) {
  await page.setViewport({ width, height: width === 390 ? 844 : width === 768 ? 1024 : 900 });
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('input[name="cargo-mode"]'), { timeout: 30000 });
  await setMode('LCL');
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-lcl-declaration-number"]'), { timeout: 10000 });
  await sleep(400);
  const m = await page.evaluate(METRICS);
  results[`lcl-${width}`] = m;
  log(`W=${width} TAB=LCL trailing=${m.trailing.present}`);
  const kh = m.cells['shipment-customer'];
  if (PHASE === 'after') {
    check(`W${width} LCL: '+' Khách hàng nằm trong input`, near(kh.button.right, kh.control.right - 1, 1.5) && near(kh.button.h, kh.control.h, 1), `btn.h=${kh.button.h} ctrl.h=${kh.control.h}`);
    const decl = m.cells['shipment-lcl-declaration-number'];
    check(`W${width} LCL: ô Số tờ khai hết placeholder, full width`, decl && decl.placeholderCount === 0 && decl.legacySlotCount === 0, `placeholder=${decl.placeholderCount} slot=${decl.legacySlotCount}`);
    // Same-column parity + per-cell fill (left/right cells end at their own
    // edges — the 6/6 grid, not a defect; see the FCL note).
    const fillDeltas = ['shipment-customer', 'shipment-trade-direction', 'shipment-booking-ref', 'shipment-lcl-declaration-number']
      .map((id) => Math.abs((m.cells[id].cell?.w ?? 0) - (m.cells[id].control?.w ?? 0)));
    check(`W${width} LCL: control đầy ô (Δ≤1)`, fillDeltas.every((d) => d <= 1), `fills=${fillDeltas.map((v) => +v.toFixed(2)).join(',')}`);
    const leftW = [m.cells['shipment-customer'].cell?.w, m.cells['shipment-booking-ref'].cell?.w];
    const rightW = [m.cells['shipment-trade-direction'].cell?.w, m.cells['shipment-lcl-declaration-number'].cell?.w];
    check(`W${width} LCL: cùng cột bằng nhau (Δ≤2)`, Math.abs((leftW[0] ?? 0) - (leftW[1] ?? 0)) <= 2 && Math.abs((rightW[0] ?? 0) - (rightW[1] ?? 0)) <= 2, `left=${leftW.join('/')} right=${rightW.join('/')}`);
    check(`W${width} LCL: Hãng tàu không render (FCL-only)`, m.cells['shipment-shipping-line'] === null, 'correct');
  }
  await shot(`${PHASE}-lcl-${width}`);
}

fs.writeFileSync(path.join(OUT, `dom-metrics-${PHASE}.json`), JSON.stringify(results, null, 2));
log(`METRICS-SAVED qa/2026-11-04-lcl-trailing-actions/${PHASE}/dom-metrics-${PHASE}.json`);

const countsAfter = {
  shipments: dbCount('select count(*) from shipments'),
  customers: dbCount('select count(*) from customers'),
  suppliers: dbCount("select count(*) from suppliers where 'SHIPPING_LINE' = any(types)"),
};
log(`DB-AFTER shipments=${countsAfter.shipments} customers=${countsAfter.customers} shipping-line-suppliers=${countsAfter.suppliers}`);
check('DB: drive không tạo/sửa dữ liệu (read-only layout + dialog-open drive)', JSON.stringify(countsBefore) === JSON.stringify(countsAfter), `${countsBefore.shipments}/${countsBefore.customers}/${countsBefore.suppliers} → ${countsAfter.shipments}/${countsAfter.customers}/${countsAfter.suppliers}`);

await browser.close();
log(`RESULT ${failures === 0 ? 'GREEN' : 'RED'} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
