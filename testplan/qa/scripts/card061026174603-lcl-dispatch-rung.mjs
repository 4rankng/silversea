// Card 061026174603 — the UI rung the lane was blocked on: a Hàng lẻ (LCL) lot
// must be assignable a rig on /dispatch-detail and then Phát lệnh-able.
// MODE=before: current staging (pre-7284891a) — Save must show the 409 alert
//   'Lô hàng không có container để gán xe.' (the live red, refused = no mutation).
// MODE=after: staging at 7284891a — Save succeeds, then Phát lệnh issues a trip.
// Fixture: ONE self-marked LCL lot (QA-LCLRUNG-<stamp>), created once, reused
// across modes via QA_LCL_BL. Real pointer taps at hit-tested coordinates only.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import { writeFileSync } from 'node:fs';

const MODE = process.env.QA_MODE || 'before';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-06_lcl-rig';
const BL = process.env.QA_LCL_BL || `QA-LCLRUNG-${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12)}`;
const MARKER = `QAFIXTURE card061026174603 rung ${BL} — lô Hàng lẻ có ngày cho UI rung. Xoa duoc sau QA.`;
const EXPECT_RED = 'Lô hàng không có container để gán xe.';
const PLATE = process.env.QA_PLATE || ''; // empty = auto-pick first own truck with driver

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const apiFor = (token) => async (method, path, body) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = { raw: text.slice(0, 200) }; }
  return { status: response.status, body: parsed };
};

// Build currency + login
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, mode: MODE });
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
if (!login.ok) throw new Error(`admin login ${login.status}`);
const loginJson = await login.json();
const admin = apiFor(loginJson.token ?? loginJson.accessToken);
log('login-admin', { ok: true });

// ── Fixture: one self-marked LCL lot with a closingAt window ───────────────
let shipmentId = null;
let bl = BL;
{
  const probe = await admin('GET', '/shipments/cus-workspace?page=1&limit=1');
  log('workspace-probe', { status: probe.status });
  const customers = await admin('GET', '/customers?limit=500');
  const list = Array.isArray(customers.body) ? customers.body : customers.body?.items ?? [];
  const live = list.filter((c) => c.deletedAt == null);
  if (live.length === 0) throw new Error('no live customer');
  // In-window date: the grid scopes to the current month and the transport
  // date reads coalesce(container appointment, expectedDeliveryDate) — an LCL
  // lot needs BOTH closingAt (the rig window) and expectedDeliveryDate (the
  // list bucket) to surface on /dispatch-detail.
  const dayAfter = new Date(new Date(new Date().getTime() + 1 * 86400_000).toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
  const appt = dayAfter.toISOString();
  const dayStr = `${dayAfter.getFullYear()}-${String(dayAfter.getMonth() + 1).padStart(2, '0')}-${String(dayAfter.getDate()).padStart(2, '0')}`;
  if (process.env.QA_LCL_SHIPMENT_ID) {
    shipmentId = Number(process.env.QA_LCL_SHIPMENT_ID);
    log('fixture-reuse', { shipmentId, bl });
  } else {
    const created = await admin('POST', '/shipments', {
      customerId: live[0].id,
      cargoMode: 'LCL',
      tradeDirection: 'IMPORT',
      blNumber: BL,
      shippingLineName: 'QA Line',
      routeId: 6, // KCN Quế Võ, Nam Sơn, Bắc Ninh — the live route the visible lots run
      customerNotes: MARKER,
    });
    if (created.status !== 200 && created.status !== 201) throw new Error(`lot create ${created.status} ${JSON.stringify(created.body).slice(0, 300)}`);
    shipmentId = created.body.id ?? created.body.shipment?.id;
    bl = created.body.blNumber ?? BL;
    log('lot-created', { shipmentId, bl, customerId: live[0].id, closingAtWanted: appt });
    // Set the lot window (closingAt) — the dispatch list reads coalesce(closingAt, plannedReturnAt).
    let setWin = await admin('PUT', `/shipments/${shipmentId}`, { expectedVersion: created.body.version ?? 1, closingAt: appt, expectedDeliveryDate: dayStr });
    if (setWin.status === 404 || setWin.status === 405) {
      const ws = await admin('GET', `/shipments/cus-workspace/${shipmentId}`);
      log('workspace-after-create', { status: ws.status, keys: Object.keys(ws.body ?? {}).slice(0, 12), summary: ws.body?.summary ?? null });
      setWin = { status: 'no-put', body: null };
    }
    log('window-set', { status: setWin.status, body: JSON.stringify(setWin.body).slice(0, 200) });
  }
  const detail = await admin('GET', `/shipments/cus-workspace/${shipmentId}`);
  log('fixture-detail', { status: detail.status, summary: JSON.stringify(detail.body?.summary ?? detail.body).slice(0, 260) });

  // Handoff: the READY queue lists fulfillments joined to an ACCEPTED handoff.
  const probe2 = await admin('GET', `/shipments/${shipmentId}/dispatch-handoff`);
  let handoffRow = probe2.status === 200 ? (probe2.body?.id ? probe2.body : probe2.body?.handoff ?? null) : null;
  if (!handoffRow) {
    const nh = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs`, {});
    if (![200, 201, 409].includes(nh.status)) throw new Error(`handoff create ${nh.status} ${JSON.stringify(nh.body).slice(0, 200)}`);
    handoffRow = nh.body?.handoff ?? nh.body;
    log('handoff-ensured', { existed: false, status: nh.status });
  } else log('handoff-ensured', { existed: true, status: handoffRow.status });
  if (handoffRow && handoffRow.status !== 'ACCEPTED') {
    let resolved = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs/${handoffRow.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: handoffRow.handoffVersion ?? handoffRow.version });
    if (resolved.status !== 200 && resolved.status !== 201) {
      resolved = await admin('POST', `/shipments/${shipmentId}/dispatch-handoffs/${handoffRow.id}/resolve`, { resolution: 'ACCEPTED', expectedVersion: handoffRow.version });
    }
    if (resolved.status !== 200 && resolved.status !== 201) throw new Error(`handoff accept ${resolved.status} ${JSON.stringify(resolved.body).slice(0, 200)}`);
    log('handoff-accepted', { handoffId: handoffRow.id });
  }
}

// Rig: an OWN truck with a driver (kb387 fleet pick), for the combobox pick.
let plate = PLATE;
if (!plate) {
  const fleet = await admin('GET', '/shipments/dispatch-fleet?resource=TRUCK');
  if (fleet.status !== 200) throw new Error(`fleet ${fleet.status}`);
  const rig = fleet.body.items.find((t) => t.assignedDriverId != null);
  if (!rig) throw new Error('no own truck with driver');
  plate = rig.licensePlate;
  log('rig', { plate, truckId: rig.id });
}

// ── Browser rung (dungnv = DISPATCHER) ──────────────────────────────────────
const loginD = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
if (!loginD.ok) throw new Error(`dungnv login ${loginD.status}`);
const dungnvToken = (await loginD.json()).token;
log('login-dispatcher', { ok: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let issueResponse = null;
let saveOutcome = null;
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  page.on('response', async (res) => {
    const m = res.request().method();
    if (/dispatch-detail-plan-rows\/\d+\/(plate|carrier|estimates|plan)/.test(res.url()) && m === 'PUT') {
      const text = await res.text().catch(() => '');
      saveOutcome = { status: res.status(), body: text.slice(0, 200) };
      log('save-response', { status: res.status(), body: text.slice(0, 200) });
    }
    if (res.url().includes(`/shipments/${shipmentId}/dispatch`) && m === 'POST') {
      const text = await res.text().catch(() => '');
      issueResponse = { status: res.status(), body: text ? text.slice(0, 240) : null };
      log('issue-response', { status: res.status(), body: text.slice(0, 240) });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dungnvToken);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  // Filter the grid to MY lot via the page quick search (row can sit past page 1).
  const searchBox = await page.evaluate(() => {
    const cand = [...document.querySelectorAll('input[type="text"], input[type="search"]')]
      .filter((i) => i.offsetParent !== null && !i.closest('.dispatch-assignment-dialog'));
    const el = cand.find((i) => /Bill, Cont/.test(i.placeholder || '') || /Tìm nhanh/.test(i.getAttribute('aria-label') || '')) ?? null;
    if (!el) return { placeholder: 'no-quick-search-input', all: cand.map((i) => i.placeholder || i.getAttribute('aria-label')).slice(0, 6) };
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + Math.min(120, r.width / 2), y: r.y + r.height / 2, placeholder: el.placeholder || '' };
  });
  if (searchBox && typeof searchBox.x === 'number') {
    const hitS = await page.evaluate((pt) => Boolean(document.elementFromPoint(pt.x, pt.y)), searchBox);
    if (hitS) {
      await page.mouse.move(searchBox.x, searchBox.y); await page.mouse.down(); await page.mouse.up();
      await sleep(400);
      await page.keyboard.type(bl, { delay: 60 });
      log('quick-search-typed', { bl, placeholder: searchBox.placeholder });
      await sleep(2500);
    }
  }

  const trustedTapPoint = async (point, expectText) => {
    const got = await page.evaluate((pt) => document.elementFromPoint(pt.x, pt.y)?.textContent?.trim().slice(0, 60), point);
    if (!got || !(got.includes(expectText))) throw new Error(`hit-test missed (${expectText}): ${got}`);
    await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
  };

  // Find MY LCL row by BL and open its editor.
  let target = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    target = await page.evaluate((bl) => {
      const row = [...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && r.querySelector('button') && !r.querySelector('tr'));
      if (!row) return { missing: true };
      const btn = [...row.querySelectorAll('button')].find((b) => /Gán xe|Sửa|Phân xe/.test(b.textContent || '')) ?? row.querySelector('button');
      btn.scrollIntoView({ block: 'center' });
      const r = btn.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 60) ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (btn.textContent || '').trim() } : { offscreen: true, y: r.y };
    }, bl);
    if (target && !target.missing && !target.offscreen) break;
    await sleep(900);
  }
  if (!target || target.missing) {
    const state = await page.evaluate(() => (document.body.textContent || '').includes('Chỉ lô hàng') ? 'page-loaded' : 'unknown');
    throw new Error(`row for ${bl} not found on /dispatch-detail (page: ${state}) — LCL row with closingAt never listed`);
  }
  if (target.offscreen) throw new Error(`row button never entered viewport: ${JSON.stringify(target)}`);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-row-${MODE}.png` });
  const hit = await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.textContent?.trim().slice(0, 40), target);
  if (!hit || !hit.includes(target.label)) throw new Error(`hit-test missed: point=${JSON.stringify(target)} hit=${hit}`);
  await page.mouse.move(target.x, target.y); await page.mouse.down(); await page.mouse.up();
  log('open-editor', { rowButton: target.label, bl });
  await sleep(2500);
  await page.waitForSelector('.dispatch-assignment-dialog', { timeout: 20000 });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-dialog-${MODE}.png` });

  // Log the dialog state (classification default + options) for the record.
  const dlgState = await page.evaluate(() => {
    const dlg = document.querySelector('.dispatch-assignment-dialog');
    const sel = dlg?.querySelector('select');
    return {
      classificationValue: sel?.value ?? null,
      classificationOptions: sel ? [...sel.options].map((o) => o.text) : null,
      hasVehicleTrigger: /Chọn biển số xe/.test(dlg?.textContent || ''),
      errorBefore: dlg?.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    };
  });
  log('dialog-state', dlgState);

  // Classification: keep the row's default. Migration 0030's check
  // (shipment_fulfillments_lcl_dispatch_classification_check) pins an
  // LCL_SHIPMENT fulfillment to 'LCL' — picking the offered 'Lấy Lẻ' 500s
  // (separate defect, carded apart). The default IS the valid value.

  // Vehicle combobox: tap trigger, type plate, tap matching option.
  const veh = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.dispatch-assignment-dialog button, .dispatch-assignment-dialog [role="button"], .dispatch-assignment-dialog span')]
      .find((x) => /Chọn biển số xe/.test(x.textContent || '') && x.offsetParent !== null && (x.matches('button, [role="button"], [tabindex]') || x.closest('label')));
    if (!el) return null;
    const target = el.closest('button, [role="button"], [tabindex]') ?? el;
    target.scrollIntoView({ block: 'nearest' });
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!veh) throw new Error('vehicle trigger not found');
  await trustedTapPoint(veh, 'Chọn biển số xe');
  await sleep(700);
  await page.evaluate(() => {
    const cand = [...document.querySelectorAll('input')].filter((i) => i.offsetParent !== null && !i.closest('.dispatch-assignment-dialog')).find((i) => i.type === 'text' || i.type === 'search');
    if (cand) cand.focus();
  });
  await page.keyboard.type(plate, { delay: 70 });
  log('vehicle-typed', { plate });
  await sleep(1400);
  let opt = null;
  for (let o = 0; o < 5; o += 1) {
    opt = await page.evaluate((pl) => {
      const el = [...document.querySelectorAll('[role="option"], [role="listbox"] *')].find((x) => (x.textContent || '').includes(pl) && x.offsetParent !== null);
      if (!el) return null;
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      return (r.y > 60 && r.y < vh - 40) ? { x: r.x + r.width / 2, y: r.y + r.height / 2, label: (el.textContent || '').trim().slice(0, 60) } : { retry: true };
    }, plate);
    if (opt && !opt.retry) break;
    await sleep(700);
  }
  if (!opt || opt.retry) throw new Error(`truck option for ${plate} not tappable: ${JSON.stringify(opt)}`);
  await trustedTapPoint(opt, plate);
  log('truck-picked', { option: opt.label });
  await sleep(800);

  // Save.
  const saveBtn = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).find((x) => /Lưu thay đổi/.test(x.textContent || ''));
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!saveBtn) throw new Error('save button not found');
  await trustedTapPoint(saveBtn, 'Lưu thay đổi');
  log('save-clicked', { mode: MODE });
  await sleep(2500);

  const afterSave = await page.evaluate(() => ({
    error: document.querySelector('.dispatch-assignment-dialog [role="alert"]')?.textContent?.trim() ?? null,
    dialogOpen: Boolean(document.querySelector('.dispatch-assignment-dialog')),
    gridBanners: [...document.querySelectorAll('.dispatch-plan-page__error[role="alert"]')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 3),
  }));
  log('after-save', { ...afterSave, saveResponse: saveOutcome });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-save-${MODE}.png` });

  if (MODE === 'before') {
    if (afterSave.error && afterSave.error.includes(EXPECT_RED)) {
      log('RED-CONFIRMED', { error: afterSave.error });
    } else {
      log('FAIL-red-not-observed', { afterSave });
      exitCode = 1;
    }
  } else {
    // AFTER: save must succeed — no 409 alert; fulfillment carries the plate.
    if (afterSave.error) { log('FAIL-unexpected-error', { afterSave }); throw new Error(`after-save error: ${afterSave.error}`); }
    const chk = await admin('GET', `/shipments/cus-workspace/${shipmentId}`);
    log('post-save-workspace', { status: chk.status, body: JSON.stringify(chk.body).slice(0, 300) });
    await sleep(1200);

    // Reopen the editor → issue fieldset → Phát lệnh.
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
        if (again) {
          const got = await page.evaluate((pt) => Boolean(document.elementFromPoint(pt.x, pt.y)), again);
          if (!got) throw new Error('hit-test missed on reopen');
          await page.mouse.move(again.x, again.y); await page.mouse.down(); await page.mouse.up();
          await sleep(2400);
          return;
        }
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
      fieldset = await page.evaluate(() => Boolean(document.querySelector('.dispatch-assignment-dialog__issue')));
      if (fieldset) break;
      if (!(await page.evaluate(() => Boolean(document.querySelector('.dispatch-assignment-dialog'))))) await reopenEditor();
      await sleep(1000);
    }
    log('issue-fieldset', { present: fieldset });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-issue-dialog-${MODE}.png` });
    if (!fieldset) { log('FAIL-no-issue-fieldset'); exitCode = 1; } else {
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
      for (let i = 0; i < 20; i += 1) {
        await sleep(1000);
        const state = await page.evaluate((bl) => ({
          dialogOpen: Boolean(document.querySelector('.dispatch-assignment-dialog__issue')),
          rowText: ([...document.querySelectorAll('tr')].find((r) => (r.textContent || '').includes(bl) && !r.querySelector('tr'))?.textContent || '').replace(/\s+/g, ' ').slice(0, 200),
        }), bl);
        if (issueResponse || !state.dialogOpen) { log('issue-settled', { ...state, afterSeconds: i + 1 }); break; }
      }
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-after-issue-${MODE}.png` });
      const trip = issueResponse?.body?.trip ?? issueResponse?.body?.data?.trip ?? null;
      log('trip', { tripId: trip?.id ?? null, tripCode: trip?.tripCode ?? null, status: issueResponse?.status ?? null });
      if (!issueResponse || issueResponse.status >= 300) { log('FAIL-issue-not-201'); exitCode = 1; }
    }
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 400) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver-${MODE}.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
}
log('done', { mode: MODE, bl, shipmentId, exitCode });
console.log(`NEXT: QA_LCL_BL=${bl} QA_LCL_SHIPMENT_ID=${shipmentId}`);
process.exit(exitCode);
