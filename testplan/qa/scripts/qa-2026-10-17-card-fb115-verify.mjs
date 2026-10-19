// Card 171026122160 (FB-115) — "Gán xe cho nhóm hàng lẻ — không thực hiện
// được" verification driver. VERIFICATION-FIRST: reproduce the flow with the
// CORRECT preconditions from the service guards
// (backend/src/services/lcl-grouping.service.ts assignLclCostGroup) and the
// spec A.3 UI guide, against the LOCAL dev stack (AGENTS.md §2 — local only).
//
// Preconditions seeded/driven here:
//   1. Role Điều vận (dungnv, password Abc123).
//   2. >= 2 LCL lots, all cargoMode='LCL', costGroupId=null, no live trip
//      COMPLETED, no accounting lock (fresh QA fixtures guarantee this).
//   3. Truck-tonnage class (Xe 5 tấn) ⇒ BKS thực must be EXTERNAL (not in the
//      internal `trucks` fleet) + a Nhà xe (EXTERNAL carrier) — the dialog's
//      required field 2 since commit d8585c15 (16/10 late).
//   4. Click order = group order: first clicked row becomes Lô 1 (principal).
//
// Two runs in one dialog session:
//   NEG — the 16/10 guide's 3-field path (loại xe + BKS only, no Nhà xe):
//         expect the submit error naming the missing Nhà xe. This documents
//         the likely reason the 17/10 tester saw "không thực hiện được".
//   POS — correct path incl. Nhà xe: expect success toast, "Ghép (1/2)" tags,
//         API 200 and the DB group rows.
//
// Evidence (AGENTS.md §9 rung 3):
//   qa/2026-10-17_card-fb115_ui-01-selected.png      — 2 lots selected + total bar
//   qa/2026-10-17_card-fb115_ui-02-dialog.png        — dialog field inventory
//   qa/2026-10-17_card-fb115_ui-03-guide-gap-error.png — NEG: submit blocked
//   qa/2026-10-17_card-fb115_ui-04-filled.png        — POS: all fields filled
//   qa/2026-10-17_card-fb115_ui-05-assigned.png      — toast + Ghép tags after click
//   qa/2026-10-17_card-fb115_ui-driver.log           — this run's full log
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const API = 'http://localhost:3002/api';
const BASE = 'http://localhost:7175';
const LOG = 'qa/2026-10-17_card-fb115_ui-driver.log';
const HEX = randomUUID().slice(0, 6);
const REF_A = `QA-FB115-${HEX}-A`;
const REF_B = `QA-FB115-${HEX}-B`;
const PLATE = '99T-99999';
const PASSWORD = 'Abc123';

fs.writeFileSync(LOG, `# FB-115 verify driver — ${new Date().toISOString()} hex=${HEX}\n`);
const step = (name, data) => {
  const line = `${new Date().toISOString()} ${name} ${data === undefined ? '' : JSON.stringify(data)}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
};
const fail = (msg) => { step('FAIL', { msg }); throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function psql(sql) {
  return execSync(
    `docker exec ss-prod-db psql -U postgres -d silversea -tAc ${JSON.stringify(sql)}`,
    { encoding: 'utf8' },
  ).trim();
}

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  return { identifier, status: res.status, token: body.token ?? body.accessToken ?? body?.data?.token ?? null };
}

async function api(token, method, path, body) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Idempotency-Key': randomUUID() };
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}

// ── 0. environment identity ──────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
step('health', health);

// Precondition probes on the DB: the plate must NOT be an internal truck and
// the dialog must have at least one EXTERNAL carrier to pick.
const internalPlateCount = psql(`SELECT count(*) FROM trucks WHERE replace(regexp_replace(upper(license_plate), '[^A-Z0-9]', '', 'g'), ' ', '') = '99T99999' AND deleted_at IS NULL`);
const carrierCount = psql(`SELECT count(*) FROM customers WHERE is_carrier = true AND status = 'ACTIVE' AND deleted_at IS NULL`);
step('db-preconditions', { internalPlateCount, carrierCount });
if (internalPlateCount !== '0') fail(`plate ${PLATE} is an internal truck — pick another external plate`);
if (Number(carrierCount) < 1) fail('no ACTIVE isCarrier customer — dialog would have no Nhà xe option');

// ── 1. seed: 2 LCL lots, same customer, ungrouped, no trips ─────────────────
const disp = await login('dungnv');
const cus = await login('thanhdc');
step('logins', { disp: disp.status, dispToken: !!disp.token, cus: cus.status, cusToken: !!cus.token });
if (!disp.token) fail('dungnv (Điều vận) login failed');
if (!cus.token) fail('thanhdc (CUS) login failed');

const customers = await api(disp.token, 'GET', '/customers?limit=100');
const customer = (customers.json?.items ?? []).find((c) => !c.isCarrier && c.status === 'ACTIVE' && c.name)
  ?? (customers.json?.items ?? [])[0];
const routes = await api(disp.token, 'GET', '/routes?limit=50');
const route = (routes.json?.items ?? []).find((r) => !r.deletedAt) ?? (routes.json?.items ?? [])[0];
let siteId = null;
{
  const sites = await api(disp.token, 'GET', `/operational-sites?customerId=${customer?.id ?? ''}&limit=10`);
  const list = sites.json?.items ?? sites.json ?? [];
  siteId = (Array.isArray(list) ? list.find((t) => !/chưa xác định/i.test(t.name ?? '')) ?? list[0] : null)?.id ?? null;
}
step('seed-catalog', { customer: { id: customer?.id, name: customer?.name }, route: { id: route?.id, name: route?.name }, siteId });

const today = new Date().toISOString().slice(0, 10);
async function createLot(ref) {
  const res = await api(cus.token, 'POST', '/shipments', {
    customerId: customer.id,
    bookingRef: ref,
    tradeDirection: 'EXPORT',
    cargoMode: 'LCL',
    expectedDeliveryDate: today,
    packageType: 'Pallet',
    packageCount: 5,
    cargoWeightKg: 1900,
    cargoVolumeCbm: 4,
    operationalSiteId: siteId,
    routeId: route?.id ?? null,
  });
  step('seed-lot', { ref, status: res.status, id: res.json?.id, err: res.json?.error ?? res.json?.message ?? null });
  return res.json?.id ?? null;
}
const shipmentA = await createLot(REF_A);
const shipmentB = await createLot(REF_B);
if (!shipmentA || !shipmentB) fail('fixture creation failed');

// Housekeeping: soft-delete ungrouped QA-FB115 lots left by earlier aborted
// runs of this driver (best-effort — residue is harmless QA data either way).
{
  const admin = await login('admin');
  const leftovers = psql(`SELECT id FROM shipments WHERE booking_ref LIKE 'QA-FB115-%' AND id NOT IN (${shipmentA},${shipmentB}) AND deleted_at IS NULL AND cost_group_id IS NULL`)
    .split('\n').filter(Boolean);
  for (const id of leftovers) {
    const del = await api(admin.token ?? cus.token, 'DELETE', `/shipments/${id}`);
    step('cleanup-leftover', { id, status: del.status });
  }
}

// ── 2. UI drive (Điều vận, token injected before SPA navigation) ─────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), disp.token);

const assignCall = { request: null, response: null };
page.on('request', (req) => {
  if (req.method() === 'POST' && req.url().endsWith('/api/shipments/lcl/cost-group')) {
    try { assignCall.request = JSON.parse(req.postData()); } catch { assignCall.request = req.postData(); }
  }
});
page.on('response', async (res) => {
  if (res.url().endsWith('/api/shipments/lcl/cost-group')) {
    assignCall.response = { status: res.status(), body: await res.text().catch(() => '') };
  }
});

// Labels render with a required asterisk ("Loại xe tính cước trả ĐV *") —
// normalize it away before comparing, and prefer the dialog scope so page
// chrome with a similar label never wins.
const NORMALIZE = `(l) => (l.textContent || '').replace(/\\s+/g, ' ').trim().replace(/\\s*[*＊]\\s*$/, '')`;

/** Resolve a dialog/page input from its visible label (React Aria label[for]). */
async function focusField(labelText) {
  return page.evaluate((label, normalizeSrc, rootSrc) => {
    const normalize = eval(normalizeSrc);
    const root = eval(rootSrc) ?? document;
    const labels = [...root.querySelectorAll('label')]
      .filter((l) => normalize(l) === label && l.offsetParent !== null);
    const forId = labels[0]?.getAttribute('for');
    const input = (forId ? document.getElementById(forId) : null)
      ?? [...root.querySelectorAll('input')].find((i) => {
        const l = (i.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
        return l.trim().replace(/\s*[*＊]\s*$/, '') === label || (i.getAttribute('aria-label') || '') === label;
      });
    if (!input) return false;
    input.focus();
    return true;
  }, labelText, NORMALIZE, DIALOG_ROOT_SRC);
}

async function typeField(labelText, value) {
  const focused = await focusField(labelText);
  if (!focused) return false;
  await page.keyboard.type(value, { delay: 35 });
  await sleep(500);
  // Tab commits the free-text value (React Aria onCustomValue / onChange) so
  // the auto-copy of "BKS báo khách" and submit() see the typed plate.
  await page.keyboard.press('Tab');
  await sleep(700);
  return true;
}

/** Type a search fragment and pick the option whose text matches exactly
 *  (fallback: endsWith → contains → first), mirroring the A.3 harness. */
async function pickSearchable(labelText, fragment) {
  if (!await focusField(labelText)) return { picked: false, label: null };
  await page.keyboard.type(fragment, { delay: 35 });
  await sleep(1000);
  const picked = await page.evaluate((want) => {
    const options = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent !== null);
    if (!options.length) return null;
    const text = (o) => (o.textContent || '').trim();
    const hit = options.find((o) => text(o) === want)
      ?? options.find((o) => text(o).endsWith(want))
      ?? options.find((o) => text(o).includes(want))
      ?? options[0];
    hit.click();
    return text(hit);
  }, fragment);
  await sleep(800);
  return { picked: !!picked, label: picked };
}

const fieldValue = (labelText) => page.evaluate((label, normalizeSrc, rootSrc) => {
  const normalize = eval(normalizeSrc);
  const root = eval(rootSrc) ?? document;
  const labels = [...root.querySelectorAll('label')]
    .filter((l) => normalize(l) === label && l.offsetParent !== null);
  const forId = labels[0]?.getAttribute('for');
  const input = (forId ? document.getElementById(forId) : null)
    ?? [...root.querySelectorAll('input')].find((i) => {
      const l = (i.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      return l.trim().replace(/\s*[*＊]\s*$/, '') === label;
    });
  return input ? input.value : null;
}, labelText, NORMALIZE, DIALOG_ROOT_SRC);

const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/[ \t]+/g, ' '));

// The house Modal (design-system/Modal) renders [class*="modal"] WITHOUT
// role="dialog" — every dialog-root lookup needs both selectors, largest
// innerText wins so the footer wrapper never steals the scope.
const DIALOG_ROOT_SRC = `(() => {
  const vis = (sel) => [...document.querySelectorAll(sel)].filter((m) => m.offsetParent !== null);
  return vis('[role="dialog"]').pop()
    ?? vis('[class*="modal"]').sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0]
    ?? null;
})()`;

/** Click the dialog footer button whose text matches, optional reverse scan. */
function clickDialogButton(matchRe, { reverse = false } = {}) {
  return page.evaluate((rootSrc, pattern, rev) => {
    const dlg = eval(rootSrc);
    if (!dlg) return 'no-dialog-root';
    const buttons = [...dlg.querySelectorAll('button')];
    const list = rev ? buttons.reverse() : buttons;
    const btn = list.find((b) => new RegExp(pattern, 'i').test(b.textContent.trim()) && !b.disabled);
    if (!btn) return `no-button(${pattern})`;
    btn.click();
    return 'clicked';
  }, DIALOG_ROOT_SRC, matchRe.source, reverse);
}

const results = {};
try {
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // Cold dev-server chunk compiles can leave the SPA on its global
  // "Đang tải…" splash well past a fixed sleep — wait for the filter bar,
  // reload once, then fail loudly.
  const SEARCH_READY = () => [...document.querySelectorAll('input')].some((i) => /bill, cont, tờ khai/i.test(i.placeholder || ''));
  let searchReady = true;
  try {
    await page.waitForFunction(SEARCH_READY, { polling: 300, timeout: 90000 });
  } catch {
    step('search-not-ready-reload', {});
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(SEARCH_READY, { polling: 300, timeout: 90000 });
    } catch { searchReady = false; }
  }
  await sleep(1500);
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-00-route.png', fullPage: true });
  if (!searchReady) fail('search input "Bill, Cont, Tờ khai..." not found on /dispatch-detail (page stuck loading)');

  // Search box: DetailedPlanFilters' "Bill, Cont, Tờ khai..." quick filter.
  await page.evaluate(() => {
    const input = [...document.querySelectorAll('input')].find((i) => /bill, cont, tờ khai/i.test(i.placeholder || ''));
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  const searchSet = await page.evaluate((prefix) => {
    const input = [...document.querySelectorAll('input')].find((i) => /bill, cont, tờ khai/i.test(i.placeholder || ''));
    if (!input) return false;
    input.focus();
    return true;
  }, `QA-FB115-${HEX}`);
  if (!searchSet) fail('search input "Bill, Cont, Tờ khai..." not found on /dispatch-detail');
  await page.keyboard.type(`QA-FB115-${HEX}`, { delay: 35 });
  await page.waitForFunction((ref) => (document.body.innerText || '').includes(ref), { polling: 300, timeout: 60000 }, REF_A).catch(() => {});
  await sleep(1500);

  // Select the two lots in click order A → B (A becomes Lô 1).
  const checked = await page.evaluate((refs) => {
    const rows = [...document.querySelectorAll('tr, [class*="row"]')];
    const picked = [];
    for (const ref of refs) {
      const row = rows.find((r) => (r.innerText || '').includes(ref));
      const box = row?.querySelector('input[type="checkbox"]');
      if (box) { box.click(); picked.push(ref); }
    }
    return picked;
  }, [REF_A, REF_B]);
  await sleep(1200);
  const barText = await page.evaluate(() => (document.querySelector('.lcl-selection-bar')?.innerText || '').replace(/\s+/g, ' '));
  step('selection', { checked, barText });
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-01-selected.png', fullPage: true });
  results.selectionBar = /Đang chọn 2 lô/.test(barText) && new RegExp(`Lô 1:.*${REF_A}`).test(barText);
  if (checked.length !== 2) fail(`expected 2 checkboxes clicked in order [${REF_A}, ${REF_B}], got ${JSON.stringify(checked)}`);
  if (!/Đang chọn 2 lô/.test(barText)) fail(`selection bar missing "Đang chọn 2 lô": ${barText}`);

  // Open the dialog.
  const opened = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /gán xe nhóm/i.test(b.textContent.trim()) && !b.disabled);
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(800);
  await page.waitForFunction(() => /Loại xe tính cước trả ĐV/.test(document.body.innerText || ''), { polling: 300, timeout: 30000 }).catch(() => {});
  const dialogText = await page.evaluate((rootSrc) => {
    const dlg = eval(rootSrc);
    return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 800) : null;
  }, DIALOG_ROOT_SRC);
  step('dialog-open', { opened, dialogText });
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-02-dialog.png', fullPage: true });
  if (!opened || !dialogText) fail('Gán xe nhóm dialog did not open with 2 lots selected');
  results.dialogLabels = {
    loaiXe: /Loại xe tính cước trả ĐV/.test(dialogText),
    nhaXe: /Nhà xe/.test(dialogText),
    bksThuc: /BKS thực/.test(dialogText),
    bksBaoKhach: /BKS báo khách/.test(dialogText),
    lclOrder: new RegExp(`Lô 1 · .*${REF_A}`).test(dialogText),
  };
  if (!Object.values(results.dialogLabels).every(Boolean)) fail(`dialog field inventory incomplete: ${JSON.stringify(results.dialogLabels)}`);

  // ── NEG: the 16/10 guide's 3-field path (no Nhà xe) ───────────────────────
  const clsPicked = await pickSearchable('Loại xe tính cước trả ĐV', 'Xe 5 tấn');
  await typeField('BKS thực (xe chạy chuyến)', PLATE);
  const negClick = await clickDialogButton(/gán nhóm xe/);
  await sleep(1200);
  const negError = await page.evaluate(() => (document.querySelector('.assign-truck-group__error')?.textContent || '').trim());
  step('neg-guide-gap', { clsPicked, negClick, negError });
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-03-guide-gap-error.png', fullPage: true });
  results.negError = negError;

  // ── POS: correct preconditions (Nhà xe picked, external plate) ────────────
  const carrierPicked = await pickSearchable('Nhà xe', 'Nhà xe');
  // Carrier change clears the plate by design — retype it, then the billing
  // plate must auto-copy the actual one.
  await typeField('BKS thực (xe chạy chuyến)', PLATE);
  await sleep(700);
  const billingAuto = await fieldValue('BKS báo khách (ảo)');
  step('pos-filled', { carrierPicked, billingAuto });
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-04-filled.png', fullPage: true });
  results.carrierLabel = carrierPicked.label;
  results.billingAuto = billingAuto;

  const confirmed = await clickDialogButton(/gán nhóm xe/, { reverse: true });
  await page.waitForFunction(() => /Đã gán nhóm xe|Hàng lẻ xe tải|Nhập BKS|Chọn nguồn xe/.test(document.body.innerText || ''), { polling: 300, timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const afterText = await bodyText();
  const toast = (afterText.match(/Đã gán nhóm xe[^\n]*/) ?? [])[0] ?? null;
  const ghepTags = (afterText.match(/Ghép \(\d\/\d\)/g) ?? []);
  step('pos-after', { confirmed, toast, ghepTags });
  step('api-assign', assignCall);
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-05-assigned.png', fullPage: true });

  // Post-click DOM assertion: success text + both group tags on the grid.
  let tagsShown = false;
  try {
    await page.waitForFunction(() => /Ghép \(1\/2\)/.test(document.body.innerText) && /Ghép \(2\/2\)/.test(document.body.innerText), { polling: 200, timeout: 15000 });
    tagsShown = true;
  } catch { /* recorded below */ }
  const finalText = await bodyText();
  fs.appendFileSync(LOG, `DOM-after: ${finalText.slice(0, 1500)}\n`);
  results.toast = toast;
  results.tagsShown = tagsShown || (/Ghép \(1\/2\)/.test(finalText) && /Ghép \(2\/2\)/.test(finalText));
  results.assignApi = assignCall.response;
  await page.screenshot({ path: 'qa/2026-10-17_card-fb115_ui-06-final.png', fullPage: true });
} finally {
  await browser.close().catch(() => {});
}

// ── 3. DB side-effect proof ──────────────────────────────────────────────────
const dbGroup = psql(`SELECT id, booking_ref, cargo_mode, cost_group_id, cost_group_order, actual_truck_no, billing_truck_no, cost_vehicle_class_id FROM shipments WHERE booking_ref IN ('${REF_A}','${REF_B}') ORDER BY cost_group_order`);
const dbFulfill = psql(`SELECT f.shipment_id, f.planned_carrier_type, f.planned_external_carrier_id, f.planned_vehicle_plate_number FROM shipment_fulfillments f JOIN shipments s ON s.id = f.shipment_id WHERE s.booking_ref IN ('${REF_A}','${REF_B}') AND f.canceled_at IS NULL ORDER BY f.shipment_id`);
const dbAudit = psql(`SELECT id, message, actor_name, left(payload::text, 300) FROM audit_logs WHERE message ILIKE '%COST_GROUP%' OR payload::text ILIKE '%LCL_COST_GROUP%' ORDER BY id DESC LIMIT 1`);
step('db-group', { rows: dbGroup });
step('db-fulfillment', { rows: dbFulfill });
step('db-audit', { row: dbAudit.slice(0, 400) });

const groupLines = dbGroup.split('\n').filter(Boolean);
const grouped = groupLines.length === 2
  && groupLines.every((l) => l.includes(`|${PLATE}|`))
  && dbGroup.includes('|1|') && dbGroup.includes('|2|')
  && new Set(groupLines.map((l) => l.split('|')[3])).size === 1
  && !groupLines.some((l) => l.split('|')[3] === '');
results.dbGrouped = grouped;
// The 16/10 guide's 3-field path is blocked by a REQUIRED "Nhà xe" field —
// the guide gap the 17/10 tester most likely hit.
results.negGuideGap = /Nhà xe/.test(results.negError ?? '');

results.verdict = !!(results.selectionBar !== false && results.tagsShown && results.toast && results.dbGrouped
  && results.assignApi?.status === 200);
step('VERDICT', {
  verdict: results.verdict ? 'PASS — flow works with correct preconditions' : 'FAIL',
  negError: results.negError,
  toast: results.toast,
  tagsShown: results.tagsShown,
  dbGrouped: results.dbGrouped,
  apiStatus: results.assignApi?.status,
  carrierLabel: results.carrierLabel,
});
console.log('\n=== RESULT SUMMARY ===');
console.log(JSON.stringify(results, null, 2));
process.exit(results.verdict ? 0 : 1);
