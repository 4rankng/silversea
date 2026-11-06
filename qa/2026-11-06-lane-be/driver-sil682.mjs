// SIL-682 driver — "Tích duyệt" chi phí lái xe from the Chi tiết tiền đường id space.
// Usage: node driver-sil682.mjs <baseUrl> <sourceId> <expectedVersion> [idempotencyKey]
// Mirrors the exact FE call (frontend/src/api/phoiPhieuClient.ts confirmPhoiPhieuTienDuong):
//   POST /expense-accounting/confirm { entries: [{ sourceKind: 'DRIVER', sourceId, expectedVersion }] }
// plus the tien-duong read the dialog renders afterwards.
const [baseUrl, sourceId, expectedVersion, idem = `sil682-${Date.now()}`] = process.argv.slice(2);
if (!baseUrl || !sourceId) { console.error('usage: node driver-sil682.mjs <baseUrl> <sourceId> <expectedVersion> [idempotencyKey]'); process.exit(2); }

const api = `${baseUrl.replace(/\/$/, '')}/api`;
const log = (...a) => console.log(...a);

const loginRes = await fetch(`${api}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
});
const login = await loginRes.json();
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status, JSON.stringify(login)); process.exit(1); }
const token = login.token ?? login.accessToken ?? login.data?.token ?? login.data?.accessToken;
if (!token) { console.error('NO TOKEN IN LOGIN RESPONSE', JSON.stringify(login).slice(0, 400)); process.exit(1); }
log(`login: 200 ketoan (ACCOUNTANT)`);

const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'Idempotency-Key': idem };

const confirmRes = await fetch(`${api}/expense-accounting/confirm`, {
  method: 'POST', headers,
  body: JSON.stringify({ entries: [{ sourceKind: 'DRIVER', sourceId: Number(sourceId), expectedVersion: Number(expectedVersion) }] }),
});
const confirmBody = await confirmRes.json().catch(() => null);
log(`confirm sourceId=${sourceId} expectedVersion=${expectedVersion}: HTTP ${confirmRes.status}`);
log(JSON.stringify(confirmBody));
if (confirmRes.status !== 200) { log('CONFIRM FAILED — defect reproduced' ); process.exit(1); }

// Trip 1337 hosts the fixture row; read the dialog payload the way the FE does.
const readRes = await fetch(`${api}/expense-accounting/phoi-phieu/1337/tien-duong`, { headers: { authorization: `Bearer ${token}` } });
const read = await readRes.json().catch(() => null);
log(`tien-duong read: HTTP ${readRes.status}`);
log(JSON.stringify(read?.rows ?? read));
log(`totals: ${JSON.stringify(read?.totals ?? read)}`);
