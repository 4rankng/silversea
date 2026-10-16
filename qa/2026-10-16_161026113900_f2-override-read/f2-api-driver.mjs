// Card 161026113900 F-2/F-4 staging verify — phase 1 (API), build e3286338.
// Fixtures: one QA customer + 3 LCL lots (A=merge principal, B=merge member,
// C=unmerged control) with one EXTERNAL-carrier trip each; merge A+B via
// POST /api/shipments/lcl/rev-group; read both money boards + trip GET.
// Every write carries an Idempotency-Key; fixtures tagged QA-F2-<ts> for the
// sanctioned purge. C (control) must stay unmerged/unstamped.
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const TAG = '161026113900-f2';
const QATAG = `QA-F2-${new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(5, 16).replace(/[-:T]/g, '')}`;
const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EXPECTED_BUILD = 'e3286338';
const NOTE = `QA ${QATAG} — F-2 override-read verify, purge ngay sau kiem tra`;
const DIR = 'qa/2026-10-16_161026113900_f2-override-read';
mkdirSync(DIR, { recursive: true });
const LOG = `${DIR}/f2-api-driver.log`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const save = (name, data) => writeFileSync(`${DIR}/${name}`, JSON.stringify(data, null, 2));
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);

async function api(account, method, path, body, { idem = method !== 'GET', raw = false } = {}) {
  const headers = { ...(account?.auth ?? {}), 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
  return { status: res.status, body: parsed, text };
}

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json();
  const token = body.token ?? body.accessToken ?? body?.data?.token;
  step('login', { identifier, status: res.status, gotToken: Boolean(token), role: body.user?.role ?? null });
  if (!token) throw new Error(`no token for ${identifier}`);
  return { identifier, token, user: body.user ?? null, auth: { Authorization: `Bearer ${token}` } };
}

// ── 0. build gate ────────────────────────────────────────────────────────────
const health = await (await fetch(`${API}/health`)).json();
step('health', health);
if (health.buildHash !== EXPECTED_BUILD) {
  save('f2-summary.json', { card: TAG, verdict: 'BLOCKED', reason: `buildHash ${health.buildHash} ≠ ${EXPECTED_BUILD}` });
  throw new Error(`buildHash ${health.buildHash} ≠ expected ${EXPECTED_BUILD} — BLOCKED`);
}

// ── 1. accounts (testplan/testaccounts.txt staging block) ────────────────────
const cus = await login('tiepvv');    // CUS — creates lots, merges, reads debit-summary
const acc = await login('hoapt');     // ACCOUNTANT — reads debit-board
const admin = await login('admin');   // ADMIN — creates trips

// ── 2. catalogs ──────────────────────────────────────────────────────────────
async function firstList(account, path, pick) {
  const r = await api(account, 'GET', path, undefined, { idem: false });
  const items = Array.isArray(r.body) ? r.body : (r.body?.items ?? r.body?.data ?? []);
  step('catalog', { path, status: r.status, count: items.length });
  if (r.status !== 200 || items.length === 0) throw new Error(`catalog ${path} unavailable: ${r.status}`);
  return pick ? pick(items) : items;
}
const vscList = await firstList(cus, '/vehicle-size-classes');
save('f2-api-vsc.json', vscList);
const vsc = vscList.find((v) => v.code === '5T') ?? vscList[0];
const route = await firstList(cus, '/routes', (items) => items[0]);
const cargoType = await firstList(admin, '/cargo-types', (items) => items.find((c) => !c.isBulk) ?? items[0]);
const contType = await firstList(admin, '/container-types', (items) => items[0]);
step('catalog-picks', { vscId: vsc.id, vscCode: vsc.code, routeId: route.id, routeName: route.name, cargoTypeId: cargoType.id, contTypeId: contType.id });

// ── 3. QA customer ───────────────────────────────────────────────────────────
let customerId = null;
const searchRes = await api(cus, 'GET', `/customers?search=${encodeURIComponent(QATAG)}`, undefined, { idem: false });
const existing = (searchRes.body?.items ?? searchRes.body ?? []).find((c) => (c.name ?? '').includes(QATAG));
if (existing) { customerId = existing.id; step('customer-reuse', { id: customerId }); }
let custRes = null;
if (!customerId) {
  custRes = await api(cus, 'POST', '/customers', { name: `${QATAG} khách QA F-2` });
  if (custRes.status === 403) custRes = await api(admin, 'POST', '/customers', { name: `${QATAG} khách QA F-2` });
}
if (custRes) {
  step('customer-create', { status: custRes.status, id: custRes.body?.id });
  if (custRes.status !== 201 && custRes.status !== 200) throw new Error(`customer create failed: ${JSON.stringify(custRes.body).slice(0, 300)}`);
  customerId = custRes.body.id;
}

// ── 4. three LCL lots (A principal, B member, C control) ─────────────────────
const lots = {};
for (const suffix of ['A', 'B', 'C']) {
  const payload = {
    customerId, cargoMode: 'LCL', tradeDirection: 'IMPORT',
    blNumber: `${QATAG}-${suffix}`,
    routeId: route.id, cargoTypeId: cargoType.id,
    expectedDeliveryDate: vnDate(1),
    packageCount: 5, packageType: 'PALLET', cargoWeightKg: 1900, cargoVolumeCbm: 4,
    pickupLocation: 'QA kho F-2', deliveryLocation: 'QA bai F-2',
    driverNotes: NOTE,
  };
  const r = await api(cus, 'POST', '/shipments', payload);
  step('shipment-create', { suffix, status: r.status, id: r.body?.id, ref: r.body?.blNumber ?? r.body?.bookingRef, err: r.status >= 300 ? String(JSON.stringify(r.body)).slice(0, 300) : undefined });
  if (r.status !== 201 && r.status !== 200) throw new Error(`shipment ${suffix} create failed`);
  lots[suffix] = { id: r.body.id, ref: r.body.blNumber ?? r.body.bookingRef };
}

// ── 5. one EXTERNAL trip per lot (no dispatch needed) ────────────────────────
for (const suffix of ['A', 'B', 'C']) {
  const payload = {
    customerId, routeId: route.id, cargoTypeId: cargoType.id, containerTypeId: contType.id,
    departureDate: vnDate(0), shipmentId: lots[suffix].id,
    carrierType: 'EXTERNAL', externalCarrierId: customerId,
    externalFreightCost: 1500000, externalPlateNumber: '50C-123.45', externalDriverName: `QA-F2 tai xe ${suffix}`,
    customerReference: `${QATAG}-trip-${suffix}`,
  };
  const r = await api(admin, 'POST', '/trips', payload);
  const tripId = r.body?.id ?? r.body?.trip?.id;
  step('trip-create', { suffix, status: r.status, tripId, err: r.status >= 300 ? String(JSON.stringify(r.body)).slice(0, 300) : undefined });
  if (r.status !== 201 && r.status !== 200) throw new Error(`trip ${suffix} create failed`);
  lots[suffix].tripId = tripId;
}
await sleep(500);

// baseline trip state (pre-merge)
for (const suffix of ['A', 'B', 'C']) {
  const r = await api(admin, 'GET', `/trips/${lots[suffix].tripId}`, undefined, { idem: false });
  const t = r.body ?? {};
  lots[suffix].preMerge = {
    status: r.status,
    revenue: t.revenue ?? t.financial?.revenue ?? null,
    pricingSource: t.pricingSource ?? null,
    revenueOverrideReason: t.revenueOverrideReason === undefined ? '__ABSENT__' : (t.revenueOverrideReason ?? null),
  };
  save(`f2-api-trip-pre-${suffix}.json`, r.body);
  step('trip-pre', { suffix, ...lots[suffix].preMerge });
}

// ── 6. merge A+B (REV group, A = Lô 1) — the merge-override marker writer ────
const mergeRes = await api(cus, 'POST', '/shipments/lcl/rev-group', {
  shipmentIds: [lots.A.id, lots.B.id], vehicleSizeClassId: vsc.id, billingTruckNo: '50C-999.99',
});
step('rev-group', { status: mergeRes.status, body: mergeRes.status >= 300 ? String(JSON.stringify(mergeRes.body)).slice(0, 400) : mergeRes.body });
save('f2-api-rev-group.json', mergeRes.body);
if (mergeRes.status !== 201) throw new Error('rev-group merge failed — see log');

// ── 7. board reads ───────────────────────────────────────────────────────────
await sleep(500);
const q = `customerId=${customerId}&deliveryDateFrom=${vnDate(-1)}&deliveryDateTo=${vnDate(7)}`;
const dsCus = await api(cus, 'GET', `/shipments/debit-summary?${q}`, undefined, { idem: false });
const dsAcc = await api(acc, 'GET', `/shipments/debit-summary?${q}`, undefined, { idem: false });
save('f2-api-debit-summary-cus.json', dsCus.body);
save('f2-api-debit-summary-acc.json', dsAcc.body);
const dsRows = (r) => (Array.isArray(r.body) ? r.body : (r.body?.items ?? r.body?.rows ?? []));
const pickLot = (rows, id) => rows.find((x) => x.shipmentId === id || x.id === id);
for (const suffix of ['A', 'B', 'C']) {
  const row = pickLot(dsRows(dsCus), lots[suffix].id) ?? null;
  const slim = row && (({ shipmentId, freightAuto, freightOverrideReason, chiHo, revGroupId, revGroupOrder, revGroupMemberCount, revGroupPrincipalRef }) => ({ shipmentId, freightAuto, freightOverrideReason, chiHo, revGroupId, revGroupOrder, revGroupMemberCount, revGroupPrincipalRef }))(row);
  step('debit-summary-row', { suffix, as: 'tiepvv(CUS)', row: slim });
}

const bb = await api(acc, 'GET', `/accounting/debit-board?dateFrom=${vnDate(-7)}&dateTo=${vnDate(7)}`, undefined, { idem: false });
step('debit-board', { status: bb.status, note: 'accounting board fetch (path may 404 — probed below)' });
save('f2-api-accounting-board-raw.json', bb.body);

// ── 8. trip GET contract (F-4 / m21) ─────────────────────────────────────────
for (const suffix of ['A', 'B', 'C']) {
  const r = await api(admin, 'GET', `/trips/${lots[suffix].tripId}`, undefined, { idem: false });
  const t = r.body ?? {};
  lots[suffix].postMerge = {
    status: r.status,
    revenue: t.revenue ?? null,
    revenueOverrideReason: t.revenueOverrideReason === undefined ? '__ABSENT__' : (t.revenueOverrideReason ?? null),
    revenueOverriddenAt: t.revenueOverriddenAt ?? null,
  };
  save(`f2-api-trip-post-${suffix}.json`, r.body);
  step('trip-post', { suffix, ...lots[suffix].postMerge });
}

const state = { TAG, QATAG, customerId, vscId: vsc.id, lots, build: health.buildHash };
save('f2-state.json', state);
step('done', { QATAG, lots: Object.fromEntries(Object.entries(lots).map(([k, v]) => [k, { id: v.id, tripId: v.tripId }])) });
