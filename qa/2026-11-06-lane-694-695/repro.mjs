// Lane SIL-694/695 repro driver — local dev (base 3efeffb9).
// Usage: node qa/2026-11-06-lane-694-695/repro.mjs <step>
//   sil694  — complete-external as every role on trip 520 + accountant governed close on an OWN trip
//   sil695  — issue order onto a truck holding a same-day COMPLETED trip (raw + confirmed retry)
const API = 'http://localhost:3002/api';
const PASSWORD = 'Abc123';

async function login(username) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${username} ${res.status} ${JSON.stringify(body)}`);
  return body.token;
}

async function call(token, method, path, body, extraHeaders = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep text */ }
  console.log(`[${method} ${path}] -> ${res.status}`);
  console.log(typeof parsed === 'string' ? parsed.slice(0, 600) : JSON.stringify(parsed, null, 2).slice(0, 1200));
  return { status: res.status, body: parsed };
}

const step = process.argv[2];

if (step === 'sil694') {
  const roles = [
    ['ADMIN', 'phuongnt'],
    ['MANAGER', 'giamdoc'],
    ['DISPATCHER', 'dungnv'],
    ['ACCOUNTANT', 'hoapt'],
  ];
  for (const [role, user] of roles) {
    const token = await login(user);
    console.log(`\n=== complete-external trip 520 as ${role} (${user}) ===`);
    await call(token, 'POST', '/trips/520/complete-external', {});
  }
}

if (step === 'sil695') {
  const token = await login('dungnv');
  console.log('=== fleet lookup 15H-154.26 ===');
  const fleet = await call(token, 'GET', '/shipments/dispatch-fleet?resource=TRUCK&q=15H-154.26');
  const truck = fleet.body?.items?.find((t) => t.licensePlate === '15H-154.26');
  if (!truck) throw new Error('truck 15H-154.26 not found');
  console.log(`truck ${truck.id} driver=${truck.assignedDriverId} ${truck.assignedDriverName}`);
  const [shipmentId, fulfillmentId, expectedVersion] = [Number(process.argv[3] ?? 1090), Number(process.argv[4] ?? 1273), Number(process.argv[5] ?? 1)];
  const base = {
    plannedStartAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    plannedEndAt: new Date(Date.now() + 3 * 60 * 60_000).toISOString(),
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: truck.id,
    driverId: truck.assignedDriverId,
    fulfillmentId,
    expectedVersion,
  };
  console.log(`\n=== issue shipment ${shipmentId} fulfillment ${fulfillmentId} (raw, no confirm) ===`);
  await call(token, 'POST', `/shipments/${shipmentId}/dispatch`, base);
  console.log(`\n=== issue shipment ${shipmentId} fulfillment ${fulfillmentId} (rigOverlapCompletedConfirmed: true) ===`);
  await call(token, 'POST', `/shipments/${shipmentId}/dispatch`, { ...base, rigOverlapCompletedConfirmed: true });
}
