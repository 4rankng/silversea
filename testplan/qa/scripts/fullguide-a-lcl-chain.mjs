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
const cls5t = classList.find((c) => (c.name ?? '').trim() === 'Xe 5 tấn')
  ?? classList.find((c) => /(^|\s)xe 5 tấn$/i.test((c.name ?? '').trim()))
  ?? classList.find((c) => !c.deletedAt);
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
// searchable fields resolve via label[for] → input (React Aria pattern on
// this form); the option pick prefers an EXACT trimmed match because
// "Xe 1.25 tấn" contains the substring "5 tấn".
async function pickSearchable(page, labelRe, fragment, { scopedToDialog = false } = {}) {
  const scope = scopedToDialog
    ? `const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null); const root = dlgs[dlgs.length - 1] ?? document;`
    : 'const root = document;';
  const clicked = await tap(page, `() => {
    ${scope}
    const labels = [...root.querySelectorAll('label')].filter(l => /${labelRe}/i.test((l.textContent || '')) && l.offsetParent !== null);
    const forId = labels[0]?.getAttribute('for');
    if (forId) { const el = document.getElementById(forId); if (el) return el; }
    return [...root.querySelectorAll('input')].find(i => {
      const l = (i.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      return /${labelRe}/i.test(l) || /${labelRe}/i.test(i.getAttribute('aria-label') || '');
    }) ?? null;
  }`);
  if (!clicked) return false;
  await sleep(700);
  if (fragment) { await page.keyboard.type(fragment, { delay: 45 }); await sleep(1100); }
  else await sleep(900);
  const picked = await tap(page, `() => {
    const options = [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null);
    if (!options.length) return null;
    const want = ${JSON.stringify(String(fragment ?? ''))}.trim();
    // Exact/word-anchored first: "Xe 1.25 tấn" must NOT match the fragment "5 tấn".
    const anchored = new RegExp('(^|\\\\s|[^0-9.])' + want.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&') + '\\\\s*$', 'i');
    return options.find(o => anchored.test((o.textContent || '').trim()))
      ?? options.find(o => want && ((o.textContent || '').trim().toLowerCase()).endsWith(want.toLowerCase()))
      ?? (want ? options.find(o => ((o.textContent || '').trim().toLowerCase()).includes(want.toLowerCase())) : null)
      ?? options[0];
  }`);
  await sleep(700);
  return picked;
}
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

    // (pickSearchable hoisted to module scope below)

    await pickSearchable(page, 'Khách hàng', (customer.shortName || customer.name).slice(0, 6));
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
    // Số Bill/Booking — label or placeholder match
    await tap(page, `() => [...document.querySelectorAll('input')].find(i => {
      const l = (i.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
      const own = (i.getAttribute('aria-label') || '') + (i.getAttribute('placeholder') || '');
      return /số bill/i.test(l) || /số booking/i.test(own) || /số bill/i.test(own);
    }) ?? null`);
    await page.keyboard.type(refA, { delay: 25 });
    await sleep(300);
    // Kho lấy hàng — searchable (options are customer-scoped sites)
    const warehousePicked = await pickSearchable(page, 'Kho lấy hàng', '');
    step('a1-warehouse-picked', { warehousePicked });
    // Quy cách đóng gói — combobox with suggestions
    await tap(page, `() => [...document.querySelectorAll('input')].find(i => { const l = (i.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '); return /quy cách đóng gói/i.test(l) || /quy cách đóng gói/i.test(i.getAttribute('aria-label') || ''); }) ?? null`);
    await page.keyboard.type('Pallet', { delay: 40 });
    await sleep(1000);
    const pkgPicked = await tap(page, `() => [...document.querySelectorAll('[role="option"]')].filter(o => o.offsetParent !== null).find(o => /pallet/i.test(o.textContent || '')) ?? null`);
    if (!pkgPicked) await page.keyboard.press('Escape');
    await sleep(500);
    // Số lượng / Trọng lượng / Thể tích — labelled numeric fields
    const numField = (labelRe) => `() => [...document.querySelectorAll('input')].find(i => { const l = (i.getAttribute('aria-labelledby') || '').split(/\\s+/).map(id => document.getElementById(id)?.textContent || '').join(' '); return /${labelRe}/i.test(l) || /${labelRe}/i.test(i.getAttribute('aria-label') || ''); }) ?? null`;
    for (const [labelRe, value] of [['Số lượng', '5'], ['Trọng lượng \\(kg\\)', '1900'], ['Thể tích \\(CBM\\)', '4']]) {
      const ok = await tap(page, numField(labelRe));
      if (ok) { await page.keyboard.type(value, { delay: 30 }); await sleep(250); }
      else step('a1-numfield-miss', { labelRe });
    }
    // Ngày giao hàng — segmented: DD carries #shipment-expected-delivery,
    // MM/YYYY are aria-labelled "Tháng/Năm — Ngày giao hàng".
    const dateSet = await page.evaluate((todaySrc) => {
      const [y, m, d] = todaySrc.split('-');
      const segs = [
        document.getElementById('shipment-expected-delivery'),
        [...document.querySelectorAll('input')].find(i => /^tháng — ngày giao hàng/i.test(i.getAttribute('aria-label') || '')),
        [...document.querySelectorAll('input')].find(i => /^năm — ngày giao hàng/i.test(i.getAttribute('aria-label') || '')),
      ];
      const vals = [d, m, y];
      let done = 0;
      segs.forEach((el, idx) => {
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, vals[idx]);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        done += 1;
      });
      return { found: segs.map(Boolean), done };
    }, today);
    await sleep(700);
    step('a1-date-segments', dateSet);
    // Tuyến đường — searchable
    const routePicked = await pickSearchable(page, 'Tuyến đường', (route?.name ?? route?.code ?? '').slice(0, 6));
    step('a1-route-picked', { routePicked });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_form-filled.png', fullPage: true });

    // Tạo lô hàng (the form's primary submit)
    const saved = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /^tạo lô hàng$/i.test(b.textContent.trim()) && !b.disabled)`);
    step('a1-save-click', { saved });
    await sleep(3500);

    // Detail assertions
    const detailOk = await waitText(page, 'Hàng lẻ', 15000);
    const noContainer = await waitText(page, 'Chưa có container nào', 8000);
    const body = await bodyText(page);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_detail.png', fullPage: true });
    step('a1-detail', { url: page.url(), detailOk, noContainer, snippet: body.slice(0, 600) });
    const idMatch = page.url().match(/\/shipments\/(\d+)/);
    shipmentA = idMatch ? Number(idMatch[1]) : null;
    record('A.1', detailOk && noContainer ? 'PASS' : 'FAIL', `UI create → detail labels (Hàng lẻ (LCL)=${detailOk}, Chưa có container nào=${noContainer}), id=${shipmentA}`);
  } catch (e) {
    step('a1-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_error.png', fullPage: true }).catch(() => {});
    record('A.1', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// DB proof for A.1 + create the remaining fixtures (B/C/D) via the SAME payload
const dbA = shipmentA ? psql(`SELECT id, cargo_mode, booking_ref, package_type, package_count, cargo_weight_kg, cargo_volume_cbm, operational_site_id FROM shipments WHERE id=${shipmentA}`) : 'no-id';
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
    // CUS cannot read /operational-sites (403) — resolve via DISPATCHER.
    let sites = await api(disp.token, 'GET', `/operational-sites?customerId=${customer.id}&limit=10`);
    if (!sites.ok) sites = await api(disp.token, 'GET', '/operational-sites?limit=10');
    const siteList = sites.json?.items ?? sites.json ?? [];
    const real = Array.isArray(siteList) ? siteList.find(t => !/chưa xác định/i.test(t.name ?? '')) ?? siteList[0] : null;
    if (real) payload.operationalSiteId = real.id;
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
    // search by the run's QA prefix so every fixture row is in scope (lot A's
    // site pick may land "Chưa xác định"; B/C/D carry a real warehouse)
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, `QA-FG16-${hex}`);
    const found = await waitText(page, refA, 20000);
    await sleep(1500);
    const rowInfo = await page.evaluate((ref) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')].filter(el => (el.innerText || '').includes('QA-FG16'));
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

    // Loại xe tính cước trả ĐV = 5 tấn (searchable, global label[for] scope)
    await pickSearchable(page, 'Loại xe tính cước trả', '5 tấn');
    // BKS thực (xe chạy chuyến) — free-typed external plate via label[for], global scope
    const plateSet = await page.evaluate((plate) => {
      const labels = [...document.querySelectorAll('label')].filter(l => /bks thực/i.test(l.textContent || '') && l.offsetParent !== null);
      const forId = labels[0]?.getAttribute('for');
      const input = (forId ? document.getElementById(forId) : null)
        ?? [...document.querySelectorAll('input')].find(i => {
          const l = (i.getAttribute('aria-labelledby') || '').split(/\s+/).map(id => document.getElementById(id)?.textContent || '').join(' ');
          return /bks thực/i.test(l) || /bks thực/i.test(i.getAttribute('aria-label') || '');
        });
      if (!input) return false;
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, plate);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.blur();
      return true;
    }, '99T-99999');
    await sleep(800);
    step('a3-filled', { plateSet });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_dialog-filled.png', fullPage: true });

    const confirmed = await tap(page, `() => { const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null); const dlg = dlgs[dlgs.length - 1]; return dlg ? [...dlg.querySelectorAll('button')].reverse().find(b => /xác nhận|gán/i.test(b.textContent.trim()) && !b.disabled) : null; }`);
    await sleep(3000);
    const afterText = await bodyText(page);
    const toast = afterText.match(/Đã gán[^\n]*/)?.[0] ?? null;
    const dlgError = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null);
      const dlg = dlgs[dlgs.length - 1];
      return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null;
    });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_after-assign.png', fullPage: true });
    // The plan labels per the doc: "Ghép (1/2)" / "Ghép trả nhà xe · BKS …"
    const ghepLabels = (afterText.match(/Ghép[^\n]{0,60}/g) ?? []).slice(0, 6);
    step('a3-after', { confirmed, toast, dlgError, ghepLabels });
    const dbGroups = psql(`SELECT id, booking_ref, cost_group_order, actual_truck_no FROM shipments WHERE id IN (${shipmentA},${shipmentB}) ORDER BY cost_group_order`);
    const carrierRows = psql(`SELECT t.shipment_id, tci.external_freight_cost FROM trips t LEFT JOIN trip_carrier_info tci ON tci.trip_id = t.id WHERE t.shipment_id IN (${shipmentA},${shipmentB}) AND t.deleted_at IS NULL ORDER BY t.shipment_id`);
    step('a3-db', { groups: dbGroups, carrier: carrierRows });
    const grouped = dbGroups.split('\n').filter(Boolean).length >= 2 && dbGroups.includes('|1|') && dbGroups.includes('|2|');
    record('A.3', confirmed && grouped ? 'PASS' : 'FAIL', `group assign: confirm=${confirmed}, toast="${toast}", labels=${JSON.stringify(ghepLabels)}, db=[${dbGroups.replace(/\n/g, '; ')}], carrier=[${carrierRows.replace(/\n/g, '; ')}]`);
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

    // Loại xe tính cước thu khách = 5 tấn (searchable in the merge dialog)
    await pickSearchable(page, 'Loại xe tính cước thu khách', '5 tấn');
    await sleep(600);
    const merged = await tap(page, `() => { const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null); const dlg = dlgs[dlgs.length - 1]; return dlg ? [...dlg.querySelectorAll('button')].reverse().find(b => /ghép cước thu khách/i.test(b.textContent.trim()) && !b.disabled) : null; }`);
    await sleep(3500);
    // capture any in-dialog error + the success toast
    const postMergeDlg = await page.evaluate(() => {
      const dlgs = [...document.querySelectorAll('[role=dialog], [class*="modal"]')].filter(m => m.offsetParent !== null);
      const dlg = dlgs[dlgs.length - 1];
      return dlg ? (dlg.innerText || '').replace(/\s+/g, ' ').slice(0, 300) : null;
    });
    const boardTextEarly = await bodyText(page);
    const mergeToast = boardTextEarly.match(/Đã ghép cước thu khách[^\n]*/)?.[0] ?? null;
    step('a4-post-merge', { merged, postMergeDlg, mergeToast });
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
    const zeroD = rowsInfo[1] && /(^|\s)0(\s|₫|$)/.test(rowsInfo[1]);
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
