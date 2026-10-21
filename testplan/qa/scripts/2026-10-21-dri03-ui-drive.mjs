// DRI-03 (card 211026132357) — kẹp 2-container driver detail view & edit — rung-3 UI drive
// Local dev only (frontend 7175 / backend 3002 / DB 5441).
// Driver: bqhuong (user 139156, driver 42966).
// Trip: 194048 (TRP-202705-0018, 2x20DC FCL-KEP).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../../backend/node_modules/postgres/src/index.js';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const DB_HOST = process.env.DB_HOST ?? '127.0.0.1';
const DB_PORT = process.env.DB_PORT ?? 5441;
const DRIVER = process.env.DRIVER ?? 'bqhuong';
const TRIP_ID = Number(process.env.TRIP_ID ?? 194048);

const OUT = path.resolve('qa/2026-10-21-lcl01-dri03');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'dri03-ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ── 1. Health + Login ────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: DRIVER, password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed for ${DRIVER} (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log(`LOGIN ok driver=${DRIVER}`);

// ── 2. Verify Trip & Containers in API ───────────────────────────────────────
const tripRes = await fetch(`${API}/driver/me/trips/${TRIP_ID}`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch(() => null);

log(`API TRIP id=${tripRes?.id} containers=${tripRes?.containers?.length}`);
check('API returns 2 containers for kẹp trip', tripRes?.containers?.length === 2, JSON.stringify(tripRes?.containers?.map((c) => c.containerNumber)));

const sql = postgres(`postgres://postgres:postgres@${DB_HOST}:${DB_PORT}/silversea`);
const dbBefore = await sql`SELECT id, trip_id, container_number, seal_number FROM trip_containers WHERE trip_id = ${TRIP_ID} ORDER BY id`;
log(`DB BEFORE containers: ${JSON.stringify(dbBefore)}`);

// ── 3. Launch Puppeteer (390px viewport) ────────────────────────────────────
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

// Pre-inject token into localStorage
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, token);

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

// ── 4. Navigate to Trip Detail Page ─────────────────────────────────────────
log(`NAVIGATE to ${FRONT}/my-trips/${TRIP_ID}`);
await page.goto(`${FRONT}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2' });
await page.waitForSelector('.dcc-section', { timeout: 20000 });
await sleep(800);

// Scroll container card into view
await page.evaluate(() => {
  const el = document.querySelector('.dcc-section');
  if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(400);

// Step A: Capture initial view of kẹp trip (both containers visible)
await shot(page, 'dri03-01-kep-view-390');
log('CAPTURE dri03-01-kep-view-390.png');

const contItems = await page.$$eval('[data-testid^="driver-container-item-"]', (items) => items.map((el) => {
  const eyebrow = el.querySelector('.dcc-bento__eyebrow')?.textContent?.trim();
  const plate = el.querySelector('.dcc-bento__plate')?.textContent?.trim();
  const seal = el.querySelector('.dcc-bento__seal-value')?.textContent?.trim();
  const editBtn = el.querySelector('.dcc-bento__edit-btn')?.getAttribute('aria-label');
  return { eyebrow, plate, seal, editBtn };
}));

log(`DOM CONTAINER ITEMS: ${JSON.stringify(contItems)}`);
check('DRI03-R1 displays 2 container bento items', contItems.length === 2);
check('DRI03-R1 cont 1 has plate MSKU7654328 and seal SEAL001', contItems[0]?.plate === 'MSKU7654328' && contItems[0]?.seal === 'SEAL001');
check('DRI03-R1 cont 2 has plate CSQU3054383 and seal SEAL002', contItems[1]?.plate === 'CSQU3054383' && contItems[1]?.seal === 'SEAL002');
check('DRI03-R1 distinct edit buttons for cont 1 and cont 2', contItems[0]?.editBtn === 'Sửa số cont 1' && contItems[1]?.editBtn === 'Sửa số cont 2');

// ── 5. Edit Container 2 ─────────────────────────────────────────────────────
log('CLICK Sửa số cont 2');
const editBtnCont2 = await page.$('button[aria-label="Sửa số cont 2"]');
if (!editBtnCont2) { log('ABORT: button Sửa số cont 2 not found'); process.exit(2); }
await editBtnCont2.click();
await page.waitForSelector('[data-testid="dcc-editing-target"]', { timeout: 10000 });
await sleep(400);

const editingTargetText = await page.$eval('[data-testid="dcc-editing-target"]', (el) => el.textContent?.trim());
log(`EDITING TARGET BANNER: "${editingTargetText}"`);
check('DRI03-R3 edit banner indicates container 2', editingTargetText.includes('CSQU3054383') || editingTargetText.includes('Số cont 2'));

// Check pre-filled values
const prefilledValues = await page.evaluate(() => {
  const inputs = Array.from(document.querySelectorAll('.dcc-fields input'));
  return inputs.map((inp) => ({ value: inp.value, placeholder: inp.placeholder }));
});
log(`PREFILLED VALUES: ${JSON.stringify(prefilledValues)}`);
check('DRI03-R3 prefilled draft has cont 2 number CSQU3054383', prefilledValues.some((v) => v.value === 'CSQU3054383'));
check('DRI03-R3 prefilled draft has cont 2 seal SEAL002', prefilledValues.some((v) => v.value === 'SEAL002'));

// Update seal number of container 2
log('TYPE new seal for container 2: SEAL-KEP-02-EDITED');
const sealInput = await page.$('input[placeholder="Ví dụ: AB123456"]');
if (!sealInput) { log('ABORT: seal input not found'); process.exit(2); }

// Clear existing cleanly using select all + backspaces
await sealInput.click();
await page.keyboard.down('Meta');
await page.keyboard.press('KeyA');
await page.keyboard.up('Meta');
await page.keyboard.press('Backspace');
for (let i = 0; i < 15; i++) {
  await page.keyboard.press('Backspace');
}
await sealInput.type('SEAL-KEP-02-EDITED', { delay: 30 });
await sleep(300);

// Click Save
log('CLICK Lưu thay đổi (.dcc-save)');
const saveBtn = await page.$('button.dcc-save');
if (!saveBtn) { log('ABORT: save button not found'); process.exit(2); }
await saveBtn.click();

// Wait for edit mode to close and bento view to return
await page.waitForSelector('[data-testid="driver-container-item-1"]', { timeout: 15000 });
await sleep(1000);

// Scroll container card into view
await page.evaluate(() => {
  const el = document.querySelector('.dcc-section');
  if (el) el.scrollIntoView({ behavior: 'instant', block: 'center' });
});
await sleep(400);

// Step B: Capture after-edit view
await shot(page, 'dri03-02-kep-edited-390');
log('CAPTURE dri03-02-kep-edited-390.png');

const contItemsAfter = await page.$$eval('[data-testid^="driver-container-item-"]', (items) => items.map((el) => {
  const eyebrow = el.querySelector('.dcc-bento__eyebrow')?.textContent?.trim();
  const plate = el.querySelector('.dcc-bento__plate')?.textContent?.trim();
  const seal = el.querySelector('.dcc-bento__seal-value')?.textContent?.trim();
  return { eyebrow, plate, seal };
}));

log(`DOM CONTAINER ITEMS AFTER EDIT: ${JSON.stringify(contItemsAfter)}`);
check('DRI03-R3 cont 1 UNCHANGED after cont 2 edit', contItemsAfter[0]?.plate === 'MSKU7654328' && contItemsAfter[0]?.seal === 'SEAL001');
check('DRI03-R3 cont 2 UPDATED with new seal', contItemsAfter[1]?.plate === 'CSQU3054383' && contItemsAfter[1]?.seal === 'SEAL-KEP-02-EDITED');

// ── 6. Verify Database State ────────────────────────────────────────────────
const dbAfter = await sql`SELECT id, trip_id, container_number, seal_number FROM trip_containers WHERE trip_id = ${TRIP_ID} ORDER BY id`;
log(`DB AFTER containers: ${JSON.stringify(dbAfter)}`);

const cont1Db = dbAfter.find((c) => c.container_number === 'MSKU7654328');
const cont2Db = dbAfter.find((c) => c.container_number === 'CSQU3054383');

check('DRI03-R4 DB cont 1 unchanged seal SEAL001', cont1Db?.seal_number === 'SEAL001');
check('DRI03-R4 DB cont 2 persisted new seal SEAL-KEP-02-EDITED', cont2Db?.seal_number === 'SEAL-KEP-02-EDITED');

check('Console errors none', consoleErrors.length === 0, consoleErrors.join('; '));

await sql.end();
await browser.close();

log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
