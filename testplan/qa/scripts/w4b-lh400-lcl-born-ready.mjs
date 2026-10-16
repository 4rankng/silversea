// W4b verify — card 161026100400 (born-ready LCL lot decomposes at create).
// LH400-01: create LCL + expectedDeliveryDate as DISPATCHER; the lot row must
// be on Kế hoạch Chi tiết Xe IMMEDIATELY (detail-plan API + DB + UI), with no
// write in between. FCL born-ready regression: create-path decompose stays
// FCL-excluded (0 fulfillments at create; row appears only after the container
// write decomposes). LH400-02 control: no dates → 0 fulfillments, 0 rows.
// Every write rides a fresh Idempotency-Key UUID. Fixtures named QA-W4B-*.
//
//   EXPECT_BUILD=1c00c17a node testplan/qa/scripts/w4b-lh400-lcl-born-ready.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const BASE = 'https://vantai.tingting.vip';
const API = BASE + '/api';
const PIN = process.env.EXPECT_BUILD || '1c00c17a';
const LOG = 'qa/2026-10-16_w4b-lh400_ui-driver.log';
const log = (l) => { console.log(l); fs.appendFileSync(LOG, l + '\n'); };
const uuid = () => randomUUID();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await fetch(API + '/health').then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} buildHash=${health?.buildHash} pin=${PIN}`);
if (health?.status !== 'ok' || health?.buildHash !== PIN) { log('ABORT: pin mismatch'); process.exit(2); }

async function login(identifier) {
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  return res.ok ? (await res.json()).token : null;
}
const disp = await login('dungnv');
const admin = await login('admin');
if (!disp || !admin) { log('ABORT: logins'); process.exit(2); }
const H = { 'Content-Type': 'application/json', Authorization: `Bearer ${disp}` };
const today = new Date().toISOString().slice(0, 10);

// A real staging customer for the QA bookings (no master-data fixtures).
const customer = await fetch(API + '/customers?limit=5', { headers: { Authorization: `Bearer ${disp}` } })
  .then((r) => r.json()).then((j) => (j.items || j || []).find((c) => !c.deletedAt))
  .catch(() => null);
if (!customer?.id) { log('ABORT: no customer'); process.exit(3); }
log(`customer=${customer.id} ${JSON.stringify((customer.name || '').slice(0, 40))}`);

// Staging DB read-only helper (psql over ssh, no stdin per the house lesson).
function psql(sql) {
  return execSync(`ssh -o BatchMode=yes root@vantai.tingting.vip "docker exec vantai-postgres-1 psql -U vantai -d vantai -tAc \\"${sql}\\""`, { encoding: 'utf8' }).trim();
}

function detailRows(ref) {
  return fetch(`${API}/shipments/dispatch-detail-plan-rows?q=${encodeURIComponent(ref)}&limit=50`, { headers: { Authorization: `Bearer ${disp}` } })
    .then((r) => r.json()).catch(() => null);
}

// ── LH400-01 — born-ready LCL ───────────────────────────────────────────────
const hex = randomUUID().slice(0, 8);
const ref = `QA-W4B-LCL-${hex}`;
const created = await fetch(API + '/shipments', {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL', expectedDeliveryDate: today }),
});
const ship = await created.json().catch(() => ({}));
log(`LCL create -> ${created.status} id=${ship.id} status=${ship.status} ref=${ref}`);
if (created.status !== 201 || ship.status !== 'READY_FOR_DISPATCH') { log('ABORT: create not born-ready'); process.exit(1); }

// Immediately — detail-plan API (rung 2), DB (rung 2), then UI (rung 3).
const page1 = await detailRows(ref);
const myRows = (page1?.items || []).filter((r) => r.shipmentId === ship.id);
log(`LH400-01 API: rows=${myRows.length} ${JSON.stringify(myRows.map((r) => ({ fulfillmentId: r.fulfillmentId, fulfillmentType: r.fulfillmentType, cargoMode: r.cargoMode, group: r.lcl?.group ?? null })))}`);
const counts = page1?.assignmentStatusCounts;
log(`LH400-01 API: assignment counts ${JSON.stringify(counts)}`);

const dbRows = psql(`SELECT fulfillment_type, shipment_container_id, count(*) FROM shipment_fulfillments WHERE shipment_id=${ship.id} AND canceled_at IS NULL GROUP BY 1,2`);
log(`LH400-01 DB: fulfillment rows -> [${dbRows.replace(/\n/g, '; ')}]`);

const lclApiOk = myRows.length === 1 && myRows[0].fulfillmentType === 'LCL_SHIPMENT' && myRows[0].cargoMode === 'LCL' && myRows[0].fulfillmentId > 0 && myRows[0].lcl?.group == null;
const lclDbOk = /LCL_SHIPMENT\|\|1/.test(dbRows.replace(/ /g, '')) || /LCL_SHIPMENT\|\s*1/.test(dbRows);
log(`LH400-01 api=${lclApiOk} dbOk=${lclDbOk}`);

// UI drive (rung 3) — 1440 then 390.
const errors = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
  await page.setViewport({ width: vp.w, height: vp.h, isMobile: vp.w < 800 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), disp);
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  // Search the booking ref via the filter search box.
  await page.evaluate((r) => {
    const input = [...document.querySelectorAll('input')].find((i) => /tìm|search/i.test(i.placeholder || ''))
      || [...document.querySelectorAll('input[type="text"], input[type="search"]')][0];
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, r);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, ref);
  await page.waitForFunction(
    (r) => (document.body.innerText || '').includes(r),
    { polling: 120, timeout: 30000 },
    ref,
  ).catch(() => log(`WARN: ref not visible in ${vp.w}px grid after 30s`));
  await sleep(1500);
  const ui = await page.evaluate((r) => {
    const body = document.body.innerText || '';
    const rows = [...document.querySelectorAll('tr, [class*="row"]')].filter((el) => (el.innerText || '').includes(r));
    const rowText = rows.map((el) => (el.innerText || '').replace(/\s+/g, ' ').slice(0, 300));
    const chip = body.match(/Chưa gán xe\s*(\d+)/);
    return {
      refVisible: body.includes(r),
      rowMatches: rows.length,
      rowText,
      leLabel: /(^|\s)Lẻ(\s|$|·)/.test(rowText.join(' ')),
      leWithClass: rowText.some((t) => /Lẻ · Xe /.test(t)),
      unassignedChip: chip ? chip[1] : null,
    };
  }, ref);
  log(`LH400-01 UI ${vp.w}px: ${JSON.stringify(ui)}`);
  await page.screenshot({ path: `qa/2026-10-16_w4b-lh400_ui-${vp.w}-lcl-row.png`, fullPage: true });
}
await browser.close();
log(`PAGE-ERRORS ${JSON.stringify(errors)}`);

// ── FCL born-ready regression — create-path decompose stays FCL-excluded ───
const fclRef = `QA-W4B-FCL-${hex}`;
const fcl = await fetch(API + '/shipments', {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ customerId: customer.id, bookingRef: fclRef, tradeDirection: 'EXPORT', cargoMode: 'FCL', expectedDeliveryDate: today }),
});
const fclShip = await fcl.json().catch(() => ({}));
log(`FCL create -> ${fcl.status} id=${fclShip.id} status=${fclShip.status} ref=${fclRef}`);
const fclDb0 = psql(`SELECT count(*) FROM shipment_fulfillments WHERE shipment_id=${fclShip.id} AND canceled_at IS NULL`);
log(`FCL DB right after create: fulfillments=${fclDb0} (expected 0 — create-path decompose is LCL-only)`);

// Container write owns its decomposition → row appears.
const ctypes = await fetch(API + '/container-types', { headers: { Authorization: `Bearer ${disp}` } })
  .then((r) => r.json()).catch(() => null);
const typeId = Array.isArray(ctypes) ? ctypes[0]?.id : (ctypes?.items || [])[0]?.id;
log(`container type: ${JSON.stringify(typeId)}`);
const put = await fetch(`${API}/shipments/${fclShip.id}/containers`, {
  method: 'PUT', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ expectedVersion: fclShip.version, containers: [{ containerTypeId: typeId }] }),
});
log(`FCL containers PUT -> ${put.status} ${JSON.stringify(await put.json().catch(() => ({}))).slice(0, 160)}`);
const fclDb1 = psql(`SELECT count(*) FROM shipment_fulfillments WHERE shipment_id=${fclShip.id} AND canceled_at IS NULL`);
const fclRows = await detailRows(fclRef);
const fclMine = (fclRows?.items || []).filter((r) => r.shipmentId === fclShip.id);
log(`FCL after container write: DB fulfillments=${fclDb1} detailRows=${fclMine.length} (expected >=1 both)`);

// ── LH400-02 control — LCL without dates stays off-board ────────────────────
const ctrlRef = `QA-W4B-LCLCTRL-${hex}`;
const ctrl = await fetch(API + '/shipments', {
  method: 'POST', headers: { ...H, 'Idempotency-Key': uuid() },
  body: JSON.stringify({ customerId: customer.id, bookingRef: ctrlRef, tradeDirection: 'EXPORT', cargoMode: 'LCL' }),
});
const ctrlShip = await ctrl.json().catch(() => ({}));
log(`LCLCTRL create -> ${ctrl.status} id=${ctrlShip.id} status=${ctrlShip.status} ref=${ctrlRef}`);
const ctrlDb = psql(`SELECT count(*) FROM shipment_fulfillments WHERE shipment_id=${ctrlShip.id} AND canceled_at IS NULL`);
const ctrlRows = (await detailRows(ctrlRef))?.items?.filter((r) => r.shipmentId === ctrlShip.id).length ?? -1;
log(`LH400-02 control: DB fulfillments=${ctrlDb} (expected 0) detailRows=${ctrlRows} (expected 0)`);

log(`FIXTURES shipmentIds=${ship.id},${fclShip.id},${ctrlShip.id}`);
log('DONE');
