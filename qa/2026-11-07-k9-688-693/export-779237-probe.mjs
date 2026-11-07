// One-off: export 779237 via API — final-state proof after the UI chain.
const BASE = 'http://localhost:3003/api';
const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await res.json();
const exp = await fetch(`${BASE}/shipments/debit-notes`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `k9-final-779237-${Date.now()}` },
  body: JSON.stringify({ shipmentIds: [779237] }),
});
const text = await exp.text();
console.log('export', exp.status, text.slice(0, 200));
