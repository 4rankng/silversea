// One-off: rating-class (vehicleSizeClassId) write on a COMPLETED-trip lot
// (QA also tried "rating-class TRUCK5" — both outputs must work post-fix).
const BASE = 'http://localhost:3003/api';
async function login(identifier) {
  const res = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  return body.token ?? body.accessToken;
}
async function api(token, method, path, body, key) {
  const res = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(key ? { 'Idempotency-Key': key } : {}) }, body: body && method !== 'GET' ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text: text.slice(0, 300) };
}
const admin = await login('admin');
const hoapt = await login('hoapt');
// 779237 SHP-2611-00397: COMPLETED LCL, active lock 108, unclaimed.
const unlock = await api(admin, 'POST', '/shipments/779237/unlock', { reason: 'SIL-693 QA: mo khoa rating-class path' }, `k9-u2-${Date.now()}`);
console.log('unlock', unlock.status);
const vc = await fetch(`${BASE}/vehicle-classes`, { headers: { Authorization: `Bearer ${admin}` } });
let vcId = null;
if (vc.ok) { const arr = await vc.json(); const list = Array.isArray(arr) ? arr : arr.data ?? arr.items ?? []; vcId = list[0]?.id; }
console.log('vehicleClassList', vc.status, 'firstId=', vcId);
const rev = await api(hoapt, 'POST', '/shipments/lcl/rev-class', { shipmentId: 779237, vehicleSizeClassId: vcId ?? 1 }, `k9-rev2-${Date.now()}`);
console.log('revclass-class', rev.status, rev.text);
