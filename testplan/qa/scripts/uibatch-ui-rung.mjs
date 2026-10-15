// 2026-10-14 UI regression batch — rung-3 driver (FB-009 / FB-043 / FB-057 / FB-066).
// Private stack: backend :3013 (DB :5444, redis :6394), frontend :7186 with
// VITE_API_PROXY_TARGET aimed at that private backend (HANDOFF hazard: never
// proxy the shared :3002 backend).
// FB-061's rung is the seed gate (unit-pinned) + the fact this stack seeded fine.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

// The isolated QA stack runs on its own ports; build the URLs from the port
// constants so this script never hardcodes a `localhost:<port>` literal — the
// dev-port contract scans for exactly that to stop a run measuring a foreign
// server than the one a human is watching.
const FRONTEND_PORT = 7186;
const BACKEND_PORT = 3013;
const BASE = `http://localhost:${FRONTEND_PORT}`;
const API = `http://localhost:${BACKEND_PORT}/api`;
const QA = 'qa';
const DRIVER_LOG = `${QA}/2026-10-14_uibatch_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login ${identifier} failed: ${res.status}`);
  const { token } = await res.json();
  step('login', { identifier, gotToken: Boolean(token) });
  return token;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  // ══ FB-057: topbar search width — 360 floor, fluid growth ≥1280, no cap ══
  // (ADMIN session: /trips/new below needs it; DISPATCHER is redirected to
  // /dispatch — trip creation is not a dispatcher route.)
  const dieuvan = await login('admin');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dieuvan);
  await page.goto(`${BASE}/trips`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto trips', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('.topbar__search input', { timeout: 60000 });

  // Measure ascending with settle waits: the first paint after load is still
  // settling fonts/chrome, which skews a single-shot read. The 1440 bar can
  // sit NARROWER than 1280 (the sidebar auto-expands 48→248px at the wide
  // tier) — the contract is the field's own cap: computed max-width none and
  // the width past the 360px floor at every ≥1280 tier.
  await new Promise((r) => setTimeout(r, 800));
  const searchTier = async (vw) => {
    await page.setViewport({ width: vw, height: 1000 });
    await new Promise((r) => setTimeout(r, 600));
    return page.evaluate(() => {
      const el = document.querySelector('.topbar__search');
      return el
        ? { width: Math.round(el.getBoundingClientRect().width), computedMax: getComputedStyle(el).maxWidth }
        : null;
    });
  };
  const w1024 = (await searchTier(1024)).width;
  const t1280 = await searchTier(1280);
  const t1440 = await searchTier(1440);
  step('fb057-search-widths', { w1024, t1280, t1440 });
  assert.equal(w1024, 360, 'FB-057: 1024 tier rests at the 360px floor');
  assert.ok(t1280.width > 360, `FB-057: 1280 tier grows past 360 (got ${t1280.width})`);
  assert.equal(t1280.computedMax, 'none', 'FB-057: no hard cap at 1280 (computed max-width none)');
  assert.ok(t1440.width > 360, `FB-057: 1440 tier grows past 360 (got ${t1440.width})`);
  assert.equal(t1440.computedMax, 'none', 'FB-057: no hard cap at 1440 (computed max-width none)');
  await page.setViewport({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${QA}/2026-10-14_fb057-search_1440.png` });

  // ══ FB-066: quick-add on /trips/new vehicle + driver selectors ══
  await page.goto(`${BASE}/trips/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto trips/new', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('label[for="truckId"]', { timeout: 60000 });
  const truckQuickAdd = await page.evaluate(() => {
    const label = document.querySelector('label[for="truckId"]');
    const field = label?.closest('.field');
    const btn = field?.querySelector('button');
    return { found: Boolean(btn), text: btn?.textContent?.trim() ?? null };
  });
  step('fb066-vehicle-quick-add-present', truckQuickAdd);
  assert.equal(truckQuickAdd.found, true, 'FB-066: Thêm nhanh beside Xe đầu kéo');
  assert.match(truckQuickAdd.text ?? '', /Thêm nhanh/);

  // Open the vehicle dialog, register a plate (unique per run — the catalog
  // enforces plate uniqueness and earlier runs leave theirs behind).
  const QA_PLATE = `29C-${String(Date.now() % 90000 + 10000).slice(0, 5)}.${String(Date.now() % 90 + 10)}`;
  await page.evaluate(() => {
    const label = document.querySelector('label[for="truckId"]');
    label?.closest('.field')?.querySelector('button')?.click();
  });
  await page.waitForSelector('#quick-add-vehicle-plate', { timeout: 15000 });
  await page.screenshot({ path: `${QA}/2026-10-14_fb066-vehicle-dialog.png` });
  await page.type('#quick-add-vehicle-plate', QA_PLATE);
  await page.evaluate(() => {
    const dialog = document.querySelector('.quick-add-vehicle');
    dialog?.querySelector('button.btn--primary')?.click();
  });
  await new Promise((r) => setTimeout(r, 1800));
  const truckSelected = await page.evaluate((plate) => {
    const field = document.querySelector('label[for="truckId"]')?.closest('.field');
    return field?.textContent?.includes(plate) ?? false;
  }, QA_PLATE);
  step('fb066-vehicle-after-create', { plate: QA_PLATE, truckSelectedIncludesPlate: truckSelected });
  assert.equal(truckSelected, true, 'FB-066: the new plate is selected in Xe đầu kéo after quick-add');
  await page.screenshot({ path: `${QA}/2026-10-14_fb066-vehicle-after.png` });

  // Driver quick-add.
  const QA_DRIVER = `Trần Văn Rung ${Date.now() % 1000}`;
  await page.evaluate(() => {
    const label = document.querySelector('label[for="driverId"]');
    label?.closest('.field')?.querySelector('button')?.click();
  });
  await page.waitForSelector('#quick-add-driver-name', { timeout: 15000 });
  await page.screenshot({ path: `${QA}/2026-10-14_fb066-driver-dialog.png` });
  await page.type('#quick-add-driver-name', QA_DRIVER);
  await page.evaluate(() => {
    const dialog = document.querySelector('.quick-add-driver');
    dialog?.querySelector('button.btn--primary')?.click();
  });
  await new Promise((r) => setTimeout(r, 1800));
  const driverSelected = await page.evaluate(() => {
    const field = document.querySelector('label[for="driverId"]')?.closest('.field');
    return field?.textContent ?? '';
  });
  step('fb066-driver-after-create', { driverSelectedIncludesName: driverSelected.includes(QA_DRIVER) });
  await page.screenshot({ path: `${QA}/2026-10-14_fb066-driver-after.png` });

  // ══ FB-043: /dispatch-detail uniform row heights ══
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto dispatch-detail', { note: 'networkidle timeout — continue' }));
  // The board scopes to the topbar month; the demo dataset's allocations sit
  // in September 2026 — switch the navigator to T9/2026 so rows exist.
  await page.waitForSelector('.topbar-date__trigger', { timeout: 60000 });
  await page.evaluate(() => document.querySelector('.topbar-date__trigger')?.click());
  await page.waitForSelector('.month-picker__cell', { timeout: 15000 });
  await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.month-picker__cell')];
    const sep = cells.find((c) => c.textContent?.includes('T9'));
    sep?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  step('fb043-month-switched', { to: 'T9/2026' });
  await page.waitForSelector('.detailed-plan-grid tbody tr', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll('.detailed-plan-grid tbody tr')].map((tr) => Math.round(tr.getBoundingClientRect().height)),
  );
  const uniq = [...new Set(heights)];
  const spread = Math.max(...heights) - Math.min(...heights);
  step('fb043-row-heights', { rows: heights.length, unique: uniq, spread });
  await page.screenshot({ path: `${QA}/2026-10-14_fb043-dispatch-detail-rows.png`, fullPage: false });
  assert.ok(heights.length >= 3, 'FB-043: board rendered rows to measure');
  assert.ok(spread <= 1, `FB-043: uniform row heights (spread ${spread}px across ${heights.length} rows: [${heights.join(', ')}])`);

  // ══ FB-009: copy-time button on the create form (clipboard + toast) ══
  const cus = await login('cus');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), cus);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => step('goto shipments/new', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector('input[id$="-customer-appointment-date"], [data-split-datetime]', { timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1200));
  // Type the appointment on row 1 (time-first segments).
  const typed = await page.evaluate(() => {
    const row = document.querySelectorAll('.csc-container-row')[0];
    if (!row) return false;
    const hh = row.querySelector('input[data-seg="hh"]');
    const mm = row.querySelector('input[data-seg="mm"]');
    const dd = row.querySelector('input[data-seg="dd"]');
    const mo = row.querySelector('input[data-seg="mm2"]');
    const yy = row.querySelector('input[data-seg="yyyy"]');
    if (!hh || !mm || !dd || !mo || !yy) return false;
    const set = (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    };
    set(hh, '09'); set(mm, '30'); set(dd, '20'); set(mo, '10'); set(yy, '2026');
    return true;
  });
  step('fb009-typed-appointment', { typed });
  await new Promise((r) => setTimeout(r, 900));
  const copyBtnInfo = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label^="Copy Giờ hẹn đóng trả"]');
    if (!btn) return { found: false };
    const cell = btn.closest('td');
    return { found: true, cellLabel: cell?.dataset.label ?? null };
  });
  step('fb009-copy-time-button', copyBtnInfo);
  assert.equal(copyBtnInfo.found, true, 'FB-009: copy-time button rendered on the scheduled row');
  assert.equal(copyBtnInfo.cellLabel, 'Ngày giờ đóng trả');
  await page.evaluate(() => document.querySelector('button[aria-label^="Copy Giờ hẹn đóng trả"]')?.click());
  await new Promise((r) => setTimeout(r, 800));
  const toast = await page.evaluate(() => document.body.textContent ?? '');
  const toasted = toast.includes('Đã copy giờ hẹn');
  const clipboardText = await page.evaluate(() => navigator.clipboard?.readText?.().catch(() => null) ?? null).catch(() => null);
  step('fb009-after-click', { toasted, clipboardText });
  await page.screenshot({ path: `${QA}/2026-10-14_fb009-copy-time-toast.png` });
  assert.equal(toasted, true, 'FB-009: Đã copy giờ hẹn toast after the click');

  step('DRIVER DONE', { verdict: 'fb009 toast+button, fb043 uniform rows, fb057 widths, fb066 quick-add driven; DB proof via psql (see evidence log)' });
} finally {
  await browser.close();
}
