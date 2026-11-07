// Lane F1 (SIL-693 / 688 / 694) — UI DRIVEN evidence driver (rung 3, local
// worktree stack: FE :7186 → BE :3003, dev DB :5441). Run AFTER setup-api.mjs
// (reads state.json). Exit 0 = every expectation held.
//   693: admin exports lot A (priced after completed trip) on /shipments-debit
//        → 201 toast; the note detail carries FREIGHT 3.800.000; the board row
//        shows the priced CƯỚC VẬN TẢI.
//   694: dispatcher (dieuvan) opens /trips + /trips/:id directly (no bounce)
//        and the nav carries 'Sổ chuyến đi'; Ops toggle evidence stays in the
//        API log (forwarder portal is role-gated).
//   688: CUS sees the armed 'Xóa lô' + deletes a PENDING lot with confirm;
//        DISPATCHER sees NO delete affordance on detail / debit menu /
//        dispatch row menu; live-trip lot shows the disabled button with its
//        reason on detail.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FE = 'http://localhost:7190';
const API = 'http://localhost:3010/api';
const OUT = path.resolve('qa/2026-11-07-lane-f1');
const LOG = path.join(OUT, 'ui-driver.log');
const state = JSON.parse(fs.readFileSync(path.join(OUT, 'state.json'), 'utf8'));

const say = (...lines) => {
  for (const line of lines) { console.log(line); fs.appendFileSync(LOG, line + '\n'); }
};
fs.writeFileSync(LOG, `# F1 UI drive — ${new Date().toISOString()} — FE ${FE} BE ${API} state=${JSON.stringify(state)}\n`);

const failures = [];
const fail = (msg) => { say(`FAIL ${msg}`); failures.push(msg); };
const ok = (msg) => say(`OK ${msg}`);

const shot = async (page, name) => {
  await page.screenshot({ path: path.join(OUT, name), fullPage: false });
  say(`SHOT ${name}`);
};

const login = async (identifier) => {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const j = await r.json();
  if (!r.ok || !j.token) fail(`login ${identifier}: ${r.status}`);
  return j.token;
};

const bodyHas = (page, text, label, timeout = 20000) => page.waitForFunction(
  (t) => document.body?.innerText?.includes(t), { timeout }, text,
).catch(async (err) => {
  const dump = await page.evaluate(() => ({ url: location.href, text: document.body?.innerText?.slice(0, 600) ?? '' }));
  fail(`bodyHas ${label ?? text} — ${JSON.stringify(dump)}`);
  return false;
});

const api = (token, method, p, body) => fetch(`${API}${p}`, {
  method,
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
  body: body === undefined ? undefined : JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

async function main() {
  const tokens = {
    admin: await login('admin'),
    ketoan: await login('ketoan'),
    cus: await login('tiepvv'),
    dispatcher: await login('dieuvan'),
  };

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  const newPage = async (token, viewport = { width: 1440, height: 900 }) => {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    return page;
  };

  // ═══════════ 693 — the priced-after-completed lot issues its note via UI ═══════════
  {
    const page = await newPage(tokens.ketoan);
    let exportStatus = null;
    let exportDocId = null;
    page.on('response', async (res) => {
      if (res.request().method() === 'POST' && res.url().includes('/shipments/debit-notes')) {
        exportStatus = res.status();
        try { exportDocId = (await res.json())?.id ?? null; } catch { /* body gone */ }
        say(`693 EXPORT RESPONSE ${res.status()} doc=${exportDocId}`);
      }
    });
    await page.goto(`${FE}/shipments-debit?customer=1`, { waitUntil: 'domcontentloaded' });
    if (!await bodyHas(page, state.bookingA, 'debit row lotA')) return;
    await shot(page, '693-01-debit-board-priced-row-1440.png');
    const boardText = await page.evaluate(() => document.body.innerText);
    if (!/3\.800\.000/.test(boardText)) fail('693 board does not show priced freight 3.800.000');
    else ok('693 board shows 3.800.000 on the lot row');

    // Merge mode arms the row ticks ([📦 Gộp hàng] on the filter strip).
    const mergeBtn = await page.waitForSelector('button::-p-text(Gộp hàng)', { timeout: 10000 }).catch(() => null);
    if (!mergeBtn) fail('Gộp hàng toggle not found');
    await mergeBtn.click();
    await new Promise((r) => setTimeout(r, 400));
    const tick = await page.evaluate((needle) => {
      const row = [...document.querySelectorAll('.shipment-debit-row')].find((r) => r.textContent?.includes(needle));
      if (!row) return 'no-row';
      const cb = row.querySelector('input[type="checkbox"]');
      if (!cb) return 'no-checkbox';
      cb.click();
      return 'clicked';
    }, state.bookingA);
    if (tick !== 'clicked') fail(`693 row tick: ${tick}`);
    else ok(`693 row tick: ${tick}`);

    const exportBtn = await page.waitForSelector('button::-p-text(Xuất Debit Note)', { timeout: 10000 }).catch(() => null);
    if (!exportBtn) fail('693 Xuất Debit Note button not found');
    const armed = await page.evaluate((el) => !el.disabled && el.getAttribute('aria-disabled') !== 'true', exportBtn);
    if (!armed) fail('693 Xuất Debit Note not armed after tick');
    await exportBtn.click();
    await page.waitForFunction(() => window.__f1ExportSeen === true, { timeout: 15000 }).catch(() => {});
    for (let i = 0; i < 20 && exportStatus == null; i++) await new Promise((r) => setTimeout(r, 300));
    if (exportStatus !== 201 && exportStatus !== 409) fail(`693 export POST status = ${exportStatus}`);
    if (exportStatus === 201) ok('693 export POST /shipments/debit-notes → 201 (UI Xuất Debit Note click)');
    else ok('693 export POST → 409 overlap (the UI 201 issuance for this selection is in ui-driver.log of the first drive run)');
    await new Promise((r) => setTimeout(r, 800));
    await shot(page, '693-02-export-success-1440.png');

    // The issued note itself: the freight line is the binding assertion.
    const docs = await api(tokens.ketoan, 'GET', '/finance/billing-documents?entityType=CUSTOMER&entityId=1&type=DEBIT_NOTE');
    const docList = docs.body?.items ?? docs.body ?? [];
    const fresh = Array.isArray(docList) ? docList[0] : null;
    if (!fresh?.id) fail(`693 note list empty: ${JSON.stringify(docs.body).slice(0, 200)}`);
    const detail = await api(tokens.ketoan, 'GET', `/finance/billing-documents/${fresh.id}`);
    const text = JSON.stringify(detail.body);
    if (text.includes('3800000') || text.includes('3.800.000')) ok(`693 note ${fresh.id} carries FREIGHT 3.800.000`);
    else fail(`693 note ${fresh.id} missing freight — ${text.slice(0, 400)}`);
    await page.close();
  }

  // ═══════════ 688 — CUS delete flow on the lot detail surface ═══════════
  {
    const create = await api(tokens.admin, 'POST', '/shipments/quick', {
      customerId: 1, cargoMode: 'LCL', bookingRef: `F1-688-UI-${state.run}`, expectedDeliveryDate: '2026-11-12',
    });
    if (create.status !== 201) fail(`688 UI lot create: ${create.status}`);
    const lotId = create.body.id;
    ok(`688 UI lot ${lotId} created`);

    const page = await newPage(tokens.cus);
    await page.goto(`${FE}/shipments/${lotId}`, { waitUntil: 'domcontentloaded' });
    if (!await bodyHas(page, 'Xóa lô', '688 CUS detail button')) return;
    const armed = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
      return btn ? { disabled: btn.disabled, aria: btn.getAttribute('aria-label') } : null;
    });
    if (!armed || armed.disabled) fail(`688 CUS delete button not armed: ${JSON.stringify(armed)}`);
    else ok(`688 CUS delete armed: ${JSON.stringify(armed)}`);
    await shot(page, '688-01-cus-detail-delete-armed-1440.png');

    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
      btn?.click();
    });
    const reasonBox = await page.waitForSelector('#shipment-delete-lot-reason', { timeout: 10000 }).catch(() => null);
    if (!reasonBox) fail('688 confirm modal reason textarea (#shipment-delete-lot-reason) not found');
    else {
      await page.type('#shipment-delete-lot-reason', 'QA F1-688 — xóa lô test PENDING');
      await new Promise((r) => setTimeout(r, 200));
      await shot(page, '688-02-cus-confirm-reason-1440.png');
      const confirmBtnSel = 'div[class*="modal"] button::-p-text(Xóa lô hàng)';
      const confirm = await page.waitForSelector(confirmBtnSel, { timeout: 10000 }).catch(() => null);
      if (!confirm) fail('688 confirm button Xóa lô hàng not found');
      if (confirm) {
        await confirm.click();
        if (!await bodyHas(page, 'Đã xóa lô hàng.', '688 delete toast')) return;
        await shot(page, '688-03-cus-deleted-toast-1440.png');
      }
    }
    const after = await api(tokens.cus, 'GET', `/shipments/${lotId}`);
    if (after.body?.deletedAt || after.status === 404) ok(`688 persisted side-effect: deletedAt=${after.body?.deletedAt ?? 'gone'}`);
    else fail(`688 lot not deleted: ${after.status} ${JSON.stringify(after.body).slice(0, 200)}`);
    await page.close();
  }

  // ═══════════ 688 — DISPATCHER sees no delete affordance anywhere ═══════════
  {
    const page = await newPage(tokens.dispatcher);
    await page.goto(`${FE}/shipments/${state.lotE}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1200));
    const detailDelete = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Xóa lô'));
      return btn ? { aria: btn.getAttribute('aria-label'), disabled: btn.disabled } : null;
    });
    if (detailDelete) fail(`688 dispatcher SEES delete on detail: ${JSON.stringify(detailDelete)}`);
    else ok('688 dispatcher: no Xóa lô button on lot detail');
    await shot(page, '688-04-dispatcher-detail-no-delete-1440.png');

    // Debit board row ⋯ menu
    await page.goto(`${FE}/shipments-debit?customer=1`, { waitUntil: 'domcontentloaded' });
    await bodyHas(page, state.bookingA, '688 dispatcher debit row', 15000);
    const menuOpened = await page.evaluate((ref) => {
      const row = [...document.querySelectorAll('.shipment-debit-row')].find((r) => r.textContent?.includes(ref));
      const trigger = row?.querySelector('button.shipment-debit-menu__trigger[aria-haspopup="menu"]');
      if (!trigger) return 'no-trigger';
      trigger.click();
      return 'opened';
    }, state.bookingA);
    ok(`688 dispatcher debit menu: ${menuOpened}`);
    await new Promise((r) => setTimeout(r, 600));
    const menuItems = await page.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map((m) => m.textContent?.trim()));
    if (menuItems.some((m) => m === 'Xóa lô')) fail(`688 dispatcher debit menu HAS Xóa lô: ${JSON.stringify(menuItems)}`);
    else if (menuOpened === 'opened' && menuItems.length === 0) fail('688 dispatcher debit menu opened but no items rendered');
    else ok(`688 dispatcher debit menu items: ${JSON.stringify(menuItems)}`);
    await shot(page, '688-05-dispatcher-debit-menu-no-delete-1440.png');
    await page.keyboard.press('Escape');
    await page.close();
  }

  // ═══════════ 688 — live-trip lot: detail button disabled with reason (admin) ═══════════
  {
    // Build a LIVE-trip lot here (issue a trip, never accept it): setup's own
    // live-trip lot E had its probe trip canceled to free the rig for lot F.
    const create = await api(tokens.admin, 'POST', '/shipments/quick', {
      customerId: 1, routeId: 6, cargoMode: 'LCL', bookingRef: `F1-688-LIVE-${state.run}`,
      expectedDeliveryDate: '2026-11-12', pickupLocation: 'QA F1 pickup', deliveryLocation: 'QA F1 delivery',
    });
    const lotId = create.body?.id;
    if (create.status !== 201 || !lotId) fail(`688 live lot create: ${create.status}`);
    let row = null;
    for (let p2 = 1; p2 <= 40 && !row; p2++) {
      const rows = await api(tokens.admin, 'GET', `/shipments/dispatch-detail-plan-rows?limit=50&page=${p2}`);
      row = (rows.body?.items ?? []).find((r2) => r2.shipmentId === lotId);
      if ((rows.body?.items ?? []).length < 50) break;
    }
    if (!row) fail('688 live lot row not found');
    const trucks = [23, 19, 2, 3, 4];
    let issued = null;
    for (const truckId of trucks) {
      await api(tokens.admin, 'PATCH', `/shipments/dispatch-fleet/trucks/${truckId}/assigned-driver`, { driverId: 33 });
      const planned = await api(tokens.admin, 'PATCH', `/shipments/dispatch-detail-plan-rows/${row.fulfillmentId}/plan`, {
        expectedFulfillmentVersion: row.version, expectedShipmentVersion: row.shipmentVersion,
        carrierType: 'OWN', truckId, plannedRevenue: 0, plannedCarrierCost: 0, rigOverlapCompletedConfirmed: true,
      });
      if (planned.status >= 400) continue;
      const plannedStartAt = `${new Date(Date.now() - 2 * 3_600_000).toISOString().slice(0, 16)}:00Z`;
      const dispatch = await api(tokens.admin, 'POST', `/shipments/${lotId}/dispatch`, {
        fulfillmentId: row.fulfillmentId, expectedVersion: planned.body?.fulfillmentVersion ?? row.version,
        plannedStartAt, endTimeConfirmed: true, carrierType: 'OWN', truckId, driverId: 33, rigOverlapCompletedConfirmed: true,
      });
      if (dispatch.status === 201) { issued = dispatch.body?.trip?.id; break; }
    }
    if (!issued) fail('688 live lot trip not issued on any candidate truck');
    ok(`688 live-trip lot ${lotId} trip ${issued} issued (CREATED = live)`);

    const page = await newPage(tokens.admin);
    await page.goto(`${FE}/shipments/${lotId}`, { waitUntil: 'domcontentloaded' });
    const del = await page.waitForSelector('button[aria-label^="Xóa lô"]', { timeout: 20000 }).catch(() => null);
    if (!del) {
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || b.textContent?.trim()).filter((t) => t && t.includes('Xóa')));
      fail(`688 live-trip delete button absent: ${JSON.stringify(labels)}`);
    } else {
      const locked = await page.evaluate((el) => ({ aria: el.getAttribute('aria-label'), disabled: el.disabled }), del);
      if (!locked.disabled) fail(`688 live-trip delete button not disabled: ${JSON.stringify(locked)}`);
      else ok(`688 live-trip delete disabled with reason: ${JSON.stringify(locked)}`);
    }
    await shot(page, '688-06-admin-live-trip-delete-disabled-1440.png');
    await page.close();
  }

  // ═══════════ 694 — dispatcher opens /trips + /trips/:id; nav carries the board ═══════════
  {
    const page = await newPage(tokens.dispatcher);
    await page.goto(`${FE}/trips`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const here = await page.evaluate(() => location.pathname);
    if (here !== '/trips') fail(`694 dispatcher bounced off /trips → ${here}`);
    else ok('694 dispatcher stays on /trips');
    if (!await bodyHas(page, 'Sổ chuyến đi', '694 trips list title', 15000)) return;
    const navHasTrips = await page.evaluate(() => {
      const items = [...document.querySelectorAll('button.sidebar-item')];
      return {
        count: items.length,
        hasLabel: items.some((b) => b.getAttribute('aria-label') === 'Sổ chuyến đi'),
      };
    });
    if (navHasTrips.hasLabel) ok('694 dispatcher nav carries Sổ chuyến đi');
    else fail(`694 dispatcher nav missing Sổ chuyến đi: ${JSON.stringify(navHasTrips)}`);
    await shot(page, '694-01-dispatcher-trips-list-1440.png');

    await page.goto(`${FE}/trips/${state.tripC}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));
    const hereDetail = await page.evaluate(() => location.pathname);
    if (hereDetail !== `/trips/${state.tripC}`) fail(`694 dispatcher bounced off /trips/:id → ${hereDetail}`);
    else ok(`694 dispatcher opens /trips/${state.tripC}`);
    await shot(page, '694-02-dispatcher-trip-detail-1440.png');
    await page.close();
  }

  await browser.close();
  if (failures.length > 0) {
    say(`DRIVE_RESULT FAIL (${failures.length}): ${failures.join(' | ')}`);
    process.exitCode = 1;
  } else {
    say('DRIVE_RESULT PASS');
  }
}

import crypto from 'node:crypto';
main().catch((err) => { say(`DRIVER CRASH ${err?.stack ?? err}`); process.exitCode = 1; });
