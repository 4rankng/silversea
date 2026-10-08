// Card 20261004_354 — partially-dispatched lot: the allocation lock must open
// for the unallocated sibling, the sibling must become issuable, and an
// allocation that CHANGES an already-issued container's carrier must still be
// refused with the precise reason. STAGING UI rung (build 19ed100f).
import fs from 'node:fs';
import {
  STAGING, loginApi, apiClient, health, BUILD_EXPECTED, launch, auth, tapSel, shot,
  setViewport, sleep, closeStrayDialog, rowIndex,
} from './qa-20261005-lib.mjs';

const EVID = 'testplan/qa/evidence/2026-10-05_354-phan-bo-do-khoa-allocation-cont-ket/shots';
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
  console.log(name, r.status, JSON.stringify(r.body).slice(0, 200));
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
const base = (Number(stamp.slice(-5)) % 700) + 100;
const BL = `QA354ALLOC-${stamp}`;
const CONT_A = cnum('QATU', base * 2 + 1);
const CONT_B = cnum('QATU', base * 2 + 2);
const RIG = { truckId: 13, driverId: 5, trailerId: 12, plate: '15E-019.80' };
const TAX = { customerId: 92, routeId: 15, pickupPortId: 1, dropoffPortId: 13, containerTypeId: 1 };
console.log('fixture', { BL, CONT_A, CONT_B });

const appt = new Date(); appt.setHours(10, 0, 0, 0);
const created = rec('create lot', await api('POST', '/shipments', {
  customerId: TAX.customerId, cargoMode: 'FCL', tradeDirection: 'IMPORT',
  blNumber: BL, shippingLineName: 'QA Line',
  customerNotes: `QA354 fixture ${stamp} — partially dispatched lot. Xoá được sau QA.`,
}));
const shipmentId = created.body.id ?? created.body.shipment?.id;
let version = created.body.version ?? created.body.shipment?.version ?? 1;
rec('containers', await api('PUT', `/shipments/${shipmentId}/containers`, {
  expectedVersion: version,
  containers: [CONT_A, CONT_B].map((n) => ({
    containerNumber: n, containerTypeId: TAX.containerTypeId, routeId: TAX.routeId,
    pickupPortId: TAX.pickupPortId, dropoffPortId: TAX.dropoffPortId,
    shippingLineName: 'QA Line', cargoWeightKg: '11000', customerAppointmentAt: appt.toISOString(),
  })),
}));
const detail = await api('GET', `/shipments/cus-workspace/${shipmentId}`);
version = detail.body?.summary?.version ?? detail.body?.version ?? version;

// Partial allocation: ONE of two 20' on the internal fleet → cont A only.
rec('alloc 1/2 OWN', await api('POST', `/shipments/${shipmentId}/carrier-allocations?mode=partial`, {
  expectedVersion: version, carrierAllocations: [{ carrierType: 'OWN', count20: 1, count40: 0 }],
}));

const rowsOf = (body) => (body?.items ?? body?.rows ?? body ?? []);
const readRows = async () => rowsOf((await api('GET', `/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(BL)}&limit=50`)).body);
let rows = await readRows();
const contOf = (r) => String(r.container?.containerNumber ?? r.containerNumber ?? '');
const carrierOf = (r) => r.dispatch?.carrierType ?? r.plannedCarrierType ?? null;
console.log('rows after partial alloc', JSON.stringify(rows.map((r) => ({ c: contOf(r), fid: r.fulfillmentId ?? r.id, carrier: carrierOf(r), plate: r.dispatch?.assignedPlate ?? null }))));
const allocated = rows.find((r) => carrierOf(r) === 'OWN');
if (!allocated) throw new Error('no OWN-allocated container after partial alloc');
const CONT_ALLOC = contOf(allocated);
const CONT_FREE = CONT_ALLOC === CONT_A ? CONT_B : CONT_A;
console.log('allocated', CONT_ALLOC, 'free', CONT_FREE);

// Issue + complete the allocated container's trip.
const startAt = new Date(); startAt.setHours(10, 0, 0, 0);
const endAt = new Date(startAt.getTime() + 2 * 3600_000);
const issA = rec('issue cont A', await api('POST', `/shipments/${shipmentId}/dispatch`, {
  fulfillmentId: allocated.fulfillmentId ?? allocated.id, expectedVersion: allocated.version,
  plannedStartAt: startAt.toISOString(), plannedEndAt: endAt.toISOString(), endTimeConfirmed: true,
  carrierType: 'OWN', truckId: RIG.truckId, driverId: RIG.driverId, trailerId: RIG.trailerId,
  containerTypeId: TAX.containerTypeId,
}));
const tripA = issA.body.trip?.id ?? issA.body.trip?.tripId;
{
  let t = await api('GET', `/trips/${tripA}`);
  rec('trip dispatch', await api('POST', `/trips/${tripA}/dispatch`, { expectedVersion: t.body?.version }));
  t = await api('GET', `/trips/${tripA}`);
  rec('trip complete', await api('POST', `/trips/${tripA}/complete`, { expectedVersion: t.body?.version, reason: `QA354 fixture ${stamp} — chuyến cont đã phát lệnh hoàn thành.` }));
}
rows = await readRows();
const freeRow = rows.find((r) => contOf(r) === CONT_FREE);
console.log('state after complete', JSON.stringify(rows.map((r) => ({ c: contOf(r), carrier: carrierOf(r), plate: r.dispatch?.assignedPlate ?? null, status: r.taskStatus ?? null }))));
const fixture = { BL, shipmentId, CONT_ALLOC, CONT_FREE, tripA, RIG, steps, health: healthBefore, freeRowFid: freeRow?.fulfillmentId ?? null };
fs.writeFileSync(`${EVID}/fixture.json`, JSON.stringify(fixture, null, 2));

// ── UI RUNG ────────────────────────────────────────────────────────────────
const { browser, page } = await launch({ width: 1440, height: 1000 });
const net = [];
page.on('response', async (r) => {
  const u = r.url().replace(STAGING, '');
  if (u.includes('/carrier-allocations') || u.includes('/shipments/') && u.includes('/dispatch')) {
    try { net.push({ m: r.request().method(), u, s: r.status(), b: (await r.text()).slice(0, 400) }); } catch { /* noop */ }
  }
});
await auth(page, tokenDisp, '/dispatch');

async function searchMasterPlan(needle) {
  const inp = await page.$('input[aria-label="Tìm kiếm lô hàng"]');
  await inp.click({ clickCount: 3 });
  await page.keyboard.type(needle, { delay: 35 });
  await sleep(2400);
}
async function masterRowIdx() {
  return rowIndex(page, '.master-plan-grid tbody tr', BL);
}

// AC(a) — the trigger is ENABLED on the partially-dispatched lot
await searchMasterPlan(BL);
let mIdx = await masterRowIdx();
if (mIdx < 0) throw new Error('lot row not on master plan');
const triggerState = await page.evaluate((i) => {
  const tr = [...document.querySelectorAll('.master-plan-grid tbody tr')][i];
  const t = tr.querySelector('.master-plan-grid__allocation-trigger');
  const cell = tr.querySelector('[data-label="Phân bổ nhà xe"]');
  return { disabled: t?.disabled ?? null, ariaLabel: t?.getAttribute('aria-label') ?? null, cellText: (cell?.innerText ?? '').replace(/\n/g, ' | ') };
}, mIdx);
console.log('AC-a trigger', JSON.stringify(triggerState));
await shot(page, `${EVID}/01-masterplan-trigger-enabled-1440.png`);

// AC(b) pre-allocation: the free container is visible on the detail plan
await auth(page, tokenDisp, '/dispatch-detail');
await (async () => { const i = await page.$('input[aria-label="Tìm nhanh"]'); await i.click({ clickCount: 3 }); await page.keyboard.type(BL, { delay: 30 }); await sleep(2400); })();
const preDetail = await page.evaluate((c) => [...document.querySelectorAll('.detailed-plan-grid tbody tr')].map((r) => r.innerText.replace(/\n/g, ' | ').slice(0, 260)).filter((t) => t.includes(c)), CONT_FREE);
console.log('pre-detail', JSON.stringify(preDetail));
await shot(page, `${EVID}/02-detail-freeContainer-prealloc-1440.png`);

// AC(a) action — open the allocation popover and fill the free container
await page.goto(`${STAGING}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
await searchMasterPlan(BL);
mIdx = await masterRowIdx();
await tapSel(page, `.master-plan-grid tbody tr:nth-child(${mIdx + 1}) .master-plan-grid__allocation-trigger`, { label: 'allocation trigger' });
await sleep(1200);
const popover1 = await page.evaluate(() => (document.querySelector('.dispatch-allocation-popover') || {}).innerText?.replace(/\n/g, ' | ').slice(0, 300) ?? null);
console.log('popover open', JSON.stringify(popover1));
await shot(page, `${EVID}/03-allocation-popover-open-1440.png`);

// set SilverSea 20' count to 2 (real trusted taps + trusted keyboard)
async function setCount20(value) {
  const box = await page.evaluate(() => {
    const inp = document.querySelector('.dispatch-allocation-popover input[aria-label^="Số container 20"]');
    if (!inp) return null;
    inp.scrollIntoView({ block: 'center' });
    const r = inp.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  });
  if (!box) throw new Error('no 20\u2032 count input in popover');
  await page.mouse.move(box.x, box.y); await page.mouse.down(); await page.mouse.up();
  await sleep(200);
  await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
  await page.keyboard.press('Backspace');
  await page.keyboard.type(String(value), { delay: 60 });
  await sleep(600);
}
await setCount20(2);
await shot(page, `${EVID}/04-allocation-popover-filled-1440.png`);
const netBefore = net.length;
await tapSel(page, '.dispatch-allocation-popover__save', { label: 'Lưu phân bổ', settle: 500 });
await sleep(3000);
const afterSave = await page.evaluate(() => ({
  popoverOpen: Boolean(document.querySelector('.dispatch-allocation-popover')),
  error: document.querySelector('.dispatch-allocation-popover__notice.is-error')?.innerText ?? null,
}));
await shot(page, `${EVID}/05-masterplan-after-allocate-1440.png`);
const chipCell = await page.evaluate((i) => {
  const tr = [...document.querySelectorAll('.master-plan-grid tbody tr')][i];
  return (tr?.querySelector('[data-label="Phân bổ nhà xe"]')?.innerText ?? '').replace(/\n/g, ' | ');
}, mIdx);
const allocNet = net.slice(netBefore).filter((n) => n.u.includes('carrier-allocations'));
console.log('after allocate', JSON.stringify({ afterSave, chipCell, allocNet }));
if (afterSave.popoverOpen) { await tapSel(page, '.dispatch-allocation-popover__close, .dispatch-allocation-popover button[aria-label]', { label: 'close popover', settle: 300 }).catch(() => {}); await page.keyboard.press('Escape'); await sleep(600); }

// AC(b) post-allocation: the (previously free) container shows on the detail plan
await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
await (async () => { const i = await page.$('input[aria-label="Tìm nhanh"]'); await i.click({ clickCount: 3 }); await page.keyboard.type(BL, { delay: 30 }); await sleep(2500); })();
const postDetail = await page.evaluate((c) => [...document.querySelectorAll('.detailed-plan-grid tbody tr')].map((r) => r.innerText.replace(/\n/g, ' | ').slice(0, 280)).filter((t) => t.includes(c)), CONT_FREE);
console.log('post-detail', JSON.stringify(postDetail));
await shot(page, `${EVID}/06-detail-freeContainer-postalloc-1440.png`);

// AC — the free container can be assigned a rig and issued through the UI
async function pickSearchable(triggerSel, searchAria, optionText) {
  await tapSel(page, triggerSel, { label: `trigger ${triggerSel}` });
  await sleep(500);
  await tapSel(page, `.searchable-select__popover input[aria-label="${searchAria}"]`, { label: `search ${searchAria}` });
  await page.keyboard.type(optionText, { delay: 25 });
  await sleep(800);
  const opt = await page.evaluate((t) => {
    const o = [...document.querySelectorAll('.searchable-select__popover [role="option"]')].find((el) => (el.textContent || '').includes(t));
    if (!o) return null;
    o.scrollIntoView({ block: 'nearest' });
    const r = o.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), text: (o.textContent || '').trim().slice(0, 70) };
  }, optionText);
  if (!opt) throw new Error(`option "${optionText}" not found`);
  await sleep(120);
  const { tapAt } = await import('./qa-20261005-lib.mjs');
  await tapAt(page, opt.x, opt.y, { label: `option ${opt.text}` });
  return opt;
}
const dIdx = await rowIndex(page, '.detailed-plan-grid tbody tr', CONT_FREE);
await tapSel(page, `.detailed-plan-grid tbody tr:nth-child(${dIdx + 1}) .dispatch-assignment-cell__trigger`, { label: 'editor open' });
await sleep(900);
await pickSearchable('label.dispatch-assignment-dialog__carrier .searchable-select__trigger', 'Tìm nhà xe…', 'SilverSea');
await pickSearchable('label.dispatch-assignment-dialog__vehicle .searchable-select__trigger', 'Tìm biển số xe…', RIG.plate);
const netBeforeIssue = net.length;
await tapSel(page, '[role="dialog"] button.btn--primary', { label: 'Lưu thay đổi' });
await sleep(3000);
// reopen and Phát lệnh
const dIdx2 = await rowIndex(page, '.detailed-plan-grid tbody tr', CONT_FREE);
await tapSel(page, `.detailed-plan-grid tbody tr:nth-child(${dIdx2 + 1}) .dispatch-assignment-cell__trigger`, { label: 'editor reopen' });
await sleep(900);
const issueBtn = await page.evaluate(() => {
  const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => (x.textContent || '').trim() === 'Phát lệnh');
  return b ? { disabled: b.disabled } : null;
});
console.log('issue button', JSON.stringify(issueBtn));
await shot(page, `${EVID}/07-editor-issue-ready-1440.png`);
if (issueBtn && !issueBtn.disabled) {
  await tapSel(page, '[role="dialog"] button.dispatch-assignment-dialog__issue-btn, [role="dialog"] button.btn--primary', { label: 'Phát lệnh', settle: 500 });
  await sleep(4000);
}
const issueNet = net.slice(netBeforeIssue).filter((n) => n.u.includes('/dispatch'));
console.log('issue net', JSON.stringify(issueNet.map((n) => ({ m: n.m, u: n.u, s: n.s }))));
await shot(page, `${EVID}/08-detail-after-issue-1440.png`);

// Freeze — re-submitting an allocation that would CHANGE an issued carrier is refused
await page.goto(`${STAGING}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
await searchMasterPlan(BL);
mIdx = await masterRowIdx();
await tapSel(page, `.master-plan-grid tbody tr:nth-child(${mIdx + 1}) .master-plan-grid__allocation-trigger`, { label: 'allocation trigger freeze' });
await sleep(1200);
const netBeforeFreeze = net.length;
await setCount20(0);
await tapSel(page, '.dispatch-allocation-popover__save', { label: 'Lưu phân bổ freeze', settle: 500 });
await sleep(3000);
const freeze = await page.evaluate(() => ({
  popoverOpen: Boolean(document.querySelector('.dispatch-allocation-popover')),
  error: document.querySelector('.dispatch-allocation-popover__notice.is-error')?.innerText ?? null,
  bodyText: document.querySelector('.dispatch-allocation-popover')?.innerText?.replace(/\n/g, ' | ').slice(0, 400) ?? null,
}));
const freezeNet = net.slice(netBeforeFreeze).filter((n) => n.u.includes('carrier-allocations'));
await shot(page, `${EVID}/09-freeze-refusal-1440.png`);
console.log('freeze', JSON.stringify({ freeze, freezeNet }));

// Wire-level freeze probe (data rung): an allocation that would strip the
// already-issued containers' carrier must be refused with the precise reason.
const cur = await api('GET', `/shipments/cus-workspace/${shipmentId}`);
const curVersion = cur.body?.summary?.version ?? cur.body?.version;
const freezeApi = await api('POST', `/shipments/${shipmentId}/carrier-allocations?mode=partial`, {
  expectedVersion: curVersion, carrierAllocations: [],
});
console.log('freezeApi', freezeApi.status, JSON.stringify(freezeApi.body).slice(0, 200));

const result = { fixture, triggerState, preDetail, popover1, afterSave, chipCell, allocNet, postDetail, issueBtn, issueNet, freeze, freezeNet, freezeApi, net };
fs.writeFileSync(`${EVID}/rung-354.json`, JSON.stringify(result, null, 2));

// ── state matrix: /dispatch and /dispatch-detail ───────────────────────────
const { withAborted } = await import('./qa-20261005-lib.mjs');
for (const w of [1280, 1440, 1920, 2560]) {
  await setViewport(page, w, 1000);
  await page.goto(`${STAGING}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  await searchMasterPlan(BL);
  await shot(page, `${EVID}/m-dispatch-withdata-${w}.png`);
  await searchMasterPlan('ZZZNOMATCH354');
  await shot(page, `${EVID}/m-dispatch-empty-${w}.png`);
  await page.goto(`${STAGING}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await withAborted(page, '/api/shipments?', async () => { await sleep(500); }, { settleMs: 9000 });
  await shot(page, `${EVID}/m-dispatch-error-${w}.png`);

  await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(2500);
  const i = await page.$('input[aria-label="Tìm nhanh"]');
  await i.click({ clickCount: 3 }); await page.keyboard.type(BL, { delay: 30 }); await sleep(2400);
  await shot(page, `${EVID}/m-detail-withdata-${w}.png`);
  await i.click({ clickCount: 3 }); await page.keyboard.type('ZZZNOMATCH354', { delay: 30 }); await sleep(2400);
  await shot(page, `${EVID}/m-detail-empty-${w}.png`);
  await page.goto(`${STAGING}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await withAborted(page, 'dispatch-detail-plan-rows', async () => { await sleep(500); }, { settleMs: 9000 });
  await shot(page, `${EVID}/m-detail-error-${w}.png`);
}
await setViewport(page, 1440, 1000);
await browser.close();
console.log('DONE 354', JSON.stringify({ triggerDisabled: triggerState.disabled, chipCell, freezeError: freeze.error, issueNet: issueNet.map((n) => n.s) }));
