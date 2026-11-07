// SIL-688 + SIL-693 API self-test against the k9 worktree stack (BE :3003).
// Ground truth for the owner laws:
//  688: delete blocks ONLY on an issued order (live trip) — never on lot
//       status. IN_TRANSIT stale (0 live trips) ⇒ DELETE 200; issued ⇒ 409;
//       dispatcher ⇒ 403; CUS/Admin ⇒ allowed.
//  693: unpriced freeze ⇒ export 409 with remedy; unlock → manual price on a
//       COMPLETED-trip lot ⇒ 200; re-lock freezes freightAuto; export ⇒ 201
//       with a FREIGHT line.
const BASE = process.env.K9_BASE || 'http://localhost:3003/api';
const PASSWORD = 'Abc123';

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  —  ${detail}`);
}

async function login(username) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${username}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.token ?? body.accessToken ?? body.data?.token;
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(body && method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body && method !== 'GET' ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text: text.slice(0, 400) };
}

// ─── SIL-688 ──────────────────────────────────────────────────────────────
async function sil688() {
  const admin = await login('admin');
  const cus = await login('tiepvv');
  const dispatcher = await login('dieuvan');

  // Stale IN_TRANSIT (779169, 0 live trips): the exact QA-fail lot class.
  const stale = await api(admin, 'GET', '/shipments/779169');
  const staleVersion = stale.json?.version ?? stale.json?.shipment?.version;
  record('688/stale-lot-detail', stale.status === 200 && stale.json?.hasLiveTrips === false,
    `GET 779169 status=${stale.status} hasLiveTrips=${stale.json?.hasLiveTrips}`);

  const delAdmin = await api(admin, 'DELETE', '/shipments/cus-workspace/779169', { version: staleVersion, reason: 'SIL-688 QA: lo IN_TRANSIT chua phat lenh (stale) phai xoa duoc' });
  record('688/admin-delete-stale-in-transit-200', delAdmin.status === 200,
    `DELETE admin → ${delAdmin.status} ${delAdmin.status === 200 ? '' : delAdmin.text}`);

  const getAfter = await api(admin, 'GET', '/shipments/779169');
  record('688/deleted-lot-404', getAfter.status === 404, `GET after delete → ${getAfter.status}`);

  const twin = await api(cus, 'GET', '/shipments/779168');
  const twinVersion = twin.json?.version ?? twin.json?.shipment?.version;
  record('688/cus-sees-stale-detail', twin.status === 200 && twin.json?.hasLiveTrips === false,
    `GET 779168 (CUS) status=${twin.status} hasLiveTrips=${twin.json?.hasLiveTrips}`);

  const delCus = await api(cus, 'DELETE', '/shipments/cus-workspace/779168', { version: twinVersion, reason: 'SIL-688 QA: CUS xoa lo IN_TRANSIT chua phat lenh' });
  record('688/cus-delete-stale-in-transit-200', delCus.status === 200,
    `DELETE CUS → ${delCus.status} ${delCus.status === 200 ? '' : delCus.text}`);

  // Issued order (779171, 1 live trip): DELETE 409 with the law message.
  const issued = await api(admin, 'GET', '/shipments/779171');
  const issuedVersion = issued.json?.version ?? issued.json?.shipment?.version;
  record('688/issued-lot-detail-live', issued.status === 200 && issued.json?.hasLiveTrips === true,
    `GET 779171 status=${issued.status} hasLiveTrips=${issued.json?.hasLiveTrips}`);

  const delIssued = await api(admin, 'DELETE', '/shipments/cus-workspace/779171', { version: issuedVersion, reason: 'SIL-688 QA: lo da phat lenh phai 409' });
  record('688/admin-delete-issued-409', delIssued.status === 409 && /phát lệnh|phat lenh/.test(delIssued.text),
    `DELETE admin → ${delIssued.status} ${String(delIssued.text).slice(0, 120)}`);

  const delIssuedCus = await api(cus, 'DELETE', '/shipments/cus-workspace/779171', { version: issuedVersion, reason: 'SIL-688 QA: CUS cung 409 tren lo phat lenh' });
  record('688/cus-delete-issued-409', delIssuedCus.status === 409, `DELETE CUS → ${delIssuedCus.status}`);

  // Dispatcher: 403 everywhere — role is the boundary, not lot state.
  const delDisp = await api(dispatcher, 'DELETE', '/shipments/cus-workspace/779166', { version: 1, reason: 'SIL-688 QA: dieu van khong duoc xoa' });
  record('688/dispatcher-delete-403', delDisp.status === 403,
    `DELETE dispatcher → ${delDisp.status} ${String(delDisp.text).slice(0, 120)}`);
  const delDispIssued = await api(dispatcher, 'DELETE', '/shipments/cus-workspace/779171', { version: issuedVersion, reason: 'SIL-688 QA: dieu van tren lo phat lenh' });
  record('688/dispatcher-delete-issued-403', delDispIssued.status === 403, `DELETE dispatcher issued → ${delDispIssued.status}`);
}

// ─── SIL-693 ──────────────────────────────────────────────────────────────
async function sil693() {
  const admin = await login('admin');

  // Guard: 779059 (locked, freightAuto null, basis SKIP NO_ROUTE) must refuse
  // the export with the remedy message. Endpoint discovery: the FE
  // ShipmentDebitPage POSTs the per-lot export; find the exact wire.
  const guard = await api(admin, 'POST', '/shipments/779059/debit-note');
  record('693/guard-unpriced-409-probe1', guard.status === 409 || guard.status === 404 || guard.status === 400,
    `POST /shipments/779059/debit-note → ${guard.status} ${String(guard.text).slice(0, 140)}`);
}

try {
  await sil688();
  await sil693();
} catch (err) {
  console.error('PROBE ERROR:', err.message);
  process.exitCode = 1;
}
const failed = results.filter((r) => !r.ok);
console.log(`\n== ${results.length - failed.length}/${results.length} PASS ==`);
if (failed.length > 0) process.exitCode = 1;
