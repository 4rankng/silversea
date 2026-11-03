// SIL-674 — rung-3 UI drive (AGENTS §9). QA staging 5b0bdad3: phát lệnh
// chân 2 của cặp Kẹp (vượt tải) trả 409 KEP_WEIGHT_WARNING và "dialog KHÔNG
// có nút vượt qua". This drive exercises the REAL quick-issue control on the
// dispatch detail plan grid of THIS worktree (frontend :7179 → backend :3017,
// both local dev): an over-capacity Kẹp pair (25t+25t on a 33t tractor)
// must surface a confirm DIALOG carrying the DOC verbatim message, and the
// confirmed click must flip the row to "Đã phát lệnh" with the trip row
// persisted (kepWeightWarningConfirmed retry, TC6(2) warn-once kept).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:7179';
const API = 'http://localhost:3017/api';
const ART = 'qa/2026-11-03-sil674';
mkdirSync(ART, { recursive: true });
const LOG = `${ART}/ui-driver.log`;
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const psql = (q) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-c', q], { encoding: 'utf8' }).trim();
const shipVersion = (id) => Number(psql(`SELECT version FROM shipments WHERE id = ${id}`)) || 1;
const ffVersion = (id) => Number(psql(`SELECT version FROM shipment_fulfillments WHERE id = ${id}`)) || 1;

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (res.status !== 200) throw new Error(`login ${identifier} -> ${res.status}`);
  const body = await res.json();
  return body.token ?? body.accessToken;
}
const send = async (token, apiPath, method = 'GET', payload) => {
  const res = await fetch(`${API}${apiPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      ...(payload ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
};

const day = new Date(Date.now() + (7 + Math.floor(Math.random() * 20)) * 24 * 3600e3).toISOString().slice(0, 10);
const at = (hh) => new Date(`${day}T${String(hh).padStart(2, '0')}:00:00+07:00`).toISOString();
const freeWithin = (column, id) => `NOT EXISTS (
  SELECT 1 FROM trips t WHERE t.${column} = ${id} AND t.deleted_at IS NULL AND t.status IN ('CREATED','IN_TRANSIT')
    AND t.planned_start_at < '${new Date(Date.now() + 8 * 24 * 3600e3).toISOString()}'::timestamptz
    AND coalesce(t.planned_end_at, t.planned_start_at + interval '8 hours') > '${at(6)}'::timestamptz)`;
const check10 = (prefix10) => {
  const MAP = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 18, H: 19, I: 20, J: 21, K: 22, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
  let sum = 0; const POW = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
  [...prefix10].forEach((ch, i) => { sum += (/\d/.test(ch) ? Number(ch) : MAP[ch]) * POW[i]; });
  return `${prefix10}${sum % 11 === 10 ? 0 : sum % 11}`;
};

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

(async () => {
  const admin = await login('admin');
  const dispatch = await login('dieuvan');
  log(`logged in admin + dieuvan; UI probe day=${day} base=${BASE}`);

  // Housekeeping — cancel ONLY this probe family's leftovers (BK-S674*),
  // so rigs from earlier runs stop hogging trucks and drivers.
  for (const entry of psql(`SELECT t.id, t.version FROM trips t
    JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    JOIN shipments sh ON sh.id = sf.shipment_id
    WHERE sh.bl_number LIKE 'BK-S674%' AND t.deleted_at IS NULL
      AND t.status IN ('CREATED','IN_TRANSIT') ORDER BY t.id`).split('\n').filter(Boolean)) {
    const [tripId, version] = entry.split('|').map(Number);
    const cancel = await send(admin, `/trips/${tripId}/cancel`, 'POST', { expectedVersion: version, reason: 'SIL-674 UI housekeeping' });
    log(`housekeeping: cancel trip ${tripId} → ${cancel.status}`);
  }

  // ── Stage the over-capacity Kẹp pair via API (dieuvan) ──────────────────
  // The UI quick-issue rides the TRUCK'S CURRENT COUPLING (trailerId omitted),
  // so leg A must be issued on that same coupling — otherwise the declared
  // partner carve misses on a trailer mismatch and a different warn tier fires.
  const truckId = Number(psql(`SELECT tk.id FROM trucks tk WHERE tk.deleted_at IS NULL AND tk.status = 'ACTIVE'
    AND tk.current_trailer_id IS NOT NULL AND ${freeWithin('truck_id', 'tk.id')} ORDER BY tk.id LIMIT 1`));
  const driverId = Number(psql(`SELECT d.id FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.deleted_at IS NULL AND d.status = 'ACTIVE' AND u.deleted_at IS NULL AND u.status = 'ACTIVE' AND u.role = 'DRIVER' AND ${freeWithin('driver_id', 'd.id')} ORDER BY d.id LIMIT 1`));
  const truck = await send(admin, `/trucks/${truckId}`);
  const trailerId = truck.body.currentTrailerId;
  const towed = await send(admin, `/trucks/${truckId}`, 'PUT', {
    licensePlate: truck.body.licensePlate, currentTrailerId: trailerId, status: 'ACTIVE', towCapacityTons: 33,
  }, { 'If-Unmodified-Since': String(truck.body.updatedAt) });
  log(`stage: tow PUT → ${towed.status}`);
  const paired = await send(dispatch, `/shipments/dispatch-fleet/trucks/${truckId}/assigned-driver`, 'PATCH', { driverId });
  const towStored = psql(`SELECT tow_capacity_tons FROM trucks WHERE id = ${truckId}`);
  log(`rig: truck=${truckId} tow_capacity_tons=${towStored} coupling=${trailerId} driver=${driverId} paired→${paired.status}`);
  if (towStored === '' || towStored === 'NULL') throw new Error('towCapacityTons did not persist');

  const [routesRes, ctypesRes, portsRes, customersRes] = await Promise.all([
    send(admin, '/routes?limit=50'),
    send(admin, '/container-types?limit=50'),
    send(admin, '/ports?limit=50'),
    send(admin, '/customers?limit=100'),
  ]);
  const route = routesRes.body?.items?.find((r) => /KCN|TUYẾN|M57|HN|HCM/i.test(`${r.code ?? ''} ${r.name ?? ''}`)) ?? routesRes.body?.items?.[0];
  const type20 = (ctypesRes.body?.items ?? []).find((t) => /^20/.test(t.code ?? ''));
  const ports = portsRes.body?.items ?? [];
  const customer = (customersRes.body?.items ?? []).find((c) => c.status === 'ACTIVE' && !c.isCarrier);
  const siteRes = await send(admin, `/shipments/operational-sites?customerId=${customer.id}`);
  let site = (siteRes.body?.items ?? []).filter((x) => x.siteType === 'FACTORY' && (x.routeId == null || x.routeId === route.id)).at(-1);
  if (!site) {
    const made = await send(admin, '/shipments/operational-sites', 'POST', {
      customerId: customer.id, code: `S674UI-${Date.now() % 100000}`,
      name: `Nhà máy S674 UI ${Date.now() % 100000}`, siteType: 'FACTORY',
      routeId: route.id, address: 'Khu công nghiệp QA repro, Việt Nam',
    });
    site = made.status === 201 ? made.body : null;
  }

  const bl = `BK-S674UI-${Date.now()}`;
  const created = await send(admin, '/shipments', 'POST', {
    customerId: customer.id, tradeDirection: 'IMPORT', cargoMode: 'FCL', blNumber: bl, expectedDeliveryDate: day,
  });
  log(`stage: lot create → ${created.status} ${created.status >= 400 ? JSON.stringify(created.body).slice(0, 200) : ''}`);
  const shipmentId = created.body?.shipment?.id ?? created.body?.id;
  const serialBase = Number(String(Date.now()).slice(-6));
  const conts = await send(admin, `/shipments/${shipmentId}/containers`, 'PUT', {
    expectedVersion: shipVersion(shipmentId),
    containers: [0, 1].map((i) => ({
      containerNumber: check10(`TSTU${String(serialBase + i).padStart(6, '0')}`),
      containerTypeId: type20.id, routeId: route.id, operationalSiteId: site?.id,
      pickupPortId: (ports[0] ?? ports[1]).id, dropoffPortId: (ports[1] ?? ports[0]).id,
      cargoWeightKg: 25000, customerAppointmentAt: at(8),
    })),
  });
  log(`stage: containers → ${conts.status} ${conts.status >= 400 ? JSON.stringify(conts.body).slice(0, 240) : ''}`);
  const submitted = await send(admin, `/shipments/${shipmentId}/submit-for-dispatch`, 'POST', { expectedVersion: shipVersion(shipmentId) });
  log(`stage: submit → ${submitted.status} ${submitted.status >= 400 ? JSON.stringify(submitted.body).slice(0, 240) : ''}`);
  if (!(conts.status === 200 || conts.status === 201)) throw new Error(`containers PUT failed: ${conts.status}`);
  if (!(submitted.status === 200 || submitted.status === 201)) throw new Error(`submit failed: ${submitted.status}`);
  let legA; let legB;
  for (let attempt = 0; attempt < 6 && !(legA && legB); attempt += 1) {
    await new Promise((r) => setTimeout(r, 1500));
    const rowsRes = await send(dispatch, `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`);
    const unissued = (rowsRes.body?.items ?? []).filter((r) => r.dispatch?.tripId == null);
    log(`plan rows attempt ${attempt}: total=${(rowsRes.body?.items ?? []).length} unissued=${unissued.length}`);
    [legA, legB] = unissued;
  }
  if (!legA || !legB) throw new Error('expected 2 plan rows');
  for (const row of [legA, legB]) {
    const patched = await send(dispatch, `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, 'PATCH', {
      expectedFulfillmentVersion: ffVersion(row.fulfillmentId),
      expectedShipmentVersion: shipVersion(shipmentId),
      carrierType: 'OWN', truckId,
      classification: 'DOUBLE', plannedRevenue: 0, plannedCarrierCost: 0,
    });
    if (patched.status !== 200) throw new Error(`plan-save → ${patched.status} ${JSON.stringify(patched.body).slice(0, 200)}`);
  }
  const leg1 = await send(dispatch, `/shipments/${shipmentId}/dispatch`, 'POST', {
    fulfillmentId: legA.fulfillmentId, expectedVersion: ffVersion(legA.fulfillmentId),
    plannedStartAt: at(8), plannedEndAt: at(12), endTimeConfirmed: true,
    carrierType: 'OWN', truckId, driverId, trailerId,
  });
  log(`API staged: leg1 issue → ${leg1.status} ${leg1.body?.trip?.id ?? JSON.stringify(leg1.body).slice(0, 160)}`);
  check('stage: leg1 (25t) issues clean via API', leg1.status === 200 || leg1.status === 201, `status=${leg1.status}`);
  const plate = psql(`SELECT license_plate FROM trucks WHERE id = ${truckId}`);
  log(`legB row fulfillment=${legB.fulfillmentId} plate=${plate} — leaving it for the UI drive`);

  // ── UI drive: the real "Phát lệnh" control on /dispatch-detail ──────────
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox'],
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dispatch);
  page.on('response', async (res) => {
    if (res.url().includes('/dispatch') && res.status() >= 400) {
      log(`network: ${res.request().method()} ${res.url().replace(BASE, '')} → ${res.status()}`);
    }
  });
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  await page.screenshot({ path: `${ART}/ui-1-grid-loaded.png` });

  // Filter to the probe lot so the row is on screen — the GRID's own filter
  // (placeholder "Bill, Cont, Tờ khai…"), not the header's global search.
  const filterInput = await page.$('input[placeholder*="Bill"]');
  if (filterInput) {
    await filterInput.type(bl);
    await sleep(2500);
    log('typed the probe BL into the grid filter');
  } else {
    log('WARN: grid filter input not found — searching all rows');
  }
  await page.screenshot({ path: `${ART}/ui-2-grid-filtered.png` });

  // Find the leg B row (the one whose BL shows and whose trip is not issued)
  // and click its quick-issue control.
  const clicked = await page.evaluate((blText) => {
    const rows = [...document.querySelectorAll('tr, [class*="card"]')]
      .filter((el) => el.textContent?.includes(blText));
    for (const rowEl of rows) {
      const btn = [...rowEl.querySelectorAll('button')]
        .find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Phát lệnh') && !b.getAttribute('aria-disabled'));
      if (btn) { btn.click(); return btn.getAttribute('aria-label'); }
    }
    return null;
  }, bl);
  check('UI: leg B quick-issue control clicked', clicked != null, `aria-label=${clicked}`);
  if (clicked == null) {
    await page.screenshot({ path: `${ART}/ui-x-no-button.png` });
    await browser.close();
    process.exit(1);
  }
  log(`clicked: ${clicked}`);

  // The confirm dialog must appear — the QA complaint was its absence.
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  const dialogProbe = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    return {
      message: dialog?.querySelector('.confirm-message')?.textContent ?? dialog?.textContent ?? '',
      buttons: [...(dialog?.querySelectorAll('button') ?? [])].map((b) => b.textContent?.trim()),
    };
  });
  log(`dialog: buttons=${JSON.stringify(dialogProbe.buttons)} message="${dialogProbe.message.slice(0, 140)}"`);
  await page.screenshot({ path: `${ART}/ui-3-weight-warning-dialog.png` });
  check('UI: weight warning DIALOG renders (role=dialog) — QA "KHÔNG có nút vượt qua" disproven',
    dialogProbe.buttons.length >= 2, `buttons=${JSON.stringify(dialogProbe.buttons)}`);
  check('UI: dialog carries the DOC verbatim weight message',
    dialogProbe.message.includes('vượt tải trọng cho phép'), dialogProbe.message.slice(0, 120));

  // Confirm → the flagged retry issues the order.
  const confirmClicked = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const btn = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => (b.textContent ?? '').trim() === 'Xác nhận');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('UI: "Xác nhận" bypass button clicked', confirmClicked, 'confirm-label=Xác nhận');
  await sleep(3000);
  await page.screenshot({ path: `${ART}/ui-4-after-confirm.png` });

  // Post-click DOM assertion: the row flipped to issued (no more quick-issue
  // control for this BL; the issued chip/label appears).
  const postProbe = await page.evaluate((blText) => {
    const rows = [...document.querySelectorAll('tr, [class*="card"]')]
      .filter((el) => el.textContent?.includes(blText));
    const issuedChip = rows.some((el) => el.textContent?.includes('Đã phát lệnh'));
    const stillUnissued = rows.some((el) => [...el.querySelectorAll('button')]
      .some((b) => (b.getAttribute('aria-label') ?? '').startsWith('Phát lệnh')));
    return { issuedChip, stillUnissued, rowCount: rows.length };
  }, bl);
  log(`post-click DOM: ${JSON.stringify(postProbe)}`);
  check('UI: leg B row flipped to "Đã phát lệnh" after the confirmed bypass',
    postProbe.issuedChip && !postProbe.stillUnissued, JSON.stringify(postProbe));

  // DB side-effect proof: the leg B trip exists on the probe rig.
  const legBTrip = psql(`SELECT t.id || '|' || t.status || '|' || coalesce(t.vehicle_capacity_kg::text, 'NULL')
    FROM trips t JOIN shipment_fulfillments sf ON sf.id = t.fulfillment_id
    WHERE sf.id = ${legB.fulfillmentId} AND t.deleted_at IS NULL ORDER BY t.id DESC LIMIT 1`);
  log(`DB side effect: leg B trip row = '${legBTrip}'`);
  check('DB: leg B trip persisted with the resolved capacity 33000',
    /^\d+\|CREATED\|33000/.test(legBTrip), legBTrip);

  await browser.close();
  log(failures === 0 ? 'UI DRIVE COMPLETE — all expectations hold' : `UI DRIVE COMPLETE — ${failures} expectation(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => { log(`UI DRIVE CRASHED: ${err.message}`); process.exit(2); });
