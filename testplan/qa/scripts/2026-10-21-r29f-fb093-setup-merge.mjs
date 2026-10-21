// R29F re-verify (2026-10-21) — FB-093 setup phase on STAGING-BUILT FE
// (vantai.tingting.vip, build 85ea2cef — recut of ebd032fb with QA-script-only
// commits; the FB-093 `essentialWhenHasData` fix is live in the deployed
// AccountingDebitClosePage chunk).
//
// Staging was QA-purged, so this drive CREATES its own scenario (every test
// row tagged "R29F"): 2 lô LCL cùng khách hàng YUANFANG (customer 20), mỗi lô
// một Số Booking (R29F-01/R29F-02 — theo đúng flow fb093 cũ CL4C-01/CL4C-02),
// lock OPEN, giao 2026-10-20 (trong window mặc định board kế toán 01→21/10):
//   Phase A: tiepvv UI /shipments/new (hàng lẻ) tạo từng lô.
//   Phase B: tiepvv UI /shipments-debit chọn 2 lô → "Ghép cước thu khách"
//            (dialog loại xe 5T) → cả 2 cùng revGroup, lô 2 = 0₫ + note ghép.
// Usage: node testplan/qa/scripts/2026-10-21-r29f-fb093-setup-merge.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const EXPECTED_BUILD = process.env.QA_EXPECT_BUILD || '85ea2cef';
const OUT = path.resolve('qa/2026-10-21-r29f-fb093-stgverify');
fs.mkdirSync(OUT, { recursive: true });
const BILLS = ['R29F-01', 'R29F-02'];
const MERGE_NOTE = 'Ghép cước cùng Bill R29F-01';

const LOG = [];
const NET = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const net = (line) => { NET.push(`${new Date().toISOString()} ${line}`); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};
const debitRows = async (token, bills = BILLS) => {
  const res = await fetch(`${API}/shipments/debit-summary`, { headers: { Authorization: `Bearer ${token}` } });
  net(`GET /api/shipments/debit-summary -> ${res.status}`);
  const body = await res.json();
  return (body?.items ?? []).filter((r) => bills.includes(r.billOrBookNumber))
    .map((r) => ({ ship: r.shipmentId, code: r.code, bill: r.billOrBookNumber, freight: r.freightAuto, note: r.freightOverrideReason, revGroup: r.revGroupId, revOrder: r.revGroupOrder, members: r.revGroupMemberCount, lock: r.lockStatus, cargoMode: r.cargoMode, customer: r.customerName }));
};

// ── build gate ──────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash, expected: EXPECTED_BUILD });
if (health?.buildHash !== EXPECTED_BUILD && !process.env.QA_IGNORE_BUILD) {
  log('ABORT: build mismatch');
  fs.writeFileSync(path.join(OUT, 'setup-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
  process.exit(2);
}

const tiepvv = await login('tiepvv');

// Idempotence: a previous run may already have created/merged the R29F lots.
const preRows = await debitRows(tiepvv);
log('precheck_rows', preRows);
if (preRows.length === 2 && preRows.every((r) => r.revGroup)) {
  record('setup: R29F lots already created + merged — reuse state', true, JSON.stringify(preRows));
  fs.writeFileSync(path.join(OUT, 'setup-db-state-reused.json'), JSON.stringify(preRows, null, 2));
  fs.writeFileSync(path.join(OUT, 'setup-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
  fs.writeFileSync(path.join(OUT, 'setup-net.log'), NET.join('\n'));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
  process.exit(exitCode);
}
if (preRows.length === 2 && preRows.some((r) => r.revGroup)) {
  log('ABORT: R29F lots exist but only partly grouped — clean up first');
  process.exit(2);
}
// Lots exist ungrouped (e.g. a verify drive already unmerged them) → skip
// creation and go straight to the merge phase.
const skipCreate = preRows.length === 2;
if (skipCreate) log('reusing existing ungrouped R29F lots — skip create');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  // ══ Phase A: tiepvv UI /shipments/new — tạo 2 lô hàng lẻ R29F ════════════
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const quickPosts = [];
  page.on('response', async (res) => {
    if (/\/api\/shipments\/quick$/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 400); } catch { /* noop */ }
      quickPosts.push({ status: res.status(), body: b });
      net(`POST /api/shipments/quick -> ${res.status()} ${b.slice(0, 200)}`);
      log('mutation_status', { status: res.status(), body: b.slice(0, 300) });
    }
    if (/\/api\/shipments\/lcl\/(merge|unmerge)-group/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 300); } catch { /* noop */ }
      net(`POST ${res.url()} -> ${res.status()} ${b.slice(0, 200)}`);
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tiepvv);

  const closePopovers = async () => {
    await page.keyboard.press('Escape');
    await sleep(250);
    await page.evaluate(() => (document.activeElement instanceof HTMLElement) && document.activeElement.blur());
    await sleep(250);
  };
  const pickFirstOption = async (clickSel, typeQuery = null, matchText = null) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await closePopovers();
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el instanceof HTMLElement) { el.click(); el.focus?.(); }
      }, clickSel);
      await sleep(1200);
      if (typeQuery) { await page.keyboard.type(typeQuery, { delay: 60 }); await sleep(1000); }
      const picked = await page.evaluate((match) => {
        const visible = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
        let opts = Array.from(document.querySelectorAll('.searchable-select__popover [role="option"], .searchable-select__popover button')).filter(visible);
        if (!opts.length) opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li, [role="listbox"] button')).filter(visible);
        if (!opts.length) opts = Array.from(document.querySelectorAll('[role="option"], [role="menuitem"]')).filter(visible);
        const clean = opts.map((el) => ({ el, text: (el.textContent || '').trim() })).filter((o) => o.text && !/^[-—–]/.test(o.text));
        const opt = match ? clean.find((o) => o.text.includes(match)) : clean[0];
        if (opt) { opt.el.click(); return opt.text.slice(0, 50); }
        return null;
      }, matchText);
      await sleep(500);
      await page.keyboard.press('Escape');
      await sleep(300);
      if (picked) return picked;
    }
    return null;
  };
  const fieldValue = (sel) => page.evaluate((s) => {
    const input = document.querySelector(s);
    return input?.value ?? null;
  }, sel);

  const createLot = async (bill, weightKg, cbm) => {
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('form.csc-workspace', { timeout: 30000 });
    await sleep(1500);

    // 1) mode "Hàng lẻ" (LCL) — empty form so no mode-switch confirm.
    await page.evaluate(() => {
      const radio = document.querySelector('input[name="cargo-mode"][value="LCL"]');
      if (radio instanceof HTMLElement) radio.click();
    });
    await sleep(800);
    const mode = await page.evaluate(() => (document.querySelector('input[name="cargo-mode"][value="LCL"]')?.checked ?? null));
    log('create_mode_lcl', { bill, mode });

    // 2) identity: khách hàng YUANFANG, Xuất khẩu, Số Booking.
    const customer = await pickFirstOption('[data-field-id="shipment-customer"] input', 'YUAN', 'YUANFANG');
    log('create_customer', { bill, customer });
    await page.click('[data-field-id="shipment-trade-direction"] button, [data-field-id="shipment-trade-direction"] [role="combobox"], [data-field-id="shipment-trade-direction"] .searchable-select__trigger', { timeout: 8000 }).catch(() => {});
    await sleep(400);
    await page.evaluate(() => {
      const visible = (el) => el && el.offsetParent !== null;
      const opt = Array.from(document.querySelectorAll('[role="option"], .searchable-select__option'))
        .filter(visible).find((el) => (el.textContent || '').includes('Xuất khẩu'));
      if (opt instanceof HTMLElement) opt.click();
    });
    await sleep(400);
    await page.keyboard.press('Escape');
    await page.type('[data-field-id="shipment-booking-ref"] input', bill, { delay: 15 });
    log('create_booking', { bill, value: await fieldValue('[data-field-id="shipment-booking-ref"] input') });

    // 3) điểm vận hành & tuyến (Nhà máy → route auto-fill nếu site có route).
    const factory = await pickFirstOption('[data-field-id="shipment-operational-site"] input', null, null);
    log('create_factory', { bill, factory });
    await sleep(800);
    let routeVal = await page.evaluate(() => {
      const wrap = document.querySelector('[data-field-id="shipment-route"]');
      return wrap?.textContent?.trim().slice(0, 60) ?? null;
    });
    if (!routeVal || /Gõ chọn|Chọn /.test(routeVal)) {
      const route = await pickFirstOption('[data-field-id="shipment-route"] input', null, null);
      routeVal = await page.evaluate(() => document.querySelector('[data-field-id="shipment-route"]')?.textContent?.trim().slice(0, 60) ?? null);
      log('create_route', { bill, route, routeVal });
    } else {
      log('create_route_autofilled', { bill, routeVal });
    }
    const warehouse = await pickFirstOption('[data-field-id="shipment-pickup-warehouse"] input', null, null);
    log('create_warehouse', { bill, warehouse });

    // 4) thông tin hàng (UUI inputs sống dưới [data-field-id] wrapper — id là
    //    react-aria generated, KHÔNG phải #shipment-*).
    await page.type('[data-field-id="shipment-package-type"] input', 'Thùng carton', { delay: 10 });
    await page.type('[data-field-id="shipment-package-count"] input', '5', { delay: 10 });
    await page.type('[data-field-id="shipment-cargo-weight"] input', String(weightKg), { delay: 10 });
    await page.type('[data-field-id="shipment-cargo-volume"] input', String(cbm), { delay: 10 });

    // 5) Ngày giao hàng 20/10/2026 — buffered segment input (dd mm2 yyyy).
    await page.evaluate(() => {
      const seg = document.querySelector('[data-field-id="shipment-expected-delivery"] input[data-seg="dd"]');
      if (seg instanceof HTMLElement) seg.click();
    });
    await sleep(400);
    await page.keyboard.type('20102026', { delay: 90 });
    await sleep(400);
    await closePopovers();

    const filled = await page.evaluate(() => ({
      modeLcl: document.querySelector('input[name="cargo-mode"][value="LCL"]')?.checked ?? null,
      customer: document.querySelector('[data-field-id="shipment-customer"] input')?.value ?? null,
      booking: document.querySelector('[data-field-id="shipment-booking-ref"] input')?.value ?? null,
      route: document.querySelector('[data-field-id="shipment-route"]')?.textContent?.trim().slice(0, 40) ?? null,
      factory: document.querySelector('[data-field-id="shipment-operational-site"]')?.textContent?.trim().slice(0, 40) ?? null,
      warehouse: document.querySelector('[data-field-id="shipment-pickup-warehouse"]')?.textContent?.trim().slice(0, 40) ?? null,
      packageType: document.querySelector('[data-field-id="shipment-package-type"] input')?.value ?? null,
      packageCount: document.querySelector('[data-field-id="shipment-package-count"] input')?.value ?? null,
      weight: document.querySelector('[data-field-id="shipment-cargo-weight"] input')?.value ?? null,
      volume: document.querySelector('[data-field-id="shipment-cargo-volume"] input')?.value ?? null,
      delivery: document.querySelector('[data-field-id="shipment-expected-delivery"]')?.textContent?.trim().slice(0, 40) ?? null,
    }));
    log('create_filled', { bill, filled });
    fs.writeFileSync(path.join(OUT, `setup-01-create-form-${bill}.txt`), JSON.stringify(filled, null, 2));
    await page.screenshot({ path: path.join(OUT, `setup-01-create-form-${bill}.png`), fullPage: true });

    quickPosts.length = 0;
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Tạo lô hàng'));
      btn?.click();
    });
    let createdId = null;
    for (let i = 0; i < 15; i++) {
      await sleep(800);
      const m = page.url().match(/\/shipments\/(\d+)/);
      if (m) { createdId = Number(m[1]); break; }
    }
    await sleep(1200);
    await page.screenshot({ path: path.join(OUT, `setup-02-create-done-${bill}.png`), fullPage: true });
    const summary = await page.evaluate(() => document.querySelector('.csc-validation-summary')?.textContent?.trim().slice(0, 200) ?? null);
    return { bill, createdId, quickStatus: quickPosts.map((p) => p.status), summary };
  };

  let lot1 = { bill: BILLS[0], createdId: preRows.find((r) => r.bill === BILLS[0])?.ship ?? null, quickStatus: [], summary: 'reused' };
  let lot2 = { bill: BILLS[1], createdId: preRows.find((r) => r.bill === BILLS[1])?.ship ?? null, quickStatus: [], summary: 'reused' };
  if (!skipCreate) {
    lot1 = await createLot(BILLS[0], 1500, 3.5);
    log('created_lot1', lot1);
    lot2 = await createLot(BILLS[1], 2000, 4.8);
    log('created_lot2', lot2);
  }
  record('R29F setup A: UI /shipments/new tạo 2 lô hàng lẻ R29F (YUANFANG, Số Booking R29F-01/02, giao 20/10/2026) — POST /shipments/quick 201 cả 2 (hoặc tái dùng lô đã tạo)',
    Boolean(lot1.createdId) && Boolean(lot2.createdId)
      && (skipCreate || (lot1.quickStatus.includes(201) && lot2.quickStatus.includes(201))),
    JSON.stringify({ lot1, lot2 }));

  // pre-merge snapshot — the baseline "cước phân bổ lại đúng" compares against.
  const beforeMerge = await debitRows(tiepvv);
  log('before_merge_rows', beforeMerge);
  fs.writeFileSync(path.join(OUT, 'setup-db-before-merge.json'), JSON.stringify(beforeMerge, null, 2));

  await page.close();

  // ══ Phase B: tiepvv UI /shipments-debit — Ghép cước thu khách ═══════════
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1440, height: 900 });
  page2.on('response', async (res) => {
    if (/\/api\/shipments\/lcl\/(merge|unmerge)-group/.test(res.url()) && res.request().method() === 'POST') {
      let b = ''; try { b = (await res.text()).slice(0, 300); } catch { /* noop */ }
      net(`POST ${res.url()} -> ${res.status()} ${b.slice(0, 200)}`);
      log('lcl_api', { url: res.url(), status: res.status(), body: b.slice(0, 250) });
    }
  });
  await page2.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tiepvv);
  await page2.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page2.waitForSelector('table', { timeout: 30000 });
  await sleep(2500);

  const selectRow = async (code) => page2.evaluate((c) => {
    const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes(c));
    if (!td) return false;
    const tr = td.closest('tr');
    const clickable = tr?.querySelector('[data-selected]') || tr;
    clickable.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return Boolean(tr?.querySelector('input[type="checkbox"]'));
  }, code);
  await selectRow(BILLS[0]);
  await sleep(500);
  await selectRow(BILLS[1]);
  await sleep(700);
  const sel = await page2.evaluate(() => ({
    selected: document.querySelectorAll('[data-selected="true"]').length,
    mergeBtn: Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách'))?.disabled ?? null,
  }));
  log('selection', sel);
  await page2.screenshot({ path: path.join(OUT, 'setup-03-selected-2-lots.png'), fullPage: true });
  if (sel.mergeBtn !== false) {
    await page2.evaluate((bills) => {
      for (const code of bills) {
        const td = Array.from(document.querySelectorAll('td')).find((el) => (el.textContent || '').includes(code));
        const cb = td?.closest('tr')?.querySelector('input[type="checkbox"]');
        if (cb && !cb.checked) cb.click();
      }
    }, BILLS);
    await sleep(700);
  }
  await page2.evaluate(() => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').includes('Ghép cước thu khách'));
    if (btn && !btn.disabled) btn.click();
  });
  await sleep(1200);
  const dlg = await page2.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    return { open: Boolean(d), text: (d?.textContent || '').slice(0, 200) };
  });
  log('merge_dialog', dlg);
  await page2.screenshot({ path: path.join(OUT, 'setup-04-merge-dialog.png'), fullPage: true });
  if (!dlg.open) throw new Error('merge dialog did not open');

  await page2.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    const input = Array.from(d?.querySelectorAll('input') ?? []).find((i) => (i.placeholder || '').includes('loại xe') || i.getAttribute('role') === 'combobox') ?? Array.from(d?.querySelectorAll('input') ?? [])[0];
    input?.click();
    input?.focus();
  });
  await sleep(1300);
  const pickedClass = await page2.evaluate(() => {
    const visible = (el) => el && (el.offsetParent !== null || getComputedStyle(el).position === 'fixed');
    const opts = Array.from(document.querySelectorAll('[role="listbox"] [role="option"], [role="listbox"] li')).filter(visible)
      .map((el) => ({ el, text: (el.textContent || '').trim() }));
    const opt = opts.find((o) => /Xe 5 tấn/.test(o.text)) ?? opts.find((o) => /5T/.test(o.text)) ?? opts[0];
    if (opt) { opt.el.click(); return opt.text.slice(0, 40); }
    return null;
  });
  await sleep(600);
  log('vehicle_class_picked', { pickedClass });
  await page2.screenshot({ path: path.join(OUT, 'setup-05-merge-dialog-class-picked.png'), fullPage: true });

  await page2.evaluate(() => {
    const d = document.querySelector('[role="dialog"], .modal, [class*="modal"]');
    const btn = Array.from(d?.querySelectorAll('button') ?? []).find((b) => (b.textContent || '').includes('Ghép cước thu khách'));
    btn?.click();
  });
  let merged = false;
  let afterMerge = [];
  for (let i = 0; i < 15; i++) {
    await sleep(800);
    afterMerge = await debitRows(tiepvv);
    if (afterMerge.length === 2 && afterMerge.every((r) => r.revGroup)) { merged = true; break; }
  }
  afterMerge = await debitRows(tiepvv);
  log('after_merge_rows', afterMerge);
  fs.writeFileSync(path.join(OUT, 'setup-db-after-merge.json'), JSON.stringify(afterMerge, null, 2));
  await page2.screenshot({ path: path.join(OUT, 'setup-06-merged-cus-board.png'), fullPage: true });
  record('R29F setup B: UI /shipments-debit ghép cước thu khách 2 lô R29F OK — cùng revGroup, lô 2 = 0₫ + note "Ghép cước cùng Bill R29F-01", lock OPEN',
    merged
      && afterMerge.length === 2
      && new Set(afterMerge.map((r) => r.revGroup)).size === 1
      && String(afterMerge.find((r) => r.bill === BILLS[1])?.note ?? '').includes(MERGE_NOTE)
      && afterMerge.every((r) => r.lock === 'OPEN'),
    JSON.stringify(afterMerge));
  await page2.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'setup-ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
fs.writeFileSync(path.join(OUT, 'setup-net.log'), NET.join('\n'));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
