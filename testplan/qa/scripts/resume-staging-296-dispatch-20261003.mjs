// Continuation: take the already-created fixture lot 296 through handoff ->
// dispatch queue -> dispatch -> phoi-phieu verification (2026-10-03, be2).
import { writeFileSync } from 'fs';
import crypto from 'crypto';

const API = process.env.API_URL || 'https://vantai.tingting.vip/api';
const IDENTIFIER = process.env.IDENTIFIER || 'admin';
const PASSWORD = process.env.PASSWORD || 'Abc123';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 296);
const LOG = 'qa/2026-10-03_311-fixtures/seed.log';

const lines = [];
const log = (s, extra) => {
  const line = extra === undefined ? s : `${s} ${JSON.stringify(extra)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOG, lines.join('\n') + '\n');
};

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const { token } = await login.json();
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

// Handoff: reuse the lot's OPEN handoff when present (one active per
// shipment — creating again 409s), else create; then resolve ACCEPTED.
let handoffId = null;
let handoffVersion = null;
if (process.env.HANDOFF_ID) {
  handoffId = Number(process.env.HANDOFF_ID);
  handoffVersion = Number(process.env.HANDOFF_VERSION ?? 1);
  log('handoff pinned by env', { handoffId, handoffVersion });
}
const existing = handoffId == null ? await api('GET', '/shipments/dispatch-handoffs?limit=100') : { status: 200, body: { items: [] } };
if (existing.status === 200) {
  const mine = (existing.body.items ?? existing.body ?? []).find((h) => h.shipmentId === SHIPMENT_ID);
  if (mine) {
    handoffId = mine.handoffId ?? mine.id;
    handoffVersion = mine.version ?? mine.handoffVersion ?? 1;
    log('handoff reused', { handoffId, handoffVersion, status: mine.status });
  }
}
if (handoffId == null) {
  const handoff = await api('POST', `/shipments/${SHIPMENT_ID}/dispatch-handoffs`, { urgency: 'NORMAL' });
  if (handoff.status !== 201 && handoff.status !== 200) throw new Error(`handoff failed: ${handoff.status} ${JSON.stringify(handoff.body)}`);
  handoffId = handoff.body.handoff?.id ?? handoff.body.id;
  handoffVersion = handoff.body.handoff?.version ?? handoff.body.version ?? 1;
  log('handoff created', { handoffId, handoffVersion });
}
// The handoff resolve requires a planned carrier per container: assign the
// container line's carrierType = OWN before resolving.
const detail = await api('GET', `/shipments/cus-workspace/${SHIPMENT_ID}`);
if (detail.status !== 200) throw new Error(`detail failed: ${detail.status}`);
const containerId = detail.body.containers?.[0]?.id;
const shipmentVersion = detail.body.summary?.version ?? detail.body.version ?? 1;
if (containerId == null) throw new Error('no container on fixture lot');
const lineUpdate = await api('POST', `/shipments/cus-workspace/${SHIPMENT_ID}/containers/${containerId}`, {
  expectedShipmentVersion: shipmentVersion,
  carrierType: 'OWN',
});
if (lineUpdate.status !== 200 && lineUpdate.status !== 201) throw new Error(`carrier assign failed: ${lineUpdate.status} ${JSON.stringify(lineUpdate.body)}`);
log('planned carrier assigned', { containerId, carrierType: 'OWN' });

const resolved = await api('POST', `/shipments/${SHIPMENT_ID}/dispatch-handoffs/${handoffId}/resolve`, {
  resolution: 'ACCEPTED',
  expectedVersion: handoffVersion,
});
if (resolved.status !== 200 && resolved.status !== 201) throw new Error(`resolve failed: ${resolved.status} ${JSON.stringify(resolved.body)}`);
log('handoff accepted', { handoffId });

const queue = await api('GET', `/shipments/dispatch-queue?status=READY&limit=50`);
if (queue.status !== 200) throw new Error(`queue failed: ${queue.status}`);
const item = queue.body.items.find((q) => q.shipmentId === SHIPMENT_ID);
if (!item) throw new Error('own lot not in dispatch queue after handoff');
log('queue item', { fulfillmentId: item.fulfillmentId, fulfillmentVersion: item.fulfillmentVersion, handoffId: item.handoffId });

const fleet = await api('GET', '/shipments/dispatch-fleet?resource=TRUCK');
if (fleet.status !== 200) throw new Error(`fleet failed: ${fleet.status}`);
const rig = fleet.body.items.find((t) => (t.driverId != null && t.trailerId != null) || (t.truckId != null && t.driverId != null)) ?? fleet.body.items[0];
if (!rig) throw new Error('no staging rig');
log('rig', { truckId: rig.truckId, trailerId: rig.trailerId ?? rig.currentTrailerId ?? null, driverId: rig.driverId });

const now = new Date();
const start = new Date(now.getTime() + 24 * 3600_000);
const end = new Date(start.getTime() + 4 * 3600_000);
const dispatched = await api('POST', `/shipments/${SHIPMENT_ID}/dispatch`, {
  fulfillmentId: item.fulfillmentId,
  expectedVersion: item.fulfillmentVersion,
  plannedStartAt: start.toISOString(),
  plannedEndAt: end.toISOString(),
  endTimeConfirmed: true,
  carrierType: 'OWN',
  truckId: rig.truckId ?? null,
  driverId: rig.driverId ?? null,
  trailerId: rig.trailerId ?? rig.currentTrailerId ?? null,
});
if (dispatched.status !== 201 && dispatched.status !== 200) throw new Error(`dispatch failed: ${dispatched.status} ${JSON.stringify(dispatched.body)}`);
const tripId = dispatched.body.trip?.id;
log('dispatched', { tripId, tripCode: dispatched.body.trip?.tripCode });

const day = (d) => d.toISOString().slice(0, 10);
const rows = await api('GET', `/expense-accounting/phoi-phieu/rows?dateFrom=${day(now)}&dateTo=${day(new Date(now.getTime() + 7 * 86400_000))}&limit=200`);
const list = Array.isArray(rows.body) ? rows.body : rows.body?.items ?? [];
const row = list.find((r) => r.tripId === tripId);
log('phoi-phieu row', { reportStatus: rows.status, found: Boolean(row), chiHoActionAvailable: Boolean(row) });

log('HANDOFF', {
  lot: { shipmentId: SHIPMENT_ID, bl: 'QA268QA292-20261003101900', container: 'QATU9510004', factory: 'ASKEY-1 (site 5)' },
  trip: { tripId, tripCode: dispatched.body.trip?.tripCode },
  marker: 'QA268-QA292-FIXTURE 2026-10-03',
  qa268: 'EDIT lot (create/update workspace) -> factory cell shows ASKEY-1 + info button -> popover (address + invoice group if present).',
  qa292: '/accounting/phoi-phieu, date window above -> the row "Chi tiết chi hộ" opens the dialog on this trip (fee rows appear once a driver phoi submission lands on the trip).',
});
console.log('RESUME_DONE');
