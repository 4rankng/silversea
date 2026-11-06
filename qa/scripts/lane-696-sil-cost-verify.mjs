// Lane SIL-696 (fix/sil-cost) — direct-cost evidence probe.
// Drives the REAL local backend (PORT=3003) through the same money chain the
// QA walked on staging: driver records LIFT_FEE + TOLL on an IN_TRANSIT own
// trip, kế toán completes classification/charge and confirms both rows, then
// the trip's totalCost must carry BOTH amounts.
//
// Usage: node qa/scripts/lane-696-sil-cost-verify.mjs [--apply]
//   default: read-only dry plan (login + pick trip + show current state)
//   --apply: write driver rows, update + confirm via API, print before/after.
const API = process.env.LANE_API || 'http://localhost:3004/api';
const PASSWORD = 'Abc123';

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${identifier}: ${res.status} ${JSON.stringify(body)}`);
  return { token: body.token ?? body.accessToken, user: body.user };
}

async function call(token, method, path, payload, idempotencyKey) {
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${API}${path}`, {
    method, headers, body: payload == null ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, ok: res.ok, body };
}

const apply = process.argv.includes('--apply');
const stamp = new Date().toISOString().slice(0, 10);
const DRIVER = process.env.DRIVER || 'laixe';

const driver = await login(DRIVER);
const ketoan = await login('ketoan');
const admin = await login('admin');
console.log('logged in:', driver.user.username, ketoan.user.username, admin.user.username);

const trips = await call(driver.token, 'GET', '/driver/me/trips');
const items = trips.body?.items ?? trips.body?.trips ?? [];
const explicitId = Number(process.env.TRIP_ID ?? 0);
const trip = explicitId
  ? items.find((t) => t.id === explicitId)
  : items.find((t) => t.status === 'IN_TRANSIT' && (t.fulfillmentId ?? t.fulfillment?.id) != null);
if (!trip) throw new Error('No IN_TRANSIT trip with fulfillment for laixe: ' + JSON.stringify(items.slice(0, 3).map(t => ({ id: t.id, status: t.status, fid: t.fulfillmentId }))));
const tripId = trip.id;
const fulfillmentId = trip.fulfillmentId ?? trip.fulfillment?.id;
console.log('trip', tripId, 'fulfillment', fulfillmentId, 'code', trip.tripCode);

const before = await call(admin.token, 'GET', `/trips/${tripId}`);
if (!before.ok) throw new Error(`trip read ${before.status} ${JSON.stringify(before.body).slice(0, 300)}`);
console.log('BEFORE totalCost=', before.body.totalCost, 'tollCost=', before.body.tollCost,
  'reconciledExtraCost=', before.body.reconciledExtraCost, 'grossProfit=', before.body.grossProfit);

if (!apply) {
  console.log('dry plan complete — rerun with --apply to write driver rows and confirm.');
  process.exit(0);
}

// 1) Driver records the two claims (QA shape: lift 175k, toll 135k).
// Cost rows demand a receipt photo — upload one tiny PNG per row first.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
async function uploadReceipt(tripId, tag) {
  const form = new FormData();
  form.append('file', new Blob([png], { type: 'image/png' }), `receipt-${tag}.png`);
  form.append('trip_id', String(tripId));
  form.append('type', 'OTHER');
  const res = await fetch(`${API}/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${driver.token}`, 'Idempotency-Key': `lane696-receipt-${tripId}-${tag}-${stamp}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`upload ${tag}: ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.storageKey;
}
const rows = [
  { costType: 'LIFT_FEE', amount: 175000, occurredAt: stamp, feeName: 'Phí nâng container QA-696' },
  { costType: 'TOLL', amount: 135000, occurredAt: stamp, feeName: 'Vé cầu đường QA-696' },
];
for (const [i, row] of rows.entries()) {
  row.receiptStorageKey = await uploadReceipt(tripId, row.costType.toLowerCase());
  const r = await call(driver.token, 'POST', `/driver/me/trips/${tripId}/incidental-costs`, row,
    `lane696-${tripId}-${row.costType}-${stamp}`);
  console.log('driver row', row.costType, r.status, JSON.stringify(r.body).slice(0, 200));
  if (!r.ok) throw new Error(`incidental ${row.costType} failed`);
}

// 2) Kế toán opens the dialog data, completes classification + charge, confirms.
const tienDuong = await call(ketoan.token, 'GET', `/expense-accounting/phoi-phieu/${tripId}/tien-duong`);
if (!tienDuong.ok) throw new Error(`tien-duong ${tienDuong.status} ${JSON.stringify(tienDuong.body).slice(0, 300)}`);
const entries = tienDuong.body?.rows ?? tienDuong.body?.entries ?? tienDuong.body?.items ?? [];
console.log('tien-duong rows:', JSON.stringify(entries).slice(0, 900));

const targets = entries.filter((e) => (e.feeName ?? '').includes('QA-696'));
if (targets.length !== 2) throw new Error('expected the two QA-696 rows, got ' + targets.length);

for (const t of targets) {
  const nativeId = t.sourceId;
  const costType = t.costType;
  const kind = t.sourceKind ?? 'DRIVER';
  const isToll = costType === 'TOLL';
  const upd = await call(ketoan.token, 'POST', `/expense-accounting/entries/${kind}/${nativeId}/update`, {
    expectedVersion: t.version,
    reason: 'SIL-696 lane: hoàn thiện phân loại + khoản thu khách trước đối chiếu',
    costGroup: isToll ? 'DRIVER_ROAD' : 'DRIVER_SHIPMENT',
    customerChargeAmount: isToll ? 0 : 175000,
  }, `lane696-upd-${tripId}-${nativeId}-v${t.version}`);
  console.log('update', nativeId, costType, upd.status, JSON.stringify(upd.body).slice(0, 240));
  if (!upd.ok) throw new Error('update failed for row ' + nativeId);
}

const refIds = targets.map((t) => ({ sourceKind: t.sourceKind ?? 'DRIVER', sourceId: t.sourceId, expectedVersion: t.version + 1 }));
const conf = await call(ketoan.token, 'POST', '/expense-accounting/confirm', { entries: refIds }, `lane696-confirm-${tripId}-${stamp}`);
console.log('confirm', conf.status, JSON.stringify(conf.body).slice(0, 300));
if (!conf.ok) throw new Error('confirm failed');

// 3) Direct-cost assertion: BOTH amounts must ride the trip.
const after = await call(admin.token, 'GET', `/trips/${tripId}`);
const beforeTotal = Number(before.body.totalCost ?? 0);
const afterTotal = Number(after.body.totalCost ?? 0);
const storedTollBefore = Number(before.body.tollCost ?? 0);
const expectedDelta = 175000 + (135000 - storedTollBefore);
console.log('AFTER  totalCost=', after.body.totalCost, 'tollCost=', after.body.tollCost,
  'reconciledExtraCost=', after.body.reconciledExtraCost, 'grossProfit=', after.body.grossProfit);
console.log('delta=', afterTotal - beforeTotal, 'expected>=', expectedDelta);
if (afterTotal - beforeTotal !== expectedDelta) {
  throw new Error(`direct cost mismatch: delta ${afterTotal - beforeTotal} != ${expectedDelta}`);
}
if (Number(after.body.reconciledExtraCost ?? 0) !== 175000) throw new Error('reconciledExtraCost != 175000');
console.log('SIL-696 API VERIFIED: lift 175k + toll 135k both landed in trip direct cost.');
