// Redesign Kế hoạch Tổng quát /dispatch (QA R38 "mess vẫn live", 23/10 12:39) —
// rung-2/3 QA driver. BEFORE = the pre-change build served by the main
// checkout (FRONT 7175, branch main 60d0c576 — gomhang đã merge); AFTER =
// this worktree's build (QA_FRONT, e.g. :7184). Ports are env-only per
// dev-port-contract.
//
// Coverage (testplan/2026-10-23-master-plan-redesign.md):
//   MP-RD-01 desktop cột cân đối + rail + header 2 dòng (1440/768)
//   MP-RD-02 rows ≤ 93px theo nội dung (768/1440 table; 390 cards đo kèm)
//   MP-RD-03 sticky header (rung 3 — after)
//   MP-RD-04 mobile <640 card list (390) + FB-014 card tap (rung 3)
//   MP-RD-05 gộp hàng on-demand GIỮ NGUYÊN (cả 2 phase — gomhang có sẵn
//            trên main): CHỌN on-demand, tick 2 lô LCL, floating bar,
//            dialog 4 trường (KHÔNG lưu — presentation-only, DB identity)
//   MP-RD-06 bộ lọc "Phân xe" sweep (Tất cả/Chờ/Đã phân xong)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const PHASE = process.env.QA_PHASE ?? 'before'; // before | after
const OUT = path.resolve('qa/2026-10-23-master-plan-redesign');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `master-plan-redesign_${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Fixture lots — the gomhang lane's ungrouped LONG MINH LCL pair (QA
// cleanup left FINAL groups null). READ-ONLY here: the merge dialog is
// opened and cancelled, never saved.
const LOT_A = Number(process.env.QA_LOT_A ?? 122); // K04573847543
const LOT_B = Number(process.env.QA_LOT_B ?? 173); // LCL01L2-DATED-259802
const LOT_A_REF = process.env.QA_LOT_A_REF ?? 'K04573847543';
const LOT_B_REF = process.env.QA_LOT_B_REF ?? 'LCL01L2-DATED-259802';
// The measured date: 12 READY_FOR_DISPATCH FCL lots (TBFL…) — real local data.
const MEASURE_DATE_INPUT = '01/11/2026';

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

const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const groupState = async () => sql`
  select id, cost_group_id::text, cost_group_order from shipments where id in (${LOT_A}, ${LOT_B}) order by id`;

const dbBefore = await groupState();
log(`DB before: ${JSON.stringify(dbBefore)}`);

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

/** React-controlled date input: native setter + bubbled input event. The
 *  DateField pair is labeled via real <label for> elements ("Từ ngày" /
 *  "Đến ngày"), not aria-labels. */
async function setDateInputs(page, value) {
  const set = await page.evaluate((v) => {
    const inputs = [...document.querySelectorAll('input')].filter((el) => {
      const text = el.labels && el.labels[0] ? el.labels[0].textContent?.trim() : '';
      return text === 'Từ ngày' || text === 'Đến ngày';
    });
    if (inputs.length === 0) return false;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    for (const el of inputs) {
      setter.call(el, v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }, value);
  return set;
}

// The measured scope: the board's DEFAULT view (no date filter) — the local
// dev DB's page-1 dispatchable lots (20 rows, real FCL port data). A dated
// probe showed the master-plan transport-date arm excludes the 01/11 TBFL
// fixtures (their containers carry no appointment days), so the default
// scope is the honest deterministic scope for both phases.
async function openBoard(page) {
  await page.goto(`${FRONT}/dispatch`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await page.waitForFunction(
    () => document.querySelector('.master-plan-grid tbody tr') || document.querySelector('.mpcard'),
    { timeout: 25_000 },
  );
  await sleep(900);
}

/** Board geometry — the JSON metrics record (MP-RD-01/02). */
const measureBoard = (page) => page.evaluate(() => {
  const doc = document.documentElement;
  const wrapper = document.querySelector('.master-plan-grid__wrapper');
  const table = document.querySelector('table.master-plan-grid');
  const isTable = table != null && getComputedStyle(table).display !== 'block';
  const rows = [...document.querySelectorAll('.master-plan-grid tbody tr.master-plan-grid__row')];
  const cards = [...document.querySelectorAll('li.mpcard')];
  // The phone surface: the AFTER card list (li.mpcard) or, on the BEFORE
  // build, the td-grid stacked records (still tr elements).
  const recordEls = cards.length > 0 ? cards : rows;
  const heights = recordEls.map((el) => Math.round(el.getBoundingClientRect().height));
  const headers = [...document.querySelectorAll('.master-plan-grid thead th')].map((th) => ({
    label: th.textContent?.trim() ?? '',
    width: Math.round(th.getBoundingClientRect().width),
    left: Math.round(th.getBoundingClientRect().left),
  }));
  const firstTh = document.querySelector('.master-plan-grid thead th');
  const headerSpreadX = headers.length
    ? Math.max(...headers.map((h) => h.left)) - Math.min(...headers.map((h) => h.left))
    : null;
  const firstRow = recordEls[0] ?? null;
  const cellBodies = firstRow ? [...firstRow.querySelectorAll('.master-plan-grid__cell-body')] : [];
  return {
    viewport: { w: window.innerWidth, h: window.innerHeight },
    mode: cards.length > 0 ? 'card-list' : (isTable ? 'table' : 'stacked-cards'),
    pageOverflowX: doc.scrollWidth - window.innerWidth,
    theadPosition: firstTh ? getComputedStyle(firstTh).position : null,
    headerSpreadX,
    wrapper: wrapper ? {
      scrollWidth: wrapper.scrollWidth,
      clientWidth: wrapper.clientWidth,
      rail: wrapper.scrollWidth > wrapper.clientWidth + 1,
    } : null,
    tableMinWidth: table ? getComputedStyle(table).minWidth : null,
    records: recordEls.length,
    heights,
    maxRowHeight: heights.length ? Math.max(...heights) : null,
    minRowHeight: heights.length ? Math.min(...heights) : null,
    headers,
    cardCount: cards.length,
    firstRowCellBodyHeights: cellBodies.map((b) => getComputedStyle(b).maxHeight),
  };
});

// ── A. Board geometry at 390 / 768 / 1440 (MP-RD-01/02/04) ─────────────────
const metrics = {};
for (const [vp, w, h] of [['390', 390, 844], ['768', 768, 900], ['1440', 1440, 900]]) {
  const page = await newPage(dispatcherToken, w, h);
  await openBoard(page);
  const m = await measureBoard(page);
  metrics[vp] = m;
  log(`A ${vp}px ${JSON.stringify({
    mode: m.mode, records: m.records, maxRowHeight: m.maxRowHeight, minRowHeight: m.minRowHeight,
    overflowX: m.pageOverflowX, rail: m.wrapper?.rail ?? null, tableMinWidth: m.tableMinWidth,
  })}`);
  await shot(page, `board-${vp}`);

  if (PHASE === 'after') {
    check(`A ${vp}: page KHÔNG overflow ngang`, m.pageOverflowX <= 0, `overflowX=${m.pageOverflowX}`);
    if (m.mode === 'table') {
      check(`A ${vp}: table rows ≤ 93px (max ${m.maxRowHeight}px)`, m.maxRowHeight != null && m.maxRowHeight <= 93, `heights=${m.heights.join(',')}`);
      check(`A ${vp}: header sticky`, m.theadPosition === 'sticky');
      // The header cells must SPREAD across the columns — the collapsed
      // vertical label stack was the live -webkit-box-on-th defect.
      check(`A ${vp}: header cells trải ngang đúng cột (spread ${m.headerSpreadX}px)`, m.headerSpreadX != null && m.headerSpreadX > 600, `spread=${m.headerSpreadX}`);
    } else {
      check(`A ${vp}: card list owns the layout`, m.cardCount > 0, `cards=${m.cardCount}`);
    }
  } else if (m.mode === 'table') {
    // BEFORE: record the defect for the evidence file — the fixed tower and
    // the starved port columns the owner rejected (expected FAIL, logged).
    log(`BEFORE ${vp} (defect record): maxRowHeight=${m.maxRowHeight} headerWidths=${JSON.stringify(m.headers.map((x) => `${x.label.split(' ')[0]}=${x.width}`))}`);
  }
  await page.close();
}

// THỜI GIAN column share — the brief's ~110-130px floor target (table modes).
for (const vp of ['768', '1440']) {
  const m = metrics[vp];
  if (m?.mode === 'table') {
    const schedule = m.headers.find((x) => x.label.startsWith('Thời gian'));
    if (PHASE === 'after' && schedule) {
      check(`A ${vp}: THỜI GIAN thu lại (≤ ~150px, got ${schedule.width}px)`, schedule.width <= 150);
    } else if (schedule) {
      log(`BEFORE ${vp}: THỜI GIAN column = ${schedule.width}px`);
    }
  }
}

// ── B. Allocation-status sweep (MP-RD-06) at 1440 ──────────────────────────
{
  const page = await newPage(dispatcherToken, 1440, 900);
  await openBoard(page);
  const pickStatus = async (label) => {
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Phân xe:'));
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!opened) { log('sweep: Phân xe trigger not found'); return null; }
    await sleep(400);
    const picked = await page.evaluate((l) => {
      const opt = [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent?.trim() === l);
      if (!opt) return false;
      opt.click();
      return true;
    }, label);
    await sleep(1200);
    return picked;
  };
  const countRows = () => page.evaluate(() =>
    document.querySelectorAll('.master-plan-grid tbody tr.master-plan-grid__row').length
    + document.querySelectorAll('li.mpcard').length);

  const all = await pickStatus('Tất cả trạng thái');
  const nAll = await countRows();
  const cho = await pickStatus('Chờ phân xe');
  const nCho = await countRows();
  const done = await pickStatus('Đã phân xong');
  const nDone = await countRows();
  log(`B sweep: Tất cả=${nAll} (click=${all}) · Chờ phân xe=${nCho} (click=${cho}) · Đã phân xong=${nDone} (click=${done})`);
  await shot(page, 'phan-xe-sweep-1440');
  check('B: bộ lọc Phân xe đổi tập row theo trạng thái', all && cho && done && nAll >= nCho && nAll >= nDone, `all=${nAll} cho=${nCho} done=${nDone}`);
  await page.close();
}

// ── C. Sticky header survives the board's own scroll (MP-RD-03, rung 3 — after) ──
{
  const page = await newPage(dispatcherToken, 1440, 900);
  await openBoard(page);
  const pinned = await page.evaluate(async () => {
    // The wrapper is a bounded pane owning the board's vertical scroll: bring
    // the page down a little, then scroll the PANE and prove the thead rides
    // its top edge while rows pass underneath.
    const body = document.querySelector('.app-body');
    if (body) body.scrollTop = 200;
    const wrapper = document.querySelector('.master-plan-grid__wrapper');
    if (!wrapper) return null;
    wrapper.scrollTop = 400;
    await new Promise((r) => setTimeout(r, 400));
    const th = wrapper.querySelector('thead th');
    const rowsBelow = [...wrapper.querySelectorAll('tbody tr')].filter((r) => r.getBoundingClientRect().top >= th.getBoundingClientRect().top - 1);
    if (!th || rowsBelow.length === 0) return null;
    return {
      paneScrollTop: wrapper.scrollTop,
      thTop: Math.round(th.getBoundingClientRect().top),
      paneTop: Math.round(wrapper.getBoundingClientRect().top),
      rowsUnderHeader: rowsBelow.length,
      nextRowTop: Math.round(rowsBelow[0].getBoundingClientRect().top),
    };
  });
  log(`C pane sticky: ${JSON.stringify(pinned)}`);
  if (PHASE === 'after') {
    check('C: thead pin trong pane khi cuộn board (rung 3)',
      pinned != null && pinned.paneScrollTop > 0
      && Math.abs(pinned.thTop - pinned.paneTop) <= 2
      && pinned.nextRowTop > pinned.thTop
      && pinned.rowsUnderHeader > 0,
      JSON.stringify(pinned));
  }
  await shot(page, 'sticky-header-1440');
  await page.close();
}

// ── D. Gộp hàng on-demand preserved (MP-RD-05 — cả 2 phase) ────────────────
{
  const page = await newPage(dispatcherToken, 1440, 900);
  await page.goto(`${FRONT}/dispatch`, { waitUntil: 'networkidle2', timeout: 45_000 });
  await sleep(800);
  const defaultState = await page.evaluate(() => ({
    selectCol: !!document.querySelector('.master-plan-grid__cell--select, .master-plan-grid__select-head'),
    toggle: [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === '📦 Gộp hàng'),
  }));
  log(`D1 default ${JSON.stringify(defaultState)}`);
  check('D1: mặc định KHÔNG cột CHỌN, nút [📦 Gộp hàng] trên filter', defaultState.selectCol === false && defaultState.toggle === true);

  const toggled = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === '📦 Gộp hàng');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(700);
  const modeOn = await page.evaluate(() => ({
    selectCol: !!document.querySelector('.master-plan-grid__select-head'),
    exitBtn: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Thoát gộp hàng')),
  }));
  log(`D2 merge-on ${JSON.stringify(modeOn)} (toggled=${toggled})`);
  check('D2: bật mode → cột CHỌN hiện + nút ✕ Thoát gộp hàng', toggled && modeOn.selectCol && modeOn.exitBtn);
  await shot(page, 'gomhang-mode-on-1440');

  // Tick the two fixture LCL lots through the quick search (click order = Lô 1).
  const tickLot = async (ref) => {
    const set = await page.evaluate((value) => {
      const el = document.querySelector('input[aria-label="Tìm kiếm lô hàng"], input[placeholder*="Bill"]');
      if (!el) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }, ref);
    if (!set) { log(`tickLot: search input not found for ${ref}`); return false; }
    await sleep(1500);
    const ticked = await page.evaluate(() => {
      const box = document.querySelector('.ops-lcl-check:not(:disabled)');
      if (!box) return false;
      box.click();
      return true;
    });
    await sleep(600);
    return ticked;
  };
  const tickA = await tickLot(LOT_A_REF);
  const tickB = await tickLot(LOT_B_REF);
  const bar = await page.evaluate(() => {
    const barEl = document.querySelector('.lcl-selection-bar');
    return barEl ? { text: barEl.textContent ?? '', fixed: getComputedStyle(barEl.parentElement ?? barEl).position } : null;
  });
  log(`D3 ticks A=${tickA} B=${tickB} bar=${JSON.stringify(bar)}`);
  check('D3: tick 2 lô LCL → floating bar totals + Lô 1 giữ 100% cước trả ĐV',
    tickA && tickB && bar != null && /Đang chọn 2 lô/.test(bar.text) && /Lô 1 giữ 100% cước trả ĐV/.test(bar.text) && bar.text.includes(LOT_A_REF),
    `bar=${bar?.text?.slice(0, 120)}`);
  await shot(page, 'gomhang-floating-bar-1440');

  // Gán xe nhóm dialog: đúng 4 trường, KHÔNG BKS ảo — rồi HỦY (không lưu).
  const openedDialog = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Gán xe nhóm');
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(800);
  const dialog = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    if (!dlg) return null;
    const labels = [...dlg.querySelectorAll('label')].map((l) => l.textContent?.trim()).filter(Boolean);
    const text = dlg.textContent ?? '';
    return {
      labels,
      hasVehicleClass: /Loại xe tính cước trả ĐV/.test(text),
      hasCarrier: /Nhà xe/.test(text),
      hasActualBks: /BKS thực/.test(text),
      hasFreight: /Cước trả ĐVVC/.test(text),
      hasGhostBks: /BKS báo khách/.test(text),
    };
  });
  log(`D4 dialog ${JSON.stringify(dialog)} (opened=${openedDialog})`);
  check('D4: popup Gán xe nhóm đúng 4 trường, hết BKS báo khách (ảo)',
    openedDialog && dialog != null
    && dialog.hasVehicleClass && dialog.hasCarrier && dialog.hasActualBks && dialog.hasFreight
    && dialog.hasGhostBks === false,
    `labels=${dialog?.labels?.join('|')}`);
  await shot(page, 'gomhang-dialog-4-truong-1440');
  const closed = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Hủy|Đóng/.test(b.textContent ?? ''));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(500);
  log(`D4 dialog closed without saving: ${closed}`);

  // Exit the mode: the CHỌN column hides itself, the selection clears.
  const exited = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Thoát gộp hàng'));
    if (!btn) return false;
    btn.click();
    return true;
  });
  await sleep(600);
  const cleared = await page.evaluate(() => ({
    selectCol: !!document.querySelector('.master-plan-grid__select-head'),
    boxes: document.querySelectorAll('.ops-lcl-check').length,
  }));
  log(`D5 exit ${exited} → ${JSON.stringify(cleared)}`);
  check('D5: thoát mode → cột CHỌN tự ẩn, selection clear', exited && cleared.selectCol === false && cleared.boxes === 0);
  await page.close();
}

// ── E. Mobile card list rung 3 (MP-RD-04 — after phase only) ───────────────
if (PHASE === 'after') {
  const page = await newPage(dispatcherToken, 390, 844);
  await openBoard(page);
  const card = await page.evaluate(() => {
    const li = document.querySelector('li.mpcard');
    if (!li) return null;
    return {
      head: !!li.querySelector('.mpcard__head .mpcard__customer'),
      bill: !!li.querySelector('.mpcard__bill'),
      type: li.querySelector('.mpcard__type')?.textContent ?? '',
      hasNang: /Nâng · /.test(li.textContent ?? ''),
      hasTra: /Trả · /.test(li.textContent ?? ''),
      hasCargo: !!li.querySelector('.mpcard__line--strong'),
      menuBtn: !!li.querySelector('.dispatch-row-menu__trigger'),
      footBtn: !!li.querySelector('.mpcard__allocate'),
      tableGone: !document.querySelector('table.master-plan-grid thead'),
    };
  });
  log(`E1 card ${JSON.stringify(card)}`);
  check('E1: card có head KH+bill, loại, Nâng/Trả, cargo, menu ⋯, foot Phân bổ',
    card != null && card.head && card.bill && card.hasNang && card.hasTra && card.hasCargo && card.menuBtn && card.footBtn && card.tableGone,
    JSON.stringify(card));
  await shot(page, 'card-structure-390');

  // FB-014 rung 3: tap the card (outside controls) → /dispatch-detail.
  const before = page.url();
  await page.evaluate(() => {
    const li = document.querySelector('li.mpcard');
    const target = li ? li.querySelector('.mpcard__customer') : null;
    if (target) target.click();
  });
  await sleep(1500);
  const after = page.url();
  log(`E2 FB-014 card tap: ${before} → ${after}`);
  check('E2: card tap mở /dispatch-detail (FB-014)', /\/dispatch-detail/.test(after), after);
  await shot(page, 'card-tap-navigates-390');
  await page.close();
}

const dbAfter = await groupState();
log(`DB after: ${JSON.stringify(dbAfter)}`);
const identityHeld = JSON.stringify(dbBefore) === JSON.stringify(dbAfter)
  && dbAfter.every((r) => r.cost_group_id == null);
check('DB identity: nhóm gộp trước/sau không đổi (dialog hủy, không lưu)', identityHeld);

fs.writeFileSync(path.join(OUT, `metrics_${PHASE}.json`), JSON.stringify(metrics, null, 2));
log(`DONE failures=${failures}`);
await browser.close();
process.exit(failures > 0 ? 1 : 0);
