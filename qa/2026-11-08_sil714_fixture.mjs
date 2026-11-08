// SIL-714 fixture (rung-2 API prep): assign an external carrier to a READY
// FCL lot and issue the order with the plate deferred ('Bổ sung sau') — the
// exact server flow behind the QA1108E-EXT staging fixture. Leaves trip
// CREATED + external_plate_number NULL for the CUS UI drive.
const API = 'http://localhost:3005/api';
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
});
const { token } = await login.json();
if (!token) throw new Error('login failed');
const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

const qRaw = await (await fetch(`${API}/shipments/dispatch-queue?limit=50`, { headers: auth })).json();
const items = (qRaw.items ?? []).filter((i) => i.taskStatus === 'READY');
console.log('readyCount', qRaw.readyCount, '| raw items', (qRaw.items ?? []).length, '| ready on page', items.length);
const fcl = items.find((i) => i.cargoMode === 'FCL' && i.fulfillmentId);
if (!fcl) throw new Error('no READY FCL item on the queue');
console.log('fixture lot:', fcl.shipment?.code ?? fcl.shipmentId, 'fid', fcl.fulfillmentId, 'ver', fcl.fulfillmentVersion);

const fleet = await (await fetch(`${API}/shipments/dispatch-fleet?resource=EXTERNAL_CARRIER&limit=50`, { headers: auth })).json();
console.log('externalCarriers sample:', JSON.stringify((fleet.items ?? fleet.externalCarriers ?? []).slice(0, 4)).slice(0, 400));
const carriers = fleet.items ?? fleet.externalCarriers ?? [];
const carrier = carriers.find((c) => (c.name ?? '').includes('ĐĂNG QUÂN')) ?? carriers[0];
console.log('external carriers:', carriers.map((c) => `${c.id}:${c.name}`).join(', ') || 'NONE');
if (!carrier) throw new Error('no external carrier in fleet');

// Issue: first attempt refused with PLATE_DEFERRED_CONFIRM (warn-once),
// retry with plateDeferredConfirmed: true.
const start = new Date(Date.now() + 24 * 3600 * 1000);
start.setHours(8, 0, 0, 0);
const end = new Date(start.getTime() + 4 * 3600 * 1000);
const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString();
const body = {
  fulfillmentId: fcl.fulfillmentId,
  expectedVersion: fcl.fulfillmentVersion,
  plannedStartAt: iso(start),
  plannedEndAt: iso(end),
  endTimeConfirmed: true,
  carrierType: 'EXTERNAL',
  externalCarrierId: carrier.id,
  externalPlateNumber: null,
};
let res = await fetch(`${API}/shipments/${fcl.shipmentId}/dispatch`, {
  method: 'POST', headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify(body),
});
let out = await res.json();
console.log('issue attempt 1:', res.status, JSON.stringify(out).slice(0, 200));
if (res.status === 409 && out.code === 'PLATE_DEFERRED_CONFIRM') {
  res = await fetch(`${API}/shipments/${fcl.shipmentId}/dispatch`, {
    method: 'POST', headers: { ...auth, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ ...body, plateDeferredConfirmed: true }),
  });
  out = await res.json();
  console.log('issue attempt 2 (confirmed):', res.status, JSON.stringify(out).slice(0, 300));
}
if (res.status >= 300) throw new Error(`issue failed: ${res.status}`);
console.log(`FIXTURE OK — shipment ${fcl.shipmentCode} trip ${out.trip?.id ?? '?'} CREATED, plate deferred`);
