// Card 211026011500 (spec 2026.10.17 §1/§2) — the hàng lẻ operating points'
// VALIDATION paint, driven on the real form for both directions:
//   1. empty submit with Nhà máy + Kho untouched paints 'Chọn nhà máy.' and
//      'Chọn kho lấy hàng.' on both fields (Nhập khẩu AND Xuất khẩu — the
//      labels swap, the requirement does not)
//   2. typing free text into both comboboxes (spec §2 "gõ tự do") clears both
//      errors — the typed name satisfies the requirement like a catalog pick
// Companion to 2026-10-17-fb105-lcl-points-rung.mjs (labels/placeholders/
// quick-add/waive + dispatch Nâng/Trả mapping) — this one pins the §2 block.
//
// LOCAL ONLY: vite (BASE) → api 3002, role CUS (thanhdc), customer LONG MINH.
//   BASE='http://[::1]:7176' SHOTS=qa/2026-10-21-lcl-form \
//   node testplan/qa/scripts/2026-10-21-card211026011500-lcl-points-empty-submit-rung.mjs
// Exit 0 = every rung PASS. Creates NO lot (submit is always blocked).

import puppeteer from 'puppeteer';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb105-empty';
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
function record(rung, verdict, detail) {
  results.push({ rung, verdict, detail });
  console.log(`[${verdict}] ${rung} — ${detail}`);
}

async function loginWithRetry(id, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    const res = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: id, password: 'Abc123' }),
    });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.token) return json;
    await sleep(1500 * i);
  }
  throw new Error(`login ${id} failed`);
}

const login = await loginWithRetry('thanhdc');
console.log(`logged in as ${login.user?.username} (${login.user?.role})`);

const browser = await puppeteer.launch({
  headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

/** True when the field host paints the given issue text. */
async function fieldShows(fieldId, text) {
  return page.evaluate((fid, t) => {
    const host = document.querySelector(`[data-field-id="${fid}"]`);
    if (!host) return { present: false, errorClass: false };
    return {
      present: host.textContent?.includes(t) ?? false,
      errorClass: !!host.querySelector('.csc-searchable-field--error'),
    };
  }, fieldId, text);
}

async function setDirection(text) {
  await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-trade-direction"]');
    const c = host?.querySelector('[role="combobox"], select, button');
    if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); c.click(); }
  });
  await sleep(700);
  await page.evaluate((t) => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => new RegExp(t, 'i').test((el.innerText || '').trim()));
    o?.click();
  }, text);
  await sleep(1500);
}

async function typeInto(fieldId, text) {
  await page.evaluate((fid) => {
    const host = document.querySelector(`[data-field-id="${fid}"]`);
    const combo = host?.querySelector('[role="combobox"]');
    if (combo) { combo.scrollIntoView({ block: 'center' }); combo.focus(); }
  }, fieldId);
  await page.keyboard.type(text, { delay: 40 });
  await sleep(900);
  // close the option popover without picking
  await page.keyboard.press('Escape');
  await sleep(400);
}

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('[data-field-id="shipment-customer"]', { timeout: 45000 });
  await sleep(2500);

  // pick the catalog customer
  await page.evaluate(() => {
    const host = document.querySelector('[data-field-id="shipment-customer"]');
    const c = host?.querySelector('[role="combobox"]');
    if (c) { c.scrollIntoView({ block: 'center' }); c.focus(); c.click(); }
  });
  await sleep(800);
  await page.evaluate(() => {
    const o = [...document.querySelectorAll('[role="option"]')]
      .find((el) => /LONG MINH/i.test((el.innerText || '').trim()));
    o?.click();
  });
  await sleep(2500);
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button, [role="tab"], label')]
      .find((b) => /hàng lẻ/i.test((b.innerText || '').trim()));
    el?.click();
  });
  await sleep(2500);

  async function submitAndAssert(directionLabel, shotName) {
    await setDirection(directionLabel);
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')]
        .find((b) => (b.innerText || '').trim() === 'Tạo lô hàng');
      btn?.scrollIntoView({ block: 'center' });
      btn?.click();
    });
    await sleep(2500);
    const factory = await fieldShows('shipment-operational-site', 'Chọn nhà máy.');
    const warehouse = await fieldShows('shipment-pickup-warehouse', 'Chọn kho lấy hàng.');
    const path = `${SHOTS}/${shotName}.png`;
    await page.screenshot({ path });
    return { factory, warehouse, path };
  }

  // ── Rung 1: Nhập khẩu empty submit paints BOTH point errors ───────────
  const imp = await submitAndAssert('Nhập khẩu', '04-nhap-validation');
  record('nhap-empty-submit', imp.factory.present && imp.factory.errorClass
    && imp.warehouse.present && imp.warehouse.errorClass ? 'PASS' : 'FAIL',
    `factory=${JSON.stringify(imp.factory)} warehouse=${JSON.stringify(imp.warehouse)} · ${imp.path}`);

  // ── Rung 2: Xuất khẩu empty submit paints BOTH point errors too ───────
  const exp = await submitAndAssert('Xuất khẩu', '05-xuat-validation');
  record('xuat-empty-submit', exp.factory.present && exp.factory.errorClass
    && exp.warehouse.present && exp.warehouse.errorClass ? 'PASS' : 'FAIL',
    `factory=${JSON.stringify(exp.factory)} warehouse=${JSON.stringify(exp.warehouse)} · ${exp.path}`);

  // ── Rung 3: typed free text (spec §2 gõ tự do) clears BOTH errors ─────
  await typeInto('shipment-operational-site', 'Nhà máy gõ tay 211026011500');
  await typeInto('shipment-pickup-warehouse', 'Kho CFS gõ tay 211026011500');
  const typedFactory = await page.evaluate(() =>
    document.querySelector('[data-field-id="shipment-operational-site"] [role="combobox"]')?.value ?? null);
  const typedWarehouse = await page.evaluate(() =>
    document.querySelector('[data-field-id="shipment-pickup-warehouse"] [role="combobox"]')?.value ?? null);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').trim() === 'Tạo lô hàng');
    btn?.click();
  });
  await sleep(2500);
  const factoryAfter = await fieldShows('shipment-operational-site', 'Chọn nhà máy.');
  const warehouseAfter = await fieldShows('shipment-pickup-warehouse', 'Chọn kho lấy hàng.');
  const path3 = `${SHOTS}/06-free-text-clears.png`;
  await page.screenshot({ path: path3 });
  record('typed-text-clears', typedFactory === 'Nhà máy gõ tay 211026011500'
    && typedWarehouse === 'Kho CFS gõ tay 211026011500'
    && !factoryAfter.present && !warehouseAfter.present ? 'PASS' : 'FAIL',
    `typed=(${JSON.stringify(typedFactory)}, ${JSON.stringify(typedWarehouse)}) errors after submit: factory=${JSON.stringify(factoryAfter)} warehouse=${JSON.stringify(warehouseAfter)} · ${path3}`);
} catch (e) {
  record('RUNNER', 'FAIL', String(e.message ?? e));
  await page.screenshot({ path: `${SHOTS}/99-error.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.verdict === 'FAIL');
console.log(`\n=== ${failed.length === 0 ? 'ALL RUNGS PASS' : failed.length + ' RUNG(S) FAILED'} ===`);
for (const r of results) console.log(`  ${r.verdict.padEnd(5)} ${r.rung}`);
process.exit(failed.length === 0 ? 0 : 1);
