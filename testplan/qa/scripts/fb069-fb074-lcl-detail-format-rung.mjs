// Cards 101026163030 (FB-069) + 101026163040 (FB-074) — LOCAL UI rung:
// the LCL detail header must render weight/volume through the house measure
// axis (same numbers the overview shows), and on a COMPLETE local LCL lot the
// overview row and the detail header must agree on every fact they share.
// Role CUS (thanhdc, local seed). Read-only — nothing is written.
//
//   AC1 (FB-069) detail header: "24.000 kg" / "30 CBM" — no storage decimals
//   AC2 (FB-074) overview row:  same "24.000 kg · 30 CBM", "1 Kiện"
//   AC3 (FB-074) cross-view:    shared facts (booking, packages, weight,
//                                volume, route) textually identical in both views
//   AC4 (FB-074) route+loc:     detail header names the overview's route; the
//                                lot's real (empty) Nơi nhận/Nơi giao stay "—"
//                                on the detail while the overview claims no
//                                location either — no contradiction
//
// Design provenance: house formatters only (lib/format.formatWeight, the
// cusUtils.formatQuantity the overview rows already ride) — no catalog
// component involved; Untitled UI PRO has no numeric-display contract to add.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';
import { appendFileSync, writeFileSync } from 'node:fs';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOT = 61959; // SHP-2610-01349 — local complete LCL lot, booking QA-LCL-20261006-MM01
const SUFFIX = 'MM01';
const DRIVER_LOG = `${QA}/2026-10-10_card101026163030_ui-driver.log`;
writeFileSync(DRIVER_LOG, '');
const step = (s, o = {}) => {
  const line = JSON.stringify({ at: new Date().toISOString(), step: s, ...o });
  appendFileSync(DRIVER_LOG, line + '\n');
  console.log(line);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`login thanhdc failed: ${login.status}`);
const token = (await login.json()).token;
step('login', { user: 'thanhdc (CUS)', gotToken: Boolean(token) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  // ── Overview row (FB-074 side) ───────────────────────────────────────
  await page.goto(`${BASE}/shipments?searchSuffix=${SUFFIX}`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto-overview', { note: 'networkidle timeout — continue' }));
  await page.waitForSelector(`#cus-dashboard-detail-${LOT}`, { timeout: 60000 });
  const overview = await page.evaluate((id) => {
    const tr = document.querySelector(`#cus-dashboard-detail-${id}`)?.closest('tr');
    const cell = (label) => {
      const td = [...tr.querySelectorAll('td, th')].find((n) => n.getAttribute('data-label') === label);
      return td ? td.innerText.replace(/\n+/g, ' | ').trim() : null;
    };
    const th = tr.querySelector('th[data-label]');
    return {
      identity: th ? th.innerText.replace(/\n+/g, ' | ').trim() : null,
      documents: cell('Chứng từ'),
      classification: cell('Phân loại & hãng tàu'),
      cargo: cell('Tổng quan hàng hóa'),
      schedule: cell('Lịch trình & điều xe'),
      status: cell('Trạng thái'),
    };
  }, LOT);
  step('AC2-overview-row', overview);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163030_ui-1-overview-row.png` });
  assert.ok(overview.cargo, 'AC2: overview cargo cell present');
  assert.match(overview.cargo, /24\.000 kg · 30 CBM/, 'AC2: overview shows grouped weight + integer CBM');
  assert.match(overview.cargo, /1 Kiện/, 'AC2: overview shows the package quantity');

  // ── Detail header (FB-069 side) ──────────────────────────────────────
  await page.goto(`${BASE}/shipments/${LOT}`, { waitUntil: 'networkidle0', timeout: 90000 })
    .catch(() => step('goto-detail', { note: 'networkidle timeout — continue' }));
  await page.waitForFunction(() => document.body.innerText.includes('Trọng lượng'), { timeout: 60000 });
  await sleep(800);
  const detail = await page.evaluate(() => {
    const field = (label) => {
      const dt = [...document.querySelectorAll('dt')].find((n) => (n.textContent || '').trim() === label);
      return dt ? (dt.nextElementSibling?.textContent || '').trim() : null;
    };
    return {
      booking: field('Mã đặt chỗ'),
      pickup: field('Nơi nhận'),
      delivery: field('Nơi giao'),
      factory: field('Nhà máy / công trường'),
      route: field('Tuyến đường'),
      weight: field('Trọng lượng'),
      volume: field('Thể tích'),
      packages: field('Kiện hàng'),
      mode: field('Loại lô'),
      bodyHasRawWeight: /\b24000\.00 kg\b/.test(document.body.innerText),
      bodyHasRawVolume: /\b30\.000 CBM\b/.test(document.body.innerText),
    };
  });
  step('AC1-detail-header', detail);
  await page.screenshot({ path: `${QA}/2026-10-10_card101026163030_ui-2-detail-header.png` });

  // AC1 — the raw column echo is gone.
  assert.equal(detail.weight, '24.000 kg', 'AC1: detail weight rides formatWeight (grouped, no storage decimals)');
  assert.equal(detail.volume, '30 CBM', 'AC1: detail volume renders the integer CBM');
  assert.equal(detail.packages, '1 Kiện', 'AC1: package line intact');
  assert.equal(detail.mode, 'Hàng lẻ (LCL)', 'AC1: this is the LCL detail');
  assert.equal(detail.bodyHasRawWeight, false, 'AC1: no "24000.00 kg" anywhere on the page');
  assert.equal(detail.bodyHasRawVolume, false, 'AC1: no "30.000 CBM" anywhere on the page');

  // AC3 — every shared fact reads identically in both views.
  assert.equal(detail.weight, '24.000 kg', 'AC3: detail weight');
  assert.ok(overview.cargo.includes(detail.weight), `AC3: overview carries the same weight text (${overview.cargo})`);
  assert.ok(overview.cargo.includes(detail.volume), `AC3: overview carries the same volume text (${overview.cargo})`);
  assert.ok(overview.cargo.includes(detail.packages), `AC3: overview carries the same package text (${overview.cargo})`);
  assert.ok((overview.documents || '').includes(detail.booking), `AC3: booking identical (${detail.booking})`);

  // AC4 — route + locations: the detail now names the SAME route the
  // overview identity line carries (the FB-074 data half), and neither view
  // invents a lot-level location this lot does not have (its real values are
  // empty — an unfinished-lot artifact, not a view divergence).
  const [, overviewFactory, overviewRoute] = overview.identity.split(' | ');
  assert.equal(detail.route, overviewRoute, `AC4: detail route equals the overview's (${detail.route} vs ${overviewRoute})`);
  assert.notEqual(detail.route, '—', 'AC4: the container-less LCL lot shows its route on the detail now');
  assert.equal(detail.pickup, '—', 'AC4: lot has no lot-level pickup location');
  assert.equal(detail.delivery, '—', 'AC4: lot has no lot-level delivery location');
  assert.equal(detail.factory, '—', 'AC4: detail names the missing factory as —');
  assert.equal(overviewFactory, 'Chưa có nhà máy', 'AC4: overview names the same missing factory (own placeholder wording)');
  step('AC4-route-and-locations', {
    route: detail.route, overviewRoute, pickup: detail.pickup, delivery: detail.delivery,
    factory: detail.factory, overviewFactory,
  });

  step('done', { note: 'read-only rung — no writes; lot 61959 untouched' });
} catch (err) {
  step('FATAL', { error: String((err && err.message) || err) });
  throw err;
} finally {
  await browser.close();
}
appendFileSync(DRIVER_LOG, 'RUNG PASS\nDRIVER OK\n');
console.log('RUNG PASS');
console.log('DRIVER OK');
