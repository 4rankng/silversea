#!/usr/bin/env node
/**
 * 2026-10-18 — card 181026143000 (spec 2026.10.17): LCL create-form labels
 * (§1a/§1b/§1c/§1d) + dispatch Nâng/Trả sync (§2) — LOCAL DEV rung-3 drive
 * against THIS worktree's vite (:7176, worktree == main for src at drive time).
 *
 * Rungs per AGENTS.md §9:
 *   §1a/1c/1d — DOM label/placeholder/button asserts + screenshots on
 *     /shipments/new (Nhập + Xuất, combobox list, + Thêm kho / + Thêm nhà máy
 *     dialogs, layout cards).
 *   §1b — submit a complete-except-Nhà máy/Kho LCL form, capture the field
 *     errors; then repeat with «Lệnh chạy ngoài» to show the waiver.
 *   §2 — CREATE two real LCL lots (IMPORT + EXPORT, typed CFS/factory names)
 *     through the form, then read both dispatch grids' Nâng/Trả cells for
 *     those lots; detail API proves the persisted side effect (§9.3).
 *
 * Evidence (repo-root qa/): 181026143000_ui-*.png + 181026143000_driver.log
 * Run: node testplan/qa/scripts/2026-10-18-181026143000-lcl-form-dispatch.mjs
 * Env: BACKEND (default http://localhost:3002/api), FRONTEND (default :7176)
 */
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { login } from '../../../scripts/lib/http.mjs';
import { withSession, sleep, clickButtonByText } from '../../../scripts/lib/ui-driver.mjs';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const QA = join(ROOT, 'qa');
const DATE = '2026-10-18';
const SCOPE = '181026143000';
const BACKEND = process.env.BACKEND ?? 'http://localhost:3002/api';
const FRONTEND = process.env.FRONTEND ?? 'http://localhost:7176';
const STAMP = Date.now().toString().slice(-6);

const log = [];
const step = (msg) => { log.push(msg); console.log(msg); };
const shot = (page, name) => page.screenshot({ path: join(QA, `${DATE}_${SCOPE}_ui-${name}.png`), fullPage: false });
const fieldText = (id) => document.querySelector(`[data-field-id="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
const placeholderOf = (id) => document.querySelector(`[data-field-id="${id}"] input`)?.placeholder ?? null;

let failures = 0;
const expect = (cond, label, detail = '') => {
  const ok = Boolean(cond);
  step(`${ok ? 'PASS' : 'FAIL'} — ${label}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures += 1;
};

async function chooseDirection(page, label) {
  await page.waitForSelector('#shipment-trade-direction', { timeout: 10000 });
  await page.click('#shipment-trade-direction');
  await sleep(300);
  const picked = await page.evaluate((label) => {
    const list = document.querySelector('[role="listbox"]');
    const opt = Array.from(list?.querySelectorAll('[role="option"]') ?? [])
      .find((o) => o.textContent?.trim() === label);
    if (opt) { opt.click(); return opt.textContent.trim(); }
    return null;
  }, label);
  if (!picked) throw new Error(`chooseDirection: no option "${label}"`);
  await sleep(350);
  return picked;
}

async function setReactInput(page, fieldId, value) {
  return page.evaluate(({ fieldId, value }) => {
    const input = document.querySelector(`[data-field-id="${fieldId}"] input`);
    if (!input) throw new Error(`no input in ${fieldId}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return input.value;
  }, { fieldId, value });
}

async function comboboxFirstOption(page, fieldId) {
  await page.click(`[data-field-id="${fieldId}"] input`);
  await sleep(350);
  const opt = await page.evaluate(() => {
    const active = document.activeElement;
    const list = active?.getAttribute('aria-controls')
      ? document.getElementById(active.getAttribute('aria-controls'))
      : document.querySelector('[role="listbox"]');
    const first = list?.querySelector('[role="option"]');
    return first ? first.textContent.trim() : null;
  });
  if (opt) {
    await page.evaluate(() => {
      const active = document.activeElement;
      const list = active?.getAttribute('aria-controls')
        ? document.getElementById(active.getAttribute('aria-controls'))
        : document.querySelector('[role="listbox"]');
      list?.querySelector('[role="option"]')?.click();
    });
  }
  return opt;
}

async function fillLclCargo(page, { bill, warehouseText, factoryText, withPoints }) {
  await setReactInput(page, 'shipment-booking-ref', bill);
  await comboboxFirstOption(page, 'shipment-route'); // Tuyến đường — catalog prereq
  if (withPoints) {
    await setReactInput(page, 'shipment-pickup-warehouse', warehouseText);
    await setReactInput(page, 'shipment-operational-site', factoryText);
  }
  await setReactInput(page, 'shipment-package-type', 'Pallet');
  await setReactInput(page, 'shipment-package-count', '5');
  await setReactInput(page, 'shipment-cargo-weight', '800');
  await setReactInput(page, 'shipment-expected-delivery', '20/10/2026');
  await sleep(250);
}

withSession(null, async () => {}).catch(() => {}); // noop keep import shape honest

const token = await login('admin', { backend: BACKEND });
step(`login admin ok (token len ${token.length})`);

await withSession(token, async (page) => {
  /* ── §1a neutral → IMPORT → EXPORT labels ─────────────────────────── */
  await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('#shipment-pickup-warehouse', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => Array.from(document.querySelectorAll('input[type=radio]')).some((r) => /Hàng lẻ/.test(r.closest('label')?.textContent ?? '')), { timeout: 15000 });

  await comboboxFirstOption(page, 'shipment-customer');
  await sleep(400);
  await page.evaluate(() => {
    const radio = Array.from(document.querySelectorAll('input[type=radio]'))
      .find((r) => /Hàng lẻ/.test(r.closest('label')?.textContent ?? ''));
    radio?.click();
  });
  await page.waitForSelector('[data-field-id="shipment-pickup-warehouse"]', { timeout: 8000 });
  await sleep(300);
  step(`neutral labels — site="${await page.evaluate(fieldText, 'shipment-operational-site')}" kho="${await page.evaluate(fieldText, 'shipment-pickup-warehouse')}"`);
  await shot(page, '1-neutral');

  await chooseDirection(page, 'Nhập khẩu');
  await sleep(350);
  const impSite = await page.evaluate(fieldText, 'shipment-operational-site');
  const impKho = await page.evaluate(fieldText, 'shipment-pickup-warehouse');
  const impPh = await page.evaluate(placeholderOf, 'shipment-pickup-warehouse');
  expect(impSite?.includes('Nhà máy (Điểm trả hàng)'), '§1a IMPORT Nhà máy label', impSite);
  expect(impSite?.includes('*'), '§1a IMPORT Nhà máy asterisk', impSite);
  expect(impKho?.includes('Kho lấy hàng (CFS/Cảng)'), '§1a IMPORT Kho label', impKho);
  expect(impKho?.includes('*'), '§1a IMPORT Kho asterisk', impKho);
  expect(impPh === 'Chọn hoặc nhập kho CFS lấy hàng...', '§1a IMPORT placeholder', impPh);
  await shot(page, '2-import-labels');

  await chooseDirection(page, 'Xuất khẩu');
  await sleep(350);
  const expSite = await page.evaluate(fieldText, 'shipment-operational-site');
  const expKho = await page.evaluate(fieldText, 'shipment-pickup-warehouse');
  const expPh = await page.evaluate(placeholderOf, 'shipment-pickup-warehouse');
  expect(expSite?.includes('Nhà máy (Điểm lấy hàng)'), '§1a EXPORT Nhà máy label', expSite);
  expect(expKho?.includes('Kho trả hàng (CFS/Cảng)'), '§1a EXPORT Kho label', expKho);
  expect(expPh === 'Chọn hoặc nhập kho CFS hạ/giao hàng...', '§1a EXPORT placeholder', expPh);
  await shot(page, '3-export-labels');

  /* ── §1c combobox list + add buttons + dialogs ────────────────────── */
  const khoOpt = await comboboxFirstOption(page, 'shipment-pickup-warehouse');
  step(`§1c kho combobox options: ${khoOpt ?? '(no options — free-text only customer)'}`);
  await shot(page, '4-kho-combobox');
  // Close any open suggestion listbox so it cannot swallow the next click.
  await page.keyboard.press('Escape');
  await sleep(300);
  const btns = await page.evaluate(() => Array.from(document.querySelectorAll('button'))
    .map((b) => b.textContent.trim()).filter((t) => /^(\+ )?(Thêm kho|Thêm nhà máy)$/.test(t)));
  expect(btns.includes('Thêm kho'), '§1c "+ Thêm kho" button present', JSON.stringify(btns));
  expect(btns.includes('Thêm nhà máy'), '§1c "+ Thêm nhà máy" button present', JSON.stringify(btns));
  let dialogSeen = false;
  for (let attempt = 1; attempt <= 2 && !dialogSeen; attempt += 1) {
    const clickedKho = await clickButtonByText(page, 'Thêm kho$');
    step(`§1c clicked: ${clickedKho}`);
    dialogSeen = await page.waitForSelector('[role="dialog"] button', { timeout: 6000 })
      .then(() => true).catch(() => false);
  }
  await sleep(300);
  const dialogTitle = () => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    if (!d) return null;
    return d.getAttribute('aria-label') ?? d.querySelector('h2, [class*="modal__title"]')?.textContent?.trim() ?? null;
  });
  const cancelDialog = () => page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    const btn = Array.from(d?.querySelectorAll('button') ?? [])
      .find((b) => b.textContent?.trim() === 'Hủy');
    btn?.click();
  });
  // Direction is Xuất khẩu here (set during §1a) — card 181026143000: the
  // dialog must name the kho by the SAME direction as the field beneath it.
  expect(await dialogTitle() === 'Thêm kho trả hàng', '§1a/§1c dialog title Xuất khẩu = "Thêm kho trả hàng"', await dialogTitle());
  await shot(page, '5-them-kho-dialog-export');
  await cancelDialog();
  await sleep(400);
  await chooseDirection(page, 'Nhập khẩu');
  await sleep(300);
  await clickButtonByText(page, 'Thêm kho$');
  await page.waitForSelector('[role="dialog"] button', { timeout: 8000 });
  await sleep(300);
  expect(await dialogTitle() === 'Thêm kho lấy hàng', '§1a/§1c dialog title Nhập khẩu = "Thêm kho lấy hàng"', await dialogTitle());
  await shot(page, '5b-them-kho-dialog-import');
  await cancelDialog();
  await sleep(400);

  /* ── §1d layout: kho in route card; cargo card fields ─────────────── */
  const layout = await page.evaluate(() => {
    const kho = document.querySelector('[data-field-id="shipment-pickup-warehouse"]');
    const route = document.querySelector('[data-field-id="shipment-route"]');
    const cargoFields = Array.from(
      document.querySelector('[data-field-id="shipment-package-type"]')?.closest('section')?.querySelectorAll('label, legend') ?? [],
    ).map((n) => n.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    return {
      khoSection: kho?.closest('section')?.textContent?.replace(/\s+/g, ' ').slice(0, 60) ?? null,
      sameCardAsRoute: kho?.closest('section') === route?.closest('section'),
      cargoFields,
    };
  });
  expect(layout.sameCardAsRoute === true, '§1d Kho field lives in the route card with Tuyến đường', layout.khoSection);
  expect(layout.cargoFields.some((f) => f.includes('Loại hàng')), '§1d cargo card has Loại hàng', JSON.stringify(layout.cargoFields));
  expect(layout.cargoFields.some((f) => f.includes('Quy cách đóng gói')), '§1d cargo card has Quy cách đóng gói');
  expect(layout.cargoFields.some((f) => f.includes('Số lượng')), '§1d cargo card has Số lượng');
  expect(layout.cargoFields.some((f) => f.includes('Trọng lượng')), '§1d cargo card has Trọng lượng');
  expect(layout.cargoFields.some((f) => f.includes('Thể tích')), '§1d cargo card has Thể tích');
  expect(!layout.cargoFields.some((f) => /Kho (lấy|trả) hàng/.test(f)), '§1d cargo card has NO Kho field', JSON.stringify(layout.cargoFields));

  /* ── §1b validation: submit without Nhà máy/Kho → field errors ────── */
  await chooseDirection(page, 'Nhập khẩu');
  await sleep(300);
  await fillLclCargo(page, { bill: `QA-${SCOPE}-V${STAMP}`, withPoints: false });
  await clickButtonByText(page, '^Tạo lô hàng$');
  await sleep(900);
  const validationText = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ' '));
  expect(validationText.includes('chọn nhà máy') || validationText.includes('Chọn nhà máy'), '§1b error names Nhà máy', '');
  expect(validationText.includes('kho') || validationText.includes('Kho'), '§1b error names Kho', '');
  const errVisible = await page.evaluate(() => {
    const site = document.querySelector('[data-field-id="shipment-operational-site"]');
    return site?.querySelector('.csc-searchable-field--error, [class*="--error"]') != null;
  });
  expect(errVisible, '§1b field-level error styling on Nhà máy');
  await shot(page, '6-validation-errors');
  const stillOnForm = page.url().includes('/shipments/new');
  expect(stillOnForm, '§1b submit blocked (no navigation)');

  /* ── §2 create two REAL LCL lots through the form ─────────────────── */
  const lots = [
    { dir: 'IMPORT', bill: `QA-${SCOPE}-I${STAMP}`, kho: `Kho CFS Cát Lái QA${STAMP}`, factory: `Nhà máy QC Long Hậu QA${STAMP}` },
    { dir: 'EXPORT', bill: `QA-${SCOPE}-E${STAMP}`, kho: `Kho CFS trả Q.9 QA${STAMP}`, factory: `Nhà máy QC Biên Hòa QA${STAMP}` },
  ];
  const created = [];
  for (const lot of lots) {
    if (created.length > 0) {
      await page.goto(`${FRONTEND}/shipments/new`, { waitUntil: 'networkidle2' });
      await page.waitForSelector('#shipment-pickup-warehouse', { timeout: 15000 }).catch(() => {});
      await comboboxFirstOption(page, 'shipment-customer');
      await sleep(400);
      await page.evaluate(() => {
        const radio = Array.from(document.querySelectorAll('input[type=radio]'))
          .find((r) => /Hàng lẻ/.test(r.closest('label')?.textContent ?? ''));
        radio?.click();
      });
      await page.waitForSelector('[data-field-id="shipment-pickup-warehouse"]', { timeout: 8000 });
    }
    await chooseDirection(page, lot.dir === 'IMPORT' ? 'Nhập khẩu' : 'Xuất khẩu');
    await sleep(350);
    await fillLclCargo(page, { bill: lot.bill, warehouseText: lot.kho, factoryText: lot.factory, withPoints: true });
    await sleep(400);
    await clickButtonByText(page, '^Tạo lô hàng$');
    await sleep(1200);
    if (!/\/shipments\/\d+/.test(page.url())) {
      const issues = await page.evaluate(() => {
        const errs = Array.from(document.querySelectorAll('[class*="--error"], [class*="__error"]'))
          .map((n) => n.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 10);
        const toasts = Array.from(document.querySelectorAll('[class*="toast"], [role="status"], [aria-live]'))
          .map((n) => n.textContent?.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 5);
        const progress = document.querySelector('.csc-topline__progress')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
        return { errs, toasts, progress, route: document.querySelector('[data-field-id="shipment-route"] input')?.value ?? null };
      });
      step(`create ${lot.dir} BLOCKED — issues=${JSON.stringify(issues)}`);
    }
    await page.waitForFunction(() => /\/shipments\/\d+/.test(location.pathname), { timeout: 15000 });
    const url = page.url();
    const id = Number(url.match(/\/shipments\/(\d+)/)?.[1]);
    const code = await page.evaluate(() => document.body.textContent.match(/SS-\d+/)?.[0] ?? null);
    created.push({ ...lot, id, code });
    step(`created LCL ${lot.dir} lot id=${id} code=${code} bill=${lot.bill}`);
    await shot(page, `7-created-${lot.dir.toLowerCase()}`);
    await sleep(500);
  }

  /* ── detail API: persisted side effect (§9.3) ─────────────────────── */
  for (const lot of created) {
    const res = await page.evaluate(async ({ id, token }) => {
      const r = await fetch(`/api/shipments/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      return r.json();
    }, { id: lot.id, token });
    const s = res.shipment ?? {};
    step(`API detail lot ${lot.id}: dir=${s.tradeDirection} pickup_location="${s.pickupLocation}" delivery_location="${s.deliveryLocation}" pickupWarehouseSiteName="${s.pickupWarehouseSiteName}"`);
    if (lot.dir === 'IMPORT') {
      expect(s.pickupLocation === lot.kho && s.deliveryLocation === lot.factory, '§2 IMPORT persisted lift=kho, drop=factory', `${s.pickupLocation} / ${s.deliveryLocation}`);
    } else {
      expect(s.pickupLocation === lot.factory && s.deliveryLocation === lot.kho, '§2 EXPORT persisted lift=factory, drop=kho', `${s.pickupLocation} / ${s.deliveryLocation}`);
    }
  }

  /* ── dispatch grids ───────────────────────────────────────────────── */
  await page.goto(`${FRONTEND}/dispatch`, { waitUntil: 'networkidle2' });
  await sleep(2500);
  for (const lot of created) {
    const cells = await page.evaluate((bill) => {
      const row = Array.from(document.querySelectorAll('tr')).find((tr) => tr.textContent?.includes(bill));
      if (!row) return null;
      const lift = row.querySelector('[data-label="Cảng nâng"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      const drop = row.querySelector('[data-label="Cảng hạ"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return { lift, drop };
    }, lot.bill);
    if (lot.dir === 'IMPORT') {
      expect(cells?.lift === lot.kho && cells?.drop === lot.factory, `§2 master-plan IMPORT Nâng=kho Hạ=factory (${lot.bill})`, JSON.stringify(cells));
    } else {
      expect(cells?.lift === lot.factory && cells?.drop === lot.kho, `§2 master-plan EXPORT Nâng=factory Hạ=kho (${lot.bill})`, JSON.stringify(cells));
    }
  }
  await shot(page, '8-dispatch-master');

  await page.goto(`${FRONTEND}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('table tr, [class*="detailed-plan-grid"] [data-label]', { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  for (const lot of created) {
    // Narrow the paginated board to this lot via the quick-search (aria-label
    // "Tìm nhanh", placeholder "Bill, Cont, Tờ khai...").
    await page.evaluate((bill) => {
      const input = document.querySelector('input[aria-label="Tìm nhanh"]');
      if (!input) throw new Error('no quick-search input');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(input, bill);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, lot.bill);
    await sleep(1500);
    const cells = await page.evaluate((bill) => {
      const row = Array.from(document.querySelectorAll('tr')).find((tr) => tr.textContent?.includes(bill));
      if (!row) return null;
      const lift = row.querySelector('[data-label="Nâng hàng"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      const drop = row.querySelector('[data-label="Trả hàng"]')?.textContent?.replace(/\s+/g, ' ').trim() ?? null;
      return { lift, drop };
    }, lot.bill);
    if (lot.dir === 'IMPORT') {
      expect(cells?.lift === lot.kho && cells?.drop === lot.factory, `§2 detail-plan IMPORT Nâng=kho Trả=factory (${lot.bill})`, JSON.stringify(cells));
    } else {
      expect(cells?.lift === lot.factory && cells?.drop === lot.kho, `§2 detail-plan EXPORT Nâng=factory Trả=kho (${lot.bill})`, JSON.stringify(cells));
    }
  }
  await shot(page, '9-dispatch-detail');
}, { name: `${DATE}_${SCOPE}_session`, headless: 'new', viewport: { width: 1440, height: 900 } });

await mkdir(QA, { recursive: true });
await appendFile(join(QA, `${DATE}_${SCOPE}_driver.log`), log.join('\n') + '\n');
console.log(log.join('\n'));
console.log(`\nSUMMARY: ${failures === 0 ? 'ALL PASS' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);
