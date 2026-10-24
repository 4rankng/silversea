// SIL-152 — rung-3 driver: combobox loại cont, gõ đè lựa chọn đã chọn.
// Two surfaces, both riding USearchableField non-searchable (openOnType):
//   A) create workspace /shipments/new — Loại container cell (picker).
//   B) CUS drawer /shipments lot 249 (REGPK-ths3n635t4) — Thêm container
//      add-row Loại cont (SIL-68 surface). AFTER-phase commits a real
//      container add → DB side-effect proof (shipment_containers row).
// Phases: before (trunk code, defect evidence) / after (fix, asserts green).
//   node qa/scripts/2026-10-24_sil152_repro.mjs before|after
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const PHASE = process.argv[2];
if (PHASE !== 'before' && PHASE !== 'after') {
  console.error('usage: node qa/scripts/2026-10-24_sil152_repro.mjs before|after');
  process.exit(2);
}
const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const LOT_ID = 249;
const LOT_BL = 'REGPK-ths3n635t4';
const QA_NUMBER = PHASE === 'before' ? 'SILQ1520006' : 'SILQ1520011'; // ISO 6346 check-digit valid (server gate, shared/src iso6346)
// container_types catalog in local dev (verified pre-run): 20DC=1, 40HC=4.
const TYPE_20DC = 1;
const TYPE_40HC = 4;

const OUT = path.resolve('qa/2026-10-24_sil152-cont-retype');
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

// Waits for a visible option inside the open listbox and returns its label text.
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
const comboValue = (ariaLabel) => page.evaluate((label) => {
  const input = document.querySelector(`input[aria-label="${label}"]`);
  return input ? input.value : null;
}, ariaLabel);
const openCombo = async (ariaLabel) => {
  await page.click(`input[aria-label="${ariaLabel}"]`);
  await sleep(150);
};
// "Gõ đè" entry (SIL-152): focus the field WITH the old label selected — a
// triple-click selects the input's whole text (the app's onFocus select-all
// covers keyboard entry; a single mouse click just places the caret) — then
// typing REPLACES the old label instead of appending to it.
const openComboSelectAll = async (ariaLabel) => {
  await page.click(`input[aria-label="${ariaLabel}"]`);
  await sleep(150);
  // Native select-all via the input's own .select() — the SAME call the
  // app's onFocus handler makes for keyboard entry (a mouse click collapses
  // the caret; Cmd+A is swallowed while the RAC menu is open). This is the
  // "gõ đè" precondition: the old label is selected, typing REPLACES it.
  await page.evaluate((label) => {
    const input = document.querySelector(`input[aria-label="${label}"]`);
    if (input) input.select();
  }, ariaLabel);
  await sleep(100);
};

// ── Surface A: create workspace Loại container cell ────────────────────────
log('— surface A: /shipments/new (create workspace, ContainerTypeCellPicker)');
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await page.waitForSelector('input[aria-label="Loại container"]', { timeout: 20000 });
} catch {
  log('ABORT surface A: Loại container combobox not found (FCL rows not rendered?)');
  process.exit(2);
}

// Step A1: first pick 20DC (baseline — the ticket's entry state).
await openCombo('Loại container');
await page.waitForSelector('[role="option"]', { timeout: 8000 });
await clickOption('20DC');
await sleep(400);
const a1 = await comboValue('Loại container');
check('A1 pick 20DC shows its label', a1 === '20DC', `input=${JSON.stringify(a1)}`);
await shot('create-1-picked20dc');

// Step A2: type over the selection — '4' must own the input (SIL-152 core).
await openComboSelectAll('Loại container'); // gõ đè: old label selected
await page.keyboard.type('4');
await sleep(500);
const a2Early = await comboValue('Loại container');
await sleep(700);
const a2 = await comboValue('Loại container');
const a2Menu = await readMenu();
await shot('create-2-typed4');
if (PHASE === 'before') {
  check('A2[before-defect] typed 4 reverts to old label 20DC', a2 === '20DC', `early=${JSON.stringify(a2Early)} settled=${JSON.stringify(a2)}`);
  check('A2[before-defect] draft never reaches the filter (menu ignores the typed 4)',
    a2Menu.options.includes('20DC') && a2Menu.options.includes('40DC'), `options=${JSON.stringify(a2Menu.options)}`);
} else {
  check('A2[after-fix] typed 4 STAYS in the input', a2 === '4', `early=${JSON.stringify(a2Early)} settled=${JSON.stringify(a2)}`);
  check('A2[after-fix] menu filters by the draft (40HC visible, 20DC hidden)',
    a2Menu.options.includes('40HC') && !a2Menu.options.includes('20DC'), `options=${JSON.stringify(a2Menu.options)}`);
}

// Step A3: pick 40HC from the (still-open) menu with the MOUSE. Empirically
// (before-phase probe) the mouse path itself updates the label — the defect
// is the TYPING path (A2): the draft is eaten, so keyboard flows below
// commit the wrong option.
await clickOption('40HC');
await sleep(500);
const a3 = await comboValue('Loại container');
check('A3 mouse re-pick shows the new label (both builds)', a3 === '40HC', `input=${JSON.stringify(a3)}`);
await shot('create-3-after-pick40hc');

// Step A4: the KEYBOARD variant — the ticket's "chọn lại bị revert" pain.
// Re-pick 20DC, type '4', then ArrowDown+Enter. Buggy: the draft never
// reaches the filter (full list), so Enter commits the OLD-side highlight
// (20DC) — the value "reverts" to the old pick. Fixed: the draft owns the
// filter, Enter commits from the '4'-filtered set (never the old label).
await openCombo('Loại container');
await clickOption('20DC');
await sleep(400);
await openComboSelectAll('Loại container');
await page.keyboard.type('4');
await sleep(400);
await page.keyboard.press('ArrowDown');
await sleep(150);
await page.keyboard.press('Enter');
await sleep(500);
const a4 = await comboValue('Loại container');
if (PHASE === 'before') {
  // The draft never reaches the filter, so ArrowDown+Enter commits from the
  // UNFILTERED list — any option the typed '4' could never match (20DC, 20HC…).
  const fourFiltered = ['40DC', '40HC', '40RF', '45HC'];
  check('A4[before-defect] keyboard re-pick commits from the UNFILTERED list (draft ignored)', !fourFiltered.includes(a4 ?? ''), `input=${JSON.stringify(a4)}`);
} else {
  check('A4[after-fix] keyboard re-pick commits from the 4-filtered set', a4 !== '20DC' && a4 != null, `input=${JSON.stringify(a4)}`);
}
await shot('create-4-keyboard-repick');

// ── Surface B: CUS drawer add-row Loại cont (SIL-68 surface) ───────────────
log(`— surface B: /shipments drawer lot ${LOT_ID} (${LOT_BL}) — Thêm container`);
await page.goto(`${FRONT}/shipments?searchSuffix=${encodeURIComponent(LOT_BL)}`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector(`#cus-dashboard-detail-${LOT_ID}`, { timeout: 20000 });
await page.click(`#cus-dashboard-detail-${LOT_ID}`);
await page.waitForFunction(
  () => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Thêm container'),
  { timeout: 20000 },
);
await page.evaluate(() => {
  const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm container');
  hit.click();
});
await page.waitForSelector('input[aria-label="Số container"]', { timeout: 8000 });
await page.type('input[aria-label="Số container"]', QA_NUMBER);

// Step B1: pick 20DC in the add-row combobox.
await openCombo('Loại cont');
await page.waitForSelector('[role="option"]', { timeout: 8000 });
await clickOption('20DC');
await sleep(400);
const b1 = await comboValue('Loại cont');
check('B1 pick 20DC shows its label', b1 === '20DC', `input=${JSON.stringify(b1)}`);
await shot('cus-1-picked20dc');

// Step B2: type over it.
await openComboSelectAll('Loại cont');
await page.keyboard.type('4');
await sleep(500);
const b2Early = await comboValue('Loại cont');
await sleep(700);
const b2 = await comboValue('Loại cont');
const b2Menu = await readMenu();
await shot('cus-2-typed4');
if (PHASE === 'before') {
  check('B2[before-defect] typed 4 reverts to old label 20DC', b2 === '20DC', `early=${JSON.stringify(b2Early)} settled=${JSON.stringify(b2)}`);

  // The "chọn lại" path in the buggy build: menu still shows the full list —
  // click 40HC anyway, then COMMIT the add and read what the DB persisted.
  await clickOption('40HC');
  await sleep(500);
  const b3 = await comboValue('Loại cont');
  log(`B3[before-defect] after clicking 40HC the add-row label reads: ${JSON.stringify(b3)}`);
  await shot('cus-3-after-pick40hc');
  await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm' && b.offsetParent !== null);
    if (!hit) throw new Error('Thêm button not found');
    hit.click();
  });
  await sleep(1500);
  await shot('cus-4-after-add');
  const bAfterAdd = await page.evaluate(() => ({
    alert: document.querySelector('[role="alert"]')?.textContent?.trim() ?? null,
    addRowOpen: Boolean(document.querySelector('input[aria-label="Số container"]')),
    bodyHasToast: [...document.querySelectorAll('[role="status"], .toast, [data-sonner-toast]')].map((el) => el.textContent?.trim()).filter(Boolean),
  }));
  log(`B3[before-defect] after Thêm: alert=${JSON.stringify(bAfterAdd.alert)} addRowOpen=${bAfterAdd.addRowOpen} toasts=${JSON.stringify(bAfterAdd.bodyHasToast)}`);
  const rowText = await page.evaluate((num) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(num));
    return row ? row.textContent?.replace(/\s+/g, ' ').trim() : null;
  }, QA_NUMBER);
  log(`B3[before-defect] ledger row after add: ${JSON.stringify(rowText)}`);
} else {
  check('B2[after-fix] typed 4 STAYS in the input', b2 === '4', `early=${JSON.stringify(b2Early)} settled=${JSON.stringify(b2)}`);

  // Step B3: pick 40HC and COMMIT the add → real persisted row.
  await clickOption('40HC');
  await sleep(400);
  const b3 = await comboValue('Loại cont');
  check('B3[after-fix] new pick 40HC replaces 20DC in the add row', b3 === '40HC', `input=${JSON.stringify(b3)}`);
  await shot('cus-3-picked40hc');

  await page.evaluate(() => {
    const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm' && b.offsetParent !== null);
    if (!hit) throw new Error('Thêm button not found');
    hit.click();
  });
  await page.waitForFunction(
    (num) => document.body.innerText.includes(num),
    { timeout: 20000 },
    QA_NUMBER,
  );
  await sleep(600);
  const rowText = await page.evaluate((num) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.textContent?.includes(num));
    return row ? row.textContent?.replace(/\s+/g, ' ').trim() : null;
  }, QA_NUMBER);
  check('B3[after-fix] ledger row lands and shows 40HC', rowText != null && rowText.includes('40HC'), `row=${JSON.stringify(rowText)}`);
  await shot('cus-4-added-row');
}

await browser.close();

// ── DB side-effect proof ───────────────────────────────────────────────────
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const rows = await sql`
  SELECT id, shipment_id, container_number, container_type_id
  FROM shipment_containers WHERE container_number LIKE 'SILQ152%' ORDER BY id`;
log(`DB shipment_containers (SIL152QA-*): ${JSON.stringify(rows)}`);
if (PHASE === 'after') {
  const row = rows.find((r) => r.container_number === QA_NUMBER);
  check('DB side-effect: added container committed container_type_id=40HC', row != null && row.container_type_id === TYPE_40HC,
    row ? `id=${row.id} shipment_id=${row.shipment_id} container_type_id=${row.container_type_id}` : 'row missing');
  check('DB identity: 20DC was replaced, not persisted', !rows.some((r) => r.container_number === QA_NUMBER && r.container_type_id === TYPE_20DC));
} else {
  const row = rows.find((r) => r.container_number === QA_NUMBER);
  // Before-phase context: the typing path is the defect (A2/A4); the MOUSE
  // pick still committed, so this add persisted the clicked 40HC. The
  // decisive after-phase proof is the RETYPE-driven add below.
  check('DB evidence (before): mouse-pick add persisted 40HC — the typing path was the broken leg', row != null && row.container_type_id === TYPE_40HC,
    row ? `id=${row.id} container_type_id=${row.container_type_id}` : 'no row');
}
await sql.end();

log(`phase=${PHASE} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
