// Lane G1 (fix/g1-unlock-roaddcost-opssave) — API evidence for SIL-721 + SIL-722.
// SIL-721: unlock + cost-lock-history open to Quản trị (ADMIN) · Giám đốc
//   (MANAGER, the role 'giamdoc' holds) · Kế toán (ACCOUNTANT); other roles
//   stay 403. Reason stays mandatory; audit + history trail intact.
// SIL-722: an approved (confirmed) ROAD_ALLOWANCE claim enters trips.totalCost
//   exactly (+80.000₫ on the drive trip), via the SIL-696 reconciled path.
//
// Usage: node qa/scripts/lane-g1-sil721-722-verify.mjs
//   LOT_ID env: a currently-LOCKED lot id (end state is restored to locked).
//   TRIP_ID env optional: pin the SIL-722 drive trip (else auto-pick).
const API = process.env.LANE_API || 'http://localhost:3014/api';
const PASSWORD = 'Abc123';
const STAMP = new Date().toISOString().slice(0, 10);
const OUT = process.env.EVIDENCE || 'qa/2026-11-07-lane-g1';
const fs = await import('node:fs');
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};

async function login(identifier) {
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: PASSWORD }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && body?.token) return body;
    await new Promise(r => setTimeout(r, 1200 * i));
  }
  throw new Error(`LOGIN FAILED: ${identifier}`);
}

async function call(token, method, path, payload, idempotencyKey) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const res = await fetch(`${API}${path}`, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { ok: res.ok, status: res.status, body };
}

const admin = await login('admin');
const ketoan = await login('ketoan');
const giamdoc = await login('giamdoc');
const dieuvan = await login('dieuvan');
say(`logged in: ${admin.user.username}/${admin.user.role} ${ketoan.user.username}/${ketoan.user.role} ${giamdoc.user.username}/${giamdoc.user.role} ${dieuvan.user.username}/${dieuvan.user.role}`);

// ─── SIL-721: unlock + history across roles ─────────────────────────────────
const LOT_ID = Number(process.env.LOT_ID ?? 0);
if (!LOT_ID) throw new Error('LOT_ID env required (a currently-locked lot)');
say(`\nSIL-721 on lot ${LOT_ID}:`);

const history0 = await call(ketoan.token, 'GET', `/shipments/${LOT_ID}/cost-lock-history`);
check('ketoan GET cost-lock-history → 200 (was 403)', history0.status === 200, `status ${history0.status}`);
const giamHistory = await call(giamdoc.token, 'GET', `/shipments/${LOT_ID}/cost-lock-history`);
check('giamdoc GET cost-lock-history → 200', giamHistory.status === 200, `status ${giamHistory.status}`);
const dieuHistory = await call(dieuvan.token, 'GET', `/shipments/${LOT_ID}/cost-lock-history`);
check('dieuvan GET cost-lock-history → 403', dieuHistory.status === 403, `status ${dieuHistory.status}`);

const uKetoan = await call(ketoan.token, 'POST', `/shipments/${LOT_ID}/unlock`, { reason: 'QA lane G1 SIL-721 — kế toán mở khóa theo quyết định boss 07/11' }, `g1-ketoan-unlock-${LOT_ID}-${STAMP}`);
check('ketoan POST unlock → 200 (was 403)', uKetoan.status === 200, `status ${uKetoan.status} ${JSON.stringify(uKetoan.body).slice(0, 200)}`);
const histAfter = await call(admin.token, 'GET', `/shipments/${LOT_ID}/cost-lock-history`);
const lastUnlock = (histAfter.body?.events ?? []).filter(e => e.action === 'UNLOCK').at(-1);
check('history records UNLOCK with actor + reason', !!lastUnlock
  && (lastUnlock.reason ?? '').includes('SIL-721')
  && !!lastUnlock.actorName, JSON.stringify(lastUnlock).slice(0, 220));

// restore: ketoan re-locks (ACCOUNTANT lock already legal), then giamdoc
// unlocks and admin re-locks — both new roles exercise both directions.
const rKetoan = await call(ketoan.token, 'POST', `/shipments/${LOT_ID}/lock`, {}, `g1-ketoan-relock-${LOT_ID}-${STAMP}`);
check('ketoan POST lock → 201 (restore)', rKetoan.status === 201, `status ${rKetoan.status}`);
const uGiam = await call(giamdoc.token, 'POST', `/shipments/${LOT_ID}/unlock`, { reason: 'QA lane G1 SIL-721 — giám đốc mở khóa (MANAGER role)' }, `g1-giamdoc-unlock-${LOT_ID}-${STAMP}`);
check('giamdoc POST unlock → 200 (was 403)', uGiam.status === 200, `status ${uGiam.status}`);
const rAdmin = await call(admin.token, 'POST', `/shipments/${LOT_ID}/lock`, {}, `g1-admin-relock-${LOT_ID}-${STAMP}`);
check('admin POST lock → 201 (restore)', rAdmin.status === 201, `status ${rAdmin.status}`);
const uDieu = await call(dieuvan.token, 'POST', `/shipments/${LOT_ID}/unlock`, { reason: 'QA negative — điều vận không được mở khóa' }, `g1-dieuvan-unlock-${LOT_ID}-${STAMP}`);
check('dieuvan POST unlock → 403 (không đổi)', uDieu.status === 403, `status ${uDieu.status}`);
const still = await call(admin.token, 'GET', `/shipments/${LOT_ID}/cost-lock-history`);
const activeStillLocked = (still.body?.events ?? []).filter(e => e.action === 'LOCK').length
  > (still.body?.events ?? []).filter(e => e.action === 'UNLOCK').length;
check('lot ends locked (state restored)', activeStillLocked, `LOCK ${(still.body?.events ?? []).filter(e => e.action === 'LOCK').length} / UNLOCK ${(still.body?.events ?? []).filter(e => e.action === 'UNLOCK').length}`);

// ─── SIL-722: approved ROAD_ALLOWANCE enters trip direct cost ───────────────
say('\nSIL-722:');
const work = await call(admin.token, 'GET', '/expense-accounting/work?page=1&limit=100');
if (!work.ok) throw new Error(`work read ${work.status}`);
const candidates = (work.body?.items ?? []).filter(row => row.tripId != null);
say(`work rows with trips: ${candidates.length}`);
let trip = null; let before = null;
for (const row of candidates) {
  const t = Number(process.env.TRIP_ID ?? 0) ? { tripId: Number(process.env.TRIP_ID), shipmentId: row.shipmentId } : row;
  const read = await call(admin.token, 'GET', `/trips/${t.tripId}`);
  if (!read.ok) continue;
  const carrier = read.body?.carrierType ?? 'OWN';
  if (carrier !== 'OWN' || read.body?.status === 'CANCELED') continue;
  const lotId = t.shipmentId ?? read.body?.shipmentId;
  if (!lotId) continue;
  const probe = await call(ketoan.token, 'POST', '/expense-accounting/entries/batch', { items: [{
    tripId: t.tripId, shipmentId: lotId, expenseTypeCode: 'ROAD_ALLOWANCE',
    amount: 80000, customerChargeAmount: 0, expenseDate: STAMP, costGroup: 'DRIVER_ROAD',
    feeName: 'QA-722 tien duong da duyet', payerKind: 'COMPANY', driverCostType: 'ROAD_ALLOWANCE',
  }] }, `g1-722-probe-${t.tripId}-${STAMP}`);
  if (probe.ok) { trip = t; trip = { ...trip, shipmentId: lotId }; before = read.body; say(`probe create ok on trip ${t.tripId} (lô ${lotId})`); break; }
  say(`  skip trip ${t.tripId}: ${probe.status} ${JSON.stringify(probe.body).slice(0, 140)}`);
}
if (!trip) throw new Error('no eligible OWN unlocked trip found for the SIL-722 probe');
const tripId = trip.tripId;
const shipmentId = trip.shipmentId ?? before?.shipmentId ?? null;

const tienDuong = await call(ketoan.token, 'GET', `/expense-accounting/phoi-phieu/${tripId}/tien-duong`);
const qaRow = (tienDuong.body?.rows ?? []).find(r => (r.feeName ?? '').includes('QA-722'));
if (!qaRow) throw new Error('QA-722 row missing on tien-duang read: ' + JSON.stringify(tienDuong.body).slice(0, 300));
check('road row recorded on màn duyệt (tien-duong) at 80.000₫', Number(qaRow.amount) === 80000, `amount ${qaRow.amount} confirmed=${qaRow.confirmed}`);

const conf = await call(ketoan.token, 'POST', '/expense-accounting/confirm', { entries: [
  { sourceKind: qaRow.sourceKind ?? 'DRIVER', sourceId: qaRow.sourceId, expectedVersion: qaRow.confirmed ? qaRow.version : qaRow.version },
] }, `g1-722-confirm-${tripId}-${STAMP}`);
check('ketoan confirm (duyệt) → ok', conf.ok, `status ${conf.status} ${JSON.stringify(conf.body).slice(0, 200)}`);

const after = await call(admin.token, 'GET', `/trips/${tripId}`);
const beforeTotal = Number(before.totalCost ?? 0);
const afterTotal = Number(after.body.totalCost ?? 0);
check('totalCost tăng đúng +80.000₫ sau duyệt', afterTotal - beforeTotal === 80000,
  `before ${beforeTotal} after ${afterTotal} delta ${afterTotal - beforeTotal}`);
check('reconciledExtraCost mang thêm 80.000₫', Number(after.body.reconciledExtraCost ?? 0) === Number(before.reconciledExtraCost ?? 0) + 80000,
  `before ${before.reconciledExtraCost} after ${after.body.reconciledExtraCost}`);
say(`SIL-722 trip ${tripId} (lô ${shipmentId}): totalCost ${beforeTotal} → ${afterTotal}`);

fs.writeFileSync(`${OUT}/sil-721-722_api-driver.log`, log.join('\n') + `\n\nchecks ${checks}, fails ${fails.length}\n`, 'utf8');
console.log(`\nchecks ${checks}, fails ${fails.length}`);
if (fails.length > 0) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
console.log('LANE G1 API VERIFIED');
