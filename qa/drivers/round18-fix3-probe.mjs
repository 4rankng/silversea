// Round-18 FIX 3 probe: which save surface lets a same-window rig/driver
// double-booking through SILENTLY? Direct trip create (POST /trips) with
// (a) same tractor different driver, (b) same driver DIFFERENT tractor,
// (c) same tractor same driver (the pinned rig warn).
const API = 'http://localhost:3002/api';

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed ${res.status}`);
  return (await res.json()).token;
};

const createTrip = async (token, body) => {
  const res = await fetch(`${API}/trips`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, code: json.code ?? json.payload?.code ?? null, message: json.message ?? json.error ?? null, id: json.id ?? null };
};

const run = async () => {
  const token = await login('admin');
  const day = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10); // +2 days, avoids today's noise
  const base = { customerId: 1, routeId: 1, cargoTypeId: 199, departureDate: day, containerCount: 1, containerTypeId: 2232 };

  const cleanup = [];
  const report = async (label, body) => {
    const r = await createTrip(token, body);
    if (r.id) cleanup.push(r.id);
    console.log(`${label}: status=${r.status} code=${r.code} id=${r.id} msg=${String(r.message).slice(0, 90)}`);
    return r;
  };

  // Baseline holder: truck 1 + driver 1 on `day`.
  await report('baseline truck1+driver1', { ...base, truckId: 1, driverId: 1 });
  // (a) same tractor, other driver -> rig warn expected.
  await report('same tractor (t1) +driver5', { ...base, truckId: 1, driverId: 5 });
  // (b) DIFFERENT tractor, SAME driver -> driver-overlap probe.
  const b = await report('other tractor (t2) +driver1', { ...base, truckId: 2, driverId: 1 });

  console.log(b.status === 201 || b.status === 200 ? '\nRESULT: the driver double-booking across tractors SAVED (status ' + b.status + ') — silent path confirmed' : '\nRESULT: driver overlap refused/warned');

  // cleanup
  for (const id of cleanup) {
    await fetch(`${API}/trips/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  }
  console.log('cleanup:', cleanup.join(','), 'deleted');
};

run().catch((e) => { console.error(e); process.exit(1); });
