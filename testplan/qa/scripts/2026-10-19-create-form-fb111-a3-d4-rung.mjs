// FB-111 + 181026200100/200200/200700 (create-form card, 2026-10-19) —
// /shipments/new fresh-tab rung:
//   A.3  Nhận diện lô reads Số Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu
//   D.4  hàng lẻ: ONE always-visible "Ngày giao hàng" field, NO add button
//   FB-111  "Thêm container" ×3: rows 2/3/4 copy row 1 (Loại cont stays),
//           Số container stays empty
// LOCAL ONLY: vite 7175 → api 3002. Role CUS (tiepvv). Exit 0 = all rungs PASS.
//   node testplan/qa/scripts/2026-10-19-create-form-fb111-a3-d4-rung.mjs

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? 'qa';
fs.mkdirSync(SHOTS, { recursive: true });
const TAG = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function login(identifier) {
  for (let i = 1; i <= 3; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Abc123' }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.token) return json;
    await sleep(1500 * i);
  }
  return null;
}

// Card asks for tiepvv; testaccounts.txt rule: "the QA harness walk the list
// when a login misses" — tiepvv is prod-mirror-only on this dev-seed DB, so
// fall through the CUS list in the documented order (same CUS role).
let session = null;
let who = process.env.QA_USER ?? 'tiepvv';
for (const candidate of [who, 'thanhdc', 'cus']) {
  session = await login(candidate);
  if (session) { who = candidate; break; }
  console.log(`login miss: ${candidate}`);
}
if (!session) throw new Error('no CUS account logged in');
console.log(`logged in as ${session.user?.username} (${session.user?.role}) · tag ${TAG}`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), session.token);

const shot = async (name) => {
  await sleep(700);
  const path = `${SHOTS}/2026-10-19_create-form_${name}.png`;
  await page.screenshot({ path });
  console.log(`shot → ${path}`);
  return path;
};

try {
  // ── Fresh tab: /shipments/new ────────────────────────────────────────────
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-field-id="shipment-booking-ref"]', { timeout: 45000 });
  await sleep(1500);

  // ── Rung 1 (A.3): identity order Số Bill/Booking → Số tờ khai → Nhập/Xuất → Hãng tàu
  const order = await page.evaluate(() => {
    const ids = ['shipment-booking-ref', 'shipment-declarations', 'shipment-trade-direction', 'shipment-shipping-line'];
    const nodes = ids.map((id) => document.querySelector(`[data-field-id="${id}"]`));
    if (nodes.some((n) => !n)) return { ok: false, missing: ids.filter((_, i) => !nodes[i]) };
    let ok = true;
    for (let i = 0; i < nodes.length - 1; i++) {
      if (!(nodes[i].compareDocumentPosition(nodes[i + 1]) & Node.DOCUMENT_POSITION_FOLLOWING)) ok = false;
    }
    const labels = nodes.map((n) => (n.innerText || '').split('\n')[0].trim());
    return { ok, labels };
  });
  record('A3-order', order.ok === true ? 'PASS' : 'FAIL', `DOM chain booking → tờ khai → nhập/xuất → hãng tàu: ${JSON.stringify(order.labels ?? order)}`);
  const identity = await page.$('.csc-form');
  await identity.screenshot({ path: `${SHOTS}/2026-10-19_create-form_a3-identity-order.png` });
  console.log('shot → qa/2026-10-19_create-form_a3-identity-order.png');

  // ── Rung 2 (D.4): hàng lẻ — one visible field, no add button ────────────
  await page.evaluate(() => {
    const radio = [...document.querySelectorAll('input[name="cargo-mode"]')].find((r) => r.value === 'LCL');
    radio.click();
  });
  await page.waitForFunction(() => document.getElementById('shipment-expected-delivery') !== null, { timeout: 30000 });
  await sleep(800);
  const d4 = await page.evaluate(() => ({
    addButton: [...document.querySelectorAll('button')].some((b) => (b.innerText || '').includes('Thêm ngày giao hàng')),
    fields: document.querySelectorAll('#shipment-expected-delivery').length,
    extraLabel: [...document.querySelectorAll('label')].some((l) => (l.innerText || '').includes('Ngày giao bổ sung')),
    dateValue: document.getElementById('shipment-expected-delivery')?.value ?? null,
  }));
  record('D4-single-field', d4.addButton === false && d4.fields === 1 && d4.extraLabel === false ? 'PASS' : 'FAIL',
    `add-button=${d4.addButton} fields=${d4.fields} extra-label=${d4.extraLabel}`);
  const lclBlock = await page.$('[data-field-id="shipment-expected-delivery"]');
  await lclBlock.screenshot({ path: `${SHOTS}/2026-10-19_create-form_d4-single-delivery-field.png` });
  console.log('shot → qa/2026-10-19_create-form_d4-single-delivery-field.png');

  // ── Rung 3 (FB-111): fresh state, fill row 1, add 3, rows 2/3/4 copy ────
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-field-id="shipment-booking-ref"]', { timeout: 45000 });
  await sleep(1500);

  // Pick Loại container on row 1: open the combobox, click the 40DC option
  // when the catalog offers it, else the first option.
  const pickedType = await page.evaluate(() => {
    const combo = [...document.querySelectorAll('[role="combobox"]')].find((c) => (c.getAttribute('aria-label') || '').startsWith('Loại container'));
    if (!combo) return { ok: false, why: 'no Loại container combobox' };
    combo.focus();
    return { ok: true };
  });
  if (!pickedType.ok) throw new Error(pickedType.why);
  await page.keyboard.press('ArrowDown');
  await page.waitForFunction(() => document.querySelector('[role="option"]') !== null, { timeout: 15000 });
  const chosen = await page.evaluate(() => {
    const options = [...document.querySelectorAll('[role="option"]')];
    const pick = options.find((o) => /40DC/.test(o.innerText)) ?? options[0];
    const text = (pick.innerText || '').trim().split('\n')[0];
    pick.click();
    return text;
  });
  await sleep(500);
  console.log(`row 1 Loại container → ${chosen}`);

  // Weight on row 1 (a copy-provable second field).
  await page.evaluate(() => {
    const input = document.querySelector('table input[aria-label="Trọng lượng (kg)"]');
    if (!input) throw new Error('no Trọng lượng input');
    input.focus();
  });
  await page.keyboard.type('12000');
  await sleep(300);

  // Appointment day+hour on row 1 (segmented dd/mm/yyyy + hh:mm).
  for (const [label, value] of [['Ngày — Ngày giờ đóng trả', '20082026'], ['Giờ — Ngày giờ đóng trả', '0930']]) {
    await page.evaluate((lbl) => {
      const seg = [...document.querySelectorAll('input')].find((i) => (i.getAttribute('aria-label') || '') === lbl);
      if (!seg) throw new Error(`no segment ${lbl}`);
      seg.focus();
    }, label);
    await page.keyboard.type(value, { delay: 40 });
  }
  await sleep(300);

  // Add 3 rows.
  await page.evaluate(() => {
    const count = document.getElementById('container-add-count');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(count, '3');
    count.dispatchEvent(new Event('input', { bubbles: true }));
    count.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.innerText || '').includes('Thêm container'));
    btn.click();
  });
  await page.waitForFunction(() => document.querySelectorAll('input[aria-label="Số container"], input[id$="-number"]').length >= 4, { timeout: 15000 })
    .catch(async () => {
      // fall back to label-text count via evaluate below
      await sleep(800);
    });
  await sleep(800);

  const copied = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table.csc-container-table tbody tr')];
    return rows.map((tr) => ({
      number: tr.querySelector('input[aria-label="Số container"]')?.value ?? null,
      displays: [...tr.querySelectorAll('.csc-container-cell__display')].map((d) => (d.innerText || '').trim()),
      weight: tr.querySelector('input[aria-label="Trọng lượng (kg)"]')?.value ?? null,
    }));
  });
  const dataRows = copied.filter(Boolean);
  const typeOk = dataRows.length === 4 && dataRows.every((r) => r.displays.some((d) => d === chosen));
  const weightOk = dataRows.every((r) => r.weight === '12000');
  const numbersBlank = dataRows.every((r) => r.number === '');
  record('FB111-copy', typeOk && weightOk && numbersBlank ? 'PASS' : 'FAIL',
    `4 rows · type "${chosen}" on every row=${typeOk} · weight 12000 everywhere=${weightOk} · số container all blank=${numbersBlank}`);
  const table = await page.$('.csc-container-editor');
  await table.screenshot({ path: `${SHOTS}/2026-10-19_create-form_fb111-copy-3-rows.png` });
  console.log('shot → qa/2026-10-19_create-form_fb111-copy-3-rows.png');

  await browser.close();
  const failed = results.filter((r) => r.verdict !== 'PASS');
  console.log(`\n${results.length - failed.length}/${results.length} rungs PASS${failed.length ? ` — FAILED: ${failed.map((f) => f.rung).join(', ')}` : ''}`);
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  console.error('RUNG ERROR:', error.message);
  await shot('error-state').catch(() => {});
  await browser.close();
  process.exit(2);
}
