// Local-dev fixtures for card 20261003_317's AC2 UI rung: two lots + rows on a
// shared tractor with overlapping appointment windows, so the detailed-plan
// edit dialog's inline 409 can be driven on http://localhost:7175.
import { writeFileSync } from 'fs';
import crypto from 'crypto';

const API = process.env.API_URL || 'http://localhost:3002/api';
const IDENTIFIER = process.env.IDENTIFIER || 'admin';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const MARKER = 'QA317-DIALOG-FIXTURE 2026-10-03';
const LOG = 'qa/2026-10-03_317-dialog-fixtures/seed.log';

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
    if (value === undefined || Number.isNaN(value)) throw new Error(`bad char: ${body[i]}`);
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

const workboard = await api('GET', '/shipments/cus-workspace/containers?page=1&limit=100&transportDateFrom=2020-01-01&transportDateTo=2030-12-31');
if (workboard.status !== 200) throw new Error(`workboard failed: ${workboard.status}`);
const referenceRow = workboard.body.items.find((row) => row.customerId && !row.isAdHoc && row.containerTypeLabel && row.liftSite && row.dropoffSite);
if (!referenceRow) throw new Error('no reference row on local');
const reference = await api('GET', `/shipments/cus-workspace/${referenceRow.shipmentId}`);
const referenceContainer = reference.body.containers.find((c) => c.id === referenceRow.id);
const taxonomy = {
  customerId: referenceRow.customerId ?? reference.body.summary.customerId,
  containerTypeId: referenceContainer?.containerTypeId,
  routeId: referenceContainer?.routeId,
  pickupPortId: referenceContainer?.liftSiteId,
  dropoffPortId: referenceContainer?.dropoffSiteId,
  operationalSiteId: referenceContainer?.operationalSiteId ?? null,
};
log('taxonomy', { from: referenceRow.shipmentId, ...taxonomy });

// A shared tractor on the local fleet: an ACTIVE truck with a plate.
const fleet = await api('GET', '/shipments/dispatch-fleet?resource=TRUCK');
const rig = (fleet.body?.items ?? []).find((t) => t.status === 'ACTIVE' && t.licensePlate);
if (!rig) throw new Error('no local rig');
log('rig', { truckId: rig.id, plate: rig.licensePlate });

const made = [];
for (const tag of ['a', 'b']) {
  const bl = `QA317-${STAMP}-${tag}`;
  const created = await api('POST', '/shipments', {
    customerId: taxonomy.customerId,
    cargoMode: 'FCL',
    tradeDirection: 'IMPORT',
    blNumber: bl,
    shippingLineName: 'QA Line',
    customerNotes: `${MARKER} — lot cho rung dialog 317 (${tag}). Xoa duoc sau QA.`,
  });
  if (created.status !== 201 && created.status !== 200) throw new Error(`create ${tag} failed: ${created.status}`);
  const shipmentId = created.body.id ?? created.body.shipment?.id;
  const version = created.body.version ?? created.body.shipment?.version ?? 1;
  const base = 960_000 + (Number(STAMP.slice(-4)) % 800) * 10 + (tag === 'a' ? 0 : 1);
  const containers = [{
    containerNumber: containerNumber('QATU', base),
    containerTypeId: taxonomy.containerTypeId,
    routeId: taxonomy.routeId,
    pickupPortId: taxonomy.pickupPortId,
    dropoffPortId: taxonomy.dropoffPortId,
    operationalSiteId: taxonomy.operationalSiteId,
    shippingLineName: 'QA Line',
    customerAppointmentAt: new Date(`${new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10)}T02:00:00.000Z`),
  }];
  const reconciled = await api('PUT', `/shipments/${shipmentId}/containers`, { expectedVersion: version, containers });
  if (reconciled.status !== 200) throw new Error(`containers ${tag} failed: ${reconciled.status}`);
  made.push({ shipmentId, bl, container: containers[0].containerNumber, appointment: containers[0].customerAppointmentAt });
  log(`lot ${tag}`, { shipmentId, bl, container: containers[0].containerNumber });
}

log('HANDOFF', { marker: MARKER, lots: made, rig: { truckId: rig.id, plate: rig.licensePlate }, note: 'Both lots READY (not dispatched); the AC2 rung assigns the same rig in the detail-plan dialog and expects the inline 409.' });
console.log('SEED_DONE');
