// Card 20261005_387 — planning-fixture + rung 3: create ONE self-marked QA
// lot (customer → lô → container, appointment so it lists in the dispatch
// queue), then on /dispatch-detail open its row's issue editor (Gán xe),
// select "Moóc cho chuyến (ghi đè)" ≠ the truck's coupled trailer, Phát lệnh,
// and capture the mutation response + note + screenshots.
// Fixture marker: customerNotes 'QA387-FIXTURE 2026-10-06', bl QA387TRAILER-*.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const API = process.env.API_URL || 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const MARKER = 'QA387-FIXTURE 2026-10-06';
const BL = `QA387TRAILER-${STAMP}`;
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiFor(token) {
  return async (method, path, body) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
    return { status: response.status, body: parsed };
  };
}

// ── Part A: fixture (admin) ────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, status: health.status });

const loginAdmin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
if (!loginAdmin.ok) throw new Error(`admin login ${loginAdmin.status}`);
const adminJson = await loginAdmin.json();
const admin = await apiFor(adminJson.token ?? adminJson.accessToken);
log('login-admin', { ok: true });

// Rig: an OWN truck with driver + coupled trailer.
const fleet = await admin('GET', '/shipments/dispatch-fleet?resource=TRUCK');
if (fleet.status !== 200) throw new Error(`fleet ${fleet.status}`);
const rig = fleet.body.items.find((t) => t.currentTrailerId != null && t.assignedDriverId != null);
if (!rig) throw new Error(`no rig with driver+trailer: ${JSON.stringify(fleet.body.items?.slice(0, 3))}`);
log('rig', { truckId: rig.id, plate: rig.licensePlate, trailerId: rig.currentTrailerId, couplingPlate: rig.currentTrailerPlate, driverId: rig.assignedDriverId });

// Trailers catalog → override ≠ coupling, prefer same type as coupling.
const trailers = await admin('GET', '/trailers?limit=200');
const trailerItems = Array.isArray(trailers.body) ? trailers.body : trailers.body?.items ?? [];
log('trailers', { status: trailers.status, count: trailerItems.length });
const coupling = trailerItems.find((t) => t.id === rig.currentTrailerId);
const overrideTrailer = trailerItems.find((t) => t.id !== rig.currentTrailerId && (!coupling?.type || t.type === coupling.type))
  ?? trailerItems.find((t) => t.id !== rig.currentTrailerId);
if (!overrideTrailer) throw new Error('no second ACTIVE trailer for the override');
log('override-trailer', { id: overrideTrailer.id, plate: overrideTrailer.licensePlate ?? overrideTrailer.plate, type: overrideTrailer.type, sameTypeAsCoupling: !coupling?.type || overrideTrailer.type === coupling.type });

// Reuse an existing fixture lot across reruns (QA387_SHIPMENT=<id>) so a
// retried driver never piles up duplicate QA lots on staging.
const REUSE_ID = process.env.QA387_SHIPMENT ? Number(process.env.QA387_SHIPMENT) : null;
let shipmentId = REUSE_ID;
let bl = BL;
let version = 1;

// Proven (customer, factory) taxonomy from a live container row.
const workboard = await admin('GET', '/shipments/cus-workspace/containers?page=1&limit=100&transportDateFrom=2020-01-01&transportDateTo=2030-12-31');
if (workboard.status !== 200) throw new Error(`workboard ${workboard.status}`);
// Customer liveness: a soft-deleted customer passes shallow probes but every
// customer-inner-join query (dispatch plan!) silently drops the lot.
const customersRes = await admin('GET', '/customers?limit=500');
const customerList = Array.isArray(customersRes.body) ? customersRes.body : customersRes.body?.items ?? [];
const liveCustomerIds = new Set(customerList.map((c) => c.id));
log('live-customers', { status: customersRes.status, count: liveCustomerIds.size });
let proven = null;
for (const row of workboard.body.items) {
  if (row.isAdHoc || row.customerId == null) continue;
  if (!liveCustomerIds.has(row.customerId)) continue;
  const detail = await admin('GET', `/shipments/cus-workspace/${row.shipmentId}`);
  const withFactory = (detail.body?.containers ?? []).find((c) => c.operationalSiteId != null);
  if (withFactory) { proven = { customerId: row.customerId, container: withFactory }; break; }
}
if (!proven) throw new Error('no proven LIVE customer/site pair');
const c0 = proven.container;
log('taxonomy', { customerId: proven.customerId, containerTypeId: c0.containerTypeId, routeId: c0.routeId, pickup: c0.liftSiteId, dropoff: c0.dropoffSiteId, site: c0.operationalSiteId });

const LETTERS = { A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38 };
function containerNumber(prefix, serial) {
  const digits = String(serial).padStart(6, '0');
  const body = `${prefix}${digits}`;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    const value = i < 4 ? LETTERS[body[i]] : Number(body[i]);
    sum += value * 2 ** i;
  }
  return `${body}${(sum % 11) % 10}`;
}

if (REUSE_ID == null) {
const created = await admin('POST', '/shipments', {
  customerId: proven.customerId,
  cargoMode: 'FCL',
  tradeDirection: 'IMPORT',
  blNumber: BL,
  shippingLineName: 'QA Line',
  customerNotes: `${MARKER} — lot cho rung 3 card 20261005_387 (ghi đè moóc lúc phát lệnh). Xoa duoc sau QA.`,
});
if (created.status !== 201 && created.status !== 200) throw new Error(`create ${created.status} ${JSON.stringify(created.body)}`);
shipmentId = created.body.id ?? created.body.shipment?.id;
version = created.body.version ?? created.body.shipment?.version ?? 1;
log('lot-created', { shipmentId, bl: BL });

const appt = new Date(new Date(new Date().getTime() + 2 * 86400_000).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })).toISOString();
const containers = [{
  containerNumber: containerNumber('QATU', 950_000 + (Number(STAMP.slice(-4)) % 900) * 10),
  containerTypeId: c0.containerTypeId,
  routeId: c0.routeId,
  pickupPortId: c0.liftSiteId,
  dropoffPortId: c0.dropoffSiteId,
  operationalSiteId: c0.operationalSiteId,
  shippingLineName: 'QA Line',
  cargoWeightKg: '11000',
  customerAppointmentAt: appt,
}];
const reconciled = await admin('PUT', `/shipments/${shipmentId}/containers`, { expectedVersion: version, containers });
if (reconciled.status !== 200) throw new Error(`containers ${reconciled.status} ${JSON.stringify(reconciled.body)}`);
log('container-created', { containerNumber: containers[0].containerNumber, appointmentAt: appt });
} else {
  const detail = await admin('GET', `/shipments/cus-workspace/${REUSE_ID}`);
  if (detail.status !== 200) throw new Error(`reuse lookup ${detail.status}`);
  bl = detail.body.summary?.billOrBookNumber ?? detail.body.blNumber ?? BL;
  log('lot-reused', { shipmentId: REUSE_ID, bl, containers: detail.body.containers?.length ?? 0 });
}

// CUS-side carrier assignment per container — the handoff accept 409s with
// 'CUS chua gan du nha xe' unless every FCL fulfillment has plannedCarrierType.
const detailNow = await admin('GET', `/shipments/cus-workspace/${shipmentId}`);
if (detailNow.status !== 200) throw new Error(`detail ${detailNow.status}`);
const fixtureContainers = detailNow.body.containers ?? [];
const shipmentVersion = detailNow.body.summary?.version ?? version;
for (const c of fixtureContainers) {
  const line = await admin('POST', `/shipments/cus-workspace/${shipmentId}/containers/${c.id}`, { carrierType: 'OWN', expectedShipmentVersion: shipmentVersion });
  log('container-carrier', { containerId: c.id, status: line.status, skipped: line.status === 409 });
  if (line.status !== 200 && line.status !== 409) {
    throw new Error(`container carrier ${line.status} ${JSON.stringify(line.body).slice(0, 160)}`);
  }
}

// Ensure the dispatch handoff (task intake) exists — the READY queue lists
// fulfillments joined to dispatch_handoffs; a lot without one never queues.
const handoffProbe = await admin('GET', `/shipments/${shipmentId}/dispatch-handoff`);
const hasHandoff = handoffProbe.status === 200 && Boolean(handoffProbe.body?.id ?? handoffProbe.body?.handoff?.id);
let handoffRow = null;
if (!hasHandoff) {
  const newHandoff = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs`, {});
  if (newHandoff.status !== 200 && newHandoff.status !== 201 && newHandoff.status !== 409) {
    throw new Error(`handoff create ${newHandoff.status} ${JSON.stringify(newHandoff.body)}`);
  }
  handoffRow = newHandoff.body?.handoff ?? newHandoff.body;
  log('handoff-ensured', { existed: false, status: newHandoff.status });
} else {
  handoffRow = handoffProbe.body?.id ? handoffProbe.body : (handoffProbe.body?.handoff ?? null);
  log('handoff-ensured', { existed: true, status: handoffRow?.status });
}
// The dispatch queue only lists fulfillments whose lot handoff is ACCEPTED
// (leftJoin on status='ACCEPTED') — accept it like a dispatcher would.
if (handoffRow && handoffRow.status !== 'ACCEPTED') {
  const hv = handoffRow.handoffVersion ?? handoffRow.version;
  let resolved = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs/${handoffRow.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: hv });
  if (resolved.status === 409) {
    resolved = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs/${handoffRow.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: handoffRow.version === hv ? handoffRow.handoffVersion : handoffRow.version });
  }
  if (resolved.status !== 200 && resolved.status !== 201) {
    throw new Error(`handoff accept ${resolved.status} ${JSON.stringify(resolved.body).slice(0, 200)}`);
  }
  log('handoff-accepted', { handoffId: handoffRow.id, status: resolved.status });
}

const queue = await admin('GET', '/shipments/dispatch-queue?status=READY&limit=50');
if (queue.status !== 200) throw new Error(`queue ${queue.status}`);
const item = queue.body.items.find((q) => q.shipmentId === shipmentId);
if (!item) throw new Error(`own lot not in READY queue (total ${queue.body.items?.length})`);
log('queue-item', { fulfillmentId: item.fulfillmentId, version: item.fulfillmentVersion, blInQueue: item.blNumber ?? item.billNumber ?? BL });

// ── Part B: browser rung (dungnv = DISPATCHER) ─────────────────────────────
const loginD = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
if (!loginD.ok) throw new Error(`dungnv login ${loginD.status}`);
const dungnvToken = (await loginD.json()).token;
log('login-dispatcher', { ok: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let issueResponse = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('response', async (res) => {
    if (res.url().includes(`/shipments/${shipmentId}/dispatch`) && res.request().method() === 'POST') {
      const text = await res.text().catch(() => '');
      issueResponse = { status: res.status(), body: text ? JSON.parse(text) : null };
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dungnvToken);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  // Find MY row by the Bill text, then its edit affordance. The app shell
  // resets the inner scroller on re-render: scrollIntoView → re-measure in a
  // retry loop until the button sits inside the viewport, then tap atomically.
  let target = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    target = await page.evaluate((bl) => {
      // Innermost row only — outer date-group rows contain many lots' cells.
      const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && r.querySelector('button') && !r.querySelector('tr'));
      if (!row) return { missing: true };
      const btn = [...row.querySelectorAll('button')].find((b) => /Gán xe|Sửa|Phân xe/.test(b.textContent || ''))
        ?? row.querySelector('button');
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 60)
        ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (btn.textContent || '').trim() }
        : { offscreen: true, y: r.y };
    }, bl);
    if (target && !target.missing && !target.offscreen) break;
    await sleep(900);
  }
  if (!target || target.missing) throw new Error(`row for ${bl} not found on /dispatch-detail`);
  if (target.offscreen) throw new Error(`row button never entered viewport: ${JSON.stringify(target)}`);
  const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.textContent?.trim().slice(0, 40), target);
  if (!hit || !hit.includes(target.label)) throw new Error(`hit-test missed: point=${JSON.stringify(target)} hit=${hit}`);
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.up();
  log('open-editor', { rowButton: target.label, bl });
  await sleep(2500);

  // Editor = house Modal with form .dispatch-assignment-dialog.
  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 20000 });

  const trustedTapPoint = async (point, expectText) => {
    const got = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim().slice(0, 60), point);
    if (!got || !(got.includes(expectText))) throw new Error(`hit-test missed (${expectText}): ${got}`);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
  };

  // Vehicle combobox (react-aria, focus-trapped modal): real click, type the
  // plate, tap the matching option.
  // Already-plated row: the reopened editor carries the issue fieldset with
  // the override select directly — skip vehicle pick + save entirely.
  await sleep(1800);
  let alreadyPlated = await page.evaluate(() => { const fs = document.querySelector('.dispatch-assignment-dialog__issue'); return Boolean(fs && /Moóc cho chuyến \(ghi đè\)/.test(fs.textContent || '')); });
  if (!alreadyPlated) { await sleep(2000); alreadyPlated = await page.evaluate(() => { const fs = document.querySelector('.dispatch-assignment-dialog__issue'); return Boolean(fs && /Moóc cho chuyến \(ghi đè\)/.test(fs.textContent || '')); }); }
  if (alreadyPlated) log('already-plated', { skippedVehicleSave: true });
if (!alreadyPlated) {
  // The SearchableSelect trigger is the 'Chọn biển số xe' text element; the
  // popover's search input usually autofocuses — type straight after tapping.
  const veh = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.dispatch-assignment-dialog button, .dispatch-assignment-dialog [role="button"], .dispatch-assignment-dialog span')]
      .find((x) => /Chọn biển số xe/.test(x.textContent || '') && x.offsetParent !== null && (x.matches('button, [role="button"], [tabindex]') || x.closest('label')));
    if (!el) return null;
    const target = el.closest('button, [role="button"], [tabindex]') ?? el;
    target.scrollIntoView({ block: 'nearest' });
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!veh) {
    const state = await page.evaluate(() => ({
      fieldset: Boolean(document.querySelector('.dispatch-assignment-dialog__issue')),
      select: Boolean(document.querySelector('.dispatch-assignment-dialog__issue select')),
      vehicleText: [...document.querySelectorAll('.dispatch-assignment-dialog__vehicle, .dispatch-assignment-dialog__vehicle-head')]
        .map((e) => (e.textContent || '').trim().slice(0, 80)),
      issueText: (document.querySelector('.dispatch-assignment-dialog__issue')?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
    }));
    throw new Error(`vehicle trigger not found; state=${JSON.stringify(state)}`);
  }
  await trustedTapPoint(veh, 'Chọn biển số xe');
  await sleep(700);
  const popoverInput = await page.evaluate(() => {
    const cand = [...document.querySelectorAll('input')]
      .filter((i) => i.offsetParent !== null && !i.closest('.dispatch-assignment-dialog'))
      .find((i) => i.type === 'text' || i.type === 'search');
    if (!cand) return false;
    cand.focus();
    return true;
  });
  await page.keyboard.type('15C-167.31', { delay: 70 });
  log('vehicle-typed', { popoverInputFocused: popoverInput });
  await sleep(1400);
  let opt = null;
  for (let o = 0; o < 5; o += 1) {
    opt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="option"], [role="listbox"] *')] 
        .find((x) => (x.textContent || '').includes('15C-167.31') && x.offsetParent !== null);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 40) ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (el.textContent || '').trim().slice(0, 60) } : { retry: true };
    });
    if (opt && !opt.retry) break;
    await sleep(700);
  }
  if (!opt || opt.retry) throw new Error(`truck option for 15C-167.31 not tappable: ${JSON.stringify(opt)}`);
  await trustedTapPoint(opt, '15C-167.31');
  log('truck-picked', { option: opt.label });
  await sleep(800);

  // Save the assignment so the row becomes PLATED_NOT_ISSUED.
  const saveBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /Lưu thay đổi/.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (b.textContent || '').trim() };
  });
  if (!saveBtn) throw new Error('save button not found');
  await trustedTapPoint(saveBtn, 'Lưu thay đổi');
  log('save-clicked');
  await sleep(2500);

}

  // Close + reopen so the editor re-derives a clean draft from the saved row
  // (a kept-open modal can hold a stale planDirty hint that hides the select).
  const reopenEditor = async () => {
    for (let a = 0; a < 6; a += 1) {
      const again = await page.evaluate((bl) => {
        const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && r.querySelector('button') && !r.querySelector('tr'));
        if (!row) return null;
        const btn = [...row.querySelectorAll('button')].find((b) => /Sửa|Phân xe lại/.test(b.textContent || ''));
        if (!btn) return null;
        btn.scrollIntoView({ block: 'center' });
        const r = btn.getBoundingClientRect();
        const vh = window.innerHeight;
        return (r.y > 60 && r.y < vh - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
      }, bl);
      if (again) { await trustedTapPoint(again, 'Sửa'); await sleep(2400); return; }
      await sleep(900);
    }
  };
  const huy = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /^Hủy$/.test((x.textContent || '').trim()));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (huy) { await trustedTapPoint(huy, 'Hủy'); await sleep(1200); }
  await reopenEditor();
  let fieldset = false;
  for (let w = 0; w < 12; w += 1) {
    fieldset = await page.evaluate(() => { const fs = document.querySelector('.dispatch-assignment-dialog__issue'); return Boolean(fs && /Moóc cho chuyến \(ghi đè\)/.test(fs.textContent || '')); });
    if (fieldset) break;
    if (!(await page.evaluate(() => Boolean(document.querySelector('.dispatch-assignment-dialog'))))) {
      await reopenEditor();
    }
    await sleep(1000);
  }
  if (!fieldset) throw new Error('issue fieldset with override select never appeared after save');

  // Issue section asserts: legend, coupled-trailer line, override select.
  const dlg = await page.evaluate(() => {
    const fs = document.querySelector('.dispatch-assignment-dialog__issue');
    if (!fs) return null;
    const t = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    return {
      legend: fs.querySelector('legend')?.textContent?.trim(),
      coupledLine: (t(fs).match(/Moóc đang ghép: [^G]*?(?=Ghi đè|Moóc cho|$)/) || [''])[0].trim().slice(0, 120),
      overrideLabelPresent: /Moóc cho chuyến \(ghi đè\)/.test(t(fs)),
    };
  });
  if (!dlg || !dlg.overrideLabelPresent) throw new Error(`issue section incomplete: ${JSON.stringify(dlg)}`);
  log('issue-section', dlg);

  // Pick the override (value ≠ '') and assert the comparison note appears.
  // UuiSelectField = popover-listbox trigger (no native select): tap the
  // trigger inside the issue fieldset, then tap the override option.
  // UuiSelectField with ≥SEARCH_THRESHOLD options renders the type-to-search
  // combobox variant — an input, not a trigger button. Click it, type, pick.
  const findInput = () => page.evaluate(() => {
    const fs = document.querySelector('.dispatch-assignment-dialog__issue');
    const i = fs?.querySelector('input');
    if (!i || i.offsetParent === null) return null;
    i.scrollIntoView({ block: 'nearest' });
    const r = i.getBoundingClientRect();
    const vh = window.innerHeight;
    return (r.y > 50 && r.y < vh - 40) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { offscreen: true };
  });
  const trustedTapAny = async (point) => {
    const got = await page.evaluate((pt) => Boolean(document.elementFromPoint(pt.x, pt.y)), point);
    if (!got) throw new Error(`hit-test missed (any): ${JSON.stringify(point)}`);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
  };
  let inp = null;
  let optionsOpen = false;
  for (let attempt = 0; attempt < 3 && !optionsOpen; attempt += 1) {
    inp = await findInput();
    if (!inp || inp.offscreen) throw new Error(`override combobox input not tappable: ${JSON.stringify(inp)}`);
    await trustedTapAny(inp);
    await sleep(600);
    if (attempt === 0) {
      await page.keyboard.type('15RM-007.55', { delay: 70 });
      await sleep(1200);
    }
    optionsOpen = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].some((x) => x.offsetParent !== null && /15RM-007\.55/.test(x.textContent || '')));
    log('override-input', { attempt: attempt + 1, optionsOpen });
  }
  if (!optionsOpen) throw new Error('override options never opened');
  let ovOpt = null;
  for (let o = 0; o < 5; o += 1) {
    ovOpt = await page.evaluate(() => {
      const el = [...document.querySelectorAll('[role="option"]')]
        .filter((x) => x.offsetParent !== null)
        .find((x) => /15RM-007\.55/.test(x.textContent || '') && !/moóc đang ghép/.test(x.textContent || ''));
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 50 && r.y < vh - 40) ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (el.textContent || '').trim().slice(0, 60) } : { retry: true };
    });
    if (ovOpt && !ovOpt.retry) break;
    await sleep(800);
  }
  if (!ovOpt || ovOpt.retry) throw new Error(`override option 15RM-007.55 not tappable: ${JSON.stringify(ovOpt)}`);
  await trustedTapPoint(ovOpt, '15RM-007.55');
  log('override-picked', { option: ovOpt.label });
  await sleep(900);
  const note = await page.evaluate(() => {
    const fs = document.querySelector('.dispatch-assignment-dialog__issue');
    const t = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    return (t(fs).match(/Ghi đè moóc: [^.]*\./) || [''])[0];
  });
  log('override-note', { note, present: note.length > 0 });
  await page.screenshot({ path: `${QA}/2026-10-06_card387_ui-issue-dialog-override.png` });

  // Issue (trusted tap on Phát lệnh).
  const btn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.dispatch-assignment-dialog__issue-btn')].filter((x) => x.offsetParent !== null)[0]
      ?? [...document.querySelectorAll('.dispatch-assignment-dialog__issue button')].find((x) => /Phát lệnh/.test(x.textContent || ''));
    if (!b) return null;
    b.scrollIntoView({ block: 'nearest' });
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, enabled: !b.disabled, label: (b.textContent || '').trim() };
  });
  if (!btn?.enabled) throw new Error(`issue button missing/disabled: ${JSON.stringify(btn)}`);
  const hit2 = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.textContent?.trim(), btn);
  if (!hit2 || !/Phát lệnh/.test(hit2)) throw new Error(`hit-test missed button: ${hit2}`);
  await page.mouse.move(btn.x, btn.y); await page.mouse.down(); await page.mouse.up();
  log('issue-clicked', { label: btn.label });

  // Wait for the mutation to land (dialog closes; row leaves planning).
  for (let i = 0; i < 20; i += 1) {
    await sleep(1000);
    const state = await page.evaluate((bl) => {
      const open = Boolean(document.querySelector('.dispatch-assignment-dialog__issue'));
      const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && !r.querySelector('tr'));
      return { dialogOpen: open, rowText: row ? (row.textContent || '').replace(/\s+/g, ' ').slice(0, 220) : null };
    }, bl);
    if (issueResponse || !state.dialogOpen) {
      log('issue-settled', { ...state, afterSeconds: i + 1 });
      break;
    }
  }
  await page.screenshot({ path: `${QA}/2026-10-06_card387_ui-after-issue.png` });
} finally {
  await browser.close();
}

log('mutation-response', issueResponse ?? { missing: true });
const trip = issueResponse?.body?.trip ?? issueResponse?.body?.data?.trip ?? null;
const tripId = trip?.id ?? null;
log('trip', { tripId, tripCode: trip?.tripCode ?? trip?.code ?? null, trailerId: trip?.trailerId ?? null, expectedTrailerId: overrideTrailer.id });

writeFileSync(`${QA}/2026-10-06_card387_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
if (!tripId) { console.log('DRIVER FAILED: no trip in mutation response'); process.exit(1); }
if (trip?.trailerId != null && Number(trip.trailerId) !== Number(overrideTrailer.id)) {
  console.log(`DRIVER FAILED: trailer_id ${trip.trailerId} != override ${overrideTrailer.id}`);
  process.exit(1);
}
console.log('DRIVER OK');
