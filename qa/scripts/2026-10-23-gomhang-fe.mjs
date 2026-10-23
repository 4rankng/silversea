// Gộp hàng FE on-demand (spec 23/10, cards 231026123901/902/903) — rung-3 QA
// driver. BEFORE = the pre-change build served by the main checkout
// (FRONT 7175); AFTER = this worktree's build (QA_FRONT, e.g. :7183).
// Ports are env-only per dev-port-contract.
//
// Coverage (testplan/2026-10-23-gomhang-fe.md):
//   GH-FE-01 toggle [📦 Gộp hàng] ẩn/hiện cột CHỌN + floating bar — ĐV Chi
//            tiết (1440 + 390 cards) và CUS Chi phí – Quyết toán (1440 + 390)
//   GH-FE-02 popup Gán xe nhóm ĐV: đúng 4 trường, KHÔNG còn BKS báo khách
//            (ảo); lưu cost_group → chip "Lẻ · Ghép (i/N)" + mode tự tắt
//   GH-FE-03 CUS per-lot + Gộp xe thu khách popup 3 trường; validation cùng
//            KH; lưu rev_group → Lô 1 100% / lô kia 0₫ + tag "Ghép thu cước
//            cùng Lô 1" + [Tách nhóm]; tách nhóm về per-lot; ĐV Hủy ghép dọn
//            nhóm cost.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const PHASE = process.env.QA_PHASE ?? 'before'; // before | after
const OUT = path.resolve('qa/2026-10-23-gomhang-fe');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `gomhang-fe_${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Fixture lots — same-customer (LONG MINH) ungrouped LCL pairs chosen from
// the shared dev DB before the run (see the snapshot below for live proof).
const LOT_A = Number(process.env.QA_LOT_A ?? 122); // K04573847543
const LOT_B = Number(process.env.QA_LOT_B ?? 173); // LCL01L2-DATED-259802
const FOREIGN_LOT = Number(process.env.QA_LOT_C ?? 124); // LOGCOM (khác KH)
const CUSTOMER_ID = Number(process.env.QA_CUSTOMER ?? 1);

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} front=${FRONT} health=${health?.status}`);
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
const dispatcherToken = await login(process.env.QA_USER ?? 'dungnv');
const cusToken = await login(process.env.QA_CUS_USER ?? 'cus');

const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const groupState = async () => sql`
  select id, cost_group_id::text, cost_group_order, rev_group_id::text, rev_group_order
  from shipments where id in (${LOT_A}, ${LOT_B}) order by id`;

const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPage(token, width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  page.on('pageerror', (err) => log(`PAGEERROR ${err.message}`));
  return page;
}

/** Click a button whose trimmed text matches (page-level helper). */
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

/** Type into an input[role=combobox] found by its accessible label. */
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
  if (blurAfter) {
    // NEVER Escape inside a modal (the Modal also listens and closes the
    // whole dialog) — blur the input instead, which folds the RAC listbox.
    await page.evaluate(() => { document.activeElement?.blur(); });
  }
  await sleep(400);
  return true;
}

/** Type into a labeled text/number input (NumberField/TextField). */
async function fillInput(page, labelMatch, value) {
  const handle = await page.evaluateHandle((re) => {
    const inputs = [...document.querySelectorAll('input:not([role="combobox"])')];
    return inputs.find((el) => {
      const label = el.getAttribute('aria-label')
        ?? (el.labels && el.labels[0] ? el.labels[0].textContent : '') ?? '';
      return new RegExp(re, 'i').test(label);
    });
  }, labelMatch);
  const el = handle.asElement();
  if (!el) { log(`fillInput: no input matches ${labelMatch}`); return false; }
  await el.click({ clickCount: 3 });
  await el.type(value, { delay: 15 });
  await sleep(250);
  return true;
}

const textVisible = (page, re) => page.evaluate(
  (r) => new RegExp(r, 'i').test(document.body.innerText || ''),
  re,
);

// ══════════════════════════════════════════════════════════════════════════
// A. ĐV — Kế hoạch Chi tiết Xe (/dispatch-detail)
// ══════════════════════════════════════════════════════════════════════════
async function openDetailBoard(page, q = '') {
  const url = `${FRONT}/dispatch-detail${q ? `?q=${encodeURIComponent(q)}` : ''}`;
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
  const clicked = await clickText(page, 'Tất cả');
  if (clicked) log('scope=Tất cả clicked');
  await sleep(1200);
  await page.waitForFunction(
    () => document.querySelector('.detailed-plan-grid tbody tr') || document.querySelector('.dpcard'),
    { timeout: 25_000 },
  );
  await sleep(600);
}

/** Retarget the quick search (debounced) and wait for the board to settle.
 *  React-controlled input: the native value setter + a bubbled `input` event
 *  (a bare el.value assignment is ignored by React's value tracker). */
async function searchBoard(page, q) {
  const set = await page.evaluate((value) => {
    const el = document.querySelector('input[aria-label="Tìm nhanh"], input[placeholder*="Bill"]');
    if (!el) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }, q);
  if (!set) { log('searchBoard: quick search input not found'); return; }
  await sleep(1500);
  await page.waitForFunction(
    () => document.querySelector('.detailed-plan-grid tbody tr') || document.querySelector('.dpcard'),
    { timeout: 20_000 },
  );
  await sleep(500);
}

const lotRef = async (id) => (await sql`select coalesce(bl_number, booking_ref) as ref from shipments where id = ${id}`)[0].ref;
const REF_A = await lotRef(LOT_A);
const REF_B = await lotRef(LOT_B);

// ── A1. 1440 default (GH-FE-01) — scoped to the LCL fixture lot ────────────
{
  const page = await newPage(dispatcherToken, 1440, 900);
  await openDetailBoard(page, REF_A);
  const m = await page.evaluate(() => ({
    checkboxCount: document.querySelectorAll('.ops-lcl-check').length,
    selectCol: !!document.querySelector('.detailed-plan-grid__col--select, .detailed-plan-grid__th--select'),
    toggle: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '📦 Gộp hàng'),
  }));
  log(`A1 1440 default ${JSON.stringify(m)}`);
  await shot(page, 'dv-detail-default-1440');
  if (PHASE === 'before') {
    check('A1(before): checkbox luôn hiện mặc định (defect spec 23/10)', m.checkboxCount > 0);
    check('A1(before): không có nút [📦 Gộp hàng]', m.toggle === false);
  } else {
    check('A1: mặc định KHÔNG checkbox, KHÔNG cột CHỌN', m.checkboxCount === 0 && m.selectCol === false, JSON.stringify(m));
    check('A1: nút [📦 Gộp hàng] trên thanh filter', m.toggle === true);
  }
  await page.close();
}

// ── A2. 390 default + toggle (GH-FE-01 mobile) ─────────────────────────────
{
  const page = await newPage(dispatcherToken, 390, 844);
  await openDetailBoard(page, REF_A);
  await shot(page, 'dv-cards-default-390');
  const before = await page.evaluate(() => document.querySelectorAll('.ops-lcl-check').length);
  const toggled = await clickText(page, '📦 Gộp hàng');
  await sleep(700);
  const after = await page.evaluate(() => ({
    ticks: document.querySelectorAll('.ops-lcl-check').length,
    dimmed: document.querySelectorAll('.ops-lcl-check:disabled').length,
    exitBtn: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Thoát gộp hàng')),
  }));
  log(`A2 390 toggle ${toggled} → ${JSON.stringify(after)} (before ticks=${before})`);
  await shot(page, 'dv-cards-merge-on-390');
  if (PHASE === 'before') {
    check('A2(before): card LCL luôn có tick mặc định (defect)', before > 0 && toggled === false);
  } else {
    check('A2: mặc định không tick; toggle bật → tick hiện trên card LCL', before === 0 && toggled && after.ticks > 0, `before=${before} after=${after.ticks}`);
    check('A2: nút đổi "✕ Thoát gộp hàng"', after.exitBtn === true);
    const exited = await clickText(page, '✕ Thoát gộp hàng');
    await sleep(600);
    const cleared = await page.evaluate(() => document.querySelectorAll('.ops-lcl-check').length);
    check('A2: thoát mode → tick tự ẩn', exited && cleared === 0, `cleared=${cleared}`);
  }
  await page.close();
}

// ── A3. 1440 toggle + chọn 2 lô + floating bar + popup 4 trường (GH-FE-01/02)
{
  const page = await newPage(dispatcherToken, 1440, 900);
  // Unscoped board first: the page-1 FCL rows prove the dim law (spec §2).
  await openDetailBoard(page);
  const toggled = await clickText(page, '📦 Gộp hàng');
  await sleep(800);
  const dimState = await page.evaluate(() => ({
    lcl: document.querySelectorAll('.ops-lcl-check:not(:disabled)').length,
    dimmed: document.querySelectorAll('.ops-lcl-check:disabled').length,
  }));
  log(`A3 unscoped merge-on ${JSON.stringify(dimState)}`);
  if (PHASE === 'after') {
    check('A3: bật mode → cột CHỌN hiện; dòng FCL dim/disable', toggled && dimState.dimmed > 0, JSON.stringify(dimState));
    await shot(page, 'dv-merge-on-fcl-dimmed-1440');
  }

  // Scope to the fixture lots (the board is paginated; q pins each lot).
  await searchBoard(page, REF_A);
  const tickLot = async (ref) => {
    const ok = await page.evaluate((bill) => {
      const tick = [...document.querySelectorAll('.ops-lcl-check')]
        .find((b) => b.getAttribute('aria-label')?.includes(bill));
      if (!tick) return false;
      tick.click();
      return true;
    }, ref);
    check(`A3: tích lô ${ref}`, ok);
    await sleep(300);
    return ok;
  };
  await tickLot(REF_A);
  await searchBoard(page, REF_B);
  await tickLot(REF_B);

  const bar = await page.evaluate(() => {
    const el = document.querySelector('.lcl-selection-bar');
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      text: el.innerText.replace(/\n/g, ' '),
      fixed: getComputedStyle(el).position,
      bottom: Math.round(window.innerHeight - rect.bottom),
    };
  });
  log(`A3 floating bar ${JSON.stringify(bar)}`);
  await shot(page, 'dv-floating-bar-1440');
  if (PHASE === 'after') {
    check('A3: floating bar hiện "Đang chọn 2 lô … Lô 1 giữ 100% cước trả ĐV"',
      bar != null && /Đang chọn 2 lô/.test(bar.text) && /Lô 1 giữ 100% cước trả ĐV/.test(bar.text), bar?.text ?? 'no bar');
    check('A3: bar là fixed dock sát đáy màn hình', bar != null && bar.fixed === 'fixed' && bar.bottom < 80,
      bar ? `pos=${bar.fixed} bottom=${bar.bottom}px` : 'no bar');
  }

  // Open the Gán xe nhóm popup.
  const opened = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gán xe nhóm');
    if (!el) return false;
    el.click();
    return true;
  });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 8000 });
  await sleep(700);
  const popup = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.innerText ?? '';
    const combos = [...(dialog?.querySelectorAll('input[role="combobox"]') ?? [])]
      .map((i) => i.getAttribute('aria-label') ?? i.labels?.[0]?.textContent ?? '');
    return {
      hasBillingGroup: /BKS báo khách/.test(text),
      hasBillingPerLot: /BKS báo khách từng lô|Lô 2 —/.test(text),
      combos,
      hasFreight: /Cước trả ĐVVC/.test(text),
    };
  });
  log(`A3 popup ${JSON.stringify(popup)}`);
  await shot(page, 'dv-popup-gan-xe-nhom-1440');

  if (PHASE === 'before') {
    check('A3(before): popup còn trường BKS báo khách (ảo)', popup.hasBillingGroup === true);
    // Cancel — the BEFORE phase leaves data untouched.
    await page.keyboard.press('Escape');
    await sleep(400);
    await clickText(page, 'Hủy', 'button');
  } else {
    check('A3: popup KHÔNG còn BKS báo khách (trường chung + cụm per-lô)',
      popup.hasBillingGroup === false && popup.hasBillingPerLot === false);
    check('A3: đủ 4 trường — Loại xe / Nhà xe / BKS thực / Cước trả ĐVVC',
      popup.combos.some((c) => /Loại xe tính cước trả ĐV/i.test(c))
        && popup.combos.some((c) => /^Nhà xe/i.test(c))
        && popup.combos.some((c) => /BKS thực/i.test(c))
        && popup.hasFreight === true, JSON.stringify(popup.combos));

    // Fill the 4 fields and save (writes the COST group).
    const pre = await groupState();
    log(`A3 db pre ${JSON.stringify(pre)}`);
    await fillCombo(page, 'Loại xe tính cước trả ĐV', '3.5', { optionMatch: 'Xe 3\\.5 tấn' });
    // Truck class ⇒ only external nhà xe offered (FB-090 rule): open the
    // carrier menu WITHOUT typing so the full list is visible, then assert.
    await page.evaluate(() => {
      const i = [...document.querySelectorAll('input[role="combobox"]')]
        .find((el) => /^nhà xe/i.test(el.getAttribute('aria-label') ?? (el.labels?.[0]?.textContent ?? '')));
      i?.click();
    });
    await sleep(500);
    const carrierOpts = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].map((o) => o.textContent ?? ''));
    log(`A3 carrier options (xe tải) ${JSON.stringify(carrierOpts.slice(0, 10))}`);
    check('A3: xe tải → KHÔNG có "Đội xe nội bộ" trong danh sách (FB-090)', !carrierOpts.some((t) => /nội bộ/i.test(t)), JSON.stringify(carrierOpts.slice(0, 5)));
    // Dismiss the option list WITHOUT Escape (the Modal would close too).
    await page.evaluate(() => { document.activeElement?.blur(); });
    await sleep(300);
    await fillCombo(page, '^Nhà xe', 'đăng quân', { optionMatch: 'ĐĂNG QUÂN' });
    await fillCombo(page, 'BKS thực', '51C-202.63', { blurAfter: true });
    await fillInput(page, 'Cước trả ĐVVC', '1850000');
    await shot(page, 'dv-popup-4-truong-filled-1440');
    const saved = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const el = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Gán nhóm xe');
      if (!el) return false;
      el.click();
      return true;
    });
    check('A3: bấm Gán nhóm xe', saved);
    await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 15_000 });
    await sleep(1800);

    const toast = await page.evaluate(() => document.body.innerText.match(/Đã gán nhóm xe cho \d+ lô[^\n]*/)?.[0] ?? null);
    log(`A3 toast "${toast}"`);
    check('A3: toast Lô 1 giữ 100% cước trả ĐV', toast != null && /100% cước trả ĐV/.test(toast), toast ?? 'no toast');

    const post = await groupState();
    log(`A3 db post ${JSON.stringify(post)}`);
    check('A3: cost_group lưu cho cả 2 lô (DB)', post.length === 2 && post.every((r) => r.cost_group_id != null));
    const modeOff = await page.evaluate(() => document.querySelectorAll('.ops-lcl-check').length === 0
      && [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '📦 Gộp hàng'));
    check('A3: hoàn tất → mode tự tắt (cột CHỌN ẩn lại)', modeOff);
    // Re-toggle to screenshot the chip on the grouped rows (board scoped to
    // REF_B after the save; REF_A joins via the search box).
    await clickText(page, '📦 Gộp hàng');
    await sleep(900);
    const chipRowB = await page.evaluate(() => {
      const t = document.body.innerText;
      return { ghep: /Lẻ · Ghép \(\d+\/\d+\)|Ghép \(\d+\/\d+\)/.test(t), dimmed: document.querySelectorAll('.ops-lcl-check:disabled').length };
    });
    await searchBoard(page, REF_A);
    const chipRowA = await page.evaluate(() => {
      const t = document.body.innerText;
      return { ghep: /Lẻ · Ghép \(\d+\/\d+\)|Ghép \(\d+\/\d+\)/.test(t), dimmed: document.querySelectorAll('.ops-lcl-check:disabled').length };
    });
    log(`A3 chip REF_B ${JSON.stringify(chipRowB)} · REF_A ${JSON.stringify(chipRowA)}`);
    await shot(page, 'dv-chip-ghep-1440');
    check('A3: chip "Lẻ · Ghép (i/N)" hiện trên row', chipRowB.ghep === true && chipRowA.ghep === true);
    check('A3: lô đã nhóm bị khóa tick (tách trước khi ghép lại)', chipRowB.dimmed >= 1 && chipRowA.dimmed >= 1, `dimmed B=${chipRowB.dimmed} A=${chipRowA.dimmed}`);
    await clickText(page, '✕ Thoát gộp hàng');
  }
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// B. CUS — Chi phí – Quyết toán (/shipments-debit)
// ══════════════════════════════════════════════════════════════════════════
async function openDebitBoard(page) {
  await page.goto(`${FRONT}/shipments-debit?customer=${CUSTOMER_ID}`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForFunction(
    () => document.querySelector('.shipment-debit-table tbody tr, .ledger-record'),
    { timeout: 25_000 },
  );
  await sleep(800);
}

const lotRefById = async (id) => (await sql`select coalesce(bl_number, booking_ref) as ref from shipments where id = ${id}`)[0].ref;

// ── B1. 1440 default + toggle + floating bar (GH-FE-01/03) ─────────────────
{
  const page = await newPage(cusToken, 1440, 900);
  await openDebitBoard(page);
  const m = await page.evaluate(() => ({
    ticks: document.querySelectorAll('.shipment-debit-row__select').length,
    toggle: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '📦 Gộp hàng'),
    headerMerge: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Ghép cước thu khách'),
  }));
  log(`B1 1440 default ${JSON.stringify(m)}`);
  await shot(page, 'cus-debit-default-1440');
  if (PHASE === 'before') {
    check('B1(before): tick luôn hiện mặc định (defect spec 23/10)', m.ticks > 0);
    check('B1(before): nút Ghép cước thu khách trên header', m.headerMerge === true);
  } else {
    check('B1: mặc định KHÔNG tick nào', m.ticks === 0, `ticks=${m.ticks}`);
    check('B1: nút [📦 Gộp hàng] trên filter strip', m.toggle === true);
    check('B1: CTA gộp không còn trên header (dời xuống floating bar)', m.headerMerge === false);
  }

  if (PHASE === 'after') {
    await clickText(page, '📦 Gộp hàng');
    await sleep(700);
    const refA = await lotRefById(LOT_A);
    const refB = await lotRefById(LOT_B);
    for (const ref of [refA, refB]) {
      const ok = await page.evaluate((bill) => {
        const tick = [...document.querySelectorAll('.shipment-debit-row__select')]
          .find((i) => i.getAttribute('aria-label')?.includes(bill));
        if (!tick) return false;
        tick.click();
        return true;
      }, ref);
      check(`B1: tích lô ${ref}`, ok);
      await sleep(300);
    }
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.lcl-selection-bar');
      if (!el) return null;
      return { text: el.innerText.replace(/\n/g, ' '), position: getComputedStyle(el).position };
    });
    log(`B1 floating bar ${JSON.stringify(bar)}`);
    await shot(page, 'cus-floating-bar-1440');
    check('B1: floating bar "Đang chọn 2 lô — Lô 1 giữ 100% tiền thu khách"',
      bar != null && /Đang chọn 2 lô/.test(bar.text) && /Lô 1 giữ 100% tiền thu khách/.test(bar.text), bar?.text ?? 'no bar');
    check('B1: bar fixed đáy màn hình', bar?.position === 'fixed');
  }
  await page.close();
}

// ── B2. 390 CUS default + toggle (GH-FE-01 mobile) ─────────────────────────
{
  const page = await newPage(cusToken, 390, 844);
  await openDebitBoard(page);
  await shot(page, 'cus-cards-default-390');
  if (PHASE === 'after') {
    const before = await page.evaluate(() => document.querySelectorAll('.ledger-record input[type="checkbox"]').length);
    await clickText(page, '📦 Gộp hàng');
    await sleep(700);
    const after = await page.evaluate(() => document.querySelectorAll('.ledger-record input[type="checkbox"]').length);
    log(`B2 390 ticks ${before} → ${after}`);
    await shot(page, 'cus-cards-merge-on-390');
    check('B2: 390 mặc định không tick; bật mode → tick hiện trên cards', before === 0 && after > 0, `${before}→${after}`);
  }
  await page.close();
}

// ── B3. Popup 3 trường + validation cùng KH + lưu + tag + tách nhóm ───────
if (PHASE === 'after') {
  const page = await newPage(cusToken, 1440, 900);
  await openDebitBoard(page);

  // B3a — mixed-customer gate: tick A + foreign lot → popup error text.
  await clickText(page, '📦 Gộp hàng');
  await sleep(700);
  const refA = await lotRefById(LOT_A);
  const refC = await lotRefById(FOREIGN_LOT);
  await page.evaluate((bill) => {
    const tick = [...document.querySelectorAll('.shipment-debit-row__select')]
      .find((i) => i.getAttribute('aria-label')?.includes(bill));
    tick?.click();
  }, refA);
  // The foreign lot belongs to another customer — switch the filter off to see it.
  await clickText(page, '✕ Thoát gộp hàng');
  await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.shipment-debit-table tbody tr'), { timeout: 25_000 });
  await clickText(page, '📦 Gộp hàng');
  await sleep(700);
  for (const ref of [refA, refC]) {
    await page.evaluate((bill) => {
      const tick = [...document.querySelectorAll('.shipment-debit-row__select')]
        .find((i) => i.getAttribute('aria-label')?.includes(bill));
      tick?.click();
    }, ref);
    await sleep(250);
  }
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gộp xe thu khách');
    el?.click();
  });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 8000 });
  await sleep(600);
  const mixedErr = await page.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? '');
  log(`B3a mixed dialog "${mixedErr.replace(/\n/g, ' ').slice(0, 220)}"`);
  await shot(page, 'cus-popup-khac-kh-1440');
  check('B3a: khác KH → chặn rõ "cùng một khách hàng"', /cùng một khách hàng/.test(mixedErr));
  await page.keyboard.press('Escape');
  await sleep(500);
  await clickText(page, 'Hủy', 'button');
  await sleep(400);
  await clickText(page, '✕ Thoát gộp hàng');

  // B3b — the real merge on the same-customer pair.
  await page.goto(`${FRONT}/shipments-debit?customer=${CUSTOMER_ID}`, { waitUntil: 'networkidle2' });
  await page.waitForFunction(() => document.querySelector('.shipment-debit-table tbody tr'), { timeout: 25_000 });
  await clickText(page, '📦 Gộp hàng');
  await sleep(700);
  const refB = await lotRefById(LOT_B);
  for (const ref of [refA, refB]) {
    await page.evaluate((bill) => {
      const tick = [...document.querySelectorAll('.shipment-debit-row__select')]
        .find((i) => i.getAttribute('aria-label')?.includes(bill));
      tick?.click();
    }, ref);
    await sleep(250);
  }
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gộp xe thu khách');
    el?.click();
  });
  await page.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 8000 });
  await sleep(600);
  const popup = await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.innerText ?? '';
    const combos = [...(dialog?.querySelectorAll('input[role="combobox"]') ?? [])]
      .map((i) => i.getAttribute('aria-label') ?? i.labels?.[0]?.textContent ?? '');
    return {
      title: /Gộp xe thu khách/.test(text),
      law: /Lô 1 giữ 100% cước thu khách, các lô còn lại 0₫/.test(text),
      combos,
      hasPrice: /Cước thu khách Lô 1/.test(text),
    };
  });
  log(`B3b popup ${JSON.stringify(popup)}`);
  await shot(page, 'cus-popup-gop-xe-thu-khach-1440');
  check('B3b: popup "Gộp xe thu khách" + luật Lô 1 100% / còn lại 0₫', popup.title && popup.law);
  check('B3b: 3 trường — Loại xe thu nhóm / BKS báo khách chung / Cước thu Lô 1',
    popup.combos.some((c) => /Loại xe tính cước thu khách/i.test(c))
      && popup.combos.some((c) => /BKS báo khách/i.test(c))
      && popup.hasPrice === true, JSON.stringify(popup.combos));

  const preRev = await groupState();
  log(`B3b db pre ${JSON.stringify(preRev)}`);
  await fillCombo(page, 'Loại xe tính cước thu khách', '3.5', { optionMatch: 'Xe 3\\.5 tấn' });
  await fillCombo(page, 'BKS báo khách', '51C-999.99', { blurAfter: true });
  await fillInput(page, 'Cước thu khách Lô 1', '2750000');
  await shot(page, 'cus-popup-3-truong-filled-1440');
  // Submit INSIDE the dialog — the floating bar's CTA shares the exact text
  // and sits earlier in the DOM behind the modal.
  await page.evaluate(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const el = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Gộp xe thu khách');
    el?.click();
  });
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'), { timeout: 15_000 });
  await sleep(2000);

  const toast = await page.evaluate(() => document.body.innerText.match(/Đã gộp xe thu khách cho \d+ lô[^\n]*/)?.[0] ?? null);
  log(`B3b toast "${toast}"`);
  check('B3b: toast Lô 1 giữ 100% cước thu khách', toast != null && /100% cước thu khách/.test(toast), toast ?? 'no toast');

  const postRev = await groupState();
  log(`B3b db post ${JSON.stringify(postRev)}`);
  check('B3b: rev_group lưu cho cả 2 lô, độc lập cost_group (DB)',
    postRev.length === 2 && postRev.every((r) => r.rev_group_id != null));

  const modeOff = await page.evaluate(() => document.querySelectorAll('.shipment-debit-row__select').length === 0
    && [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '📦 Gộp hàng'));
  check('B3b: hoàn tất → mode tự tắt', modeOff);

  // B3c — the member tag + [Tách nhóm] on the merged row.
  await clickText(page, '📦 Gộp hàng');
  await sleep(800);
  const tagState = await page.evaluate((billL1, billL2) => {
    const rows = [...document.querySelectorAll('.shipment-debit-row')];
    const rowOf = (bill) => rows.find((r) => r.innerText.includes(bill));
    const l1 = rowOf(billL1);
    const l2 = rowOf(billL2);
    return {
      l2Tag: /Ghép thu cước cùng Lô 1|Ghép cước cùng Bill/.test(l2?.innerText ?? ''),
      l2HasTach: [...(l2?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.trim() === 'Tách nhóm'),
      l1HasTach: [...(l1?.querySelectorAll('button') ?? [])].some((b) => b.textContent?.trim() === 'Tách nhóm'),
      l2Zero: l2?.innerText.includes('0') ?? false,
    };
  }, refA, refB);
  log(`B3c tag state ${JSON.stringify(tagState)}`);
  await shot(page, 'cus-tag-ghep-thu-1440');
  check('B3c: lô thành viên có tag ghép thu ("Ghép cước cùng Bill Lô 1" — BE dừng ở dạng Bill của cùng luật)', tagState.l2Tag === true, JSON.stringify(tagState));
  check('B3c: [Tách nhóm] hiện trên dòng đã gộp', tagState.l2HasTach === true || tagState.l1HasTach === true, JSON.stringify(tagState));

  // B3d — Tách nhóm → per-lot again; group dissolved.
  const unmerged = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tách nhóm');
    if (!btn) return false;
    btn.click();
    return true;
  });
  check('B3d: bấm Tách nhóm', unmerged);
  await page.waitForFunction(() => document.querySelector('[role="dialog"]'), { timeout: 8000 });
  await sleep(400);
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Tách nhóm');
    (confirm.at(-1) ?? confirm[0])?.click();
  });
  await sleep(2200);
  const afterUnmerge = await groupState();
  log(`B3d db ${JSON.stringify(afterUnmerge)}`);
  await shot(page, 'cus-sau-tach-nhom-1440');
  check('B3d: tách nhóm → rev_group giải tán (DB)', afterUnmerge.every((r) => r.rev_group_id == null));
  await clickText(page, '✕ Thoát gộp hàng');
  await page.close();
}

// ══════════════════════════════════════════════════════════════════════════
// C. Cleanup — dissolve the ĐV cost group through the group chip (A3 wrote
//    it in the AFTER phase), leaving the shared lots ungrouped again.
// ══════════════════════════════════════════════════════════════════════════
if (PHASE === 'after') {
  const page = await newPage(dispatcherToken, 1440, 900);
  await openDetailBoard(page);
  const pre = await groupState();
  const hasGroup = pre.every((r) => r.cost_group_id != null);
  if (hasGroup) {
    await clickText(page, '📦 Gộp hàng');
    await sleep(800);
    // Scope to the grouped lot (the board is paginated; q pins the row).
    await searchBoard(page, REF_B);
    // The chip opens the group modal (Xem nhóm / Hủy ghép).
    const opened = await page.evaluate(() => {
      const chip = [...document.querySelectorAll('.detailed-plan-grid__lcl-group-tag--action, .dpcard__group')]
        .find((el) => /Ghép \(\d+\/\d+\)/.test(el.textContent ?? ''));
      if (!chip) return false;
      chip.click();
      return true;
    });
    check('C: mở menu nhóm qua chip "Lẻ · Ghép (1/2)"', opened);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Hủy ghép'), { timeout: 8000 });
    await sleep(400);
    await clickText(page, 'Hủy ghép');
    await sleep(500);
    await page.evaluate(() => {
      const confirm = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Hủy ghép');
      (confirm.at(-1) ?? confirm[0])?.click();
    });
    await sleep(2500);
    const post = await groupState();
    log(`C db ${JSON.stringify(post)}`);
    await shot(page, 'dv-sau-huy-ghep-1440');
    check('C: Hủy ghép → cost_group giải tán (DB, dữ liệu trả về như trước run)', post.every((r) => r.cost_group_id == null));
  } else {
    log('C: no cost group to dissolve (skipped)');
  }
  await page.close();
}

const finalState = await groupState();
log(`FINAL db ${JSON.stringify(finalState)}`);
await browser.close();
await sql.end();
log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
