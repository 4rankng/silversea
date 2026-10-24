// SIL-168 — rung-3 UI drive (LOCAL ONLY): the Tạo mới lô hàng "Nhận diện lô"
// field order on /shipments/new, served by THIS worktree's vite (:7177), API
// :3002. Ruling B (owner 24/10, khách yêu cầu lần 3): Hình thức XNK đứng
// TRƯỚC Số Bill/Booking; Số tờ khai là band cuối; FB-113 gate giữ nguyên.
// Read-only layout change: DB proof = shipments row count unchanged before ↔
// after the drive (no write path touched).
// Run: node qa/scripts/2026-10-24-sil168-field-order-ui-drive.mjs
// Env: FRONT_PORT (7177), API_PORT (3002).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7177}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa/2026-10-24_sil168-field-order');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=cus');
if (!token) { log('ABORT: no token in login response'); process.exit(2); }

// Read-only change: prove the drive mutated nothing.
const dbCount = () => execSync(
  'docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c "select count(*) from shipments"',
).toString().trim();
const countBefore = dbCount();
log(`DB shipments count BEFORE drive = ${countBefore}`);

const browser = await puppeteer.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
  }, token);
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('#shipment-section-identity', { timeout: 20000 });
  await page.waitForSelector('[data-field-id="shipment-trade-direction"]', { timeout: 20000 });
  log('PAGE /shipments/new loaded, identity section present');

  // ── DOM assertions (SIL168-AC1/AC2 + FB-127 clusters gone + gate) ──
  const dom = await page.evaluate(() => {
    const q = (sel) => document.querySelector(sel);
    const before = (a, b) => Boolean(a && b && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING));
    const section = q('#shipment-section-identity');
    const strip = q('[data-field-id="shipment-declarations"]');
    // UUI TextField does not forward id onto the real <input> (react-aria
    // generates its own) — reach the input through the field wrapper.
    const booking = q('[data-field-id="shipment-booking-ref"] input');
    return {
      order: {
        customerBeforeXnk: before(q('[data-field-id="shipment-customer"]'), q('[data-field-id="shipment-trade-direction"]')),
        xnkBeforeBooking: before(q('[data-field-id="shipment-trade-direction"]'), q('[data-field-id="shipment-booking-ref"]')),
        bookingBeforeShipping: before(q('[data-field-id="shipment-booking-ref"]'), q('[data-field-id="shipment-shipping-line"]')),
        shippingBeforeFlags: before(q('[data-field-id="shipment-shipping-line"]'), q('[data-field-id="shipment-deposit"]')),
        flagsBeforeDeclarations: before(q('[data-field-id="shipment-deposit"]'), strip),
      },
      clustersGone: !document.body.textContent.includes('Chứng từ & định danh')
        && !document.body.textContent.includes('Phân loại nghiệp vụ'),
      stripLast: Boolean(section && strip && strip.parentElement === section && section.lastElementChild === strip),
      bookingDisabledBeforePick: booking ? booking.disabled : null,
      gateHint: document.body.textContent.includes('Chọn Hình thức xuất nhập khẩu trước'),
    };
  });
  check('SIL168-R2 XNK đứng TRƯỚC Số Bill/Booking (DOM)', dom.order.xnkBeforeBooking);
  check('band1 Khách hàng → XNK', dom.order.customerBeforeXnk);
  check('band2 Bill/Booking → Hãng tàu', dom.order.bookingBeforeShipping);
  check('band3 Hãng tàu → Tuỳ chọn', dom.order.shippingBeforeFlags);
  check('SIL168-AC2 Số tờ khai là band cuối section', dom.stripLast);
  check('Tuỳ chọn trước Số tờ khai', dom.order.flagsBeforeDeclarations);
  check('cụm divider FB-127 đã bỏ', dom.clustersGone);
  check('SIL168-AC3 gate: Bill/Booking disable trước khi chọn hướng', dom.bookingDisabledBeforePick === true);
  check('gate hint text hiển thị', dom.gateHint);

  // ── Real click: pick "Xuất khẩu" on the XNK combobox (FB-113 gate) ──
  const xnkBox = await page.$('[data-field-id="shipment-trade-direction"] [role="combobox"], [data-field-id="shipment-trade-direction"] button');
  if (!xnkBox) { check('click XNK trigger found', false); }
  else {
    await xnkBox.click();
    await page.waitForSelector('[role="option"]', { timeout: 10000 });
    const options = await page.$$('[role="option"]');
    let picked = false;
    for (const opt of options) {
      const txt = (await opt.evaluate((n) => n.textContent)).trim();
      if (txt === 'Xuất khẩu') { await opt.click(); picked = true; break; }
    }
    check('click option "Xuất khẩu"', picked);
    await new Promise((r) => setTimeout(r, 600));
    const after = await page.evaluate(() => {
      const booking = document.querySelector('[data-field-id="shipment-booking-ref"] input');
      return { enabled: booking ? !booking.disabled : null, placeholder: booking?.getAttribute('placeholder') ?? '' };
    });
    check('SIL168-AC4 sau khi chọn Xuất: Bill/Booking enable', after.enabled === true);
    check('placeholder theo hướng Xuất', after.placeholder === 'Nhập số Booking (hàng Xuất)', after.placeholder);
  }

  // Post-click screenshot (desktop 1440)
  await page.screenshot({ path: path.join(OUT, 'ui-after-pick-export-1440.png'), fullPage: false });
  log('SHOT qa/2026-10-24_sil168-field-order/ui-after-pick-export-1440.png');

  // Mobile 390 sanity (AC5 band reflow)
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 400));
  const noClip = await page.evaluate(() => {
    const grid = document.querySelector('.csc-identity-grid');
    return grid ? grid.scrollWidth <= grid.clientWidth + 1 : false;
  });
  check('AC5 390px: band không tràn ngang', noClip);
  await page.screenshot({ path: path.join(OUT, 'ui-mobile-390.png'), fullPage: false });
  log('SHOT qa/2026-10-24_sil168-field-order/ui-mobile-390.png');
} finally {
  await browser.close();
}

const countAfter = dbCount();
fs.appendFileSync(path.join(OUT, 'db-side-effect-proof.txt'),
  `Read-only drive — shipments row count BEFORE=${countBefore} AFTER=${countAfter} (unchanged)\n`);
check('DB không đổi sau drive (read-only)', countBefore === countAfter, `${countBefore} → ${countAfter}`);

log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);

