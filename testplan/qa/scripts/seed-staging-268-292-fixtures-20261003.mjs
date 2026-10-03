// Staging fixtures for cards 268 (factory detail popover) + 292 (chi-ho dialog),
// 2026-10-03, kanban-be2. Creates ONE registered lot under a real staging
// customer with a catalog FACTORY site on its container row (the 268 popover
// trigger requires a catalog site — ad-hoc raw names get no button), then
// dispatches it on a real staging rig so the trip enters the phoi-phieu report
// window (the 292 chi-ho dialog opens from a report row).
//
// Registry: the lot self-identifies via customerNotes marker
//   'QA268-QA292-FIXTURE 2026-10-03' and blNumber prefix 'QA268QA292-'.
// Usage: node testplan/qa/scripts/seed-staging-268-292-fixtures-20261003.mjs
import { writeFileSync } from 'fs';
import crypto from 'crypto';

const API = process.env.API_URL || 'https://vantai.tingting.vip/api';
const IDENTIFIER = process.env.IDENTIFIER || 'admin';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const MARKER = 'QA268-QA292-FIXTURE 2026-10-03';
const LOG = 'qa/2026-10-03_311-fixtures/seed.log';

const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOG, lines.join('\n') + '\n');
};

const LETTERS = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
function containerNumber(prefix, serial) {
  const digits = String(serial).padStart(6, '0');
  const body = `${prefix}${digits}`;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const value = i < 4 ? LETTERS[body[i]] : Number(body[i]);
    if (value === undefined || Number.isNaN(value)) throw new Error(`bad container char: ${body[i]}`);
    sum += value * 2 ** i;
  }
  return `${body}${(sum % 11) % 10}`;
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();
log(`login ${IDENTIFIER} @ ${API}`);

const api = async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

// Proven (customer, factory) pair: reuse a factory assignment that ALREADY
// WORKS on staging — a live container row carrying an operationalSiteId — so
// the 409 ownership trap and the junk-catalog problem both disappear.
const workboard = await api('GET', '/shipments/cus-workspace/containers?page=1&limit=100&transportDateFrom=2020-01-01&transportDateTo=2030-12-31');
if (workboard.status !== 200) throw new Error(`workboard failed: ${workboard.status}`);
let proven = null;
for (const row of workboard.body.items) {
  if (row.isAdHoc || row.customerId == null) continue;
  const detail = await api('GET', `/shipments/cus-workspace/${row.shipmentId}`);
  const withFactory = (detail.body.containers ?? []).find((c) => c.operationalSiteId != null);
  if (withFactory) {
    proven = { customerId: row.customerId, operationalSiteId: withFactory.operationalSiteId, shipmentId: row.shipmentId, container: withFactory };
    break;
  }
}
if (!proven) throw new Error('no live container row carries a factory assignment');
const referenceRow = workboard.body.items.find((row) => row.shipmentId === proven.shipmentId);
const sites = await api('GET', '/shipments/operational-sites/admin');
if (sites.status !== 200) throw new Error(`sites failed: ${sites.status}`);
const factory = sites.body.items.find((s) => s.id === proven.operationalSiteId);
if (!factory) throw new Error(`proven site ${proven.operationalSiteId} not in catalog`);
log('proven pair', { customerId: proven.customerId, siteId: factory.id, siteCode: factory.code, siteName: factory.name, fromLot: proven.shipmentId });

const reference = await api('GET', `/shipments/cus-workspace/${proven.shipmentId}`);
const referenceContainer = proven.container;
const taxonomy = {
  customerId: proven.customerId,
  containerTypeId: referenceContainer?.containerTypeId,
  routeId: referenceContainer?.routeId,
  pickupPortId: referenceContainer?.liftSiteId,
  dropoffPortId: referenceContainer?.dropoffSiteId,
};
log('taxonomy', { from: proven.shipmentId, ...taxonomy });
if (Object.values(taxonomy).some((v) => v == null)) throw new Error('incomplete taxonomy');

// The lot.
const bl = `QA268QA292-${STAMP}`;
const created = await api('POST', '/shipments', {
  customerId: taxonomy.customerId,
  cargoMode: 'FCL',
  tradeDirection: 'IMPORT',
  blNumber: bl,
  shippingLineName: 'QA Line',
  customerNotes: `${MARKER} — lot cho rung popover 268 + hang phoi-phieu 292. Xoa duoc sau QA.`,
});
if (created.status !== 201 && created.status !== 200) throw new Error(`create failed: ${created.status} ${JSON.stringify(created.body)}`);
const shipmentId = created.body.id ?? created.body.shipment?.id;
const version = created.body.version ?? created.body.shipment?.version ?? 1;
log('lot created', { shipmentId, bl, version });

const base = 950_000 + (Number(STAMP.slice(-4)) % 900) * 10;
const containers = [{
  containerNumber: containerNumber('QATU', base),
  containerTypeId: taxonomy.containerTypeId,
  routeId: taxonomy.routeId,
  pickupPortId: taxonomy.pickupPortId,
  dropoffPortId: taxonomy.dropoffPortId,
  operationalSiteId: factory.id,
  shippingLineName: 'QA Line',
  cargoWeightKg: '11000',
  // The dispatch queue is DATE-GROUPED: a dateless lot never lists there.
  customerAppointmentAt: new Date(new Date(new Date().getTime() + 2 * 86400_000).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString(),
}];
const reconciled = await api('PUT', `/shipments/${shipmentId}/containers`, { expectedVersion: version, containers });
if (reconciled.status !== 200) throw new Error(`containers failed: ${reconciled.status} ${JSON.stringify(reconciled.body)}`);
log('container with factory', { containerNumber: containers[0].containerNumber, operationalSiteId: factory.id });

// Dispatch on a real rig so the trip enters the phoi-phieu window.
const queue = await api('GET', `/shipments/dispatch-queue?status=READY&limit=50`);
if (queue.status !== 200) throw new Error(`queue failed: ${queue.status}`);
const item = queue.body.items.find((q) => q.shipmentId === shipmentId);
if (!item) throw new Error(`own lot not in dispatch queue: ${JSON.stringify(queue.body.items?.slice(0, 3))}`);
const fleet = await api('GET', '/shipments/dispatch-fleet?resource=TRUCK');
if (fleet.status !== 200) throw new Error(`fleet failed: ${fleet.status}`);
const rig = fleet.body.items.find((t) => t.driverId != null && t.trailerId != null) ?? fleet.body.items[0];
if (!rig) throw new Error('no staging rig');
log('rig', { keys: Object.keys(rig), truckId: rig.truckId, trailerId: rig.trailerId, driverId: rig.driverId });
const now = new Date();
const start = new Date(now.getTime() + 24 * 3600_000);
const end = new Date(start.getTime() + 4 * 3600_000);
const dispatched = await api('POST', `/shipments/${shipmentId}/dispatch`, {
  fulfillmentId: item.fulfillmentId,
  expectedVersion: item.fulfillmentVersion,
  plannedStartAt: start.toISOString(),
  plannedEndAt: end.toISOString(),
  endTimeConfirmed: true,
  carrierType: 'OWN',
  truckId: rig.truckId ?? null,
  driverId: rig.driverId ?? null,
  trailerId: rig.trailerId ?? null,
});
if (dispatched.status !== 201 && dispatched.status !== 200) throw new Error(`dispatch failed: ${dispatched.status} ${JSON.stringify(dispatched.body)}`);
const tripId = dispatched.body.trip?.id;
log('dispatched', { tripId, tripCode: dispatched.body.trip?.tripCode });

// Verify the trip rides the phoi-phieu report window.
const day = (d) => d.toISOString().slice(0, 10);
const rows = await api('GET', `/expense-accounting/phoi-phieu/rows?dateFrom=${day(new Date())}&dateTo=${day(new Date(now.getTime() + 7 * 86400_000))}&limit=200`);
const row = String(rows.status) === '200' && Array.isArray(rows.body)
  ? rows.body.find((r) => r.tripId === tripId)
  : (rows.body?.items ?? []).find((r) => r.tripId === tripId);
log('phoi-phieu row', { reportStatus: rows.status, found: Boolean(row), tripId });

log('HANDOFF', {
  lot: { shipmentId, bl, container: containers[0].containerNumber, factorySiteId: factory.id, factoryName: factory.name },
  trip: { tripId, tripCode: dispatched.body.trip?.tripCode },
  marker: MARKER,
  qa268: 'EDIT this lot (or /shipments/new + pick customer+factory): the factory cell shows the info button -> popover (address + invoice group).',
  qa292: '/accounting/phoi-phieu with the date window above -> the trip row shows "Chi tiết chi hộ" -> the dialog opens on this trip (fee rows need a driver phoi submission if empties are not enough for the rung).',
});
console.log('SEED_DONE');
