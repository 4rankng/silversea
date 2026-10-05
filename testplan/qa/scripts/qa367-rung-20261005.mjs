// Card 20261005_367 — staging QA rung driver (build 19ed100f).
// Verifies the four changed save/refusal surfaces render the backend's verbatim
// 4xx `error` string: CUS appointment popover save, admin Business Units
// duplicate-code save, CUSTOMER work-inbox delivery-response 409, Monthly
// Productivity export failure. Real trusted taps via lead-qa-lib hit-testing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { launch, tap, shot, setViewport, withAborted, domText } from './lead-qa-lib.mjs';

const BASE = 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const EV = process.argv[2] || 'testplan/qa/evidence/2026-10-05_367-loi-chung-giau-nguyen-nhan-api';
const WIDTHS = [1280, 1440, 1920, 2560];
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

const log = [];
function note(s) { log.push(s); console.log(s); }

async function tok(user) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: user, password: 'Abc123' }),
  });
  if (!r.ok) throw new Error(`login ${user} -> ${r.status}`);
  return (await r.json()).token;
}

async function apiWrite(token, method, p, body) {
  const r = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 400); }
  return { status: r.status, data };
}
async function apiGet(token, p) {
  const r = await fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text.slice(0, 400); }
  return { status: r.status, data };
}

async function rolePage(browser, user) {
  const token = await tok(user);
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t, origin) => {
    if (location.origin === origin) localStorage.setItem('token', t);
    window.__probe = { pointerdown: 0, click: 0, keydown: 0, any: 0, anyPointer: 0 };
    for (const ev of ['pointerdown', 'click', 'keydown']) {
      document.addEventListener(ev, (e) => {
        window.__probe.any += 1;
        if (ev === 'pointerdown') window.__probe.anyPointer += 1;
        if (e.isTrusted) window.__probe[ev] += 1;
      }, { capture: true, passive: true });
    }
  }, token, BASE);
  page.on('pageerror', (e) => note(`  [pageerror ${user}] ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') note(`  [console.error ${user}] ${m.text().slice(0, 200)}`); });
  return { ctx, page, token, user };
}

async function goto(page, p, wait = 1500) {
  await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await settle(wait);
}

async function matrix(page, label, dir) {
  for (const w of WIDTHS) {
    await setViewport(page, w, 900);
    await settle(page, 800);
    await shot(page, path.join(dir, `${label}_w${w}.png`), { full: false });
  }
  await setViewport(page, 1440, 900);
  await settle(page, 500);
}

async function text(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.innerText.trim() : null;
  }, sel);
}
async function tapHandle(page, el, label) {
  const box = await el.boundingBox();
  if (!box) throw new Error(`tapHandle: no box for "${label}"`);
  const cx = Math.round(box.x + box.width / 2), cy = Math.round(box.y + box.height / 2);
  const probe = () => page.evaluate(() => ({ ...window.__probe }));
  const before = await probe();
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await settle(700);
  const after = await probe();
  if (after.pointerdown <= before.pointerdown) throw new Error(`tapHandle: no trusted pointerdown for "${label}"`);
  return { cx, cy };
}

async function clickText(page, text, scope = 'button, a, [role="tab"], [role="button"]') {
  const handle = await page.evaluateHandle((t, sc) => {
    const nodes = Array.from(document.querySelectorAll(sc));
    return nodes.find((n) => (n.innerText || '').trim().includes(t) && n.offsetParent !== null) || null;
  }, text, scope);
  const el = handle.asElement();
  if (!el) throw new Error(`clickText: no visible control containing "${text}"`);
  return tapHandle(page, el, text);
}

const results = {};

async function main() {
  await fs.mkdir(EV, { recursive: true });

  // --- build-currency gate (HARD) ---
  const health = await (await fetch(`${API}/health`)).json();
  note(`HEALTH status=${health.status} buildHash=${health.buildHash}`);
  await fs.writeFile(path.join(EV, 'health.json'), JSON.stringify(health, null, 2));
  if (health.buildHash !== '19ed100f') {
    note(`ABORT: buildHash ${health.buildHash} != 19ed100f`);
    await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
    process.exit(2);
  }

  const { browser } = await launch({ width: 1440, height: 900, base: BASE });

  // ================= Surface 1: admin Business Units duplicate-code save =====
  try {
    note('--- S1 admin Business Units duplicate-code ---');
    const admin = await rolePage(browser, 'admin');
    // unique fixtures (QA367)
    const a = await apiWrite(admin.token, 'POST', '/auth/business-units', { code: 'QA367-ALPHA', name: 'QA367 Alpha' });
    const b = await apiWrite(admin.token, 'POST', '/auth/business-units', { code: 'QA367-BETA', name: 'QA367 Beta' });
    note(`  fixtures create: A=${a.status} B=${b.status}`);
    results.s1 = { fixtures: { A: a.status, B: b.status } };

    await goto(admin.page, '/users');
    await matrix(admin.page, 's1_users_withdata', EV);

    // open the Sửa form on the QA367-ALPHA card
    const found = await admin.page.evaluateHandle(() => {
      const cards = Array.from(document.querySelectorAll('.business-units__card'));
      return cards.find((c) => (c.innerText || '').includes('QA367 Alpha')) || null;
    });
    const card = found.asElement();
    if (!card) throw new Error('S1: QA367 Alpha card not found');
    const editBtn = await card.$('button');
    const ebox = await editBtn.boundingBox();
    const probe = () => admin.page.evaluate(() => ({ ...window.__probe }));
    let before = await probe();
    await admin.page.mouse.move(Math.round(ebox.x + ebox.width / 2), Math.round(ebox.y + ebox.height / 2));
    await admin.page.mouse.down(); await admin.page.mouse.up();
    await settle(600);
    let after = await probe();
    results.s1.editTapTrusted = after.pointerdown > before.pointerdown;

    // set code to the duplicate value
    await admin.page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('.business-units__form-grid input'));
      const code = inputs[0];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(code, 'QA367-BETA');
      code.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(400);
    await admin.page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('.business-units__form-grid input'));
      const name = inputs[1];
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(name, 'QA367 Alpha');
      name.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await settle(300);
    await clickText(admin.page, 'Lưu đơn vị');
    await settle(1500);
    const banner = await text(admin.page, '.users-error-banner');
    results.s1.banner = banner;
    await shot(admin.page, path.join(EV, 's1_duplicate_error.png'), { full: false });
    // error-state matrix
    await matrix(admin.page, 's1_users_error', EV);
    note(`  banner="${banner}"`);
    await admin.ctx.close();
  } catch (e) { note(`S1 ERROR: ${e.message}`); results.s1 = { ...(results.s1 || {}), error: e.message }; }

  // ================= Surface 2: CUSTOMER work-inbox delivery-response 409 ====
  try {
    note('--- S2 customer work inbox 409 ---');
    const cust = await rolePage(browser, 'khachhang');
    const inbox = await apiGet(cust.token, '/portal/work-inbox?view=ACTION&page=1&limit=100');
    const item = (inbox.data.items || []).find((i) => i.id === 'shipment:265' && i.deliveryResponseRequired);
    note(`  fixture item: ${JSON.stringify(item && { id: item.id, ev: item.deliveryEventId, v: item.deliveryEventVersion })}`);
    results.s2 = { item: item ? { id: item.id, shipmentId: item.shipmentId, deliveryEventId: item.deliveryEventId, version: item.deliveryEventVersion } : null };
    if (!item) throw new Error('S2: fixture shipment:265 action item not found');

    await goto(cust.page, '/portal/shipments', 2500);
    await matrix(cust.page, 's2_inbox_withdata', EV);
    await shot(cust.page, path.join(EV, 's2_inbox_item.png'), { full: false });

    // Create the FIRST response via API (fresh idempotency key) so the UI's
    // held version is answered -> the UI's own submit gets the real 409.
    const first = await apiWrite(cust.token, 'POST',
      `/portal/shipments/${item.shipmentId}/customer-events/${item.deliveryEventId}/delivery-response`,
      { expectedVersion: item.deliveryEventVersion, decision: 'CONFIRMED' });
    note(`  first API response: ${first.status} ${JSON.stringify(first.data).slice(0, 120)}`);
    results.s2.firstApi = first.status;

    // Now tap the UI's confirm button for that row -> 409.
    const confirmed = await cust.page.evaluateHandle((sid) => {
      const rows = Array.from(document.querySelectorAll('.role-work-inbox__table tr'));
      const row = rows.find((r) => (r.innerText || '').includes(String(sid)));
      if (!row) return null;
      return Array.from(row.querySelectorAll('button')).find((b) => (b.innerText || '').includes('Xác nhận đã nhận hàng')) || null;
    }, 'BLCUSa24BB');
    const btn = confirmed.asElement();
    if (!btn) throw new Error('S2: confirm button for BLCUSa24BB not found');
    const bb = await btn.boundingBox();
    const probe2 = () => cust.page.evaluate(() => ({ ...window.__probe }));
    const b1 = await probe2();
    await cust.page.mouse.move(Math.round(bb.x + bb.width / 2), Math.round(bb.y + bb.height / 2));
    await cust.page.mouse.down(); await cust.page.mouse.up();
    await settle(1800);
    const b2 = await probe2();
    results.s2.tapTrusted = b2.pointerdown > b1.pointerdown;
    const msg = await text(cust.page, '.role-work-inbox__notice.is-conflict');
    results.s2.conflictMessage = msg;
    await shot(cust.page, path.join(EV, 's2_conflict_409.png'), { full: false });
    await matrix(cust.page, 's2_inbox_error', EV);
    note(`  conflict message="${msg}"`);
    await cust.ctx.close();
  } catch (e) { note(`S2 ERROR: ${e.message}`); results.s2 = { ...(results.s2 || {}), error: e.message }; }

  // ================= Surface 3: CUS appointment popover save (409) ===========
  try {
    note('--- S3 CUS appointment popover save 409 ---');
    const cus = await rolePage(browser, 'thanhdc');
    const det = await apiGet(cus.token, '/shipments/cus-workspace/236');
    const summary = det.data.summary || {};
    const cont = (det.data.containers || [])[0] || {};
    note(`  fixture shipment 236 v=${summary.version} container=${cont.id} editable=${cont.permissions && cont.permissions.customerAppointmentEditable}`);
    results.s3 = { version: summary.version, containerId: cont.id, editable: cont.permissions && cont.permissions.customerAppointmentEditable };

    await goto(cus.page, '/shipments', 2500);
    await matrix(cus.page, 's3_workboard_withdata', EV);

    // open the 236 drawer (fall back to searching if the row is off page 1)
    let hasRow = await cus.page.evaluate(() => !!document.querySelector('#cus-dashboard-detail-236'));
    if (!hasRow) {
      const search = await cus.page.$('input[aria-label="Tìm lô hàng"]');
      if (search) {
        await search.click();
        await cus.page.keyboard.type('MSCU1708813', { delay: 30 });
        await settle(2500);
        hasRow = await cus.page.evaluate(() => !!document.querySelector('#cus-dashboard-detail-236'));
      }
    }
    note(`  detail row present=${hasRow}`);
    await tap(cus.page, '#cus-dashboard-detail-236');
    await settle(2500);
    await shot(cus.page, path.join(EV, 's3_drawer_open.png'), { full: false });
    await matrix(cus.page, 's3_drawer_noappointment', EV);

    // open the appointment popover for the container
    const triggerSel = `#cus-drawer-detail-customer-appointment-${cont.id}`;
    await cus.page.evaluate((s) => { const el = document.querySelector(s); if (el) el.scrollIntoView({ block: 'center' }); }, triggerSel);
    await settle(600);
    await tap(cus.page, triggerSel);
    await settle(700);
    const popoverOpen = await cus.page.evaluate(() => !!document.querySelector('.cus-appointment-popover'));
    results.s3.popoverOpen = popoverOpen;
    await shot(cus.page, path.join(EV, 's3_popover_open.png'), { full: false });

    // pick a draft date (real tap on the quick pill)
    if (popoverOpen) await clickText(cus.page, 'Ngày mai');

    // Bump the shipment version via API so the UI's held version goes stale.
    const bump = await apiWrite(cus.token, 'POST', '/shipments/cus-workspace/236/containers/' + cont.id,
      { expectedShipmentVersion: summary.version, customerAppointmentAt: '2026-10-15T08:00:00+07:00' });
    note(`  version bump: ${bump.status} newVersion=${bump.data && (bump.data.line || {}).shipmentVersion}`);
    results.s3.bumpStatus = bump.status;

    // Tap Xác nhận inside the popover -> backend 409.
    const confirmH = await cus.page.evaluateHandle(() => {
      const btn = Array.from(document.querySelectorAll('.cus-appointment-popover button'))
        .find((b) => (b.innerText || '').trim() === 'Xác nhận');
      if (btn) btn.scrollIntoView({ block: 'center' });
      return btn || null;
    });
    const confirmEl = confirmH.asElement();
    if (!confirmEl) throw new Error('S3: popover Xác nhận button not found');
    await settle(400);
    await tapHandle(cus.page, confirmEl, 'Xác nhận');
    await settle(2000);
    const toast = await text(cus.page, '.toast.toast--error .toast__message');
    const popErr = await text(cus.page, '.cus-appointment-popover__error');
    results.s3.toast = toast;
    results.s3.popoverError = popErr;
    await shot(cus.page, path.join(EV, 's3_save_409.png'), { full: false });
    note(`  toast="${toast}" popoverError="${popErr}"`);
    // Close popover (Escape) — non-mutating
    await cus.page.keyboard.press('Escape');
    await settle(600);
    await cus.ctx.close();
  } catch (e) { note(`S3 ERROR: ${e.message}`); results.s3 = { ...(results.s3 || {}), error: e.message }; }

  // ================= Surface 4: Monthly Productivity export ==================
  try {
    note('--- S4 monthly productivity export ---');
    const adm = await rolePage(browser, 'admin');
    await goto(adm.page, '/fleet/productivity', 2500);
    await clickText(adm.page, 'Từng xe trong 1 tháng');
    await settle(2500);
    await matrix(adm.page, 's4_monthly_withdata', EV);
    await shot(adm.page, path.join(EV, 's4_monthly_view.png'), { full: false });

    // Normal export (200) — observe the happy path
    await clickText(adm.page, 'Xuất Excel');
    await settle(2000);
    results.s4.normalExportError = await text(adm.page, '[role="alert"]');

    // Controlled trigger for a REAL backend 4xx on the export endpoint: the UI
    // cannot organically emit an invalid year (its options are currentYear±1),
    // so the in-flight request's year is rewritten to 1999; the backend's 400
    // body is genuine ("Năm tối thiểu là 2020").
    await adm.page.setRequestInterception(true);
    const rewrite = (req) => {
      if (req.url().includes('/fleet/productivity/monthly/export')) {
        const u = new URL(req.url()); u.searchParams.set('year', '1999');
        return req.continue({ url: u.toString() }).catch(() => {});
      }
      return req.continue().catch(() => {});
    };
    adm.page.on('request', rewrite);
    try {
      await clickText(adm.page, 'Xuất Excel');
      await settle(2500);
    } finally {
      adm.page.off('request', rewrite);
      await adm.page.setRequestInterception(false);
    }
    results.s4.export4xxAlerts = await adm.page.evaluate(() =>
      Array.from(document.querySelectorAll('[role="alert"]')).map((e) => e.innerText.trim()).filter(Boolean));
    await shot(adm.page, path.join(EV, 's4_export_4xx_real.png'), { full: false });
    note(`  export 4xx alerts=${JSON.stringify(results.s4.export4xxAlerts)}`);

    // Network-failure path -> generic fallback copy (reachable on staging).
    await withAborted(adm.page, '/fleet/productivity/monthly/export', async () => {
      await clickText(adm.page, 'Xuất Excel');
    }, { settleMs: 4000 });
    await settle(800);
    const alert = await adm.page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[role="alert"]'));
      return els.map((e) => e.innerText.trim()).filter(Boolean);
    });
    results.s4.networkAlert = alert;
    await shot(adm.page, path.join(EV, 's4_export_network_error.png'), { full: false });
    await matrix(adm.page, 's4_monthly_error', EV);
    note(`  network alert=${JSON.stringify(alert)}`);
    await adm.ctx.close();
  } catch (e) { note(`S4 ERROR: ${e.message}`); results.s4 = { ...(results.s4 || {}), error: e.message }; }

  await browser.close();
  await fs.writeFile(path.join(EV, 'rung-results.json'), JSON.stringify({ build: health.buildHash, results }, null, 2));
  await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n'));
  note('DONE');
}

main().catch(async (e) => {
  note(`FATAL ${e.stack || e.message}`);
  try { await fs.writeFile(path.join(EV, 'rung-log.txt'), log.join('\n')); } catch {}
  process.exit(1);
});
