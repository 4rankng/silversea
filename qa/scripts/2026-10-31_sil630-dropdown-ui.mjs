// SIL-630 (id 734) — rung-3 driver: dropdown LOẠI CONTAINER commits DC as RF.
// Surface: create workspace /shipments/new — FCL container row, the
// GroupFloatingLine LOẠI editor hosting ContainerTypeCellPicker
// (USearchableField openOnType). Phases: before (trunk defect evidence) /
// after (fix green). Id-based proof: every [role=option] carries
// data-value=<catalog id> (SelectItem data-value), so the dump pins what the
// menu SHOWED versus what id the pick committed; the save round-trip pins the
// persisted side (shipment_containers.container_type_id).
//   node qa/scripts/2026-10-31_sil630-dropdown-ui.mjs before|after
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const PHASE = process.argv[2];
if (PHASE !== 'before' && PHASE !== 'after') {
  console.error('usage: node qa/scripts/2026-10-31_sil630-dropdown-ui.mjs before|after');
  process.exit(2);
}
const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3003/api';
const STAGING = FRONT.includes('tingting.vip');
// container_types catalog in local dev (verified pre-run, read-only psql):
// 1=20DC 2=20HC 3=40DC 4=40HC 5=40RF 6=20RF 7=45HC 8=20OT.
const TYPE_20DC = 1;
const TYPE_20RF = 6;
const CONTAINER_BASE = 'SILQ630000'; // 4 letters + 6 digits + computed check digit

const OUT = path.resolve(`qa/2026-10-31_sil630/${PHASE}`);
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ISO 6346 check digit (server gate, shared/src iso6346): letter values run
// A=10 upward skipping multiples of 11; sum(value × 2^i) mod 11 mod 10.
const iso6346Check = (base10) => {
  const values = { ...Object.fromEntries('0123456789'.split('').map((d) => [d, Number(d)])) };
  let v = 10;
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
    while (v % 11 === 0) v += 1;
    values[ch] = v; v += 1;
  }
  const sum = [...base10].reduce((acc, ch, i) => acc + values[ch] * 2 ** i, 0);
  return String((sum % 11) % 10);
};
const CONTAINER_NO = CONTAINER_BASE + iso6346Check(CONTAINER_BASE);
const BILL_NO = `SIL630QA-${Date.now()}`;

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`phase=${PHASE} front=${FRONT} api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: API health not ok'); process.exit(2); }
// testplan/testaccounts.txt — local dev CUS intake (cus / Abc123);
// staging CUS (thanhdc / Abc123) — the `cus` demo account 401s there.
let who = null;
for (const candidate of STAGING ? ['thanhdc'] : ['cus', 'dungnv']) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: candidate, password: 'Abc123' }),
  }).then((r) => r.json());
  if (res?.token) { who = candidate; var token = res.token; break; }
}
if (!who) { log('ABORT: login failed (cus + dungnv)'); process.exit(2); }
log(`login ok (${who})`);

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = (name) => page.screenshot({ path: path.join(OUT, `ui-${name}.png`) });

const readMenuOptions = () => page.evaluate(() => {
  const listbox = document.querySelector('[role="listbox"]');
  if (!listbox) return { open: false, options: [] };
  return {
    open: true,
    options: [...listbox.querySelectorAll('[role="option"]')]
      .filter((el) => (el instanceof HTMLElement) && el.offsetParent !== null)
      .map((el) => ({ text: el.textContent?.trim() ?? '', dataValue: el.getAttribute('data-value') })),
  };
});
const clickMenuOption = async (wanted) => {
  const ok = await page.evaluate((label) => {
    const listbox = document.querySelector('[role="listbox"]');
    if (!listbox) return false;
    const visible = [...listbox.querySelectorAll('[role="option"]')]
      .filter((el) => el instanceof HTMLElement && el.offsetParent !== null);
    const hit = visible.find((el) => el.textContent?.trim() === label)
      ?? visible.find((el) => el.textContent?.trim()?.startsWith(label))
      ?? visible.find((el) => el.textContent?.trim()?.includes(label));
    if (!hit) return false;
    hit.click();
    return true;
  }, wanted);
  if (!ok) throw new Error(`option not clickable: ${wanted}`);
};
const pickSearchable = async (ariaLabel, typed, optionLabel) => {
  await page.click(`input[aria-label="${ariaLabel}"]`);
  await sleep(300);
  log(`pickSearchable(${ariaLabel}) unfiltered menu: ${JSON.stringify((await readMenuOptions()).options)}`);
  await page.keyboard.type(typed);
  await sleep(700);
  try {
    await clickMenuOption(optionLabel);
  } catch (err) {
    const dump = await readMenuOptions();
    log(`pickSearchable(${ariaLabel}, ${typed}) failed — menu=${JSON.stringify(dump)}`);
    throw err;
  }
  await sleep(300);
};

log('— surface: /shipments/new (create workspace, ContainerTypeCellPicker)');
await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
try {
  await page.waitForSelector('input[aria-label="Số container"]', { timeout: 30000 });
} catch {
  log('ABORT: create form did not render (role gate?)');
  await shot('abort-page');
  process.exit(2);
}
// SỐ CONTAINER first (Tab hand-off opens the LOẠI editor + its menu — the
// 20261002_272 law; the operator's normal path).
await page.type('input[aria-label="Số container"]', CONTAINER_NO);
await page.keyboard.press('Tab');
await sleep(600);
const menuDump = await readMenuOptions();
log(`menu dump (after Tab-open): ${JSON.stringify(menuDump.options)}`);
await shot('1-menu-open-dump');
const dcOption = menuDump.options.find((o) => o.text === '20DC');
check('menu shows 20DC with data-value=1 (catalog id)', dcOption?.dataValue === String(TYPE_20DC),
  `found=${JSON.stringify(dcOption)}`);

// THE ticket pick: click 20DC.
await clickMenuOption('20DC');
await sleep(500);
const after = await page.evaluate(() => ({
  input: document.querySelector('input[aria-label="Loại container"]')?.value ?? null,
  ghost: document.querySelector('[data-field-id$="-type"] .csc-fline__value')?.textContent?.trim() ?? null,
}));
await shot('2-after-pick-20dc');
check('input shows 20DC right after the pick', after.input === '20DC', `input=${JSON.stringify(after.input)}`);
check('cell (ghost line) shows 20DC right after the pick', after.ghost === '20DC', `ghost=${JSON.stringify(after.ghost)}`);
if (PHASE === 'before') {
  log(`[before] display evidence: input=${JSON.stringify(after.input)} ghost=${JSON.stringify(after.ghost)}`);
}

// Identity band. USearchableField does not forward `id` to the input — the
// wrappers carry data-field-id, so target inputs through them.
await page.click('[data-field-id="shipment-customer"] input');
await sleep(200);
await page.keyboard.type('LONG MINH');
await sleep(700);
{
  const opts = (await readMenuOptions()).options.filter((o) => o.dataValue !== '__create__');
  if (opts.length === 0) throw new Error('no customer options');
  await clickMenuOption(opts[0].text); // first catalog customer on this env
}
await sleep(300);
// Hình thức XNK — React Aria select trigger inside its data-field wrapper.
await page.click('[data-field-id="shipment-trade-direction"] button');
await sleep(300);
await clickMenuOption('Nhập khẩu');
await sleep(300);
await page.type('[data-field-id="shipment-booking-ref"] input', BILL_NO);

// Row: nhà máy / tuyến / cảng / giờ hẹn.
{
  await page.click('input[aria-label="Nhà máy"]');
  await sleep(400);
  const opts = (await readMenuOptions()).options.filter((o) => o.dataValue !== '__create__');
  if (opts.length === 0) throw new Error('no factory options');
  log(`factory menu: ${JSON.stringify(opts)}`);
  await clickMenuOption(opts[0].text);
  await sleep(300);
}
const routeDisabled = await page.evaluate(() => {
  const el = document.querySelector('input[aria-label="Tuyến đường"]');
  return el ? el.disabled : null;
});
if (routeDisabled === false) {
  await page.click('input[aria-label="Tuyến đường"]');
  await sleep(400);
  const ropts = (await readMenuOptions()).options.filter((o) => o.dataValue !== '__create__');
  if (ropts.length > 0) { await clickMenuOption(ropts[0].text); await sleep(300); }
}
for (const portLabel of ['Cảng nâng', 'Cảng hạ']) {
  await page.click(`input[aria-label="${portLabel}"]`);
  await sleep(400);
  const popts = (await readMenuOptions()).options.filter((o) => o.dataValue !== '__create__');
  if (popts.length === 0) throw new Error(`no options for ${portLabel}`);
  await clickMenuOption(popts[0].text);
  await sleep(300);
}
// Appointment — value-first cell: a click on the CELL (activateCell)
// reveals + focuses the segment editor.
await page.evaluate(() => {
  const cell = [...document.querySelectorAll('[data-field-id$="-customer-appointment"]')][0];
  cell?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(500);
const seg = await page.$('[data-field-id$="-customer-appointment"] input[aria-label^="Ngày"]');
if (!seg) { log('FAIL appointment segment input not visible'); failures += 1; }
else {
  await seg.click();
  await page.keyboard.type('31102026'); // auto-advance: dd→mm→yyyy→(giờ)
  await sleep(200);
  await page.keyboard.type('2359');      // giờ→phút
  await sleep(200);
  const appt = await page.evaluate(() => {
    const cell = [...document.querySelectorAll('[data-field-id$="-customer-appointment"]')][0];
    return [...(cell?.querySelectorAll('input') ?? [])].map((el) => el.value).filter(Boolean).join(' ');
  });
  log(`appointment segments: ${JSON.stringify(appt)}`);
  check('appointment segments filled', appt.includes('31') && appt.includes('2026'), `values=${JSON.stringify(appt)}`);
}
// NO Escape here — a split control's Escape reverts its draft to the value
// at focus (empty). Blur by clicking a neutral surface instead.
await page.click('h1, .csc-topline, header').catch(() => {});
await sleep(300);
await shot('3-filled-before-save');

// Save (full CREATE intent).
await page.evaluate(() => {
  const hit = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tạo lô hàng' && b.offsetParent !== null);
  if (!hit) throw new Error('Tạo lô hàng button not found');
  hit.click();
});
await sleep(3000);
await shot('4-after-save');
const savedShipmentId = Number((/\/shipments\/(\d+)/.exec(page.url()) ?? [])[1] ?? 0);
const postSave = await page.evaluate(() => ({
  url: location.href,
  alerts: [...document.querySelectorAll('[role="alert"], [role="status"]')].map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 5),
}));
log(`after save: url=${postSave.url} alerts=${JSON.stringify(postSave.alerts)}`);

await browser.close();

// ── DB side-effect proof (local: psql; staging: lot detail API) ────────────
let row = null; let rows = [];
if (STAGING) {
  const detail = await fetch(`${API}/shipments/${savedShipmentId}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  log(`staging lot ${savedShipmentId} detail: ${JSON.stringify(detail).slice(0, 400)}`);
  const containers = detail?.containers ?? [];
  const found = containers.find((c) => (c.containerNumber ?? c.container_number) === CONTAINER_NO);
  if (found) {
    row = { container_type_id: found.containerTypeId ?? found.container_type_id };
    rows = [row];
  }
  log(`staging container row: ${JSON.stringify(row)} (catalog: 20DC=1, 20RF=6)`);
} else {
  const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
  rows = await sql`
    SELECT sc.id, sc.shipment_id, s.shipment_code, sc.container_number, sc.container_type_id, ct.code AS type_code
    FROM shipment_containers sc
    JOIN shipments s ON s.id = sc.shipment_id
    LEFT JOIN container_types ct ON ct.id = sc.container_type_id
    WHERE sc.container_number = ${CONTAINER_NO} ORDER BY sc.id DESC`;
  await sql.end();
  row = rows[0];
}
log(`DB shipment_containers (${CONTAINER_NO}): ${JSON.stringify(rows)}`);
if (PHASE === 'before') {
  // The ticket's defect: the pick of 20DC lands as 20RF. The display evidence
  // above + the persisted id together name the layer.
  if (row != null && row.container_type_id === TYPE_20RF) {
    check('REPRODUCED: picked 20DC persisted as 20RF', true, `container_type_id=${row.container_type_id}`);
  } else if (row != null && row.container_type_id === TYPE_20DC) {
    check('NOT reproduced on this build: 20DC persisted correctly', true, `container_type_id=${row.container_type_id}`);
  } else {
    check('save landed', row != null, row ? `container_type_id=${row.container_type_id}` : 'row missing (save failed?)');
  }
} else {
  check('picked 20DC persisted as 20DC', row != null && row.container_type_id === TYPE_20DC,
    row ? `container_type_id=${row.container_type_id} code=${row.type_code}` : 'row missing');
  check('20RF never persisted', !rows.some((r) => r.container_type_id === TYPE_20RF), '');
}
log(`phase=${PHASE} failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
