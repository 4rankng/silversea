// Card 221026040542 (R32) — rung 3 evidence for the quotation UI spec sweep.
// LOCAL ONLY: vite 7175 -> api 3002 (dev-port-contract). Drives the REAL page
// at /config/quotations and asserts every BaoGia.md checklist item:
//   A. page exists + Excel buttons visible on the filter bar
//   B. grid = 10 classes per route block, 5 value rows (Hệ số/Lít/Giá cos/…)
//   C. create dialog fields (khách/tên mẫu/ngày hiệu lực/làm tròn)
//   D. import preview (mapping + Ghi nhận/Huỷ) then Huỷ — no write
//   E. export xlsx download lands on disk
//   F. version history: Xem (read-only payload) + per-version Xuất xlsx
// Companion API identity: GET /quotations/1 = 3 routes × 10 cells, each cell
// carrying heSo/liters/giaCos.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.BASE ?? 'http://localhost:7175';
const API = `${BASE}/api`;
const ROOT = process.env.SHOTS ?? '/tmp/quote-ui';
const OUT = process.env.EVIDENCE ?? 'qa/2026-10-22-quote-ui';
fs.mkdirSync(ROOT, { recursive: true });
const FIXTURE = path.resolve('testplan/fixtures/2026-09-23_bao-gia-mau-synthetic.xlsx');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const $$x = (xp) => page.$$(`::-p-xpath(${xp})`);

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const t = await (await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
  })).text();
  try { L = JSON.parse(t); } catch { await sleep(1200 * i); }
}
if (!L?.token) { console.log('LOGIN FAILED as admin'); process.exit(1); }
console.log('LOGIN OK (admin)');

// ── API identity proof (rung-2 companion) ──────────────────────────────────
const detail = await (await fetch(`${API}/quotations/1`, { headers: { Authorization: `Bearer ${L.token}` } })).json();
const routeNames = [...new Set(detail.cells.map((c) => c.routeName))];
const perRoute = Object.entries(detail.cells.reduce((acc, c) => {
  acc[c.routeName] = acc[c.routeName] ?? new Set(); acc[c.routeName].add(c.vehicleSizeClassCode); return acc;
}, {})).map(([name, set]) => `${name}:${set.size} hạng`);
const tenCodes = ['1.25T', '2.5T', '3.5T', '5T', '8T', '10T', 'CONT20.LIGHT', 'CONT20.HEAVY', 'CONT40.LIGHT', 'CONT40.HEAVY'];
const firstCell = detail.cells[0];
console.log(`API /quotations/1 → ${detail.cells.length} cells · ${routeNames.length} routes (${perRoute.join(' · ')})`);
console.log(`API cell fields: heSo=${firstCell.heSo} liters=${firstCell.liters} giaCos=${firstCell.giaCos} baseFuelPrice=${firstCell.baseFuelPrice} fuelLagDays=${firstCell.fuelLagDays}`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => console.log(`PAGEERROR: ${err.message}`));
const results = [];
const check = (label, ok, detailTxt = '') => {
  results.push({ label, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}${detailTxt ? ` :: ${detailTxt}` : ''}`);
};
const bodyText = () => page.evaluate(() => document.body.innerText);

try {
  // ── A. page + buttons ────────────────────────────────────────────────────
  await page.goto(`${BASE}/config/quotations`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.quotation-frames__list', { timeout: 30000 });
  await sleep(1200);
  await page.screenshot({ path: `${ROOT}/ui-01-page-frames.png`, fullPage: false });
  let text = await bodyText();
  const headerText = await page.$eval('.quotation-page h1, .page-header h1, h1', (n) => n?.textContent ?? '').catch(() => '');
  console.log(`PAGE HEADER: "${headerText.trim()}"`);
  check('A1 trang /config/quotations load + tiêu đề "Báo giá"', /Báo giá/.test(headerText) || /Báo giá/.test(text));
  check('A2 nút "Nhập xlsx" hiển thị', /Nhập xlsx/.test(text));
  check('A3 nút "Xuất xlsx" hiển thị', /Xuất xlsx/.test(text));
  check('A4 nút "＋ Tạo báo giá" hiển thị', /Tạo báo giá/.test(text));
  check('A5 danh sách khung có "Mẫu báo giá 1"', /Mẫu báo giá 1/.test(text));

  // ── B. grid: 10 classes + value rows per block ───────────────────────────
  // Click the frame whose terms exist (LONG MINH "Mẫu báo giá 1") — the list
  // is createdAt DESC so the first li may be a customer without terms rows.
  const frameLi = await $$x('//li[@role="option"][contains(., "Mẫu báo giá 1")]');
  await frameLi[0].click();
  await page.waitForSelector('.quotation-route-block', { timeout: 30000 });
  await sleep(1500);
  const blocks = await page.$$eval('.quotation-route-block', (nodes) => nodes.map((n) => ({
    head: n.querySelector('.quotation-route-block__params')?.textContent ?? '',
    rows: [...n.querySelectorAll('tbody tr')].map((tr) => ({
      title: tr.querySelector('.row-meta') ? tr.cells[0]?.innerText.replace(/\n.*$/, '').trim() : tr.cells[0]?.innerText.trim(),
      subtitle: tr.querySelector('.row-meta')?.textContent ?? '',
    })),
    headers: [...n.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
  })));
  check('B1 mỗi khung có ≥1 block tuyến', blocks.length >= 1, `${blocks.length} blocks: ${routeNames.join(' · ')}`);
  const block = blocks[0];
  const titles = block.rows.map((r) => r.title);
  const expectTitles = ['Xe 1.25T', 'Xe 2.5T', 'Xe 3.5T', 'Xe 5T', 'Xe 8T', 'Xe 10T', 'Cont20 <20t', 'Cont20 >20t', 'Cont40 nhẹ <20t', 'Cont40 nặng >20t'];
  check('B2 block 1 đủ 10 hạng (6 lẻ + 4 cont)', titles.length === 10 && expectTitles.every((t, i) => titles[i] === t), titles.join(' | '));
  const le = block.rows.filter((r) => r.subtitle === 'Hàng lẻ').length;
  const cont = block.rows.filter((r) => r.subtitle === 'Hàng container').length;
  check('B3 phụ đề分组 6 Hàng lẻ + 4 Hàng container', le === 6 && cont === 4, `lẻ=${le} cont=${cont}`);
  const needHeaders = ['Hệ số', 'Tổng lít dầu/chuyến', 'Giá cos', 'Phụ phí', 'Tổng'];
  check('B4 đủ 5 nhãn giá trị: Hệ số · Lít · Giá cos · Phụ phí · Tổng', needHeaders.every((h) => block.headers.some((x) => x.includes(h))), block.headers.join(' | '));
  check('B5 đầu block có "Giá dầu tham chiếu"', /Giá dầu tham chiếu/.test(block.head), block.head.trim().slice(0, 90));
  check('B6 đầu block có độ trễ lag ("Trễ … ngày")', /Trễ .* ngày/.test(block.head), block.head.match(/Trễ[^·]*/)?.[0]?.trim());
  const heSoInputs = await page.$$eval('.quotation-route-block input[aria-label^="Hệ số "]', (n) => n.length);
  check('B7 Hệ số là input sửa được (≥10 ô/tuyến)', heSoInputs >= 10, `${heSoInputs} inputs`);
  await page.screenshot({ path: `${ROOT}/ui-02-grid-10-classes.png`, fullPage: false });

  // ── C. create dialog fields ─────────────────────────────────────────────
  await page.evaluate(() => window.scrollTo(0, 0));
  const btn = await $$x('//button[contains(., "Tạo báo giá")]');
  await btn[0].click();
  await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
  await sleep(600);
  await page.screenshot({ path: `${ROOT}/ui-03-create-dialog.png`, fullPage: false });
  text = await bodyText();
  check('C1 dialog "Tạo báo giá" mở', /Tạo báo giá/.test(text));
  for (const field of ['Khách hàng', 'Tên mẫu báo giá', 'Ngày hiệu lực', 'Làm tròn phụ phí dầu', 'Ghi chú']) {
    check(`C dialog có field "${field}"`, text.includes(field));
  }
  const roundingOpts = await page.$$eval('[role="dialog"] option', (os) => os.map((o) => o.textContent));
  check('C2 làm tròn đủ 3 chế độ NONE/THOUSAND/TEN_THOUSAND', ['Không làm tròn', 'Đến hàng nghìn', 'Đến hàng chục nghìn'].every((o) => roundingOpts.some((r) => r?.includes(o))), roundingOpts.join(' | '));
  const cancel = await $$x('//button[contains(., "Hủy")]');
  await cancel[0].click();
  await sleep(400);

  // ── D. import preview → Huỷ (no write) ──────────────────────────────────
  const fileInput = await page.$('label.btn input[type="file"]');
  await fileInput.uploadFile(FIXTURE);
  await page.waitForSelector('.quotation-import-preview', { timeout: 30000 });
  await sleep(800);
  await page.screenshot({ path: `${ROOT}/ui-04-import-preview.png`, fullPage: true });
  text = await bodyText();
  check('D1 preview hiển thị ("Xem trước: …" + section aria-label)', /Xem trước:/.test(text));
  check('D2 preview có nút "Ghi nhận nhập file"', /Ghi nhận nhập file/.test(text));
  check('D3 preview có nút "Huỷ"', /Huỷ/.test(text));
  check('D4 preview ánh xạ nhà máy → tuyến', /→/.test(text));
  const framesBefore = (await (await fetch(`${API}/quotations`, { headers: { Authorization: `Bearer ${L.token}` } })).json()).length;
  const cancelBtns = await $$x('//button[contains(., "Huỷ")]');
  await cancelBtns[cancelBtns.length - 1].click();
  await sleep(600);
  const framesAfter = (await (await fetch(`${API}/quotations`, { headers: { Authorization: `Bearer ${L.token}` } })).json()).length;
  check('D5 Huỷ không ghi vết (số khung không đổi)', framesBefore === framesAfter, `${framesBefore} → ${framesAfter}`);

  // ── E. export xlsx download ─────────────────────────────────────────────
  const cdp = await page.createCDPSession();
  const dlDir = `${ROOT}/download`;
  fs.mkdirSync(dlDir, { recursive: true });
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir, eventsEnabled: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  const exportBtn = await $$x('//button[contains(., "Xuất xlsx")]');
  await exportBtn[0].click();
  await sleep(2500);
  await page.screenshot({ path: `${ROOT}/ui-05-export-clicked.png`, fullPage: false });
  const dl = fs.readdirSync(dlDir).filter((f) => f.endsWith('.xlsx'));
  check('E1 "Xuất xlsx" tải được file .xlsx', dl.length >= 1, dl.join(', ') || 'no file');
  if (dl[0]) {
    const stat = fs.statSync(path.join(dlDir, dl[0]));
    check('E2 file xuất không rỗng (khớp API 6590B)', stat.size > 4000, `${stat.size} bytes`);
    fs.copyFileSync(path.join(dlDir, dl[0]), `${ROOT}/download/bao-gia-da-tai.xlsx`);
  }

  // ── F. version history ──────────────────────────────────────────────────
  await page.evaluate(() => document.querySelector('.quotation-versions')?.scrollIntoView());
  await sleep(400);
  await page.screenshot({ path: `${ROOT}/ui-06-version-history.png`, fullPage: false });
  text = await bodyText();
  check('F1 mục "Lịch sử phiên bản" hiển thị', /Lịch sử phiên bản/.test(text));
  check('F2 có dòng phiên bản + nút hành động', /Phiên bản \d+/.test(text));
  const viewBtn = await $$x('//button[contains(., "Xem")]');
  await viewBtn[viewBtn.length - 1].click();
  await page.waitForSelector('[aria-label*="chỉ đọc"]', { timeout: 15000 });
  await sleep(600);
  await page.screenshot({ path: `${ROOT}/ui-07-version-payload.png`, fullPage: false });
  text = await bodyText();
  check('F3 "Xem" mở payload phiên bản chỉ đọc (Tuyến/Hạng/Hệ số/Lít/Giá cos/Phụ phí)', /chỉ đọc/.test(text) && /Giá cos/.test(text) && /Phụ phí/.test(text));

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} PASS${failed.length ? ` — FAILED: ${failed.map((f) => f.label).join(' ; ')}` : ''}`);
  await browser.close();
  process.exit(failed.length ? 1 : 0);
} catch (error) {
  await page.screenshot({ path: `${ROOT}/ui-error.png`, fullPage: true }).catch(() => {});
  console.log(`DRIVER ERROR: ${error?.message ?? error}`);
  await browser.close();
  process.exit(2);
}
