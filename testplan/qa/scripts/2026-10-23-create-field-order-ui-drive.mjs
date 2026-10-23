// Card 261023093200 (Tiệp Vũ FB 23/10) — rung-3 UI drive, before/after.
// Local dev only. BEFORE phase drives the MAIN checkout stack (default ports,
// pre-change code); AFTER phase drives THIS worktree's frontend on its own
// port against the same backend/DB:
//   node testplan/qa/scripts/2026-10-23-create-field-order-ui-drive.mjs            # before
//   PHASE=after FRONT=http://localhost:$WORKTREE_FE_PORT \
//     node testplan/qa/scripts/2026-10-23-create-field-order-ui-drive.mjs         # after
//
// Surface: form Tạo lô (/shipments/new) — section "Nhận diện lô".
//  CFRD-R1 order: AFTER reads Khách hàng · Hình thức XNK → Số Bill/Booking ·
//     Hãng tàu → Tuỳ chọn → Số tờ khai (cuối); BEFORE reads the A.3 order
//     (Bill/Booking · tờ khai · XNK · Hãng tàu).
//  CFRD-R2 gating: Bill/Booking disabled + hint until a direction is picked.
//  CFRD-R3 logic kept: picking Xuất khẩu enables Bill/Booking with the
//     EXPORT placeholder (verbatim handler).
//  Read-only drive: no submit — DB shipments count/max id identical before
//     and after (§9.3 read-only persisted-state identity).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
const FRONT = process.env.FRONT ?? 'http://localhost:7175';
const API = process.env.API ?? 'http://localhost:3002/api';
const DB = 'postgres://postgres:postgres@127.0.0.1:5441/silversea';

const OUT = path.resolve('qa/2026-10-23-create-field-order');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `create-field-order-ui-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} [${PHASE}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed for ${identifier}: ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} phase=${PHASE} front=${FRONT} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const adminToken = await login('admin');
log('LOGIN ok admin');

// ── Read-only persisted-state identity (§9.3): the drive never submits, so
// the shipments table must be byte-identical before/after (count + max id).
const sql = postgres(DB);
const dbBefore = await sql`SELECT count(*)::int AS n, max(id)::int AS max_id FROM shipments`;
log(`DB BEFORE shipments: ${JSON.stringify(dbBefore[0])}`);

// ── Browser ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.evaluateOnNewDocument((t) => {
  if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(location.origin)) localStorage.setItem('token', t);
}, adminToken);
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2' });
await page.waitForSelector('#shipment-section-identity', { timeout: 30000 });
await page.waitForSelector('[data-field-id="shipment-booking-ref"] input', { timeout: 30000 });
await sleep(900);

// ── CFRD-R1 — field order, DOM AND visual (bounding rect) ───────────────────
const FIELDS = [
  'shipment-customer',
  'shipment-trade-direction',
  'shipment-booking-ref',
  'shipment-shipping-line',
  'shipment-deposit',
  'shipment-declarations',
];
const order = await page.evaluate((ids) => {
  const section = document.querySelector('#shipment-section-identity');
  const nodes = ids
    .map((id) => ({ id, el: section.querySelector(`[data-field-id="${id}"]`) }))
    .filter((n) => n.el);
  nodes.sort((a, b) => (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  const dom = nodes.map((n) => n.id);
  nodes.sort((a, b) => {
    const ra = a.el.getBoundingClientRect();
    const rb = b.el.getBoundingClientRect();
    return (ra.top - rb.top) || (ra.left - rb.left);
  });
  return { dom, visual: nodes.map((n) => n.id) };
}, FIELDS);
log(`ORDER dom=${order.dom.join(' → ')}`);
log(`ORDER visual=${order.visual.join(' → ')}`);

const EXPECT_BEFORE = ['shipment-customer', 'shipment-booking-ref', 'shipment-declarations', 'shipment-trade-direction', 'shipment-shipping-line', 'shipment-deposit'];
const EXPECT_AFTER = FIELDS;
const expected = PHASE === 'after' ? EXPECT_AFTER : EXPECT_BEFORE;
check(`R1 ${PHASE}: DOM order = ${expected.join(' → ')}`,
  order.dom.join() === expected.join(), order.dom.join(' → '));
check(`R1 ${PHASE}: visual order matches DOM order (grid rows follow DOM)`,
  order.visual.join() === order.dom.join(), order.visual.join(' → '));

// ── CFRD-R2 — gating BEFORE picking a direction ─────────────────────────────
const gateBefore = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id="shipment-booking-ref"] input');
  const strip = document.querySelector('[data-field-id="shipment-declarations"]');
  const stripTop = strip.getBoundingClientRect().top;
  const flagsTop = document.querySelector('[data-field-id="shipment-deposit"]').getBoundingClientRect().top;
  return {
    bookingDisabled: input?.disabled ?? null,
    hint: document.querySelector('#shipment-section-identity')?.textContent?.includes('Chọn Hình thức xuất nhập khẩu trước') ?? false,
    stripBelowFlags: stripTop > flagsTop,
    stripTitle: strip.querySelector('.csc-declaration-strip__title')?.textContent ?? null,
  };
});
log(`R2 gating-before: ${JSON.stringify(gateBefore)}`);
check('R2 both phases: Bill/Booking disabled + prerequisite hint before a direction is picked',
  gateBefore.bookingDisabled === true && gateBefore.hint === true, JSON.stringify(gateBefore));
check(`R2 ${PHASE}: tờ khai strip position vs Tuỳ chọn flags`,
  PHASE === 'after' ? gateBefore.stripBelowFlags === true : gateBefore.stripBelowFlags === false,
  `stripBelowFlags=${gateBefore.stripBelowFlags}`);
check('R2 both phases: strip still titled "Số tờ khai" (semantics untouched)',
  gateBefore.stripTitle === 'Số tờ khai', String(gateBefore.stripTitle));

// Screenshot at rest (the customer's step-2/3 view: empty form, Bill disabled).
const identityEl = await page.$('#shipment-section-identity');
await identityEl?.screenshot({ path: path.join(OUT, `create-field-order-identity-${PHASE}.png`) });
log(`SHOT qa/2026-10-23-create-field-order/create-field-order-identity-${PHASE}.png`);

// ── CFRD-R3 — drive the REAL control: pick Xuất khẩu ────────────────────────
await page.click('#shipment-trade-direction');
await page.waitForSelector('[role="option"]', { timeout: 10000 });
const picked = await page.evaluate(() => {
  const option = Array.from(document.querySelectorAll('[role="option"]'))
    .find((el) => (el.textContent ?? '').includes('Xuất khẩu'));
  if (!option) return false;
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  option.click();
  return true;
});
await sleep(600);
log(`R3 picked Xuất khẩu via listbox: ${picked}`);

const gateAfter = await page.evaluate(() => {
  const input = document.querySelector('[data-field-id="shipment-booking-ref"] input');
  return {
    bookingDisabled: input?.disabled ?? null,
    placeholder: input?.getAttribute('placeholder') ?? null,
    hintGone: !(document.querySelector('#shipment-section-identity')?.textContent?.includes('Chọn Hình thức xuất nhập khẩu trước')),
    triggerText: document.querySelector('#shipment-trade-direction')?.textContent ?? null,
  };
});
log(`R3 gating-after: ${JSON.stringify(gateAfter)}`);
check('R3 both phases: picking Xuất khẩu enables Bill/Booking (logic untouched)',
  gateAfter.bookingDisabled === false && picked === true, JSON.stringify(gateAfter));
check('R3 both phases: EXPORT placeholder + hint cleared',
  gateAfter.placeholder === 'Nhập số Booking (hàng Xuất)' && gateAfter.hintGone === true,
  JSON.stringify(gateAfter));

// Screenshot after the click (enabled booking, direction chosen).
const identityAfter = await page.$('#shipment-section-identity');
await identityAfter?.screenshot({ path: path.join(OUT, `create-field-order-direction-picked-${PHASE}.png`) });
log(`SHOT qa/2026-10-23-create-field-order/create-field-order-direction-picked-${PHASE}.png`);

// ── Read-only identity recheck: no submit happened ──────────────────────────
const dbAfter = await sql`SELECT count(*)::int AS n, max(id)::int AS max_id FROM shipments`;
log(`DB AFTER shipments: ${JSON.stringify(dbAfter[0])}`);
check('Read-only drive: shipments table untouched (no submit)',
  dbBefore[0].n === dbAfter[0].n && dbBefore[0].max_id === dbAfter[0].max_id,
  `${JSON.stringify(dbBefore[0])} → ${JSON.stringify(dbAfter[0])}`);

await browser.close();
await sql.end();
log(`DONE phase=${PHASE} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
