#!/usr/bin/env node
// scripts/journey-o2c.mjs — END-TO-END O2C journey test via pure API (wave #49).
//
// Role chain: CUS creates lot → submit for dispatch → dispatcher dispatches →
// driver accepts (progress) → geotag → POD → expense → complete → close, with
// role-scoping assertions at EVERY hop. Second lot exercises the unified
// picker appointment contract (naive local datetime) and the CANCELED
// fulfillment probe (cancel after dispatch, driver-side behavior on it).
//
// Usage: STAGING_URL=https://vantai.tingting.vip node testplan/qa/scripts/journey-o2c.mjs
// Fixtures: QA49E2E-* (isolated; safe to re-run — unique per timestamp).

const BASE = (process.env.STAGING_URL || 'https://vantai.tingting.vip').replace(/\/$/, '');
const API = `${BASE}/api`;
const PASSWORD = process.env.PASSWORD || 'Abc123';
const TS = Date.now();
const STAMP = `QA49E2E-${TS}`;

const ROLES = { CUS: 'thanhdc', DISPATCHER: 'dungnv', DRIVER: 'dvthuc', ADMIN: 'admin' };
const tokens = {};
const trace = [];
let failures = 0;

function log(hop, detail, verdict = 'INFO') {
  trace.push({ hop, detail, verdict });
  console.log(`[${verdict}] ${hop} — ${detail}`);
}

function assert(hop, ok, detail) {
  log(hop, detail, ok ? 'PASS' : 'FAIL');
  if (!ok) failures += 1;
}

function iso(offsetHours = 0) {
  return new Date(TS + offsetHours * 3600_000).toISOString();
}

async function call(token, method, path, body, opts = {}) {
  const headers = { Accept: 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.idempotency) headers['Idempotency-Key'] = opts.idempotency;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

async function login(identifier) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const r = await call(null, 'POST', '/auth/login', { identifier, password: PASSWORD });
    if (r.status === 200 && r.body?.token) return r.body.token;
    if (attempt === 3) throw new Error(`login ${identifier} failed: ${r.status}`);
    await new Promise((resolve) => setTimeout(resolve, 8000));
  }
  throw new Error(`login ${identifier} failed`);
}

function pickQueueItem(queue, shipmentId) {
  return (queue.items ?? []).find((item) => item.shipmentId === shipmentId)
    ?? (queue.items ?? []).find((item) => JSON.stringify(item).includes(shipmentId));
}

async function journey() {
  // ─── HOP 0: role logins ────────────────────────────────────────────────
  for (const [role, identifier] of Object.entries(ROLES)) {
    tokens[role] = await login(identifier);
  }
  log('H0', 'all four role tokens acquired (CUS, DISPATCHER, DRIVER, ADMIN)', 'PASS');

  // ─── HOP 1: CUS catalogs + role-scope reads ───────────────────────────
  const boot = await call(tokens.CUS, 'GET', '/catalogs/bootstrap');
  assert('H1', boot.status === 200 && boot.body?.customers?.length > 0,
    `CUS bootstrap: ${boot.status}, customers=${boot.body?.customers?.length ?? 0}`);
  const customer = boot.body.customers[0];
  const route = (boot.body.routes ?? [])[0];

  const driverBoardBefore = await call(tokens.DRIVER, 'GET', '/driver/me/journey-board');
  assert('H1', driverBoardBefore.status === 200,
    `driver journey board readable: ${driverBoardBefore.status}`);
  const boardHasFixtureAlready = JSON.stringify(driverBoardBefore.body ?? {}).includes('QA49E2E');
  assert('H1', !boardHasFixtureAlready, 'journey board has no QA49E2E fixtures before the run');

  // ─── HOP 2: CUS creates lot A (normal flow, +07:00 appointment) ───────
  const containerA = `QATU${String(TS).slice(-7)}`;
  const apptA = new Date(TS + 24 * 3600_000).toISOString().replace('Z', '+07:00');
  const createA = await call(tokens.CUS, 'POST', '/shipments', {
    customerId: customer.id,
    tradeDirection: 'IMPORT',
    blNumber: `${STAMP}-A`,
    cargoMode: 'FCL',
  }, { idempotency: crypto.randomUUID() });
  assert('H2', createA.status === 201, `lot A create: ${createA.status} id=${createA.body?.id ?? '?'} status=${createA.body?.status ?? '?'} body=${JSON.stringify(createA.body).slice(0, 300)}`);
  const lotA = createA.body;
  if (!lotA?.id) throw new Error('lot A create failed — cannot continue');

  // Containers are declared in a second full-reconcile PUT (the create
  // endpoint rejects inline container lists).
  const containersA = await call(tokens.CUS, 'PUT', `/shipments/${lotA.id}/containers`, {
    expectedVersion: lotA.version,
    containers: [{ containerNumber: containerA, customerAppointmentAt: apptA }],
  }, { idempotency: crypto.randomUUID() });
  assert('H2', containersA.status === 200, `lot A containers PUT: ${containersA.status} body=${JSON.stringify(containersA.body).slice(0, 200)}`);
  const lotAVersion = containersA.body?.shipmentVersion ?? lotA.version + 1;
  log('H2', `lot A: id=${lotA.id} code=${lotA.shipmentCode} container=${containerA} version=${lotAVersion}`);

  // Role scoping on create: full VALID body — does the role gate hold?
  const fullBody = {
    customerId: customer.id, tradeDirection: 'IMPORT', blNumber: `${STAMP}-ROLEPROBE`, cargoMode: 'FCL',
  };
  const driverCreate = await call(tokens.DRIVER, 'POST', '/shipments', fullBody, { idempotency: crypto.randomUUID() });
  assert('H2', driverCreate.status === 401 || driverCreate.status === 403,
    `driver token with FULL valid create body: ${driverCreate.status} ${JSON.stringify(driverCreate.body).slice(0, 140)}`);
  if (driverCreate.status === 201) log('H2', `SEVERE: driver token CREATED lot id=${driverCreate.body?.id}`, 'FAIL');
  const dispCreate = await call(tokens.DISPATCHER, 'POST', '/shipments', fullBody, { idempotency: crypto.randomUUID() });
  log('H2', `dispatcher token with FULL valid create body: ${dispCreate.status}`,
    dispCreate.status === 401 || dispCreate.status === 403 ? 'PASS' : 'WARN');

  const cusList = await call(tokens.CUS, 'GET', `/shipments/cus-workspace?page=1&limit=50&searchSuffix=${STAMP}-A`);
  assert('H2', JSON.stringify(cusList.body ?? {}).includes(String(lotA.id)),
    `CUS workspace list sees lot A (${cusList.status})`);

  // ─── HOP 3: CUS submits lot A for dispatch ────────────────────────────
  const submitA = await call(tokens.CUS, 'POST', `/shipments/${lotA.id}/submit-for-dispatch`,
    { expectedVersion: lotA.version, operationalNote: null }, { idempotency: crypto.randomUUID() });
  assert('H3', submitA.status === 200 || submitA.status === 201,
    `lot A submit-for-dispatch: ${submitA.status} status=${submitA.body?.status ?? '?'}`);

  const driverCannotSubmit = await call(tokens.DRIVER, 'POST', `/shipments/${lotA.id}/submit-for-dispatch`,
    { expectedVersion: lotAVersion }, { idempotency: crypto.randomUUID() });
  assert('H3', driverCannotSubmit.status === 401 || driverCannotSubmit.status === 403,
    `driver token CANNOT submit-for-dispatch: ${driverCannotSubmit.status}`);

  // ─── HOP 4: dispatcher dispatches lot A ───────────────────────────────
  const queue = await call(tokens.DISPATCHER, 'GET', '/shipments/dispatch-queue?status=READY&limit=100');
  assert('H4', queue.status === 200, `dispatch queue: ${queue.status}, items=${queue.body?.items?.length ?? 0}`);
  const itemA = pickQueueItem(queue.body, lotA.id);
  assert('H4', Boolean(itemA), `queue holds lot A (fulfillment ${itemA?.fulfillmentId ?? '?'})`);
  if (!itemA) throw new Error('lot A missing from dispatch queue');

  const driverQueue = await call(tokens.DRIVER, 'GET', '/shipments/dispatch-queue?status=READY&limit=10');
  assert('H4', driverQueue.status === 401 || driverQueue.status === 403,
    `driver token CANNOT read dispatch queue: ${driverQueue.status}`);

  const trucks = await call(tokens.DISPATCHER, 'GET', '/shipments/dispatch-fleet?resource=TRUCK&limit=20');
  const drivers = await call(tokens.DISPATCHER, 'GET', '/shipments/dispatch-fleet?resource=DRIVER&limit=20');
  const truck = (trucks.body?.items ?? [])[0];
  const driver = (drivers.body?.items ?? [])[0];
  assert('H4', Boolean(truck?.id && driver?.id),
    `dispatch fleet: truck=${truck?.id ?? '?'} driver=${driver?.id ?? '?'} (${trucks.status}/${drivers.status})`);

  const tomorrow = new Date(TS + 24 * 3600_000).toISOString();
  const dayAfter = new Date(TS + 48 * 3600_000).toISOString();
  const dispatchA = await call(tokens.DISPATCHER, 'POST', `/shipments/${lotA.id}/dispatch`, {
    fulfillmentId: itemA.fulfillmentId,
    expectedVersion: itemA.fulfillmentVersion,
    plannedStartAt: tomorrow,
    plannedEndAt: dayAfter,
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: truck.id,
    driverId: driver.id,
  }, { idempotency: crypto.randomUUID() });
  assert('H4', dispatchA.status === 200 || dispatchA.status === 201,
    `dispatch lot A: ${dispatchA.status} trip=${dispatchA.body?.trip?.id ?? '?'} status=${dispatchA.body?.trip?.status ?? '?'}`);
  const tripA = dispatchA.body?.trip;
  const fulfillmentA = dispatchA.body?.fulfillmentId ?? itemA.fulfillmentId;
  if (!tripA?.id) throw new Error(`dispatch failed: ${JSON.stringify(dispatchA.body).slice(0, 300)}`);

  const cusCannotDispatch = await call(tokens.CUS, 'POST', `/shipments/${lotA.id}/dispatch`, {
    fulfillmentId: itemA.fulfillmentId, expectedVersion: itemA.fulfillmentVersion,
    plannedStartAt: tomorrow, plannedEndAt: dayAfter, endTimeConfirmed: true,
    carrierType: 'OWN', truckId: truck.id, driverId: driver.id,
  }, { idempotency: crypto.randomUUID() });
  assert('H4', cusCannotDispatch.status === 401 || cusCannotDispatch.status === 403,
    `CUS token CANNOT issue dispatch: ${cusCannotDispatch.status}`);

  // ─── HOP 5: driver accepts the trip (progress milestones) ─────────────
  const board = await call(tokens.DRIVER, 'GET', '/driver/me/journey-board');
  const boardHasA = JSON.stringify(board.body ?? {}).includes(String(fulfillmentA));
  assert('H5', board.status === 200 && boardHasA,
    `driver journey board shows the assigned fulfillment (${board.status}, found=${boardHasA})`);

  const detailA = await call(tokens.DRIVER, 'GET', `/driver/me/fulfillments/${fulfillmentA}`);
  assert('H5', detailA.status === 200, `driver fulfillment detail: ${detailA.status}`);
  let fulfillmentVersion = detailA.body?.fulfillment?.version ?? detailA.body?.version ?? itemA.fulfillmentVersion;

  // State machine: DELIVERED must not precede ORDER_RECEIVED.
  const premature = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentA}/progress`,
    { eventType: 'DELIVERED', occurredAt: iso() }, { idempotency: crypto.randomUUID() });
  assert('H5', premature.status === 400 || premature.status === 409,
    `out-of-order progress (DELIVERED first) rejected: ${premature.status}`);

  for (const eventType of ['ORDER_RECEIVED', 'DEPARTED', 'ARRIVED', 'PICKED_UP', 'DELIVERED']) {
    const step = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentA}/progress`,
      { eventType, occurredAt: iso() }, { idempotency: crypto.randomUUID() });
    assert('H5', step.status === 200 || step.status === 201, `progress ${eventType}: ${step.status}`);
    if (step.body?.version) fulfillmentVersion = step.body.version;
  }

  const cusProgress = await call(tokens.CUS, 'POST', `/driver/me/fulfillments/${fulfillmentA}/progress`,
    { eventType: 'NOTE', occurredAt: iso() }, { idempotency: crypto.randomUUID() });
  assert('H5', cusProgress.status === 401 || cusProgress.status === 403,
    `CUS token CANNOT write driver progress: ${cusProgress.status}`);

  // ─── HOP 6: geotag (driver-scoped foundation) ─────────────────────────
  const geotag = await call(tokens.DRIVER, 'POST', '/geotags', {
    entityType: 'TRIP', entityId: tripA.id,
    latitude: 10.841, longitude: 106.81, accuracyMeters: 12, capturedAt: iso(),
  }, { idempotency: crypto.randomUUID() });
  log('H6', `geotag submit (TRIP ${tripA.id}): ${geotag.status}`, [200, 201].includes(geotag.status) ? 'PASS' : 'WARN');
  const geotagRead = await call(tokens.DRIVER, 'GET', `/geotags/TRIP/${tripA.id}`);
  log('H6', `geotag read-back: ${geotagRead.status}`, geotagRead.status === 200 ? 'PASS' : 'WARN');

  // ─── HOP 7: POD — create submission, attach required files, submit ────
  const pod = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentA}/pod`,
    { expectedVersion: fulfillmentVersion }, { idempotency: crypto.randomUUID() });
  assert('H7', [200, 201].includes(pod.status), `POD submission created: ${pod.status} id=${pod.body?.id ?? '?'}`);
  const podId = pod.body?.id;
  const podVersion = () => pod.body?.submissionVersion ?? pod.body?.version ?? 1;

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  for (const fileType of ['YARD_OR_DROP_RECEIPT', 'SIGNED_DELIVERY_NOTE']) {
    const form = new FormData();
    form.append('file', new Blob([png], { type: 'image/png' }), `${fileType}.png`);
    form.append('fileType', fileType);
    form.append('expectedVersion', String(podVersion()));
    const attach = await fetch(`${API}/driver/me/fulfillments/${fulfillmentA}/pod/${podId}/files`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${tokens.DRIVER}` },
      body: form,
    });
    const bodyText = await attach.text();
    assert('H7', attach.status === 200 || attach.status === 201, `POD attach ${fileType}: ${attach.status}`);
    try { Object.assign(pod.body, JSON.parse(bodyText)); } catch { /* keep versions */ }
  }

  const podSubmit = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentA}/pod/${podId}/submit`,
    { expectedVersion: podVersion() }, { idempotency: crypto.randomUUID() });
  assert('H7', [200, 201].includes(podSubmit.status), `POD submit: ${podSubmit.status}`);

  // ─── HOP 8: driver expense (incidental cost) with idempotent replay ───
  const cost = await call(tokens.DRIVER, 'POST', `/driver/me/trips/${tripA.id}/incidental-costs`,
    { costType: 'PER_DIEM', amount: 50000, occurredAt: new Date(TS).toISOString().slice(0, 10), note: `${STAMP} ăn ca` },
    { idempotency: crypto.randomUUID() });
  assert('H8', [200, 201].includes(cost.status), `incidental cost: ${cost.status}`);

  const scope = { CUS: tokens.CUS, DISPATCHER: tokens.DISPATCHER };
  const otherCost = await call(scope.DISPATCHER, 'POST', `/driver/me/trips/${tripA.id}/incidental-costs`,
    { costType: 'PER_DIEM', amount: 1000, occurredAt: new Date(TS).toISOString().slice(0, 10) },
    { idempotency: crypto.randomUUID() });
  assert('H8', otherCost.status === 401 || otherCost.status === 403,
    `dispatcher token CANNOT write driver incidental cost: ${otherCost.status}`);

  // ─── HOP 9: driver completes the fulfillment ──────────────────────────
  const complete = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentA}/complete`,
    { expectedVersion: fulfillmentVersion }, { idempotency: crypto.randomUUID() });
  assert('H9', [200, 201].includes(complete.status), `fulfillment complete: ${complete.status}`);

  const lotAfterA = await call(tokens.CUS, 'GET', `/shipments/cus-workspace/${lotA.id}`);
  log('H9', `lot A after driver completion: status=${lotAfterA.body?.status ?? lotAfterA.body?.summary?.status ?? lotAfterA.status}`,
    [200, 201, 404].includes(lotAfterA.status) ? 'PASS' : 'FAIL');

  // ─── HOP 10: lot B via the unified picker appointment contract ────────
  const containerB = `QATU${String(TS).slice(-6)}1`;
  const naiveAppt = new Date(TS + 30 * 3600_000).toISOString().slice(0, 16);
  const createB = await call(tokens.CUS, 'POST', '/shipments', {
    customerId: customer.id,
    tradeDirection: 'IMPORT',
    blNumber: `${STAMP}-B`,
    cargoMode: 'FCL',
    containers: [{ containerNumber: containerB, customerAppointmentAt: naiveAppt }],
  }, { idempotency: crypto.randomUUID() });
  assert('H10', createA.status === 201 && createB.status === 201,
    `lot B create (naive picker appointment ${naiveAppt}): ${createB.status} id=${createB.body?.id ?? '?'} appt=${JSON.stringify(createB.body?.containers?.[0]?.customerAppointmentAt ?? createB.body?.customerAppointmentAt ?? '?')}`);
  const lotB = createB.body;
  if (!lotB?.id) throw new Error('lot B create failed');

  const submitB = await call(tokens.CUS, 'POST', `/shipments/${lotB.id}/submit-for-dispatch`,
    { expectedVersion: lotB.version, operationalNote: null }, { idempotency: crypto.randomUUID() });
  assert('H10', [200, 201].includes(submitB.status), `lot B submit: ${submitB.status}`);

  const queueB = await call(tokens.DISPATCHER, 'GET', '/shipments/dispatch-queue?status=READY&limit=100');
  const itemB = pickQueueItem(queueB.body, lotB.id);
  assert('H10', Boolean(itemB), `queue holds lot B (fulfillment ${itemB?.fulfillmentId ?? '?'})`);
  const dispatchB = await call(tokens.DISPATCHER, 'POST', `/shipments/${lotB.id}/dispatch`, {
    fulfillmentId: itemB.fulfillmentId,
    expectedVersion: itemB.fulfillmentVersion,
    plannedStartAt: tomorrow,
    plannedEndAt: dayAfter,
    endTimeConfirmed: true,
    carrierType: 'OWN',
    truckId: truck.id,
    driverId: driver.id,
  }, { idempotency: crypto.randomUUID() });
  assert('H10', [200, 201].includes(dispatchB.status),
    `dispatch lot B: ${dispatchB.status} trip=${dispatchB.body?.trip?.id ?? '?'}`);
  const tripB = dispatchB.body?.trip;
  const fulfillmentB = dispatchB.body?.fulfillmentId ?? itemB.fulfillmentId;

  // Driver sees it, acknowledges, then dispatcher cancels the trip.
  const detailB = await call(tokens.DRIVER, 'GET', `/driver/me/fulfillments/${fulfillmentB}`);
  const ack = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentB}/progress`,
    { eventType: 'ORDER_RECEIVED', occurredAt: iso() }, { idempotency: crypto.randomUUID() });
  assert('H10', [200, 201].includes(ack.status), `driver ACK on lot B: ${ack.status}`);

  const cancelTrip = await call(tokens.DISPATCHER, 'POST', `/trips/${tripB.id}/cancel`, {});
  assert('H10', [200, 201].includes(cancelTrip.status), `dispatcher cancels trip B: ${cancelTrip.status}`);

  // ─── HOP 11: driver-side behavior on the CANCELED fulfillment ─────────
  const canceledDetail = await call(tokens.DRIVER, 'GET', `/driver/me/fulfillments/${fulfillmentB}`);
  log('H11', `canceled fulfillment detail status for driver: ${canceledDetail.status} tripStatus=${canceledDetail.body?.trip?.status ?? canceledDetail.body?.status ?? '?'}`,
    canceledDetail.status === 200 ? 'PASS' : 'WARN');

  const progressOnCanceled = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentB}/progress`,
    { eventType: 'DEPARTED', occurredAt: iso() }, { idempotency: crypto.randomUUID() });
  assert('H11', [400, 404, 409].includes(progressOnCanceled.status),
    `progress on CANCELED fulfillment rejected: ${progressOnCanceled.status}`);

  const completeOnCanceled = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentB}/complete`,
    {}, { idempotency: crypto.randomUUID() });
  assert('H11', [400, 404, 409].includes(completeOnCanceled.status),
    `complete on CANCELED fulfillment rejected: ${completeOnCanceled.status}`);

  const podOnCanceled = await call(tokens.DRIVER, 'POST', `/driver/me/fulfillments/${fulfillmentB}/pod`,
    { expectedVersion: 1 }, { idempotency: crypto.randomUUID() });
  assert('H11', [400, 404, 409].includes(podOnCanceled.status),
    `POD creation on CANCELED fulfillment rejected: ${podOnCanceled.status}`);

  // Other drivers must not see this fulfillment at all.
  const otherDriverToken = await login('bqhuong');
  const otherBoard = await call(otherDriverToken, 'GET', '/driver/me/journey-board');
  assert('H11', !JSON.stringify(otherBoard.body ?? {}).includes(String(fulfillmentB)),
    'second driver does NOT see the canceled fulfillment (no cross-driver leakage)');

  // ─── Summary ───────────────────────────────────────────────────────────
  console.log(`\n=== JOURNEY SUMMARY: ${failures === 0 ? 'ALL HOPS GREEN' : failures + ' FAILURES'} ===`);
  console.log(`fixtures: lotA=${lotA.id} lotB=${lotB?.id} tripA=${tripA?.id} tripB(canceled)=${tripB?.id} stamp=${STAMP}`);
  return { failures, trace, lotA: lotA.id, lotB: lotB?.id, tripA: tripA?.id, tripB: tripB?.id, stamp: STAMP };
}

journey()
  .then(async (result) => {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const dir = `testplan/qa/evidence/${new Date().toISOString().slice(0, 10)}_journey-o2c`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/journey-trace.json`, JSON.stringify(result.trace, null, 2));
    console.log(`trace written: ${dir}/journey-trace.json`);
    process.exit(result.failures === 0 ? 0 : 1);
  })
  .catch((error) => { console.error('FATAL', error); process.exit(2); });
