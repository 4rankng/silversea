// CUS-11 (card 211026125915) + DRI-04 (card 211026130843) — rung-3 UI drive.
// Local dev only. Run BEFORE the patch (PHASE=before) and again after (PHASE=after):
//   node testplan/qa/scripts/2026-10-21-cus11-dri04-ui-drive.mjs           # before
//   PHASE=after node testplan/qa/scripts/2026-10-21-cus11-dri04-ui-drive.mjs
//
// Surfaces:
//  CUS-11 /shipments/:id header — Số tờ khai value (lot rows → first per-cont number → 'Chưa có' + link).
//  DRI-04 driver trip fact grid — Cảng hạ / Địa chỉ giao hàng both rows, always.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
// Port-contract default is 7175 (testplan scripts never hardcode another
// frontend port); override with FRONT when driving a worktree server.
const FRONT = process.env.FRONT ?? 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const DB = 'postgres://postgres:postgres@127.0.0.1:5441/silversea';

const OUT = path.resolve('qa/2026-10-21-cus11-dri04');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `cus11-dri04-ui-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} [${PHASE}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── Fixtures ────────────────────────────────────────────────────────────────
const ADMIN = 'admin';
const SHIP_CONT_ONLY = 110902; // 0 lot decls, 4 cont decls (TK-FB109-706110)
const SHIP_ZERO = 312425;      // 0 lot decls, 0 cont decls
const SHIP_LOT = 5;            // 1 lot decl (102250312456) + cont decls — join wins
const DRV_EXPORT = 'dvthuc';   // trips 37088 (has drop) + 40395 (thiếu điểm)
const TRIP_EXPORT_DROP = 37088;
const TRIP_EXPORT_BARE = 40395;
const DRV_DOMESTIC = 'bqhuong'; // trip 193113 (direction null, factory + drop seeded)
const TRIP_DOMESTIC = 193113;

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
log(`HEALTH status=${health?.status} phase=${PHASE} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const adminToken = await login(ADMIN);
log(`LOGIN ok ${ADMIN}`);

// ── API identity + DB persisted state (§9.3 read-only proof) ───────────────
const sql = postgres(DB);
for (const id of [SHIP_CONT_ONLY, SHIP_ZERO, SHIP_LOT]) {
  const d = await fetch(`${API}/shipments/${id}`, { headers: { Authorization: `Bearer ${adminToken}` } }).then((r) => r.json());
  const contDecl = (d.containers ?? []).map((c) => (c.declarationNumber ?? '').trim()).filter(Boolean);
  log(`API ship=${id} lotDecls=${JSON.stringify((d.declarations ?? []).map((x) => x.declarationNumber))} contDecls=${JSON.stringify(contDecl)} lock=${JSON.stringify(d.accountingLock)}`);
}
const dbRows = await sql`
  SELECT s.id, s.trade_direction, s.factory_name, s.delivery_location,
    (SELECT count(*) FROM shipment_declarations sd WHERE sd.shipment_id = s.id) AS lot_decls,
    (SELECT count(*) FROM shipment_containers sc WHERE sc.shipment_id = s.id AND COALESCE(sc.declaration_number,'') <> '') AS cont_decls
  FROM shipments s WHERE s.id IN (${SHIP_CONT_ONLY}, ${SHIP_ZERO}, ${SHIP_LOT}) ORDER BY s.id`;
const dbTrips = await sql`SELECT id, driver_id, status FROM trips WHERE id IN (${TRIP_EXPORT_DROP}, ${TRIP_EXPORT_BARE}, ${TRIP_DOMESTIC}) ORDER BY id`;
log(`DB shipments: ${JSON.stringify(dbRows)}`);
log(`DB trips: ${JSON.stringify(dbTrips)}`);

// ── Browser ─────────────────────────────────────────────────────────────────
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

async function newPage(token, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => {
    if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(location.origin)) localStorage.setItem('token', t);
  }, token);
  return page;
}

const headerDD = (page) => page.evaluate(() => {
  const dt = Array.from(document.querySelectorAll('.shipment-detail__fields dt')).find((el) => el.textContent?.trim() === 'Số tờ khai');
  if (!dt) return null;
  const dd = dt.nextElementSibling;
  return { text: dd?.textContent?.trim() ?? '', title: dd?.getAttribute('title') ?? null, link: dd?.querySelector('.shipment-detail__decl-link')?.textContent?.trim() ?? null };
});

// ══ CUS-11 — admin, desktop 1440 ════════════════════════════════════════════
const adminPage = await newPage(adminToken, 1440, 900);

// R1 — lot rows win (unchanged by the fix)
await adminPage.goto(`${FRONT}/shipments/${SHIP_LOT}`, { waitUntil: 'networkidle2' });
await adminPage.waitForSelector('.shipment-detail__fields', { timeout: 20000 });
await sleep(600);
const r1 = await headerDD(adminPage);
log(`CUS11 R1 ship=${SHIP_LOT} header=${JSON.stringify(r1)}`);
check('R1 lot declarations join in header', r1?.text === '102250312456', JSON.stringify(r1));

// R2 — cont-only lot: before '—', after FIRST per-cont number
await adminPage.goto(`${FRONT}/shipments/${SHIP_CONT_ONLY}`, { waitUntil: 'networkidle2' });
await adminPage.waitForSelector('.shipment-detail__fields', { timeout: 20000 });
await sleep(600);
const r2 = await headerDD(adminPage);
log(`CUS11 R2 ship=${SHIP_CONT_ONLY} header=${JSON.stringify(r2)}`);
if (PHASE === 'before') {
  check('R2 cont-only lot header shows "—" (bug present)', r2?.text === '—', JSON.stringify(r2));
} else {
  check('R2 cont-only lot header shows FIRST per-container tờ khai', r2?.text === 'TK-FB109-706110', JSON.stringify(r2));
  check('R2 provenance title names the per-container source', (r2?.title ?? '').includes('container'), r2?.title ?? 'no title');
}
await adminPage.screenshot({ path: path.join(OUT, `cus11-r2-cont-only-${PHASE}.png`) });

// R3 — truly zero: before '—', after 'Chưa có' + flow link; AFTER clicks the link
await adminPage.goto(`${FRONT}/shipments/${SHIP_ZERO}`, { waitUntil: 'networkidle2' });
await adminPage.waitForSelector('.shipment-detail__fields', { timeout: 20000 });
await sleep(600);
const r3 = await headerDD(adminPage);
const r3Labels = await adminPage.evaluate(() => Array.from(document.querySelectorAll('.shipment-detail__fields dt')).map((el) => el.textContent?.trim()));
log(`CUS11 R3 ship=${SHIP_ZERO} header=${JSON.stringify(r3)}`);
if (PHASE === 'before') {
  check('R3 zero-decl lot header shows "—" (bug present)', r3?.text === '—', JSON.stringify(r3));
  check('R3 no add-flow link in header', r3?.link === null, JSON.stringify(r3?.link));
} else {
  check('R3 zero-decl lot header shows "Chưa có"', (r3?.text ?? '').startsWith('Chưa có'), JSON.stringify(r3));
  check('R3 header carries "Thêm tờ khai" link', r3?.link === 'Thêm tờ khai', JSON.stringify(r3));
  const four = ['Số Bill / Số Booking', 'Số tờ khai', 'Xuất / Nhập', 'Hãng tàu'];
  const slice = four.map((f) => r3Labels?.indexOf(f)).sort((a, b) => a - b);
  check('R3 all 4 document labels render in order', slice.every((v) => v >= 0) && slice[3] - slice[0] === 3, JSON.stringify(slice));
  await adminPage.click('.shipment-detail__decl-link');
  await sleep(600);
  const modalInput = await adminPage.$('input[placeholder="Nhập số tờ khai..."]');
  check('R3 link opens the Thêm tờ khai modal', modalInput !== null);
  await adminPage.screenshot({ path: path.join(OUT, `cus11-r3-zero-modal-${PHASE}.png`) });
  // Close without saving (read-only evidence run).
  const cancel = await adminPage.evaluateHandle(() => Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Hủy'));
  await cancel.asElement()?.click();
  await sleep(400);
}
await adminPage.screenshot({ path: path.join(OUT, `cus11-r3-zero-${PHASE}.png`) });

// ══ DRI-04 — drivers, mobile 390 ═══════════════════════════════════════════
async function driverFacts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('.driver-task-fact')).map((el) => ({
    label: el.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? '',
    value: el.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? '',
    title: el.getAttribute('title') ?? null,
  })));
}
const fact = (facts, label) => facts.find((f) => f.label === label) ?? null;

const dvToken = await login(DRV_EXPORT);
const dvPage = await newPage(dvToken, 390, 844);

// R1 — EXPORT with drop point
await dvPage.goto(`${FRONT}/my-trips/${TRIP_EXPORT_DROP}`, { waitUntil: 'networkidle2' });
await dvPage.waitForSelector('.driver-task-fact', { timeout: 20000 });
await sleep(800);
const f1 = await driverFacts(dvPage);
log(`DRI04 R1 trip=${TRIP_EXPORT_DROP} facts=${JSON.stringify(f1.filter((x) => ['Cảng hạ', 'Địa chỉ giao hàng'].includes(x.label)))}`);
check('R1 Cảng hạ names the port', fact(f1, 'Cảng hạ')?.value === 'Cảng ICD Sóng Thần', fact(f1, 'Cảng hạ')?.value ?? 'missing');
if (PHASE === 'before') {
  check('R1 delivery row silently absent (bug present)', fact(f1, 'Địa chỉ giao hàng') === null);
} else {
  const delivery = fact(f1, 'Địa chỉ giao hàng');
  check('R1 delivery row visible, names the port', delivery?.value === 'Cảng ICD Sóng Thần', JSON.stringify(delivery));
  check('R1 delivery row carries the one-line export-law tooltip', (delivery?.title ?? '').includes('xuất khẩu') && (delivery?.title ?? '').length > 0, delivery?.title ?? 'no title');
}
await dvPage.screenshot({ path: path.join(OUT, `dri04-r1-export-drop-${PHASE}.png`) });

// R2 — EXPORT thiếu điểm
await dvPage.goto(`${FRONT}/my-trips/${TRIP_EXPORT_BARE}`, { waitUntil: 'networkidle2' });
await dvPage.waitForSelector('.driver-task-fact', { timeout: 20000 });
await sleep(800);
const f2 = await driverFacts(dvPage);
log(`DRI04 R2 trip=${TRIP_EXPORT_BARE} facts=${JSON.stringify(f2.filter((x) => ['Cảng hạ', 'Địa chỉ giao hàng'].includes(x.label)))}`);
if (PHASE === 'before') {
  check('R2 bare Cảng hạ falls to bare "—" (bug present)', fact(f2, 'Cảng hạ')?.value === '—', fact(f2, 'Cảng hạ')?.value ?? 'missing');
  check('R2 delivery row silently absent (bug present)', fact(f2, 'Địa chỉ giao hàng') === null);
} else {
  check('R2 bare Cảng hạ shows named "Chưa có cảng hạ"', fact(f2, 'Cảng hạ')?.value === 'Chưa có cảng hạ', fact(f2, 'Cảng hạ')?.value ?? 'missing');
  check('R2 delivery row visible with named "Chưa có địa chỉ giao"', fact(f2, 'Địa chỉ giao hàng')?.value === 'Chưa có địa chỉ giao', JSON.stringify(fact(f2, 'Địa chỉ giao hàng')));
}
await dvPage.screenshot({ path: path.join(OUT, `dri04-r2-export-bare-${PHASE}.png`) });

// R3 — domestic (direction null) with factory + drop
const bqToken = await login(DRV_DOMESTIC);
const bqPage = await newPage(bqToken, 390, 844);
await bqPage.goto(`${FRONT}/my-trips/${TRIP_DOMESTIC}`, { waitUntil: 'networkidle2' });
await bqPage.waitForSelector('.driver-task-fact', { timeout: 20000 });
await sleep(800);
const f3 = await driverFacts(bqPage);
log(`DRI04 R3 trip=${TRIP_DOMESTIC} facts=${JSON.stringify(f3.filter((x) => ['Cảng hạ', 'Địa chỉ giao hàng'].includes(x.label)))}`);
check('R3 domestic Cảng hạ names the drop point', fact(f3, 'Cảng hạ')?.value === 'Kho Trả Hàng Thủ Đức', fact(f3, 'Cảng hạ')?.value ?? 'missing');
if (PHASE === 'before') {
  check('R3 delivery row absent for null-direction trip (bug present)', fact(f3, 'Địa chỉ giao hàng') === null);
} else {
  check('R3 domestic delivery row names the factory destination', fact(f3, 'Địa chỉ giao hàng')?.value === 'Nhà máy Tân Tạo', JSON.stringify(fact(f3, 'Địa chỉ giao hàng')));
}
await bqPage.screenshot({ path: path.join(OUT, `dri04-r3-domestic-${PHASE}.png`) });

// ── DB unchanged proof (read-only change) ──────────────────────────────────
const dbAfter = await sql`
  SELECT s.id, s.trade_direction, s.factory_name, s.delivery_location,
    (SELECT count(*) FROM shipment_declarations sd WHERE sd.shipment_id = s.id) AS lot_decls,
    (SELECT count(*) FROM shipment_containers sc WHERE sc.shipment_id = s.id AND COALESCE(sc.declaration_number,'') <> '') AS cont_decls
  FROM shipments s WHERE s.id IN (${SHIP_CONT_ONLY}, ${SHIP_ZERO}, ${SHIP_LOT}) ORDER BY s.id`;
check('DB shipment rows unchanged by the drive', JSON.stringify(dbAfter) === JSON.stringify(dbRows), JSON.stringify(dbAfter));
await sql.end({ timeout: 5 });

await browser.close();
log(`DONE phase=${PHASE} failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
