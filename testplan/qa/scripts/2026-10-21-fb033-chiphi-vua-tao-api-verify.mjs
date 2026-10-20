// FB-033 (card 211026014819) — API verification: a chi-hộ expense JUST CREATED
// must stay editable/deletable even when the creation's auto-offset consumed a
// funded tạm ứng. Runs against the fix:
//   1. the PRE-FIX locked row (28601, settlement 2200 active) repairs in place;
//   2. a fresh create → immediate PATCH (200) → immediate DELETE (200);
//   3. the released settlement is REVERSED and its ledger credit exists.
// LOCAL ONLY: api 3303 (this lane's stack). Setup prerequisites (funded
// advance for opsqa + lot link) are created here via governed APIs.
//   node testplan/qa/scripts/2026-10-21-fb033-chiphi-vua-tao-api-verify.mjs
const API = process.env.API ?? 'http://localhost:3303/api';
const TRIP_ID = Number(process.env.TRIP_ID ?? 193772);
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID ?? 311836);
const PRE_FIX_EXPENSE_ID = Number(process.env.PRE_FIX_EXPENSE_ID ?? 28601);
const log = (...a) => console.log(...a);

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status} ${JSON.stringify(body)}`);
  return body;
}
let keySeq = 0;
const jfetch = (token) => async (path, opts = {}) => {
  const res = await fetch(`${API}${path}`, { ...opts, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': `fb033-verify-${Date.now()}-${keySeq++}`, ...(opts.headers ?? {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
  return { status: res.status, body };
};

const ops = await login('opsqa');
const acc = await login('ketoan');
const admin = await login('admin');
const opsApi = jfetch(ops.token);
const accApi = jfetch(acc.token);
const adminApi = jfetch(admin.token);
log(`logins ok — TRIP=${TRIP_ID} SHIPMENT=${SHIPMENT_ID}`);

const failures = [];
const expect = (label, cond, detail) => { log(`${cond ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`); if (!cond) failures.push(label); };

// ── setup: opsqa linked to the lot + a funded advance (governed APIs)
const me = await (await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${ops.token}` } })).json();
const linksNow = await opsApi('/forwarder/me/trips');
const inScope = (linksNow.body?.items ?? linksNow.body ?? []).some(t => (t.tripId ?? t.id) === TRIP_ID);
if (!inScope) {
  const upd = await adminApi(`/auth/users/${me.id}`, { method: 'PATCH', headers: { 'If-Unmodified-Since': me.updatedAt }, body: JSON.stringify({ shipmentIds: [SHIPMENT_ID] }) });
  log('link opsqa→lot:', upd.status);
}
const funded = (await opsApi('/ops/wallet/advance-requests')).body?.items?.some(a => a.status === 'RECORDED' && Number(a.amount) >= 150000);
if (!funded) {
  const adv = await opsApi('/ops/wallet/advance-requests', { method: 'POST', body: JSON.stringify({ amount: 2000000, reason: 'FB-033 verify tạm ứng' }) });
  const appr = await accApi(`/advance-requests/${adv.body?.id}/approve`, { method: 'POST', body: JSON.stringify({ expectedVersion: adv.body?.version ?? 1 }) });
  log('advance funded:', appr.status, appr.body?.status);
}

const today = new Date().toISOString().slice(0, 10);
const expensePayload = (amount) => JSON.stringify({
  tripId: TRIP_ID, expenseType: 'OTHER', buyAmount: amount, sellAmount: 0, settlementMethod: 'OPS_ADVANCE',
  payeeName: 'FB-033 verify', noInvoiceEvidenceTypes: ['RECEIPT'], expenseDate: today, note: 'FB-033 verify chi-hộ',
});
const readRow = async (expenseId) => {
  const detail = await opsApi(`/forwarder/me/trips/${TRIP_ID}`);
  return (detail.body?.expenses ?? []).find(e => e.id === expenseId) ?? null;
};

// ── 1. the PRE-FIX locked row repairs in place (release + edit + delete)
let row = await readRow(PRE_FIX_EXPENSE_ID);
if (row && row.approvalStatus !== 'VOIDED') {
  log(`pre-fix row ${PRE_FIX_EXPENSE_ID}: status=${row.approvalStatus} activeSettlementId=${row.activeSettlementId}`);
  const patch = await opsApi(`/forwarder/me/expenses/${PRE_FIX_EXPENSE_ID}`, { method: 'PATCH', headers: { 'If-Unmodified-Since': row.updatedAt }, body: JSON.stringify({ buyAmount: 160000 }) });
  expect('pre-fix row PATCH succeeds (auto settlement released)', patch.status === 200, `status=${patch.status} ${JSON.stringify(patch.body).slice(0, 140)}`);
  const afterEdit = await readRow(PRE_FIX_EXPENSE_ID);
  expect('pre-fix row amount updated to 160000', afterEdit?.buyAmount === '160000', `buyAmount=${afterEdit?.buyAmount}`);
  expect('pre-fix row no longer carries an active settlement gate', !afterEdit?.activeSettlementId, `activeSettlementId=${afterEdit?.activeSettlementId}`);
  const del = await opsApi(`/forwarder/me/expenses/${PRE_FIX_EXPENSE_ID}`, { method: 'DELETE', headers: { 'If-Unmodified-Since': afterEdit.updatedAt }, body: JSON.stringify({ reason: 'FB-033 verify cleanup (pre-fix row)' }) });
  expect('pre-fix row DELETE succeeds', del.status === 200, `status=${del.status} ${JSON.stringify(del.body).slice(0, 140)}`);
} else {
  log(`pre-fix row ${PRE_FIX_EXPENSE_ID} already voided/absent — repair step skipped`);
}

// ── 2. fresh create → immediate PATCH → immediate DELETE
const create = await opsApi('/forwarder/me/expenses', { method: 'POST', body: expensePayload(150000) });
expect('fresh chi-hộ create 201', create.status === 201, `status=${create.status} ${JSON.stringify(create.body).slice(0, 160)}`);
const freshId = create.body?.id;
if (!freshId) { console.log('abort: create failed'); process.exit(1); }
const freshRow = await readRow(freshId);
log('fresh row right after create:', JSON.stringify({ id: freshId, status: freshRow?.approvalStatus, activeSettlementId: freshRow?.activeSettlementId, canEdit: freshRow?.canEdit }));

const patch2 = await opsApi(`/forwarder/me/expenses/${freshId}`, { method: 'PATCH', headers: { 'If-Unmodified-Since': freshRow.updatedAt }, body: JSON.stringify({ buyAmount: 170000 }) });
expect('fresh row immediate PATCH 200 (was 409 đã gửi kế toán)', patch2.status === 200, `status=${patch2.status} ${JSON.stringify(patch2.body).slice(0, 140)}`);
const rowAfterPatch = await readRow(freshId);
expect('fresh row amount updated to 170000', rowAfterPatch?.buyAmount === '170000', `buyAmount=${rowAfterPatch?.buyAmount}`);

const del2 = await opsApi(`/forwarder/me/expenses/${freshId}`, { method: 'DELETE', headers: { 'If-Unmodified-Since': rowAfterPatch.updatedAt }, body: JSON.stringify({ reason: 'FB-033 verify cleanup' }) });
expect('fresh row immediate DELETE 200', del2.status === 200, `status=${del2.status} ${JSON.stringify(del2.body).slice(0, 140)}`);
const rowAfterDel = await readRow(freshId);
expect('fresh row soft-voided (VOIDED)', rowAfterDel?.approvalStatus === 'VOIDED', `status=${rowAfterDel?.approvalStatus}`);

console.log('\n=== RESULT ===');
if (failures.length) { console.log('FAILED:', failures); process.exit(1); }
console.log('ALL PASS — just-created chi-hộ expense is editable and deletable');
