// SIL-521 UI drive — Số tờ khai theo cont (owner 26/10).
//
// Surfaces: form tạo lô (/shipments/new) + Tổng quan containers
// (/shipments-detail). CUS `thanhdc` (Abc123, local dev seed).
//   A. Form tạo lô KHÔNG còn chỗ nhập Số tờ khai cấp lô (strip/input absent).
//   B. Per-cont edit tại Tổng quan: cont1 = TK521A; cont2 = CÙNG TK521A
//      (trùng toàn bộ trong 1 lô — lưu OK, không 409); cont2 sửa TK521B —
//      cont1 GIỮ NGUYÊN TK521A (sửa từng cont, không normalize lot-wide).
//   C. DB side-effect qua API GET /shipments/cus-workspace/:id sau mỗi bước.
// Read-only đối với data có sẵn: chỉ đụng lot mới tạo riêng cho drive.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-27-sil521-tokhai-percont-ui-drive.mjs
// Output: qa/2026-10-27_sil521-tokhai/*.png + assertions JSON + driver log.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const API = process.env.QA_API_URL || 'http://localhost:3002/api';
const OUT = resolve(process.cwd(), '../qa/2026-10-27_sil521-tokhai');
mkdirSync(OUT, { recursive: true });
const log = [];
const assertions = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

function assert(name, ok, detail) {
  assertions.push({ name, ok: Boolean(ok), detail: detail ?? null });
  log.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail != null ? ` — ${JSON.stringify(detail)}` : ''}`);
  if (!ok) process.exitCode = 1;
}

// ISO 6346 check digit for an owner code + serial (10 chars).
function iso6346CheckDigit(ten) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const map = new Map();
  let value = 10;
  for (const ch of alphabet) { map.set(ch, value); value += value % 11 === 0 ? 2 : 1; }
  let sum = 0;
  [...ten].forEach((ch, i) => { sum += (map.get(ch) ?? Number(ch)) * 2 ** i; });
  const rem = sum % 11;
  return rem === 10 ? 0 : rem;
}
const CONT1 = `MSKU521000${iso6346CheckDigit('MSKU521000')}`;
const CONT2 = `MSKU521001${iso6346CheckDigit('MSKU521001')}`;
const BL = `BL-SIL521-${Date.now().toString().slice(-8)}`;
// Per-run unique declaration values — the per-cont write keeps the CROSS-lot
// guard (409 when another active lot holds the number), so a leftover from a
// previous drive run must never collide with this one.
const RUN = Date.now().toString().slice(-5);
const D1 = `TK521A${RUN}`;
const D2 = `TK521B${RUN}`;

// ─── API setup: login + create the drive lot (NO lot-level declaration) ────
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
const { token } = await loginRes.json();
assert('api login thanhdc (CUS)', Boolean(token));
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const boot = await (await fetch(`${API}/catalogs/bootstrap`, { headers: auth })).json();
const customerId = boot.customers[0].id;
const containerType = boot.containerTypes.find((t) => /20DC/i.test(`${t.code} ${t.name}`)) ?? boot.containerTypes[0];
assert('bootstrap container type', Boolean(containerType), containerType?.code ?? null);
const container = (number) => ({ containerNumber: number, containerTypeId: containerType.id });
const createRes = await fetch(`${API}/shipments/quick`, {
  method: 'POST',
  headers: { ...auth, 'Idempotency-Key': `sil521-drive-${stamp}` },
  body: JSON.stringify({
    customerId,
    cargoMode: 'FCL',
    tradeDirection: 'IMPORT',
    blNumber: BL,
    containers: [container(CONT1), container(CONT2)],
  }),
});
const created = await createRes.json().catch(() => ({}));
if (createRes.status !== 201) {
  log.push(`CREATE FAILED ${createRes.status} ${JSON.stringify(created).slice(0, 400)}`);
  writeFileSync(resolve(OUT, 'ui-driver.log'), `${log.join('\n')}\nEXIT=1\n`);
  console.error(log.join('\n'));
  process.exit(1);
}
assert('create response carries NO initialDeclarationId (SIL-521 wire)', !('initialDeclarationId' in created));
assert('create payload left containers WITHOUT declaration', (created.containers ?? []).every((c) => c.declarationNumber == null));
const lotId = created.id;
log.push(`lot id=${lotId} BL=${BL} conts=${CONT1},${CONT2}`);

const lotDetail = async () => (await (await fetch(`${API}/shipments/cus-workspace/${lotId}`, { headers: auth })).json());
const declOf = (d) => Object.fromEntries((d.containers ?? []).map((c) => [c.containerNumber, c.declarationNumber ?? null]));

// ─── Browser: form login like the real user ────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'thanhdc');
await page.type('input[name="password"]', 'Abc123');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !window.location.href.includes('login'), { timeout: 45000 });
assert('browser login thanhdc', true, { url: page.url() });

// ─── A. Form tạo lô: hết chỗ nhập Số tờ khai cấp lô ─────────────────────────
for (const [w, h, tag] of [[1440, 900, '1440'], [390, 844, '390']]) {
  await page.setViewport({ width: w, height: h });
  await page.goto(`${FE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('#shipment-section-identity', { timeout: 45000 });
  await sleep(600);
  const form = await page.evaluate(() => ({
    declInput: Boolean(document.querySelector('#shipment-section-identity input[aria-label="Số tờ khai"], #shipment-section-identity input[maxlength="50"][inputmode="numeric"]')),
    strip: Boolean(document.querySelector('.csc-declaration-strip')),
    fieldId: Boolean(document.querySelector('[data-field-id="shipment-declarations"]')),
    bulk: [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Sửa hàng loạt'),
    customer: [...document.querySelectorAll('#shipment-section-identity label, #shipment-section-identity span')].some((n) => n.textContent.trim().startsWith('Khách hàng')),
  }));
  assert(`create form ${tag}: NO Số tờ khai input`, !form.declInput);
  assert(`create form ${tag}: NO declaration strip`, !form.strip && !form.fieldId && !form.bulk);
  assert(`create form ${tag}: identity section renders`, form.customer);
  await page.screenshot({ path: resolve(OUT, `sil521-create-form-${tag}.png`), fullPage: false });
}

// ─── B. Tổng quan: per-cont edit + trùng toàn bộ + divergence ───────────────
// searchSuffix is a SUFFIX match — the BL tail is unique per run AND matches
// the lot (so BOTH container rows render, unlike a container-number tail).
// dateScope=all: the board defaults a today-window filter — the fresh drive
// lot has no transport date yet; the same param the workboard's own factory
// links use to include undated containers. Re-navigating before each step
// keeps the board state deterministic (a save reloads the list and can
// reshuffle rows).
const LEDGER_URL = `${FE}/shipments-detail?searchSuffix=${encodeURIComponent(BL.slice(-6))}&dateScope=all`;
const openLedger = async () => {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(LEDGER_URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-container-ledger table tbody tr', { timeout: 45000 });
  await sleep(800);
};
await openLedger();

const rowFor = (cont) => `[data-label="Số container"]`;
const findRow = (cont) => page.evaluateHandle((needle) => (
  [...document.querySelectorAll('.shipment-container-ledger table tbody tr')]
    .find((tr) => tr.textContent.includes(needle))
), cont);

async function editDeclaration(cont, value, tag) {
  // DOM-level interactions (the React handlers fire identically to a real
  // press; a coordinate click can land under the sticky toolbar). The
  // documents mode renders the expanded class on ALL FOUR of its cells —
  // scope to the wrapper that actually carries the Số tờ khai input.
  const clicked = await page.evaluate((needle) => {
    const tr = [...document.querySelectorAll('.shipment-container-ledger table tbody tr')]
      .find((r) => r.textContent.includes(needle));
    if (!tr) return 'row-missing';
    const btn = tr.querySelector('button[data-cell-label="Số tờ khai"]');
    if (!btn) return 'trigger-missing';
    btn.click();
    return 'clicked';
  }, cont);
  assert(`trigger click (${tag})`, clicked === 'clicked', clicked);
  try {
    await page.waitForFunction(() => [...document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded')]
      .some((w) => [...w.querySelectorAll('label')].some((l) => l.textContent.includes('Số tờ khai'))), { timeout: 20000 });
  } catch {
    const diag = await page.evaluate((needle) => ({
      expanded: document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded').length,
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 100)),
      myRowIndex: [...document.querySelectorAll('.shipment-container-ledger table tbody tr')].findIndex((r) => r.textContent.includes(needle)),
    }), cont);
    await page.screenshot({ path: resolve(OUT, `sil521-debug-timeout-${tag}.png`) });
    throw new Error(`editor did not open (${tag}): ${JSON.stringify(diag)}`);
  }
  await sleep(300);
  await page.screenshot({ path: resolve(OUT, `sil521-editor-open-${tag}.png`) });
  const set = await page.evaluate((v) => {
    const wrapper = [...document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded')]
      .find((w) => [...w.querySelectorAll('label')].some((l) => l.textContent.includes('Số tờ khai')));
    const input = [...wrapper.querySelectorAll('label')].find((l) => l.textContent.includes('Số tờ khai'))?.querySelector('input');
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, value);
  assert(`editor input Số tờ khai reachable (${tag})`, set);
  await page.evaluate(() => {
    const wrapper = [...document.querySelectorAll('.shipment-container-ledger__cell-editor--expanded')]
      .find((w) => [...w.querySelectorAll('label')].some((l) => l.textContent.includes('Số tờ khai')));
    [...wrapper.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') ?? '').startsWith('Lưu'))?.click();
  });
  // The ledger keeps the editor open after a successful save (consecutive
  // edits) and reloads the list — the REAL success signal is the row's cell
  // showing the new number. Wait for that, then Escape to a clean state.
  try {
    await page.waitForFunction((needleValue) => [...document.querySelectorAll('.shipment-container-ledger table tbody tr')]
      .some((tr) => tr.textContent.includes(needleValue.row)
        && (tr.querySelector('td[data-label="Số tờ khai"]')?.textContent ?? '').includes(needleValue.value)), { timeout: 30000 }, { row: cont, value });
  } catch {
    const diag = await page.evaluate((needle) => ({
      alerts: [...document.querySelectorAll('[role="alert"]')].map((a) => a.textContent.slice(0, 160)),
      rowFound: [...document.querySelectorAll('.shipment-container-ledger table tbody tr')].some((r) => r.textContent.includes(needle)),
    }), cont);
    await page.screenshot({ path: resolve(OUT, `sil521-debug-save-${tag}.png`) });
    throw new Error(`cell did not update after save (${tag}): ${JSON.stringify(diag)}`);
  }
  await sleep(600);
  const alert = await page.evaluate(() => Boolean(document.querySelector('[role="alert"]')));
  assert(`no error alert after save (${tag})`, !alert);
  await page.screenshot({ path: resolve(OUT, `sil521-after-save-${tag}.png`) });
  // Escape closes the (now clean) editor for the next step.
  await page.keyboard.press('Escape');
  await sleep(400);
}

const cellText = async (cont) => page.evaluate((needle) => {
  const tr = [...document.querySelectorAll('.shipment-container-ledger table tbody tr')]
    .find((r) => r.textContent.includes(needle));
  return tr?.querySelector('td[data-label="Số tờ khai"]')?.textContent?.trim() ?? null;
}, cont);

// cont1 = TK521A
await openLedger();
await editDeclaration(CONT1, D1, 'cont1-tk521a');
assert('cont1 cell shows TK521A', (await cellText(CONT1))?.includes(D1), { cell: await cellText(CONT1) });
let decls = declOf(await lotDetail());
assert('DB: cont1 = D1', decls[CONT1] === D1, decls);

// cont2 = TK521A (TRÙNG TOÀN BỘ trong cùng lô — phải lưu OK, không 409)
await openLedger();
await editDeclaration(CONT2, D1, 'cont2-dup-tk521a');
assert('cont2 cell shows TK521A (duplicate saved)', (await cellText(CONT2))?.includes(D1), { cell: await cellText(CONT2) });
decls = declOf(await lotDetail());
assert('DB: cả 2 cont cùng TK521A — trùng toàn bộ lưu được', decls[CONT1] === D1 && decls[CONT2] === D1, decls);

// cont2 → TK521B: sửa TỪNG cont; cont1 giữ nguyên (không normalize)
await openLedger();
await editDeclaration(CONT2, D2, 'cont2-tk521b');
assert('cont2 cell shows TK521B', (await cellText(CONT2))?.includes(D2), { cell: await cellText(CONT2) });
assert('cont1 cell STILL TK521A (divergence giữ nguyên)', (await cellText(CONT1))?.includes(D1), { cell: await cellText(CONT1) });
decls = declOf(await lotDetail());
assert('DB: lô 2 tờ khai khác nhau [TK521A, TK521B]', decls[CONT1] === D1 && decls[CONT2] === D2, decls);

await browser.close();
writeFileSync(resolve(OUT, 'assertions.json'), JSON.stringify({ lotId, blNumber: BL, cont1: CONT1, cont2: CONT2, assertions }, null, 2));
writeFileSync(resolve(OUT, 'ui-driver.log'), `${log.join('\n')}\nEXIT=${process.exitCode ?? 0}\n`);
console.log(log.join('\n'));
console.log(`EXIT=${process.exitCode ?? 0}`);
