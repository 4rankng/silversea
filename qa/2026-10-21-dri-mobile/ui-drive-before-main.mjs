// "TRƯỚC" state — cùng bộ assert dri-01/dri-04 nhưng chạy trên STACK CHUẨN
// của cây main (frontend :7175 → backend :3002), tức code lái xe đúng bằng
// `main` (đã diff: frontend/src/pages/driver/**, TelLink, OperationalSiteContactsList,
// liftDropPoints, driverClient — IDENTICAL giữa cây stock và worktree verify-dri-mobile).
//
// Mục đích: chứng minh "trước" == "sau". Không có fix nào được áp dụng (cả hai
// mục đã có sẵn trên main), nên trạng thái trước và sau phải giống hệt —
// script này drive chính xác các trip đã tạo ở qa/2026-10-21-dri-mobile/ui-drive.mjs
// trên stack chuẩn và chứng minh điều đó.
//
// Trip dùng lại: DRI_TRIPS="<tripA>,<tripB>" (xem db-evidence.txt).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.DRI_FRONTEND_URL ?? 'http://localhost:7175';
const API = process.env.DRI_API_URL ?? 'http://localhost:3002/api';
const ART = 'qa/2026-10-21-dri-mobile';
const LOG = `${ART}/ui-driver-before-main.log`;
const PASSWORD = 'Abc123';
const [TRIP_A, TRIP_B] = (process.env.DRI_TRIPS ?? '').split(',').map(Number);
if (!TRIP_A || !TRIP_B) throw new Error('cần DRI_TRIPS="<tripA>,<tripB>"');

mkdirSync(ART, { recursive: true });
const log = (line) => { const t = `${new Date().toISOString()} ${line}`; console.log(t); appendFileSync(LOG, `${t}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} base=${BASE} trips=${TRIP_A},${TRIP_B} ===\n`);

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-tAc', sql], { maxBuffer: 16 * 1024 * 1024 }).toString().trim();

// Kỳ vọng đọc thẳng từ DB (không hard-code) — cùng nguồn với db-evidence.txt.
const fact = psql(`SELECT sc.dropoff_port_id, p.name, os.name, os.contact_phone, os.address, s.contact_phone
  FROM trips t
  JOIN shipment_fulfillments f ON f.id = t.fulfillment_id
  JOIN shipment_containers sc ON sc.id = f.shipment_container_id
  LEFT JOIN ports p ON p.id = sc.dropoff_port_id
  JOIN operational_sites os ON os.id = sc.operational_site_id
  JOIN shipments s ON s.id = f.shipment_id
  WHERE t.id = ${TRIP_A};`).split('|');
const [dropoffPortId, baiHaName, siteName, khoPhone, siteAddress, contactPhone] = fact;

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'bqhuong', password: PASSWORD }),
});
const { token } = await login.json();
if (!token) { log('FAIL login bqhuong'); process.exit(1); }
log(`login bqhuong: OK · base=${BASE}`);
log(`kỳ vọng: bãi hạ=${baiHaName} · nhà máy=${siteName} · SĐT kho=${khoPhone} · SĐT liên hệ=${contactPhone}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 390, height: 844, isMobile: true, hasTouch: true },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const readFacts = () => page.evaluate(() => {
  const rows = {};
  for (const f of document.querySelectorAll('.driver-task-fact')) {
    const label = f.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? '';
    const valueEl = f.querySelector('.driver-task-fact__value');
    const tel = valueEl?.querySelector('a[href^="tel:"]');
    rows[label] = { text: valueEl?.textContent?.trim() ?? '', telHref: tel?.getAttribute('href') ?? null, isTelLink: Boolean(tel) };
  }
  return rows;
});
async function openTrip(id) {
  await page.goto(`${BASE}/my-trips/${id}`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll('.driver-task-fact').length > 0, { timeout: 40_000 });
  await sleep(500);
}

// Trip A — dri-01 (tel:) + dri-04 (có bãi hạ)
await openTrip(TRIP_A);
const rowsA = await readFacts();
check('TRƯỚC: màn nhận lệnh lái xe mở được (không bounce /login)', await page.evaluate(() => !document.body.innerText.includes('Đăng nhập')), `url=${page.url()}`);
check('TRƯỚC dri-01: "SĐT kho" là <a href="tel:…">', rowsA['SĐT kho']?.isTelLink === true, JSON.stringify(rowsA['SĐT kho']));
check('TRƯỚC dri-01: href SĐT kho = tel:02253555555', rowsA['SĐT kho']?.telHref === `tel:${String(khoPhone).replace(/[\s.]+/g, '')}`, `href=${rowsA['SĐT kho']?.telHref}`);
check('TRƯỚC dri-01: "SĐT liên hệ" là <a href="tel:…">', rowsA['SĐT liên hệ']?.isTelLink === true, JSON.stringify(rowsA['SĐT liên hệ']));
check('TRƯỚC dri-01: href SĐT liên hệ đã bỏ dấu chấm', rowsA['SĐT liên hệ']?.telHref === `tel:${String(contactPhone).replace(/[\s.]+/g, '')}`, `href=${rowsA['SĐT liên hệ']?.telHref}`);
check('TRƯỚC dri-04: "Cảng hạ" = tên bãi hạ', rowsA['Cảng hạ']?.text === baiHaName, `cangHa=${rowsA['Cảng hạ']?.text}`);
check('TRƯỚC dri-04: "Địa chỉ giao hàng" = nhà máy + địa chỉ', (rowsA['Địa chỉ giao hàng']?.text ?? '').includes(siteName) && (rowsA['Địa chỉ giao hàng']?.text ?? '').includes(siteAddress), `diaChi=${rowsA['Địa chỉ giao hàng']?.text}`);
await page.screenshot({ path: `${ART}/ui-0-before-main-tripA-390.png`, fullPage: false });
await page.evaluate(() => {
  const facts = [...document.querySelectorAll('.driver-task-fact')];
  facts.find((f) => f.querySelector('.driver-task-fact__label')?.textContent?.trim() === 'Cảng hạ')?.scrollIntoView({ block: 'center' });
});
await sleep(400);
await page.screenshot({ path: `${ART}/ui-0b-before-main-tripA-cang-ha-rows-390.png`, fullPage: false });
log('shot ui-0-before-main-tripA-390.png + ui-0b-before-main-tripA-cang-ha-rows-390.png (stack chuẩn :7175)');

// Trip B — dri-04 nhánh portless
await openTrip(TRIP_B);
const rowsB = await readFacts();
check('TRƯỚC dri-04(B): "Cảng hạ" = tên điểm trả (không phải "Chưa có cảng hạ")', rowsB['Cảng hạ']?.text === siteName, `cangHa=${rowsB['Cảng hạ']?.text}`);
check('TRƯỚC dri-04(B): "Địa chỉ giao hàng" = nhà máy đầy đủ + địa chỉ', (rowsB['Địa chỉ giao hàng']?.text ?? '').includes(siteName) && (rowsB['Địa chỉ giao hàng']?.text ?? '').includes(siteAddress), `diaChi=${rowsB['Địa chỉ giao hàng']?.text}`);
await page.screenshot({ path: `${ART}/ui-0c-before-main-tripB-390.png`, fullPage: false });
log('shot ui-0c-before-main-tripB-390.png (stack chuẩn :7175)');

await browser.close();
log(failures === 0 ? 'RESULT: ALL CHECKS PASS' : `RESULT: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
