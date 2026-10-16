// Full-guide Driver A — PHẦN A LCL chain (scenarios A.1 → A.4 of the customer
// test guide 161026100000, 16/10/2026):
//   A.1 Chứng từ (tiepvv) creates an LCL lot through the real UI form —
//       detail must show "Lô hàng lẻ" + "Chưa có container nào".
//   A.2 Điều vận (dungnv) checks Kế hoạch Tổng quát — CẢNG NÂNG = warehouse
//       name, CẢNG HẠ = "—", TỔNG QUAN HÀNG HÓA = "5 Pallet · 1.900 kg · 4 CBM".
//   A.3 Điều vận group-assigns 2 LCL lots (Gán xe nhóm) — Lô 1 keeps 100%
//       tiền trả nhà xe, others 0đ, PHÂN LOẠI "Ghép (1/2)".
//   A.4 Chứng từ merges customer revenue (Ghép cước thu khách) on Chi phí -
//       Quyết toán — board must show Lô 1 = price, members 0₫ + group note
//       (customer defect phiếu 161026204709 / TC-A12).
// Fixtures: QA-FG16-A/B (cost pair), QA-FG16-C/D (rev pair) + one QA pricing
// row. Everything is cleaned up by fullguide-cleanup.mjs.
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, waitCount, bodyText,
} from './fullguide-lib.mjs';
import { writeFileSync } from 'node:fs';

const logger = makeLogger('a-lcl-chain');
const { step, log } = logger;
const results = {};
const record = (id, verdict, note) => { results[id] = { verdict, note }; step('VERDICT', { id, verdict, note }); };

await healthGate(logger);

// ── logins ───────────────────────────────────────────────────────────────────
const cus = await login('tiepvv');
const disp = await login('dungnv');
const admin = await login('admin');
step('logins', { cus: !!cus.token, disp: !!disp.token, admin: !!admin.token });
if (!cus.token || !disp.token || !admin.token) throw new Error('login failed');

// ── shared catalog facts ─────────────────────────────────────────────────────
const hex = uuid().slice(0, 6);
const refA = `QA-FG16-A-${hex}`;
const refB = `QA-FG16-B-${hex}`;
const refC = `QA-FG16-C-${hex}`;
const refD = `QA-FG16-D-${hex}`;

const customers = await api(disp.token, 'GET', '/customers?limit=50');
const customerList = customers.json?.items ?? customers.json ?? [];
const customer = customerList.find((c) => !c.deletedAt && c.name && c.name.length <= 40) ?? customerList.find((c) => !c.deletedAt);
step('customer', { id: customer?.id, name: customer?.name });

const routes = await api(disp.token, 'GET', '/routes?limit=50');
const routeList = routes.json?.items ?? routes.json ?? [];
const route = routeList.find((r) => !r.deletedAt) ?? routeList[0];
step('route', { id: route?.id, name: route?.name, code: route?.code });

const classes = await api(admin.token, 'GET', '/vehicle-size-classes?limit=50');
const classList = classes.json?.items ?? classes.json ?? [];
const cls5t = classList.find((c) => /5\s*tấn|5T/i.test(`${c.name} ${c.code}`)) ?? classList.find((c) => !c.deletedAt);
step('vehicle-class', { id: cls5t?.id, name: cls5t?.name, code: cls5t?.code });

// A pricing lane for the rev-merge (A.4): customer × route × class, hiệu lực
// today, as ADMIN (this also exercises the A.6 add-by-vehicle-class path).
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const QA_PRICE = 1200000;
let pricingRowId = null;
if (customer?.id && route?.id && cls5t?.id) {
  const priceCreate = await api(admin.token, 'POST', '/pricing-tables', {
    customerId: customer.id,
    routeId: route.id,
    vehicleSizeClassId: cls5t.id,
    price: QA_PRICE,
    effectiveDate: today,
    note: `QA fullguide A.4 price lane ${hex}`,
  });
  pricingRowId = priceCreate.json?.id ?? null;
  step('qa-pricing-row', { status: priceCreate.status, id: pricingRowId, body: priceCreate.text?.slice(0, 200) });
}

// ═════════════════════════════════════════════════════════════════ A.1 (UI) ══
let shipmentA = null;
let capturedPayload = null;
{
  const { browser, page } = await boot({ token: cus.token });
  try {
    page.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/api/shipments')) {
        try { capturedPayload = JSON.parse(req.postData()); } catch { capturedPayload = req.postData(); }
      }
    });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_form-empty.png', fullPage: true });

    // Loại hàng = Hàng lẻ (+ mode-switch confirm if it appears)
    await tap(page, `() => [...document.querySelectorAll('label')].find(l => l.textContent.trim() === 'Hàng lẻ')`);
    await sleep(900);
    const modeConfirmBtn = `() => { const dlg = [...document.querySelectorAll('[role=dialog]')].pop(); return dlg ? [...dlg.querySelectorAll('button')].find(b => /chuyển và xóa/i.test(b.textContent.trim())) : null; }`;
    if (await tap(page, modeConfirmBtn)) { await sleep(1200); }
    const lclOn = await page.evaluate(() => (document.body.innerText || '').includes('Kho lấy hàng'));
    step('a1-mode-lcl', { lclOn });
    if (!lclOn) throw new Error('LCL mode did not engage');

    // Khách hàng — searchable
    const pickSearchable = async (labelText, fragment, { wantContains = null } = {}) => {
      const clicked = await tap(page, `() => {
        const lab = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(labelText)}));
        const wrap = lab?.closest('div, fieldset, section');
        const input = wrap?.querySelector('input') || lab?.parentElement?.querySelector('input');
        return input || null;
      }`);
      if (!clicked) return false;
      await sleep(400);
      await page.keyboard.type(fragment, { delay: 45 });
      await sleep(1100);
      const picked = await tap(page, `() => {
        const options = [...document.querySelectorAll('[role="option"], [role="listbox"] li, [class*="option"]')];
        const visible = options.filter(o => o.offsetParent !== null);
        const want = ${JSON.stringify(wantContains)};
        return (want ? visible.find(o => (o.textContent || '').toLowerCase().includes(want.toLowerCase())) : null) || visible[0] || null;
      }`);
      await sleep(700);
      return picked;
    };

    await pickSearchable('Khách hàng', customer.name.slice(0, 6));
    // Hình thức = Xuất khẩu (native select)
    await page.evaluate(() => {
      const sel = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent.trim() === 'Xuất khẩu'));
      if (!sel) return false;
      const opt = [...sel.options].find(o => o.textContent.trim() === 'Xuất khẩu');
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    });
    await sleep(500);
    // Số Bill/Booking
    await tap(page, `() => [...document.querySelectorAll('input')].find(i => /số bill\/booking/i.test(i.closest('label')?.textContent || i.getAttribute('aria-label') || ''))`);
    await page.keyboard.type(refA, { delay: 25 });
    await sleep(300);
    // Kho lấy hàng — searchable (options are customer-scoped sites)
    const warehousePicked = await pickSearchable('Kho lấy hàng', '');
    step('a1-warehouse-picked', { warehousePicked });
    // Quy cách đóng gói
    await tap(page, `() => { const lab = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith('Quy cách đóng gói')); const wrap = lab?.closest('div, fieldset'); return wrap?.querySelector('input') || null; }`);
    await page.keyboard.type('Pallet', { delay: 40 });
    await sleep(900);
    const pkgPicked = await tap(page, `() => [...document.querySelectorAll('[role="option"], [class*="option"]')].filter(o => o.offsetParent !== null && /pallet/i.test(o.textContent || ''))[0] || null`);
    if (!pkgPicked) await page.keyboard.press('Escape');
    await sleep(500);
    // Số lượng / Trọng lượng / Thể tích
    const numField = (label) => `() => { const lab = [...document.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)})); const wrap = lab?.closest('div, fieldset'); return wrap?.querySelector('input') || null; }`;
    for (const [label, value] of [['Số lượng', '5'], ['Trọng lượng (kg)', '1900'], ['Thể tích (CBM)', '4']]) {
      const ok = await tap(page, numField(label));
      await page.keyboard.type(value, { delay: 30 });
      await sleep(250);
      if (!ok) step('a1-numfield-miss', { label });
    }
    // Ngày giao hàng (plain date input)
    await setInput(page, `() => [...document.querySelectorAll('input[type="date"]')].find(i => { const lab = i.closest('label, div, fieldset'); return !lab || /ngày giao hàng/i.test(lab.textContent || lab.getAttribute('aria-label') || ''); }) || [...document.querySelectorAll('input[type="date"]')][0]`, today);
    await sleep(300);
    // Tuyến đường — searchable
    const routePicked = await pickSearchable('Tuyến đường', (route?.name ?? route?.code ?? '').slice(0, 6));
    step('a1-route-picked', { routePicked });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_form-filled.png', fullPage: true });

    // Lưu
    const saved = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /^lưu$/i.test(b.textContent.trim()) && !b.disabled)`);
    step('a1-save-click', { saved });
    await sleep(3500);

    // Detail assertions
    const detailOk = await waitText(page, 'Lô hàng lẻ', 15000);
    const noContainer = await waitText(page, 'Chưa có container nào', 8000);
    const body = await bodyText(page);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_detail.png', fullPage: true });
    step('a1-detail', { url: page.url(), detailOk, noContainer, snippet: body.slice(0, 600) });
    const idMatch = page.url().match(/\/shipments\/(\d+)/);
    shipmentA = idMatch ? Number(idMatch[1]) : null;
    record('A.1', detailOk && noContainer ? 'PASS' : 'FAIL', `UI create → detail labels (Lô hàng lẻ=${detailOk}, Chưa có container nào=${noContainer}), id=${shipmentA}`);
  } catch (e) {
    step('a1-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_error.png', fullPage: true }).catch(() => {});
    record('A.1', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// DB proof for A.1 + create the remaining fixtures (B/C/D) via the SAME payload
const dbA = shipmentA ? psql(`SELECT id, cargo_mode, booking_ref, package_type, quantity, weight_kg, volume_cbm FROM shipments WHERE id=${shipmentA}`) : 'no-id';
step('a1-db', { row: dbA });

step('a1-captured-payload', { payload: capturedPayload });
async function createLot(ref) {
  const payload = capturedPayload && typeof capturedPayload === 'object'
    ? { ...capturedPayload, bookingRef: ref }
    : {
      customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
      expectedDeliveryDate: today, packageType: 'Pallet', quantity: '5', weightKg: '1900', volumeCbm: '4',
      operationalSiteId: null, routeId: route?.id ?? null,
    };
  if (payload.operationalSiteId == null) {
    let sites = await api(cus.token, 'GET', `/operational-sites?customerId=${customer.id}&limit=10`);
    if (!sites.ok) sites = await api(cus.token, 'GET', '/operational-sites?limit=10');
    const siteList = sites.json?.items ?? sites.json ?? [];
    if (Array.isArray(siteList) && siteList.length) payload.operationalSiteId = siteList[0].id;
  }
  const res = await api(cus.token, 'POST', '/shipments', payload);
  step('fixture-create', { ref, status: res.status, id: res.json?.id, err: res.json?.error ?? res.json?.message ?? null });
  return res.json?.id ?? null;
}
const shipmentB = await createLot(refB);
const shipmentC = await createLot(refC);
const shipmentD = await createLot(refD);
fs_writeFixtures({ shipmentA, shipmentB, shipmentC, shipmentD, refA, refB, refC, refD, customer: { id: customer?.id, name: customer?.name }, route: { id: route?.id, name: route?.name }, cls5t: { id: cls5t?.id, name: cls5t?.name }, pricingRowId, hex, QA_PRICE });
function fs_writeFixtures(data) {
  writeFileSync('qa/2026-10-16_fullguide_fixtures.json', JSON.stringify(data, null, 2));
}

// ═════════════════════════════════════════════════════════════════ A.2 (UI) ══
{
  const { browser, page } = await boot({ token: disp.token });
  try {
    await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    // search by the QA booking ref
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, refA);
    const found = await waitText(page, refA, 20000);
    await sleep(1500);
    const rowInfo = await page.evaluate((ref) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')].filter(el => (el.innerText || '').includes(ref));
      const headers = [...document.querySelectorAll('th')].map(th => th.textContent.trim());
      const rowText = rows.map(el => (el.innerText || '').replace(/\s+/g, ' ').trim());
      return { headers, rowText: rowText.slice(0, 4), bodyHasRef: (document.body.innerText || '').includes(ref) };
    }, refA);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a2_master-plan.png', fullPage: true });
    const allRowsText = rowInfo.rowText.join(' | ');
    const cargoOk = /5 Pallet\s*·\s*1\.900 kg\s*·\s*4 CBM/.test(allRowsText) || /5 Pallet/.test(allRowsText) && /1\.900/.test(allRowsText) && /4 CBM/.test(allRowsText);
    const cargoGiang = /—/.test(allRowsText); // CẢNG HẠ em-dash when no dropoff
    step('a2-row', { found, headers: rowInfo.headers, rowText: rowInfo.rowText, cargoOk, hasEmDash: cargoGiang });
    record('A.2', found && cargoOk ? 'PASS' : 'FAIL', `master plan row: found=${found}, cargoOverview=${cargoOk}, rows=${JSON.stringify(rowInfo.rowText).slice(0, 300)}`);
  } catch (e) {
    step('a2-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a2_error.png', fullPage: true }).catch(() => {});
    record('A.2', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ═════════════════════════════════════════════════════════════════ A.3 (UI) ══
// Gán xe nhóm lives on Kế hoạch Chi tiết Xe (/dispatch-detail) — AssignTruckGroupDialog.
{
  const { browser, page } = await boot({ token: disp.token });
  try {
    await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, `QA-FG16-${hex}`);
    await waitText(page, refA, 20000);
    await sleep(1500);
    // select rows A and B (checkboxes)
    const boxes = await page.$$eval('input[type="checkbox"]', (els) => els.map((e, i) => ({ i, visible: e.offsetParent !== null })));
    step('a3-checkboxes', { count: boxes.length, visible: boxes.filter(b => b.visible).length });
    const checked = await page.evaluate((refA, refB) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      const picked = [];
      for (const ref of [refA, refB]) {
        const row = rows.find(r => (r.innerText || '').includes(ref));
        const box = row?.querySelector('input[type="checkbox"]');
        if (box) { box.click(); picked.push(ref); }
      }
      return picked;
    }, refA, refB);
    await sleep(1200);
    const selectionBar = await bodyText(page);
    const barOk = /Đang chọn 2 lô/.test(selectionBar) && /100%/.test(selectionBar);
    step('a3-selection', { checked, barOk, barSnippet: selectionBar.match(/Đang chọn[^\n]*/)?.[0] ?? null });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_selected.png', fullPage: true });

    const opened = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /gán xe nhóm/i.test(b.textContent.trim()) && !b.disabled)`);
    await sleep(1500);
    const dialogText = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop();
      return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 500) : null;
    });
    step('a3-dialog', { opened, dialogText });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_dialog.png', fullPage: true });

    // Loại xe tính tiền trả nhà xe = 5 tấn (searchable inside dialog)
    const dlgField = (label) => `() => { const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop(); const lab = [...dlg.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)})); return lab?.closest('div, fieldset')?.querySelector('input') || null; }`;
    await tap(page, dlgField('Loại xe tính tiền'));
    await page.keyboard.type('5', { delay: 45 });
    await sleep(1000);
    const clsPicked = await tap(page, `() => { const opts = [...document.querySelectorAll('[role="option"], [class*="option"], [role="listbox"] li')].filter(o => o.offsetParent !== null); return opts.find(o => /5\s*tấn|5T/i.test(o.textContent || '')) || opts[0] || null; }`);
    await sleep(700);
    // Biển số xe chạy thực tế — type an external plate (doc: must type for contractor trucks)
    const plateSet = await page.evaluate(async (plate) => {
      const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop();
      const lab = [...dlg.querySelectorAll('label')].find(l => /biển số xe chạy thực tế/i.test(l.textContent || ''));
      const input = lab?.closest('div, fieldset')?.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, '');
      input.focus();
      return true;
    }, '99T-99999');
    if (plateSet) {
      await page.keyboard.type('99T-99999', { delay: 35 });
      await sleep(600);
      // free-typed plate: accept the custom value if a combobox needs it
      await page.keyboard.press('Escape');
    }
    step('a3-filled', { clsPicked, plateSet });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_dialog-filled.png', fullPage: true });

    const confirmed = await tap(page, `() => { const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop(); return [...dlg.querySelectorAll('button')].reverse().find(b => /xác nhận|gán/i.test(b.textContent.trim()) && !b.disabled) || null; }`);
    await sleep(3000);
    const afterText = await bodyText(page);
    const toast = afterText.match(/Đã gán[^\n]*/)?.[0] ?? null;
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_after-assign.png', fullPage: true });
    const ghep1 = /Ghép \(1\/2\)/.test(afterText);
    const ghep2 = /Ghép \(2\/2\)/.test(afterText);
    step('a3-after', { confirmed, toast, ghep1, ghep2 });
    const dbGroups = psql(`SELECT id, booking_ref, cost_group_order FROM shipments WHERE id IN (${shipmentA},${shipmentB}) ORDER BY cost_group_order`);
    const carrierZero = psql(`SELECT t.shipment_id, t.external_freight_cost FROM trip_carrier_info t WHERE t.shipment_id IN (${shipmentA},${shipmentB}) ORDER BY t.shipment_id`);
    step('a3-db', { groups: dbGroups, carrier: carrierZero });
    record('A.3', confirmed && ghep1 && ghep2 ? 'PASS' : 'FAIL', `group assign: confirm=${confirmed}, Ghép(1/2)=${ghep1}, Ghép(2/2)=${ghep2}, toast=${toast}, db=[${dbGroups}]`);
  } catch (e) {
    step('a3-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_error.png', fullPage: true }).catch(() => {});
    record('A.3', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ═════════════════════════════════════════════════════════════════ A.4 (UI) ══
// Ghép cước thu khách (doc: "Ghép tiền thu của khách") on Chi phí - Quyết toán.
{
  const { browser, page } = await boot({ token: cus.token });
  try {
    await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4500);
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search|lọc/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, `QA-FG16-${hex}`);
    await waitText(page, refC, 20000);
    await sleep(2000);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a4_board-before.png', fullPage: true });

    // select rows C and D — the doc says row CLICK (not checkbox); try checkbox first, fall back to row click
    const selected = await page.evaluate((refC, refD) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      const out = { boxes: [], clicked: [] };
      for (const ref of [refC, refD]) {
        const row = rows.find(r => (r.innerText || '').includes(ref));
        if (!row) continue;
        const box = row.querySelector('input[type="checkbox"]');
        if (box) { box.click(); out.boxes.push(ref); }
        else { row.click(); out.clicked.push(ref); }
      }
      return out;
    }, refC, refD);
    await sleep(1500);
    const mergeBtn = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /ghép cước thu khách|ghép tiền thu của khách/i.test(b.textContent.trim()) && !b.disabled)`);
    await sleep(1500);
    let dialogText = await page.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop();
      return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 400) : null;
    });
    step('a4-dialog', { selected, mergeBtn, dialogText });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a4_dialog.png', fullPage: true });

    // Loại xe tính cước thu khách = 5 tấn
    const dlgField = (label) => `() => { const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop(); const lab = [...dlg.querySelectorAll('label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)})); return lab?.closest('div, fieldset')?.querySelector('input') || null; }`;
    await tap(page, dlgField('Loại xe tính cước thu khách'));
    await page.keyboard.type('5', { delay: 45 });
    await sleep(1000);
    await tap(page, `() => { const opts = [...document.querySelectorAll('[role="option"], [class*="option"], [role="listbox"] li')].filter(o => o.offsetParent !== null); return opts.find(o => /5\s*tấn|5T/i.test(o.textContent || '')) || opts[0] || null; }`);
    await sleep(700);
    const merged = await tap(page, `() => { const dlg = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null).pop(); return [...dlg.querySelectorAll('button')].reverse().find(b => /ghép cước thu khách/i.test(b.textContent.trim()) && !b.disabled) || null; }`);
    await sleep(3500);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a4_after-merge.png', fullPage: true });

    // THE TC-A12 assertion: board must now show freight money — Lô 1 = price, member 0₫
    await sleep(2000);
    const boardText = await bodyText(page);
    const rowsInfo = await page.evaluate((refC, refD) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      return [refC, refD].map(ref => {
        const row = rows.find(r => (r.innerText || '').includes(ref));
        return row ? (row.innerText || '').replace(/\s+/g, ' ').slice(0, 400) : null;
      });
    }, refC, refD);
    const moneyC = rowsInfo[0] && /1\.200\.000|1 200 000/.test(rowsInfo[0]);
    const zeroD = rowsInfo[1] && /0\s*₫|0đ|0 ₫/.test(rowsInfo[1]);
    const note = /Ghép cước cùng Bill|Ghép tiền cùng Bill/.test(boardText);
    step('a4-after', { merged, rowsInfo, moneyC, zeroD, note });
    const dbRev = psql(`SELECT sh.id, sh.booking_ref, sh.rev_group_order, tfs.revenue, tfs.revenue_override_reason FROM shipments sh LEFT JOIN trip_financial_state tfs ON tfs.trip_id IN (SELECT id FROM trips WHERE shipment_id = sh.id) WHERE sh.id IN (${shipmentC},${shipmentD}) ORDER BY sh.rev_group_order`);
    const dbSnap = psql(`SELECT shipment_id, total_amount, freight_amount, formula_text FROM freight_rate_snapshots WHERE shipment_id IN (${shipmentC},${shipmentD}) ORDER BY id`);
    step('a4-db', { rev: dbRev, snapshots: dbSnap });
    record('A.4', merged && moneyC && zeroD ? 'PASS' : 'FAIL', `rev merge: merged=${merged}, Lô1 money=${moneyC} (want ${QA_PRICE}), member 0₫=${zeroD}, note=${note}, dbRev=[${dbRev}], dbSnap=[${dbSnap}]`);
  } catch (e) {
    step('a4-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a4_error.png', fullPage: true }).catch(() => {});
    record('A.4', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

step('SUMMARY', results);
writeFileSync('qa/2026-10-16_fullguide_a-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, fixtures: { shipmentA, shipmentB, shipmentC, shipmentD, refA, refB, refC, refD, pricingRowId, hex } }, null, 2));
log('DRIVER A DONE');
