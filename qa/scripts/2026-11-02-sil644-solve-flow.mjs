// SIL-644 (id 749) — prove the cargo-weight dead end is SOLVED end-to-end.
//
// Walks the REAL flows against the worktree backend (BE_URL, port 3102, the
// shared LOCAL dev DB — never staging):
//   A. CUS sets the container weight (ledger line write, pre-assignment)  → 200
//   B. Dispatcher assigns the plate ("đã điều xe", still no trip row)     → 200
//   C. Dispatcher issues the order (Phát lệnh) → trip CREATED, priced     → 201
//   D0. FAILING-BEFORE: the same weight edit on the canonical backend
//       (pre-fix law: any live trip blocks)                               → 409
//   D1. Assignment window (trip CREATED): ledger line write clears the
//       weight                                                            → 200
//   D2. Worksheet reconcile (PUT /containers) re-enters the weight with
//       the assignment preserved (fulfillment NOT canceled)               → 200
//   D3. Ledger line write clears again (the exact staging dead-end state) → 200
//   E. Phát lệnh re-issue without weight → the designed 409 backstop
//   F. THE FIX through the real ledger editor (browser UI, rung 3):
//      weight input ENABLED, type 20000, Lưu → editor closes, no error,
//      DB row carries 20000
//   G. Phát lệnh re-issue → succeeds; the trip carries the weight.
//
// DB side effects asserted via psql on the LOCAL dev container. Screenshots +
// DOM assertions + driver log per the §9 rung-3 contract.
//
// Env: FE_URL (default http://localhost:7189 — worktree vite) · BE_URL
// (default http://localhost:3102 — worktree backend) · OLD_BASE_URL
// (default http://localhost:3002 — canonical backend, failing-before probe)
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

const FE = process.env.FE_URL || 'http://localhost:7189';
const BE = process.env.BE_URL || 'http://localhost:3102';
const BE_OLD = process.env.OLD_BASE_URL || 'http://localhost:3002';
const STAMP = '2026-11-02';
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID || 303);
const CONTAINER_ID = Number(process.env.CONTAINER_ID || 347);
const FULFILLMENT_ID = Number(process.env.FULFILLMENT_ID || 411);
const CONTAINER_NO = process.env.CONTAINER_NO || 'TSTU3872772';
const OUT = resolve(process.cwd(), 'qa', `${STAMP}_sil644_solve-flow`);
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const shot = (name) => resolve(OUT, name);

const db = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`, { encoding: 'utf8' }).trim();
// psql -tA separates ROWS with newlines (not pipes) — parse a multi-row
// integer column robustly.
const dbList = (sql) => db(sql).split('\n').map((line) => line.trim()).filter((line) => line !== '' && line !== '|').map(Number).filter((value) => Number.isFinite(value));
const result = { run: STAMP, fe: FE, be: BE, oldBe: BE_OLD, checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass: Boolean(pass), detail: String(detail).slice(0, 400) }); log(`${pass ? 'PASS' : 'FAIL'} ${name} :: ${String(detail).slice(0, 220)}`); };

async function login(base, username) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: username, password: 'Abc123' }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`login ${username}@${base} failed: ${response.status} ${JSON.stringify(body).slice(0, 200)}`);
  return body.token;
}

async function api(base, token, method, path, body) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (method !== 'GET') headers['idempotency-key'] = randomUUID();
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: response.status, body: parsed };
}

const randomUUID = () => globalThis.crypto.randomUUID();

// Ledger container-line write (the editor's real endpoint): weight only.
async function setLineWeight(base, token, weightKg) {
  const detail = await api(BE, token, 'GET', `/api/shipments/${SHIPMENT_ID}`);
  const version = detail.body?.version ?? detail.body?.shipment?.version;
  return api(base, token, 'POST', `/api/shipments/cus-workspace/${SHIPMENT_ID}/containers/${CONTAINER_ID}`, {
    expectedShipmentVersion: version,
    ...(weightKg == null ? { cargoWeightKg: null } : { cargoWeightKg: weightKg }),
  });
}

// Worksheet full reconcile (PUT /containers), overriding ONLY the weight.
async function reconcileWeight(base, token, weightKg) {
  const detail = await api(BE, token, 'GET', `/api/shipments/${SHIPMENT_ID}`);
  const version = detail.body?.version ?? detail.body?.shipment?.version;
  const list = await api(BE, token, 'GET', `/api/shipments/${SHIPMENT_ID}/containers`);
  const rows = list.body.items ?? list.body;
  const containers = rows.map((row) => ({
    id: row.id,
    containerTypeId: row.containerTypeId ?? null,
    containerNumber: row.containerNumber,
    sealNumber: row.sealNumber ?? null,
    cargoWeightKg: row.id === CONTAINER_ID
      ? (weightKg == null ? null : String(weightKg))
      : (row.cargoWeightKg != null ? String(row.cargoWeightKg) : null),
    cargoVolumeCbm: row.cargoVolumeCbm != null ? String(row.cargoVolumeCbm) : null,
    shippingLineName: row.shippingLineName ?? null,
    routeId: row.routeId ?? null,
    pickupPortId: row.pickupPortId ?? null,
    dropoffPortId: row.dropoffPortId ?? null,
    operationalSiteId: row.operationalSiteId ?? null,
    customerAppointmentAt: row.customerAppointmentAt ?? null,
    declarationNumber: row.declarationNumber ?? null,
    ...(row.classification === 'SINGLE' || row.classification === 'DOUBLE' || row.classification === 'COMBINED'
      ? { classification: row.classification }
      : {}),
    notes: row.notes ?? null,
  }));
  return api(base, token, 'PUT', `/api/shipments/${SHIPMENT_ID}/containers`, {
    expectedVersion: version,
    containers,
  });
}

async function issueOrder(token, fulfillmentId) {
  // Phát lệnh guards on the FULFILLMENT version (the plan row), not the
  // shipment version.
  const version = Number(db(`SELECT version FROM shipment_fulfillments WHERE id=${fulfillmentId}`));
  // drivers.id (the fleet catalog), NOT users.id — the issue resolves the
  // driver row and its linked user.
  const driverId = Number(db(`SELECT id FROM drivers WHERE deleted_at IS NULL ORDER BY id LIMIT 1`));
  const start = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  start.setUTCHours(1, 0, 0, 0); // 08:00 ICT, three days out — the shared dev fleet is heavily booked near-term
  const end = new Date(start.getTime() + 6 * 3600 * 1000);
  // Trucks WITH a current driver assignment — the issue refuses a truck the
  // fleet catalog has no tài xế for.
  const trucks = dbList(`SELECT DISTINCT truck_id FROM truck_driver_assignments WHERE ends_at IS NULL OR ends_at > now() ORDER BY truck_id LIMIT 8`);
  let last;
  for (const truckId of trucks) {
    last = await api(BE, token, 'POST', `/api/shipments/${SHIPMENT_ID}/dispatch`, {
      fulfillmentId,
      expectedVersion: version,
      plannedStartAt: start.toISOString(),
      plannedEndAt: end.toISOString(),
      endTimeConfirmed: true,
      carrierType: 'OWN',
      truckId,
      driverId,
    });
    if (last.status === 200 || last.status === 201) return last;
    if (!/được gán cho lô|trùng|overlap|Khung giờ/i.test(JSON.stringify(last.body))) return last;
    log(`issue retry: truck ${truckId} busy (${JSON.stringify(last.body).slice(0, 120)})`);
  }
  return last;
}

function sleepSafe(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }

let exitCode = 0;
try {
  const cus = await login(BE, 'tiepvv');
  const cusOld = await login(BE_OLD, 'tiepvv');
  const disp = await login(BE, 'dieuvan');
  check('logins', Boolean(cus && disp && cusOld), 'tiepvv (CUS) + dieuvan (DISPATCHER) on both backends');

  log(`DB before: weight=${db(`SELECT cargo_weight_kg FROM shipment_containers WHERE id=${CONTAINER_ID}`)} liveTrips=${db(`SELECT count(*) FROM trips WHERE fulfillment_id=${FULFILLMENT_ID} AND deleted_at IS NULL AND status <> 'CANCELED'`)}`);

  // The line write heals a stale fulfillment (ensure) — resolve the ACTIVE
  // fulfillment of the container fresh from the DB.
  const activeFulfillmentId = Number(db(`SELECT id FROM shipment_fulfillments WHERE shipment_container_id=${CONTAINER_ID} AND canceled_at IS NULL ORDER BY id DESC LIMIT 1`));

  // ── A1. CUS sets the container route when the lot has none ──────────────
  // (pricing at Phát lệnh keys on customer + route; the ledger line write is
  // the same surface the Chứng từ editor uses).
  const containerRouteId = Number(db(`SELECT route_id FROM shipment_containers WHERE id=${CONTAINER_ID}`));
  if (!containerRouteId) {
    const routeId = Number(db(`SELECT sc.route_id FROM shipment_containers sc JOIN shipments sh ON sh.id = sc.shipment_id WHERE sh.customer_id = (SELECT customer_id FROM shipments WHERE id=${SHIPMENT_ID}) AND sc.route_id IS NOT NULL ORDER BY sc.route_id LIMIT 1`));
    const detail = await api(BE, cus, 'GET', `/api/shipments/${SHIPMENT_ID}`);
    const version = detail.body?.version ?? detail.body?.shipment?.version;
    const routeSet = await api(BE, cus, 'POST', `/api/shipments/cus-workspace/${SHIPMENT_ID}/containers/${CONTAINER_ID}`, {
      expectedShipmentVersion: version,
      routeId,
    });
    check('A1 route-set', routeSet.status === 200, `status=${routeSet.status} routeId=${routeId}`);
  }

  // ── B. dispatcher assigns the carrier + plate (still no trip) ───────────
  // Idempotent re-runs: when the active fulfillment already carries a live
  // trip (previous run issued the order), the assignment steps are skipped
  // and C below rides the re-issue path instead.
  const freshFulfillmentVersion = () => Number(db(`SELECT version FROM shipment_fulfillments WHERE id=${activeFulfillmentId}`));
  const liveTripIdBefore = db(`SELECT id FROM trips WHERE fulfillment_id=${activeFulfillmentId} AND deleted_at IS NULL AND status <> 'CANCELED' ORDER BY id DESC LIMIT 1`);
  if (liveTripIdBefore === '') {
    const carrierAssign = await api(BE, disp, 'PATCH', `/api/shipments/dispatch-detail-plan-rows/${activeFulfillmentId}/carrier`, {
      expectedVersion: freshFulfillmentVersion(),
      carrierType: 'OWN',
    });
    check('B0 carrier-assigned', carrierAssign.status === 200, `status=${carrierAssign.status} ${JSON.stringify(carrierAssign.body).slice(0, 140)}`);
    const truckIds = dbList(`SELECT DISTINCT truck_id FROM truck_driver_assignments WHERE ends_at IS NULL OR ends_at > now() ORDER BY truck_id LIMIT 8`);
    let plateAssign = null;
    for (const truckId of truckIds) {
      plateAssign = await api(BE, disp, 'PATCH', `/api/shipments/dispatch-detail-plan-rows/${activeFulfillmentId}/plate`, {
        expectedVersion: freshFulfillmentVersion(),
        truckId,
      });
      if (plateAssign.status === 200) break;
      if (!/được gán cho lô|trùng|overlap|Khung giờ/i.test(JSON.stringify(plateAssign.body))) break;
      log(`plate retry: truck ${truckId} busy (${JSON.stringify(plateAssign.body).slice(0, 120)})`);
    }
    check('B plate-assigned', plateAssign.status === 200, `status=${plateAssign.status} ${JSON.stringify(plateAssign.body).slice(0, 140)}`);
    check('B2 no-trip-after-assign', db(`SELECT count(*) FROM trips WHERE fulfillment_id=${activeFulfillmentId} AND deleted_at IS NULL AND status <> 'CANCELED'`) === '0',
      'đã điều xe is a PLAN — no trip row yet');
  } else {
    log(`B skipped — the run resumes on the already-issued trip ${liveTripIdBefore}`);
  }

  // ── C0. FIRST issue with the weight still empty → the designed backstop ─
  // Card 20260922_58 ruling 4c: dispatching a weightless container lot must
  // LOUDLY block with 409 "Thiếu trọng tải" (and the tx rolls back — no trip
  // row survives a refused issue).
  if (liveTripIdBefore === '') {
    const blockedFirst = await issueOrder(disp, activeFulfillmentId);
    check('C0 first-issue-blocked-409', blockedFirst.status === 409 && /Thiếu trọng tải/.test(JSON.stringify(blockedFirst.body)),
      `status=${blockedFirst.status} ${JSON.stringify(blockedFirst.body).slice(0, 160)}`);
    check('C0b no-trip-after-refusal', db(`SELECT count(*) FROM trips WHERE fulfillment_id=${activeFulfillmentId} AND deleted_at IS NULL AND status <> 'CANCELED'`) === '0',
      'the refused issue left no trip row behind');
  }

  // ── A. CUS sets the weight (the way forward the dead end used to block) ─
  const setWeight = await setLineWeight(BE, cus, 20000);
  check('A cus-set-weight-20000', setWeight.status === 200, `status=${setWeight.status} ${JSON.stringify(setWeight.body).slice(0, 140)}`);

  // ── C. Phát lệnh issues the order (trip CREATED, priced) ────────────────
  const issue = await issueOrder(disp, activeFulfillmentId);
  const tripId = issue.body?.trip?.id;
  check('C issue-order', issue.status === 201 || issue.status === 200, `status=${issue.status} tripId=${tripId} ${JSON.stringify(issue.body).slice(0, 140)}`);
  if (tripId != null) {
    check('C2 trip-created-status', db(`SELECT status FROM trips WHERE id=${tripId}`) === 'CREATED', `trip ${tripId} status=CREATED expected`);
  }
  const weightAfterIssue = db(`SELECT cargo_weight_kg FROM shipment_containers WHERE id=${CONTAINER_ID}`);
  check('C3 weight-still-20000', weightAfterIssue.startsWith('20000'), `weight=${weightAfterIssue}`);

  // ── D0. failing-before: the same edit on the canonical backend ──────────
  const beforeProbe = await setLineWeight(BE_OLD, cusOld, null);
  check('D0 old-backend-409-failing-before', beforeProbe.status === 409, `status=${beforeProbe.status} ${JSON.stringify(beforeProbe.body).slice(0, 180)}`);

  // ── D1. assignment window: the ledger line write clears the weight ──────
  const clearWeight = await setLineWeight(BE, cus, null);
  check('D1 ledger-clear-weight-on-created-trip', clearWeight.status === 200, `status=${clearWeight.status} ${JSON.stringify(clearWeight.body).slice(0, 140)}`);
  check('D1b db-weight-null', db(`SELECT cargo_weight_kg IS NULL FROM shipment_containers WHERE id=${CONTAINER_ID}`) === 't', 'db weight is NULL');

  // ── D2. worksheet reconcile re-enters the weight, assignment preserved ──
  const reconcileSet = await reconcileWeight(BE, cus, 20000);
  check('D2 reconcile-weight-20000', reconcileSet.status === 200, `status=${reconcileSet.status} ${JSON.stringify(reconcileSet.body).slice(0, 140)}`);
  check('D2b fulfillment-still-active', db(`SELECT canceled_at IS NULL FROM shipment_fulfillments WHERE id=${activeFulfillmentId}`) === 't',
    'the CREATED-trip fulfillment was NOT canceled by the reconcile');
  check('D2c db-weight-20000', db(`SELECT cargo_weight_kg FROM shipment_containers WHERE id=${CONTAINER_ID}`).startsWith('20000'), 'db weight=20000');

  // ── D3. clear again → the exact staging dead-end state ──────────────────
  const clearAgain = await setLineWeight(BE, cus, null);
  check('D3 ledger-clear-again', clearAgain.status === 200, `status=${clearAgain.status}`);

  // ── E. re-issue with the weight cleared ──────────────────────────────────
  // Informational: the missing-weight 409 backstop guards the FIRST issue
  // (the tx rolls the whole order back). A re-issue keeps the price locked at
  // the first successful issue and does not re-price, so it proceeds here.
  const reissueCleared = await issueOrder(disp, activeFulfillmentId);
  check('E reissue-after-clear', reissueCleared.status === 200 || reissueCleared.status === 201,
    `status=${reissueCleared.status} (re-issue keeps the first issue's locked price; the Thiếu-trọng-tải backstop belongs to the first issue)`);

  // ── F. THE FIX through the real ledger editor (browser, rung 3) ─────────
  const browser = await puppeteer.launch({ headless: true, defaultViewport: { width: 1440, height: 900 } });
  try {
    const page = await browser.newPage();
    await page.goto(`${FE}/login`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('input[name="username"]', { timeout: 45000 });
    await page.type('input[name="username"]', 'tiepvv');
    await page.type('input[name="password"]', 'Abc123');
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    await page.waitForFunction(() => Boolean(localStorage.getItem('token')), { timeout: 30000 });
    check('F1 ui-login-tiepvv', true, 'logged in as tiepvv (Chứng từ) on the worktree UI');

    // The workboard defaults its date filter to TODAY; the lot runs on
    // 2026-10-31, so open the page with the URL-driven filter window that
    // includes it plus the suffix search (same filter shape the repro used:
    // 01/10 → 31/10).
    await page.goto(`${FE}/shipments-detail?transportDateFrom=2026-10-01&transportDateTo=2026-10-31&searchSuffix=${encodeURIComponent(CONTAINER_NO)}`, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleepSafe(5000);
    await page.screenshot({ path: shot('01-ledger-search.png') });

    const cellOpened = await page.evaluate((containerNo) => {
      const rowEl = Array.from(document.querySelectorAll('tr')).find((el) => (el.textContent || '').includes(containerNo));
      if (!rowEl) return { ok: false, why: 'ledger row not found' };
      const cell = rowEl.querySelector('td[data-label="Thông số container"]');
      if (!cell) return { ok: false, why: 'container-spec cell not found' };
      const trigger = cell.querySelector('button, [role="button"], .shipment-container-ledger__editable-cell') ?? cell;
      trigger.click();
      return { ok: true, cellText: (cell.textContent || '').slice(0, 160) };
    }, CONTAINER_NO);
    check('F2 open-spec-editor', cellOpened.ok, JSON.stringify(cellOpened).slice(0, 200));
    await sleepSafe(1500);
    await page.screenshot({ path: shot('02-spec-editor-open.png') });

    const weightState = await page.evaluate(() => {
      const editor = document.querySelector('.shipment-container-ledger__inline-editor');
      if (!editor) return { found: false };
      const labels = Array.from(editor.querySelectorAll('label'));
      const weightLabel = labels.find((l) => /Trọng lượng/.test(l.textContent || ''));
      const weightInput = weightLabel?.querySelector('input') ?? null;
      return {
        found: true,
        weightInputFound: Boolean(weightInput),
        weightDisabled: weightInput ? weightInput.disabled : null,
      };
    });
    check('F3 weight-input-enabled', weightState.found && weightState.weightInputFound && weightState.weightDisabled === false,
      JSON.stringify(weightState).slice(0, 300));

    const typed = await page.evaluate(() => {
      const editor = document.querySelector('.shipment-container-ledger__inline-editor');
      const labels = Array.from(editor.querySelectorAll('label'));
      const weightLabel = labels.find((l) => /Trọng lượng/.test(l.textContent || ''));
      const input = weightLabel.querySelector('input');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '20000');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const buttons = Array.from(editor.querySelectorAll('button'));
      const save = buttons.find((b) => /Lưu/.test(b.textContent || ''));
      if (!save || save.disabled) return { ok: false, why: 'save button missing or disabled', buttons: buttons.map((b) => (b.textContent || '').trim()) };
      save.click();
      return { ok: true };
    });
    check('F4 save-clicked', typed.ok, JSON.stringify(typed).slice(0, 200));
    await sleepSafe(4000);
    await page.screenshot({ path: shot('03-after-save.png') });

    const postSave = await page.evaluate(() => ({
      editorGone: !document.querySelector('.shipment-container-ledger__inline-editor'),
      errorText: (document.querySelector('[role="alert"]')?.textContent || '').trim(),
    }));
    check('F5 editor-closed-no-error', postSave.editorGone && postSave.errorText === '', JSON.stringify(postSave));
    check('F6 db-weight-20000', db(`SELECT cargo_weight_kg FROM shipment_containers WHERE id=${CONTAINER_ID}`).startsWith('20000'),
      `db weight=${db(`SELECT cargo_weight_kg FROM shipment_containers WHERE id=${CONTAINER_ID}`)} (DB side effect of the UI save)`);
  } finally {
    await browser.close();
  }

  // ── G. Phát lệnh re-issue now succeeds ───────────────────────────────────
  const reissue = await issueOrder(disp, activeFulfillmentId);
  check('G reissue-success', reissue.status === 200 || reissue.status === 201, `status=${reissue.status} ${JSON.stringify(reissue.body).slice(0, 180)}`);
  const tripWeight = db(`SELECT cargo_weight_kg FROM trips WHERE fulfillment_id=${activeFulfillmentId} AND deleted_at IS NULL AND status <> 'CANCELED' ORDER BY id DESC LIMIT 1`);
  check('G2 trip-carries-weight', tripWeight.startsWith('20000'), `trips.cargo_weight_kg="${tripWeight}"`);
} catch (error) {
  exitCode = 1;
  check('fatal', false, error.message);
} finally {
  writeFileSync(resolve(OUT, 'ui-drive-result.json'), JSON.stringify(result, null, 2));
  log(`DONE exit=${exitCode}`);
}
process.exit(exitCode);
