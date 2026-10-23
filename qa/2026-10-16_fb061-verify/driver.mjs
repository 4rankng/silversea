#!/usr/bin/env node
/**
 * FB-061 staging verify driver (build 9aedd95a).
 * Exercises the soft-deleted-master fallback law on:
 *   board rows, money report THU, money report TRA, deposit dialog,
 *   plus positive controls (live masters resolve by name).
 *
 * Phases (run in order):
 *   setup   — health gate + login + fixture creation (masters, lot, expense, trip, link)
 *   live    — positive controls: live master resolves on board/THU/TRA/deposit
 *   delcust — soft-delete QA customer, assert board/THU/TRA/deposit fallback
 *   flip    — guarded DB flip of the fixture sidecar to EXTERNAL/SUPPLIER, assert live supplier
 *   delsup  — soft-delete QA supplier, assert fallback again
 *   cleanup — product-path teardown (void expense, cancel trip) + qapurge registry + census
 *
 * Every write carries an Idempotency-Key. State persists to state.json.
 */
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const API = 'https://vantai.tingting.vip/api';
const EXPECT_BUILD = '9aedd95a';
const DIR = new URL('.', import.meta.url).pathname;
const STATE_FILE = `${DIR}state.json`;
const LOG_FILE = `${DIR}driver.log`;
const TS = () => new Date().toISOString();
const rand = Math.random().toString(16).slice(2, 8).toUpperCase();

function log(line) {
  appendFileSync(LOG_FILE, `${TS()} ${line}\n`);
  console.log(line);
}
function save(state) { writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); }
function load() { return existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, 'utf8')) : {}; }

let failures = [];
function check(name, cond, detail) {
  const verdict = cond ? 'PASS' : 'FAIL';
  log(`  [${verdict}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures.push({ name, detail });
  return cond;
}

async function api(token, method, path, body, idem, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = idem ?? randomUUID();
  const res = await fetch(`${API}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

async function psql(sql) {
  const { execSync } = await import('node:child_process');
  // Base64 the SQL and decode it inside the container, run with -f (no stdin —
  // see ssh-heredoc trap memory; no quote layering through ssh/sh -c).
  const b64 = Buffer.from(sql, 'utf8').toString('base64');
  const out = execSync(
    `ssh -o BatchMode=yes -o ConnectTimeout=10 root@vantai.tingting.vip ` +
    `"docker exec vantai-postgres-1 sh -c 'printf %s ${b64} | base64 -d > /tmp/fb061.sql && psql -U \\"\\$POSTGRES_USER\\" -d \\"\\$POSTGRES_DB\\" -At -v ON_ERROR_STOP=1 -f /tmp/fb061.sql && rm -f /tmp/fb061.sql'"`,
    { encoding: 'utf8', timeout: 30000 },
  );
  return out.trim();
}

const phase = process.argv[2];
if (!phase) { console.error('usage: node driver.mjs <setup|live|delcust|flip|delsup|cleanup|census>'); process.exit(2); }

let state = load();

// ── phase: setup ────────────────────────────────────────────────────────────
if (phase === 'setup') {
  // 1. Health gate.
  const health = await fetch('https://vantai.tingting.vip/api/health').then(r => r.json());
  check('health buildHash', health.buildHash === EXPECT_BUILD, `got ${health.buildHash}`);
  if (health.buildHash !== EXPECT_BUILD) { save(state); process.exit(1); }

  // 2. Logins.
  const adm = await api(null, 'POST', '/auth/login', { identifier: 'admin', password: 'Abc123' });
  check('login admin', adm.status === 200 && !!adm.json.token, `status ${adm.status}`);
  state.admin = adm.json.token;
  const ops = await api(null, 'POST', '/auth/login', { identifier: 'hoangnh', password: 'Abc123' });
  check('login hoangnh (OPS)', ops.status === 200 && !!ops.json.token, `status ${ops.status}`);
  state.ops = ops.json.token;
  if (!state.admin || !state.ops) { save(state); process.exit(1); }

  // 3. Catalogs.
  const boot = await api(state.admin, 'GET', '/catalogs/bootstrap');
  check('bootstrap', boot.status === 200 && Array.isArray(boot.json.routes) && boot.json.routes.length > 0,
    `routes ${boot.json.routes?.length}`);
  state.routeId = boot.json.routes[0].id;
  state.cargoTypeId = boot.json.cargoTypes[0].id;
  state.containerTypeId = boot.json.containerTypes[0].id;
  const expType = boot.json.forwarderExpenseTypes.find(t => t.status !== 'INACTIVE') ?? boot.json.forwarderExpenseTypes[0];
  state.expenseTypeCode = expType.code;
  log(`  catalogs: route=${state.routeId} cargo=${state.cargoTypeId} containerType=${state.containerTypeId} expenseType=${state.expenseTypeCode}`);

  // 4. Masters.
  state.custName = `QA FB061 KH ${rand}`;
  const cust = await api(state.admin, 'POST', '/customers', { name: state.custName });
  check('create QA customer', cust.status === 201 && !!cust.json.id, `status ${cust.status} ${JSON.stringify(cust.json).slice(0, 200)}`);
  state.custId = cust.json.id;
  state.supName = `QA FB061 NCC ${rand}`;
  const sup = await api(state.admin, 'POST', '/suppliers', { name: state.supName });
  check('create QA supplier', sup.status === 201 && !!sup.json.id, `status ${sup.status} ${JSON.stringify(sup.json).slice(0, 200)}`);
  state.supId = sup.json.id;

  // 5. Lot.
  state.bl = `QA-FB061-${rand}`;
  const ship = await api(state.admin, 'POST', '/shipments', { customerId: state.custId, blNumber: state.bl });
  check('create QA shipment', ship.status === 201 && !!ship.json.id, `status ${ship.status} ${JSON.stringify(ship.json).slice(0, 200)}`);
  state.shipmentId = ship.json.id ?? ship.json.shipment?.id;

  // 6. OPS expense on the lot (money for the report).
  const exp = await api(state.ops, 'POST', '/ops/expenses', {
    shipmentId: state.shipmentId, expenseTypeCode: state.expenseTypeCode,
    amount: 50000, paidAt: '2026-10-16', feeName: `QA FB061 EXP ${rand}`,
    note: 'QA fixture — FB-061 verify, auto-cleans via registry',
  });
  check('create OPS expense (50,000)', exp.status === 201, `status ${exp.status} ${JSON.stringify(exp.json).slice(0, 300)}`);
  state.expenseId = exp.json.entry?.id ?? exp.json.id;
  if (!state.expenseId) { log(`  expense response: ${JSON.stringify(exp.json).slice(0, 500)}`); save(state); process.exit(1); }

  // 7. EXTERNAL trip on the lot, carrier = QA customer (writes EXTERNAL/CUSTOMER sidecar).
  state.plate = `QA-${rand}-FB061`;
  const trip = await api(state.admin, 'POST', '/trips', {
    customerId: state.custId, shipmentId: state.shipmentId,
    routeId: state.routeId, cargoTypeId: state.cargoTypeId, containerTypeId: state.containerTypeId,
    departureDate: '2026-10-16',
    carrierType: 'EXTERNAL', externalCarrierId: state.custId,
    externalPlateNumber: state.plate, externalDriverName: 'QA Tai xe FB061',
  });
  check('create EXTERNAL trip (carrier=QA customer)', trip.status === 201, `status ${trip.status} ${JSON.stringify(trip.json).slice(0, 300)}`);
  state.tripId = trip.json.id;
  state.tripVersion = trip.json.version;
  if (!state.tripId) { save(state); process.exit(1); }

  // 8. Link the expense source to the trip (governed expense-accounting update).
  const entry = await api(state.admin, 'GET', `/expense-accounting/entries/OPS/${state.expenseId}`);
  check('read expense entry', entry.status === 200 && !!entry.json.version, `status ${entry.status}`);
  const link = await api(state.admin, 'POST', `/expense-accounting/entries/OPS/${state.expenseId}/update`,
    { expectedVersion: entry.json.version, reason: 'FB-061 verify: attach fixture money to fixture trip', tripId: state.tripId });
  check('link source → trip', link.status === 200 && link.json.tripId === state.tripId,
    `status ${link.status} tripId=${link.json.tripId}`);

  log(`SETUP DONE: cust=${state.custId} sup=${state.supId} shipment=${state.shipmentId} expense=${state.expenseId} trip=${state.tripId} bl=${state.bl}`);
}

// ── phase: live (positive controls) ────────────────────────────────────────
if (phase === 'live') {
  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  const row = (rows.json.items ?? []).find(r => r.tripId === state.tripId);
  check('board: fixture row present', !!row, `items ${rows.json.items?.length}`);
  if (row) {
    check('board LIVE: carrierName resolves', row.carrierName === state.custName, `got "${row.carrierName}"`);
    check('board LIVE: customerName resolves', row.customerName === state.custName, `got "${row.customerName}"`);
    check('board LIVE: plate kept', row.plateNumber === state.plate, `got "${row.plateNumber}"`);
    check('board LIVE: driver kept', row.driverName === 'QA Tai xe FB061', `got "${row.driverName}"`);
  }
  state.boardPre = row ?? null;

  const thu = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=THU&dateFrom=2026-10-01&dateTo=2026-10-31');
  const thuRow = (thu.json.rows ?? []).find(r => r.party === state.custName);
  check('THU LIVE: bucket under QA customer name', !!thuRow, thuRow ? `tong=${thuRow.tongPhaiThuTra} soLuong=${thuRow.soLuong}` : `parties: ${(thu.json.rows ?? []).map(r => r.party).slice(0, 8).join(' | ')}`);
  if (thuRow) check('THU LIVE: amount 50000', Number(thuRow.tongPhaiThuTra) === 50000, `got ${thuRow.tongPhaiThuTra}`);
  state.thuPre = thu.json.rows ?? [];

  const tra = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=2026-10-01&dateTo=2026-10-31');
  const traRow = (tra.json.rows ?? []).find(r => r.party === state.custName);
  check('TRA LIVE: bucket under QA customer name (EXTERNAL/CUSTOMER)', !!traRow, traRow ? `tong=${traRow.tongPhaiThuTra}` : `parties: ${(tra.json.rows ?? []).map(r => r.party).slice(0, 8).join(' | ')}`);
  state.traPre = tra.json.rows ?? [];

  const depPut = await api(state.admin, 'PUT', `/expense-accounting/phoi-phieu/${state.tripId}/deposit`,
    { depositShipmentId: state.shipmentId, depositBillNumber: `QA-FB061-CTY-${rand}`, expectedVersion: (await api(state.admin, 'GET', `/trips/${state.tripId}`)).json.version });
  check('deposit PUT (bet leg = QA lot)', depPut.status === 200, `status ${depPut.status} ${JSON.stringify(depPut.json).slice(0, 200)}`);
  const dep = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/${state.tripId}/deposit`);
  check('DEPOSIT LIVE: customerName resolves', dep.json.depositCustomerName === state.custName, `got "${dep.json.depositCustomerName}"`);
  state.depositBill = dep.json.depositBillNumber;
}

// ── phase: delcust (LEAK-1 + LEAK-3 + deposit) ─────────────────────────────
if (phase === 'delcust') {
  // Catalog crud soft-delete needs the optimistic token: If-Unmodified-Since = row updatedAt.
  const custRow = await api(state.admin, 'GET', `/customers/${state.custId}`);
  const del = await api(state.admin, 'DELETE', `/customers/${state.custId}`, undefined, undefined,
    { 'If-Unmodified-Since': new Date(custRow.json.updatedAt).toISOString() });
  check('soft-delete QA customer (product path)', del.status === 200 || del.status === 204, `status ${del.status} ${JSON.stringify(del.json).slice(0, 200)}`);

  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  const row = (rows.json.items ?? []).find(r => r.tripId === state.tripId);
  if (row) {
    check('BOARD LEAK-1: carrierName is designed fallback', row.carrierName === 'Đơn vị vận chuyển không còn trong danh mục', `got "${row.carrierName}"`);
    check('BOARD LEAK-1: deleted name never surfaces', row.carrierName !== state.custName && !(row.carrierName ?? '').includes('FB061 KH'), `carrierName="${row.carrierName}"`);
    check('BOARD: customerName no longer resolves', row.customerName === null, `got "${row.customerName}"`);
    check('BOARD: plate kept (operational data)', row.plateNumber === state.plate, `got "${row.plateNumber}"`);
    check('BOARD: driver kept (operational data)', row.driverName === 'QA Tai xe FB061', `got "${row.driverName}"`);
  } else check('BOARD LEAK-1: fixture row present', false, 'row missing');

  const thu = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=THU&dateFrom=2026-10-01&dateTo=2026-10-31');
  const rowsNow = thu.json.rows ?? [];
  check('THU LEAK-3: deleted name absent', !rowsNow.some(r => r.party === state.custName), `parties contain QA name: ${rowsNow.some(r => r.party === state.custName)}`);
  const unknownNow = rowsNow.find(r => r.party === 'Chưa xác định');
  const unknownPre = (state.thuPre ?? []).find(r => r.party === 'Chưa xác định');
  const delta = Number(unknownNow?.tongPhaiThuTra ?? 0) - Number(unknownPre?.tongPhaiThuTra ?? 0);
  check('THU LEAK-3: money re-bucketed under Chưa xác định (Δ = +50,000)', unknownNow && delta === 50000,
    `Chưa xđ now=${unknownNow?.tongPhaiThuTra} pre=${unknownPre?.tongPhaiThuTra ?? 0} Δ=${delta}`);
  const thuRowNow = rowsNow.find(r => r.party === state.custName);
  check('THU LEAK-3: money not dropped (unknown bucket soLuong ≥ 1)', !!unknownNow && Number(unknownNow.soLuong) >= 1, `soLuong=${unknownNow?.soLuong} (deleted row: ${JSON.stringify(thuRowNow)})`);

  const tra = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=2026-10-01&dateTo=2026-10-31');
  const traRowsNow = tra.json.rows ?? [];
  check('TRA: deleted customer name absent', !traRowsNow.some(r => r.party === state.custName), '');
  // Carrier law: deleted carrier master → the money keeps reporting under the
  // designed fallback TEXT party ('Đơn vị vận chuyển không còn trong danh mục'),
  // not under 'Chưa xác định' (that bucket is the NULL-trip law).
  const FB = 'Đơn vị vận chuyển không còn trong danh mục';
  const traFallback = traRowsNow.find(r => r.party === FB);
  const traFallbackPre = (state.traPre ?? []).find(r => r.party === FB);
  const traDelta = Number(traFallback?.tongPhaiThuTra ?? 0) - Number(traFallbackPre?.tongPhaiThuTra ?? 0);
  check('TRA: money re-bucketed under fallback text (Δ = +50,000)', traFallback && traDelta === 50000,
    `fallback party now=${traFallback?.tongPhaiThuTra} pre=${traFallbackPre?.tongPhaiThuTra ?? 0} Δ=${traDelta}`);

  const dep = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/${state.tripId}/deposit`);
  check('DEPOSIT: customerName falls to null (dialog empty state)', dep.json.depositCustomerName === null, `got "${dep.json.depositCustomerName}"`);
  check('DEPOSIT: bet leg intact', dep.json.depositShipmentId === state.shipmentId && dep.json.depositBillNumber === state.depositBill,
    `shipment=${dep.json.depositShipmentId} bill=${dep.json.depositBillNumber}`);
}

// ── phase: readcust — re-assert the deleted-customer state (reads only; used
// ── after an assertion bug in the first delcust pass was fixed) ────────────
if (phase === 'readcust') {
  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  const row = (rows.json.items ?? []).find(r => r.tripId === state.tripId);
  if (row) {
    check('BOARD LEAK-1: carrierName is designed fallback', row.carrierName === 'Đơn vị vận chuyển không còn trong danh mục', `got "${row.carrierName}"`);
    check('BOARD LEAK-1: deleted name never surfaces', !(row.carrierName ?? '').includes('FB061 KH'), `carrierName="${row.carrierName}"`);
    check('BOARD: customerName no longer resolves', row.customerName === null, `got "${row.customerName}"`);
    check('BOARD: plate kept (operational data)', row.plateNumber === state.plate, `got "${row.plateNumber}"`);
    check('BOARD: driver kept (operational data)', row.driverName === 'QA Tai xe FB061', `got "${row.driverName}"`);
  } else check('BOARD LEAK-1: fixture row present', false, 'row missing');

  const thu = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=THU&dateFrom=2026-10-01&dateTo=2026-10-31');
  const rowsNow = thu.json.rows ?? [];
  check('THU LEAK-3: deleted name absent', !rowsNow.some(r => r.party === state.custName), '');
  const unknownNow = rowsNow.find(r => r.party === 'Chưa xác định');
  const unknownPre = (state.thuPre ?? []).find(r => r.party === 'Chưa xác định');
  const delta = Number(unknownNow?.tongPhaiThuTra ?? 0) - Number(unknownPre?.tongPhaiThuTra ?? 0);
  check('THU LEAK-3: money re-bucketed under Chưa xác định (Δ = +50,000)', unknownNow && delta === 50000,
    `Chưa xđ now=${unknownNow?.tongPhaiThuTra} pre=${unknownPre?.tongPhaiThuTra ?? 0} Δ=${delta} soLuong=${unknownNow?.soLuong}`);

  const tra = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=2026-10-01&dateTo=2026-10-31');
  const traRowsNow = tra.json.rows ?? [];
  check('TRA: deleted customer name absent', !traRowsNow.some(r => r.party === state.custName), '');
  const FB = 'Đơn vị vận chuyển không còn trong danh mục';
  const traFallback = traRowsNow.find(r => r.party === FB);
  const traFallbackPre = (state.traPre ?? []).find(r => r.party === FB);
  const traDelta = Number(traFallback?.tongPhaiThuTra ?? 0) - Number(traFallbackPre?.tongPhaiThuTra ?? 0);
  check('TRA: money re-bucketed under fallback text (Δ = +50,000)', traFallback && traDelta === 50000,
    `fallback now=${traFallback?.tongPhaiThuTra} pre=${traFallbackPre?.tongPhaiThuTra ?? 0} Δ=${traDelta}`);

  const dep = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/${state.tripId}/deposit`);
  check('DEPOSIT: customerName falls to null (dialog empty state)', dep.json.depositCustomerName === null, `got "${dep.json.depositCustomerName}"`);
  check('DEPOSIT: bet leg intact', dep.json.depositShipmentId === state.shipmentId && dep.json.depositBillNumber === state.depositBill,
    `shipment=${dep.json.depositShipmentId} bill=${dep.json.depositBillNumber}`);
}

// ── phase: flip (LEAK-2 live supplier control; guarded DB flip on OWN fixture row) ──
if (phase === 'flip') {
  const before = await psql(`SELECT trip_id, external_entity_type, external_entity_id, external_plate_number FROM trip_carrier_info WHERE trip_id = ${state.tripId}`);
  log(`  sidecar before: ${before}`);
  check('flip guard: sidecar is fixture CUSTOMER row', before.includes('CUSTOMER') && before.includes(String(state.custId)) && before.includes(state.plate), before);
  const upd = await psql(`UPDATE trip_carrier_info SET external_entity_type = 'SUPPLIER', external_entity_id = ${state.supId} WHERE trip_id = ${state.tripId} AND external_entity_type = 'CUSTOMER' AND external_entity_id = ${state.custId} AND external_plate_number = '${state.plate}'`);
  log(`  guarded UPDATE: ${upd}`);
  check('flip guard: UPDATE 1', upd.includes('UPDATE 1'), upd);
  const after = await psql(`SELECT trip_id, external_entity_type, external_entity_id FROM trip_carrier_info WHERE trip_id = ${state.tripId}`);
  log(`  sidecar after: ${after}`);

  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  const row = (rows.json.items ?? []).find(r => r.tripId === state.tripId);
  if (row) check('BOARD LEAK-2 LIVE: supplier name resolves via carrierSupplier join', row.carrierName === state.supName, `got "${row.carrierName}"`);
  else check('BOARD LEAK-2 LIVE: row present', false);

  const tra = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=2026-10-01&dateTo=2026-10-31');
  const traRow = (tra.json.rows ?? []).find(r => r.party === state.supName);
  check('TRA LEAK-2 LIVE: supplier bucket by name', !!traRow, traRow ? `tong=${traRow.tongPhaiThuTra}` : `parties: ${(tra.json.rows ?? []).map(r => r.party).slice(0, 8).join(' | ')}`);
}

// ── phase: delsup (LEAK-2 fallback) ─────────────────────────────────────────
if (phase === 'delsup') {
  const supRow = await api(state.admin, 'GET', `/suppliers/${state.supId}`);
  const del = await api(state.admin, 'DELETE', `/suppliers/${state.supId}`, undefined, undefined,
    { 'If-Unmodified-Since': new Date(supRow.json.updatedAt).toISOString() });
  check('soft-delete QA supplier (product path)', del.status === 200 || del.status === 204, `status ${del.status} ${JSON.stringify(del.json).slice(0, 200)}`);

  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  const row = (rows.json.items ?? []).find(r => r.tripId === state.tripId);
  if (row) {
    check('BOARD LEAK-2: carrierName is designed fallback (supplier deleted)', row.carrierName === 'Đơn vị vận chuyển không còn trong danh mục', `got "${row.carrierName}"`);
    check('BOARD LEAK-2: supplier name never surfaces', !(row.carrierName ?? '').includes('FB061 NCC'), `carrierName="${row.carrierName}"`);
    check('BOARD LEAK-2: plate/driver still kept', row.plateNumber === state.plate && row.driverName === 'QA Tai xe FB061', `plate="${row.plateNumber}" driver="${row.driverName}"`);
  } else check('BOARD LEAK-2: row present', false);

  const tra = await api(state.admin, 'GET', '/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=2026-10-01&dateTo=2026-10-31');
  const traRows = tra.json.rows ?? [];
  check('TRA LEAK-2: supplier name absent', !traRows.some(r => r.party === state.supName), '');
  const FB = 'Đơn vị vận chuyển không còn trong danh mục';
  const traFallback = traRows.find(r => r.party === FB);
  const traFallbackPre = (state.traPre ?? []).find(r => r.party === FB);
  const fbDelta = Number(traFallback?.tongPhaiThuTra ?? 0) - Number(traFallbackPre?.tongPhaiThuTra ?? 0);
  log(`  TRA fallback bucket: now=${traFallback?.tongPhaiThuTra} (baseline pre-fixture=${traFallbackPre?.tongPhaiThuTra ?? 0}, Δ=${fbDelta} — expect 0 here: same 50,000 already re-bucketed at delcust)`);
  check('TRA LEAK-2: money stays under fallback text (soLuong ≥ 1)', !!traFallback && Number(traFallback.soLuong) >= 1, `soLuong=${traFallback?.soLuong}`);
}

// ── phase: cleanup ──────────────────────────────────────────────────────────
if (phase === 'cleanup') {
  // 1. Void the OPS expense (product path; source → VOIDED, leaves the report).
  const voidExp = await api(state.ops, 'DELETE', `/ops/expenses/${state.expenseId}`, { reason: 'FB-061 verify cleanup: QA fixture voided' });
  check('cleanup: void OPS expense', voidExp.status === 200 || voidExp.status === 201, `status ${voidExp.status} ${JSON.stringify(voidExp.json).slice(0, 200)}`);

  // 2. Cancel the fixture trip (product path; leaves board + reports).
  const trip = await api(state.admin, 'GET', `/trips/${state.tripId}`);
  const cancel = await api(state.admin, 'POST', `/trips/${state.tripId}/cancel`,
    { expectedVersion: trip.json.version, reason: 'FB-061 verify cleanup: QA fixture trip' });
  check('cleanup: cancel fixture trip', cancel.status === 200, `status ${cancel.status} ${JSON.stringify(cancel.json).slice(0, 200)}`);

  // 3. Masters already soft-deleted mid-test (product path). Shipment goes via
  //    the registry (QA% bl_number → soft-delete). Sidecar goes via the
  //    registry (QA% plate → hard-delete). Sources/entries too (QA% fee_name).
  log('  cleanup: masters soft-deleted in-test; shipment/sidecar/expense handled by make qapurge (registry-driven, identifier-gated)');
}

// ── phase: census ───────────────────────────────────────────────────────────
if (phase === 'census') {
  // Board: no fixture row.
  const rows = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/rows?search=${encodeURIComponent(state.bl)}`);
  check('census board: no fixture rows', (rows.json.items ?? []).length === 0, `items=${rows.json.items?.length}`);

  // Reports: neither QA name anywhere in the window.
  for (const kind of ['THU', 'TRA']) {
    const rep = await api(state.admin, 'GET', `/expense-accounting/phoi-phieu/report?kind=${kind}&dateFrom=2026-10-01&dateTo=2026-10-31`);
    const names = (rep.json.rows ?? []).map(r => r.party);
    check(`census ${kind}: no QA names`, !names.some(p => p?.includes('FB061')), names.filter(p => p?.includes('FB061')).join(','));
  }

  // Catalogs: masters not live.
  const custs = await api(state.admin, 'GET', `/customers?search=${encodeURIComponent('FB061')}`);
  const custItems = custs.json.items ?? custs.json ?? [];
  check('census customers: not live', !JSON.stringify(custItems).includes(state.custName), `search hits: ${JSON.stringify(custItems).slice(0, 150)}`);
  const sups = await api(state.admin, 'GET', `/suppliers?search=${encodeURIComponent('FB061')}`);
  const supItems = sups.json.items ?? sups.json ?? [];
  check('census suppliers: not live', !JSON.stringify(supItems).includes(state.supName), `search hits: ${JSON.stringify(supItems).slice(0, 150)}`);

  // DB: fixture rows in their sanctioned end state.
  const dbState = await psql(`SELECT 'cust', id::text, coalesce(deleted_at::text,'LIVE') FROM customers WHERE id = ${state.custId}
    UNION ALL SELECT 'sup', id::text, coalesce(deleted_at::text,'LIVE') FROM suppliers WHERE id = ${state.supId}
    UNION ALL SELECT 'shipment', id::text, coalesce(deleted_at::text,'LIVE') FROM shipments WHERE id = ${state.shipmentId}
    UNION ALL SELECT 'trip', id::text, status FROM trips WHERE id = ${state.tripId}
    UNION ALL SELECT 'sidecar', coalesce(count(*)::text,'0'), coalesce(string_agg(external_entity_type, ','),'-') FROM trip_carrier_info WHERE trip_id = ${state.tripId}
    UNION ALL SELECT 'opsentry', coalesce(count(*)::text,'0'), coalesce(string_agg(approval_status, ','),'-') FROM ops_expense_entries WHERE id = ${state.expenseId}
    UNION ALL SELECT 'source', coalesce(count(*)::text,'0'), coalesce(string_agg(status, ','),'-') FROM expense_accounting_sources WHERE source_kind = 'OPS' AND source_id = ${state.expenseId}`);
  log(`  DB end state:\n${dbState.split('\n').map(l => `    ${l}`).join('\n')}`);
  check('census DB: sidecar purged', /^sidecar\|0\|-$/m.test(dbState), dbState.split('\n').find(l => l.startsWith('sidecar')));
  check('census DB: ops entry purged', /^opsentry\|0\|-$/m.test(dbState), dbState.split('\n').find(l => l.startsWith('opsentry')));
  check('census DB: source purged', /^source\|0\|-$/m.test(dbState), dbState.split('\n').find(l => l.startsWith('source')));
  check('census DB: customer soft-deleted', new RegExp(`^cust\\|${state.custId}\\|20`, 'm').test(dbState), dbState.split('\n').find(l => l.startsWith('cust')));
  check('census DB: supplier soft-deleted', new RegExp(`^sup\\|${state.supId}\\|20`, 'm').test(dbState), dbState.split('\n').find(l => l.startsWith('sup')));
  check('census DB: shipment soft-deleted', new RegExp(`^shipment\\|${state.shipmentId}\\|20`, 'm').test(dbState), dbState.split('\n').find(l => l.startsWith('shipment')));
  check('census DB: trip canceled', new RegExp(`^trip\\|${state.tripId}\\|CANCELED$`, 'm').test(dbState), dbState.split('\n').find(l => l.startsWith('trip')));

  log(`CENSUS DONE — failures so far: ${failures.length}`);
}

if (failures.length) {
  log(`PHASE ${phase} RESULT: ${failures.length} FAIL(s): ${failures.map(f => f.name).join('; ')}`);
  save({ ...state, lastFailures: failures });
  process.exit(1);
}
log(`PHASE ${phase} RESULT: all checks passed`);
save(state);
