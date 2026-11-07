// Cleanup: restore lot 779234 to a sane priced state after the v4 drive typed
// a doubled amount into the grouped NumberField (drive artifact).
// unlock → rev-class freightRevenue 3800000 (correct) → re-lock.
const BASE = 'http://localhost:3003/api';
const login = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await login.json();
const api = async (method, path, body) => {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `cleanup-${Date.now()}-${Math.random()}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, text: (await res.text()).slice(0, 160) };
};
console.log('unlock', await api('POST', '/shipments/779234/unlock', { reason: 'SIL-693 r3 cleanup: sửa giá nhập tay bị drive gõ đôi' }));
console.log('revclass', await api('POST', '/shipments/lcl/rev-class', { shipmentId: 779234, freightRevenue: 3800000, reason: 'SIL-693 r3 cleanup: giá tay đúng 3.800.000' }));
console.log('lock', await api('POST', '/shipments/779234/lock', { lockNote: 'SIL-693 r3 cleanup: khóa lại sau định giá đúng' }));
