// Full-guide Driver A — PHẦN A LCL chain (scenarios A.1 → A.4 of the customer
// test guide 161026100000, 16/10/2026). Re-cut 2026-10-17 for HEAD: the create
// form now demands BOTH operating points (FB-105) and relabelled the Kho
// picker, so the fields are addressed by `data-field-id` (lib `pickField`) and
// the dispatch grids are read by their div-row cells (lib `readPlanRows`).
//   A.1 Chứng từ (tiepvv) creates an LCL lot through the real UI form —
//       Nhà máy + Kho (CFS/Cảng) picked, detail shows "Lô hàng lẻ" +
//       "Chưa có container nào"; the stored lift/drop points follow the
//       direction (Nhập: Kho/Nhà máy · Xuất: Nhà máy/Kho).
//   A.2 Điều vận (dungnv) checks Kế hoạch Tổng quát — CẢNG NÂNG / CẢNG HẠ carry
//       the same direction-correct names and TỔNG QUAN HÀNG HÓA reads
//       "5 Pallet · 1.900 kg · 4 CBM".
//   A.3 Điều vận ticks 2 LCL lots → "Đang chọn 2 lô" bar → "Gán xe nhóm" opens
//       its dialog with the four required fields (read-only: nothing assigned —
//       the money split is driven by 2026-10-17-qa-lcl-group-drive.mjs).
//   A.4 Chứng từ merges customer revenue (Ghép cước thu khách) on Chi phí -
//       Quyết toán — board must show Lô 1 = the merged money, members 0₫ +
//       group note (customer defect phiếu 161026204709 / TC-A12).
// Fixtures: QA-FG16-A/B/C/D lots, deleted by the cleanup at the end of this file.
import {
  BASE, API, PIN, sleep, uuid, makeLogger, healthGate, login, api, psql, boot, tap, setInput, waitText, waitCount, bodyText,
  pickField, customerSites, siteOfType, deleteLot, readPlanRows, clickByText,
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
if (customer?.id && route?.id && cls5t?.id) {
  // The QA price-lane row this driver used to create now COLLIDES with the live
  // lane (customer × tuyến × 5T × today already prices 1.600.000), so the create
  // legitimately 409s and A.4 asserts against the money the merge actually
  // writes (freight_rate_snapshots) instead of a fixture amount.
  step('lane-note', { note: 'A.4 asserts the snapshot the merge writes — no fixture price row' });
}

// Both operating points the FB-105 create form now requires, resolved through
// the same endpoint the form calls.
const sites = customer?.id ? await customerSites(disp.token, customer.id) : [];
const factorySite = siteOfType(sites, 'FACTORY');
const warehouseSite = siteOfType(sites, 'WAREHOUSE');
step('create-sites', {
  factory: factorySite ? { id: factorySite.id, name: factorySite.name, shortName: factorySite.shortName } : null,
  warehouse: warehouseSite ? { id: warehouseSite.id, name: warehouseSite.name, shortName: warehouseSite.shortName } : null,
});
if (!factorySite || !warehouseSite) throw new Error('need a customer with both a FACTORY and a WAREHOUSE site');

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

    // ── A.1 claim sweep (manual 17/10 "chưa dùng được" bullets) ──────────────
    // FB-105 is supposed to have made the two operating-point labels follow the
    // direction, added their "+ Thêm …" buttons and let the segmented date cells
    // advance on two digits. Assert all three here, on the same form drive.
    const readCells = () => page.evaluate(() => {
      const cell = (id) => {
        const el = document.querySelector(`[data-field-id="${id}"]`);
        if (!el) return null;
        const input = el.querySelector('input');
        return {
          label: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
          placeholder: input?.getAttribute('placeholder') ?? null,
          required: /\*/.test(el.innerText || ''),
          buttons: [...el.querySelectorAll('button')].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 4),
        };
      };
      return { factory: cell('shipment-operational-site'), warehouse: cell('shipment-pickup-warehouse') };
    });
    const setDirection = (want) => page.evaluate((label) => {
      const sel = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => o.textContent.trim() === label));
      if (!sel) return false;
      const opt = [...sel.options].find((o) => o.textContent.trim() === label);
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;
      setter.call(sel, opt.value);
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, want);
    const undirected = await readCells();
    await setDirection('Nhập khẩu');
    await sleep(700);
    const imported = await readCells();
    await setDirection('Xuất khẩu');
    await sleep(700);
    const exported = await readCells();
    step('a1-labels', { undirected, imported, exported });
    const dynFactory = imported.factory?.label?.includes('Điểm trả hàng') && exported.factory?.label?.includes('Điểm lấy hàng');
    const dynWarehouse = imported.warehouse?.label?.includes('Kho lấy hàng (CFS/Cảng)') && exported.warehouse?.label?.includes('Kho trả hàng (CFS/Cảng)');
    const staticUndirected = /^Nhà máy/.test(undirected.factory?.label?.trim() ?? '') && /^Kho lấy hàng/.test(undirected.warehouse?.label?.trim() ?? '');
    const starsOk = Boolean(imported.factory?.required && imported.warehouse?.required && exported.factory?.required && exported.warehouse?.required);
    record('A.1.labels', dynFactory && dynWarehouse && staticUndirected && starsOk ? 'PASS' : 'FAIL',
      `Nhập → "${imported.factory?.label}" / "${imported.warehouse?.label}"; Xuất → "${exported.factory?.label}" / "${exported.warehouse?.label}"; no-direction stays "${undirected.factory?.label}" / "${undirected.warehouse?.label}"; both * marks=${starsOk}`);

    // segmented Ngày giao hàng: two digits in DD must advance to MM
    await tap(page, `() => document.getElementById('shipment-expected-delivery')`);
    await sleep(400);
    await page.keyboard.type('20', { delay: 90 });
    await sleep(500);
    const dateAdvance = await page.evaluate(() => {
      const dd = document.getElementById('shipment-expected-delivery');
      const mm = [...document.querySelectorAll('input')].find((i) => /^tháng — ngày giao hàng/i.test(i.getAttribute('aria-label') || ''));
      const ae = document.activeElement;
      return { dd: dd?.value ?? null, mm: mm?.value ?? null, focus: ae?.id || ae?.getAttribute('aria-label') || ae?.tagName, advanced: ae === mm };
    });
    step('a1-date-advance', dateAdvance);
    record('A.1.date-advance', dateAdvance.advanced ? 'PASS' : 'FAIL',
      `typed "20" into DD → DD="${dateAdvance.dd}" MM="${dateAdvance.mm}", focus moved to "${dateAdvance.focus}" (advanced=${dateAdvance.advanced})`);

    await pickField(page, 'shipment-customer', (customer.shortName || customer.name).slice(0, 6));
    const cellButtons = await readCells();
    step('a1-cell-buttons', cellButtons);
    const plusOk = Boolean(cellButtons.factory?.buttons?.some((b) => /thêm nhà máy/i.test(b)) && cellButtons.warehouse?.buttons?.some((b) => /thêm kho/i.test(b)));
    record('A.1.plus-buttons', plusOk ? 'PASS' : 'FAIL',
      `after customer "${customer.shortName ?? customer.name}": Nhà máy buttons=${JSON.stringify(cellButtons.factory?.buttons)}, Kho buttons=${JSON.stringify(cellButtons.warehouse?.buttons)} (the Kho catalog needs a customer, so it is asserted here, not before the pick)`);
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
    await page.click('[data-field-id="shipment-booking-ref"] input');
    await page.keyboard.type(refA, { delay: 25 });
    await sleep(300);
    // FB-105: BOTH operating points are required for an LCL catalog lot —
    // address them by data-field-id, never by the (now dynamic) label text.
    const factoryPicked = await pickField(page, 'shipment-operational-site', (factorySite.shortName || factorySite.name).slice(0, 8));
    const warehousePicked = await pickField(page, 'shipment-pickup-warehouse', (warehouseSite.shortName || warehouseSite.name).slice(0, 8));
    step('a1-points-picked', { factoryPicked, warehousePicked });
    const pkgPicked = await pickField(page, 'shipment-package-type', 'Pallet');
    for (const [fieldId, value] of [['shipment-package-count', '5'], ['shipment-cargo-weight', '1900'], ['shipment-cargo-volume', '4']]) {
      await page.click(`[data-field-id="${fieldId}"] input`);
      await page.keyboard.type(value, { delay: 30 });
      await sleep(250);
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
    const routePicked = await pickField(page, 'shipment-route', (route?.name ?? route?.code ?? '').slice(0, 6));
    step('a1-route-picked', { routePicked });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_form-filled.png', fullPage: true });

    // Tạo lô hàng (the form's primary submit)
    const saved = await tap(page, `() => [...document.querySelectorAll('button')].find(b => /^tạo lô hàng$/i.test(b.textContent.trim()) && !b.disabled)`);
    step('a1-save-click', { saved });
    await sleep(4500);

    // Detail assertions
    const detailOk = await waitText(page, 'Hàng lẻ', 15000);
    const noContainer = await waitText(page, 'Chưa có container nào', 8000);
    const body = await bodyText(page);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_detail.png', fullPage: true });
    const idMatch = page.url().match(/\/shipments\/(\d+)/);
    shipmentA = idMatch ? Number(idMatch[1]) : null;
    // A 400 leaves the form open with its "Cần bổ sung …" panel — surface it
    // instead of reporting a bare label miss.
    const validationPanel = shipmentA == null
      ? await page.evaluate(() => {
        const el = [...document.querySelectorAll('[role="alert"], [class*="missing"], [class*="issues"]')].find(n => /cần bổ sung/i.test(n.textContent || ''));
        return el ? (el.innerText || '').replace(/\s+/g, ' ').slice(0, 200) : null;
      })
      : null;
    step('a1-detail', { url: page.url(), detailOk, noContainer, validationPanel, snippet: body.slice(0, 400) });
    const dbA = shipmentA
      ? psql(`SELECT id, trade_direction, pickup_location, delivery_location, operational_site_id, package_type, package_count, cargo_weight_kg, cargo_volume_cbm FROM shipments WHERE id=${shipmentA}`)
      : '';
    step('a1-db', { row: dbA });
    // Xuất khẩu → Nâng (pickup_location) = Nhà máy, Hạ (delivery_location) = Kho
    const pointsOk = /EXPORT/.test(dbA)
      && dbA.toLowerCase().includes(String(factoryPicked.value ?? '').toLowerCase())
      && dbA.toLowerCase().includes(String(warehousePicked.value ?? '').toLowerCase());
    record('A.1', shipmentA != null && detailOk && noContainer && pointsOk ? 'PASS' : 'FAIL',
      `UI create → id=${shipmentA}, detail labels (Hàng lẻ=${detailOk}, Chưa có container nào=${noContainer}), points EXPORT pickup=${factoryPicked.value} drop=${warehousePicked.value}, db=[${dbA}]${validationPanel ? `, panel="${validationPanel}"` : ''}`);
  } catch (e) {
    step('a1-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a1_error.png', fullPage: true }).catch(() => {});
    record('A.1', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// Create the remaining fixtures (B/C/D) via the same real payload the UI sent.
// Field names are the API's (`packageCount`/`cargoWeightKg`/`cargoVolumeCbm`);
// the create form's own ids (`quantity`/`weightKg`/`volumeCbm`) are now REJECTED
// by the route guard, which is exactly why the old fixtures stored no cargo.
step('a1-captured-payload', { payload: capturedPayload });
async function createLot(ref) {
  const payload = capturedPayload && typeof capturedPayload === 'object'
    ? { ...capturedPayload, bookingRef: ref }
    : {
      customerId: customer.id, bookingRef: ref, tradeDirection: 'EXPORT', cargoMode: 'LCL',
      expectedDeliveryDate: today, packageType: 'Pallet', packageCount: 5, cargoWeightKg: 1900, cargoVolumeCbm: 4,
      operationalSiteId: factorySite.id,
      pickupWarehouseSiteId: warehouseSite.id,
      factoryName: factorySite.shortName ?? factorySite.name,
      routeId: route?.id ?? null,
    };
  const res = await api(cus.token, 'POST', '/shipments', payload);
  step('fixture-create', { ref, status: res.status, id: res.json?.id, err: res.json?.error ?? res.json?.message ?? null });
  return res.json?.id ?? null;
}
const shipmentB = await createLot(refB);
const shipmentC = await createLot(refC);
const shipmentD = await createLot(refD);
fs_writeFixtures({ shipmentA, shipmentB, shipmentC, shipmentD, refA, refB, refC, refD, customer: { id: customer?.id, name: customer?.name }, route: { id: route?.id, name: route?.name }, cls5t: { id: cls5t?.id, name: cls5t?.name }, hex });
function fs_writeFixtures(data) {
  writeFileSync('qa/2026-10-16_fullguide_fixtures.json', JSON.stringify(data, null, 2));
}

// ═════════════════════════════════════════════════════════════════ A.2 (UI) ══
// The master plan is a div grid: read each fixture row as aligned cells and
// assert the FB-105 lift/drop law — CẢNG NÂNG / CẢNG HẠ carry the Kho and the
// Nhà máy names by direction, never the bare "—" the doc complained about.
{
  const { browser, page } = await boot({ token: disp.token });
  try {
    await page.goto(`${BASE}/dispatch`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await sleep(4000);
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, `QA-FG16-${hex}`);
    const found = await waitText(page, refA, 20000);
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a2_master-plan.png', fullPage: true });
    let plan = null;
    for (let i = 0; i < 14; i += 1) {
      await sleep(1200);
      const attempt = await readPlanRows(page, [refA, refB, refC, refD]);
      const rowA = attempt.rows?.[refA];
      if (rowA && (rowA.cells?.length ?? 0) >= (attempt.headerCells?.length ?? 99)) { plan = attempt; break; }
      plan = plan ?? attempt;
    }
    const rowA = plan?.rows?.[refA] ?? null;
    const headers = plan?.headerCells ?? [];
    const liftIdx = headers.findIndex((h) => /nâng/i.test(h));
    const dropIdx = headers.findIndex((h) => /hạ/i.test(h));
    const cells = rowA?.cells ?? [];
    const rowText = rowA?.text ?? '';
    const cargoOk = /5 Pallet\s+1\.900 kg\s*·\s*4 CBM/.test(rowText);
    const norm = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
    const warehouseName = norm(warehouseSite.shortName ?? warehouseSite.name);
    const factoryName = norm(factorySite.shortName ?? factorySite.name);
    const lift = norm(cells[liftIdx]);
    const drop = norm(cells[dropIdx]);
    // Fixture A is EXPORT → NÂNG = Nhà máy, HẠ = Kho (CFS/Cảng)
    const liftOk = lift.length > 0 && (lift === factoryName || (factoryName.length > 5 && lift.includes(factoryName.slice(0, 12))));
    const dropOk = drop.length > 0 && (drop === warehouseName || (warehouseName.length > 5 && drop.includes(warehouseName.slice(0, 12))));
    step('a2-row', { found, headers, rowA: rowA ? { text: rowText.slice(0, 240), cells } : null, liftIdx, dropIdx, expectLift: factoryName, expectDrop: warehouseName, cargoOk });
    record('A.2', found && cargoOk && liftOk && dropOk ? 'PASS' : 'FAIL',
      `master plan (${refA}, Xuất khẩu): found=${found}, cargo=${cargoOk}, CẢNG NÂNG="${lift}" (want Nhà máy "${factoryName}"), CẢNG HẠ="${drop}" (want Kho "${warehouseName}")`);
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
    // The detail plan only lists lots that carry a dispatch schedule, so the
    // freshly created QA lots may not appear here (they live on /dispatch).
    // Prefer the run's own rows; otherwise tick the first two LCL rows the plan
    // offers — the dialog contract is what A.3 asserts, and nothing is assigned.
    const searchInput = `() => [...document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])')].find(i => /tìm|search/i.test(i.placeholder || ''))`;
    await setInput(page, searchInput, `QA-FG16-${hex}`);
    const foundOwn = await waitText(page, refA, 8000);
    let ticks = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('tr')].filter((r) => /QA-FG16/.test(r.textContent || ''));
      const out = [];
      for (const row of rows) {
        const box = row.querySelector('input[type="checkbox"], [role="checkbox"]');
        if (box && !box.checked) { box.click(); out.push(true); } else out.push(Boolean(box?.checked));
      }
      return { scope: 'own-fixtures', rows: rows.length, ticks: out };
    });
    if (ticks.rows < 2) {
      await setInput(page, searchInput, '');
      await sleep(2500);
      ticks = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('tr')].filter((r) => /Lẻ/.test(r.textContent || '') && r.querySelector('input[type="checkbox"], [role="checkbox"]'));
        const out = [];
        for (const row of rows.slice(0, 2)) {
          const box = row.querySelector('input[type="checkbox"], [role="checkbox"]');
          if (box && !box.checked) { box.click(); out.push(true); } else out.push(Boolean(box?.checked));
        }
        return { scope: 'plan-lcl-rows', rows: rows.length, ticks: out };
      });
    }
    await sleep(1500);
    const selectionBar = await bodyText(page);
    const barText = selectionBar.match(/Đang chọn[^\n]*/)?.[0] ?? null;
    const barOk = /Đang chọn 2 lô/.test(selectionBar);
    const groupBtn = await page.evaluate(() => {
      const b = [...document.querySelectorAll('button')].find((x) => /gán xe nhóm/i.test(x.textContent || '') && x.offsetParent !== null);
      return b ? { text: (b.textContent || '').trim(), disabled: b.disabled } : null;
    });
    step('a3-selection', { ticks, barOk, barText, groupBtn });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_selected.png', fullPage: true });

    // React Aria only opens this dialog for a TRUSTED click — element.click()
    // left it shut (2026-10-17).
    const opened = barOk && Boolean(groupBtn && !groupBtn.disabled) ? await clickByText(page, 'gán xe nhóm') : false;
    await sleep(2200);
    const dialog = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"], [class*="modal"], [class*="dialog"]')]
        .filter((x) => x.offsetParent !== null && /gán xe|nhóm/i.test(x.textContent || ''))[0];
      if (!d) return null;
      return {
        title: (d.querySelector('h1,h2,h3')?.textContent || '').trim(),
        labels: [...d.querySelectorAll('label')].map((l) => (l.textContent || '').replace(/\s+/g, ' ').trim()).slice(0, 12),
        buttons: [...d.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter(Boolean).slice(0, 8),
        text: (d.textContent || '').replace(/\s+/g, ' ').slice(0, 260),
      };
    });
    step('a3-dialog', { opened, dialog });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a3_dialog.png', fullPage: true });
    const labelText = (dialog?.labels ?? []).join(' | ');
    const fieldsOk = /loại xe tính cước trả/i.test(labelText) && /nhà xe/i.test(labelText) && /bks thực/i.test(labelText) && /bks báo khách/i.test(labelText);
    const splitNote = /Lô 1 giữ 100%/.test(dialog?.text ?? '');
    // Read-only: close without assigning — the 100%/0₫ money law itself is
    // driven end-to-end by 2026-10-17-qa-lcl-group-drive.mjs on the same build.
    await page.keyboard.press('Escape');
    await sleep(600);
    record('A.3', barOk && opened && fieldsOk ? 'PASS' : 'FAIL',
      `2 lô lẻ ticked (${ticks.ticks.filter(Boolean).length}/${ticks.rows}) → bar="${barText}" → "Gán xe nhóm" click opened dialog: title="${dialog?.title}", fields=[${labelText}], "Lô 1 giữ 100%" note=${splitNote} (nothing assigned this run)`);
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

    // THE TC-A12 assertion: board must now show freight money — Lô 1 = the
    // merged amount, member 0₫. The amount comes from the principal's live
    // freight snapshot (this customer × tuyến × 5T lane), not from a fixture.
    await sleep(2000);
    const boardText = await bodyText(page);
    const rowsInfo = await page.evaluate((refC, refD) => {
      const rows = [...document.querySelectorAll('tr, [class*="row"]')];
      return [refC, refD].map(ref => {
        const row = rows.find(r => (r.innerText || '').includes(ref));
        return row ? (row.innerText || '').replace(/\s+/g, ' ').slice(0, 400) : null;
      });
    }, refC, refD);
    const dbRev = psql(`SELECT sh.id, sh.booking_ref, sh.rev_group_order, tfs.revenue, tfs.revenue_override_reason FROM shipments sh LEFT JOIN trip_financial_state tfs ON tfs.trip_id IN (SELECT id FROM trips WHERE shipment_id = sh.id) WHERE sh.id IN (${shipmentC},${shipmentD}) ORDER BY sh.rev_group_order`);
    const dbSnap = psql(`SELECT shipment_id, total_amount, freight_amount, formula_text FROM freight_rate_snapshots WHERE shipment_id IN (${shipmentC},${shipmentD}) ORDER BY id`);
    step('a4-db', { rev: dbRev, snapshots: dbSnap });
    const snapRows = dbSnap.split('\n').filter(Boolean).map((line) => line.split('|'));
    const principalSnap = snapRows.find((r) => Number(r[0]) === Number(shipmentC)) ?? snapRows[0] ?? [];
    const principalAmount = Number(principalSnap[2] ?? principalSnap[1] ?? 0);
    const formatted = principalAmount > 0 ? principalAmount.toLocaleString('de-DE') : '';
    const moneyC = Boolean(rowsInfo[0]) && principalAmount > 0 && rowsInfo[0].includes(formatted);
    const zeroD = Boolean(rowsInfo[1]) && /(^|\s)0(\s|₫|$)/.test(rowsInfo[1]);
    const note = /Ghép cước cùng Bill|Ghép tiền cùng Bill/.test(boardText);
    step('a4-after', { merged, rowsInfo, principalAmount, formatted, moneyC, zeroD, note });
    record('A.4', merged && moneyC && zeroD ? 'PASS' : 'FAIL', `rev merge: merged=${merged}, Lô1 shows its snapshot ${principalAmount} (${formatted})=${moneyC}, member 0₫=${zeroD}, note=${note}, dbRev=[${dbRev}], dbSnap=[${dbSnap}]`);
  } catch (e) {
    step('a4-error', { error: String(e.message ?? e) });
    await page.screenshot({ path: 'qa/2026-10-16_fullguide_a4_error.png', fullPage: true }).catch(() => {});
    record('A.4', 'FAIL', String(e.message ?? e));
  } finally { await browser.close(); }
}

// ── cleanup: governed delete of every fixture lot (version read from the DB) ──
for (const [ref, id] of [[refA, shipmentA], [refB, shipmentB], [refC, shipmentC], [refD, shipmentD]]) {
  if (id == null) continue;
  const del = await deleteLot(admin.token, id, `QA cleanup fullguide A (${ref})`);
  step('cleanup', { ref, id, ...del });
}

step('SUMMARY', results);
writeFileSync('qa/2026-10-16_fullguide_a-results.json', JSON.stringify({ pin: PIN, date: new Date().toISOString(), results, fixtures: { shipmentA, shipmentB, shipmentC, shipmentD, refA, refB, refC, refD, hex } }, null, 2));
log('DRIVER A DONE');
