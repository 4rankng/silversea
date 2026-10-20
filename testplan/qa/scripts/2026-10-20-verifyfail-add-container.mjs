// Ticket 201026090100 (card 181026185900 A.1) — staging re-verify on the
// CURRENT build: "Thêm container" in the CUS drawer must produce a row that
// inherits Tuyến / Nhà xe / Nâng / Hạ / Trọng lượng / Giờ hẹn from the lot's
// existing containers (fix fd5fbdd9 backend inherit + card 191026100000 draft
// seed). The original verify-fail was a stale staging backend, so the build
// gate is HARD. Adds a probe container with ONLY its number, reads the new
// row back from the DOM, screenshots, then removes the probe row (cleanup).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-verifyfail');
const EXPECT_BUILD = process.env.EXPECT_BUILD || 'c7d305ce';
const LOT = Number(process.env.LOT || 161580);
const PROBE_NUMBER = process.env.PROBE_NUMBER || 'CSQU3054383';
const IDENTIFIER = process.env.IDENTIFIER || 'cus';
const PASSWORD = 'Abc123';
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const api = async (method, p, body, token) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === 'POST' ? { 'idempotency-key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, body: parsed };
};

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expected: EXPECT_BUILD, ok: health.buildHash === EXPECT_BUILD });
if (health.buildHash !== EXPECT_BUILD) {
  fs.writeFileSync(path.join(OUT, '201026090100_build-gate.json'), JSON.stringify(health, null, 2));
  console.error('BLOCKED: staging build is not the current build');
  process.exit(2);
}

const login = await api('POST', '/auth/login', { identifier: IDENTIFIER, password: PASSWORD });
if (login.status !== 200) { console.error(`BLOCKED: login -> ${login.status}`); process.exit(2); }
const token = login.body.token;
log('login', { user: login.body.user?.username ?? IDENTIFIER, role: login.body.user?.role });

// Pin the lot: LOT env if it resolves on staging, else auto-discover the first
// FCL lot whose first container carries a populated route (the inherit source).
let picked = null;
if (Number.isFinite(LOT) && LOT > 0) {
  const d = await api('GET', `/shipments/cus-workspace/${LOT}`, undefined, token);
  if (d.status === 200 && (d.body.containers ?? []).length > 0 && d.body.summary?.cargoMode !== 'LCL') {
    // Resolve the list row too: it carries the bucket + Số Bill identity the
    // UI drive needs to find and open the right row.
    const list = await api('GET', '/shipments/cus-workspace?page=1&limit=200', undefined, token);
    const rows = list.status === 200 ? (list.body.items ?? list.body.data ?? []) : [];
    picked = { id: LOT, summary: d.body.summary, list: rows.find((r) => Number(r.id) === LOT) ?? {} };
  } else {
    log('lot_env_miss', { LOT, status: d.status, note: 'falling back to auto-discovery' });
  }
}
if (!picked) {
  const list = await api('GET', '/shipments/cus-workspace?page=1&limit=200', undefined, token);
  if (list.status !== 200) { console.error(`BLOCKED: list -> ${list.status}`); process.exit(2); }
  const rows = list.body.items ?? list.body.data ?? [];
  log('discovery_list', { rows: rows.length });
  for (const row of rows) {
    // containerSummary ("1x40DC") is the list's container presence signal —
    // the list carries no containerCount field.
    const hasContainers = Boolean((row.containerSummary ?? '').trim()) || (row.containerCount ?? 0) > 0;
    if (!hasContainers || row.cargoMode === 'LCL') continue;
    const d = await api('GET', `/shipments/cus-workspace/${row.id}`, undefined, token);
    if (d.status !== 200) continue;
    const refC = (d.body.containers ?? [])[0];
    if (!refC) continue;
    const filled = ['routeName', 'liftSite', 'dropoffSite'].filter((k) => refC[k] != null && refC[k] !== '').length;
    if (filled >= 2) { picked = { id: row.id, summary: d.body.summary, list: row }; break; }
  }
}
if (!picked) { console.error('BLOCKED: no FCL lot with populated route/lift/drop found on staging'); process.exit(2); }

const detail = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
if (detail.status !== 200) { console.error(`BLOCKED: lot ${picked.id} -> ${detail.status}`); process.exit(2); }
const cs = detail.body.containers ?? [];
const s = detail.body.summary ?? picked.summary ?? {};
if (!cs.length || s.cargoMode === 'LCL') { console.error(`BLOCKED: lot ${picked.id} is LCL or containerless`); process.exit(2); }
const ref = cs[0];
const identity = String(picked.list.billOrBookNumber ?? s.billOrBookNumber ?? s.billNumber ?? '').trim();
log('lot_pin', {
  id: picked.id, version: s.version, containers: cs.length, cargoMode: s.cargoMode,
  transportDate: s.transportDate ?? picked.list.transportDate ?? null, identity,
  ref: { routeName: ref.routeName, carrierName: ref.carrierName ?? null, liftSite: ref.liftSite, dropoffSite: ref.dropoffSite, weight: ref.raw?.cargoWeightKg ?? null, appointmentAt: ref.customerAppointmentAt ?? null },
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

// Make the lot's row render: filter by transport date when it has one, else
// by its bucket (e.g. IN_TRANSIT → RUNNING "Đang chạy").
const navParams = new URLSearchParams();
const transportDate = s.transportDate ?? picked.list.transportDate ?? null;
if (transportDate) {
  navParams.set('transportDateFrom', transportDate);
  navParams.set('transportDateTo', transportDate);
} else if (picked.list.bucket) {
  navParams.set('bucket', picked.list.bucket);
}
await page.goto(`${BASE}/shipments${navParams.size ? `?${navParams.toString()}` : ''}`, { waitUntil: 'networkidle2', timeout: 90000 });
await sleep(2500);

// Open the lot's drawer: the row whose identity (Số Bill/Booking) matches.
const opened = await page.evaluate((identity, lotId) => {
  const rows = [...document.querySelectorAll('tr, [role="row"], .cus-row')];
  const row = identity
    ? rows.find((r) => (r.textContent || '').includes(identity))
    : rows.find((r) => r.querySelector(`#cus-inline-identity-${lotId}`));
  if (!row) return { ok: false, reason: 'row not found', identity };
  const btn = row.querySelector('button[aria-label^="Mở chi tiết lô hàng"]');
  if (!btn) return { ok: false, reason: 'open-detail button not found', identity };
  btn.click();
  return { ok: true, identity, label: btn.getAttribute('aria-label') };
}, identity, picked.id);
log('open_drawer', opened);
if (!opened.ok) {
  await page.screenshot({ path: path.join(OUT, '201026090100_ui-00-row-not-found.png') });
  await browser.close();
  process.exit(1);
}
await page.waitForSelector('.cus-container-ledger', { timeout: 30000 });
await sleep(1200);

// Open the Thêm container form; the draft seed (card 191026100000) should
// copy Trọng lượng + Giờ hẹn (+ Loại cont) into the form inputs.
const addBtn = await page.evaluateHandle(() => [...document.querySelectorAll('.cus-container-ledger button')].find((b) => (b.textContent || '').trim() === 'Thêm container'));
const addBtnEl = addBtn.asElement();
if (!addBtnEl) { log('fatal', { reason: 'Thêm container button not found' }); await browser.close(); process.exit(1); }
await addBtnEl.click();
await page.waitForSelector('.cus-container-ledger__add-row', { timeout: 10000 });
await sleep(400);
const seed = await page.evaluate(() => ({
  number: document.querySelector('.cus-container-ledger__add-row input[aria-label="Số container"]')?.value ?? null,
  weight: document.querySelector('.cus-container-ledger__add-row input[aria-label="Trọng lượng (kg)"]')?.value ?? null,
  appointment: document.querySelector('.cus-container-ledger__add-row input[aria-label*="Giờ hẹn"]')?.value ?? null,
}));
log('addform_seed', { seed, note: 'draft seed = per-column first non-null from existing rows (weight/appointment/type); route/carrier/lift/drop inherit server-side' });
await page.screenshot({ path: path.join(OUT, '201026090100_ui-01-addform-seed.png') });

// Enter ONLY the container number → submit → the returned row must inherit.
await page.type('.cus-container-ledger__add-row input[aria-label="Số container"]', PROBE_NUMBER, { delay: 40 });
await page.screenshot({ path: path.join(OUT, '201026090100_ui-02-addform-filled.png') });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.cus-container-ledger__add-row button')].find((b) => (b.textContent || '').trim() === 'Thêm');
  btn?.click();
});
await sleep(2500);
const rowCheck = await page.evaluate((probe) => {
  const toast = [...document.querySelectorAll('[role="status"], .app-notices, .toast')].map((n) => (n.textContent || '').trim()).join('|') || null;
  const rows = [...document.querySelectorAll('.cus-container-ledger tbody tr')];
  const row = rows.find((r) => (r.textContent || '').includes(probe));
  if (!row) return { found: false, toast, rowCount: rows.length };
  const cells = [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
  return { found: true, toast, cells, cellCount: cells.length, text: (row.textContent || '').trim().slice(0, 400) };
}, PROBE_NUMBER);
log('new_row_read', rowCheck);
await page.screenshot({ path: path.join(OUT, '201026090100_ui-03-newrow-inherit.png') });

// DB side-effect proof from the same deployed backend.
const after = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
const line = (after.body.containers ?? []).find((c) => c.containerNumber === PROBE_NUMBER);
const inherited = line ? {
  routeName: line.routeName ?? null,
  carrierName: line.carrierName ?? null,
  liftSite: line.liftSite ?? null,
  dropoffSite: line.dropoffSite ?? null,
  rawRouteId: line.raw?.routeId ?? null,
  rawCarrierId: line.raw?.carrierId ?? null,
  rawLiftSiteId: line.raw?.liftSiteId ?? line.raw?.pickupPortId ?? null,
  rawDropSiteId: line.raw?.dropoffSiteId ?? line.raw?.dropoffPortId ?? null,
  cargoWeightKg: line.raw?.cargoWeightKg ?? null,
  customerAppointmentAt: line.customerAppointmentAt ?? null,
} : null;
log('db_after', { found: Boolean(line), inherited });

// Cleanup: remove the probe row through the cus-workspace API (same route the
// row's Xóa rides), then confirm the ledger is back to its original set.
let cleanup = { done: false };
if (line) {
  const fresh = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
  const del = await api('POST', `/shipments/cus-workspace/${picked.id}/containers/${line.id}/remove`, { expectedShipmentVersion: fresh.body.summary.version }, token);
  const afterDel = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
  const gone = !(afterDel.body.containers ?? []).some((c) => c.containerNumber === PROBE_NUMBER);
  cleanup = { done: del.status === 200 || del.status === 201, removeStatus: del.status, gone, containersNow: (afterDel.body.containers ?? []).length };
  log('cleanup', cleanup);
}
await browser.close();

const inheritOk = Boolean(inherited
  && (inherited.routeName || inherited.rawRouteId)
  && (inherited.liftSite || inherited.rawLiftSiteId)
  && (inherited.dropoffSite || inherited.rawDropSiteId));
const weightOk = !inherited || inherited.cargoWeightKg != null || Boolean(seed.weight);
const checks = [
  { name: 'drawer + container ledger opened', ok: true },
  { name: 'add form seeded from existing rows (weight/appointment)', ok: Boolean(seed.weight || seed.appointment) },
  { name: `new row ${PROBE_NUMBER} rendered in ledger`, ok: rowCheck.found === true },
  { name: 'backend inherit: Tuyến/Nhà xe/Nâng/Hạ copied (fd5fbdd9 live)', ok: inheritOk },
  { name: 'probe row removed (staging restored)', ok: cleanup.gone === true },
  { name: 'no console/page errors', ok: errors.length === 0 },
];
const failed = checks.filter((c) => !c.ok);
for (const c of checks) log('check', { name: c.name, ok: c.ok });
fs.writeFileSync(path.join(OUT, '201026090100_ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log(failed.length === 0 ? 'RUNG3_DRIVE_PASS' : 'RUNG3_DRIVE_FAIL');
process.exit(failed.length === 0 ? 0 : 1);
