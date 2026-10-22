// Card 261022093846 (Zalo khách 22/10 09:38) — rung-3 UI drive, before/after.
// Local dev only. BEFORE phase drives the MAIN checkout stack (default ports,
// pre-change code); AFTER phase drives THIS worktree's stack — pass FRONT and
// API env pointing at the worktree's frontend/backend ports:
//   node testplan/qa/scripts/2026-10-22-nangha-lcl-ui-drive.mjs                 # before
//   PHASE=after FRONT=<worktree-front-url> API=<worktree-api-url> \
//     node testplan/qa/scripts/2026-10-22-nangha-lcl-ui-drive.mjs               # after
//
// Surface: bảng Chi tiết lô hàng (/shipments-detail) — cột "Nâng / hạ".
//  R1 LCL NHẬP có kho + nhà máy: trước "Nâng/Hạ – Chưa cập nhật"; sau
//     Đóng <kho> / Trả <nhà máy> + tooltip luật.
//  R2 LCL không có điểm nào: sau '—' hai vế + tooltip "chưa rõ" (không bao giờ
//     "Chưa cập nhật" — DRI-04).
//  R3 dòng container (FCL) giữ nguyên nhãn Nâng/Hạ + cảng, both phases.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
const FRONT = process.env.FRONT ?? 'http://localhost:7175';
const API = process.env.API ?? 'http://localhost:3002/api';
const DB = 'postgres://postgres:postgres@127.0.0.1:5441/silversea';

const OUT = path.resolve('qa/2026-10-22-nangha-lcl');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `nangha-lcl-ui-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} [${PHASE}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Fixtures (idempotent, both phases identical) ────────────────────────────
// Local seed lots of the LCL01-L2 QA scenario, customer 1. The kho lot gets a
// catalog kho (WAREHOUSE site 5 "ASKEY - XƯỞNG 2") + factory site (1
// "LM Võ Cường"); the bare lot stays empty for the '—' pattern. The Zalo
// production lots themselves are NEVER touched (§2 local-only).
const LOT_KHO = 312423;   // LCL01L2-DATED-017205   (IMPORT, dated)
const LOT_BARE = 312422;  // LCL01L2-UNDATED-017205 (IMPORT, undated)
const SUFFIX_LCL = '017205';           // isolates exactly the two lots above
const SUFFIX_FCL = '1792603344273';    // BK-R31KEP-1792603344273, TSTU3443063
const FCL_CONTAINER = 'TSTU3443063';
const KHO_NAME = 'ASKEY - XƯỞNG 2';
const NM_NAME = 'LM Võ Cường';

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed for ${identifier}: ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} phase=${PHASE} front=${FRONT} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const adminToken = await login('admin');
log('LOGIN ok admin');

// ── Fixture prep + DB persisted-state identity (§9.3) ──────────────────────
const sql = postgres(DB);
const prepped = await sql`
  UPDATE shipments SET pickup_warehouse_site_id = 5, operational_site_id = 1
  WHERE id = ${LOT_KHO} AND deleted_at IS NULL
  RETURNING id, pickup_warehouse_site_id, operational_site_id`;
log(`DB PREP ${JSON.stringify(prepped)}`);

const dbLots = await sql`
  SELECT id, bl_number, trade_direction, cargo_mode, pickup_warehouse_site_id,
    operational_site_id, factory_name, pickup_location, delivery_location, version
  FROM shipments WHERE id IN (${LOT_KHO}, ${LOT_BARE}) ORDER BY id`;
log(`DB lots: ${JSON.stringify(dbLots)}`);

// ── API projection identity (the exact rows the board renders) ─────────────
const apiRows = async (suffix) => {
  const res = await fetch(`${API}/shipments/cus-workspace/containers?limit=50&searchSuffix=${suffix}`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  if (!res.ok) throw new Error(`containers ${suffix} -> ${res.status}`);
  const body = await res.json();
  return (body.items ?? []).map((r) => ({
    shipmentId: r.shipmentId, isLotLevel: r.isLotLevel ?? false,
    containerNumber: r.containerNumber, liftSite: r.liftSite, dropoffSite: r.dropoffSite,
  }));
};
log(`API LCL rows: ${JSON.stringify(await apiRows(SUFFIX_LCL))}`);
log(`API FCL rows: ${JSON.stringify(await apiRows(SUFFIX_FCL))}`);

// ── Browser ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function boardPage(suffix) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => {
    if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(location.origin)) localStorage.setItem('token', t);
  }, adminToken);
  await page.goto(`${FRONT}/shipments-detail?searchSuffix=${suffix}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.shipment-container-ledger table tbody tr', { timeout: 30000 });
  await sleep(800);
  return page;
}

/** The route cell ("Nâng / hạ") of the row whose Bill/Booking matches. */
async function routeCellOf(page, rowText) {
  return page.evaluate((needle) => {
    const tr = Array.from(document.querySelectorAll('.shipment-container-ledger table tbody tr'))
      .find((row) => (row.textContent ?? '').includes(needle));
    if (!tr) return null;
    const cell = tr.querySelector('td[data-label="Nâng / hạ"]');
    if (!cell) return null;
    return { text: cell.textContent ?? '', title: cell.querySelector('.shipment-container-ledger__route')?.getAttribute('title') ?? null };
  }, rowText);
}

// ══ R1 + R2 — the LCL page (kho lot + bare lot together) ════════════════════
const lclPage = await boardPage(SUFFIX_LCL);

const r1 = await routeCellOf(lclPage, 'LCL01L2-DATED-017205');
log(`R1 kho-lot route cell: ${JSON.stringify(r1)}`);
if (PHASE === 'before') {
  check('R1 before: lot LCL renders "Chưa cập nhật" placeholders (bug present)',
    r1 != null && (r1.text.match(/Chưa cập nhật/g) ?? []).length === 2 && r1.title === null, JSON.stringify(r1));
} else {
  check('R1 after: Đóng <kho> / Trả <nhà máy> from the lot intake data',
    r1 != null && r1.text.includes('Đóng') && r1.text.includes(KHO_NAME)
      && r1.text.includes('Trả') && r1.text.includes(NM_NAME), JSON.stringify(r1));
  check('R1 after: never "Chưa cập nhật" on the LCL row',
    r1 != null && !r1.text.includes('Chưa cập nhật'), JSON.stringify(r1));
  check('R1 after: tooltip carries the law',
    r1?.title === `Lô lẻ: không nâng/hạ — đóng tại ${KHO_NAME}, trả tại ${NM_NAME}`, String(r1?.title));
}

const r2 = await routeCellOf(lclPage, 'LCL01L2-UNDATED-017205');
log(`R2 bare-lot route cell: ${JSON.stringify(r2)}`);
if (PHASE === 'before') {
  check('R2 before: bare LCL lot also reads "Chưa cập nhật" ×2',
    r2 != null && (r2.text.match(/Chưa cập nhật/g) ?? []).length === 2, JSON.stringify(r2));
} else {
  check('R2 after: bare LCL lot prints "—" halves, never "Chưa cập nhật"',
    r2 != null && (r2.text.match(/—/g) ?? []).length >= 2 && !r2.text.includes('Chưa cập nhật'), JSON.stringify(r2));
  check('R2 after: tooltip names chưa rõ honestly',
    r2?.title === 'Lô lẻ: không nâng/hạ — đóng tại chưa rõ, trả tại chưa rõ', String(r2?.title));
}

const tableEl = await lclPage.$('.shipment-container-ledger');
await tableEl?.screenshot({ path: path.join(OUT, `nangha-lcl-r1-r2-lcl-${PHASE}.png`) });
log(`SHOT qa/2026-10-22-nangha-lcl/nangha-lcl-r1-r2-lcl-${PHASE}.png`);
await lclPage.close();

// ══ R3 — the FCL container row stays Nâng/Hạ in BOTH phases ═════════════════
const fclPage = await boardPage(SUFFIX_FCL);
const r3 = await routeCellOf(fclPage, FCL_CONTAINER);
log(`R3 FCL route cell: ${JSON.stringify(r3)}`);
check('R3 both phases: container row keeps Nâng/Hạ labels + its ports',
  r3 != null && r3.text.includes('Nâng') && r3.text.includes('SITC - Lạch Huyện')
    && r3.text.includes('Hạ') && r3.text.includes('TC - HICT'), JSON.stringify(r3));
const fclTable = await fclPage.$('.shipment-container-ledger');
await fclTable?.screenshot({ path: path.join(OUT, `nangha-lcl-r3-fcl-${PHASE}.png`) });
log(`SHOT qa/2026-10-22-nangha-lcl/nangha-lcl-r3-fcl-${PHASE}.png`);
await fclPage.close();

await browser.close();
await sql.end();
log(`DONE phase=${PHASE} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
