// R9B UI DRIVEN (rung 3) — SIL-770 (driver-fee catalog filter) + SIL-777
// (note optional) + SIL-782 (Chi tiết Debit CUS: flat list + drawer Chốt giá
// bán, giá vốn ẩn khỏi CUS).
// Drives THIS worktree's stack: FE http://localhost:7205 → BE :3102, shared
// dev DB :5441. Lot under test: 1138 (SIL668-MW0CCWZH-BL, OPEN lock, 2 conts,
// freight snapshots) + one accountant-added Phí khác row for the dual-input.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7205';
const API = process.env.R9B_API ?? 'http://localhost:3102/api';
const OUT = process.env.EVIDENCE ?? 'qa/2026-11-09_r9b-ops-debit';
const LOT = Number(process.env.LOT_ID ?? 1138);
const LOT_CODE = process.env.LOT_CODE ?? 'SIL668-MW0CCWZH-BL';
const TRIP_ID = Number(process.env.TRIP_ID ?? 772);
fs.mkdirSync(OUT, { recursive: true });
const log = [];
const say = (l) => { log.push(l); console.log(l); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!body?.token) return { token: null, user: null, status: res.status };
  return body;
}

async function api(token, path, init = {}) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  let body = null;
  try { body = await res.json(); } catch { body = null; }
  return { status: res.status, body };
}

async function withPage(browser, token, viewport, fn) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  page.on('pageerror', (err) => say(`PAGEERROR: ${err.message}`));
  try { await fn(page); } finally { await page.close(); }
}

const ops = await login('hoangnh');
const acc = await login('hoapt');
const cus = await login('thanhdc');
const driver = await login('laixe');
check('login hoangnh (OPS)', ops.token != null, `${ops.user?.role ?? ops.status}`);
check('login hoapt (ACCOUNTANT)', acc.token != null, `${acc.user?.role ?? acc.status}`);
check('login thanhdc (CUS)', cus.token != null, `${cus.user?.role ?? cus.status}`);
say(`driver laixe login: ${driver.token ? driver.user?.role : `HTTP ${driver.status}`}`);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });

// ─── P1: SIL-770 — the Ops/CUS catalog filters the driver cost codes ────────
say('\nP1 — SIL-770 catalog filter (API)');
const types = await api(ops.token, '/ops/expense-types');
check('GET /ops/expense-types 200', types.status === 200);
const opsCodes = (types.body?.items ?? []).map((t) => t.code);
const driverCodes = opsCodes.filter((code) => ['FUEL', 'ROAD_REPAIR'].includes(code));
check('no driver cost code in the Ops picker', driverCodes.length === 0, JSON.stringify(driverCodes));
for (const expected of ['INSPECTION', 'FEE_STEVEDORING', 'LIFTING', 'LOWERING', 'INFRASTRUCTURE', 'YARD_STORAGE_LIFT']) {
  check(`ops fee stays: ${expected}`, opsCodes.includes(expected));
}
if (driver.token) {
  // The driver app's road-bucket list is its OWN surface: option codes come
  // from driver-side endpoints (fee norms) + the driver options module —
  // neither touched by this branch (SIL-770 keeps "chi phí của ai người đó
  // tự khai").
  const norms = await api(driver.token, '/driver/me/fee-norms');
  check('driver fee-norms endpoint healthy (200)', norms.status === 200, `HTTP ${norms.status}`);
  const optsSrc = fs.readFileSync('frontend/src/features/driver/driver-expense-options.ts', 'utf8');
  check('driver options module untouched (TOLL + ROAD_REPAIR still listed)',
    optsSrc.includes("'ROAD_REPAIR'") && /Vé cầu đường|TOLL/.test(optsSrc));
} else {
  say('  SKIP driver catalog check — laixe/Abc123 not available; endpoint untouched by this branch (coverage limit)');
}

// ─── P2: SIL-782 — the summary wire: sell columns + CUS giá-vốn strip ──────
say('\nP2 — SIL-782 summary wire + role strip (API)');
// Setup: one editable Phí khác row (reuse an earlier run's row first — reruns
// must not pile up duplicates on the QA lot).
const preRev = await api(acc.token, `/shipments/${LOT}/debit-detail`);
const existingFee = (preRev.body?.chiHoRows ?? []).flatMap((row) => row.otherFees ?? []).find((fee) => fee.name === 'QA-R9B phí khác chốt');
if (existingFee == null) {
  const accAdd = await api(acc.token, `/shipments/${LOT}/debit-edits`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ addOtherFees: [{ tripId: TRIP_ID, name: 'QA-R9B phí khác chốt', amount: 50000 }] }),
  });
  check('accountant adds Phí khác row (setup)', accAdd.status === 200, JSON.stringify(accAdd.body).slice(0, 120));
} else {
  say('  setup row already present — reused');
}

const accRow = (await api(acc.token, '/shipments/debit-summary?lockStatus=ALL')).body?.items?.find((row) => row.shipmentId === LOT) ?? null;
check('ACCOUNTANT summary has the sell columns', accRow != null
  && accRow.chiHoSellTotal != null && accRow.serviceSellTotal != null, JSON.stringify({ chi: accRow?.chiHoSellTotal, svc: accRow?.serviceSellTotal }));
check('ACCOUNTANT keeps the cost fields (not stripped)', accRow != null
  && 'payableTotal' in accRow && accRow.profit != null);
// Conservation: freight + chi hộ (Có HĐ) + dịch vụ (Không HĐ) = phải thu.
if (accRow != null && accRow.freightAuto != null && accRow.chiHoSellTotal != null && accRow.serviceSellTotal != null && accRow.receivableTotal != null) {
  const sum = Number(accRow.freightAuto) + Number(accRow.chiHoSellTotal) + Number(accRow.serviceSellTotal);
  check('sell columns conserve the receivable sum', Math.abs(sum - Number(accRow.receivableTotal)) < 0.01, `${sum} vs ${accRow.receivableTotal}`);
}

if (cus.token) {
  const cusRow = (await api(cus.token, '/shipments/debit-summary?lockStatus=ALL')).body?.items?.find((row) => row.shipmentId === LOT) ?? null;
  check('CUS summary still delivers the sell columns', cusRow != null && cusRow.chiHoSellTotal != null && cusRow.receivableTotal != null);
  check('CUS wire strips giá vốn (payable/profit/carrier/ops all null)', cusRow != null
    && cusRow.payableTotal == null && cusRow.profit == null
    && cusRow.carrierCostTotal == null && cusRow.opsCostTotal == null,
  JSON.stringify({ p: cusRow?.payableTotal, ln: cusRow?.profit, c: cusRow?.carrierCostTotal, o: cusRow?.opsCostTotal }));
  const cusEdit = await api(cus.token, `/shipments/${LOT}/debit-edits`, {
    method: 'PUT',
    headers: { 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ edits: [{ expenseId: existingFee?.id ?? 1, sellAmount: 150000 }] }),
  });
  check('CUS chốt giá bán saves (200)', cusEdit.status === 200, JSON.stringify(cusEdit.body).slice(0, 120));
} else {
  say('  SKIP CUS wire/edits probes — thanhdc/Abc123 unavailable (coverage limit; strip pinned by BE unit + source)');
}

// OPS stays outside the settlement surface (REV2: the screen is the CUS's).
const opsSummary = await api(ops.token, '/shipments/debit-summary?lockStatus=ALL');
check('OPS refused on /debit-summary (403)', opsSummary.status === 403, `HTTP ${opsSummary.status}`);
const opsEdit = await api(ops.token, `/shipments/${LOT}/debit-edits`, {
  method: 'PUT',
  headers: { 'Idempotency-Key': crypto.randomUUID() },
  body: JSON.stringify({ edits: [{ expenseId: existingFee?.id ?? 1, sellAmount: 1 }] }),
});
check('OPS refused on /debit-edits (403)', opsEdit.status === 403, `HTTP ${opsEdit.status}`);

// ─── U1+U2: SIL-770 + SIL-777 — the Khai báo chi phí popup (hoangnh) ────────
await withPage(browser, ops.token, { width: 1440, height: 1000 }, async (page) => {
  say('\nU1/U2 — SIL-770 + SIL-777 popup (hoangnh @1440, /my-orders — the Ops home)');
  await page.goto(`${BASE}/my-orders`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.includes('Khai chi phí')), { timeout: 60000 });
  check('ops lot list renders with Khai chi phí entries', true);
  await page.evaluate(() => {
    [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Khai chi phí'))?.click();
  });
  check('drawer Khai chi phí opens the popup', true);
  await page.waitForFunction(() => document.body.innerText.includes('Khai báo chi phí'), { timeout: 30000 });
  check('popup renders with catalog loaded', true);

  // U1 — the no-invoice Loại phí dropdown: no driver fee inside. The full
  // catalog renders the house combobox (input + listbox), not the short-list
  // button variant.
  const triggerOpened = await page.evaluate(() => {
    const blk = [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const input = blk.querySelector('input[role="combobox"], input[aria-haspopup="listbox"]')
      ?? [...blk.querySelectorAll('label')].find((l) => l.textContent.includes('Loại phí'))?.querySelector('input');
    if (!input) return false;
    input.click();
    input.focus();
    return true;
  });
  check('Loại phí combobox found and clicked', triggerOpened);
  try {
    await page.waitForSelector('[role="option"]', { timeout: 8000 });
  } catch {
    // The combobox opens its listbox on typing — 'Phí' matches every fee
    // name (driver fees included if any leaked), so the absence checks below
    // are honest.
    await page.keyboard.type('Phí');
    await page.waitForSelector('[role="option"]', { timeout: 8000 });
  }
  const options = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()));
  check('dropdown renders options', options.length > 0, options.join(' | ').slice(0, 160));
  check('dropdown lists ops fees', options.some((o) => o.includes('Phí chi hộ khác')), options.join(' | ').slice(0, 200));
  check('dropdown has NO Phí nhiên liệu / dầu', options.length > 0 && !options.some((o) => o.includes('nhiên liệu')));
  check('dropdown has NO Phí sửa chữa dọc đường', options.length > 0 && !options.some((o) => o.includes('sửa chữa dọc đường')));
  await page.screenshot({ path: `${OUT}/sil-770_ui-1-ops-type-dropdown-1440.png` });
  // Close the dropdown, pick Phí chi hộ khác.
  await page.evaluate(() => {
    const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Phí chi hộ khác'));
    opt?.click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll('[role="option"]')].length, { timeout: 10000 });
  await sleep(400);

  // U2 — Loại + Số tiền ONLY (Thực thu + Ghi chú empty) → Lưu opens → saves.
  const amountFilled = await page.evaluate(() => {
    const blk = [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const label = [...blk.querySelectorAll('label')].find((l) => l.textContent.includes('Thực chi'));
    const input = label ? (label.control ?? (label.htmlFor ? document.getElementById(label.htmlFor) : null) ?? label.querySelector('input')) : null;
    if (!input) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, '50000');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  });
  check('amount input targeted and filled', amountFilled);
  // Name the row so the QA fixture registry (fee_name ILIKE 'QA%') owns it.
  await page.evaluate(() => {
    const blk = [...document.querySelectorAll('section[aria-label]')].find((s) => s.getAttribute('aria-label') === 'Phí không hóa đơn');
    const label = [...blk.querySelectorAll('label')].find((l) => l.textContent.includes('Tên khoản chi'));
    const input = label?.querySelector('input');
    if (!input) return;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'QA-R9B-777');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await sleep(400);
  const saveState = await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    const save = [...form.querySelectorAll('button[type="submit"]')].find((b) => b.textContent.includes('Lưu'));
    return { disabled: save.disabled, notice: form.querySelector('.ops-modal__foot')?.innerText ?? '' };
  });
  check('SIL-777: Lưu ENABLED with empty Thực thu + Ghi chú', saveState.disabled === false, saveState.notice.slice(0, 80));
  check('SIL-777: no "ghi chú bắt buộc" notice', !saveState.notice.includes('ghi chú bắt buộc'));
  await page.screenshot({ path: `${OUT}/sil-777_ui-2-note-optional-save-1440.png` });
  await page.evaluate(() => {
    const form = document.querySelector('form.ops-modal');
    [...form.querySelectorAll('button[type="submit"]')].find((b) => b.textContent.includes('Lưu'))?.click();
  });
  // A rerun hits the 409 duplicate design: the confirm panel asks "BẠN VẪN
  // TIẾP TỤC NHẬP CHỨ?" — an explicit Tiếp tục lưu (split-payment override).
  await sleep(3000);
  await page.evaluate(() => {
    const again = [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Tiếp tục lưu'));
    if (again) again.click();
  });
  try {
    await page.waitForFunction(() => document.body.innerText.includes('Đã ghi nhận'), { timeout: 15000 });
  } catch {
    const state = await page.evaluate(() => ({
      form: document.querySelector('form.ops-modal')?.innerText.slice(0, 600) ?? '(modal closed)',
      toasts: document.querySelector('.toast-container')?.innerText ?? '(no toast)',
    }));
    console.log('SAVE-STATE DUMP:', JSON.stringify(state, null, 2));
    throw new Error('save did not reach the success toast');
  }
  check('SIL-777: save succeeds without note (success toast)', true);
  await page.screenshot({ path: `${OUT}/sil-777_ui-3-saved-toast-1440.png` });
});

// ─── U3: SIL-782 — the flat board + Chốt giá bán drawer (hoapt @1440) ───────
await withPage(browser, acc.token, { width: 1440, height: 1000 }, async (page) => {
  say('\nU3 — SIL-782 flat board + drawer (hoapt @1440)');
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await page.waitForFunction((code) => document.body.innerText.includes(code), { timeout: 60000 }, LOT_CODE);
  const body = await page.evaluate(() => document.body.innerText);
  const headers = await page.evaluate(() => [...document.querySelectorAll('th')].map((th) => th.innerText.trim()));
  // REV2 columns render.
  check('Cước vận tải (Auto) column renders', headers.some((h) => h.toUpperCase().includes('CƯỚC VẬN TẢI')), headers.join(' | ').slice(0, 200));
  check('Tổng Chi hộ (Có HĐ) column renders', headers.some((h) => h.toUpperCase().includes('CHI HỘ')));
  check('Tổng Dịch vụ (Không HĐ) column renders', headers.some((h) => h.toUpperCase().includes('DỊCH VỤ')));
  check('TỔNG PHẢI THU KHÁCH column renders', headers.some((h) => h.toUpperCase().includes('TỔNG PHẢI THU')));
  // Giá vốn columns are GONE from the board.
  check('NO giá-vốn column renders', !headers.some((h) => /CƯỚC TRẢ|CHI NỘI ĐỊA|TỔNG CHI \(|LN GỘP/.test(h.toUpperCase())), headers.join(' | ').slice(0, 200));
  await page.screenshot({ path: `${OUT}/sil-782_ui-4-flat-board-1440.png` });

  // Click the lot row → the Chốt giá bán drawer opens beside the board.
  await page.evaluate((code) => {
    const row = [...document.querySelectorAll('tr')].find((tr) => tr.innerText.includes(code));
    row?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }, LOT_CODE);
  await page.waitForFunction(() => document.body.innerText.includes('Chốt giá bán —'), { timeout: 30000 });
  check('row click opens the Chốt giá bán drawer', true);
  // The workspace fetches its L2 detail — wait for the load to finish before
  // reading the drawer's face.
  await page.waitForFunction(() => {
    const drawer = document.querySelector('.shipment-debit-drawer');
    return drawer != null && !drawer.innerText.includes('Đang tải chi tiết lô…');
  }, { timeout: 30000 });
  const drawerText = await page.evaluate(() => document.querySelector('.shipment-debit-drawer')?.innerText ?? '');
  check('drawer carries the Phí Không HĐ dual-input', drawerText.includes('Thực chi Ops') && drawerText.includes('Thu khách hàng'), drawerText.slice(0, 160));
  check('drawer has NO payables board', !drawerText.includes('Phí Phải trả') && !drawerText.includes('Cước trả'));
  check('drawer keeps Điều chỉnh cước + Khóa lô', drawerText.includes('ĐIỀU CHỈNH CƯỚC') && drawerText.includes('KHÓA LÔ HÀNG'));
  await page.screenshot({ path: `${OUT}/sil-782_ui-5-drawer-1440.png` });

  // Dual-input: the Thu khách hàng input saves through the strict endpoint.
  // The lot can carry a readOnly OTHER row too — target the ENABLED input
  // (a disabled input ignores the synthetic value set, so the savebar would
  // never appear).
  const sellInput = await page.$('input[aria-label*="Thu khách hàng phí khác"]:not(:disabled)');
  check('Thu khách hàng input editable', sellInput != null);
  if (sellInput) {
    await page.evaluate((el) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, '160000');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }, sellInput);
    await sleep(500);
    await page.evaluate(() => {
      [...document.querySelectorAll('button')].find((b) => b.textContent.includes('Lưu điều chỉnh'))?.click();
    });
    // The workspace savebar unmounts the moment the save succeeds (the delta
    // empties and 'Đã lưu' hides with its container) — verify PERSISTENCE on
    // the wire instead of the transient label.
    let persisted = false;
    for (let poll = 0; poll < 20 && !persisted; poll++) {
      await sleep(1000);
      const detail = await api(acc.token, `/shipments/${LOT}/debit-detail`);
      const savedFee = (detail.body?.chiHoRows ?? []).flatMap((row) => row.otherFees)
        .find((fee) => fee.name === 'QA-R9B phí khác chốt' && !fee.readOnly);
      persisted = savedFee?.thuKhach === 160000;
    }
    check('dual-input save persists (wire thuKhach 160000)', persisted);
    await page.screenshot({ path: `${OUT}/sil-782_ui-6-drawer-saved-1440.png` });
  }
  // Responsive bands of the changed board.
  for (const [w, h] of [[768, 1000], [390, 844]]) {
    await page.setViewport({ width: w, height: h });
    await sleep(600);
    await page.screenshot({ path: `${OUT}/sil-782_ui-7-board-${w}.png` });
  }
});

// ─── U4: SIL-782 — the CUS face (thanhdc @1440) when available ──────────────
if (cus.token) {
  await withPage(browser, cus.token, { width: 1440, height: 1000 }, async (page) => {
    say('\nU4 — SIL-782 CUS face (thanhdc @1440)');
    await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
    await page.waitForFunction((code) => document.body.innerText.includes(code), { timeout: 60000 }, LOT_CODE);
    const body = await page.evaluate(() => document.body.innerText);
    // The thead renders UPPERCASE via CSS — compare case-insensitively.
    check('CUS sees the revenue board', /Tổng phải thu khách/i.test(body));
    check('CUS sees NO giá-vốn figure (payable/profit cells absent)', !/Tổng chi \(₫\)|LN gộp \(₫\)/.test(body));
    await page.screenshot({ path: `${OUT}/sil-782_ui-8-cus-board-1440.png` });
  });
} else {
  say('  SKIP U4 — CUS account unavailable (coverage limit)');
}

await browser.close();
// ─── DB side effects ────────────────────────────────────────────────────────
const { execSync } = await import('node:child_process');
const dbRows = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT te.id, te.fee_name, te.buy_amount, te.sell_amount FROM trip_expenses te WHERE te.fee_name LIKE 'QA-R9B%' ORDER BY te.id"`).toString().trim();
say(`\nDB trip_expenses QA-R9B rows:\n${dbRows}`);
const dbOps = execSync(`docker exec ss-prod-db psql -U postgres -d silversea -tAc "SELECT id, expense_type_code, amount, coalesce(note,'<NULL>') FROM ops_expense_entries WHERE fee_name = 'QA-R9B-777' ORDER BY id DESC LIMIT 3"`).toString().trim();
say(`DB ops_expense_entries QA-R9B-777 rows (note must be NULL for SIL-777):\n${dbOps}`);
check('SIL-777 DB: ops row saved with note NULL', /<NULL>/.test(dbOps));
check('SIL-782 DB: chốt sell_amount persisted 160000 (UI save)', /160000/.test(dbRows));

fs.writeFileSync(`${OUT}/ui-driver.log`, log.join('\n') + `\n\nchecks ${checks}, fails ${fails.length}\n`, 'utf8');
console.log(`\nchecks ${checks}, fails ${fails.length}`);
if (fails.length > 0) { console.log('FAILED: ' + fails.join(' | ')); process.exit(1); }
console.log('R9B UI VERIFIED');
