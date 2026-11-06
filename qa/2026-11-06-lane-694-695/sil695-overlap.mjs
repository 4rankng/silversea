// SIL-695 repro round 2 — issue with an OVERLAPPING window vs the same-day COMPLETED trip.
const API = 'http://localhost:3002/api';
const PASSWORD = 'Abc123';

const login = async (username) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: PASSWORD }),
  });
  return (await res.json()).token;
};

const token = await login('dungnv');
const fleet = await fetch(`${API}/shipments/dispatch-fleet?resource=TRUCK&q=15H-154.26`, { headers: { Authorization: `Bearer ${token}` } });
const truck = (await fleet.json()).items.find((t) => t.licensePlate === '15H-154.26');

const todayIct = (hh, mm) => {
  const now = new Date();
  const ictOffset = 7 * 60;
  const utcMidnightIct = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - ictOffset * 60_000);
  return new Date(utcMidnightIct.getTime() + (hh * 60 + mm) * 60_000);
};

const base = {
  plannedStartAt: todayIct(3, 0).toISOString(), // inside the COMPLETED trip's 02:00–06:00 window
  plannedEndAt: todayIct(7, 0).toISOString(),
  endTimeConfirmed: true,
  carrierType: 'OWN',
  truckId: truck.id,
  driverId: truck.assignedDriverId,
  fulfillmentId: Number(process.argv[3] ?? 1275),
  expectedVersion: Number(process.argv[4] ?? 2),
};
const shipmentId = Number(process.argv[2] ?? 1092);
const key = crypto.randomUUID();

const post = (body) => fetch(`${API}/shipments/${shipmentId}/dispatch`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
  body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json() }));

console.log(`=== raw issue shipment ${shipmentId} f${base.fulfillmentId} window 03:00-07:00 ICT ===`);
console.log(JSON.stringify(await post(base)));
console.log(`=== confirmed retry (rigOverlapCompletedConfirmed) SAME Idempotency-Key ===`);
console.log(JSON.stringify(await post({ ...base, rigOverlapCompletedConfirmed: true })));
