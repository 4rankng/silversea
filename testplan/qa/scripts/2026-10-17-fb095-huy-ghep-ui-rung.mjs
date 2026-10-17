// FB-095 UI rung — nút "Hủy ghép" trên Chi phí - Quyết toán (kanban card
// 171026105447-lcl-nut-huy-ghep-tach-nhom).
//
// LOCAL ONLY: vite 7175 → api 3002 → pg 5441. Never staging, never prod.
//
// The run builds its OWN fixtures (one throwaway customer + two LCL lots under
// it, all tagged with the run hex) so no shared fixture another lane is using
// is ever mutated. Screenshots land in $SHOTS and are embedded in the card.
//
//   node testplan/qa/scripts/2026-10-17-fb095-huy-ghep-ui-rung.mjs
//
// Exit code 0 = every rung asserted PASS.

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb095';
fs.mkdirSync(SHOTS, { recursive: true });

const hex = Date.now().toString(16).slice(-8).toUpperCase();
const TAG = `FB095UI-${hex}`;
const REFA = `${TAG}-A`;
const REFB = `${TAG}-B`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function call(method, path, body, token) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (method !== 'GET') headers['Idempotency-Key'] = randomUUID();
  const res = await fetch(`${API}${path}`, {
    method, headers, body: body == null ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}

async function login(identifier, password = 'Abc123') {
  const r = await call('POST', '/auth/login', { identifier, password });
  if (!r.ok) throw new Error(`login ${identifier} → ${r.status} ${r.text.slice(0, 200)}`);
  return r.json.token ?? r.json.accessToken ?? r.json?.data?.token;
}

/** Read-only DB proof. No double quotes inside the SQL so the shell stays put. */
function psql(sql) {
  return execSync(
    `docker exec ss-prod-db psql -U postgres -d silversea -tAc "${sql}"`,
    { encoding: 'utf8' },
  ).trim();
}

const token = await login('admin');
console.log(`admin token ok · run tag ${TAG}`);

// ── Own fixture: customer + two LCL lots ───────────────────────────────────
const cust = await call('POST', '/customers', { code: `FB095KH-${hex}`, name: `FB095 UI KH ${hex}` }, token);
if (!cust.ok) throw new Error(`create customer → ${cust.status} ${cust.text.slice(0, 300)}`);
const customerId = cust.json.id;

const today = new Date().toISOString().slice(0, 10);
const lotPayload = {
  customerId, tradeDirection: 'EXPORT', cargoMode: 'LCL',
  expectedDeliveryDate: today, packageType: 'Pallet',
  quantity: '2', weightKg: '800', volumeCbm: '3',
  operationalSiteId: null, routeId: null,
};
const lotA = await call('POST', '/shipments', { ...lotPayload, bookingRef: REFA }, token);
const lotB = await call('POST', '/shipments', { ...lotPayload, bookingRef: REFB }, token);
if (!lotA.ok || !lotB.ok) throw new Error(`create lots → A:${lotA.status} B:${lotB.status} ${lotA.text.slice(0, 200)}`);
const idA = lotA.json.id;
const idB = lotB.json.id;
// Lot C is NEVER merged — it is AC4's "lô không thuộc nhóm nào" subject.
const REFC = `${TAG}-C`;
const lotC = await call('POST', '/shipments', { ...lotPayload, bookingRef: REFC }, token);
if (!lotC.ok) throw new Error(`create lot C → ${lotC.status} ${lotC.text.slice(0, 200)}`);
const idC = lotC.json.id;

// Paginated at 50/page — the seeded 3.5T sits past the first page.
const classes = await call('GET', '/vehicle-size-classes?limit=200', null, token);
const cls35 = (Array.isArray(classes.json) ? classes.json : classes.json?.items ?? [])
  .find((c) => c.code === '3.5T');
if (!cls35) throw new Error('vehicle class 3.5T missing from catalog');

// Rev dimension (thu khách) is the CUS half of the settlement screen.
const merged = await call('POST', '/shipments/lcl/rev-group', { shipmentIds: [idA, idB], vehicleSizeClassId: cls35.id }, token);
if (!merged.ok) throw new Error(`rev-group merge → ${merged.status} ${merged.text.slice(0, 300)}`);
// Cost dimension (trả ĐV) so the strip carries BOTH dimensions, as lot 104250 does.
const costMerged = await call('POST', '/shipments/lcl/cost-group', {
  shipmentIds: [idA, idB], vehicleSizeClassId: cls35.id,
  actualTruckNo: `29X-QA${hex.slice(0, 4)}`, freightCost: 500000,
}, token);

console.log(`fixture: customer=${customerId} lotA=${idA}(${REFA}) lotB=${idB}(${REFB}) lotC=${idC}(${REFC}, never merged) rev-merge=${merged.status} cost-merge=${costMerged.status}${costMerged.ok ? '' : ' — ' + costMerged.text.slice(0, 200)}`);
record('fixture', 'INFO', `customer=${customerId} lots=${idA},${idB},${idC} revGroup=${merged.json?.groupId ?? '?'} costGroup=${costMerged.ok ? costMerged.json?.groupId : 'n/a'}`);

// ── Browser ────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

/** Every /api/shipments/lcl/unmerge* call the strip makes, with its body. */
const unmergeCalls = [];
page.on('response', async (res) => {
  const url = res.url();
  if (!url.includes('/api/shipments/lcl/unmerge')) return;
  let body = null;
  try { body = await res.json(); } catch { /* empty */ }
  unmergeCalls.push({ url: url.replace(BASE, ''), status: res.status(), body });
});

/** Open one lot's L2 detail. Expansion is the row's `+` button — a row click
 *  only SELECTS the lot (merge checkbox), so clicking the row never expands. */
async function openLot(ref) {
  await page.goto(`${BASE}/shipments-debit?customer=${customerId}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction((f) => (document.body.innerText || '').includes(f), { timeout: 40000 }, ref);
  await sleep(2000);
  const armed = await page.evaluate((r) => {
    const row = [...document.querySelectorAll('tr.shipment-debit-row')].find((el) => (el.innerText || '').includes(r));
    if (!row) return false;
    row.scrollIntoView({ block: 'center' });
    const btn = row.querySelector('button.shipment-debit-row__expand-button');
    if (!btn) return false;
    // ShipmentDebitPage restores the open lot from sessionStorage on mount, so
    // a second visit is already expanded — clicking `+` again would COLLAPSE it.
    if (btn.getAttribute('aria-expanded') === 'true') return 'already';
    btn.scrollIntoView({ block: 'nearest' });
    btn.click();
    return true;
  }, ref);
  await sleep(1500);
  return armed;
}

async function openStrip(ref) {
  const armed = await openLot(ref);
  await page.waitForFunction(() => (document.body.innerText || '').includes('NHÓM GHÉP'), { timeout: 25000 });
  await sleep(900);
  return armed;
}

async function shotStrip(name) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('.debit-lot-lcl-facts');
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10),
      width: Math.min(r.width + 20, 1440), height: Math.min(r.height + 20, 1000),
    };
  });
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  if (box) await page.screenshot({ path, clip: box });
  else await page.screenshot({ path });
  return path;
}

/** Clip to the whole expanded lot (strip + fee workspace), not just the strip —
 *  an ungrouped lot's strip is short and a tight clip cannot PROVE the
 *  NHÓM GHÉP block is absent. */
async function shotExpand(name) {
  const box = await page.evaluate(() => {
    const el = document.querySelector('tr.shipment-debit-expand');
    if (!el) return null;
    el.scrollIntoView({ block: 'start' });
    const r = el.getBoundingClientRect();
    return {
      x: Math.max(0, r.x - 6), y: Math.max(0, r.y - 6),
      width: Math.min(r.width + 12, 1440), height: Math.min(r.height + 12, 1400),
    };
  });
  await sleep(700);
  const path = `${SHOTS}/${name}.png`;
  if (box) await page.screenshot({ path, clip: box });
  else await page.screenshot({ path });
  return path;
}

/** Toasts render as a page-level overlay ABOVE the strip, so a strip clip
 *  would cut them out — the toast rungs need the whole viewport. */
async function shotViewport(name) {
  const path = `${SHOTS}/${name}.png`;
  await page.screenshot({ path });
  return path;
}

/** Click the "Hủy ghép" button of one dimension inside NHÓM GHÉP. */
async function tapUnmerge(dimension) {
  return page.evaluate((dim) => {
    const groups = [...document.querySelectorAll('.debit-lot-lcl-facts__group')];
    const wanted = dim === 'REV' ? 'Thu khách' : 'Trả ĐV';
    const target = groups.find((g) => (g.innerText || '').includes(wanted));
    if (!target) return false;
    const btn = [...target.querySelectorAll('button')].find((b) => (b.innerText || '').trim().startsWith('Hủy ghép'));
    if (!btn) return false;
    btn.scrollIntoView({ block: 'nearest' });
    btn.click();
    return true;
  }, dimension);
}

async function confirmDialog() {
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  await sleep(600);
  return page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const btn = [...d.querySelectorAll('button')].find((b) => (b.innerText || '').trim() === 'Hủy ghép');
    if (!btn) return false;
    btn.click();
    return true;
  });
}

let stripShot;
try {
  // ── AC1 — grouped lot shows "Hủy ghép" per present dimension ────────────
  const opened = await openStrip(REFA);
  stripShot = await shotStrip('01-ac1-nhom-ghep-huy-ghep');
  const ac1 = await page.evaluate(() => {
    const block = [...document.querySelectorAll('.debit-lot-lcl-facts__block')]
      .find((b) => (b.innerText || '').includes('NHÓM GHÉP'));
    if (!block) return { block: false };
    const groups = [...block.querySelectorAll('.debit-lot-lcl-facts__group')].map((g) => ({
      label: (g.innerText || '').replace(/\s+/g, ' ').trim(),
      hasButton: [...g.querySelectorAll('button')].some((b) => (b.innerText || '').trim().startsWith('Hủy ghép')),
    }));
    return { block: true, groups };
  });
  const dims = ac1.groups.filter((g) => g.hasButton).length;
  record('AC1', opened && ac1.block && dims >= 1 && dims === ac1.groups.length ? 'PASS' : 'FAIL',
    `NHÓM GHÉP block=${ac1.block}, dimensions=${JSON.stringify(ac1.groups)} · ${stripShot}`);

  // ── AC2 — confirm → POST /lcl/unmerge → success toast → grid reloads ────
  const armed = await tapUnmerge('REV');
  await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const confirmShot = await shotStrip('02-ac2-confirm-dialog');
  const confirmText = await page.evaluate(() => (document.querySelector('[role="dialog"]')?.innerText || '').replace(/\s+/g, ' ').trim());
  const confirmed = await confirmDialog();
  let toastText = null;
  try {
    await page.waitForFunction(() => /Đã hủy ghép/.test(document.body.innerText || ''), { timeout: 25000 });
    await sleep(400);
  } catch { /* captured below */ }
  toastText = await page.evaluate(() => (document.body.innerText || '').match(/Đã hủy ghép[^\n]*/)?.[0] ?? null);
  const toastShot = await shotViewport('03-ac2-success-toast');
  const call2 = unmergeCalls.find((c) => c.url.includes('/lcl/unmerge') && !c.url.includes('unmerge-group'));
  record('AC2', armed && confirmed && call2?.status === 200 && toastText ? 'PASS' : 'FAIL',
    `armed=${armed} confirmed=${confirmed} dialog=${JSON.stringify(confirmText)} POST=${JSON.stringify(call2)} toast=${JSON.stringify(toastText)} · ${confirmShot} · ${toastShot}`);

  // The grid must have reloaded: lot A keeps its COST group but its REV group
  // is gone from the strip (the row data was refetched, not patched in place).
  await sleep(2000);
  const afterReload = await page.evaluate(() => {
    const groups = [...document.querySelectorAll('.debit-lot-lcl-facts__group')]
      .map((g) => (g.innerText || '').replace(/\s+/g, ' ').trim());
    return { groups, text: document.body.innerText || '' };
  });
  const revGone = !afterReload.groups.some((g) => g.includes('Thu khách'));
  const costStays = afterReload.groups.some((g) => g.includes('Trả ĐV'));
  record('AC2-reload', revGone && costStays ? 'PASS' : 'FAIL',
    `NHÓM GHÉP rows after success = ${JSON.stringify(afterReload.groups)} (rev gone=${revGone}, cost stays=${costStays})`);

  // ── AC4 — a lot in NO group shows the facts strip with no NHÓM GHÉP ─────
  await openLot(REFC);
  const ac4 = await page.evaluate(() => ({
    facts: !!document.querySelector('.debit-lot-lcl-facts'),
    nhomGhep: (document.body.innerText || '').includes('NHÓM GHÉP'),
    huyGhepButtons: [...document.querySelectorAll('button')].filter((b) => (b.innerText || '').trim().startsWith('Hủy ghép')).length,
  }));
  const ungroupedShot = await shotExpand('04-ac4-ungrouped-no-group-block');
  record('AC4', ac4.facts && !ac4.nhomGhep && ac4.huyGhepButtons === 0 ? 'PASS' : 'FAIL',
    `lot ${REFC} (never merged): facts strip present=${ac4.facts}, NHÓM GHÉP=${ac4.nhomGhep}, Hủy ghép buttons=${ac4.huyGhepButtons} · ${ungroupedShot}`);

  // ── AC3 — server error surfaces verbatim, never swallowed ───────────────
  // Re-merge, open the strip, dissolve the group OUT OF BAND, then press the
  // now-stale button: the server answers "không thuộc nhóm ghép nào".
  const remerge = await call('POST', '/shipments/lcl/rev-group', { shipmentIds: [idA, idB], vehicleSizeClassId: cls35.id }, token);
  await openStrip(REFA);
  const dissolved = await call('POST', '/shipments/lcl/unmerge', { shipmentId: idA, dimension: 'REV' }, token);
  await sleep(300);
  const staleArmed = await tapUnmerge('REV');
  const staleConfirmed = staleArmed ? await confirmDialog() : false;
  let errToast = null;
  try {
    await page.waitForFunction(
      () => /không thuộc nhóm ghép nào|Không thể tách nhóm|Lỗi/.test(document.body.innerText || ''),
      { timeout: 20000 },
    );
    await sleep(400);
  } catch { /* captured below */ }
  errToast = await page.evaluate(
    () => (document.body.innerText || '').match(/Lô [^\n]*không thuộc nhóm ghép[^\n]*/)?.[0]
       ?? (document.body.innerText || '').match(/không thuộc nhóm ghép[^\n]*/)?.[0]
       ?? (document.body.innerText || '').match(/[^\n]*Lỗi[^\n]*/)?.[0] ?? null,
  );
  const errShot = await shotViewport('05-ac3-server-error-toast');
  const errCall = [...unmergeCalls].reverse().find((c) => c.status >= 400);
  record('AC3', remerge.ok && dissolved.ok && staleConfirmed && errToast && errCall?.status >= 400 ? 'PASS' : 'FAIL',
    `remerge=${remerge.status} outOfBandUnmerge=${dissolved.status} staleArmed=${staleArmed} confirmed=${staleConfirmed} POST=${JSON.stringify(errCall)} toast=${JSON.stringify(errToast)} · ${errShot}`);
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

// ── Final DB proof + fixture teardown note ────────────────────────────────
const dbState = psql(
  `SELECT id, shipment_code, booking_ref, cost_group_order, rev_group_order FROM shipments WHERE id IN (${idA},${idB},${idC}) ORDER BY id`,
);
console.log('\n--- DB state of the run fixture (left in place, tagged ' + TAG + ') ---');
console.log(dbState || '(none)');

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
