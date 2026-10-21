// DRI-01 (card 211026130743) + DIS-09 (card 211026130015) — rung-3 UI drive.
// Local dev only (this worktree's stack: frontend 7181 / backend 3031 / DB 5441).
//
// DRI-01 — /trips/:id (admin trip detail, role ADMIN `admin`) renders the
//   factory site's SĐT kho/nhà máy as the shared tel: tap-to-call; the
//   instructions SĐT rides the same TelLink; /config/factories lists dial too.
// DIS-09 — /dispatch-detail (role DISPATCHER `dieuvan`) grouped LCL assigned
//   row carries the ⋯ row menu; "Đổi nhà xe/BKS" opens the PRE-FILLED truck
//   edit ONE click from the row; save updates the group through
//   POST /api/shipments/lcl/truck; DB side-effect proved; then reverted
//   through the SAME UI path.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7181}`;
const API = `http://localhost:${process.env.API_PORT ?? 3031}/api`;
const OUT = path.resolve('qa/2026-10-21-dri01-dis09');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'dri01-dis09-ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── 0. Health ────────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`ABORT: login failed for ${identifier} (${res.status})`); process.exit(2); }
  const { token } = await res.json();
  log(`LOGIN ok user=${identifier}`);
  return token;
}

const sql = postgres(`postgres://postgres:postgres@127.0.0.1:5441/silversea`);

// ═════════════════════════════════════════════════════════════════════════════
// PART A — DRI-01: tel: on /trips/:id (ADMIN) + /config/factories — 390px
// ═════════════════════════════════════════════════════════════════════════════
const adminToken = await login('admin');

// API ground truth: the trip detail carries the factory site + live phone.
const TRIP_ID = Number(process.env.TRIP_ID ?? 194048);
const tripWire = await fetch(`${API}/trips/${TRIP_ID}`, {
  headers: { Authorization: `Bearer ${adminToken}` },
}).then((r) => r.json()).catch(() => null);
log(`API /trips/${TRIP_ID} factorySite=${JSON.stringify(tripWire?.factorySite)}`);
check('DRI01-API factorySite.contactPhone reaches the admin trip wire', tripWire?.factorySite?.contactPhone === '02253555555', tripWire?.factorySite?.contactPhone ?? 'null');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, adminToken);

log(`NAVIGATE to ${FRONT}/trips/${TRIP_ID}`);
await page.goto(`${FRONT}/trips/${TRIP_ID}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.info-list', { timeout: 30000 });
await sleep(900);

// Basic facts: SĐT kho/nhà máy row is a tel: anchor with the normalized href.
const basicTel = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.info-list .info-row')];
  const row = rows.find((r) => r.querySelector('.lbl')?.textContent?.trim() === 'SĐT kho/nhà máy');
  if (!row) return null;
  const a = row.querySelector('a.val-tel[href^="tel:"]');
  return { label: row.querySelector('.lbl')?.textContent?.trim(), href: a?.getAttribute('href'), text: a?.textContent?.trim() };
});
log(`DOM BASIC TEL: ${JSON.stringify(basicTel)}`);
check('DRI01-R1 /trips/:id renders SĐT kho/nhà máy row', basicTel?.label === 'SĐT kho/nhà máy', JSON.stringify(basicTel));
check('DRI01-R2 the number is the tel: anchor with normalized href', basicTel?.href === 'tel:02253555555', basicTel?.href ?? 'none');
check('DRI01-R3 visible digits intact (02253555555)', basicTel?.text === '02253555555', basicTel?.text ?? 'none');

// Tap-to-call: click the anchor — a tel: navigation cannot complete in a
// headless desktop (no dialer); the SPA must stay put and the href must lead.
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.info-list .info-row')];
  const row = rows.find((r) => r.querySelector('.lbl')?.textContent?.trim() === 'SĐT kho/nhà máy');
  row?.querySelector('a.val-tel')?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(300);
await shot(page, 'dri01-01-trips-detail-tel-390');
log('CAPTURE dri01-01-trips-detail-tel-390.png');
await page.click('a.val-tel[href="tel:02253555555"]').catch(() => {});
await sleep(600);
const urlAfterTap = page.url();
check('DRI01-R4 tap on the tel: link keeps the SPA on /trips/:id (headless has no dialer)', urlAfterTap.includes(`/trips/${TRIP_ID}`), urlAfterTap);

// The instructions SĐT rides the shared TelLink (normalized) when present.
// Trip 194048 ships with no instructions row, so the drive seeds one through
// the official manager endpoint with a SPACE-formatted number — the exact
// "href chứa khoảng trắng" defect class the audit cites — and re-drives.
const instrSeed = await fetch(`${API}/trips/${TRIP_ID}/instructions`, {
  method: 'PUT',
  headers: {
    Authorization: `Bearer ${adminToken}`,
    'Content-Type': 'application/json',
    'Idempotency-Key': `dri01-evidence-${TRIP_ID}`,
  },
  body: JSON.stringify({ contactName: 'Chị An (QA)', contactPhone: '0989 130 345', notes: 'DRI-01 evidence: SĐT liên hệ dạng có khoảng trắng.' }),
});
log(`SEED instructions PUT status=${instrSeed.status}`);
check('DRI01-R5a seed instructions accepted (formatted phone kept verbatim)', instrSeed.ok);
const seededInstr = await instrSeed.json().catch(() => null);
log(`SEEDED instructions: ${JSON.stringify(seededInstr)}`);

await page.reload({ waitUntil: 'networkidle2' });
await page.waitForSelector('.info-list', { timeout: 30000 });
await sleep(900);
const instructionsTel = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tdp-instructions-row')];
  const row = rows.find((r) => r.querySelector('.tdp-instructions-label')?.textContent?.trim() === 'SĐT');
  if (!row) return { present: false };
  const a = row.querySelector('a[href^="tel:"]');
  return { present: true, href: a?.getAttribute('href'), text: a?.textContent?.trim() };
});
log(`DOM INSTRUCTIONS TEL: ${JSON.stringify(instructionsTel)}`);
check('DRI01-R5 instructions SĐT is the TelLink anchor — visible digits keep spaces',
  instructionsTel.present === true && instructionsTel.text === '0989 130 345',
  JSON.stringify(instructionsTel));
check('DRI01-R6 instructions SĐT href strips ALL whitespace (tel:0989130345)',
  instructionsTel.href === 'tel:0989130345', instructionsTel.href ?? 'none');
await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.tdp-instructions-row')];
  rows.find((r) => r.querySelector('.tdp-instructions-label')?.textContent?.trim() === 'SĐT')
    ?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(300);
await shot(page, 'dri01-03-instructions-tel-390');
log('CAPTURE dri01-03-instructions-tel-390.png');

// /config/factories — the master-data LIST of kho/nhà máy dials too.
log('NAVIGATE to /config/factories');
await page.goto(`${FRONT}/config/factories`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.factory-record-details', { timeout: 30000 });
await sleep(900);
const factories = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.factory-record-details')];
  let telLinks = 0;
  let goButtons = 0;
  for (const cell of cells) {
    telLinks += cell.querySelectorAll('a[href^="tel:"]').length;
    goButtons += [...cell.querySelectorAll('a[aria-label^="Gọi"], button[aria-label^="Gọi"]')].length;
  }
  return { cells: cells.length, telLinks, goButtons };
});
log(`DOM FACTORIES LIST: ${JSON.stringify(factories)}`);
check('DRI01-R7 /config/factories renders site phone numbers as tel: links', factories.telLinks >= 1, JSON.stringify(factories));
check('DRI01-R8 /config/factories carries Gọi buttons beside the numbers', factories.goButtons >= 1, JSON.stringify(factories));
await page.evaluate(() => {
  const cell = document.querySelector('.factory-record-details');
  cell?.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(300);
await shot(page, 'dri01-02-factories-list-tel-390');
log('CAPTURE dri01-02-factories-list-tel-390.png');

// ═════════════════════════════════════════════════════════════════════════════
// PART B — DIS-09: row menu Đổi nhà xe/BKS on /dispatch-detail — 1440px
// ═════════════════════════════════════════════════════════════════════════════
const SHIPMENT_ID = Number(process.env.SHIPMENT_ID ?? 109225);
const SIBLING_ID = Number(process.env.SIBLING_ID ?? 109226);
const BOOKING = process.env.BOOKING ?? 'FB095UI-482D6671-A';
const PLATE_BEFORE = '29X-QA482D';
const PLATE_NEW = '29X-QA-D9A';

const dbBefore = await sql`SELECT id, cost_group_id, actual_truck_no, billing_truck_no FROM shipments WHERE id IN (${SHIPMENT_ID}, ${SIBLING_ID}) ORDER BY id`;
log(`DB BEFORE group: ${JSON.stringify(dbBefore)}`);
check('DIS09-DB0 both group members start on the known plate', dbBefore.every((r) => r.actual_truck_no === PLATE_BEFORE), JSON.stringify(dbBefore));

await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, await login('dieuvan'));

// FB-014 deep link scopes the board to the grouped lot.
log(`NAVIGATE to /dispatch-detail?q=${BOOKING}`);
await page.goto(`${FRONT}/dispatch-detail?q=${encodeURIComponent(BOOKING)}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('table.detailed-plan-grid', { timeout: 30000 });
await sleep(1200);

// Locate THIS group's row via its booking ref (the row's Bill/Booking line).
const menuSummaryOfTargetRow = await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  if (!row) return null;
  const trigger = row.querySelector('button.dispatch-row-menu__trigger');
  const badge = row.querySelector('.detailed-plan-grid__lcl-group-tag')?.textContent?.trim();
  return { found: Boolean(trigger), ariaLabel: trigger?.getAttribute('aria-label'), badge };
}, BOOKING);
log(`DOM TARGET ROW (${BOOKING}): ${JSON.stringify(menuSummaryOfTargetRow)}`);
check('DIS09-R1 the assigned grouped row carries the ⋯ row menu', menuSummaryOfTargetRow?.found === true, JSON.stringify(menuSummaryOfTargetRow));

// Open the target row's menu.
await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  row?.querySelector('button.dispatch-row-menu__trigger')?.click();
}, BOOKING);
await sleep(400);

const menuItems = await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  const open = [...document.querySelectorAll('.dispatch-row-menu__list[role="menu"]')]
    .find((list) => list.getAttribute('aria-label') === `Thao tác dòng · ${booking}`);
  if (!open) return null;
  return [...open.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent?.trim());
}, BOOKING);
log(`DOM ROW MENU ITEMS: ${JSON.stringify(menuItems)}`);
check('DIS09-R2 the row menu offers Đổi nhà xe/BKS (one click from the row, no badge first)', menuItems?.includes('Đổi nhà xe/BKS') === true, JSON.stringify(menuItems));
await shot(page, 'dis09-01-row-menu-open-1440');
log('CAPTURE dis09-01-row-menu-open-1440.png');

// One click on the menu item → the edit dialog is ALREADY pre-filled.
await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  const open = [...document.querySelectorAll('.dispatch-row-menu__list[role="menu"]')]
    .find((list) => list.getAttribute('aria-label') === `Thao tác dòng · ${booking}`);
  const item = [...(open?.querySelectorAll('[role="menuitem"]') ?? [])].find((b) => b.textContent?.trim() === 'Đổi nhà xe/BKS');
  item?.click();
}, BOOKING);
await page.waitForSelector('#lcl-group-truck-actual', { timeout: 15000 });
await sleep(500);
const prefilled = await page.evaluate(() => ({
  actual: document.querySelector('#lcl-group-truck-actual')?.value,
  billing: document.querySelector('#lcl-group-truck-billing')?.value,
  modalTitle: document.querySelector('.modal-title, [class*="modal"] h2, [class*="modal"] h3')?.textContent?.trim(),
}));
log(`DOM TRUCK EDIT PREFILLED: ${JSON.stringify(prefilled)}`);
check('DIS09-R3 the dialog opens pre-filled with the group BKS pair', prefilled.actual === PLATE_BEFORE && prefilled.billing === PLATE_BEFORE, JSON.stringify(prefilled));
await shot(page, 'dis09-02-truck-edit-prefilled-1440');
log('CAPTURE dis09-02-truck-edit-prefilled-1440.png');

// Change the group truck and save.
await page.evaluate((plate) => {
  const input = document.querySelector('#lcl-group-truck-actual');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, plate);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, PLATE_NEW);
await sleep(200);
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')];
  buttons.find((b) => b.textContent?.trim() === 'Lưu xe nhóm')?.click();
});
await sleep(1800);
const toastText = await page.evaluate(() => document.body.textContent?.includes('Đã đổi xe nhóm'));
log(`DOM TOAST after save: đã-đổi-xe-nhóm=${toastText}`);
const modalClosed = await page.evaluate(() => document.querySelector('#lcl-group-truck-actual') == null);
check('DIS09-R4 save closes the dialog (and toasts Đã đổi xe nhóm)', modalClosed && toastText === true, `modalClosed=${modalClosed} toast=${toastText}`);

const dbAfter = await sql`SELECT id, actual_truck_no, billing_truck_no FROM shipments WHERE id IN (${SHIPMENT_ID}, ${SIBLING_ID}) ORDER BY id`;
log(`DB AFTER change: ${JSON.stringify(dbAfter)}`);
check('DIS09-DB1 the group truck write persisted (BKS thực mới trên CẢ HAI thành viên nhóm)', dbAfter.length === 2 && dbAfter.every((r) => r.actual_truck_no === PLATE_NEW), JSON.stringify(dbAfter));
await shot(page, 'dis09-03-after-save-1440');
log('CAPTURE dis09-03-after-save-1440.png');

// Revert through the SAME UI path (row menu → dialog → save original plate).
await sleep(1200); // let the grid refetch land the new plate
await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  row?.querySelector('button.dispatch-row-menu__trigger')?.click();
}, BOOKING);
await sleep(400);
await page.evaluate((booking) => {
  const rows = [...document.querySelectorAll('table.detailed-plan-grid tbody tr')];
  const row = rows.find((tr) => tr.textContent?.includes(booking));
  const open = [...document.querySelectorAll('.dispatch-row-menu__list[role="menu"]')]
    .find((list) => list.getAttribute('aria-label') === `Thao tác dòng · ${booking}`);
  const item = [...(open?.querySelectorAll('[role="menuitem"]') ?? [])].find((b) => b.textContent?.trim() === 'Đổi nhà xe/BKS');
  item?.click();
}, BOOKING);
await page.waitForSelector('#lcl-group-truck-actual', { timeout: 15000 });
const prefilledRevert = await page.evaluate(() => document.querySelector('#lcl-group-truck-actual')?.value);
log(`DOM REVERT PREFILLED: ${prefilledRevert}`);
check('DIS09-R5 the reopened dialog is pre-filled with the SAVED plate (refetch coherence)', prefilledRevert === PLATE_NEW, `value=${prefilledRevert}`);
await page.evaluate((plate) => {
  const input = document.querySelector('#lcl-group-truck-actual');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, plate);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, PLATE_BEFORE);
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll('button')];
  buttons.find((b) => b.textContent?.trim() === 'Lưu xe nhóm')?.click();
});
await sleep(1800);
const dbReverted = await sql`SELECT id, actual_truck_no, billing_truck_no FROM shipments WHERE id IN (${SHIPMENT_ID}, ${SIBLING_ID}) ORDER BY id`;
log(`DB REVERTED: ${JSON.stringify(dbReverted)}`);
check('DIS09-DB2 revert through the same UI path restored the original plate on BOTH members', dbReverted.length === 2 && dbReverted.every((r) => r.actual_truck_no === PLATE_BEFORE), JSON.stringify(dbReverted));

await browser.close();
await sql.end({ timeout: 1 });

log(failures === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
