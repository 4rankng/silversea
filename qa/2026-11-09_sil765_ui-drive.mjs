// SIL-765 — rung-3 UI drive (AGENTS §9): form tạo lô hàng lẻ với NHIỀU kho
// lấy hàng qua [+ Thêm kho lấy hàng] (khác "+ Thêm kho" danh mục).
// Role: tiepvv (CUS, local). Stack: this worktree frontend :7176 → backend
// :3003 → dev DB ss-prod-db :5441 (migration 20261109090000 applied).
// AC: 2 kho lấy hàng khác nhau chọn qua 2 ô → lưu lô → chi tiết lô hiện đủ
// cả 2 kho; DB proof shipment_pickup_warehouses.
import puppeteer from 'puppeteer-core';
import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:7176';
const API = 'http://localhost:3003/api';
const LOG = 'qa/2026-11-09_sil765_ui-driver.log';
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
const db = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-t', '-A', '-c', sql]).toString().trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }) });
const { token } = await loginRes.json();
log(`login tiepvv: ${token ? 'OK' : 'FAIL'}`);
if (!token) process.exit(1);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
const shot = async (name) => { await page.screenshot({ path: `qa/2026-11-09_sil765_ui-${name}.png` }); log(`shot ${name}`); };
let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

// Real-pointer helpers. The ComboBox portals its listbox; scope options by
// the trigger's aria-controls so a stale/hidden list can never win.
async function pickOption(triggerSelector, optionText) {
  await page.click(triggerSelector);
  await sleep(700);
  const clicked = await page.evaluate(({ sel, text }) => {
    const trigger = document.querySelector(sel);
    const controls = trigger?.getAttribute('aria-controls');
    const scope = controls ? document.getElementById(controls) : document;
    const options = [...(scope ?? document).querySelectorAll('[role="option"]')];
    const target = options.find((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text));
    if (!target) return false;
    target.click();
    return true;
  }, { sel: triggerSelector, text: optionText });
  await sleep(500);
  return clicked;
}

// Real-keyboard helper: RAC comboboxes commit a typed UNIQUE match on bare
// Enter (commitEnterMatch) — synthetic .click() on options does not commit.
async function pickByType(sel, text, expectLabel) {
  await page.click(sel);
  await page.type(sel, text);
  await sleep(500);
  await page.keyboard.press('Enter');
  await sleep(700);
  const value = await page.evaluate((s) => document.querySelector(s)?.value ?? null, sel);
  return value != null && value.includes(expectLabel);
}

// Button-trigger Select (e.g. #shipment-trade-direction): open, locate the
// option's real coordinates, and mouse-click them — react-aria Select ignores
// synthetic element.click().
async function pickByMouse(triggerSel, optionText) {
  await page.click(triggerSel);
  await sleep(700);
  const point = await page.evaluate(({ sel, text }) => {
    const options = [...document.querySelectorAll('[role="option"]')]
      .filter((o) => o.offsetParent != null || o.getClientRects().length > 0);
    const target = options.find((o) => (o.textContent ?? '').replace(/\s+/g, ' ').trim().includes(text));
    if (!target) return null;
    const r = target.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, { sel: triggerSel, text: optionText });
  if (!point) return false;
  await page.mouse.click(point.x, point.y);
  await sleep(700);
  return true;
}

try {
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(2500);

  // 1. Customer.
  expect(await pickByType('[data-field-id="shipment-customer"] input', 'LONG MINH', 'LONG MINH'), 'chọn khách hàng LONG MINH');
  await sleep(400);
  // 2. Hàng lẻ radio (native input, real click).
  await page.click('input[name="cargo-mode"][value="LCL"]');
  await sleep(700);
  // 3. Direction Nhập khẩu (button-trigger Select — real mouse click).
  expect(await pickByMouse('#shipment-trade-direction', 'Nhập khẩu'), 'chọn hình thức Nhập khẩu');
  await sleep(500);
  // 4. Số Bill.
  await page.type('[data-field-id="shipment-booking-ref"] input', 'BL-SIL765-2KHO');
  // 5. Route.
  expect(await pickByType('[data-field-id="shipment-route"] input', 'ASKEY', 'ASKEY'), 'chọn tuyến ASKEY');
  // 6. Factory.
  expect(await pickByType('[data-field-id="shipment-operational-site"] input', 'ASKEY-XƯỞNG 1', 'ASKEY-XƯỞNG 1'), 'chọn nhà máy ASKEY-XƯỞNG 1');
  await sleep(400);
  // 7. Primary kho.
  expect(await pickByType('[data-field-id="shipment-pickup-warehouse"] input', 'VICONSHIP', 'VICONSHIP'), 'chọn kho 1 VICONSHIP');
  await sleep(300);

  // 8. SIL-765: the new repeater button — distinct from "+ Thêm kho".
  const buttons = await page.evaluate(() => ({
    catalogAdd: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm kho')),
    lotAdd: Boolean([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm kho lấy hàng')),
  }));
  expect(buttons.catalogAdd, 'nút "+ Thêm kho" (danh mục dùng chung) vẫn còn');
  expect(buttons.lotAdd, 'nút [+ Thêm kho lấy hàng] xuất hiện');
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm kho lấy hàng').click(); });
  await sleep(500);
  let row0 = await page.$('[data-field-id="shipment-pickup-warehouse-extra-0"]');
  expect(Boolean(row0), 'ô kho lấy hàng thứ 2 xuất hiện');
  await shot('01-two-kho-fields-1440');
  expect(await pickByType('[data-field-id="shipment-pickup-warehouse-extra-0"] input', 'GLC', 'GLC'), 'chọn kho 2 GLC');
  // 9. Third row then remove it (per-row delete proof) — row index 1 carries
  // aria-label "Xóa kho lấy hàng 3" (1-based with the primary as the first).
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Thêm kho lấy hàng').click(); });
  await sleep(400);
  expect(Boolean(await page.$('[data-field-id="shipment-pickup-warehouse-extra-1"]')), 'ô kho thứ 3 xuất hiện');
  const removed = await page.evaluate(() => {
    const btn = document.querySelector('[data-field-id="shipment-pickup-warehouse-extra-1"] button[aria-label="Xóa kho lấy hàng 3"]');
    btn?.click();
    return Boolean(btn);
  });
  expect(removed, 'nút xóa riêng của ô thứ 3 có thể bấm');
  await sleep(400);
  expect(!(await page.$('[data-field-id="shipment-pickup-warehouse-extra-1"]')), 'xóa riêng ô kho thứ 3 được');

  // 10. Cargo fields (inputs live inside the field wrappers).
  const cargo = await page.evaluate(() => Boolean(document.querySelector('[data-field-id="shipment-package-type"] input')));
  expect(cargo, 'phần Thông tin hàng hiện ra');
  await page.type('[data-field-id="shipment-package-type"] input', 'Pallet');
  await page.type('[data-field-id="shipment-package-count"] input', '5');
  await page.type('[data-field-id="shipment-cargo-weight"] input', '300');
  // 11. Ngày giờ đóng/trả — segmented DD/MM/YYYY + HH/mm inputs.
  const closingOk = await page.evaluate(() => Boolean(document.querySelector('[data-field-id="shipment-lcl-closing-at"]')));
  expect(closingOk, 'trường Ngày giờ đóng/trả hiện ra');
  const segFill = async (placeholder, value) => {
    const handle = await page.evaluateHandle((ph) => [...document.querySelectorAll('[data-field-id="shipment-lcl-closing-at"] input')].find((i) => i.placeholder === ph), placeholder);
    const el = handle.asElement();
    if (!el) return false;
    await el.type(value);
    return true;
  };
  expect(await segFill('DD', '12') && await segFill('MM', '11') && await segFill('YYYY', '2026') && await segFill('HH', '08') && await segFill('mm', '30'), 'điền ngày giờ đóng/trả');
  log('closing filled 12/11/2026 08:30');
  await shot('02-form-filled-1440');

  // 12. Save.
  await page.evaluate(() => { [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Tạo lô hàng'))?.click(); });
  await sleep(5000);
  await shot('03-after-save-1440');
  const bodyText = await page.evaluate(() => document.body.innerText);
  const code = db("SELECT shipment_code FROM shipments WHERE bl_number = 'BL-SIL765-2KHO' ORDER BY id DESC LIMIT 1;");
  expect(Boolean(code), `lô đã lưu (shipment_code=${code})`);

  // 13. Detail shows BOTH kho.
  const shipmentId = db(`SELECT id FROM shipments WHERE shipment_code = '${code}';`);
  await page.goto(`${BASE}/shipments-detail/${shipmentId}`, { waitUntil: 'networkidle2' }).catch(async () => {
    await page.goto(`${BASE}/portal/shipments/${shipmentId}`, { waitUntil: 'networkidle2' });
  });
  await sleep(2500);
  await shot('04-detail-1440');
  const detail = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  expect(detail.includes('VICONSHIP'), 'chi tiết hiện kho 1 VICONSHIP');
  expect(detail.includes('GLC'), 'chi tiết hiện kho 2 GLC');
  log(`detail lift/drop lines: ${detail.match(/[^.]*VICONSHIP[^.]*/)?.[0]?.slice(0, 160) ?? 'n/a'}`);

  // 14. DB proof.
  const rows = db(`SELECT position || ':' || coalesce(site_id::text, 'name=' || name) FROM shipment_pickup_warehouses WHERE shipment_id = ${shipmentId} ORDER BY position;`);
  expect(rows === '1:12', `shipment_pickup_warehouses đúng 1 dòng bổ sung GLC (rows="${rows}")`);
  log(`db proof shipment: ${db(`SELECT id, shipment_code, pickup_warehouse_site_id, pickup_location, delivery_location FROM shipments WHERE id = ${shipmentId};`)}`);
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
