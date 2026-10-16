// W4b verify — card 141026230700 (driver trip-end costs, TWO tables) — rung-3
// UI drive on STAGING (pin 9e400e63). Scenarios CP700-01..05 from
// testplan/2026-10-16-card141026230700-driver-chiphi-hai-bang.md.
//
//   EXPECT_BUILD=9e400e63 node testplan/qa/scripts/w4b-cp700-driver-ui.mjs
//
// Writes ONLY QA-marked cost rows (fee_name/note 'QA-W4B-…') so the sanctioned
// purge registry class (driver_incidental_costs scrub) can find them.
// Idempotency-Key: the SPA's own save path generates the UUID (hook contract).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const BASE = 'https://vantai.tingting.vip';
const API = BASE + '/api';
const PIN = process.env.EXPECT_BUILD || '9e400e63';
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-16_w4b-cp700_ui-driver.log');
const logLines = [];
const log = (line) => { logLines.push(line); console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-16_w4b-cp700_ui-${name}.png`), fullPage: true });

// 1×1 transparent PNG — a valid image is all the upload path needs.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const RECEIPT = '/tmp/w4b-qa-receipt.png';
fs.writeFileSync(RECEIPT, PNG);

async function login(identifier) {
  const res = await fetch(API + '/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) return null;
  return (await res.json()).token;
}

// ── Phase gate: health + build pin ──────────────────────────────────────────
const health = await fetch(API + '/health').then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} buildHash=${health?.buildHash} pin=${PIN}`);
if (health?.status !== 'ok' || health?.buildHash !== PIN) {
  log('ABORT: build pin mismatch or health not ok — do not drive on a foreign build.');
  process.exit(2);
}

const errors = [];
// Capture receipt-photo uploads (storageKeys) so cleanup can audit them.
const uploads = [];
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

// ── Pick driver + trip (house recipe: ask the API, never guess) ─────────────
let driverToken = null, driverName = null;
for (const c of ['bqhuong', 'btdung', 'vvtrung', 'tvtham']) {
  const t = await login(c);
  if (t) { driverToken = t; driverName = c; break; }
  log(`login miss: ${c}`);
}
if (!driverToken) { log('ABORT: no staging DRIVER account logged in.'); process.exit(2); }
log(`driver=${driverName}`);

const adminToken = await login('admin');
const trips = await fetch(API + '/driver/me/trips', { headers: { Authorization: `Bearer ${driverToken}` } })
  .then((r) => r.json()).then((j) => j.items || []).catch(() => []);
log(`driver trips: ${JSON.stringify(trips.map((t) => ({ id: t.id, status: t.status, shipmentId: t.shipmentId })))}`);

let target = null;
for (const t of trips.filter((x) => x.status !== 'CANCELED')) {
  const reason = [];
  if (!t.shipmentId) reason.push('no shipmentId');
  else if (adminToken) {
    const r = await fetch(`${API}/shipments/${t.shipmentId}`, { headers: { Authorization: `Bearer ${adminToken}` } });
    if (!r.ok) reason.push(`shipment ${t.shipmentId} -> ${r.status}`);
    else { const j = await r.json().catch(() => ({})); if (j.deletedAt) reason.push('shipment soft-deleted'); }
  }
  log(`  trip ${t.id}: ${reason.length ? reason.join('; ') : 'USABLE'}`);
  if (!reason.length) { target = t; break; }
}
if (!target) { log('ABORT: no usable driver trip (data precondition, not a verdict).'); await browser.close(); process.exit(3); }
const tripId = target.id;
log(`TARGET trip=${tripId} shipment=${target.shipmentId}`);

// Pre-existing cost census (for the before/after delta + cleanup audit).
const costsBefore = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, { headers: { Authorization: `Bearer ${driverToken}` } })
  .then((r) => r.json()).then((j) => j.items || []).catch(() => []);
log(`costs before: ${costsBefore.length} rows (system=${costsBefore.filter(c => ['ROAD_ALLOWANCE', 'LIFT_DROP_ZONE'].includes(c.costType)).length})`);

// ── Drive ───────────────────────────────────────────────────────────────────
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console.error: ${m.text().slice(0, 200)}`); });
// Receipt-photo uploads ride /api/upload — record the storageKeys for cleanup.
page.on('response', async (res) => {
  try {
    if (res.request().method() === 'POST' && /\/api\/upload$/.test(res.request().url())) {
      const body = await res.json().catch(() => null);
      if (body?.storageKey) uploads.push({ status: res.status(), storageKey: body.storageKey });
    }
  } catch { /* response body raced the navigation — ignore */ }
});
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), driverToken);
await page.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);

// CP700-01 — two tables always visible.
const cp700_01 = await page.evaluate(() => {
  const q = (sel) => [...document.querySelectorAll(sel)];
  const tables = q('.shipment-cost-entry__table');
  const info = tables.map((tb) => ({
    label: tb.getAttribute('aria-label'),
    title: tb.querySelector('h3')?.textContent?.trim(),
    empty: tb.querySelector('.shipment-cost-entry__empty')?.textContent?.trim() ?? null,
    rows: tb.querySelectorAll('li').length,
  }));
  return {
    sectionPresent: !!document.querySelector('.shipment-cost-entry'),
    h2: document.querySelector('.shipment-cost-entry__title')?.textContent?.trim() ?? null,
    tables: info,
    bothTitles: info.some((t) => t.title === 'Chi phí lô hàng') && info.some((t) => t.title === 'Tiền đường'),
  };
});
log('CP700-01 ' + JSON.stringify(cp700_01));
await shot(page, '01-trip-loaded');

// Open the draft form.
const opened = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /thêm chi phí/i.test(b.innerText || ''));
  if (!btn) return false;
  btn.click();
  return true;
});
await sleep(1200);
log(`draft form opened: ${opened}`);
if (!opened) { log('ABORT: no Thêm chi phí button — trip readOnly or section absent.'); await browser.close(); process.exit(3); }

// Add rows BEFORE filling (pin-test law): 3 rows total.
await page.evaluate(() => {
  const add = [...document.querySelectorAll('button')].find((b) => /thêm dòng/i.test(b.innerText || ''));
  add?.click();
});
await sleep(500);
await page.evaluate(() => {
  const add = [...document.querySelectorAll('button')].find((b) => /thêm dòng/i.test(b.innerText || ''));
  add?.click();
});
await sleep(800);

// CP700-02 — evidence ticks present; dropdown + typed invoice pair absent.
const cp700_02 = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.shipment-cost-entry__draft-row')];
  const first = rows[0];
  if (!first) return { rows: 0 };
  const ticks = first.querySelector('[role="group"][aria-label="Loại chứng từ"]');
  const tickButtons = ticks ? [...ticks.querySelectorAll('button')].map((b) => ({ text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') })) : [];
  const combos = [...first.querySelectorAll('[role="combobox"], select')].map((c) => (c.getAttribute('aria-label') || c.closest('label')?.innerText || '').trim());
  const rowText = first.innerText;
  return {
    rows: rows.length,
    ticksPresent: !!ticks,
    tickButtons,
    comboboxLabels: combos,
    noLoaiChungTuDropdown: !combos.some((l) => /loại chứng từ/i.test(l)),
    noSoHoaDonField: !/số hóa đơn/i.test(rowText),
    noNgayHoaDonField: !/ngày hóa đơn/i.test(rowText),
  };
});
log('CP700-02 ' + JSON.stringify(cp700_02));
await shot(page, '02-draft-rows-evidence-ticks');

// Read the option list of one row's Loại chi phí picker AND commit an option
// (committing is the only reliable way to close the React-Aria listbox — an
// outside click leaves it open, and Escape cancels the whole draft form).
async function pickOption(rowIndex, matchSource) {
  const opened = await page.evaluate((idx) => {
    const row = document.querySelectorAll('.shipment-cost-entry__draft-row')[idx - 1];
    if (!row) return null;
    const combo = row.querySelector('input[role="combobox"]');
    if (!combo) return null;
    combo.click();
    return true;
  }, rowIndex);
  await sleep(900);
  const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => (o.innerText || '').trim()).filter(Boolean));
  const clicked = await page.evaluate((src) => {
    const re = new RegExp(src, 'i');
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => re.test((o.innerText || '').trim()));
    if (!opt) return null;
    const label = (opt.innerText || '').trim();
    opt.click();
    return label;
  }, matchSource);
  await sleep(500);
  return { opened, options, clicked };
}

const lotPick = await pickOption(1, '^Phí nâng$');
log(`lot options (${lotPick.options.length}): ${JSON.stringify(lotPick.options)}; committed: ${JSON.stringify(lotPick.clicked)}`);

// CP700-03a — lot row without photo: save locked + reminder.
// Fill row 1 first: amount + note + evidence toggle INVOICE.
function fillRow(idx, amount, note) {
  return page.evaluate((args) => {
    const row = document.querySelectorAll('.shipment-cost-entry__draft-row')[args.idx - 1];
    if (!row) return 'no row';
    const findInput = (re) => [...row.querySelectorAll('input')].find((i) => re.test(`${i.getAttribute('aria-label') || ''} ${i.closest('label')?.innerText || ''} ${i.parentElement?.innerText || ''}`));
    const set = (input, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, val);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const amountInput = findInput(/thực chi/i);
    if (!amountInput) return 'no amount input';
    set(amountInput, args.amount);
    const noteInput = findInput(/ghi chú khoản chi/i);
    if (noteInput) set(noteInput, args.note);
    return 'ok';
  }, { idx, amount, note });
}
log('fill row1: ' + await fillRow(1, '12000', 'QA-W4B-CP700-1'));
await page.evaluate(() => {
  const row = document.querySelectorAll('.shipment-cost-entry__draft-row')[0];
  const inv = [...row.querySelectorAll('[role="group"][aria-label="Loại chứng từ"] button')].find((b) => /hóa đơn/i.test(b.textContent));
  inv?.click();
});
await sleep(400);
const blocked = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button[type="submit"]')].find((b) => /lưu tất cả/i.test(b.innerText || ''));
  const reminder = document.querySelector('[data-testid="shipment-cost-receipt-required"]');
  return {
    saveDisabled: save ? save.disabled : null,
    saveText: save?.innerText?.trim() ?? null,
    reminderShown: !!reminder,
    reminderText: reminder?.textContent?.trim() ?? null,
  };
});
log('CP700-03a ' + JSON.stringify(blocked));
await shot(page, '03-lot-blocked-no-receipt');

// Upload receipt photo for row 1, then row 2.
const fileInputs = await page.$$('.shipment-cost-entry__draft-row input[type="file"]');
log(`file inputs: ${fileInputs.length}`);
if (fileInputs[0]) {
  await fileInputs[0].uploadFile(RECEIPT);
  await page.waitForFunction(
    (src) => document.body.innerText.includes(src),
    { polling: 120, timeout: 30000 },
    'Ảnh sẽ gắn với khoản chi này',
  ).catch(() => log('WARN: row1 receipt preview not seen in 30s'));
  await sleep(800);
}
log('fill row2: ' + await fillRow(2, '8000', 'QA-W4B-CP700-2'));
const fileInputs2 = await page.$$('.shipment-cost-entry__draft-row input[type="file"]');
if (fileInputs2[1]) {
  await fileInputs2[1].uploadFile(RECEIPT);
  await page.waitForFunction(
    () => document.querySelectorAll('.shipment-cost-entry__receipt-preview').length >= 2,
    { polling: 120, timeout: 30000 },
  ).catch(() => log('WARN: row2 receipt preview not seen in 30s'));
  await sleep(800);
}

// Row 3 → road bucket. At 390px the Tabs render as-select: the visible trigger
// is a BUTTON (current value text), so click it and pick 'Tiền đường' from the
// listbox — there is no tab <button> to click at this width (house Tabs.tsx).
await page.evaluate(() => {
  const row = document.querySelectorAll('.shipment-cost-entry__draft-row')[2];
  const trigger = [...row.querySelectorAll('button')].find((b) => /^chi phí lô hàng$/i.test((b.innerText || '').trim()));
  trigger?.click();
});
await sleep(900);
await page.evaluate(() => {
  const opt = [...document.querySelectorAll('[role="option"]')].find((o) => /^tiền đường$/i.test((o.innerText || '').trim()));
  opt?.click();
});
await sleep(600);
const roadPick = await pickOption(3, '^Vé cầu đường$');
log(`road options (${roadPick.options.length}): ${JSON.stringify(roadPick.options)}; committed: ${JSON.stringify(roadPick.clicked)}`);
if (!roadPick.clicked) log('WARN: road option not committed — row 3 may still be a lot row');
log('fill row3: ' + await fillRow(3, '5000', 'QA-W4B-CP700-ROAD'));
const roadPicker = {
  hasDeadOption: roadPick.options.some((o) => /tiền tuyến đã thỏa thuận/i.test(o)),
  hasToll: roadPick.options.some((o) => /vé cầu đường/i.test(o)),
  normOptions: roadPick.options.filter((o) => /trả đêm|lưu ca|quá tải|phụ cấp/i.test(o)),
};
log('CP700-05 ' + JSON.stringify(roadPicker));
await shot(page, '04-three-rows-ready');

// CP700-03b — with photos, one Lưu tất cả for 3 rows.
const saveState = await page.evaluate(() => {
  const save = [...document.querySelectorAll('button[type="submit"]')].find((b) => /lưu tất cả/i.test(b.innerText || ''));
  return { disabled: save?.disabled ?? null, text: save?.innerText?.trim() ?? null };
});
log(`save state: ${JSON.stringify(saveState)}`);
if (saveState.disabled) {
  log('WARN: save still disabled — checking which row blocks:');
  const blockedRows = await page.evaluate(() => [...document.querySelectorAll('.shipment-cost-entry__draft-row')]
    .map((r, i) => ({ i: i + 1, reminder: r.querySelector('[data-testid="shipment-cost-receipt-required"]')?.textContent?.trim() ?? null })));
  log('blocked: ' + JSON.stringify(blockedRows));
}
await page.evaluate(() => {
  const save = [...document.querySelectorAll('button[type="submit"]')].find((b) => /lưu tất cả/i.test(b.innerText || ''));
  save?.click();
});
await page.waitForFunction(
  () => !document.querySelector('.shipment-cost-entry__form'),
  { polling: 120, timeout: 30000 },
).catch(() => log('WARN: draft form still open 30s after save click'));
await sleep(2500);
await shot(page, '05-after-save-all');

// Post-save: buckets + captions.
const after = await page.evaluate(() => {
  const tables = [...document.querySelectorAll('.shipment-cost-entry__table')];
  return tables.map((tb) => ({
    title: tb.querySelector('h3')?.textContent?.trim(),
    items: [...tb.querySelectorAll('li')].map((li) => ({
      name: li.querySelector('strong')?.textContent?.trim(),
      caption: [...li.querySelectorAll('.shipment-cost-entry__item-meta span')].map((s) => s.textContent.trim()),
      note: li.querySelector('.shipment-cost-entry__item-note')?.textContent?.trim() ?? null,
      systemNote: li.innerText.includes('Hệ thống tự ghi nhận'),
      hasCorrection: !!li.querySelector('button'),
    })),
  }));
});
log('AFTER-SAVE ' + JSON.stringify(after));

const costsAfter = await fetch(`${API}/driver/me/trips/${tripId}/incidental-costs`, { headers: { Authorization: `Bearer ${driverToken}` } })
  .then((r) => r.json()).then((j) => j.items || []).catch(() => []);
const qaNew = costsAfter.filter((c) => (c.note || '').startsWith('QA-W4B') || (c.feeName || '').startsWith('QA-W4B'));
log(`costs after: ${costsAfter.length} rows; QA-W4B new: ${JSON.stringify(qaNew.map((c) => ({ id: c.id, costType: c.costType, costGroup: c.costGroup, feeName: c.feeName, amount: c.amount, evidenceKind: c.evidenceKind, hasReceipt: !!c.receiptStorageKey, invoiceNumber: c.invoiceNumber })))}`);

// System rows view-only check (only if such rows exist on this trip).
const systemRows = costsAfter.filter((c) => c.costType === 'ROAD_ALLOWANCE' || c.costType === 'LIFT_DROP_ZONE');
log(`system rows present: ${systemRows.length} (${systemRows.map((r) => r.costType).join(',') || 'none'})`);

log('PAGE-ERRORS ' + JSON.stringify(errors));
log('UPLOADS ' + JSON.stringify(uploads));
await browser.close();
log('DONE driver=' + driverName + ' trip=' + tripId + ' qaRowsCreated=' + qaNew.length);
