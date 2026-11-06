// SIL-682 update-path driver — the dialog's "Lưu" (saveAll) flow with the
// sources-PK id space: POST /expense-accounting/entries/DRIVER/<sources-PK>/update.
// Proof target: the NATIVE driver_incidental_costs row amount actually changes
// (the review blocker: a raw-wire write keyed on the alias id would no-op).
// Usage: node driver-sil682-update.mjs <baseUrl> <sourcesPk> <expectedVersion> <amount> [idempotencyKey]
const [baseUrl, sourceId, expectedVersion, amount, idem = `sil682u-${Date.now()}`] = process.argv.slice(2);
if (!baseUrl || !sourceId || !expectedVersion || !amount) { console.error('usage: node driver-sil682-update.mjs <baseUrl> <sourcesPk> <expectedVersion> <amount> [idempotencyKey]'); process.exit(2); }

const api = `${baseUrl.replace(/\/$/, '')}/api`;
const loginRes = await fetch(`${api}/auth/login`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
});
const login = await loginRes.json();
if (!loginRes.ok) { console.error('LOGIN FAILED', loginRes.status, JSON.stringify(login)); process.exit(1); }
const token = login.token ?? login.accessToken ?? login.data?.token ?? login.data?.accessToken;
const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'Idempotency-Key': idem };

const ref = { sourceKind: 'DRIVER', sourceId: Number(sourceId), expectedVersion: Number(expectedVersion) };
const updateRes = await fetch(`${api}/expense-accounting/entries/DRIVER/${sourceId}/update`, {
  method: 'POST', headers,
  body: JSON.stringify({ expectedVersion: Number(expectedVersion), reason: 'Kế toán sửa số tiền trong xem chi tiết tiền đường (QA SIL-682 update path)', amount: Number(amount), customerChargeAmount: 0 }),
});
const updateBody = await updateRes.json().catch(() => null);
console.log(`update DRIVER sourceId=${sourceId} → amount=${amount}: HTTP ${updateRes.status}`);
console.log(JSON.stringify(updateBody));
if (updateRes.status !== 200) { console.log('UPDATE FAILED'); process.exit(1); }

const readRes = await fetch(`${api}/expense-accounting/phoi-phieu/1337/tien-duong`, { headers: { authorization: `Bearer ${token}` } });
const read = await readRes.json().catch(() => null);
const row = (read?.rows ?? [])[0];
console.log(`tien-duong row after update: amount=${row?.amount} version=${row?.version} feeName=${JSON.stringify(row?.feeName)}`);
if (row?.amount !== Number(amount)) { console.log('NATIVE AMOUNT DID NOT CHANGE — blocker reproduced'); process.exit(1); }
console.log('native row changed — update path honors the alias id');
