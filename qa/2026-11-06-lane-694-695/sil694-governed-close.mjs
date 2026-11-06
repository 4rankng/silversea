// SIL-694 governed financial close probe — POST /trips/:id/complete as each role.
const API = 'http://localhost:3002/api';
const PASSWORD = 'Abc123';
const tripId = Number(process.argv[2] ?? 1308);

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

async function call(token, method, path, body, version) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  console.log(`[${method} ${path}] -> ${res.status} :: ${text.slice(0, 400)}`);
  return { status: res.status, body: text };
}

const roles = [
  ['ADMIN', 'phuongnt'],
  ['MANAGER', 'giamdoc'],
  ['DISPATCHER', 'dungnv'],
  ['ACCOUNTANT', 'hoapt'],
];
for (const [role, user] of roles) {
  const token = await login(user);
  // Read the trip first for a fresh expectedVersion.
  const res = await fetch(`${API}/trips/${tripId}`, { headers: { Authorization: `Bearer ${token}` } });
  const trip = await res.json().catch(() => ({}));
  console.log(`\n=== governed close trip ${tripId} as ${role} (${user}) version=${trip.version} status=${trip.status} ===`);
  await call(token, 'POST', `/trips/${tripId}/complete`, {
    expectedVersion: trip.version,
    governanceReason: 'QA lane repro SIL-694',
  });
}
