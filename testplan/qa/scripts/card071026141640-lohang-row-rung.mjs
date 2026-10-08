/**
 * Card 071026141640 — /trips/<id>: "Lô hàng" rendered twice for one shipment.
 *
 * Measures the REAL rendered DOM: counts `.info-row` blocks whose label is
 * exactly "Lô hàng" inside the "Thông tin cơ bản" card, and records each
 * row's value text + href. The defect is a pure render-count defect, so the
 * assertion is a DOM count — no API response can stand in for it.
 *
 * Discriminating by construction: reverting BasicInfoCard.tsx to its
 * pre-fix parent (653a3dad^) puts the count back to 2, so a green run here
 * means the row is genuinely singular — not that the harness cannot fail.
 *
 * Usage:
 *   node card071026141640-lohang-row-rung.mjs [baseUrl] [tripId] [scope]
 *   baseUrl default http://localhost:7175  (staging: https://vantai.tingting.vip)
 *   tripId   default 39849                 (local dev trip that HAS a shipment)
 *   scope    default local
 */
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:7175';
const TRIP_ID = process.argv[3] || '39849';
const SCOPE = process.argv[4] || 'local';
const EXPECT_SHA = process.env.EXPECT_SHA || '';

const API = BASE.replace(/\/$/, '') + '/api';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const LOG = [];
const log = (s, o) => {
  const e = { at: new Date().toISOString(), step: s, ...o };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let exitCode = 0;

// ── The trip must actually own a shipment, else "exactly one row" is vacuous ──
const login = await fetch(API + '/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
}).then((r) => r.json());
const token = login.token;
if (!token) {
  log('login-FAIL', { body: JSON.stringify(login).slice(0, 200) });
  process.exit(2);
}

if (SCOPE === 'staging') {
  const health = await fetch(API + '/health').then((r) => r.json()).catch(() => ({}));
  log('health', { buildHash: health.buildHash, expect: EXPECT_SHA || '(any)' });
  if (EXPECT_SHA && !String(health.buildHash || '').startsWith(EXPECT_SHA)) {
    log('build-mismatch-FAIL', { got: health.buildHash, want: EXPECT_SHA });
    process.exit(2);
  }
}

const trip = await fetch(`${API}/trips/${TRIP_ID}`, {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json()).catch((e) => ({ error: String(e) }));
log('trip-payload', { id: TRIP_ID, shipmentId: trip?.shipmentId ?? trip?.shipment?.id ?? null });
const shipmentId = trip?.shipmentId ?? trip?.shipment?.id ?? null;
if (!shipmentId) {
  log('no-shipment-FAIL', { id: TRIP_ID, reason: 'trip has no shipment — the assertion would be vacuous' });
  process.exit(2);
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/trips/${TRIP_ID}`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);

  const scan = await page.evaluate(() => {
    // Scope to the "Thông tin cơ bản" card — TripHeader also renders a
    // "Chi tiết lô hàng" button, which is one correct instance, not a row.
    const cards = [...document.querySelectorAll('.card')];
    const basic = cards.find((c) => /Thông tin cơ bản/i.test(c.querySelector('.card-head')?.textContent || ''))
      || cards[0];
    const rows = [...(basic?.querySelectorAll('.info-row') || [])];
    const shipmentRows = rows.filter((r) => (r.querySelector('.lbl')?.textContent || '').trim() === 'Lô hàng');
    const detail = shipmentRows.map((r) => ({
      value: (r.querySelector('.val')?.textContent || '').replace(/\s+/g, ' ').trim(),
      href: r.querySelector('a')?.getAttribute('href') || null,
    }));
    return {
      infoRowCount: rows.length,
      loHangRowCount: shipmentRows.length,
      details: detail,
      cardFound: !!basic,
      thongTinCoBanFound: cards.some((c) => /Thông tin cơ bản/i.test(c.querySelector('.card-head')?.textContent || '')),
    };
  });
  log('dom-scan', scan);

  await page.screenshot({ path: `${QA}/${SCOPE}-card071026141640-trip${TRIP_ID}-lohang.png`, fullPage: false });

  const hrefs = scan.details.map((d) => d.href).filter(Boolean);
  const uniqueHrefs = [...new Set(hrefs)];
  const ok =
    scan.thongTinCoBanFound &&
    scan.loHangRowCount === 1 &&
    hrefs.length === 1 &&
    uniqueHrefs.length === 1 &&
    uniqueHrefs[0] === `/shipments/${shipmentId}` &&
    scan.details[0]?.value.includes(`#${shipmentId}`);

  log('verdict', {
    ok,
    rule: 'exactly one "Lô hàng" row, one href, href === /shipments/' + shipmentId + ', value carries #' + shipmentId,
    got: { count: scan.loHangRowCount, hrefs, value: scan.details[0]?.value },
  });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String((err && err.message) || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}-card071026141640-trip${TRIP_ID}-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}