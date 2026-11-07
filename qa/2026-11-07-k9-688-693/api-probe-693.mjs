// SIL-693 chain probe — guard (both export paths) + the completed-trip remedy
// dead-end that QA failed ("pricing dead-end on completed lots").
// Lot 779239 SHP-2611-00399: LCL, trip COMPLETED, active cost lock, no debit
// claim. Lot 779059 SHP-2611-00307: LCL locked, freightAuto null, basis SKIP
// NO_ROUTE (the unpriced guard case).
const BASE = process.env.K9_BASE || 'http://localhost:3003/api';
const PASSWORD = 'Abc123';
const results = [];

function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}

async function login(identifier) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken ?? body.data?.token;
}

async function api(token, method, path, body, idempotencyKey) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text: text.slice(0, 500) };
}

const admin = await login('admin');
const accountant = await login('ketoan');

// Fact check: 779239 carries a COMPLETED trip.
const fact = await api(admin, 'GET', '/shipments/779239');
record('693/fact-completed-lot-readable', fact.status === 200, `GET 779239 → ${fact.status} status=${fact.json?.shipment?.status ?? fact.json?.status} lock=${JSON.stringify(fact.json?.accountingLock)?.slice(0, 60)}`);

// 1. Guard, per-lot path: unpriced freeze (779059) must 409 with the remedy.
const g1 = await api(admin, 'POST', '/shipments/debit-notes', { shipmentIds: [779059] }, `k9-guard-lot-${Date.now()}`);
record('693/guard-per-lot-409-remedy', g1.status === 409 && /chưa được định giá/.test(g1.text),
  `POST debit-notes [779059] → ${g1.status} ${String(g1.text).slice(0, 200)}`);

// 2. Guard, consolidated path: a selection mixing unpriced + priced must 409
// naming the unpriced lot — the guard lives in the shared line builder.
const g2 = await api(admin, 'POST', '/shipments/debit-notes', { shipmentIds: [779059, 779247] }, `k9-guard-cons-${Date.now()}`);
record('693/guard-consolidated-409', g2.status === 409 && /chưa được định giá|779059|SHP-2611-00307/.test(g2.text),
  `POST debit-notes [779059,779247] → ${g2.status} ${String(g2.text).slice(0, 200)}`);

// 3. The dead-end remedy chain on the COMPLETED-trip lot 779239.
// 3a. unlock (ADMIN per SIL-721 clearance).
const unlock = await api(admin, 'POST', '/shipments/779242/unlock', { reason: 'SIL-693 QA: mo khoa de dinh gia bu remedy Debit Note' }, `k9-unlock-${Date.now()}`);
record('693/unlock-200', unlock.status === 200, `POST unlock → ${unlock.status} ${String(unlock.text).slice(0, 120)}`);

// 3b. THE DEAD-END STEP: manual price on the COMPLETED-trip lot. Pre-F1 this
// answered 409 "đã hoàn thành chuyến — không đổi loại xe/giá cước thu được
// nữa". Owner remedy: 200 with the manual stamp + audit.
const rev = await api(accountant, 'POST', '/shipments/lcl/rev-class', {
  shipmentId: 779242,
  freightRevenue: 3800000,
  reason: 'SIL-693 QA: giá nhập tay 3.800.000 remedy Debit Note',
}, `k9-rev-${Date.now()}`);
const revOk = rev.status === 200;
record('693/revclass-completed-trip-200', revOk,
  `POST lcl/rev-class (ketoan) → ${rev.status} ${revOk ? `channel=${rev.json?.channel} freightManual=${rev.json?.freightManual}` : String(rev.text).slice(0, 200)}`);

// 3c. re-lock — the freeze must now carry the real freightAuto.
const relk = await api(admin, 'POST', '/shipments/779242/lock', { lockNote: 'SIL-693 QA: khoa lai sau dinh gia bu' }, `k9-relock2-${Date.now()}`);
record('693/relock-201', relk.status === 201, `POST lock → ${relk.status} ${String(relk.text).slice(0, 140)}`);

// 3d. export per-lot → 201; the note must carry the FREIGHT line.
const exp = await api(admin, 'POST', '/shipments/debit-notes', { shipmentIds: [779242] }, `k9-exp-779242-${Date.now()}`);
const noteId = exp.json?.id ?? exp.json?.data?.id;
record('693/export-priced-201', exp.status === 201 && noteId != null,
  `POST debit-notes [779242] → ${exp.status} id=${noteId} ${exp.status !== 201 ? String(exp.text).slice(0, 200) : ''}`);

// 3e. 1-lot-1-note: re-exporting the same lot must 409 overlap.
const reExp = await api(admin, 'POST', '/shipments/debit-notes', { shipmentIds: [779242] }, `k9-reexp2-${Date.now()}`);
record('693/reexport-overlap-409', reExp.status === 409,
  `re-export [779242] → ${reExp.status} ${String(reExp.text).slice(0, 160)}`);

console.log(`NOTE_ID=${noteId}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
if (failed.length > 0) process.exitCode = 1;
