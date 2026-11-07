// One-off: probe unlock 779237 — read the 409 body.
const BASE = 'http://localhost:3003/api';
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await login.json();
const res = await fetch(`${BASE}/shipments/779237/unlock`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `probe-unlock-${Date.now()}` },
  body: JSON.stringify({ reason: 'SIL-693 r3 probe: mo khoa 779237 cho pricing leg UI' }),
});
console.log(res.status, (await res.text()).slice(0, 300));
const locks = await fetch(`${BASE}/shipments/779237/cost-lock-history`, { headers: { Authorization: `Bearer ${token}` } });
console.log('history', locks.status, (await locks.text()).slice(0, 400));
