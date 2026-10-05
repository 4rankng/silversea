// Card 20261005_363 — rig time-window conflict message, UI rung on STAGING.
// Fixture on truck 17 (15E-018.83 / trailer 16 / driver 4 — the plate the
// customer reported):
//   TC1 COMPLETED trip  10-06 08:00–09:00
//   TC2 IN_TRANSIT trip 10-07 08:00–09:00
//   P_open plan row     appointment 09-25 08:00, no Giờ trả hàng (open end)
// Targets: A 10-06 08:30 (expect SUCCESS), C 10-07 08:30 (expect 409 with
// 'khung giờ trùng lặp'), B 10-08 08:00 (expect SUCCESS).
import fs from 'node:fs';
import {
  loginApi, apiClient, health, BUILD_EXPECTED, launch, auth, tapSel, shot,
  setViewport, sleep, closeStrayDialog, rowIndex,
} from './qa-20261005-lib.mjs';

const EVID = 'testplan/qa/evidence/2026-10-05_363-bao-loi-xung-dot-khung-gio-sai/shots';
fs.mkdirSync(EVID, { recursive: true });

const healthBefore = await health();
if (healthBefore.buildHash !== BUILD_EXPECTED) {
  console.log(JSON.stringify({ BLOCKED: 'stale build', healthBefore, expected: BUILD_EXPECTED }));
  process.exit(2);
}
console.log('health', JSON.stringify(healthBefore));

const { token: tokenAdmin } = await loginApi('admin');
const { token: tokenDisp } = await loginApi('dungnv');
const api = apiClient(tokenAdmin);
const steps = [];
const rec = (name, r) => {
  steps.push({ name, status: r.status, body: typeof r.body === 'object' ? JSON.stringify(r.body).slice(0, 400) : r.body });
  console.log(name, r.status, JSON.stringify(r.body).slice(0, 220));
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
const base = (Number(stamp.slice(-5)) % 600) + 100;
const RIG = { truckId: 17, driverId: 4, trailerId: 16, plate: '15E-018.83' };
const TAX = { customerId: 92, routeId: 15, pickupPortId: 1, dropoffPortId: 13, containerTypeId: 1 };
const vn = (iso) => new Date(iso).toISOString();

async function makeLot(tag, cont, apptIso) {
  const bl = `QA363RIG-${stamp}-${tag}`;
  const c = rec(`lot ${tag}`, await api('POST', '/shipments', {
    customerId: TAX.customerId, cargoMode: 'FCL', tradeDirection: 'IMPORT',
    blNumber: bl, shippingLineName: 'QA Line',
    customerNotes: `QA363 fixture ${stamp} ${tag} — rig conflict window. Xoá được sau QA.`,
  }));
  const id = c.body.id ?? c.body.shipment?.id;
  let version = c.body.version ?? c.body.shipment?.version ?? 1;
  rec(`containers ${tag}`, await api('PUT', `/shipments/${id}/containers`, {
    expectedVersion: version,
    containers: [{
      containerNumber: cont, containerTypeId: TAX.containerTypeId, routeId: TAX.routeId,
      pickupPortId: TAX.pickupPortId, dropoffPortId: TAX.dropoffPortId,
      shippingLineName: 'QA Line', cargoWeightKg: '12000', customerAppointmentAt: vn(apptIso),
    }],
  }));
  const d = await api('GET', `/shipments/cus-workspace/${id}`);
  version = d.body?.summary?.version ?? d.body?.version ?? version;
  rec(`alloc ${tag}`, await api('POST', `/shipments/${id}/carrier-allocations?mode=partial`, {
    expectedVersion: version, carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 0 }],
  }));
  return { id, bl, cont };
}
const rowsOf = (body) => (body?.items ?? body?.rows ?? body ?? []);
async function rowFor(bl) {
  const rows = rowsOf((await api('GET', `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(bl)}&limit=50`)).body);
  return rows[0];
}
async function classifySingular(bl) {
  const r = await rowFor(bl);
  if (!r) return null;
  return api('PATCH', `/shipments/dispatch-detail-plan-rows/${r.fulfillmentId ?? r.id}/plan`, {
    expectedFulfillmentVersion: r.version, expectedShipmentVersion: r.shipmentVersion,
    carrierType: 'OWN', plannedRevenue: null, plannedCarrierCost: null, classification: 'SINGLE',
  });
}
async function issue(lot, startIso, endIso) {
  const r = await rowFor(lot.bl);
  return api('POST', `/shipments/${lot.id}/dispatch`, {
    fulfillmentId: r.fulfillmentId ?? r.id, expectedVersion: r.version,
    plannedStartAt: vn(startIso), plannedEndAt: vn(endIso), endTimeConfirmed: true,
    carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
    containerTypeId: TAX.containerTypeId,
  });
}
async function completeTrip(tripId) {
  let t = await api('GET', `/trips/${tripId}`);
  const v1 = t.body?.version;
  const d = await api('POST', `/trips/${tripId}/dispatch`, { expectedVersion: v1 });
  if (!d.ok && d.status !== 200) return { dispatch: d.status, body: d.body };
  t = await api('GET', `/trips/${tripId}`);
  const c = await api('POST', `/trips/${tripId}/complete`, { expectedVersion: t.body?.version, reason: `QA363 fixture ${stamp} — hoàn thành chuyến để kiểm tra cửa sổ trùng lặp.` });
  return { dispatch: d.status, complete: c.status, body: c.body };
}

const seq = Number(stamp.slice(-3)) * 3;
const P_open = await makeLot('OPEN', cnum('QATU', base * 3 + 1), '2026-09-25T08:00:00+07:00');
const C1 = await makeLot('C1', cnum('QATU', base * 3 + 2), '2026-10-06T08:00:00+07:00');
const C2 = await makeLot('C2', cnum('QATU', base * 3 + 3), '2026-10-07T08:00:00+07:00');

// P_open: open-ended PLAN ROW on the rig (no Giờ trả hàng).
{
  const r = await rowFor(P_open.bl);
  rec('P_open assign rig (open end)', await api('PATCH', `/shipments/dispatch-detail-plan-rows/${r.fulfillmentId ?? r.id}/plan`, {
    expectedFulfillmentVersion: r.version, expectedShipmentVersion: r.shipmentVersion,
    carrierType: 'OWN', truckId: RIG.truckId, plannedRevenue: null, plannedCarrierCost: null, classification: 'SINGLE',
  }));
}
await classifySingular(C1.bl);
const issC1 = rec('issue C1', await issue(C1, '2026-10-06T08:00:00+07:00', '2026-10-06T09:00:00+07:00'));
const tripC1 = issC1.body.trip?.id ?? issC1.body.trip?.tripId;
rec('complete C1', await completeTrip(tripC1));
await classifySingular(C2.bl);
const issC2 = rec('issue C2', await issue(C2, '2026-10-07T08:00:00+07:00', '2026-10-07T09:00:00+07:00'));
const tripC2 = issC2.body.trip?.id ?? issC2.body.trip?.tripId;
rec('dispatch C2 (IN_TRANSIT)', await api('POST', `/trips/${tripC2}/dispatch`, { expectedVersion: (await api('GET', `/trips/${tripC2}`)).body?.version }));

const A = await makeLot('A', cnum('QATU', base * 3 + 4), '2026-10-06T08:30:00+07:00');
const C = await makeLot('C', cnum('QATU', base * 3 + 5), '2026-10-07T08:30:00+07:00');
const B = await makeLot('B', cnum('QATU', base * 3 + 6), '2026-10-08T08:00:00+07:00');
console.log('seq', seq, 'trips', { tripC1, tripC2 });
console.log('targets', JSON.stringify({ A, C, B }));

const fixture = { stamp, RIG, TAX, P_open, C1, C2, tripC1, tripC2, A, B, C, steps, health: healthBefore };
fs.writeFileSync(`${EVID}/fixture.json`, JSON.stringify(fixture, null, 2));

// ── UI RUNG ────────────────────────────────────────────────────────────────
const { browser, page } = await launch({ width: 1440, height: 1000 });
const net = [];
page.on('response', async (r) => {
  if (r.url().includes('/dispatch-detail-plan-rows')) {
    try { net.push({ m: r.request().method(), u: r.url().replace('https://vantai.tingting.vip', ''), s: r.status(), b: (await r.text()).slice(0, 300) }); } catch { /* noop */ }
  }
});
await auth(page, tokenDisp, '/dispatch-detail');

async function searchGrid(needle) {
  const inp = await page.$('input[aria-label="Tìm nhanh"]');
  await inp.click({ clickCount: 3 });
  await page.keyboard.type(needle, { delay: 35 });
  await sleep(2300);
}

async function pickSearchable(triggerSel, searchAria, optionText) {
  await tapSel(page, triggerSel, { label: `trigger ${triggerSel}` });
  await sleep(500);
  const inputSel = `.searchable-select__popover input[aria-label="${searchAria}"]`;
  await tapSel(page, inputSel, { label: `search ${searchAria}` });
  await page.keyboard.type(optionText, { delay: 25 });
  await sleep(800);
  const opt = await page.evaluate((t) => {
    const opts = [...document.querySelectorAll('.searchable-select__popover [role="option"]')];
    const o = opts.find((el) => (el.textContent || '').includes(t));
    if (!o) return null;
    o.scrollIntoView({ block: 'nearest' });
    const r = o.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 80) };
  }, optionText);
  if (!opt) throw new Error(`pickSearchable: option "${optionText}" not found`);
  await sleep(120);
  const { tapAt } = await import('./qa-20261005-lib.mjs');
  await tapAt(page, opt.x, opt.y, { label: `option ${opt.text}` });
  return opt;
}

async function assignRig(target, label) {
  await closeStrayDialog(page);
  await searchGrid(target.bl);
  const idx = await rowIndex(page, '.detailed-plan-grid tbody tr', target.cont);
  if (idx < 0) throw new Error(`${label}: row ${target.cont} not in grid`);
  await shot(page, `${EVID}/${label}-01-row-1440.png`);
  await tapSel(page, `.detailed-plan-grid tbody tr:nth-child(${idx + 1}) .dispatch-assignment-cell__trigger`, { label: `${label} open editor` });
  await sleep(900);
  const title = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText.split('\n')[0] ?? null);
  await pickSearchable('label.dispatch-assignment-dialog__carrier .searchable-select__trigger', 'Tìm nhà xe…', 'SilverSea');
  await pickSearchable('label.dispatch-assignment-dialog__vehicle .searchable-select__trigger', 'Tìm biển số xe…', RIG.plate);
  await sleep(500);
  await shot(page, `${EVID}/${label}-02-editor-filled-1440.png`);
  const netBefore = net.length;
  await tapSel(page, '[role="dialog"] button.btn--primary', { label: `${label} Lưu thay đổi`, settle: 500 });
  await sleep(3000);
  const state = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return {
      dialogOpen: Boolean(d),
      error: d?.querySelector('[role="alert"]')?.innerText ?? null,
      title: d?.innerText.split('\n')[0] ?? null,
    };
  });
  const patchNet = net.slice(netBefore).filter((n) => n.m === 'PATCH');
  await shot(page, `${EVID}/${label}-03-result-1440.png`);
  return { title, ...state, patchNet };
}

const resC = await assignRig(C, 'C-block');
const resA = await assignRig(A, 'A-completed');
const resB = await assignRig(B, 'B-openend');
console.log('RESULT C', JSON.stringify(resC));
console.log('RESULT A', JSON.stringify(resA));
console.log('RESULT B', JSON.stringify(resB));

// after-state: the grid rows that got the rig
await searchGrid(A.bl);
await shot(page, `${EVID}/A-04-grid-after-1440.png`);
await searchGrid(B.bl);
await shot(page, `${EVID}/B-04-grid-after-1440.png`);

fs.writeFileSync(`${EVID}/rung-363.json`, JSON.stringify({ fixture, resC, resA, resB, net }, null, 2));

// ── state matrix (/dispatch-detail) ────────────────────────────────────────
for (const w of [1280, 1440, 1920, 2560]) {
  await setViewport(page, w, 1000);
  await searchGrid(C1.bl);
  await shot(page, `${EVID}/m-withdata-${w}.png`);
  await searchGrid('ZZZNOMATCH363');
  await shot(page, `${EVID}/m-empty-${w}.png`);
  await searchGrid(C.bl);
  const idx = await rowIndex(page, '.detailed-plan-grid tbody tr', C.cont);
  await tapSel(page, `.detailed-plan-grid tbody tr:nth-child(${idx + 1}) .dispatch-assignment-cell__trigger`, { label: 'editor', settle: 200 });
  await sleep(800);
  await pickSearchable('label.dispatch-assignment-dialog__carrier .searchable-select__trigger', 'Tìm nhà xe…', 'SilverSea');
  await pickSearchable('label.dispatch-assignment-dialog__vehicle .searchable-select__trigger', 'Tìm biển số xe…', RIG.plate);
  await tapSel(page, '[role="dialog"] button.btn--primary', { label: 'save', settle: 200 });
  await sleep(2500);
  await shot(page, `${EVID}/m-error-${w}.png`);
  await closeStrayDialog(page);
}
await setViewport(page, 1440, 1000);
await browser.close();
console.log('DONE 363', JSON.stringify({ C: resC.error, A: resA.dialogOpen ? resA.error : 'closed=success', B: resB.dialogOpen ? resB.error : 'closed=success' }));
