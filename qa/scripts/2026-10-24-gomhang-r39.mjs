// QA R39 residuals (cards 231026162327 / 231026163927×3) — rung-3 driver.
//
// BEFORE = the UNMODIFIED main checkout (FE :7176 → BE :3013, b52eb9a3);
// AFTER  = this worktree's fix branch           (FE :7185 → BE :3012).
// Same local dev DB (:5441). Ports are env-only per dev-port-contract.
//
// Coverage (testplan/cases/case-QA-2026-10-23-fb1*.md):
//   FB-138  /dispatch Gán xe nhóm — dropdown Loại xe: prod-mirror catalog
//           (xe tải classes wiped) ⇒ BEFORE only 4 Cont options; AFTER the
//           migration converges the catalog and the menu renders grouped
//           "XE TẢI (TẤN)" | "CONTAINER" + the sourcing reset (đổi sang xe
//           tải bỏ chọn Đội xe nội bộ LOUDLY).
//   FB-127  /shipments/new — Số Bill/Booking TRƯỚC Hình thức XNK (2 cụm
//           divider AFTER).
//   FB-141  Quyết toán PHÂN XE — BKS báo khách đã lưu rồi xóa trắng ⇒ BEFORE
//           400 "BKS không được để trống"; AFTER null-clear OK + DB NULL.
//   FB-145  Quyết toán — Tách nhóm: BEFORE member giữ 0₫ + loại xe nhóm sót;
//           AFTER "Chưa xác định" + loại xe gỡ + toast [Hoàn tác] sống.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const PHASE = process.env.QA_PHASE ?? 'before';
const FRONT = process.env.QA_FRONT ?? (PHASE === 'after' ? 'http://localhost:7185' : 'http://localhost:7176');
const API = process.env.QA_API ?? (PHASE === 'after' ? 'http://localhost:3012/api' : 'http://localhost:3013/api');
const OUT = path.resolve('qa/2026-10-24-gomhang-r39');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `gomhang-r39_${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Fixtures (see the snapshot in the driver log for live proof). All on the
// master plan's page 1 (LCL rows the probe verified visible).
const FB145_LOT_A = 150; // TVREQ-LCL-B201 (customer 1, Lô 1 khi merge)
const FB145_LOT_B = 147; // KK95249354     (customer 1, member)
const FB141_LOT = 122;   // K04573847543  (actual 51C-202.63, billing 51C-999.99)
const FB138_LOT_A_BILL = 'kK6356464';
const FB138_LOT_B_BILL = 'K547238574983';
const CONT20_LIGHT_ID = 1;
const idem = () => crypto.randomUUID();

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} front=${FRONT} api=${API} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`ABORT: login ${identifier} failed (${res.status})`); process.exit(2); }
  const { token } = await res.json();
  return token;
};
const dispatcherToken = await login('dungnv');
const cusToken = await login('tiepvv');

const sql = postgres(process.env.QA_DB ?? 'postgres://postgres:postgres@127.0.0.1:5441/silversea');

// ─── FB-138 DB state: the prod-mirror catalog (no truck classes) ────────────
// BEFORE wipes them (exactly what QA saw on staging: only the 4 CONT price
// classes of migration 20260922231200 exist); AFTER re-runs THIS branch's
// migration body (20261024090000) to converge the catalog.
await sql`delete from vehicle_size_classes where is_container = false`;
if (PHASE === 'after') {
  await sql`
    insert into vehicle_size_classes (code, name, is_container, sort_order) values
      ('1.25T', 'Xe 1.25 tấn', false, 1),
      ('2.5T', 'Xe 2.5 tấn', false, 2),
      ('3.5T', 'Xe 3.5 tấn', false, 3),
      ('5T', 'Xe 5 tấn', false, 4),
      ('8T', 'Xe 8 tấn', false, 5),
      ('10T', 'Xe 10 tấn', false, 6),
      ('15T', 'Xe 15 tấn', false, 7)
    on conflict (code) do nothing`;
}
const catalogClasses = await sql`select code, name, is_container from vehicle_size_classes order by sort_order`;
log(`catalog classes (${catalogClasses.length}): ${catalogClasses.map((c) => c.code).join(', ')}`);
if (PHASE === 'before') check('FB-138 repro state: catalog chỉ còn cont (prod-mirror)', catalogClasses.every((c) => c.is_container));
else check('FB-138 migration converged: đủ 7 lớp xe tải + 4 cont', catalogClasses.filter((c) => !c.is_container).length === 7);

const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(token, width = 1440, height = 900) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  page.on('pageerror', (err) => log(`PAGEERROR ${err.message}`));
  return page;
}

const clickText = (page, text, scope = 'button') => page.evaluate(
  (t, sel) => {
    const el = [...document.querySelectorAll(sel)].find((b) => b.textContent?.trim() === t);
    if (!el) return false;
    el.click();
    return true;
  },
  text,
  scope,
);

async function fillCombo(page, labelMatch, typed, { optionMatch, blurAfter } = {}) {
  const handle = await page.evaluateHandle((re) => {
    const inputs = [...document.querySelectorAll('input[role="combobox"]')];
    return inputs.find((el) => {
      const label = el.getAttribute('aria-label')
        ?? (el.labels && el.labels[0] ? el.labels[0].textContent : '')
        ?? el.closest('[aria-label]')?.getAttribute('aria-label') ?? '';
      return new RegExp(re, 'i').test(label);
    });
  }, labelMatch);
  const el = handle.asElement();
  if (!el) { log(`fillCombo: no combobox matches ${labelMatch}`); return false; }
  await el.click({ clickCount: 3 });
  await el.type(typed, { delay: 20 });
  if (optionMatch) {
    try {
      await page.waitForFunction(
        (re) => [...document.querySelectorAll('[role="option"]')].some((o) => new RegExp(re, 'i').test(o.textContent ?? '')),
        { timeout: 6000 }, optionMatch,
      );
      const picked = await page.evaluate((re) => {
        const o = [...document.querySelectorAll('[role="option"]')].find((x) => new RegExp(re, 'i').test(x.textContent ?? ''));
        if (!o) return false;
        o.click();
        return true;
      }, optionMatch);
      if (!picked) return false;
    } catch {
      log(`fillCombo: option "${optionMatch}" never appeared for ${labelMatch}`);
      return false;
    }
  }
  if (blurAfter) await page.evaluate(() => { document.activeElement?.blur(); });
  await sleep(400);
  return true;
}

const bodyText = (page) => page.evaluate(() => document.body.innerText || '');

/** Clear a combobox input FOR REAL: the React-native value setter + a
 *  bubbled input event (a bare el.value assignment is ignored by React's
 *  value tracker — same trap as the board quick-search). */
async function clearCombo(page, labelMatch) {
  const done = await page.evaluate((re) => {
    const inputs = [...document.querySelectorAll('input[role="combobox"]')];
    const el = inputs.find((node) => {
      const label = node.getAttribute('aria-label')
        ?? (node.labels && node.labels[0] ? node.labels[0].textContent : '')
        ?? node.closest('[aria-label]')?.getAttribute('aria-label') ?? '';
      return new RegExp(re, 'i').test(label);
    });
    if (!el) return null;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, labelMatch);
  if (done !== true) { log(`clearCombo: no combobox matches ${labelMatch}`); return false; }
  await page.evaluate(() => { document.activeElement?.blur(); });
  await sleep(500);
  const value = await page.evaluate((re) => {
    const inputs = [...document.querySelectorAll('input[role="combobox"]')];
    const el = inputs.find((node) => {
      const label = node.getAttribute('aria-label')
        ?? (node.labels && node.labels[0] ? node.labels[0].textContent : '')
        ?? node.closest('[aria-label]')?.getAttribute('aria-label') ?? '';
      return new RegExp(re, 'i').test(label);
    });
    return el?.value ?? null;
  }, labelMatch);
  log(`clearCombo ${labelMatch}: value="${value}"`);
  return value === '';
}

// ══════════════════════════════════════════════════════════════════════════
// FB-138 — /dispatch Gán xe nhóm: dropdown Loại xe (xe tải rule)
// ══════════════════════════════════════════════════════════════════════════
async function fb138() {
  const page = await newPage(dispatcherToken);
  await page.goto(`${FRONT}/dispatch`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await sleep(1500);
  const toggled = await clickText(page, '📦 Gộp hàng');
  check('FB-138: [📦 Gộp hàng] toggle', toggled);
  await sleep(700);
  const tickOne = (bill) => page.evaluate((b) => {
    const cb = document.querySelector(`button[role="checkbox"][aria-label="Chọn lô ${b}"]`);
    if (!cb) return false;
    cb.click();
    return true;
  }, bill);
  const tickA = await tickOne(FB138_LOT_A_BILL);
  await sleep(500);
  const tickB = await tickOne(FB138_LOT_B_BILL);
  await sleep(700);
  check('FB-138: tích 2 lô LCL', tickA && tickB, `A=${tickA} B=${tickB}`);
  // The floating bar must read BOTH lots before the assign button arms
  // (two synchronous clicks batch into one render and lose the first).
  const barRead = await page.evaluate(() => document.body.innerText.match(/Đang chọn (\d+) lô/)?.[1] ?? null);
  check('FB-138: floating bar thấy 2 lô', barRead === '2', `bar=${barRead}`);
  await sleep(500);
  const opened = await clickText(page, 'Gán xe nhóm');
  check('FB-138: mở popup Gán xe nhóm', opened);
  await sleep(700);
  await shot(page, 'fb138_popup');

  // Open the Loại xe dropdown and harvest the whole listbox (searchable RAC
  // combobox: a TRUSTED puppeteer click opens the popover — a synthetic
  // DOM click lacks the pointer sequence RAC listens to).
  const comboHandle = await page.evaluateHandle(() => {
    const inputs = [...document.querySelectorAll('input[role="combobox"]')];
    return inputs.find((i) => /Loại xe tính cước trả ĐV/i.test(
      i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? ''),
    ));
  });
  const comboEl = comboHandle.asElement();
  check('FB-138: tìm combobox Loại xe', comboEl != null);
  if (comboEl) {
    await comboEl.click();
    try {
      await page.waitForFunction(
        () => document.querySelectorAll('[role="option"], [role="listbox"]').length > 0,
        { timeout: 6000 },
      );
    } catch {
      log('FB-138: dropdown never opened (no option/listbox in DOM)');
    }
    await sleep(700);
  }
  const listbox = await page.evaluate(() => {
    const lb = document.querySelector('[role="listbox"]');
    const options = [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? '');
    return { listboxText: lb?.textContent ?? '', options };
  });
  log(`FB-138 dropdown options (${listbox.options.length}): ${JSON.stringify(listbox.options)}`);
  log(`FB-138 listbox text: ${JSON.stringify(listbox.listboxText)}`);
  await shot(page, 'fb138_dropdown');
  if (PHASE === 'before') {
    // Truck class names all start "Xe <tấn> tấn" — the CONT labels themselves
    // carry "tấn" ("Trọng tải < 20 tấn"), so match the truck naming instead.
    check('FB-138 BEFORE: KHÔNG có option xe tải (repro QA)', listbox.options.every((t) => !/^Xe [\d.]+ tấn/i.test(t) && !/XE TẢI/i.test(t)), `${listbox.options.length} options`);
    check('FB-138 BEFORE: chỉ 4 options Cont', listbox.options.length === 4);
  } else {
    check('FB-138 AFTER: section header "XE TẢI (TẤN)"', listbox.listboxText.includes('XE TẢI (TẤN)'));
    check('FB-138 AFTER: section header "CONTAINER"', listbox.listboxText.includes('CONTAINER'));
    check('FB-138 AFTER: đủ options xe tải', listbox.options.filter((t) => /tấn/.test(t)).length >= 5, `${listbox.options.filter((t) => /tấn/.test(t)).length} tải`);
    // Ràng buộc: chọn xe tải ⇒ nhà xe chỉ ngoài. Trước đó giữ Đội xe nội bộ
    // bằng lớp Cont, rồi đổi sang xe tải — pick bị reset + warning.
    // (Direct option CLICKS, not type-to-filter: React 19.2.6 dev builds'
    // render-diff diagnostics throw "childNodes is not supported" when the
    // SECTIONED listbox refilters on typed text — a dev-only React × RAC
    // issue, production builds don't run logComponentRender. Click-pick is
    // the verified path; noted in the driver log + testplan case.)
    const openAndPick = async (labelRe, optionRe) => {
      const handle = await page.evaluateHandle((re) => {
        const inputs = [...document.querySelectorAll('input[role="combobox"]')];
        return inputs.find((i) => new RegExp(re, 'i').test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? '')));
      }, labelRe);
      const input = handle.asElement();
      if (!input) { log(`openAndPick: no combobox for ${labelRe}`); return false; }
      await input.click();
      try {
        await page.waitForFunction(
          (re) => [...document.querySelectorAll('[role="option"]')].some((o) => new RegExp(re, 'i').test(o.textContent ?? '')),
          { timeout: 6000 }, optionRe,
        );
      } catch {
        log(`openAndPick: option ${optionRe} never appeared`);
        return false;
      }
      return page.evaluate((re) => {
        const o = [...document.querySelectorAll('[role="option"]')].find((x) => new RegExp(re, 'i').test(x.textContent ?? ''));
        if (!o) return false;
        o.click();
        return true;
      }, optionRe);
    };
    const pickedCont = await openAndPick('Loại xe tính cước trả ĐV', 'Cont 20 - Trọng tải < 20 tấn');
    await sleep(600);
    const pickedOwn = await openAndPick('^Nhà xe', 'Đội xe nội bộ SilverSea');
    await sleep(600);
    const carrierHeld = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[role="combobox"]')];
      const el = inputs.find((i) => /^Nhà xe/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? '')));
      return el?.value ?? null;
    });
    check('FB-138 AFTER: giữ được Đội xe nội bộ trên lớp Cont', pickedCont && pickedOwn && /Đội xe nội bộ/.test(carrierHeld ?? ''), `pickedCont=${pickedCont} pickedOwn=${pickedOwn} held="${carrierHeld}"`);
    const flipped = await openAndPick('Loại xe tính cước trả ĐV', 'Xe 5 tấn');
    check('FB-138 AFTER: đổi loại xe sang Xe 5 tấn', flipped);
    await sleep(900);
    const afterFlip = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[role="combobox"]')];
      const carrier = inputs.find((i) => /^Nhà xe/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? '')));
      return {
        carrierValue: carrier?.value ?? null,
        warning: /đã bỏ lựa chọn Đội xe nội bộ/.test(document.body.innerText ?? ''),
      };
    });
    check('FB-138 AFTER: đổi sang xe tải reset chọn Đội xe nội bộ (không giữ ID mồ côi)', afterFlip.carrierValue === '', JSON.stringify(afterFlip));
    check('FB-138 AFTER: warning nhẹ dưới field', afterFlip.warning);
    await shot(page, 'fb138_carrier_reset');
    // Nhà xe list on a truck class: internal fleet never offered.
    await openAndPick('^Nhà xe', 'Nhà xe');
    await sleep(400);
    const carrierList = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent?.trim() ?? ''));
    log(`FB-138 nhà xe options (lớp xe tải): ${JSON.stringify(carrierList)}`);
    check('FB-138 AFTER: danh sách Nhà xe KHÔNG có Đội xe nội bộ (xe tải)', carrierList.every((t) => !/nội bộ/i.test(t)));
    await shot(page, 'fb138_carrier_external_only');
  }
  // Close the popup WITHOUT assigning (no cost group is created).
  await clickText(page, 'Hủy');
  await sleep(400);
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// FB-127 — /shipments/new: Số Bill/Booking TRƯỚC Hình thức XNK
// ══════════════════════════════════════════════════════════════════════════
async function fb127() {
  const page = await newPage(cusToken);
  await page.goto(`${FRONT}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => document.querySelector('[data-field-id="shipment-booking-ref"]'), { timeout: 25_000 });
  await sleep(600);
  await shot(page, 'fb127_identity');
  const order = await page.evaluate(() => {
    const booking = document.querySelector('[data-field-id="shipment-booking-ref"]');
    const direction = document.querySelector('[data-field-id="shipment-trade-direction"]');
    if (!booking || !direction) return { missing: true };
    const bookingFirst = !!(booking.compareDocumentPosition(direction) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      missing: false,
      bookingFirst,
      clusters: [...document.querySelectorAll('.csc-identity-cluster__heading')].map((h) => h.textContent?.trim()),
      hint: /Chọn Hình thức xuất nhập khẩu trước/.test(document.body.innerText ?? ''),
    };
  });
  log(`FB-127: ${JSON.stringify(order)}`);
  if (PHASE === 'before') {
    check('FB-127 BEFORE: Số Bill/Booking đang SAU Hình thức XNK (repro QA)', order.missing || order.bookingFirst === false);
  } else {
    check('FB-127 AFTER: Số Bill/Booking đứng TRƯỚC Hình thức XNK', order.bookingFirst === true);
    check('FB-127 AFTER: 2 cụm có heading', order.clusters?.length === 2, JSON.stringify(order.clusters));
    check('FB-127 AFTER: gate giữ nguyên — hint "Chọn Hình thức xuất nhập khẩu trước"', order.hint === true);
  }
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// FB-141 — Quyết toán PHÂN XE: clear BKS báo khách
// ══════════════════════════════════════════════════════════════════════════
async function fb141() {
  // Start from a known state: a stored ảo distinct from the actual plate.
  await sql`update shipments set billing_truck_no = '51C-999.99' where id = ${FB141_LOT}`;
  const page = await newPage(cusToken);
  await page.goto(`${FRONT}/shipments-debit?customer=1`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction((bill) => document.body.innerText.includes(bill), { timeout: 25_000 }, 'K04573847543');
  await sleep(800);
  const expand = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Mở chi tiết lô K04573847543"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('FB-141: mở rộng dòng K04573847543', expand);
  await page.waitForFunction(() => document.body.innerText.includes('PHÂN XE'), { timeout: 15_000 });
  await sleep(500);
  await shot(page, 'fb141_strip');

  // Clear the ảo field and save.
  const cleared = await clearCombo(page, 'BKS báo khách');
  check('FB-141: xóa trắng ô BKS báo khách', cleared);
  await shot(page, 'fb141_cleared');
  const saved = await clickText(page, 'Lưu BKS');
  check('FB-141: bấm Lưu BKS', saved);
  await sleep(1600);
  const text = await bodyText(page);
  if (PHASE === 'before') {
    check('FB-141 BEFORE: lỗi "BKS không được để trống" (repro QA)', /BKS không được để trống/.test(text));
  } else {
    check('FB-141 AFTER: KHÔNG còn lỗi để trống', !/BKS không được để trống/.test(text));
    check('FB-141 AFTER: toast thành công', /Đã cập nhật BKS/.test(text));
  }
  await shot(page, 'fb141_after_save');
  await page.close();
  // DB side effect: AFTER must hold NULL (fallback BKS thực), BEFORE keeps
  // the old value (the clear was refused).
  const [row] = await sql`select billing_truck_no from shipments where id = ${FB141_LOT}`;
  log(`FB-141 DB billing_truck_no=${row?.billing_truck_no}`);
  if (PHASE === 'before') check('FB-141 BEFORE DB: giá trị cũ giữ nguyên', row?.billing_truck_no === '51C-999.99');
  else check('FB-141 AFTER DB: billing_truck_no = NULL (fallback BKS thực)', row?.billing_truck_no == null);
}

// ══════════════════════════════════════════════════════════════════════════
// FB-145 — Tách nhóm: cước thành viên revert + loại xe gỡ + [Hoàn tác]
// ══════════════════════════════════════════════════════════════════════════
async function fb145() {
  // Fresh rev group via the API (same law the popup writes).
  const mergeRes = await fetch(`${API}/shipments/lcl/rev-group`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cusToken}`, 'Idempotency-Key': idem() },
    body: JSON.stringify({ shipmentIds: [FB145_LOT_A, FB145_LOT_B], vehicleSizeClassId: CONT20_LIGHT_ID }),
  });
  const mergeBody = await mergeRes.json().catch(() => null);
  check('FB-145: dựng nhóm gộp qua API', mergeRes.ok, `status=${mergeRes.status} ${JSON.stringify(mergeBody)?.slice(0, 120)}`);
  const [groupRow] = await sql`select id, rev_group_id::text as gid, rev_group_order, rev_vehicle_class_id from shipments where id in (${FB145_LOT_A}, ${FB145_LOT_B}) order by rev_group_order`;
  log(`FB-145 group state: ${JSON.stringify(groupRow)}`);

  const page = await newPage(cusToken);
  await page.goto(`${FRONT}/shipments-debit?customer=1`, { waitUntil: 'networkidle2', timeout: 60_000 });
  await page.waitForFunction(() => document.body.innerText.includes('KK95249354'), { timeout: 25_000 });
  await sleep(900);
  await shot(page, 'fb145_merged_board');

  const tach = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Tách nhóm ghép cước thu khách — lô KK95249354"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('FB-145: bấm [Tách nhóm] trên dòng thành viên', tach);
  await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].length > 0, { timeout: 10_000 });
  await shot(page, 'fb145_confirm');
  const confirmed = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('[role="dialog"] button')];
    const b = btns.at(-1);
    if (!b || b.textContent?.trim() !== 'Tách nhóm') return false;
    b.click();
    return true;
  });
  check('FB-145: xác nhận dialog', confirmed);
  await sleep(2000);
  const toastText = await bodyText(page);
  if (PHASE === 'before') {
    check('FB-145 BEFORE: toast cũ (không [Hoàn tác])', !/Hoàn tác/.test(toastText), toastText.match(/Đã tách nhóm[^\n]*/)?.[0] ?? '');
  } else {
    check('FB-145 AFTER: toast "Đã tách nhóm cước thành công"', /Đã tách nhóm cước thành công/.test(toastText));
    const undoAlive = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Hoàn tác');
      return Boolean(btn);
    });
    check('FB-145 AFTER: nút [Hoàn tác] sống trong toast', undoAlive);
  }
  await shot(page, 'fb145_after_tach_toast');

  // Reload → the persisted state (the QA repro: reload then read the cells).
  await page.reload({ waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.body.innerText.includes('KK95249354'), { timeout: 25_000 });
  await sleep(900);
  const memberCell = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('tr.shipment-debit-row')];
    const row = cells.find((r) => r.textContent?.includes('KK95249354'));
    if (!row) return null;
    const money = row.querySelector('.shipment-debit-row__freight');
    return { freight: money?.textContent ?? '' };
  });
  log(`FB-145 member freight cell (reload): ${JSON.stringify(memberCell)}`);
  await shot(page, 'fb145_member_after_reload');
  if (PHASE === 'before') {
    check('FB-145 BEFORE: member còn 0₫ stale (repro QA)', memberCell?.freight?.includes('0') === true, memberCell?.freight ?? '');
  } else {
    check('FB-145 AFTER: member = "Chưa xác định" (không còn 0₫ stale)', memberCell?.freight?.includes('Chưa xác định') === true, memberCell?.freight ?? '');
  }

  // Loại xe nhóm phải gỡ khỏi combobox của member (expand the row).
  const expand = await page.evaluate(() => {
    const btn = document.querySelector('button[aria-label="Mở chi tiết lô KK95249354"]');
    if (!btn) return false;
    btn.click();
    return true;
  });
  if (expand) {
    await page.waitForFunction(() => document.body.innerText.includes('CƯỚC THU KHÁCH'), { timeout: 15_000 });
    await sleep(600);
    const classValue = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input[role="combobox"]')];
      const el = inputs.find((i) => /Loại xe tính cước thu khách/i.test(i.getAttribute('aria-label') ?? (i.labels?.[0]?.textContent ?? '')));
      return el?.value ?? null;
    });
    log(`FB-145 member loại xe combobox = "${classValue}"`);
    await shot(page, 'fb145_member_class_combobox');
    if (PHASE === 'before') {
      check('FB-145 BEFORE: combobox còn loại xe nhóm (repro QA)', classValue != null && /Cont 20/.test(classValue), classValue ?? '');
    } else {
      check('FB-145 AFTER: combobox TRỐNG (loại xe nhóm đã gỡ)', classValue === '', classValue ?? '');
    }
  } else {
    check('FB-145: mở rộng dòng member', false);
  }
  await page.close();

  // DB side effects.
  const [state] = await sql`
    select id, rev_group_id::text as gid, rev_vehicle_class_id
    from shipments where id = ${FB145_LOT_B}`;
  log(`FB-145 DB member state: ${JSON.stringify(state)}`);
  check('FB-145 DB: nhóm đã giải tán (rev_group_id NULL)', state?.gid == null);
  if (PHASE === 'after') check('FB-145 DB AFTER: rev_vehicle_class_id = NULL (loại xe nhóm gỡ)', state?.rev_vehicle_class_id == null);
}

await fb138();
await fb127();
await fb141();
await fb145();

// Restore the dev catalog (the wipe was the BEFORE repro only).
if (PHASE === 'before') {
  await sql`
    insert into vehicle_size_classes (code, name, is_container, sort_order) values
      ('1.25T', 'Xe 1.25 tấn', false, 1),
      ('2.5T', 'Xe 2.5 tấn', false, 2),
      ('3.5T', 'Xe 3.5 tấn', false, 3),
      ('5T', 'Xe 5 tấn', false, 4),
      ('8T', 'Xe 8 tấn', false, 5),
      ('10T', 'Xe 10 tấn', false, 6),
      ('15T', 'Xe 15 tấn', false, 7)
    on conflict (code) do nothing`;
  log('catalog restored after BEFORE phase');
}

await browser.close();
await sql.end();
log(`SUMMARY ${PHASE}: failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
