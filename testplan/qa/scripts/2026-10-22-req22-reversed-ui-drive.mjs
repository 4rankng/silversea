// REQ-22 REVERSED (ticket 221026173728, owner 22/10) — rung-3 UI drive.
// Reversal law: "Thêm container" copies EVERY field TRỪ Số container VÀ
// Loại cont — Loại cont opens EMPTY ("Chưa chọn loại cont"), every other
// A.1 field (Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng/Giờ hẹn) rides the seed.
// Drive BOTH shared-ledger hosts (one implementation, two hosts):
//   A. Chi tiết trượt ngang (/shipments/:id → ShipmentDetailContainerManagement)
//   B. drawer Tổng quan (/shipments → ShipmentsPage drawer)
// ONE write (submit at host A) → DB readback proves container_type_id IS NULL
// while route/ports/weight/appointment copied → API cleanup restores the lot.
// LOCAL dev only (§2). Port contract (dev-port-contract.test): defaults are
// the canonical 7175/3002; when the MAIN checkout's stack owns 7175, point
// FRONT at this worktree's own vite port via the FRONT env var.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.FRONT ?? 'http://localhost:7175';
const API = process.env.API ?? 'http://localhost:3002/api';
const DB = 'postgres://postgres:postgres@127.0.0.1:5441/silversea';

const OUT = path.resolve('qa/2026-10-22-req22-reversed');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const dump = (name, data) => {
  fs.writeFileSync(path.join(OUT, name), JSON.stringify(data, null, 2));
  log(`artifact ${name}`);
};

// ── Fixture lot (local seed, untouched prod): DIS30-H2 ──────────────────────
// Ref container DSTK7890125 carries the FULL copy set: type 1 (20DC),
// route 1 (Hải Phòng-NEWEB), ports 1/2, weight 9000, appt 2026-10-27T05:00Z
// (= 12:00 · 27/10 VN). The reversal claims: the ADD ROW must open with
// Loại cont EMPTY while every one of those facts still copies.
const SHIP = 312380;
const BL = 'DIS30-H2';
const REF = 'DSTK7890125';
const EXPECT = {
  route: 'Hải Phòng-NEWEB',
  lift: 'Nhà máy Long Minh - Võ Cường',
  drop: 'NEWEB-KHO 1',
  weight: '9000',
  apptHH: '12',
  apptDD: '27',
  placeholder: 'Chưa chọn loại cont',
};
// ISO 6346 check digit: letters are 10..38 EXCLUDING every multiple of 11
// (11/22/33 — so V=34, not 33); digits count at face value; weights 2^i.
const iso6346 = (base) => {
  const map = {};
  let value = 10;
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    while (value % 11 === 0) value += 1;
    map[c] = value;
    value += 1;
  }
  [...'0123456789'].forEach((d) => { map[d] = Number(d); });
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += map[base[i]] * 2 ** i;
  return base + String((sum % 11) % 10);
};
const NEW_CONT = iso6346('REVU220000'); // 4-letter owner + 6-digit serial + check = 11 chars

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
log(`HEALTH status=${health?.status} front=${FRONT} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }
const token = await login('cus');
log('LOGIN ok cus');

const sql = postgres(DB);
const before = await sql`
  SELECT id, container_number, container_type_id, route_id, pickup_port_id,
         dropoff_port_id, cargo_weight_kg::text AS weight, customer_appointment_at
  FROM shipment_containers WHERE shipment_id = ${SHIP} ORDER BY id`;
log(`DB PRE state: ${JSON.stringify(before)}`);
dump('db-0-prestate.json', { ship: SHIP, containers: before });
check('pre-state: exactly 1 ref container with the full copy set', before.length === 1 && before[0].container_number === REF
  && before[0].container_type_id === 1 && before[0].route_id === 1
  && before[0].weight === '9000.00', JSON.stringify(before[0]));

// Read helpers scoped to an add-row element (works in drawer + detail page).
// Both run INSIDE page.evaluate — the browser owns `document`. The copy law
// is "the add row reads like the row above": we therefore read the REF row's
// own cells and pin the add row to THEM (no hardcoded catalog names — the
// projection's Nâng/Hạ come from the ports catalog, not operational_sites).
const readLedgerRows = (page) => page.evaluate(() => {
  const rows = [...document.querySelectorAll('tr')].filter((r) => r.querySelector('[data-label="Tuyến"]'));
  const read = (row) => {
    const cell = (label) => row.querySelector(`[data-label="${label}"]`)?.textContent?.trim() ?? null;
    const split = row.querySelector('[data-split-datetime]');
    return {
      number: row.querySelector('input[aria-label="Số container"]')?.value
        ?? row.querySelector('[data-label="Container"]')?.textContent?.trim() ?? null,
      loaiCont: cell('Loại cont'),
      tuyen: cell('Tuyến'),
      nhaXe: cell('Nhà xe'),
      nang: cell('Nâng'),
      ha: cell('Hạ'),
      weight: row.querySelector('input[aria-label="Trọng lượng (kg)"]')?.value ?? cell('Trọng lượng (kg)'),
      apptHH: split?.querySelector('input[data-seg="hh"]')?.value ?? null,
      apptDD: split?.querySelector('input[data-seg="dd"]')?.value ?? null,
    };
  };
  const ref = rows.find((r) => !(r.classList.contains('cus-container-ledger__add-row'))
    && (r.textContent || '').includes('DSTK7890125'));
  const add = rows.find((r) => r.classList.contains('cus-container-ledger__add-row'));
  return {
    ref: ref ? read(ref) : null,
    add: add ? {
      ...read(add),
      // The loại-cont cell hosts the house UuiSelectField — with a real
      // catalog it renders the SEARCHABLE combobox: an input whose VALUE is
      // the empty search text and whose PLACEHOLDER carries the empty-state
      // label ("Chưa chọn loại cont"). textContent is '' by design there.
      typeInputValue: add.querySelector('[data-label="Loại cont"] input')?.value ?? null,
      typeInputPlaceholder: add.querySelector('[data-label="Loại cont"] input')?.getAttribute('placeholder') ?? null,
      typeCellText: add.querySelector('[data-label="Loại cont"]')?.textContent?.trim() ?? null,
      typeRoleProbe: [...add.querySelectorAll('[data-label="Loại cont"] button, [data-label="Loại cont"] [role="combobox"], [data-label="Loại cont"] [role="button"]')]
        .map((el) => ({ role: el.getAttribute('role') ?? 'button', text: el.textContent?.trim(), aria: el.getAttribute('aria-label') })),
    } : null,
  };
});
const fillInput = (page, ariaLabel, value) => page.evaluate((a, v) => {
  const row = document.querySelector('.cus-container-ledger__add-row');
  const input = [...row.querySelectorAll('input')].find((i) => i.getAttribute('aria-label') === a);
  if (!input) return false;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, v);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, ariaLabel, value);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ══ HOST A — Chi tiết trượt ngang (/shipments/:id) ════════════════════════
  await page.goto(`${FRONT}/shipments/${SHIP}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.body?.innerText.includes('Quản lý container'), { timeout: 30000 });
  await page.waitForFunction((ref) => document.body?.innerText.includes(ref), { timeout: 30000 }, REF);
  await sleep(800);
  await page.screenshot({ path: `${OUT}/ui-1-chitiet-before.png` });
  log('shot ui-1-chitiet-before.png (detail page, Quản lý container section)');

  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Thêm container');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('host A: Thêm container button clicked', opened === true);
  await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 15000 });
  await sleep(500);
  const { ref, add: a } = await readLedgerRows(page);
  dump('dom-2-chitiet-addform.json', { host: 'chi-tiet', refRow: ref, addRow: a });
  log(`host A ref row: ${JSON.stringify(ref)}`);
  log(`host A add row: ${JSON.stringify(a)}`);
  check('host A: ref row carries the seeded facts (fixture sanity)', !!ref && (ref.tuyen === 'Hải Phòng')
    && (ref.nang ?? '').startsWith('SITC - Lạch Huyện') && (ref.ha ?? '').startsWith('TC - HICT'), JSON.stringify(ref));
  check('host A: Số container opens EMPTY (entry field)', a?.number === '', String(a?.number));
  check('host A: Loại cont opens "Chưa chọn loại cont" (REVERSED 22/10 — NOT the ref 20DC)',
    a?.typeInputValue === ''
      && (a?.typeInputPlaceholder ?? '').includes(EXPECT.placeholder)
      && !(JSON.stringify(a?.typeRoleProbe) ?? '').includes('20DC'),
    JSON.stringify({ value: a?.typeInputValue, placeholder: a?.typeInputPlaceholder, probe: a?.typeRoleProbe }));
  check('host A: Tuyến COPIES the row above', a?.tuyen != null && a?.tuyen === ref?.tuyen,
    `add=${a?.tuyen} ref=${ref?.tuyen}`);
  check('host A: Nhà xe COPIES the row above', a?.nhaXe != null && a?.nhaXe === ref?.nhaXe,
    `add=${a?.nhaXe} ref=${ref?.nhaXe}`);
  check('host A: Nâng COPIES the row above', a?.nang != null && (ref?.nang ?? '').startsWith(a?.nang ?? '\u0000'),
    `add=${a?.nang} ref=${ref?.nang}`);
  check('host A: Hạ COPIES the row above', a?.ha != null && (ref?.ha ?? '').startsWith(a?.ha ?? '\u0000'),
    `add=${a?.ha} ref=${ref?.ha}`);
  check('host A: Trọng lượng COPIES (9000)', a?.weight === EXPECT.weight, String(a?.weight));
  check('host A: Giờ hẹn COPIES (12:00 · 27/10 VN)', a?.apptHH === EXPECT.apptHH && a?.apptDD === EXPECT.apptDD,
    `hh=${a?.apptHH} dd=${a?.apptDD}`);
  await page.screenshot({ path: `${OUT}/ui-3-chitiet-form-loaicont-trong.png` });
  log('shot ui-3-chitiet-form-loaicont-trong.png (add form: type EMPTY, other fields seeded)');

  // Submit: number is the ONLY required entry — type stays unpicked.
  check('fixture number ISO-6346 valid', NEW_CONT.length === 11, NEW_CONT);
  await fillInput(page, 'Số container', NEW_CONT);
  await sleep(300);
  await page.evaluate(() => {
    const row = document.querySelector('.cus-container-ledger__add-row');
    const btn = [...row.querySelectorAll('button')].find((b) => (b.textContent || '').trim() === 'Thêm' && !b.disabled);
    btn?.click();
  });
  const landed = await page.waitForFunction(() => document.body?.innerText.includes('Đã thêm container'),
    { timeout: 20000 }).then(() => true).catch(() => false);
  const toastText = await page.evaluate(() => document.querySelector('[role="alert"], .toast, [class*="toast"]')?.textContent?.trim() ?? null);
  check('host A: submit lands the new row (success toast "Đã thêm container")', landed === true,
    landed ? NEW_CONT : `toast=${toastText ?? 'none'}`);
  await sleep(600);
  await page.screenshot({ path: `${OUT}/ui-4-chitiet-after-add.png` });
  log('shot ui-4-chitiet-after-add.png (ledger after add — new row type cell empty)');

  const dbRow = await sql`
    SELECT id, container_number, container_type_id, route_id, pickup_port_id,
           dropoff_port_id, cargo_weight_kg::text AS weight, customer_appointment_at
    FROM shipment_containers
    WHERE shipment_id = ${SHIP} AND container_number = ${NEW_CONT} ORDER BY id DESC LIMIT 1`;
  dump('db-5-newrow.json', { newContainer: dbRow });
  log(`DB new row: ${JSON.stringify(dbRow)}`);
  const nr = dbRow[0];
  check('DB: new row EXISTS', !!nr, JSON.stringify(nr));
  check('DB: container_type_id IS NULL (server did NOT lot-default inherit — explicit null won)',
    nr && nr.container_type_id === null, String(nr?.container_type_id));
  check('DB: route_id copied (1)', nr?.route_id === 1, String(nr?.route_id));
  check('DB: pickup_port_id copied (1)', nr?.pickup_port_id === 1, String(nr?.pickup_port_id));
  check('DB: dropoff_port_id copied (2)', nr?.dropoff_port_id === 2, String(nr?.dropoff_port_id));
  check('DB: weight copied (9000.00)', nr?.weight === '9000.00', String(nr?.weight));
  check('DB: appointment copied (2026-10-27T05:00Z)',
    nr?.customer_appointment_at && new Date(nr.customer_appointment_at).toISOString() === '2026-10-27T05:00:00.000Z',
    String(nr?.customer_appointment_at));

  // ══ HOST B — drawer Tổng quan (/shipments) ════════════════════════════════
  await page.goto(`${FRONT}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => Boolean(document.querySelector('input[aria-label="Tìm lô hàng"]')), { timeout: 30000 });
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === 'Tìm lô hàng');
    i?.focus();
  });
  await page.keyboard.type(BL, { delay: 40 });
  await sleep(2500);
  const drawerOpened = await page.evaluate((bl) => {
    const tr = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl));
    if (!tr) return 'no-row';
    const b = [...tr.querySelectorAll('button')].find((x) => /mở chi tiết lô hàng/i.test(x.getAttribute('aria-label') || ''))
      ?? [...tr.querySelectorAll('button')].find((x) => /^chi tiết$/i.test((x.textContent || '').trim()));
    if (!b) return 'no-btn';
    b.click();
    return true;
  }, BL);
  check('host B: drawer opened from Tổng quan row', drawerOpened === true, String(drawerOpened));
  await sleep(2500);
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    const b = [...d.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Thêm container');
    b?.click();
  });
  await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 15000 });
  await sleep(500);
  const { ref: refB, add: b } = await readLedgerRows(page);
  dump('dom-6-drawer-addform.json', { host: 'drawer-tong-quan', refRow: refB, addRow: b });
  log(`host B add row: ${JSON.stringify(b)}`);
  check('host B: Số container opens EMPTY', b?.number === '', String(b?.number));
  check('host B: Loại cont opens "Chưa chọn loại cont" (REVERSED 22/10)',
    b?.typeInputValue === '' && (b?.typeInputPlaceholder ?? '').includes(EXPECT.placeholder),
    JSON.stringify({ value: b?.typeInputValue, placeholder: b?.typeInputPlaceholder }));
  check('host B: Tuyến COPIES the row above', b?.tuyen != null && b?.tuyen === refB?.tuyen,
    `add=${b?.tuyen} ref=${refB?.tuyen}`);
  check('host B: Nâng COPIES the row above', b?.nang != null && (refB?.nang ?? '').startsWith(b?.nang ?? '\u0000'),
    `add=${b?.nang} ref=${refB?.nang}`);
  check('host B: Hạ COPIES the row above', b?.ha != null && (refB?.ha ?? '').startsWith(b?.ha ?? '\u0000'),
    `add=${b?.ha} ref=${refB?.ha}`);
  check('host B: Trọng lượng COPIES', b?.weight === EXPECT.weight, String(b?.weight));
  check('host B: Giờ hẹn COPIES', b?.apptHH === EXPECT.apptHH && b?.apptDD === EXPECT.apptDD,
    `hh=${b?.apptHH} dd=${b?.apptDD}`);
  await page.screenshot({ path: `${OUT}/ui-7-drawer-form-loaicont-trong.png` });
  log('shot ui-7-drawer-form-loaicont-trong.png (drawer add form: type EMPTY, fields seeded)');
  // Cancel — host B is a no-write proof; the write evidence lives on host A.
  await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    const btn = [...d.querySelectorAll('button')].find((x) => (x.textContent || '').trim() === 'Hủy');
    btn?.click();
  });
  await sleep(400);
} finally {
  await browser.close();
}

// ── Cleanup: remove the QA row via the same CUS API the UI rides (CUS-10) ───
const qaRow = await sql`
  SELECT id FROM shipment_containers WHERE shipment_id = ${SHIP} AND container_number = ${NEW_CONT}`;
if (qaRow.length) {
  const ver = await sql`SELECT version FROM shipments WHERE id = ${SHIP}`;
  const del = await fetch(`${API}/shipments/cus-workspace/${SHIP}/containers/${qaRow[0].id}/remove`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ expectedShipmentVersion: ver[0].version }),
  });
  log(`CLEANUP remove status=${del.status}`);
} else {
  log('CLEANUP skip — QA row never landed');
}
const afterRows = await sql`
  SELECT id, container_number FROM shipment_containers WHERE shipment_id = ${SHIP} ORDER BY id`;
log(`DB POST-cleanup: ${JSON.stringify(afterRows)}`);
dump('db-8-post-cleanup.json', { containers: afterRows });
check('cleanup: lot restored to the single ref container', afterRows.length === 1 && afterRows[0].container_number === REF,
  JSON.stringify(afterRows));
await sql.end();

log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
