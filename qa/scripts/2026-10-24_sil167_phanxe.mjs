// SIL-167 — rung-3 driver: "Chỉnh sửa phân xe" — dropdown Biển số xe TRỐNG
// cho Đội xe SilverSea (OWN). Surface: /shipments-detail ledger, container 2
// of lot 249 (SILQ1520011, no carrier planned, no active trip).
//   node qa/scripts/2026-10-24_sil167_phanxe.mjs before|after
// BEFORE = trunk-style defect (empty dropdown, no reason).
// AFTER  = fix: OWN lists trucks from /dispatch-fleet?resource=TRUCK; an
//          external carrier with no catalog plates shows the reason hint.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const PHASE = process.argv[2];
if (PHASE !== 'before' && PHASE !== 'after') {
  console.error('usage: node qa/scripts/2026-10-24_sil167_phanxe.mjs before|after');
  process.exit(2);
}
const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const LOT_BL = 'SILQ1520011'; // lot 249 container 2 — searchable via searchSuffix
const CONTAINER2 = 'SILQ1520011';

const OUT = path.resolve('qa/2026-10-24-sil167');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`phase=${PHASE} front=${FRONT} api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }

// testplan/testaccounts.txt — local dev DISPATCHER (dungnv / Abc123).
const { token } = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }),
}).then((r) => r.json());
if (!token) { log('ABORT: login failed'); process.exit(2); }
log('login ok (dungnv / DISPATCHER)');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = (name) => page.screenshot({ path: path.join(OUT, `${PHASE}_ui-${name}.png`) });

const readMenu = () => page.evaluate(() => {
  const listbox = document.querySelector('[role="listbox"]');
  if (!listbox) return { open: false, options: [] };
  const visible = [...listbox.querySelectorAll('[role="option"]')]
    .filter((el) => (el instanceof HTMLElement) && el.offsetParent !== null)
    .map((el) => el.textContent?.trim() ?? '');
  return { open: true, options: visible };
});
const clickOption = async (label) => {
  const ok = await page.evaluate((wanted) => {
    const listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return false;
    const hit = [...listbox.querySelectorAll('[role="option"]')].find(
      (el) => el.textContent?.trim() === wanted && (el instanceof HTMLElement) && el.offsetParent !== null,
    );
    if (!hit) return false;
    hit.click();
    return true;
  }, label);
  if (!ok) throw new Error(`option not clickable: ${label}`);
};
const openSearchableSelect = async (triggerText) => {
  await page.evaluate((text) => {
    const hit = [...document.querySelectorAll('button')].find(
      (b) => b.textContent?.trim() === text && (b instanceof HTMLElement) && b.offsetParent !== null,
    );
    if (!hit) throw new Error(`trigger not found: ${text}`);
    hit.click();
  }, triggerText);
  await sleep(200);
};
const hint = () => page.evaluate(() => {
  const el = document.querySelector('[data-testid="plate-options-empty-hint"]');
  return el ? el.textContent?.trim() ?? '' : null;
});

// ── Surface: /shipments-detail lot 249 container 2 — vehicle editor ────────
log(`— surface: /shipments-detail?searchSuffix=${LOT_BL} — "Chỉnh sửa phân xe" ${CONTAINER2}`);
await page.goto(`${FRONT}/shipments-detail?searchSuffix=${encodeURIComponent(LOT_BL)}&dateScope=all`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector(`#shipment-detail-edit-vehicle-306`, { timeout: 20000 }).catch(async () => {
  // Fallback: find the trigger by its accessible purpose text.
  const found = await page.evaluate((cn) => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(`Chỉnh sửa phân xe ${cn}`));
    if (hit instanceof HTMLElement) { hit.id = 'shipment-detail-edit-vehicle-306'; return true; }
    return false;
  }, CONTAINER2);
  if (!found) { log('ABORT: vehicle edit trigger for container 2 not found'); process.exit(2); }
});
await shot('1-ledger');

// Step 1: open the "Chỉnh sửa phân xe" editor on container 2.
await page.click('#shipment-detail-edit-vehicle-306');
await page.waitForSelector('.shipment-container-ledger__inline-editor[data-mode="vehicle"]', { timeout: 8000 });
await sleep(300);
await shot('2-editor-open');

// Step 2: pick "Đội xe SilverSea" in Nhà xe (the screenshot's entry state).
// A previous after-run may already have persisted OWN on this container —
// then the trigger shows the selected label instead of the placeholder.
await openSearchableSelect(await page.evaluate(() => {
  const byText = (text) => [...document.querySelectorAll('button')].some(
    (b) => b.textContent?.trim() === text && (b instanceof HTMLElement) && b.offsetParent !== null,
  );
  return byText('Chọn nhà xe') ? 'Chọn nhà xe' : 'Đội xe SilverSea';
}));
await page.waitForSelector('.searchable-select__list [role="option"]', { timeout: 8000 });
await clickOption('Đội xe SilverSea');
await sleep(600); // allow the OWN fleet fetch to settle
await shot('3-own-carrier-picked');

// Step 3: open the Biển số xe dropdown and read its options.
await page.click('input[aria-label="Biển số xe"]');
await sleep(400);
const menu = await readMenu();
const emptyHint = await hint();
log(`plate menu open=${menu.open} options=${JSON.stringify(menu.options)} hint=${JSON.stringify(emptyHint)}`);
await shot('4-plate-dropdown-open');

if (PHASE === 'before') {
  // THE DEFECT: the OWN plate list could never resolve (Number('OWN') is NaN
  // and the selector source excludes own-fleet trucks) — blank, silent.
  check('BEFORE-defect: plate dropdown has NO options for Đội xe SilverSea', menu.options.length === 0, `options=${JSON.stringify(menu.options)}`);
  check('BEFORE-defect: no empty-state reason is shown', emptyHint === null, `hint=${JSON.stringify(emptyHint)}`);
} else {
  check('AFTER-fix: plate dropdown lists own-fleet plates', menu.options.length > 0 && menu.options.includes('15E-016.26'), `options=${JSON.stringify(menu.options.slice(0, 5))}`);
  check('AFTER-fix: no empty-state reason when plates loaded', emptyHint === null, `hint=${JSON.stringify(emptyHint)}`);
}

// Step 4 (after only): pick a plate, save, prove the DB side effect.
if (PHASE === 'after') {
  await clickOption('15E-016.26');
  await sleep(300);
  await shot('5-plate-picked');
  await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Lưu' && (b instanceof HTMLElement) && b.offsetParent !== null);
    if (!hit) throw new Error('Lưu button not found');
    hit.click();
  });
  await sleep(1500);
  await shot('6-after-save');
}

// Step 5 (after only): external carrier with no catalog plates → reason shown.
if (PHASE === 'after') {
  await page.goto(`${FRONT}/shipments-detail?searchSuffix=${encodeURIComponent(LOT_BL)}&dateScope=all`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#shipment-detail-edit-vehicle-306', { timeout: 20000 });
  await page.click('#shipment-detail-edit-vehicle-306');
  await page.waitForSelector('.shipment-container-ledger__inline-editor[data-mode="vehicle"]', { timeout: 8000 });
  await sleep(300);
  // NOTE: container 2 now carries OWN + plate from step 4; re-pick an external
  // carrier. Locally only 4GS (carrier 31) has a catalog fleet row — every
  // other ACTIVE carrier has none, so pick one that isn't 4GS to prove the
  // empty-state reason.
  await openSearchableSelect('Đội xe SilverSea');
  await page.waitForSelector('.searchable-select__list [role="option"]', { timeout: 8000 });
  const externalLabel = await page.evaluate(() => {
    const options = [...document.querySelectorAll('.searchable-select__list [role="option"]')]
      .filter((el) => (el instanceof HTMLElement) && el.offsetParent !== null)
      .map((el) => el.textContent?.trim() ?? '');
    return options.find((label) => label !== 'Đội xe SilverSea' && label !== 'Nhập nhà xe mới' && label !== '4GS') ?? null;
  });
  if (!externalLabel) { log('SKIP external-carrier step: no external carrier in catalog'); } else {
    await clickOption(externalLabel);
    await sleep(500);
    const extHint = await hint();
    log(`external carrier ${JSON.stringify(externalLabel)} hint=${JSON.stringify(extHint)}`);
    await shot('7-external-empty-reason');
    check('AFTER-fix: external carrier with no catalog plates states the reason', typeof extHint === 'string' && extHint.includes('chưa có biển số trong danh mục'), `hint=${JSON.stringify(extHint)}`);
  }
}

await browser.close();

// ── DB proof (after): the planned plate persisted on the lot's container 2 ─
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const rows = await sql`
  SELECT sf.shipment_container_id, sc.container_number, sf.planned_carrier_type,
         sf.planned_vehicle_plate_number, sf.planned_external_carrier_id
  FROM shipment_fulfillments sf
  JOIN shipment_containers sc ON sc.id = sf.shipment_container_id
  WHERE sc.container_number = ${CONTAINER2} AND sf.canceled_at IS NULL`;
log(`DB shipment_fulfillments (${CONTAINER2}): ${JSON.stringify(rows)}`);
if (PHASE === 'after') {
  const row = rows[0];
  check('AFTER-fix DB: container 2 planned carrier_type = OWN', row?.planned_carrier_type === 'OWN', `row=${JSON.stringify(row)}`);
  check('AFTER-fix DB: container 2 planned plate = 15E-016.26', row?.planned_vehicle_plate_number === '15E-016.26', `row=${JSON.stringify(row)}`);
}
await sql.end();

log(failures === 0 ? `RESULT: PASS (${PHASE})` : `RESULT: FAIL (${PHASE}) — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
