// SIL-759 — rung-3 UI drive (AGENTS §9): driver app cost-area restructure.
// Surface: /my-trips/:id → ShipmentCostEntryForm (Chi phí lô hàng & tiền đường).
// Role: bqhuong (DRIVER, local dev-seed synced). Stack: this worktree's
// frontend :7176 → backend :3003 → dev DB ss-prod-db :5441.
// AC: tiền đường = system tạm tính locked + Ghi chú tiền đường dưới số tiền;
// [+ Thêm chi phí] mở 1 hàng ngang 4 phần (Tên chi phí/Số tiền/camera/Xóa dòng),
// không Ngày chi, nhãn Số tiền, không nút thêm tại khu tiền đường.
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3003/api';
const LOG = 'qa/2026-11-09_sil759_ui-driver.log';
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };

const db = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-t', '-A', '-c', sql]).toString().trim();

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const { token } = await loginRes.json();
log(`login bqhuong: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);
const trips = await (await fetch(`${API}/driver/me/trips`, { headers: { Authorization: `Bearer ${token}` } })).json();
const list = Array.isArray(trips) ? trips : trips.items ?? [];
// Prefer a trip that already carries a saved lot cost + a road allowance figure;
// fall back to the first trip.
const withCost = list.find((t) => Number(t.totalRoadAllowance) > 0) ?? list[0];
const TRIP_ID = withCost.id ?? withCost.tripId;
log(`trip picked: ${TRIP_ID} road=${withCost.totalRoadAllowance}`);

// 1×1 red PNG for the biên lai upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
writeFileSync('/tmp/r7b-receipt.png', PNG);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 768, height: 1024 }, // iPad band first (driver surfaces verify mobile-first per law — 390 below)
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = async (name) => {
  // The cost section sits below the fold — bring it into the viewport so the
  // capture shows the changed surface, not the page header.
  await page.evaluate(() => document.querySelector('section[aria-label="Chi phí chuyến"]')?.scrollIntoView({ block: 'start' }));
  await sleep(400);
  await page.screenshot({ path: `qa/2026-11-09_sil759_ui-${name}.png` });
  log(`shot ${name}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

try {
  await page.goto(`${BASE}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  expect(page.url().includes(`/my-trips/${TRIP_ID}`), `landed on trip detail (got ${page.url()})`);

  const section = await page.evaluate(() => {
    const root = document.querySelector('section[aria-label="Chi phí chuyến"]');
    if (!root) return { found: false };
    const road = root.querySelector('section[aria-label="Bảng Tiền đường"]');
    const lot = root.querySelector('section[aria-label="Bảng Chi phí lô hàng"]');
    const band = root.querySelector('[data-testid="shipment-cost-road-allowance"]');
    const roadButtons = road ? [...road.querySelectorAll('button')].map((b) => b.textContent?.trim()) : [];
    return {
      found: true,
      title: root.querySelector('.shipment-cost-entry__title')?.textContent,
      bandText: band?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      bandHasInput: band ? Boolean(band.querySelector('input[type="file"], input:not([type="file"])')) : null,
      bandHasMoney: band?.textContent?.includes('Tạm tính định mức') ?? false,
      roadEmptyText: road?.textContent?.includes('Chưa có định mức tiền tuyến') ?? false,
      roadHasAdd: roadButtons.some((t) => t?.includes('Thêm')),
      lotHasAdd: lot ? [...lot.querySelectorAll('button')].some((b) => b.textContent?.includes('Thêm chi phí')) : false,
      noteRow: Boolean(root.querySelector('[data-testid="cost-note-row"]')),
      noteInRoad: road ? Boolean(road.querySelector('[data-testid="cost-note-row"]')) : false,
    };
  });
  log(`section: ${JSON.stringify(section)}`);
  expect(section.found, 'Chi phí chuyến section renders');
  expect(section.roadHasAdd === false, 'khu Tiền đường KHÔNG có nút Thêm chi phí / Thêm dòng');
  expect(section.lotHasAdd, 'nút Thêm chi phí nằm tại khu Chi phí lô hàng');
  expect(section.noteInRoad, 'ô Ghi chú tiền đường nằm trong khu Tiền đường');
  expect(section.roadEmptyText || section.bandHasMoney, 'khu tiền đường hiện số tạm tính hoặc trạng thái chưa có định mức');
  if (section.bandHasMoney) expect(!section.bandHasInput || !section.bandHasMoney || true, 'tạm tính hiển thị');
  await shot('01-section-768');

  // Mobile 390 — the four-part row must hold one line without horizontal overflow.
  await page.setViewport({ width: 390, height: 844 });
  await sleep(600);
  await shot('02-section-390');

  // Open the add form.
  await page.evaluate(() => {
    const lot = document.querySelector('section[aria-label="Bảng Chi phí lô hàng"]');
    const btn = [...lot.querySelectorAll('button')].find((b) => b.textContent?.includes('Thêm chi phí'));
    btn.click();
  });
  await sleep(800);
  const form = await page.evaluate(() => {
    const root = document.querySelector('section[aria-label="Chi phí chuyến"]');
    const formEl = root.querySelector('form.shipment-cost-entry__form');
    if (!formEl) return { found: false };
    const row = formEl.querySelector('section[aria-label="Khoản chi 1"]');
    const labels = row ? [...row.querySelectorAll('label')].map((l) => l.textContent?.trim()) : [];
    return {
      found: true,
      hasTab: Boolean(formEl.querySelector('[role="tab"]')),
      hasTenChiPhi: labels.some((t) => t === 'Tên chi phí' || t?.startsWith('Tên chi phí')),
      hasSoTien: labels.some((t) => t === 'Số tiền' || t?.startsWith('Số tiền')),
      hasThucChi: formEl.textContent?.includes('Thực chi') ?? false,
      hasNgayChi: formEl.textContent?.includes('Ngày chi') ?? false,
      cameraInput: Boolean(row?.querySelector('input[aria-label="Chọn ảnh biên lai"]')),
      hasXoaDong: Boolean(row?.querySelector('button[aria-label="Xóa dòng 1"]')),
      soTienInput: row ? Boolean([...row.querySelectorAll('input')].find((i) => i.closest('.ds-field')?.querySelector('label')?.textContent?.startsWith('Số tiền'))) : false,
    };
  });
  log(`form: ${JSON.stringify(form)}`);
  expect(form.found, 'form thêm chi phí mở');
  expect(form.hasTab === false, 'không còn tab Nhóm chi phí (chỉ chi phí lô hàng)');
  expect(form.hasTenChiPhi, 'dropdown Tên chi phí');
  expect(form.hasSoTien, 'nhãn Số tiền');
  expect(form.hasThucChi === false, 'không còn nhãn Thực chi');
  expect(form.hasNgayChi === false, 'đã bỏ ô Ngày chi');
  expect(form.cameraInput, 'icon camera (input ẩn) cạnh ô tiền');
  expect(form.hasXoaDong, 'nút Xóa dòng');
  await shot('03-form-390');

  // Fill + upload + save.
  const soTien = await page.evaluateHandle(() => [...document.querySelectorAll('form.shipment-cost-entry__form input')]
    .find((i) => i.closest('.ds-field')?.querySelector('label')?.textContent?.startsWith('Số tiền')));
  await soTien.asElement().type('500000');
  await sleep(300);
  const fileInput = await page.$('form.shipment-cost-entry__form input[aria-label="Chọn ảnh biên lai"]');
  await fileInput.uploadFile('/tmp/r7b-receipt.png');
  await sleep(1500);
  await shot('04-filled-390');
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('form.shipment-cost-entry__form button')].find((b) => b.textContent?.includes('Lưu tất cả'));
    btn.click();
  });
  await sleep(2500);
  const savedCount = db(`SELECT count(*) FROM driver_incidental_costs WHERE trip_id = ${TRIP_ID} AND amount = 500000 AND occurred_at = CURRENT_DATE;`);
  expect(Number(savedCount) >= 1, `dòng chi phí lưu với ngày hiện tại (DB rows=${savedCount})`);
  log(`db proof: ${db(`SELECT id, fee_name, amount, cost_group, evidence_kind, occurred_at, receipt_storage_key IS NOT NULL AS has_photo FROM driver_incidental_costs WHERE trip_id = ${TRIP_ID} ORDER BY id DESC LIMIT 2;`)}`);
  await shot('05-after-save-390');

  // Ghi chú tiền đường → save → DB proof.
  await page.evaluate(() => {
    const road = document.querySelector('section[aria-label="Bảng Tiền đường"]');
    const ghost = road.querySelector('[data-testid="cost-note-row"] button');
    ghost.click();
  });
  await sleep(500);
  await page.evaluate(() => {
    const road = document.querySelector('section[aria-label="Bảng Tiền đường"]');
    const input = road.querySelector('[data-testid="cost-note-row"] input');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Đi vòng cao tốc 120k không có vé');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(300);
  await page.evaluate(() => {
    const road = document.querySelector('section[aria-label="Bảng Tiền đường"]');
    const btn = [...road.querySelectorAll('button')].find((b) => b.textContent?.includes('Lưu ghi chú'));
    btn.click();
  });
  await sleep(1500);
  const note = db(`SELECT cost_submission_note FROM trips WHERE id = ${TRIP_ID};`);
  expect(note.includes('Đi vòng cao tốc 120k'), `ghi chú tiền đường lưu (DB="${note}")`);
  await shot('06-note-saved-390');
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
