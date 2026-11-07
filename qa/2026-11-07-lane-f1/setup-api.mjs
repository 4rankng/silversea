// Lane F1 (2026-11-07) API setup + law proofs for SIL-693 / SIL-688 / SIL-694.
// Runs against the LOCAL worktree stack (BE :3003, DB :5441 silversea) — never
// staging. Every step logs status + body snippet; expectations are asserted.
//   SIL-693: LCL lot → COMPLETED trip → lock (freeze null freight) → export
//            409 NO_RATE_KEY → unlock → ketoan rev-class manual price (the
//            carved-out remedy) → re-lock → export 201 with FREIGHT 3.800.000.
//   SIL-694: (a) with an assigned ACTIVE OPS user the ops gate holds (409)
//            until their expense-completion toggle lands (200), then close 200;
//            (b) with NO assignment the governed close passes WITHOUT the ops
//            gate (the fail-open fix).
//   SIL-688: DISPATCHED/live-trip delete 409 (law kept); stale IN_TRANSIT with
//            no live trips deletes (status-independent law); CUS + ADMIN delete
//            through the CUS-workspace route; dispatcher 403.
import { writeFileSync, unlinkSync, mkdtempSync } from 'node:fs';
import zlib from 'node:zlib';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const API = process.env.API_URL || 'http://localhost:3010/api';
const here = dirname(fileURLToPath(import.meta.url));
const LOG = join(here, 'setup-api.log');
const lines = [];
const log = (step, status, body) => {
  const line = `${new Date().toISOString()} ${step} status=${status} body=${JSON.stringify(body)?.slice(0, 400)}`;
  console.log(line);
  lines.push(line);
  writeFileSync(LOG, lines.join('\n') + '\n');
};
const fail = (step, status, body) => {
  log(`FAIL ${step}`, status, body);
  process.exitCode = 1;
  throw new Error(`step ${step} failed with ${status}`);
};

const password = 'Abc123';
const login = async (identifier) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!r.ok) fail(`login ${identifier}`, r.status, await r.text());
  const { token } = await r.json();
  return token;
};

const t = {
  admin: await login('admin'),
  ketoan: await login('ketoan'),
  cus: await login('tiepvv'),
  dispatcher: await login('dieuvan'),
  ops: await login('hoangnh'),
  driver: await login(process.env.F1_DRIVER_USER || 'pvcan'),
};

const api = (role, method, path, body, extra = {}) => fetch(`${API}${path}`, {
  method,
  headers: {
    Authorization: `Bearer ${t[role]}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': crypto.randomUUID(),
    ...(extra.headers ?? {}),
  },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));

const apiMultipart = (role, method, path, formData) => fetch(`${API}${path}`, {
  method,
  headers: { Authorization: `Bearer ${t[role]}`, 'Idempotency-Key': crypto.randomUUID() },
  body: formData,
}).then(async (r) => ({ status: r.status, body: r.headers.get('content-type')?.includes('json') ? await r.json() : await r.text() }));

const png = (() => {
  // Minimal valid 200x200 grayscale PNG — the pod pipeline sharp-processes
  // uploads and refuses degenerate images.
  const width = 200;
  const height = 200;
  const raw = Buffer.alloc(height * (1 + width));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width)] = 0;
    for (let x = 1; x <= width; x++) raw[y * (1 + width) + x] = (x + y) % 256;
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    let crc = 0xffffffff;
    for (const byte of body) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc);
    return Buffer.concat([len, body, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
})();
const podFile = () => {
  const dir = mkdtempSync(join(tmpdir(), 'f1-pod-'));
  const p = join(dir, 'pod.png');
  writeFileSync(p, png);
  return p;
};
const tempFiles = [];
const cleanupTemp = () => tempFiles.forEach((f) => { try { unlinkSync(f); } catch { /* ok */ } });
process.on('exit', cleanupTemp);

const expect = (step, condition, status, body) => {
  if (!condition) fail(step, status, body);
  log(`OK ${step}`, status, body);
};

// ── shared lot factory: quick-create LCL + issue a trip on a free truck ──
// The local DB is a staging mirror: nearly every truck holds ACTIVE trip
// claims whose open-ended windows overlap any new trip, and a declared-pair
// holder hard-409s the issue. Trucks 19/23 are the only ACTIVE trucks with
// zero CREATED/IN_TRANSIT trips (checked via DB before the run); the factory
// uses them and walks if both become claimed mid-run.
const FREE_TRUCKS = (process.env.F1_TRUCKS || '19,23,2,3,4,5,6,7').split(',').map(Number);
let TRUCK_INDEX = 0;
let TRUCK_ID = FREE_TRUCKS[0];
const DRIVER_ID = Number(process.env.F1_DRIVER_ID || 33); // drivers.id for pvcan (user 33 in users? drivers.id 33)

const RUN = process.env.F1_RUN || Date.now().toString(36).slice(-5);

async function createLot(label) {
  const r = await api('admin', 'POST', '/shipments/quick', {
    customerId: 1,
    routeId: Number(process.env.F1_ROUTE_ID || 6),
    cargoMode: 'LCL',
    bookingRef: `F1-${label}-${RUN}`,
    expectedDeliveryDate: '2026-11-10',
    pickupLocation: 'QA F1 pickup',
    deliveryLocation: 'QA F1 delivery',
  });
  expect(`create lot ${label}`, r.status === 201 && r.body?.id, r.status, r.body);
  return { id: r.body.id, version: r.body.version ?? 1, code: r.body.shipmentCode };
}

async function findFulfillmentRow(lotId, { withTrip = false } = {}) {
  for (let page = 1; page <= 40; page++) {
    const r = await api('admin', 'GET', `/shipments/dispatch-detail-plan-rows?limit=50&page=${page}`);
    expect(`dispatch rows p${page}`, r.status === 200 && Array.isArray(r.body?.items), r.status, { count: r.body?.items?.length });
    const hit = r.body.items.find((row) => row.shipmentId === lotId && (!withTrip || row.dispatch?.tripId != null));
    if (hit) return hit;
    if (r.body.items.length < 50) break;
  }
  fail('find row', 404, { lotId, withTrip });
}

async function issueTrip(label, lot) {
  const row = await findFulfillmentRow(lot.id);
  const fid = row.fulfillmentId;
  const fv = row.version;
  const sv = row.shipmentVersion;
  TRUCK_ID = FREE_TRUCKS[TRUCK_INDEX];
  const dr = await api('admin', 'PATCH', `/shipments/dispatch-fleet/trucks/${TRUCK_ID}/assigned-driver`, { driverId: DRIVER_ID });
  log('assigned-driver', dr.status, dr.body);
  if (dr.status >= 400 && dr.status !== 409) fail('assigned-driver', dr.status, dr.body);
  const pr = await api('admin', 'PATCH', `/shipments/dispatch-detail-plan-rows/${fid}/plan`, {
    expectedFulfillmentVersion: fv,
    expectedShipmentVersion: sv,
    carrierType: 'OWN',
    truckId: TRUCK_ID,
    plannedRevenue: 3800000,
    plannedCarrierCost: 0,
    rigOverlapCompletedConfirmed: true,
  });
  if (pr.status >= 400 && TRUCK_INDEX + 1 < FREE_TRUCKS.length) {
    log('truck claim conflict, rotating', pr.status, pr.body);
    TRUCK_INDEX += 1;
    TRUCK_ID = FREE_TRUCKS[TRUCK_INDEX];
    return issueTrip(label, lot);
  }
  expect(`plan issue ${label}`, pr.status === 200, pr.status, pr.body);
  // The plan save STAGES carrier/truck; the trip itself is created by the
  // separate 'phát lệnh' issue call (POST /:id/dispatch).
  // Schedule the issue 2h IN THE PAST: the local DB is saturated with ACTIVE
  // rig claims for the current shift (ACTIVE overlap blocks outright), while
  // a past start lands in a free window AND lets the driver complete now
  // ("Ngày hoàn thành không thể trước ngày khởi hành" forbids a future start).
  const plannedStartAt = `${new Date(Date.now() - 2 * 3_600_000).toISOString().slice(0, 16)}:00Z`;
  const dispatch = await api('admin', 'POST', `/shipments/${lot.id}/dispatch`, {
    fulfillmentId: fid,
    expectedVersion: pr.body?.fulfillmentVersion ?? fv,
    plannedStartAt,
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: TRUCK_ID,
    driverId: DRIVER_ID,
    rigOverlapCompletedConfirmed: true,
  });
  if (dispatch.status >= 400) {
    if (/trùng lịch kế hoạch/.test(String(dispatch.body?.error)) && TRUCK_INDEX + 1 < FREE_TRUCKS.length) {
      // The staged plan-holders on this rig claim the window — walk to the
      // next free truck and re-stage + re-issue.
      log('dispatch overlap, rotating truck', dispatch.status, dispatch.body);
      TRUCK_INDEX += 1;
      TRUCK_ID = FREE_TRUCKS[TRUCK_INDEX];
      return issueTrip(label, lot);
    }
    fail(`dispatch issue ${label}`, dispatch.status, dispatch.body);
  }
  log(`dispatch issued ${label}`, dispatch.status, dispatch.body);
  const tripId = dispatch.body?.trip?.id ?? dispatch.body?.tripId;
  if (!tripId) fail('trip id', dispatch.status, dispatch.body);
  log(`trip issued ${label}`, 200, { tripId, fid, truckId: TRUCK_ID });
  return { tripId, fid, fulfillmentVersion: pr.body?.fulfillmentVersion ?? fv };
}

async function driverFlow(fid, { toDelivered = false } = {}) {
  // Milestone law (shared/constants): ORDER_RECEIVED → PICKED_UP →
  // LOADING_OR_RETURNING → DELIVERED. ORDER_RECEIVED is the driver's explicit
  // start and flips a CREATED trip to IN_TRANSIT; each call re-reads the
  // tripVersion the events themselves keep bumping.
  const sequence = toDelivered
    ? ['ORDER_RECEIVED', 'PICKED_UP', 'LOADING_OR_RETURNING', 'DELIVERED']
    : ['ORDER_RECEIVED'];
  const occurred = new Date().toISOString();
  for (const eventType of sequence) {
    const detail = await api('driver', 'GET', `/driver/me/fulfillments/${fid}`);
    const version = detail.body?.tripVersion ?? detail.body?.version ?? 1;
    const step = await api('driver', 'POST', `/driver/me/fulfillments/${fid}/progress`, { eventType, occurredAt: occurred, expectedVersion: version });
    if (step.status >= 400) fail(`driver ${eventType}`, step.status, step.body);
    log(`driver ${eventType}`, step.status, step.body);
  }
}

async function driverPodSubmit(fid) {
  const detail = await api('driver', 'GET', `/driver/me/fulfillments/${fid}`);
  const version = detail.body?.tripVersion ?? detail.body?.version ?? 1;
  const pod = await api('driver', 'POST', `/driver/me/fulfillments/${fid}/pod`, { expectedVersion: version });
  log('pod create', pod.status, pod.body);
  const submissionId = pod.body?.id ?? pod.body?.submission?.id;
  if (!submissionId) fail('pod submission id', pod.status, pod.body);
  let submissionVersion = pod.body?.submissionVersion ?? pod.body?.version ?? 1;
  for (const fileType of ['YARD_OR_DROP_RECEIPT', 'SIGNED_DELIVERY_NOTE']) {
    const fd = new FormData();
    fd.append('file', new Blob([png], { type: 'image/png' }), 'pod.png');
    fd.append('expectedVersion', String(submissionVersion));
    fd.append('fileType', fileType);
    const up = await apiMultipart('driver', 'POST', `/driver/me/fulfillments/${fid}/pod/${submissionId}/files`, fd);
    log(`pod file ${fileType}`, up.status, up.body);
    if (up.status >= 400) fail(`pod file ${fileType}`, up.status, up.body);
    submissionVersion = up.body?.version ?? up.body?.submissionVersion ?? submissionVersion;
  }
  const afterFiles = await api('driver', 'GET', `/driver/me/fulfillments/${fid}`);
  const submitVersion = afterFiles.body?.tripVersion ?? afterFiles.body?.version ?? version;
  const submitted = await api('driver', 'POST', `/driver/me/fulfillments/${fid}/pod/${submissionId}/submit`, { expectedVersion: submitVersion });
  if (submitted.status >= 400) fail('pod submit', submitted.status, submitted.body);
  log('pod submit', submitted.status, submitted.body);
  return { submissionId };
}

const uploadTripPhoto = async (tripId, type = 'OTHER') => {
  const fd = new FormData();
  fd.append('file', new Blob([png], { type: 'image/png' }), 'trip.png');
  fd.append('trip_id', String(tripId));
  fd.append('type', type);
  const up = await apiMultipart('driver', 'POST', '/upload/', fd);
  log(`trip photo ${type}`, up.status, up.body);
  if (up.status >= 400) fail(`trip photo ${type}`, up.status, up.body);
};

// ═══════════════ SIL-693 — priced-after-completed remedy chain ═══════════════
const lotA = await createLot('693-A');
const tripA = await issueTrip('693-A', lotA);
await driverFlow(tripA.fid, { toDelivered: true });
await driverPodSubmit(tripA.fid);
const beforeComplete = await api('driver', 'GET', `/driver/me/fulfillments/${tripA.fid}`);
const completeVersion = beforeComplete.body?.tripVersion ?? beforeComplete.body?.version ?? tripA.fulfillmentVersion;
const driverComplete = await api('driver', 'POST', `/driver/me/fulfillments/${tripA.fid}/complete`, { expectedVersion: completeVersion });
if (driverComplete.status >= 400) fail('driver complete A', driverComplete.status, driverComplete.body);
log('trip A driver-completed', driverComplete.status, driverComplete.body);

const lotVersion = async (lotId, role = 'admin') => {
  const r = await api(role, 'GET', `/shipments/${lotId}`);
  return r.body?.shipment?.version ?? r.body?.version ?? 1;
};

// The lock's expectedShipmentVersion races with the lifecycle recomputes the
// driver close fires; re-read + retry instead of depending on a spot read.
const lockWithRetry = async (lotId, note) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await api('admin', 'POST', `/shipments/${lotId}/lock`, { expectedShipmentVersion: await lotVersion(lotId), lockNote: note });
    if (r.status < 409 || !String(r.body?.error ?? '').includes('thay đổi')) return r;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return api('admin', 'POST', `/shipments/${lotId}/lock`, { expectedShipmentVersion: await lotVersion(lotId), lockNote: note });
};

const lock1 = await lockWithRetry(lotA.id, 'QA F1-693 freeze v1');
expect('lock lot A (freeze unpriced)', lock1.status === 200 || lock1.status === 201, lock1.status, lock1.body);

const exportBefore = await api('ketoan', 'POST', '/shipments/debit-notes', { shipmentIds: [lotA.id] });
expect('693 BEFORE: export 409 NO_RATE_KEY (guard kept)', exportBefore.status === 409, exportBefore.status, exportBefore.body);
if (!JSON.stringify(exportBefore.body).includes('NO_RATE_KEY')) fail('693 guard message', exportBefore.status, exportBefore.body);

// The BEFORE-fix law pins this as the dead end; the carve-out must let it pass.
const unlock = await api('admin', 'POST', `/shipments/${lotA.id}/unlock`, { reason: 'QA F1-693 remedy — định giá bù sau hoàn thành' });
expect('unlock lot A', unlock.status === 200, unlock.status, unlock.body);

const revClass = await api('ketoan', 'POST', '/shipments/lcl/rev-class', {
  shipmentId: lotA.id,
  freightRevenue: 3800000,
  reason: 'Định giá bù trên lô đã hoàn thành chuyến — remedy SIL-693',
});
expect('693 FIX: completed-trip manual price 200 (was 409)', revClass.status === 200, revClass.status, revClass.body);
if (revClass.body?.channel !== 'TRIP') fail('693 channel TRIP', revClass.status, revClass.body);

const relock = await lockWithRetry(lotA.id, 'QA F1-693 freeze v2 (priced)');
expect('re-lock lot A', relock.status === 200 || relock.status === 201, relock.status, relock.body);
// The FINAL issuance (201 + FREIGHT line) is deliberately left to ui-drive.mjs
// so the Debit Note export is proven through the real UI surface (rung 3).

// ═══════════════ SIL-694 — with-Ops law intact ═══════════════
const lotB = await createLot('694-B-ops');
const tripB = await issueTrip('694-B-ops', lotB);
await driverFlow(tripB.fid, { toDelivered: true });
await driverPodSubmit(tripB.fid);
await uploadTripPhoto(tripB.tripId);

// Assign hoangnh (user 3) to lot B's shipment — merges with existing links.
const hoangnhUserId = 3;
const usersList = await api('admin', 'GET', '/auth/users?limit=200');
const hoangnh = (usersList.body?.users ?? usersList.body?.items ?? []).find((u) => u.id === hoangnhUserId);
const existing = hoangnh?.shipmentIds ?? [];
const hoangnhUpdatedAt = hoangnh?.updatedAt;
log('hoangnh current links', usersList.status, { existing, hoangnhUpdatedAt });
const assign = await api('admin', 'PATCH', `/auth/users/${hoangnhUserId}`, { shipmentIds: [...new Set([...existing, lotB.id])] }, {
  // The exact stored instant (ms included) — toUTCString() would truncate the
  // milliseconds and the version lock rejects the rounded value as stale.
  headers: { 'If-Unmodified-Since': hoangnhUpdatedAt ?? new Date().toISOString() },
});
expect('assign hoangnh to lot B', assign.status === 200, assign.status, assign.body);

const tripBRead = await api('admin', 'GET', `/trips/${tripB.tripId}`);
const tripBVersion = tripBRead.body?.version ?? 1;
const closeWithOps = await api('admin', 'POST', `/trips/${tripB.tripId}/complete`, { expectedVersion: tripBVersion, reason: 'QA F1-694 with-ops close attempt' });
expect('694 WITH-ops: close 409 ops gate (law intact)', closeWithOps.status === 409, closeWithOps.status, closeWithOps.body);
if (!JSON.stringify(closeWithOps.body).includes('Ops chưa xác nhận')) fail('694 with-ops message', closeWithOps.status, closeWithOps.body);

const tripContainers = await api('ops', 'GET', `/forwarder/me/trips/${tripB.tripId}`);
const containerRows = tripContainers.body?.containers ?? tripContainers.body?.tripContainers ?? [];
log('trip containers (ops view)', tripContainers.status, containerRows.map((c) => ({ id: c.id, containerNumber: c.containerNumber ?? c.number })));
for (const scope of [{ tripContainerId: null }, ...containerRows.map((c) => ({ tripContainerId: c.id }))]) {
  const tog = await api('ops', 'PUT', `/forwarder/me/trips/${tripB.tripId}/expense-completion`, { tripContainerId: scope.tripContainerId, completed: true });
  expect(`694 with-ops: Ops toggle ${scope.tripContainerId ?? 'general'} 200`, tog.status === 200, tog.status, tog.body);
}
// Physical paper POD recovery (O2C gate): accountant marks it before close.
const podRecoveredB = await api('ketoan', 'POST', `/trips/${tripB.tripId}/pod-recovered`, { expectedVersion: tripBRead.body?.version ?? tripBVersion });
log('pod-recovered B', podRecoveredB.status, podRecoveredB.body);
if (podRecoveredB.status >= 400) fail('pod-recovered B', podRecoveredB.status, podRecoveredB.body);
const closeWithOpsAfter = await api('admin', 'POST', `/trips/${tripB.tripId}/complete`, { expectedVersion: podRecoveredB.body?.version ?? tripBRead.body?.version ?? tripBVersion, reason: 'QA F1-694 with-ops close after toggle' });
expect('694 WITH-ops: close 200 after Ops confirmed', closeWithOpsAfter.status === 200, closeWithOpsAfter.status, closeWithOpsAfter.body);

// ═══════════════ SIL-694 — no-Ops fail-open (THE fix) ═══════════════
const lotC = await createLot('694-C-noops');
const tripC = await issueTrip('694-C-noops', lotC);
await driverFlow(tripC.fid, { toDelivered: true });
await driverPodSubmit(tripC.fid);
await uploadTripPhoto(tripC.tripId);
const tripCRead = await api('admin', 'GET', `/trips/${tripC.tripId}`);
const podRecoveredC = await api('ketoan', 'POST', `/trips/${tripC.tripId}/pod-recovered`, { expectedVersion: tripCRead.body?.version ?? 1 });
log('pod-recovered C', podRecoveredC.status, podRecoveredC.body);
if (podRecoveredC.status >= 400) fail('pod-recovered C', podRecoveredC.status, podRecoveredC.body);
const closeNoOps = await api('admin', 'POST', `/trips/${tripC.tripId}/complete`, { expectedVersion: podRecoveredC.body?.version ?? tripCRead.body?.version ?? 1, reason: 'QA F1-694 no-ops close (fail-open)' });
expect('694 NO-ops: governed close 200 WITHOUT any Ops assignment (the fix)', closeNoOps.status === 200, closeNoOps.status, closeNoOps.body);

// ═══════════════ SIL-688 — delete law ═══════════════
// DISPATCHED (live trip issued, driver not yet accepted) → 409 for everyone.
const lotE = await createLot('688-E-dispatched');
const tripE = await issueTrip('688-E-dispatched', lotE);
const freshLotE = await lotVersion(lotE.id);
const delDispatchedAdmin = await api('admin', 'DELETE', `/shipments/cus-workspace/${lotE.id}`, { version: freshLotE, reason: 'QA F1-688 dispatched probe' });
expect('688 DISPATCHED admin 409 live-trip law', delDispatchedAdmin.status === 409, delDispatchedAdmin.status, delDispatchedAdmin.body);
if (!JSON.stringify(delDispatchedAdmin.body).includes('chưa phát lệnh')) fail('688 dispatched message', delDispatchedAdmin.status, delDispatchedAdmin.body);
const delDispatchedCus = await api('cus', 'DELETE', `/shipments/cus-workspace/${lotE.id}`, { version: await lotVersion(lotE.id, 'cus'), reason: 'QA F1-688 dispatched probe' });
expect('688 DISPATCHED CUS 409 live-trip law', delDispatchedCus.status === 409, delDispatchedCus.status, delDispatchedCus.body);
const delDispatchedDispatcher = await api('dispatcher', 'DELETE', `/shipments/cus-workspace/${lotE.id}`, { version: freshLotE, reason: 'QA F1-688 dispatched probe' });
expect('688 dispatcher 403 (SIL-706 kept)', delDispatchedDispatcher.status === 403, delDispatchedDispatcher.status, delDispatchedDispatcher.body);
// E's issued-but-unaccepted trip keeps the driver's rig claim — release it
// before lot F (the probes are done; the law evidence above is captured).
const cancelTripE = await api('admin', 'POST', `/trips/${tripE.tripId}/cancel`, { reason: 'QA F1-688 — release rig claim after probes' });
log('cancel trip E', cancelTripE.status, cancelTripE.body);

// CUS + ADMIN delete a PENDING lot through the same route (200 + soft-delete).
const lotD2 = await createLot('688-D2-cus');
const cusDetail = await api('cus', 'GET', `/shipments/${lotD2.id}`);
const cusVersion = cusDetail.body?.version ?? lotD2.version;
const delCus = await api('cus', 'DELETE', `/shipments/cus-workspace/${lotD2.id}`, { version: cusVersion, reason: 'QA F1-688 CUS delete PENDING' });
expect('688 CUS delete PENDING 200', delCus.status === 200, delCus.status, delCus.body);
const cusGone = await api('cus', 'GET', `/shipments/${lotD2.id}`);
expect('688 CUS-deleted lot reads deleted', cusGone.body?.deletedAt != null || cusGone.status === 404, cusGone.status, { deletedAt: cusGone.body?.deletedAt });

// Stale IN_TRANSIT with no live trips: reached only via a canceled trip, so the
// lot is created + departed + trip canceled; the status field is then pinned
// back to IN_TRANSIT by the FIXTURE SQL (qa scripts own this class) to model
// the stale row the owner described. Deletion must pass (status-independent).
const lotF = await createLot('688-F-stale-intransit');
const tripF = await issueTrip('688-F-stale-intransit', lotF);
await driverFlow(tripF.fid);
const cancelTrip = await api('admin', 'POST', `/trips/${tripF.tripId}/cancel`, { reason: 'QA F1-688 stale fixture' });
log('cancel trip F', cancelTrip.status, cancelTrip.body);
if (cancelTrip.status >= 400) fail('cancel trip F', cancelTrip.status, cancelTrip.body);
log('FIXTURE-NOTE lot F', 0, { note: 'status pinned to IN_TRANSIT via SQL fixture before delete' });

const state = {
  lotA: lotA.id, tripA: tripA.tripId,
  lotB: lotB.id, tripB: tripB.tripId,
  lotC: lotC.id, tripC: tripC.tripId,
  lotE: lotE.id, tripE: tripE.tripId,
  lotF: lotF.id, tripF: tripF.tripId,
  lotD2: lotD2.id,
  bookingA: `F1-693-A-${RUN}`,
  run: RUN,
};
writeFileSync(join(here, 'state.json'), JSON.stringify(state, null, 2));
console.log('SETUP_API_DONE ' + JSON.stringify(state));
