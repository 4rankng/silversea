// dri-01 + dri-04 — rung-3 UI drive (AGENTS §9) trên viewport LÁI XE 390px.
//
// dri-01 (card REQ-14 / f0986f4c): màn NHẬN LỆNH lái xe (/my-trips/:id) — dòng
//   "SĐT kho" + "SĐT liên hệ" phải là <a href="tel:…"> chạm-gọi được, và số
//   trong modal "Chọn liên hệ để gọi" cũng là link tel:.
//
// dri-04 (card 171026205400 / FB-020): "Cảng hạ" vs "Địa chỉ giao hàng" phải
//   map đúng trên cùng màn:
//   - container CÓ bãi hạ (dropoff port) → Cảng hạ = tên bãi hạ, Địa chỉ giao
//     hàng = nhà máy (điểm nhận hàng) — hai hàng KHÁC nhau, không đổ lẫn.
//   - container KHÔNG có bãi hạ (portless) → Cảng hạ = tên điểm trả (nhà máy)
//     theo FB-020, Địa chỉ giao hàng = nhà máy đầy đủ + địa chỉ (hai điểm
//     là cùng một nơi thì hai hàng cùng tên — PRD ManHinhLaiXe §2.3).
//
// Stack LOCAL (không đụng staging — staging immutable):
//   frontend http://localhost:7177  (worktree verify-dri-mobile, vite)
//   backend  http://localhost:3003  (worktree verify-dri-mobile, tsx)
//   DB       ss-prod-db :5441/silversea, Redis :6391
//
// Scenario data là mutation QA CỤC BỐ (mọi mục mang prefix DRI-<serial>):
//   user DRIVER `bqhuong` (tạo local nếu chưa có) + xe QA riêng + nhà máy
//   "NM DRI <serial>" (có SĐT kho + 2 liên hệ, 1 số dạng chấm) + bãi hạ
//   "Bãi Hạ DRI <serial>".
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.DRI_FRONTEND_URL ?? 'http://localhost:7177';
const API = process.env.DRI_API_URL ?? 'http://localhost:3003/api';
const ART = 'qa/2026-10-21-dri-mobile';
const LOG = `${ART}/ui-driver.log`;
const SERIAL = process.env.DRI_SERIAL ?? `${Date.now().toString(36).slice(-5)}${Math.floor(Math.random() * 1e4)}`;
const PASSWORD = 'Abc123';

mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} serial=${SERIAL} ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// ─── API helpers ─────────────────────────────────────────────────────────────
async function api(token, method, p, body) {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method !== 'GET' ? { 'Idempotency-Key': crypto.randomUUID() } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (!res.ok) throw new Error(`${method} ${p} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  return parsed;
}
const login = async (identifier, password = PASSWORD) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`login ${identifier} failed: HTTP ${res.status}`);
  return body;
};
const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-tAc', sql], { maxBuffer: 16 * 1024 * 1024 }).toString().trim();
/** Mã container ISO 6346 hợp lệ (check digit đúng). */
function isoContainerNumber(seed) {
  const serial = seed.replace(/[^0-9]/g, '').padStart(6, '0').slice(-6);
  const base = `DRIM${serial}`;
  const letterValues = [10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 34, 35, 36, 37, 38];
  const sum = [...`${base}000000`.slice(0, 10)].reduce((acc, ch, i) => {
    const code = ch.charCodeAt(0);
    const v = code >= 48 && code <= 57 ? code - 48 : letterValues[code - 65];
    return acc + v * 2 ** i;
  }, 0);
  return `${base}${sum % 11 % 10}`;
}

// ─── Scenario setup (local QA mutations) ─────────────────────────────────────
const admin = await login('admin');
const adminToken = admin.token;
log(`login admin: OK`);

const catalog = {
  customerId: (await api(adminToken, 'GET', '/customers?page=1&limit=5')).items?.[0]?.id ?? 1,
  containerTypeId20: (await api(adminToken, 'GET', '/container-types')).items?.find((c) => c.code === '20DC')?.id ?? 1,
  routeId: (await api(adminToken, 'GET', '/routes')).items?.[0]?.id ?? 1,
  pickupPortId: (await api(adminToken, 'GET', '/ports')).items?.[0]?.id ?? 1,
};
log(`catalog: ${JSON.stringify(catalog)}`);

// 1) Bãi hạ (dropoff port) riêng cho scenario — tên tự mô tả trong ảnh.
const baiHaName = `Bãi Hạ DRI ${SERIAL}`;
let baiHa = null;
const baiHaId = psql(`SELECT id FROM ports WHERE name = '${baiHaName.replace(/'/g, "''")}' ORDER BY id LIMIT 1;`);
if (baiHaId) baiHa = { id: Number(baiHaId), name: baiHaName };
else baiHa = await api(adminToken, 'POST', '/ports', { name: baiHaName });
log(`bãi hạ port: id=${baiHa.id} name="${baiHa.name}"`);

// 2) Nhà máy (operational site) — có SĐT kho + 2 liên hệ (1 số dạng chấm).
const siteName = `NM DRI ${SERIAL}`;
const siteAddress = 'Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh';
const khoPhone = '02253555555';
const contactDottedPhone = '0909.000.001';
const site = await api(adminToken, 'POST', '/shipments/operational-sites', {
  customerId: catalog.customerId,
  code: `DRI-SITE-${SERIAL}`,
  name: siteName,
  shortName: siteName,
  siteType: 'FACTORY',
  routeId: catalog.routeId,
  address: siteAddress,
  contactName: 'Chị An',
  contactPhone: khoPhone,
  contacts: [
    { name: 'Chị An', phone: khoPhone, isDefault: true },
    { name: 'Bảo vệ kho', phone: contactDottedPhone, isDefault: false },
  ],
  isActive: true,
});
log(`nhà máy: id=${site.id} name="${site.name}" khoPhone=${khoPhone}`);

// 3) Tài xế `bqhuong` (DRIVER) — tạo local nếu chưa có.
//    Tài khoản DRIVER KHÔNG tự sinh hồ sơ drivers — Admin phải bind riêng
//    (POST /api/config/driver-user-bindings/:driverId).
let driverSession = null;
try { driverSession = await login('bqhuong'); } catch { /* tạo mới */ }
if (!driverSession) {
  const created = await api(adminToken, 'POST', '/auth/users', {
    username: 'bqhuong', fullName: 'Bùi Quang Hương', password: PASSWORD, role: 'DRIVER',
  });
  log(`tạo user DRIVER bqhuong: id=${created.user?.id ?? created.id}`);
  driverSession = await login('bqhuong');
}
const driverUserId = driverSession.user.userId ?? driverSession.user.id;
const boundDriverId = psql(`SELECT id FROM drivers WHERE user_id = ${driverUserId} AND deleted_at IS NULL ORDER BY id LIMIT 1;`);
let driverId = boundDriverId ? Number(boundDriverId) : null;
if (!driverId) {
  const created = await api(adminToken, 'POST', '/drivers', {
    name: 'Bùi Quang Hương', phone: '0900000099', status: 'ACTIVE',
  });
  const expectedVersion = Math.max(1, Date.parse(created.updatedAt));
  const bound = await api(adminToken, 'POST', `/config/driver-user-bindings/${created.id}`, {
    userId: driverUserId, expectedVersion,
  });
  driverId = bound.driverId;
  log(`bind driver ${driverId} ↔ user bqhuong (${driverUserId}): OK`);
}
log(`driver bqhuong: driverId=${driverId} userId=${driverUserId}`);

// 4) Xe QA riêng cho scenario (không cướp xe của tài xế khác) + rơ-moóc
//    (đầu kéo không có rơ-moóc thì dispatch bị chặn 409).
const plate = `QA-DRI-${SERIAL}`;
const truckIdByPlate = psql(`SELECT id FROM trucks WHERE license_plate = '${plate}' ORDER BY id LIMIT 1;`);
let truck = truckIdByPlate
  ? { id: Number(truckIdByPlate), licensePlate: plate }
  : await api(adminToken, 'POST', '/trucks', { licensePlate: plate, status: 'ACTIVE' });
await api(adminToken, 'PATCH', `/shipments/dispatch-fleet/trucks/${truck.id}/assigned-driver`, { driverId });

const trailerPlate = `RM-DRI-${SERIAL}`;
const trailerIdByPlate = psql(`SELECT id FROM trailers WHERE license_plate = '${trailerPlate}' ORDER BY id LIMIT 1;`);
const trailerId = trailerIdByPlate
  ? Number(trailerIdByPlate)
  : (await api(adminToken, 'POST', '/trailers', { licensePlate: trailerPlate, type: '20FT', status: 'ACTIVE' })).id;
log(`xe QA: id=${truck.id} plate=${plate} → driver ${driverId} · rơ-moóc id=${trailerId}`);

// 5) Hai lô FCL IMPORT trên xe này.
//    Lot A — container CÓ bãi hạ  → dri-01 (SĐT) + dri-04 nhánh "có bãi hạ".
//    Lot B — container KHÔNG bãi hạ → dri-04 nhánh portless (FB-020).
// Khung giờ riêng cho từng lô: cùng một xe, hai lô KHÔNG được trùng khung
// (rig-guard chặn 409). Slot = customerAppointmentAt (cửa sổ 8h theo luật
// card 363) → lô B lệch 1 ngày so với lô A.
const p2 = (n) => String(n).padStart(2, '0');
// Mỗi run chiếm 2 ngày liên tiếp (A, B) — stride 2 để các run trước đó
// (fixture còn sống trong DB local) không trùng ngày với run này: cả lô A và
// lô B đều đi trên cùng xe + cùng tài xế nên phải khác ngày lẫn nhau.
const runIndex = Math.floor(Date.now() / 60_000) % 1000;
const dayBase = 2 * runIndex;
const winFor = (offsetDays) => {
  const start = new Date(Date.UTC(2027, 0, 1) + (dayBase + offsetDays) * 86_400_000);
  const end = new Date(start.getTime() + 2 * 3600_000);
  const iso = (d) => `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:00+00:00`;
  return { start: iso(start), end: iso(end), appointment: iso(start) };
};
const winA = winFor(0);
const winB = winFor(1);
log(`khung giờ: A=${winA.start} B=${winB.start}`);

async function createLot(bill, { withBaiHa, win }) {
  const shipment = await api(adminToken, 'POST', '/shipments/quick', {
    customerId: catalog.customerId,
    blNumber: bill,
    tradeDirection: 'IMPORT',
    cargoMode: 'FCL',
    contactName: 'Chị An',
    contactPhone: contactDottedPhone,
    containers: [{
      containerTypeId: catalog.containerTypeId20,
      containerNumber: isoContainerNumber(bill.replace(/[^0-9]/g, '') + (withBaiHa ? '1' : '2')),
      operationalSiteId: site.id,
      routeId: catalog.routeId,
      pickupPortId: catalog.pickupPortId,
      ...(withBaiHa ? { dropoffPortId: baiHa.id } : {}),
      cargoWeightKg: 15000,
      customerAppointmentAt: win.appointment,
    }],
  });
  const planRow = (await api(adminToken, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=${encodeURIComponent(bill)}`)).items?.[0];
  if (!planRow) throw new Error(`không có plan row cho ${bill}`);
  const planned = await api(adminToken, 'PATCH', `/shipments/dispatch-detail-plan-rows/${planRow.fulfillmentId}/plan`, {
    expectedFulfillmentVersion: planRow.version,
    expectedShipmentVersion: planRow.shipmentVersion,
    carrierType: 'OWN',
    truckId: truck.id,
    classification: 'SINGLE',
    plannedRevenue: 2500000,
    plannedCarrierCost: 1800000,
  });
  const fresh = (await api(adminToken, 'GET', `/shipments/dispatch-detail-plan-rows?page=1&limit=50&q=${encodeURIComponent(bill)}`)).items?.[0];
  const issued = await api(adminToken, 'POST', `/shipments/${shipment.id}/dispatch`, {
    fulfillmentId: fresh.fulfillmentId,
    expectedVersion: fresh.version,
    plannedStartAt: win.start,
    plannedEndAt: win.end,
    endTimeConfirmed: false,
    carrierType: 'OWN',
    truckId: truck.id,
    trailerId,
    driverId,
  });
  return { shipment, planRow: fresh, planned, tripId: issued.trip?.id ?? null, tripStatus: issued.trip?.status ?? null };
}

const lotA = await createLot(`DRI-${SERIAL}-A`, { withBaiHa: true, win: winA });
const lotB = await createLot(`DRI-${SERIAL}-B`, { withBaiHa: false, win: winB });
if (!lotA.tripId || !lotB.tripId) throw new Error('dispatch không trả trip id');
log(`trip A (có bãi hạ): ${lotA.tripId} status=${lotA.tripStatus} · trip B (portless): ${lotB.tripId} status=${lotB.tripStatus}`);

// ─── DB evidence (side-effect proof) ─────────────────────────────────────────
const dbEvidence = [
  '=== scenario constants ===',
  `serial=${SERIAL} driver=bqhuong(driverId=${driverId}) truck=${plate}(id=${truck.id})`,
  `site=id ${site.id} "${site.name}" · bãi hạ port=id ${baiHa.id} "${baiHa.name}"`,
  `khoPhone=${khoPhone} · SĐT liên hệ (shipment contactPhone)=${contactDottedPhone}`,
  '',
  '=== trips + container points (A: có bãi hạ / B: portless) ===',
  psql(`SELECT t.id AS trip, t.status, t.driver_id, f.shipment_id, sc.container_number,
       sc.dropoff_port_id, p.name AS dropoff_port_name, sc.operational_site_id, os.name AS site_name
     FROM trips t
     JOIN shipment_fulfillments f ON f.id = t.fulfillment_id
     JOIN shipment_containers sc ON sc.id = f.shipment_container_id
     LEFT JOIN ports p ON p.id = sc.dropoff_port_id
     LEFT JOIN operational_sites os ON os.id = sc.operational_site_id
     WHERE t.id IN (${lotA.tripId}, ${lotB.tripId}) ORDER BY t.id;`),
  '',
  '=== shipment contact vs site phone (SĐT liên hệ ≠ SĐT kho) ===',
  psql(`SELECT s.id AS shipment, s.bl_number, s.contact_name, s.contact_phone, os.contact_phone AS site_phone
     FROM shipments s
     JOIN shipment_containers sc ON sc.shipment_id = s.id
     JOIN operational_sites os ON os.id = sc.operational_site_id
     WHERE sc.id IN (SELECT shipment_container_id FROM shipment_fulfillments
                      WHERE id IN (${lotA.planRow.fulfillmentId}, ${lotB.planRow.fulfillmentId}))
     ORDER BY s.id;`),
  '',
  '=== operational site contacts (2 liên hệ, 1 số dạng chấm) ===',
  psql(`SELECT id, name, contact_name, contact_phone, contacts::text FROM operational_sites WHERE id = ${site.id};`),
].join('\n');
writeFileSync(`${ART}/db-evidence.txt`, `${dbEvidence}\n`);
log(`db-evidence.txt written (${dbEvidence.split('\n').length} lines)`);

// ─── UI drive (390px) ────────────────────────────────────────────────────────
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), driverSession.token);
page.on('dialog', (d) => void d.accept());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readFacts = () => page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const rows = {};
  for (const f of facts) {
    const label = f.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? '';
    const valueEl = f.querySelector('.driver-task-fact__value');
    const tel = valueEl?.querySelector('a[href^="tel:"]');
    rows[label] = {
      text: valueEl?.textContent?.trim() ?? '',
      telHref: tel?.getAttribute('href') ?? null,
      isTelLink: Boolean(tel),
    };
  }
  return rows;
});

async function openTrip(tripId) {
  await page.goto(`${BASE}/my-trips/${tripId}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.driver-task-fact').length > 0, { timeout: 40_000 });
  await sleep(500);
}

// ── dri-01 + dri-04 (A) ──────────────────────────────────────────────────────
await openTrip(lotA.tripId);
check('A: màn NHẬN LỆNH lái xe mở được (không bounce /login)', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);
const rowsA = await readFacts();
log(`A rows: ${JSON.stringify(rowsA)}`);

check('dri-01: dòng "SĐT kho" là <a href="tel:…">', rowsA['SĐT kho']?.isTelLink === true, JSON.stringify(rowsA['SĐT kho']));
check('dri-01: href SĐT kho = tel:02253555555', rowsA['SĐT kho']?.telHref === 'tel:02253555555', `href=${rowsA['SĐT kho']?.telHref}`);
check('dri-01: dòng "SĐT liên hệ" là <a href="tel:…">', rowsA['SĐT liên hệ']?.isTelLink === true, JSON.stringify(rowsA['SĐT liên hệ']));
check('dri-01: href SĐT liên hệ chuẩn hóa dấu chấm = tel:0909000001', rowsA['SĐT liên hệ']?.telHref === 'tel:0909000001', `href=${rowsA['SĐT liên hệ']?.telHref}`);
check('dri-01: text hiển thị giữ nguyên dấu chấm', rowsA['SĐT liên hệ']?.text === contactDottedPhone, `text=${rowsA['SĐT liên hệ']?.text}`);
check('dri-04: "Cảng hạ" = tên bãi hạ (container CÓ bãi hạ)', rowsA['Cảng hạ']?.text === baiHa.name, `cangHa=${rowsA['Cảng hạ']?.text}`);
check('dri-04: "Địa chỉ giao hàng" = nhà máy + địa chỉ (điểm nhận)', (rowsA['Địa chỉ giao hàng']?.text ?? '').includes(siteName) && (rowsA['Địa chỉ giao hàng']?.text ?? '').includes('Khu 2, Phường Võ Cường'), `diaChi=${rowsA['Địa chỉ giao hàng']?.text}`);
check('dri-04: Cảng hạ ≠ Địa chỉ giao hàng (không đổ lẫn)', rowsA['Cảng hạ']?.text !== rowsA['Địa chỉ giao hàng']?.text, `cangHa=${rowsA['Cảng hạ']?.text} | diaChi=${rowsA['Địa chỉ giao hàng']?.text}`);
await page.screenshot({ path: `${ART}/ui-1-tripA-nhan-lenh-390.png`, fullPage: false });
await page.screenshot({ path: `${ART}/ui-1b-tripA-full-390.png`, fullPage: true });
log('shot ui-1-tripA-nhan-lenh-390.png + ui-1b-tripA-full-390.png (390px — THÔNG TIN LỆNH: SĐT kho / SĐT liên hệ / Cảng hạ / Địa chỉ giao hàng)');
// Cận cảnh 2 hàng Cảng hạ / Địa chỉ giao hàng (scroll tới vùng grid).
await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const target = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === 'Cảng hạ');
  target?.scrollIntoView({ block: 'center' });
});
await sleep(400);
await page.screenshot({ path: `${ART}/ui-1c-tripA-cang-ha-rows-390.png`, fullPage: false });
log('shot ui-1c-tripA-cang-ha-rows-390.png (390px — cận cảnh Cảng hạ + Địa chỉ giao hàng, trip có bãi hạ)');

// Modal "Chọn liên hệ để gọi" — số hiển thị cũng là link tel:
const barButton = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('.driver-task-call-bar button, .driver-task-call-bar a')].find((b) => (b.textContent || '').includes('Gọi kho'));
  if (!btn) return { found: false };
  btn.click();
  return { found: true, tag: btn.tagName.toLowerCase(), href: btn.getAttribute('href') };
});
check('dri-01: có affordance "Gọi kho" trên màn nhận lệnh', barButton.found === true, JSON.stringify(barButton));
await page.waitForFunction(() => document.body?.innerText.includes('Chọn liên hệ để gọi'), { timeout: 20_000 });
await sleep(500);
const modal = await page.evaluate(() => {
  const dialog = [...document.querySelectorAll('[role="dialog"], .modal, [class*="modal"]')].find((m) => (m.textContent || '').includes('Chọn liên hệ để gọi'));
  if (!dialog) return null;
  return [...dialog.querySelectorAll('.site-contact-list__row')].map((row) => {
    const tel = row.querySelector('a.site-contact-list__phone[href^="tel:"]');
    const goi = [...row.querySelectorAll('a, button')].find((el) => (el.textContent || '').trim() === 'Gọi');
    return {
      name: row.querySelector('.site-contact-list__identity > span')?.textContent?.trim() ?? '',
      numberText: tel?.textContent?.trim() ?? row.querySelector('.site-contact-list__phone')?.textContent?.trim() ?? '',
      telHref: tel?.getAttribute('href') ?? null,
      numberIsLink: Boolean(tel),
      goiHref: goi?.getAttribute('href') ?? null,
    };
  });
});
check('dri-01: modal liệt kê 2 liên hệ nhà máy', Array.isArray(modal) && modal.length === 2, JSON.stringify(modal));
const an = modal?.find((r) => r.name.includes('Chị An'));
const baoVe = modal?.find((r) => r.name.includes('Bảo vệ kho'));
check('dri-01: số liên hệ 1 là link tel:02253555555', an?.numberIsLink === true && an?.telHref === 'tel:02253555555', JSON.stringify(an));
check('dri-01: số liên hệ 2 giữ dấu chấm trên màn, href tel:0909000001', baoVe?.numberText === contactDottedPhone && baoVe?.telHref === 'tel:0909000001', JSON.stringify(baoVe));
check('dri-01: nút Gọi bên cạnh vẫn là tel: link', modal?.every((r) => (r.goiHref ?? '').startsWith('tel:')) === true, `goiHrefs=${modal?.map((r) => r.goiHref).join(', ')}`);
await page.screenshot({ path: `${ART}/ui-2-call-modal-tel-links-390.png`, fullPage: false });
log('shot ui-2-call-modal-tel-links-390.png (390px — modal Chọn liên hệ để gọi)');

// ── dri-04 (B) — portless: Cảng hạ = điểm trả (FB-020) ──────────────────────
await openTrip(lotB.tripId);
const rowsB = await readFacts();
log(`B rows: ${JSON.stringify(rowsB)}`);
check('dri-04(B): "Cảng hạ" = tên điểm trả (nhà máy) — không phải "Chưa có cảng hạ"', rowsB['Cảng hạ']?.text === siteName, `cangHa=${rowsB['Cảng hạ']?.text}`);
check('dri-04(B): "Địa chỉ giao hàng" = nhà máy đầy đủ + địa chỉ', (rowsB['Địa chỉ giao hàng']?.text ?? '').includes(siteName) && (rowsB['Địa chỉ giao hàng']?.text ?? '').includes('Khu 2, Phường Võ Cường'), `diaChi=${rowsB['Địa chỉ giao hàng']?.text}`);
check('dri-04(B): hai điểm là cùng một nơi → hai hàng cùng tên (PRD §2.3)', rowsB['Cảng hạ']?.text === siteName && (rowsB['Địa chỉ giao hàng']?.text ?? '').startsWith(siteName), `cangHa=${rowsB['Cảng hạ']?.text} | diaChi=${rowsB['Địa chỉ giao hàng']?.text}`);
await page.screenshot({ path: `${ART}/ui-3-tripB-portless-cang-ha-390.png`, fullPage: false });
await page.screenshot({ path: `${ART}/ui-3b-tripB-full-390.png`, fullPage: true });
log('shot ui-3-tripB-portless-cang-ha-390.png + ui-3b-tripB-full-390.png (390px — trip B portless)');
// Cận cảnh 2 hàng Cảng hạ / Địa chỉ giao hàng (scroll tới vùng grid).
await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  const target = facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === 'Cảng hạ');
  target?.scrollIntoView({ block: 'center' });
});
await sleep(400);
await page.screenshot({ path: `${ART}/ui-3c-tripB-cang-ha-rows-390.png`, fullPage: false });
log('shot ui-3c-tripB-cang-ha-rows-390.png (390px — cận cảnh Cảng hạ + Địa chỉ giao hàng)');

await browser.close();
log(`tripA=${lotA.tripId} tripB=${lotB.tripId} site=${site.id} baiHa=${baiHa.id}`);
log(failures === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
