// Card 20261004_353 — Kẹp 2×20' merge, full end-to-end on STAGING (build 19ed100f).
// Fixture: one FCL lot, 2×20DC containers, both carrier-allocated OWN, PHÂN LOẠI
// Kẹp (DOUBLE), both issued on the SAME rig (truck 14 / trailer 13 / driver 19)
// so the Kẹp resource exemption applies; then the dispatcher runs the
// "Ghép chuyến điều vận" dialog for real and submits.
import fs from 'node:fs';
import {
  STAGING, loginApi, apiClient, health, BUILD_EXPECTED, launch, auth, tapSel, shot,
  setViewport, sleep, uuiSelect, closeStrayDialog, rowIndex,
} from './qa-20261005-lib.mjs';

const EVID = 'testplan/qa/evidence/2026-10-05_353-kep-merge-khong-the-hoan-tat/shots';
fs.mkdirSync(EVID, { recursive: true });

const healthBefore = await health();
if (healthBefore.buildHash !== BUILD_EXPECTED) {
  console.log(JSON.stringify({ BLOCKED: 'stale build', healthBefore, expected: BUILD_EXPECTED }));
  process.exit(2);
}
console.log('health', JSON.stringify(healthBefore));

const { token } = await loginApi('dungnv');
const api = apiClient(token);
const steps = [];
const rec = (name, r) => {
  steps.push({ name, status: r.status, body: typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 500) : r.body });
  console.log(name, r.status, JSON.stringify(r.body).slice(0, 240));
  return r;
};

const L = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
function cnum(prefix, serial) {
  const body = `${prefix}${String(serial).padStart(6, '0')}`;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) sum += (i < 4 ? L[body[i]] : Number(body[i])) * 2 ** i;
  return `${body}${(sum % 11) % 10}`;
}
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
const serialBase = (Number(stamp.slice(-5)) % 800) + 100;
const CONT_A = cnum('QATU', serialBase * 2);
const CONT_B = cnum('QATU', serialBase * 2 + 1);
const BL = `QA353KEP-${stamp}`;
const RIG = { truckId: 14, driverId: 19, trailerId: 13, plate: '15H-118.47' };
const TAX = { customerId: 92, routeId: 12, pickupPortId: 1, dropoffPortId: 13, containerTypeId: 1 };
console.log('fixture', { BL, CONT_A, CONT_B, RIG });

const created = rec('create lot', await api('POST', '/shipments', {
  customerId: TAX.customerId, cargoMode: 'FCL', tradeDirection: 'IMPORT',
  blNumber: BL, shippingLineName: 'QA Line',
  customerNotes: `QA353 fixture ${stamp} — Kẹp merge e2e. Xoá được sau QA.`,
}));
const shipmentId = created.body.id ?? created.body.shipment?.id;
let version = created.body.version ?? created.body.shipment?.version ?? 1;

const appt = new Date();
appt.setHours(8, 0, 0, 0);
const containers = [CONT_A, CONT_B].map((n) => ({
  containerNumber: n, containerTypeId: TAX.containerTypeId, routeId: TAX.routeId,
  pickupPortId: TAX.pickupPortId, dropoffPortId: TAX.dropoffPortId,
  shippingLineName: 'QA Line', cargoWeightKg: '15000',
  customerAppointmentAt: appt.toISOString(),
}));
rec('containers', await api('PUT', `/shipments/${shipmentId}/containers`, { expectedVersion: version, containers }));
const detail = await api('GET', `/shipments/cus-workspace/${shipmentId}`);
version = detail.body?.summary?.version ?? detail.body?.version ?? version;

rec('alloc', await api('POST', `/shipments/${shipmentId}/carrier-allocations?mode=partial`, {
  expectedVersion: version,
  carrierAllocations: [{ carrierType: 'OWN', count20: 2, count40: 0 }],
}));

const rowsOf = (body) => (body?.items ?? body?.rows ?? body ?? []);
const rowsRes = await api('GET', `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(BL)}&limit=50`);
const rows = rowsOf(rowsRes.body);
console.log('rows shape keys', rows[0] ? Object.keys(rows[0]).slice(0, 40) : 'none');
const myRows = rows.filter((r) => String(r.container?.containerNumber ?? r.containerNumber ?? '').startsWith('QATU'));
console.log('my rows', JSON.stringify(myRows.map((r) => ({ fid: r.fulfillmentId ?? r.id, v: r.version, sv: r.shipmentVersion, c: r.container?.containerNumber ?? r.containerNumber, cl: r.classification }))));
if (myRows.length !== 2) throw new Error(`expected 2 rows, got ${myRows.length}`);
for (const r of myRows) {
  const fid = r.fulfillmentId ?? r.id;
  rec(`classify ${fid}`, await api('PATCH', `/shipments/dispatch-detail-plan-rows/${fid}/plan`, {
    expectedFulfillmentVersion: r.version,
    expectedShipmentVersion: r.shipmentVersion,
    carrierType: 'OWN', plannedRevenue: null, plannedCarrierCost: null,
    classification: 'DOUBLE',
  }));
}

const liveRows = rowsOf((await api('GET', `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(BL)}&limit=50`)).body)
  .filter((r) => String(r.container?.containerNumber ?? r.containerNumber ?? '').startsWith('QATU'));
const byCont = Object.fromEntries(liveRows.map((r) => [r.container?.containerNumber ?? r.containerNumber, r]));
const startA = new Date(); startA.setHours(8, 0, 0, 0);
const endA = new Date(startA.getTime() + 2 * 3600_000);
const issuePayload = (row, start, end) => ({
  fulfillmentId: row.fulfillmentId ?? row.id, expectedVersion: row.version,
  plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString(), endTimeConfirmed: true,
  carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
  containerTypeId: TAX.containerTypeId,
});
const issA = rec('issue A', await api('POST', `/shipments/${shipmentId}/dispatch`, issuePayload(byCont[CONT_A], startA, endA)));
const tripA = issA.body.trip?.id ?? issA.body.trip?.tripId;
const rowB = rowsOf((await api('GET', `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(BL)}&limit=50`)).body)
  .find((r) => (r.container?.containerNumber ?? r.containerNumber) === CONT_B);
const issB = rec('issue B (Kẹp)', await api('POST', `/shipments/${shipmentId}/dispatch`, issuePayload(rowB, startA, endA)));
const tripB = issB.body.trip?.id ?? issB.body.trip?.tripId;

const tA = await api('GET', `/trips/${tripA}`);
const tB = await api('GET', `/trips/${tripB}`);
const canon = (t) => ({
  id: t.body?.id, status: t.body?.status,
  canonicalOrigin: t.body?.canonicalOrigin, canonicalDestination: t.body?.canonicalDestination,
  truckId: t.body?.truckId, driverId: t.body?.driverId, capacity: t.body?.vehicleCapacityKg,
  cargo: t.body?.cargoWeightKg, pairId: t.body?.activeTripPairId,
});
console.log('trips', JSON.stringify({ A: canon(tA), B: canon(tB) }));

const ctxOut = { BL, shipmentId, CONT_A, CONT_B, tripA, tripB, RIG, steps, health: healthBefore, canonA: canon(tA), canonB: canon(tB) };
fs.writeFileSync(`${EVID}/fixture.json`, JSON.stringify(ctxOut, null, 2));
console.log('FIXTURE_READY', JSON.stringify({ shipmentId, CONT_A, CONT_B, tripA, tripB }));

// ── UI RUNG ────────────────────────────────────────────────────────────────
const { browser, page } = await launch({ width: 1440, height: 1000 });
const net = [];
page.on('response', async (r) => {
  if (r.url().includes('/trips/pairs') || r.url().includes('/shipments/dispatch') || r.url().includes('/dispatch-detail-plan-rows')) {
    try { net.push({ m: r.request().method(), u: r.url().replace(STAGING, ''), s: r.status(), b: (await r.text()).slice(0, 400) }); } catch { /* noop */ }
  }
});
await auth(page, token, '/dispatch-detail');

async function searchGrid(needle) {
  const inp = await page.$('input[aria-label="Tìm nhanh"]');
  await inp.click({ clickCount: 3 });
  await page.keyboard.type(needle, { delay: 35 });
  await sleep(2300);
}

await searchGrid(BL);
const idx = await rowIndex(page, '.detailed-plan-grid tbody tr', CONT_A);
console.log('row idx for A', idx);
await shot(page, `${EVID}/01-detail-lotRows-1440.png`);

await tapSel(page, '.detailed-plan-grid__pair-btn', { label: 'Ghép' });
await sleep(1000);
const dlg = await page.evaluate(() => {
  const d = document.querySelector('[role="dialog"]');
  return d ? { title: d.innerText.split('\n')[0], text: d.innerText.slice(0, 300) } : null;
});
console.log('dialog', JSON.stringify(dlg));
await shot(page, `${EVID}/02-pair-dialog-open-1440.png`);
const preSel = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').includes('Ghép chuyến'));
  return { submitDisabled: b?.disabled ?? null };
});
console.log('submit pre-selection', JSON.stringify(preSel));

const selKind = await uuiSelect(page, 'Loại ghép', 'Kẹp');
console.log('kind pick', JSON.stringify(selKind));
const selPartner = await uuiSelect(page, 'Lệnh ghép cùng', CONT_B);
console.log('partner pick', JSON.stringify(selPartner));
await sleep(700);
const dlgText = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
await shot(page, `${EVID}/03-pair-dialog-selected-1440.png`);
const selEvidence = { dlgText: dlgText.slice(0, 800), selKind, selPartner };

await tapSel(page, '[role="dialog"] button.btn--primary', { label: 'Ghép chuyến submit' });
await sleep(4000);
await shot(page, `${EVID}/04-after-submit-1440.png`);
const pairNet = net.filter((n) => n.u.includes('/trips/pairs'));
const postPair = pairNet[pairNet.length - 1] ?? null;
const afterDlg = await page.evaluate(() => ({ dialogOpen: Boolean(document.querySelector('[role="dialog"]')), alert: document.querySelector('[role="alert"]')?.innerText ?? null }));
await sleep(1600);
const gridState = await page.evaluate(() => [...document.querySelectorAll('.detailed-plan-grid tbody tr')]
  .map((r) => r.innerText.replace(/\n/g, ' | ').slice(0, 320))
  .filter((t) => t.includes('QATU')));
console.log('grid after merge', JSON.stringify(gridState));

const tA2 = await api('GET', `/trips/${tripA}`);
const tB2 = await api('GET', `/trips/${tripB}`);
const merged = { A: canon(tA2), B: canon(tB2), pairNet, afterDlg };
fs.writeFileSync(`${EVID}/rung-353.json`, JSON.stringify({ ctxOut, selEvidence, postPair, preSel, gridState, merged, net }, null, 2));

// ── state matrix (touched screen /dispatch-detail) ─────────────────────────
for (const w of [1280, 1440, 1920, 2560]) {
  await setViewport(page, w, 1000);
  await searchGrid(BL);
  await shot(page, `${EVID}/m-withdata-${w}.png`);
  await searchGrid('ZZZNOMATCH353');
  await shot(page, `${EVID}/m-empty-${w}.png`);
  await searchGrid(BL);
  await tapSel(page, '.detailed-plan-grid__pair-btn', { label: 'Ghép', settle: 200 });
  await sleep(1000);
  await shot(page, `${EVID}/m-noselect-${w}.png`);
  await closeStrayDialog(page);
  await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const { withAborted } = await import('./qa-20261005-lib.mjs');
  await withAborted(page, 'dispatch-detail-plan-rows', async () => { await sleep(500); }, { settleMs: 9000 });
  await shot(page, `${EVID}/m-error-${w}.png`);
  await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2000);
}
await setViewport(page, 1440, 1000);
await browser.close();
console.log('DONE 353', JSON.stringify({ postPairStatus: postPair?.s ?? null, pairA: merged.A.pairId, pairB: merged.B.pairId }));
