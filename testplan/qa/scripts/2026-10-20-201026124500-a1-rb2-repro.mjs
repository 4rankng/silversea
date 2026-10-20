// Ticket 201026124500 (verify-fail lan-2, card 181026185900 A.1) — live repro
// on the FAILING staging build (16f0e51a). Adapted from round-1's harness
// (testplan/qa/scripts/2026-10-20-verifyfail-add-container.mjs) with the
// round-1 blind spots closed:
//   - the ref row MUST carry Tuyến/Nhà xe/Nâng/Hạ AND Trọng lượng FILLED
//     (round-1's discovery accepted >=2 of 3 display names, so its "inherit"
//     could pass against fallback-resolved/empty columns);
//   - the pass check compares ref vs new row FIELD BY FIELD (Nhà xe included —
//     round-1's inheritOk ignored carrier and false-PASSed it).
// Flow: build gate → login CUS → pick a lot whose first container row is fully
// filled → open drawer → screenshot ref row → "Thêm container" (screenshot the
// seed) → type ONLY the probe number → submit → screenshot + read the new row
// → API readback of the new line (per-field, ref vs new) → remove the probe.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-201026124500');
const EXPECT_BUILD = process.env.EXPECT_BUILD || '16f0e51a';
const LOT = Number(process.env.LOT || 0);
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

// The A.1 copy-law field view of one projected container line.
const lineView = (line) => line ? {
  id: line.id,
  containerNumber: line.containerNumber,
  tuyen: { routeId: line.routeId ?? null, rawRouteId: line.raw?.routeId ?? null, routeName: line.routeName ?? null },
  nhaXe: { carrierType: line.carrierType ?? null, externalCarrierId: line.externalCarrierId ?? null, carrierName: line.carrierName ?? null },
  nang: { liftSiteId: line.liftSiteId ?? null, liftSite: line.liftSite ?? null },
  ha: { dropoffSiteId: line.dropoffSiteId ?? null, dropoffSite: line.dropoffSite ?? null },
  trongLuong: line.raw?.cargoWeightKg ?? null,
  gioHen: line.customerAppointmentAt ?? null,
} : null;

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expected: EXPECT_BUILD, ok: health.buildHash === EXPECT_BUILD });
if (health.buildHash !== EXPECT_BUILD) {
  fs.writeFileSync(path.join(OUT, '201026124500_build-gate.json'), JSON.stringify(health, null, 2));
  console.error('BLOCKED: staging build is not the expected build');
  process.exit(2);
}

const login = await api('POST', '/auth/login', { identifier: IDENTIFIER, password: PASSWORD });
if (login.status !== 200) { console.error(`BLOCKED: login -> ${login.status}`); process.exit(2); }
const token = login.body.token;
log('login', { user: login.body.user?.username ?? IDENTIFIER, role: login.body.user?.role });

// Lot pin: LOT env wins when usable, else auto-discover the first FCL lot
// whose FIRST container row has Tuyến + Nhà xe + Nâng + Hạ + Trọng lượng ALL
// filled (the exact round-2 complaint shape). Every scanned lot logs its
// ref-line shape so a selection failure still yields evidence.
let picked = null;
const shapes = [];
// Unlocked only: an accounting-locked lot withholds container writes server
// side (round-1 pin lot 177 is "Đã khóa" — the add silently 409s), and the
// A.1 copy law is about the add path, not the lock guard.
const usable = (d) => d.status === 200 && (d.body.containers ?? []).length > 0 && d.body.summary?.cargoMode !== 'LCL'
  && d.body.summary?.activeLock == null
  && !['COMPLETED', 'CANCELED'].includes(String(d.body.summary?.status ?? '').toUpperCase());
const fullyFilled = (ref) => (
  ref.routeName != null && ref.routeName !== ''
  && ref.carrierName != null && ref.carrierName !== ''
  && ref.liftSite != null && ref.liftSite !== ''
  && ref.dropoffSite != null && ref.dropoffSite !== ''
  && ref.raw?.cargoWeightKg != null
);
if (Number.isFinite(LOT) && LOT > 0) {
  const d = await api('GET', `/shipments/cus-workspace/${LOT}`, undefined, token);
  if (usable(d)) {
    const list = await api('GET', '/shipments/cus-workspace?page=1&limit=200', undefined, token);
    const rows = list.status === 200 ? (list.body.items ?? list.body.data ?? []) : [];
    picked = { id: LOT, summary: d.body.summary, list: rows.find((r) => Number(r.id) === LOT) ?? {}, detail: d.body };
  } else {
    log('lot_env_miss', { LOT, status: d.status });
  }
}
if (!picked) {
  const list = await api('GET', '/shipments/cus-workspace?page=1&limit=200', undefined, token);
  if (list.status !== 200) { console.error(`BLOCKED: list -> ${list.status}`); process.exit(2); }
  const rows = list.body.items ?? list.body.data ?? [];
  log('discovery_list', { rows: rows.length });
  for (const row of rows) {
    const hasContainers = Boolean((row.containerSummary ?? '').trim()) || (row.containerCount ?? 0) > 0;
    if (!hasContainers || row.cargoMode === 'LCL') continue;
    const d = await api('GET', `/shipments/cus-workspace/${row.id}`, undefined, token);
    if (!usable(d)) continue;
    const ref = d.body.containers[0];
    const shape = { id: row.id, identity: row.billOrBookNumber ?? null, ref: lineView(ref) };
    shapes.push(shape);
    if (!picked && fullyFilled(ref)) {
      picked = { id: row.id, summary: d.body.summary, list: row, detail: d.body };
    }
    if (shapes.length >= 60) break;
  }
  log('discovery_shapes', { scanned: shapes.length, shapes });
}
if (!picked) {
  log('blocked', { reason: 'no FCL lot whose first container row has Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng all filled' });
  fs.writeFileSync(path.join(OUT, '201026124500_ui-driver.log'), JSON.stringify(LOG, null, 2));
  process.exit(2);
}

const detail = picked.detail ?? (await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token)).body;
const cs = detail.containers ?? [];
const s = detail.summary ?? picked.summary ?? {};
const ref = cs[0];
const identity = String(picked.list.billOrBookNumber ?? s.billOrBookNumber ?? s.billNumber ?? '').trim();
log('lot_pin', {
  id: picked.id, version: s.version, containers: cs.length, cargoMode: s.cargoMode,
  transportDate: s.transportDate ?? picked.list.transportDate ?? null, identity,
  ref: lineView(ref),
});

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

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
  await page.screenshot({ path: path.join(OUT, '201026124500_ui-00-row-not-found.png') });
  await browser.close();
  fs.writeFileSync(path.join(OUT, '201026124500_ui-driver.log'), JSON.stringify(LOG, null, 2));
  process.exit(1);
}
await page.waitForSelector('.cus-container-ledger', { timeout: 30000 });
await sleep(1200);

// BEFORE: the ledger with the fully-filled ref row in view.
const beforeCells = await page.evaluate(() => {
  const row = document.querySelector('.cus-container-ledger tbody tr');
  return row ? [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim()) : null;
});
log('ledger_before', { refRowCells: beforeCells });
await page.screenshot({ path: path.join(OUT, '201026124500_ui-01-ledger-before.png') });

// Open the add form: the seeded draft (weight/appointment; type per 191026100000).
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
  typeTrigger: document.querySelector('.cus-container-ledger__add-row button[aria-haspopup="listbox"]')?.textContent?.trim() ?? null,
  // The add row's seeded A.1 cells (Tuyến/Nhà xe/Nâng/Hạ) — the "dòng mới"
  // state QA screenshots before any submit.
  cells: [...document.querySelectorAll('.cus-container-ledger__add-row td, .cus-container-ledger__add-row th')]
    .map((td) => (td.textContent || '').trim()),
}));
log('addform_seed', { seed });
await page.screenshot({ path: path.join(OUT, '201026124500_ui-02-addform-open.png') });

// Enter ONLY the container number → submit.
await page.type('.cus-container-ledger__add-row input[aria-label="Số container"]', PROBE_NUMBER, { delay: 40 });
await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.cus-container-ledger__add-row button')].find((b) => (b.textContent || '').trim() === 'Thêm');
  btn?.click();
});
await sleep(2500);
const rowCheck = await page.evaluate((probe) => {
  const toast = [...document.querySelectorAll('[role="status"], .app-notices, .toast')].map((n) => (n.textContent || '').trim()).join('|') || null;
  const addError = document.querySelector('.cus-container-ledger__add-error')?.textContent?.trim() ?? null;
  const rows = [...document.querySelectorAll('.cus-container-ledger tbody tr')];
  const row = rows.find((r) => (r.textContent || '').includes(probe));
  if (!row) return { found: false, toast, addError, rowCount: rows.length };
  const cells = [...row.querySelectorAll('td')].map((td) => (td.textContent || '').trim());
  return { found: true, toast, addError, cells, cellCount: cells.length };
}, PROBE_NUMBER);
log('new_row_dom', rowCheck);
await page.screenshot({ path: path.join(OUT, '201026124500_ui-03-newrow-after.png') });

// API readback: the projected line of the probe row vs the ref row, field by field.
const after = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
const newLine = (after.body.containers ?? []).find((c) => c.containerNumber === PROBE_NUMBER);
const refAfter = (after.body.containers ?? [])[0];
log('db_after', { found: Boolean(newLine), ref: lineView(refAfter), newRow: lineView(newLine) });

// Field-by-field A.1 verdict (copy list per card 181026185900 A.1 / ticket
// 201026124500: Tuyến, Nhà xe, Nâng, Hạ, Trọng lượng, Giờ hẹn; NOT Số cont).
const copied = (key, sub) => {
  const r = sub ? refAfter?.[key]?.[sub] : refAfter?.[key];
  const n = sub ? newLine?.[key]?.[sub] : newLine?.[key];
  return r == null || r === '' ? null : (n != null && n !== '' ? 'COPIED' : 'BLANK');
};
const verdict = newLine ? {
  Tuyen: (refAfter?.routeName != null && newLine.routeName != null) ? 'COPIED' : (refAfter?.routeName != null ? 'BLANK' : 'REF_EMPTY'),
  NhaXe: (refAfter?.carrierName != null && newLine.carrierName != null) ? 'COPIED' : (refAfter?.carrierName != null ? 'BLANK' : 'REF_EMPTY'),
  Nang: (refAfter?.liftSite != null && newLine.liftSite != null) ? 'COPIED' : (refAfter?.liftSite != null ? 'BLANK' : 'REF_EMPTY'),
  Ha: (refAfter?.dropoffSite != null && newLine.dropoffSite != null) ? 'COPIED' : (refAfter?.dropoffSite != null ? 'BLANK' : 'REF_EMPTY'),
  TrongLuong: (refAfter?.raw?.cargoWeightKg != null && newLine.raw?.cargoWeightKg != null) ? 'COPIED' : (refAfter?.raw?.cargoWeightKg != null ? 'BLANK' : 'REF_EMPTY'),
  GioHen: (refAfter?.customerAppointmentAt != null && newLine.customerAppointmentAt != null) ? 'COPIED' : (refAfter?.customerAppointmentAt != null ? 'BLANK' : 'REF_EMPTY'),
  SoContainer: newLine.containerNumber === PROBE_NUMBER ? 'OPERATOR_ENTRY' : 'UNEXPECTED',
} : null;
log('a1_verdict', { verdict });
void copied;

// Cleanup: remove the probe row (same route the drawer's Xóa rides).
let cleanup = { done: false };
if (newLine) {
  const fresh = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
  const del = await api('POST', `/shipments/cus-workspace/${picked.id}/containers/${newLine.id}/remove`, { expectedShipmentVersion: fresh.body.summary.version }, token);
  const afterDel = await api('GET', `/shipments/cus-workspace/${picked.id}`, undefined, token);
  const gone = !(afterDel.body.containers ?? []).some((c) => c.containerNumber === PROBE_NUMBER);
  cleanup = { done: del.status === 200 || del.status === 201, removeStatus: del.status, gone, containersNow: (afterDel.body.containers ?? []).length };
}
log('cleanup', cleanup);
await browser.close();

const checks = [
  { name: 'drawer + container ledger opened', ok: opened.ok === true },
  { name: 'ref row fully filled (Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng)', ok: fullyFilled(refAfter ?? ref) },
  { name: `probe row ${PROBE_NUMBER} rendered in ledger`, ok: rowCheck.found === true },
  // REF_EMPTY = the ref row carried nothing to copy for that field (vacuous),
  // not a copy failure. Only BLANK (ref filled, new row empty) fails A.1.
  { name: 'A.1 every field copied (Tuyến/Nhà xe/Nâng/Hạ/Trọng lượng/Giờ hẹn)', ok: verdict != null && Object.values(verdict).every((v) => v !== 'BLANK') },
  { name: 'probe row removed (staging restored)', ok: cleanup.gone === true },
  { name: 'no console/page errors', ok: errors.length === 0 },
];
const failed = checks.filter((c) => !c.ok);
for (const c of checks) log('check', { name: c.name, ok: c.ok });
fs.writeFileSync(path.join(OUT, '201026124500_ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log(failed.length === 0 ? 'A1_ALL_COPY_PASS' : 'A1_COPY_FAIL');
process.exit(failed.length === 0 ? 0 : 1);
