// Phase 1b — (i) stamp A's trip revenue to a distinctive 7654321 via the M2.1
// figure path (boards must follow trip_financial_state.revenue), (ii) second
// merge on fresh lots D+E with clean before/after freight_rate_snapshots dumps
// (check 2). DB dumps run over ssh psql (no docker exec -i — stdin trap).
import { appendFileSync, writeFileSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const DIR = 'qa/2026-10-16_161026113900_f2-override-read';
const LOG = `${DIR}/f2-api-driver.log`;
const step = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  appendFileSync(LOG, JSON.stringify(e) + '\n');
  console.log(JSON.stringify(e));
};
const save = (name, data) => writeFileSync(`${DIR}/${name}`, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
const API = 'https://vantai.tingting.vip/api';
const vnDate = (offset = 0) => new Date(Date.now() + 7 * 3600 * 1000 + offset * 86400 * 1000).toISOString().slice(0, 10);
const QATAG = 'QA-F2-10162045';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  return { auth: { Authorization: `Bearer ${body.token}` } };
}
async function api(account, method, path, body, { idem = method !== 'GET' } = {}) {
  const headers = { ...account.auth, 'Content-Type': 'application/json' };
  if (idem) headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text.slice(0, 400); }
  return { status: res.status, body: parsed };
}
const sshPsql = (sql) => execSync(`ssh root@vantai.tingting.vip "docker exec vantai-postgres-1 psql -U vantai -d vantai -At -c \\"${sql}\\""`, { encoding: 'utf8' });
const dumpSnapshots = (label) => {
  const out = sshPsql('SELECT id,shipment_id,trip_id,freight_amount,surcharge_amount,total_amount,created_at FROM freight_rate_snapshots ORDER BY id');
  writeFileSync(`${DIR}/f2-db-snapshots-${label}.tsv`, out);
  return out;
};
const dumpTfs = (tripIds, label) => {
  const out = sshPsql(`SELECT trip_id,revenue,revenue_original,revenue_overridden_by,revenue_overridden_at,revenue_override_reason,pricing_source FROM trip_financial_state WHERE trip_id IN (${tripIds}) ORDER BY trip_id`);
  writeFileSync(`${DIR}/f2-db-tfs-${label}.tsv`, out);
  return out;
};

const cus = await login('tiepvv');
const admin = await login('admin');
const state = JSON.parse(readFileSync(`${DIR}/f2-state.json`, 'utf8'));
const { lots, customerId } = state;

// catalogs for the D/E trip creates (phase-1 didn't persist these ids)
async function firstId(path, pick) {
  const r = await api(admin, 'GET', path, undefined, { idem: false });
  const items = Array.isArray(r.body) ? r.body : (r.body?.items ?? []);
  return pick(items);
}
const vscId = state.vscId ?? await firstId('/vehicle-size-classes', (items) => (items.find((v) => v.code === '5T') ?? items[0]).id);
const routeId = await firstId('/routes', (items) => items[0].id);
const cargoTypeId = await firstId('/cargo-types', (items) => (items.find((c) => !c.isBulk) ?? items[0]).id);
const contTypeId = await firstId('/container-types', (items) => items[0].id);

// ── (i) stamp A's revenue via M2.1 pre-departure figures ─────────────────────
const tripA = (await api(admin, 'GET', `/trips/${lots.A.tripId}`, undefined, { idem: false })).body;
dumpTfs(String(lots.A.tripId), 'pre-stamp-t189');
if (Number(tripA.revenue) === 7654321) {
  step('stamp-revenue', { tripId: lots.A.tripId, status: 'already-stamped (rerun)' });
} else {
  const origin = tripA.canonicalOrigin ?? 'QA-F2 origin';
  const destination = tripA.canonicalDestination ?? 'QA-F2 destination';
  const stampBody = {
    legs: [{ sequence: 1, origin, destination, km: 100, loadingType: 'HANG' }],
    fuelMode: tripA.fuelMode ?? 'AUTO',
    revenue: 7654321,
    version: tripA.version,
  };
  let put = await api(admin, 'PUT', `/trips/${lots.A.tripId}/pre-departure`, stampBody);
  step('stamp-revenue', { tripId: lots.A.tripId, status: put.status, err: put.status >= 300 ? String(JSON.stringify(put.body)).slice(0, 300) : undefined });
  if (put.status >= 300) {
    put = await api(admin, 'PUT', `/trips/${lots.A.tripId}/actuals`, stampBody);
    step('stamp-revenue-actuals-fallback', { status: put.status, err: put.status >= 300 ? String(JSON.stringify(put.body)).slice(0, 300) : undefined });
  }
  if (put.status >= 300) throw new Error('revenue stamp failed');
}
dumpTfs(String(lots.A.tripId), 'post-stamp-t189');
const snapAfterStamp = dumpSnapshots('after-stamp');
step('snapshots-after-stamp', { rows: snapAfterStamp.trim() === '' ? 0 : snapAfterStamp.trim().split('\n').length });

// board re-read after stamp
const q = `customerId=${customerId}&deliveryDateFrom=${vnDate(-1)}&deliveryDateTo=${vnDate(7)}`;
const ds = await api(cus, 'GET', `/shipments/debit-summary?${q}`, undefined, { idem: false });
const rows = Array.isArray(ds.body) ? ds.body : (ds.body?.items ?? ds.body?.rows ?? []);
for (const suffix of ['A', 'B', 'C']) {
  const row = rows.find((x) => x.shipmentId === state.lots[suffix].id);
  step('debit-summary-after-stamp', { suffix, freightAuto: row?.freightAuto ?? null, reason: row?.freightOverrideReason ?? null });
}

// ── (ii) second merge on fresh lots D+E with clean snapshot dumps ─────────────
const lotsDe = {};
for (const suffix of ['D', 'E']) {
  const ship = await api(cus, 'POST', '/shipments', {
    customerId, cargoMode: 'LCL', tradeDirection: 'IMPORT',
    blNumber: `${QATAG}-${suffix}`, routeId,
    expectedDeliveryDate: vnDate(1),
    packageCount: 5, packageType: 'PALLET', cargoWeightKg: 1900, cargoVolumeCbm: 4,
    driverNotes: `QA ${QATAG} — F-2 verify lot ${suffix}, purge ngay sau kiem tra`,
  });
  step('shipment-create', { suffix, status: ship.status, id: ship.body?.id, err: ship.status >= 300 ? String(JSON.stringify(ship.body)).slice(0, 300) : undefined });
  if (ship.status !== 201 && ship.status !== 200) throw new Error(`shipment ${suffix} failed`);
  const trip = await api(admin, 'POST', '/trips', {
    customerId, routeId, cargoTypeId, containerTypeId: contTypeId,
    departureDate: vnDate(0), shipmentId: ship.body.id,
    carrierType: 'EXTERNAL', externalCarrierId: customerId,
    externalFreightCost: 1500000, externalPlateNumber: '50C-123.45', externalDriverName: `QA-F2 tai xe ${suffix}`,
    customerReference: `${QATAG}-trip-${suffix}`,
  });
  const tripId = trip.body?.id ?? trip.body?.trip?.id;
  step('trip-create', { suffix, status: trip.status, tripId, err: trip.status >= 300 ? String(JSON.stringify(trip.body)).slice(0, 300) : undefined });
  lotsDe[suffix] = { id: ship.body.id, tripId, ref: ship.body.blNumber };
}
save('f2-state.json', { ...state, lotsDe, vscId, routeId, cargoTypeId, contTypeId });

const snapBeforeMerge2 = dumpSnapshots('before-merge2');
dumpTfs(`${lotsDe.D.tripId},${lotsDe.E.tripId}`, 'pre-merge2');
const merge2 = await api(cus, 'POST', '/shipments/lcl/rev-group', {
  shipmentIds: [lotsDe.D.id, lotsDe.E.id], vehicleSizeClassId: vscId, billingTruckNo: '50C-999.99',
});
step('rev-group-2', { status: merge2.status, body: merge2.status >= 300 ? String(JSON.stringify(merge2.body)).slice(0, 300) : merge2.body });
if (merge2.status !== 201) throw new Error('merge2 failed');

const snapAfterMerge2 = dumpSnapshots('after-merge2');
dumpTfs(`${lotsDe.D.tripId},${lotsDe.E.tripId}`, 'post-merge2');
step('snapshot-diff-merge2', {
  rowsBefore: snapBeforeMerge2.trim() === '' ? 0 : snapBeforeMerge2.trim().split('\n').length,
  rowsAfter: snapAfterMerge2.trim() === '' ? 0 : snapAfterMerge2.trim().split('\n').length,
  identical: snapBeforeMerge2 === snapAfterMerge2,
});
const snapPrev = readFileSync(`${DIR}/f2-db-snapshots-after-stamp.tsv`, 'utf8');
step('snapshot-diff-stamp-vs-merge2', { identical: snapPrev === snapAfterMerge2 });

// board rows for D/E + F-4 trip GETs
const ds2 = await api(cus, 'GET', `/shipments/debit-summary?${q}`, undefined, { idem: false });
const rows2 = Array.isArray(ds2.body) ? ds2.body : (ds2.body?.items ?? ds2.body?.rows ?? []);
for (const suffix of ['D', 'E']) {
  const row = rows2.find((x) => x.shipmentId === lotsDe[suffix].id);
  step('debit-summary-de', { suffix, freightAuto: row?.freightAuto ?? null, reason: row?.freightOverrideReason ?? null });
  const t = (await api(admin, 'GET', `/trips/${lotsDe[suffix].tripId}`, undefined, { idem: false })).body;
  step('trip-get-de', { suffix, revenue: t.revenue, reason: t.revenueOverrideReason === undefined ? '__ABSENT__' : (t.revenueOverrideReason ?? null), overriddenAt: t.revenueOverriddenAt ?? null });
}
save('f2-state.json', { ...state, lotsDe, vscId, routeId, cargoTypeId, contTypeId, stampA: { revenue: '7654321' } });
step('done-phase1b', { lotsDe });
