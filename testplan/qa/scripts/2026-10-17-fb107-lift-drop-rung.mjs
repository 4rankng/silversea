// FB-107 (kanban card 171026115820) — "Nơi nhận" / "Nơi giao" on the lot detail
// page must show the lot's real Nâng / Hạ points instead of staying blank.
//
// One shared rule decides all three branches (resolveLiftDropPoints):
//   FCL            → the container's port names, never reversed by direction
//   LCL + Nhập     → Nâng = Kho, Hạ = Nhà máy
//   LCL + Xuất     → Nâng = Nhà máy, Hạ = Kho
//
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (thanhdc), customer LONG MINH.
//   node testplan/qa/scripts/2026-10-17-fb107-lift-drop-rung.mjs
// Exit 0 = every rung PASS.

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb107';
fs.mkdirSync(SHOTS, { recursive: true });
const TAG = `FB107-${Date.now().toString(16).slice(-6).toUpperCase()}`;

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
  const res = await fetch(`${API}${path}`, { method, headers, body: body == null ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-json */ }
  return { status: res.status, ok: res.ok, json, text };
}
async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const r = await call('POST', '/auth/login', { identifier: id, password: 'Abc123' });
    if (r.ok && r.json?.token) return r.json;
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const login = await loginWithRetry('thanhdc');
const token = login.token;
console.log(`logged in as ${login.user?.username} (${login.user?.role}) · tag ${TAG}`);

// ISO 6346 check digit, per the repo's rule (sum % 11, remainder 10 → 0).
const LM = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20, K: 21, L: 23,
  M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
const P2 = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];
function containerNumber(owner, serial6) {
  const ten = `${owner}${serial6}`;
  let total = 0;
  for (let i = 0; i < 10; i++) total += (i < 4 ? LM[ten[i]] : Number(ten[i])) * P2[i];
  const check = total % 11;
  return `${ten}${check === 10 ? 0 : check}`;
}

  const sites = await call('GET', '/shipments/operational-sites?customerId=1&limit=50', null, token);
const list = sites.json?.items ?? sites.json ?? [];
const factory = list.find((s) => s.siteType === 'FACTORY' && !/chưa xác định/i.test(s.name ?? ''));
const warehouse = list.find((s) => s.siteType === 'WAREHOUSE');
// The detail page prints the site's SHORT name when it has one — comparing
// against the full name makes a correct value look wrong (that is exactly how
// the first pass of this rung reported two passing branches as failures).
const factoryLabel = factory?.shortName || factory?.name;
const warehouseLabel = warehouse?.shortName || warehouse?.name;
record('fixture', factory && warehouse ? 'PASS' : 'FAIL',
  `factory=${factoryLabel} warehouse=${warehouseLabel}`);

const today = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
const lots = {};
for (const [key, dir] of [['imp', 'IMPORT'], ['exp', 'EXPORT']]) {
  const r = await call('POST', '/shipments/quick', {
    customerId: 1, tradeDirection: dir, cargoMode: 'LCL',
    ...(dir === 'IMPORT' ? { blNumber: `${TAG}-IMP` } : { bookingRef: `${TAG}-EXP` }),
    expectedDeliveryDate: today,
    operationalSiteId: factory.id, pickupWarehouseSiteId: warehouse.id,
    packageType: 'Pallet', packageCount: 1, cargoWeightKg: '400', cargoVolumeCbm: '2',
  }, token);
  lots[key] = r.json?.id;
  if (!r.ok) console.log(`LCL ${dir} create → ${r.status} ${r.text.slice(0, 160)}`);
}
// Two FCL lots, opposite directions, the SAME container port pair — that is
// the whole FCL rule: the pair is never reversed by trade direction.
for (const [key, dir, owner] of [['fclImp', 'IMPORT', 'FBXP'], ['fclExp', 'EXPORT', 'FBXQ']]) {
  const r = await call('POST', '/shipments/quick', {
    customerId: 1, tradeDirection: dir, cargoMode: 'FCL',
    ...(dir === 'IMPORT' ? { blNumber: `${TAG}-FCLIMP` } : { bookingRef: `${TAG}-FCLEXP` }),
    expectedDeliveryDate: today,
    containers: [{
      containerTypeId: 1,
      containerNumber: containerNumber(owner, String(100000 + (Math.floor(Date.now() / 1000) % 900000))),
      cargoWeightKg: '1000',
      pickupPortId: 1,
      dropoffPortId: 2,
    }],
  }, token);
  lots[key] = r.json?.id;
  if (!r.ok) console.log(`FCL ${dir} create → ${r.status} ${r.text.slice(0, 160)}`);
  await sleep(300);
}
console.log('lots:', JSON.stringify(lots));

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

async function readPoints(id) {
  await page.goto(`${BASE}/shipments/${id}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('dt', { timeout: 45000 });
  await sleep(2500);
  return page.evaluate(() => {
    const pairs = {};
    for (const dt of document.querySelectorAll('dt')) {
      const dd = dt.parentElement?.querySelector('dd');
      const key = (dt.innerText || '').trim();
      if (key) pairs[key] = (dd?.innerText || '').trim();
    }
    return { nhan: pairs['Nơi nhận'] ?? null, giao: pairs['Nơi giao'] ?? null };
  });
}

try {
  // ── LCL Nhập: Nâng = Kho, Hạ = Nhà máy ────────────────────────────────
  const imp = await readPoints(lots.imp);
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/01-lcl-nhap.png` });
  record('lcl-import', imp.nhan === warehouseLabel && imp.giao === factoryLabel ? 'PASS' : 'FAIL',
    `Nhập: Nơi nhận=${JSON.stringify(imp.nhan)} (kỳ vọng Kho=${warehouseLabel}) · Nơi giao=${JSON.stringify(imp.giao)} (kỳ vọng Nhà máy=${factoryLabel})`);

  // ── LCL Xuất: reversed ────────────────────────────────────────────────
  const exp = await readPoints(lots.exp);
  await sleep(600);
  await page.screenshot({ path: `${SHOTS}/02-lcl-xuat.png` });
  record('lcl-export', exp.nhan === factoryLabel && exp.giao === warehouseLabel ? 'PASS' : 'FAIL',
    `Xuất: Nơi nhận=${JSON.stringify(exp.nhan)} (kỳ vọng Nhà máy=${factoryLabel}) · Nơi giao=${JSON.stringify(exp.giao)} (kỳ vọng Kho=${warehouseLabel})`);

  // ── FCL: the container's port pair is NEVER reversed by direction. Two FCL
  //    lots with opposite directions must print the same pair, non-empty. ──
  if (lots.fclImp && lots.fclExp) {
    const fImp = await readPoints(lots.fclImp);
    await sleep(600);
    await page.screenshot({ path: `${SHOTS}/03-fcl-nhap-cang.png` });
    const fExp = await readPoints(lots.fclExp);
    await sleep(600);
    await page.screenshot({ path: `${SHOTS}/04-fcl-xuat-cang.png` });
    const nonEmpty = !!fImp.nhan && fImp.nhan !== '—' && !!fImp.giao && fImp.giao !== '—';
    const notSwapped = fImp.nhan === fExp.nhan && fImp.giao === fExp.giao;
    record('fcl-ports-not-reversed', nonEmpty && notSwapped ? 'PASS' : 'FAIL',
      `FCL Nhập: Nơi nhận=${JSON.stringify(fImp.nhan)} Nơi giao=${JSON.stringify(fImp.giao)} · `
      + `FCL Xuất: Nơi nhận=${JSON.stringify(fExp.nhan)} Nơi giao=${JSON.stringify(fExp.giao)} `
      + `→ không rỗng=${nonEmpty}, không đảo theo chiều=${notSwapped}`);
  } else {
    record('fcl-ports-not-reversed', 'FAIL', `FCL fixtures missing: ${JSON.stringify(lots)}`);
  }
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
