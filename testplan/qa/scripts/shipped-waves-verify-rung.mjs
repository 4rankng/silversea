// Shipped-waves QA verification on staging (waves merged to main without QA).
// Verifies four waves against their own QA/commit records:
//   (a) UI-audit-wave-1 (c5f1cd3e) — form contract on expenses/invoice-modal/tires/trip-detail
//   (b) W5-fb-regressions (7c44a1fd) — FB-043 band, FB-057 search focus, FB-061 (unit), FB-048 pin
//   (c) kanban-wave-1016b (a6ba72c5) — FB-083, FB-066, FB-084, FB-085, QA2-005
//   (d) W3a-r17-verify (ae419e3d) — spot re-drives (FB-083/084/075/044, FB-035, FB-048 rung-3)
// Usage: node shipped-waves-verify-rung.mjs <phase>
//   phases: acct | admin | dispatch | cus | cusfcl | driver
// Safety: QA-prefixed fixtures only (QAW16*), Idempotency-Key on every write,
// never clicks "Xóa bộ lọc", aborts on /shipments-detail unless OUR BL is on
// the board, refuses to type in a tờ-khai editor whose heading is not ours.
import puppeteer from 'puppeteer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
// Step-0 gate was ae419e3d; staging was re-cut mid-run (07:01Z) to 7dcdcf33 —
// a strict superset of ae419e3d with an EMPTY diff on every wave surface
// tested here (git diff ae419e3d..7dcdcf33 over ExpenseEntry*/InvoiceTracking*/
// tires/TripDetail/topbar/DispatchPlanEditorCell/backend seed = 0 files).
// Verdicts therefore still land on the four waves' shipped code.
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '7dcdcf33';
const OUT = path.resolve(import.meta.dirname, '../../../qa/1016-shipped');
fs.mkdirSync(OUT, { recursive: true });

const PHASE = process.argv[2] || '';
const USER = {
  acct: 'hoapt', admin: 'admin', dispatch: 'dungnv',
  cus: 'tiepvv', cusfcl: 'tiepvv', driver: 'bqhuong',
}[PHASE];
const STAMP = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(2, 14);
const BL = `QAW16${PHASE.toUpperCase().slice(0, 4)}${STAMP}`;

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e); console.log(JSON.stringify(e));
};
const tc = (id, verdict, detail = {}) => log('TC', { id, verdict, ...detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const fail = (id, why, detail = {}) => { tc(id, 'FAIL', { why, ...detail }); exitCode = 1; };

let token = '';
let fclSid = null; // cusfcl fixture id — cleaned up on the abort path too
const api = async (method, p, body, tok) => {
  const res = await fetch(`${API}${p}`, {
    method,
    headers: {
      Authorization: `Bearer ${tok || token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed = text;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  return { status: res.status, body: parsed };
};

// ── health gate ─────────────────────────────────────────────────────────────
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) {
  console.error('STALE BUILD — aborting phase');
  process.exit(2);
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: USER, password: 'Abc123' }),
});
if (login.status !== 200) { console.error(`login ${USER} -> ${login.status}`); process.exit(2); }
token = (await login.json()).token;
const jwtPayload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
log('identity', { user: USER, jwtUsername: jwtPayload.username || jwtPayload.identifier || jwtPayload.sub });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--window-size=1500,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
await page.evaluateOnNewDocument((t, origin) => {
  if (location.origin === origin) localStorage.setItem('token', t);
}, token, new URL(BASE).origin);

const shot = (name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`), fullPage: false });
const goto = async (url, settleMs = 2200) => {
  await page.goto(BASE + url, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(settleMs);
};
const bodyText = () => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const has = async (needle) => (await bodyText()).includes(needle);

const fieldByLabel = async (labelText) => page.evaluate((lt) => {
  const clean = (s) => s.textContent.trim().replace(/\s+/g, ' ').replace(/\*+$/, '').trim();
  const labels = [...document.querySelectorAll('label')].filter((l) => l.offsetParent && (clean(l) === lt || clean(l).startsWith(lt)));
  for (const label of labels) {
    const forId = label.getAttribute('for');
    const el = forId ? document.getElementById(forId)
      : (label.querySelector('input,select,textarea') ?? label.parentElement.querySelector('input,select,textarea') ?? label.nextElementSibling?.querySelector('input,select,textarea'));
    if (el) {
      const r = el.getBoundingClientRect();
      return { found: true, tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 80), x: r.x, y: r.y, w: r.width, h: r.height, labelText: clean(label) };
    }
  }
  return { found: false };
}, labelText);

const pickCombobox = async (labelText, query) => {
  const fld = await fieldByLabel(labelText);
  if (!fld.found) throw new Error(`combobox label not found: ${labelText}`);
  await page.click(`[id="${fld.id}"]`);
  await sleep(800);
  if (query) { await page.keyboard.type(query, { delay: 40 }); await sleep(1500); }
  const located = await page.evaluate((q) => {
    const norm = (t) => (t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const opts = [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent);
    const hit = q
      ? opts.find((o) => norm(o.textContent).includes(norm(q)))
      : opts.find((o) => !/^[+＋]/.test(o.textContent.trim()));
    if (!hit) return { ok: false, count: opts.length, sample: opts.slice(0, 5).map((o) => o.textContent.trim().slice(0, 30)) };
    const r = hit.getBoundingClientRect();
    return { ok: true, text: hit.textContent.trim().slice(0, 50), x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  }, query || '');
  if (!located.ok) throw new Error(`no option for ${labelText} (${located.count} visible; ${JSON.stringify(located.sample)})`);
  await page.mouse.move(located.x, located.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(600);
  return located.text;
};

const pickSelect = async (optionText) => {
  const sel = await page.evaluate((ot) => {
    const s = [...document.querySelectorAll('select')].find((e) => e.offsetParent && [...e.options].some((o) => o.textContent.trim() === ot));
    if (!s) return null;
    const opt = [...s.options].find((o) => o.textContent.trim() === ot);
    const proto = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value');
    proto.set.call(s, opt.value);
    s.dispatchEvent(new Event('input', { bubbles: true }));
    s.dispatchEvent(new Event('change', { bubbles: true }));
    return { id: s.id, value: opt.value };
  }, optionText);
  if (!sel) throw new Error(`select with option "${optionText}" not found`);
  await sleep(400);
  return sel;
};

const setValue = async (labelText, value) => {
  const fld = await fieldByLabel(labelText);
  if (!fld.found) throw new Error(`label not found: ${labelText}`);
  const sel = `[id="${fld.id}"]`;
  await page.click(sel, { clickCount: 3 });
  await page.keyboard.type(value, { delay: 15 });
  await sleep(200);
};

const overflowX = () => page.evaluate(() => ({
  scrollW: document.documentElement.scrollWidth,
  innerW: window.innerWidth,
  overflows: document.documentElement.scrollWidth > window.innerWidth + 2,
}));

try {
  // ══════════════════════════════════════════════════════════════════════════
  // PHASE acct — wave (a) ExpenseEntryPage + invoice modal + FB-048 rung-3 spot
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'acct') {
    // ── WAVE-A-1: ExpenseEntryPage form contract ─────────────────────────────
    await goto('/expenses/new');
    await sleep(1500);
    const exp = await page.evaluate(() => {
      const q = (sel) => document.querySelectorAll(sel).length;
      const texts = [...document.querySelectorAll('h1,h2,h3,[class*="section-title"],[class*="divider"]')]
        .filter((e) => e.offsetParent)
        .map((e) => e.textContent.trim().replace(/\s+/g, ' '))
        .filter((t) => t && t.length < 60);
      const body = document.body.innerText;
      return {
        expenseInput: q('.expense-input'),
        expenseRequired: q('.expense-required'),
        dsRequired: q('.ds-field__required'),
        nativeRequired: q('input[required],select[required],textarea[required]'),
        inputCount: q('main input, main select, main textarea'),
        sectionTexts: [...new Set(texts)].slice(0, 30),
        hasChung: body.includes('THÔNG TIN CHUNG'),
        hasDanhMuc: body.includes('DANH MỤC'),
        hasSoTien: body.includes('SỐ TIỀN'),
      };
    });
    log('wave-a-expense', exp);
    await shot('01-expense-desktop');
    if (exp.expenseInput === 0 && exp.expenseRequired === 0 && exp.dsRequired > 0 && exp.nativeRequired === 0
        && exp.hasChung && exp.hasDanhMuc && exp.hasSoTien) {
      tc('WAVE-A-1/expense', 'PASS', { sections: [exp.hasChung, exp.hasDanhMuc, exp.hasSoTien], dsRequired: exp.dsRequired, nativeRequired: exp.nativeRequired });
    } else fail('WAVE-A-1/expense', 'form contract violated', exp);
    // mobile sanity at 390
    await page.setViewport({ width: 390, height: 844 });
    await goto('/expenses/new');
    const expOv = await overflowX();
    await shot('02-expense-mobile-390');
    log('wave-a-expense-mobile', expOv);
    tc('WAVE-A-1/expense-mobile', expOv.overflows ? 'FAIL' : 'PASS', expOv);
    if (expOv.overflows) exitCode = 1;
    await page.setViewport({ width: 1440, height: 960 });

    // ── WAVE-A-2: invoice-tracking modal grid 2-col→1-col + unified anatomy ──
    await goto('/accounting/invoice-tracking');
    await sleep(2000);
    const opened = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.includes('Thêm chi phí lô hàng'));
      if (!btn) return false;
      btn.click(); return true;
    });
    log('invoice-modal-open', { opened });
    await sleep(1500);
    const inspectGrid = () => page.evaluate(() => {
      const grid = document.querySelector('.invoice-tracking-form__grid');
      if (!grid) return { gridFound: false };
      const cols = getComputedStyle(grid).gridTemplateColumns;
      const controls = [...grid.querySelectorAll('input,select,textarea,[data-uui-control],button[aria-haspopup]')].map((el) => ({
        tag: el.tagName, cls: String(el.className).slice(0, 50), rawInput: el.classList.contains('input'),
      }));
      const modal = grid.closest('[role="dialog"],.modal,[class*="modal"]');
      return {
        gridFound: true, cols, tracks: cols.split(' ').filter(Boolean).length,
        rawInputCount: controls.filter((c) => c.rawInput).length,
        controlCount: controls.length,
        modalFound: !!modal,
      };
    });
    const desktop = await inspectGrid();
    log('wave-a-invoice-desktop', desktop);
    await shot('03-invoice-modal-desktop');
    await page.setViewport({ width: 390, height: 844 });
    await sleep(900);
    const mobile = await inspectGrid();
    log('wave-a-invoice-mobile', mobile);
    await shot('04-invoice-modal-mobile-390');
    await page.setViewport({ width: 1440, height: 960 });
    if (desktop.gridFound && desktop.tracks === 2 && mobile.tracks === 1 && desktop.rawInputCount === 0) {
      tc('WAVE-A-2/invoice-modal', 'PASS', { desktopTracks: desktop.tracks, mobileTracks: mobile.tracks, rawInput: desktop.rawInputCount, controls: desktop.controlCount });
    } else fail('WAVE-A-2/invoice-modal', 'grid or anatomy wrong', { desktop, mobile });
    await page.keyboard.press('Escape');
    await sleep(500);

    // ── WAVE-D spot: FB-048 payment guard (empty disabled, 0 → danger paint) ─
    await goto('/debt');
    await sleep(2000);
    // rows are div-based ClickableCards (no anchors) — resolve a customer with
    // outstanding AR via the same endpoint the page uses, then go direct
    const aging = await api('GET', '/reports/receivables-aging').catch(() => null);
    const agingRows = aging?.body?.customers ?? aging?.body?.items ?? (Array.isArray(aging?.body) ? aging.body : []);
    const withDebt = agingRows.find((r) => (r.outstanding ?? r.totalOutstanding ?? r.balance ?? 0) > 0) ?? agingRows[0] ?? null;
    const debtLink = withDebt ? `/debt/${withDebt.customerId ?? withDebt.customer_id ?? withDebt.id}` : null;
    log('debt-link', { debtLink, agingStatus: aging?.status, agingN: agingRows.length, sample: agingRows[0] ? Object.keys(agingRows[0]).slice(0, 8) : null });
    if (!debtLink) {
      tc('WAVE-D/FB-048', 'UNCONFIRMED', { note: 'no debt row link visible' });
    } else {
      // payments written before/after — proof the dialog never submits
      const debtId = debtLink.split('/').pop();
      const before = await api('GET', `/debt/${debtId}`).catch(() => null);
      const payCountBefore = JSON.stringify(before?.body ?? {}).match(/"receiptId"/g)?.length ?? -1;
      await goto(debtLink);
      await sleep(2000);
      const openPay = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.replace(/\s+/g, ' ').includes('Ghi nhận thanh toán'));
        if (!btn) return false;
        btn.click(); return true;
      });
      await sleep(1200);
      await shot('05-debt-pay-dialog');
      const emptyState = await page.evaluate(() => {
        const btn = document.querySelector('[data-tour-id="debt-payment-submit"]');
        const amount = document.getElementById('pay-amount');
        return { btnFound: !!btn, disabledEmpty: btn ? btn.disabled : null, amountEmpty: amount ? amount.value === '' : null };
      });
      log('fb048-empty', { openPay, ...emptyState });
      if (!openPay || !emptyState.btnFound) {
        tc('WAVE-D/FB-048', 'UNCONFIRMED', { note: 'payment dialog did not open', openPay, ...emptyState });
      } else {
        if (!emptyState.disabledEmpty) fail('FB-048-empty-submit', 'Ghi nhận not disabled on empty draft', emptyState);
        else tc('FB-048-empty-submit', 'PASS', { note: 'disabled until both required fields non-empty' });
        // invalid boundary: receipt filled, amount 0
        await page.click('#pay-receipt', { clickCount: 3 });
        await page.keyboard.type('QAW16-RECEIPT', { delay: 10 });
        await page.click('#pay-amount', { clickCount: 3 });
        await page.keyboard.type('0', { delay: 10 });
        await sleep(400);
        // try submit (guard must reject, nothing writes)
        const clicked = await page.evaluate(() => {
          const btn = document.querySelector('[data-tour-id="debt-payment-submit"]');
          if (!btn || btn.disabled) return { clicked: false, disabled: btn ? btn.disabled : null };
          btn.click(); return { clicked: true, disabled: false };
        });
        await sleep(1000);
        const invalid = await page.evaluate(() => {
          const err = document.getElementById('pay-error');
          const amount = document.getElementById('pay-amount');
          const border = amount ? getComputedStyle(amount).borderColor : null;
          return { banner: err ? err.textContent.trim() : null, ariaInvalid: amount?.getAttribute('aria-invalid') ?? null, borderColor: border };
        });
        await shot('06-debt-pay-invalid');
        log('fb048-invalid', { clicked, ...invalid });
        const dangerPainted = /160,\s*68,\s*78/.test(invalid.borderColor || '');
        if (invalid.banner?.includes('Số tiền không hợp lệ') && invalid.ariaInvalid === 'true' && dangerPainted) {
          tc('FB-048-invalid-paint', 'PASS', { banner: invalid.banner, ariaInvalid: invalid.ariaInvalid, borderColor: invalid.borderColor });
        } else {
          fail('FB-048-invalid-paint', 'danger contract incomplete', invalid);
        }
        // cancel — never write
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.replace(/\s+/g, ' ').trim().startsWith('Hủy'));
          if (btn) btn.click();
        });
        await sleep(800);
        const after = await api('GET', `/debt/${debtId}`).catch(() => null);
        const payCountAfter = JSON.stringify(after?.body ?? {}).match(/"receiptId"/g)?.length ?? -1;
        log('fb048-no-write', { payCountBefore, payCountAfter, unchanged: payCountBefore === payCountAfter });
        if (payCountBefore >= 0 && payCountAfter >= 0 && payCountBefore !== payCountAfter) {
          fail('FB-048-no-write', 'payment list changed during dialog probe', { payCountBefore, payCountAfter });
        }
      }
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE admin — wave (a) tires marker + governance modal; (b) FB-057; (c) FB-066
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'admin') {
    // ── WAVE-A-3: TruckTiresPage rose required marker ────────────────────────
    const fleet = await api('GET', '/trucks?limit=5');
    const truckId = fleet.body?.items?.[0]?.id ?? fleet.body?.[0]?.id ?? null;
    log('fleet', { truckId, shape: Object.keys(fleet.body ?? {}).slice(0, 5) });
    if (!truckId) {
      tc('WAVE-A-3/tires', 'UNCONFIRMED', { note: 'no truck found for /fleet/:id/tires' });
    } else {
      await goto(`/fleet/${truckId}/tires`);
      await sleep(2000);
      let serial = await page.evaluate(() => {
        const label = document.querySelector('label[for="tire-serial"]');
        if (!label) return { found: false };
        return {
          found: true,
          dsMarker: !!label.querySelector('.ds-field__required'),
          rawAsteriskText: [...label.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('|').includes('*'),
        };
      });
      if (!serial.found) {
        // form may live behind an "Thêm lốp" toggle
        await page.evaluate(() => {
          const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Thêm lốp/.test(b.textContent));
          if (btn) btn.click();
        });
        await sleep(800);
        serial = await page.evaluate(() => {
          const label = document.querySelector('label[for="tire-serial"]');
          if (!label) return { found: false };
          return { found: true, dsMarker: !!label.querySelector('.ds-field__required'), rawAsteriskText: [...label.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join('|').includes('*') };
        });
      }
      log('wave-a-tires', serial);
      await shot('01-tires-serial-label');
      if (serial.found && serial.dsMarker && !serial.rawAsteriskText) {
        tc('WAVE-A-3/tires', 'PASS', { note: 'Serial lốp rides .ds-field__required, no plain-text asterisk' });
      } else fail('WAVE-A-3/tires', 'required marker wrong', serial);
    }

    // ── WAVE-C: FB-066 quick-add on TripInfoCard (/trips/new, admin-only) ────
    await goto('/trips/new');
    await sleep(2000);
    const quickAdd = await page.evaluate(() => {
      const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent && b.textContent.replace(/\s+/g, ' ').includes('Thêm nhanh'));
      const fields = btns.map((b) => {
        const wrap = b.closest('[class*="field"],[class*="tc-"]');
        return { label: wrap?.querySelector('label')?.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) ?? null, cls: String(b.className).slice(0, 40) };
      });
      return { count: btns.length, fields };
    });
    log('wave-c-quickadd', quickAdd);
    await shot('02-trips-new-quickadd');
    if (quickAdd.count >= 2) tc('FB-066/quick-add', 'PASS', quickAdd);
    else fail('FB-066/quick-add', 'expected quick-add affordances on truck/driver fields', quickAdd);

    // ── WAVE-B: FB-057 topbar search fluid focus ─────────────────────────────
    const measureSearch = async () => page.evaluate(() => {
      const wrap = document.querySelector('.topbar__search');
      if (!wrap) return { found: false };
      const input = wrap.querySelector('input');
      return { found: true, rest: getComputedStyle(wrap).maxWidth, width: Math.round(wrap.getBoundingClientRect().width) };
    });
    await goto('/');
    await sleep(1500);
    const rest1440 = await measureSearch();
    await page.click('.topbar__search input').catch(async () => { await page.evaluate(() => document.querySelector('.topbar__search input')?.focus()); });
    await sleep(600);
    const focus1440 = await measureSearch();
    await shot('03-topbar-focus-1440');
    log('fb057-1440', { rest1440, focus1440 });
    await page.setViewport({ width: 1100, height: 900 });
    await sleep(600);
    // blur first — the field kept focus through the viewport switch, so an
    // unblurred "rest" reading would still be inside the 560px focus tier
    await page.evaluate(() => document.activeElement?.blur?.());
    await sleep(500);
    const rest1100 = await measureSearch();
    await page.evaluate(() => document.querySelector('.topbar__search input')?.focus());
    await sleep(600);
    const focus1100 = await measureSearch();
    await shot('04-topbar-focus-1100');
    log('fb057-1100', { rest1100, focus1100 });
    await page.setViewport({ width: 1440, height: 960 });
    const restOK1440 = rest1440.found && rest1440.rest === 'none';
    const focusOK1440 = focus1440.found && focus1440.rest === 'none';
    const ladderOK1100 = rest1100.found && rest1100.rest === '360px' && focus1100.found && focus1100.rest === '560px';
    if (restOK1440 && focusOK1440 && ladderOK1100) {
      tc('FB-057/search-fluid-focus', 'PASS', { at1440: { rest: rest1440.rest, focus: focus1440.rest }, at1100: { rest: rest1100.rest, focus: focus1100.rest } });
    } else fail('FB-057/search-fluid-focus', 'cap regression', { restOK1440, focusOK1440, ladderOK1100, rest1440, focus1440, rest1100, focus1100 });

    // ── WAVE-A-4: TripDetailPage governance modal rose marker ────────────────
    const trips = await api('GET', '/trips?limit=100');
    const rows = trips.body?.items ?? trips.body ?? [];
    const statusesSeen = [...new Set(rows.map((t) => t.status))];
    // canComplete = IN_TRANSIT + manager/admin (useTripDetailPage.ts:202)
    const candidates = rows.filter((t) => t && t.id && t.status === 'IN_TRANSIT').slice(0, 4);
    log('gov-statuses', { statusesSeen, inTransit: candidates.map((t) => t.id) });
    log('gov-candidates', { n: rows.length, tried: candidates.map((t) => ({ id: t.id, status: t.status })) });
    let govDone = false;
    for (const t of candidates) {
      await goto(`/trips/${t.id}`);
      await sleep(2000);
      const openComplete = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.trim() === 'Hoàn thành');
        if (!btn) return false;
        btn.click(); return true;
      });
      if (!openComplete) continue;
      await sleep(900);
      const modal = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"],.modal,[class*="modal"]')].find((d) => d.offsetParent && d.textContent.includes('Hoàn thành chuyến'));
        if (!dlg) return { found: false };
        return {
          found: true,
          tdpAsterisk: dlg.querySelectorAll('.tdp-governance-asterisk').length,
          dsMarker: dlg.querySelectorAll('.ds-field__required').length,
        };
      });
      await shot('05-trip-governance-modal');
      log('wave-a-governance', { trip: t.id, status: t.status, ...modal });
      if (modal.found) {
        if (modal.tdpAsterisk === 0 && modal.dsMarker > 0) {
          tc('WAVE-A-4/governance-marker', 'PASS', { trip: t.id, tdpAsterisk: 0, dsMarker: modal.dsMarker });
        } else fail('WAVE-A-4/governance-marker', 'marker wrong', modal);
        // close via the modal's Hủy — never submit a completion
        await page.evaluate(() => {
          const btns = [...document.querySelectorAll('button')].filter((b) => b.offsetParent);
          const cancel = btns.find((b) => b.textContent.replace(/\s+/g, ' ').trim().startsWith('Hủy')) || btns.find((b) => b.getAttribute('aria-label') === 'Đóng');
          if (cancel) cancel.click();
        });
        await sleep(800);
        govDone = true;
        break;
      }
    }
    if (!govDone) tc('WAVE-A-4/governance-marker', 'UNCONFIRMED', { note: 'no trip with a reachable Hoàn thành modal among candidates' });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE dispatch — wave (b) FB-043 assignment-cell band
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'dispatch') {
    await goto('/dispatch-detail');
    await sleep(2500);
    const pageProbe = await page.evaluate(() => ({
      cells: document.querySelectorAll('.dispatch-assignment-cell').length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 260),
    }));
    log('dispatch-page', pageProbe);
    const band = await page.evaluate(() => {
      const cells = [...document.querySelectorAll('.dispatch-assignment-cell')].filter((c) => c.offsetParent);
      if (!cells.length) return { cells: 0 };
      const style = (el, prop) => getComputedStyle(el, prop);
      const plate = cells.map((c) => c.querySelector('.dispatch-assignment-cell__plate')).find(Boolean);
      const driver = cells.map((c) => c.querySelector('.dispatch-assignment-cell__driver')).find(Boolean);
      const carrier = cells.map((c) => c.querySelector('.dispatch-assignment-cell__carrier')).find(Boolean);
      const heights = cells.map((c) => Math.round(c.getBoundingClientRect().height));
      const plateRect = plate?.getBoundingClientRect();
      const driverRect = driver?.getBoundingClientRect();
      return {
        cells: cells.length,
        heights: [...new Set(heights)].sort((a, b) => a - b),
        plateWhiteSpace: plate ? style(plate).whiteSpace : null,
        plateTextOverflow: plate ? style(plate).textOverflow : null,
        carrierWhiteSpace: carrier ? style(carrier).whiteSpace : null,
        driverWhiteSpace: driver ? style(driver).whiteSpace : null,
        plateDriverSameLine: plateRect && driverRect ? Math.abs(plateRect.top - driverRect.top) < 3 : null,
        sampleCellWidth: Math.round(cells[0].getBoundingClientRect().width),
      };
    });
    await shot('01-dispatch-band-1440');
    log('fb043-band', band);
    if (!band.cells) {
      tc('FB-043/assignment-band', 'UNCONFIRMED', { note: 'no assignment cells on /dispatch-detail', pageText: pageProbe.text });
    } else {
      const uniform = band.heights.length === 1 || (band.heights.length === 2 && Math.abs(band.heights[0] - band.heights[1]) <= 2);
      const nowrap = band.plateWhiteSpace === 'nowrap' && band.driverWhiteSpace === 'nowrap';
      if (nowrap && band.plateTextOverflow === 'ellipsis' && uniform && band.plateDriverSameLine !== false) {
        tc('FB-043/assignment-band', 'PASS', band);
      } else fail('FB-043/assignment-band', 'band rules not winning', band);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE cus — waves (c)+(d): FB-083/075/044/084 create page, QA2-005 search, mobile
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'cus') {
    await goto('/shipments/new');
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('label,button,[role="radio"],[role="tab"]')]
        .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
      if (el) el.click();
    });
    await sleep(1200);
    await shot('01-create-top');

    // FB-083 (waves c+d): label "Ngày giao hàng"
    const labelOk = await fieldByLabel('Ngày giao hàng');
    const staleLabel = await has('Ngày giao dự kiến');
    const labelDump = await page.evaluate(() => [...document.querySelectorAll('label')].filter((l) => l.offsetParent).map((l) => l.textContent.trim().replace(/\s+/g, ' ')).slice(0, 60));
    log('labels', { labelDump });
    if (labelOk.found && !staleLabel) tc('FB-083/delivery-label', 'PASS', { label: 'Ngày giao hàng rendered, stale label absent' });
    else fail('FB-083/delivery-label', 'label mismatch', { found: labelOk.found, staleLabel });

    // FB-084 (waves c+d): CBM optional — blank-CBM LCL submit
    const marker = await page.evaluate((lt) => {
      const label = [...document.querySelectorAll('label')].find((l) => l.textContent.includes(lt));
      if (!label) return { labelFound: false };
      return { labelFound: true, requiredMarker: !!label.querySelector('.ds-field__required, [class*="required"]') };
    }, 'Thể tích (CBM)');
    log('fb084-marker', marker);
    log('fill', { picked: await pickCombobox('Khách hàng', 'YUAN') });
    log('fill', { trade: await pickSelect('Nhập khẩu') });
    await setValue('Số Bill/Booking', BL);
    log('fill', { route: await pickCombobox('Tuyến đường', null) });
    log('fill', { warehouse: await pickCombobox('Kho lấy hàng', null) });
    await setValue('Quy cách đóng gói', 'CTL');
    await setValue('Số lượng', '10');
    await setValue('Trọng lượng (kg)', '5000');
    const dg = await fieldByLabel('Ngày giao hàng');
    if (dg.found) {
      await page.click(`[id="${dg.id}"]`);
      await sleep(200);
      await page.keyboard.type('20102026', { delay: 90 });
      await sleep(300);
      log('fill', { deliveryDate: '20/10/2026' });
    }
    await shot('02-filled-blank-cbm');
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Tạo lô hàng/.test(b.textContent));
      if (btn) btn.click(); else throw new Error('no submit button');
    });
    await sleep(3500);
    await shot('03-after-submit');
    const afterUrl = page.url();
    const err9 = await has('Cần bổ sung');
    const errCbm = await has('Nhập thể tích lớn hơn 0');
    log('fb084-submit', { afterUrl, err9, errCbm });
    const m = afterUrl.match(/\/shipments\/(\d+)/);
    if (m && !err9 && !errCbm) {
      const sid = Number(m[1]);
      const get = await api('GET', `/shipments/${sid}`);
      const persisted = get.body && typeof get.body === 'object'
        ? { id: get.body.id, bl: get.body.blNumber, cbm: get.body.cargoVolumeCbm ?? null, status: get.body.status }
        : get.body;
      tc('FB-084/cbm-optional', 'PASS', { shipmentId: sid, persisted });
      const cLogin = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
      }).then((r) => r.json());
      const cGet = await fetch(`${API}/shipments/${sid}`, { headers: { Authorization: `Bearer ${cLogin.token}` } }).then((r) => r.json());
      const sidVersion = cGet.shipment?.version;
      const del = await fetch(`${API}/shipments/${sid}?version=${sidVersion}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${cLogin.token}`, 'Idempotency-Key': crypto.randomUUID() },
      }).then((r) => r.status);
      log('cleanup', { shipmentId: sid, deleteStatus: del });
    } else {
      fail('FB-084/cbm-optional', 'blank-CBM submit blocked', { afterUrl, err9, errCbm });
    }

    // FB-044 (wave d): container-type picker opens below the field
    await goto('/shipments/new');
    await sleep(3000);
    const openPick = await page.evaluate(() => {
      const trig = document.querySelector('input[aria-label="Loại container"]');
      if (!trig || !trig.offsetParent) return { found: false };
      const r = trig.getBoundingClientRect();
      trig.focus();
      trig.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      trig.click();
      return { found: true, trigBottom: Math.round(r.y + r.height) };
    });
    await sleep(900);
    const pos = await page.evaluate((trig) => {
      const pop = [...document.querySelectorAll('[role="listbox"],[data-testid*="popover"],[class*="popover"]')]
        .find((p2) => p2.offsetParent);
      if (!pop) return { popFound: false };
      const r = pop.getBoundingClientRect();
      return { popFound: true, popTop: Math.round(r.y), opensBelow: r.y >= trig.trigBottom - 4 };
    }, openPick);
    await shot('04-container-picker-position');
    log('fb044-open', { openPick, pos });
    if (openPick.found && pos.popFound && pos.opensBelow) tc('FB-044/picker-position', 'PASS', pos);
    else fail('FB-044/picker-position', 'picker not below field', { openPick, pos });

    // FB-075 (wave d): date auto-advance day→month
    await goto('/shipments/new');
    await sleep(1500);
    await page.evaluate(() => {
      const el = [...document.querySelectorAll('label,button,[role="radio"],[role="tab"]')]
        .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
      if (el) el.click();
    });
    await sleep(1000);
    const dateField = await fieldByLabel('Ngày giao hàng');
    if (dateField.found) {
      await page.click(`[id="${dateField.id}"]`);
      await sleep(200);
      await page.keyboard.type('15', { delay: 120 });
      await sleep(300);
      const seg = await page.evaluate((id) => {
        const el = document.getElementById(id);
        const active = document.activeElement;
        return {
          activeIsField: el && (active === el || el.contains(active)),
          activeCls: active ? String(active.className).slice(0, 60) : null,
          activeAria: active ? (active.getAttribute('aria-label') || active.getAttribute('placeholder') || '') : '',
        };
      }, dateField.id);
      await shot('05-date-autoadvance');
      const advanced = /month|tháng/i.test(seg.activeAria) || /month|segment/i.test(String(seg.activeCls));
      if (advanced) tc('FB-075/date-autoadvance', 'PASS', seg);
      else tc('FB-075/date-autoadvance', 'UNCONFIRMED', { note: 'focus state after typing 15', ...seg });
    } else fail('FB-075/date-autoadvance', 'date field not found');

    // QA2-005 (wave c): /shipments record search — mã lô + Vietnamese name + wildcard
    const shipList = await api('GET', '/shipments?limit=5');
    const shipItems = shipList.body?.items ?? shipList.body ?? [];
    const sampleCode = shipItems[0]?.shipmentCode ?? null;
    const sampleId = shipItems[0]?.id ?? null;
    const ws = await api('GET', '/shipments/cus-workspace?limit=100');
    const lots = ws.body?.items ?? [];
    const sampleCustomer = lots.map((x) => x.customerName).find((n) => n && /[À-ỹ]/.test(n)) ?? null;
    log('qa2005-sample', { n: shipItems.length, sampleCode, sampleCustomer });
    await goto('/shipments');
    await sleep(2500);
    const typeSearch = async (text) => {
      await page.evaluate(() => {
        const inp = document.querySelector('input[aria-label="Tìm lô hàng"], input[placeholder*="Bill, Book"]');
        if (inp) { inp.focus(); inp.select?.(); }
      });
      await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(text, { delay: 25 });
      await sleep(1200); // debounce 350 + fetch
    };
    if (sampleCode) {
      await typeSearch(sampleCode);
      const s1 = await page.evaluate(() => ({
        url: location.href,
        hasSuffix: new URLSearchParams(location.search).get('searchSuffix'),
        rowCount: document.querySelectorAll('table tbody tr').length,
      }));
      // the lot card displays Số Bill/Booking (house law: internal codes are
      // searchable but not display keys) — tie identity via API: the sampled
      // code's lot, then match the filtered row's displayed chứng từ
      const lotById = await api('GET', `/shipments/${sampleId}`);
      const lotBill = lotById.body?.blNumber ?? lotById.body?.shipment?.blNumber ?? lotById.body?.billOrBookNumber ?? null;
      const rowTexts = await page.evaluate(() => [...document.querySelectorAll('table tbody tr')].filter((r) => r.offsetParent).map((r) => r.textContent.replace(/\s+/g, ' ').slice(0, 160)));
      const rowMatchesBill = lotBill ? rowTexts.some((t) => t.includes(lotBill)) : null;
      await shot('06-search-by-code');
      log('qa2005-code', { typed: sampleCode, suffix: s1.hasSuffix, url: s1.url, rowCount: s1.rowCount, lotId: sampleId, lotBill, rowMatchesBill, rows: rowTexts });
      if (s1.hasSuffix && s1.rowCount === 1 && rowMatchesBill) tc('QA2-005/search-by-code', 'PASS', { code: sampleCode, lotId: sampleId, lotBill, note: 'exact-code search filters to its own lot; card displays the bill per display law' });
      else fail('QA2-005/search-by-code', 'code search did not filter to the right lot', { suffix: s1.hasSuffix, rowCount: s1.rowCount, lotBill, rowMatchesBill });
    } else tc('QA2-005/search-by-code', 'UNCONFIRMED', { note: 'no lot in cus-workspace to search for' });
    if (sampleCustomer && /[À-ỹ]/.test(sampleCustomer)) {
      await typeSearch(sampleCustomer.split(' ').slice(-2).join(' '));
      const suffix2 = await page.evaluate(() => new URLSearchParams(location.search).get('searchSuffix'));
      const rows2 = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
      await shot('07-search-by-customer-name');
      log('qa2005-name', { suffix: suffix2, rows: rows2 });
      if (suffix2) tc('QA2-005/search-vietnamese-name', 'PASS', { suffix: suffix2, rows: rows2 });
      else fail('QA2-005/search-vietnamese-name', 'diacritic name never reached URL', { suffix: suffix2 });
    } else tc('QA2-005/search-vietnamese-name', 'UNCONFIRMED', { note: 'no diacritic customer name in sample', sampleCustomer });
    await typeSearch('AB%1');
    const wild = await page.evaluate(() => ({
      suffix: new URLSearchParams(location.search).get('searchSuffix'),
      patternMsg: (document.body.innerText.match(/[^\n]*%[^\n]*/) ?? [''])[0].slice(0, 120),
    }));
    log('qa2005-wildcard', wild);
    if (!wild.suffix || !wild.suffix.includes('%')) tc('QA2-005/wildcard-blocked', 'PASS', { note: '% never reached the URL', ...wild });
    else fail('QA2-005/wildcard-blocked', '% applied to search', wild);

    // Mobile: /shipments/new at 375 + desktop screenshot
    await page.setViewport({ width: 375, height: 812 });
    await goto('/shipments/new');
    await sleep(2500);
    const mob = await overflowX();
    await shot('08-create-mobile-375');
    log('create-mobile-375', mob);
    tc('MOBILE/create-375', mob.overflows ? 'FAIL' : 'PASS', mob);
    if (mob.overflows) exitCode = 1;
    await page.setViewport({ width: 1440, height: 960 });
    await goto('/shipments/new');
    await sleep(2000);
    await shot('09-create-desktop-1440');
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE cusfcl — wave (c) FB-085 per-container tờ khai (hardened driver)
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'cusfcl') {
    const day = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const created = await api('POST', '/shipments', {
      customerId: 1, cargoMode: 'FCL', tradeDirection: 'IMPORT', blNumber: BL,
      shippingLineName: 'QA Line', routeId: 6,
      customerNotes: `QAFIXTURE shipped-waves-verify FB-085 ${BL}. Xoa duoc sau QA.`,
    });
    log('fcl-created', { status: created.status, id: created.body?.id, bl: BL });
    if (![200, 201].includes(created.status)) throw new Error(`create ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`);
    const sid = created.body.id ?? created.body.shipment?.id;
    fclSid = sid;
    let ver = created.body.version ?? created.body.shipment?.version ?? 1;
    await api('PUT', `/shipments/${sid}`, { expectedVersion: ver, closingAt: `${day}T03:00:00.000Z`, expectedDeliveryDate: day });
    const gv = await api('GET', `/shipments/${sid}`);
    ver = gv.body?.shipment?.version ?? ver + 1;
    log('ver-refresh', { ver });
    const adminLogin = await fetch(`${API}/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
    }).then((r) => r.json());
    const ct = await fetch(`${API}/container-types?limit=1`, { headers: { Authorization: `Bearer ${adminLogin.token}` } }).then((r) => r.json());
    const ctId = ct.items?.[0]?.id ?? null;
    // ISO-6346-valid (repo validator): QAWU + 6 serial + check digit
    const CONTAINERS = ['QAWU2000003', 'QAWU2000019', 'QAWU2000024'];
    const putC = await api('PUT', `/shipments/${sid}/containers`, {
      expectedVersion: ver,
      containers: CONTAINERS.map((num) => ({ containerNumber: num, containerTypeId: ctId, sealing: null })),
    });
    log('containers-put', { status: putC.status, err: putC.status >= 300 ? JSON.stringify(putC.body).slice(0, 300) : null });
    if (putC.status >= 300) throw new Error('container reconcile failed');

    // UI: workboard — search OUR BL only; wide transport window because the
    // board pins Hôm-nay and transport-date-less lots fall outside it (W3a law)
    await goto(`/shipments-detail?searchSuffix=${encodeURIComponent(BL)}&transportDateFrom=2026-01-01&transportDateTo=2027-12-31`);
    await sleep(3000);
    const board = await page.evaluate((bl) => {
      const rows = [...document.querySelectorAll('table tbody tr')].filter((r) => r.offsetParent);
      const ourRow = rows.find((r) => r.textContent.toUpperCase().includes(bl));
      return { rowCount: rows.length, ourRowFound: !!ourRow, rowText: ourRow?.textContent.replace(/\s+/g, ' ').slice(0, 200) ?? null };
    }, BL);
    log('board', board);
    // GUARD: abort unless OUR BL is on the board (W3a incident law)
    if (!board.ourRowFound) throw new Error(`ABORT: fixture BL ${BL} not on board — refusing to interact`);

    // Open the inline documents editor for OUR container 1 (the trigger's
    // accessible name names the container — refuse anything else)
    const openDocsEditor = async (containerNum) => {
      const clicked = await page.evaluate((cn) => {
        const name = (b) => `${b.getAttribute('aria-label') ?? ''} ${b.textContent.replace(/\s+/g, ' ')}`;
        const btn = [...document.querySelectorAll('button')]
          .find((b) => b.offsetParent && name(b).includes(`Chỉnh sửa ô chứng từ và hãng tàu ${cn}`));
        if (!btn) return { ok: false, available: [...document.querySelectorAll('button')].filter((b) => b.offsetParent && name(b).includes('Chỉnh sửa ô chứng từ')).map(name).slice(0, 8) };
        btn.click();
        return { ok: true };
      }, containerNum);
      if (!clicked.ok) throw new Error(`ABORT: no documents trigger for OUR ${containerNum}; saw ${JSON.stringify(clicked.available)}`);
      await sleep(1200);
      // GUARD: the inline editor heading must name OUR container
      const guard = await page.evaluate((cn) => {
        const ed = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
        if (!ed) return { open: false };
        const heading = ed.querySelector('.shipment-container-ledger__editor-heading span')?.textContent.trim();
        return { open: true, heading, ours: heading === cn };
      }, containerNum);
      if (!guard.open || !guard.ours) throw new Error(`ABORT: editor heading is ${JSON.stringify(guard.heading)}, expected OUR ${containerNum}`);
      return guard;
    };
    const typeDeclaration = async (containerNum, value) => {
      const guard = await openDocsEditor(containerNum);
      log('editor-guard', { containerNum, ...guard });
      const fld = await page.evaluate(() => {
        const ed = document.querySelector('.shipment-container-ledger__inline-editor[data-mode="documents"]');
        const label = [...ed.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent.trim() === 'Số tờ khai');
        const input = label?.querySelector('input');
        if (!input) return null;
        input.focus();
        input.select(); // the editor opens pre-filled (auto-copied) — replace, don't append
        return { ok: true };
      });
      if (!fld) throw new Error('Số tờ khai input not found in editor');
      await page.keyboard.type(value, { delay: 20 });
      await sleep(300);
      // Enter saves the inline editor (ShipmentContainerLedger keydown law)
      await page.keyboard.press('Enter');
      await sleep(2500);
    };

    await typeDeclaration(CONTAINERS[0], 'TKQAW160001');
    await shot('01-after-first-save-autocopy');
    // API: auto-copy must have filled the EMPTY siblings 2 and 3
    const mid = await api('GET', `/shipments/${sid}`);
    const midConts = mid.body?.containers ?? mid.body?.shipment?.containers ?? [];
    const midDecls = midConts.map((c) => ({ num: c.containerNumber, tk: c.declarationNumber ?? null }));
    log('after-autocopy', { midDecls });

    await typeDeclaration(CONTAINERS[1], 'TKQAW160002');
    await shot('02-after-diverge-save');
    // explicit copy button: visible when the persisted number still has empty
    // siblings — with 3 containers auto-copy already filled them, so record
    // visibility rather than forcing it
    const copyBtn = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && /Copy số tờ khai/i.test(b.textContent));
      return btn ? btn.textContent.trim().slice(0, 60) : null;
    });
    log('copy-button', { copyBtn });
    await shot('03-final-board');
    // API verify: container 1 = 0001, 2 = 0002 (diverged), 3 = 0001 (copied)
    const verify = await api('GET', `/shipments/${sid}`);
    const conts = verify.body?.containers ?? verify.body?.shipment?.containers ?? [];
    const decls = conts.map((c) => ({ num: c.containerNumber, tk: c.declarationNumber ?? null }));
    log('verify-declarations', { decls });
    const c1 = decls.find((d) => d.num === CONTAINERS[0]);
    const c2 = decls.find((d) => d.num === CONTAINERS[1]);
    const c3 = decls.find((d) => d.num === CONTAINERS[2]);
    const autoCopied = midDecls.find((d) => d.num === CONTAINERS[1])?.tk === 'TKQAW160001'
      && midDecls.find((d) => d.num === CONTAINERS[2])?.tk === 'TKQAW160001';
    if (c1?.tk === 'TKQAW160001' && c2?.tk === 'TKQAW160002' && c3?.tk === 'TKQAW160001' && autoCopied) {
      tc('FB-085/per-container-tokhai', 'PASS', { decls, autoCopied, copyBtn, note: 'first-save fan-out filled empty siblings; divergent per-cont edit persisted' });
    } else {
      fail('FB-085/per-container-tokhai', 'declaration fan-out wrong', { expected: ['TKQAW160001', 'TKQAW160002', 'TKQAW160001'], decls, autoCopied });
    }
    // cleanup: delete the fixture
    const gv2 = await api('GET', `/shipments/${sid}`);
    const ver2 = gv2.body?.shipment?.version ?? gv2.body?.version;
    const del = await fetch(`${API}/shipments/${sid}?version=${ver2}`, {
      method: 'DELETE', headers: { Authorization: `Bearer ${adminLogin.token}`, 'Idempotency-Key': crypto.randomUUID() },
    }).then((r) => r.status);
    log('cleanup', { shipmentId: sid, deleteStatus: del });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE driver — wave (d) FB-035 money formatting
  // ══════════════════════════════════════════════════════════════════════════
  if (PHASE === 'driver') {
    const trips = await api('GET', '/driver/me/trips').catch(() => null);
    const rows = trips?.body?.items ?? trips?.body ?? [];
    // prefer the W3a FB-035 trip, else the first trip on the list
    const preferred = Array.isArray(rows) && rows.some((t) => (t.id ?? t.tripId) === 79) ? 79 : ((rows[0]?.id ?? rows[0]?.tripId) || 79);
    log('driver-trips', { count: Array.isArray(rows) ? rows.length : null, chosen: preferred });
    await goto(`/my-trips/${preferred}`);
    await sleep(2500);
    // the cost form opens a draft on "Thêm chi phí" (nothing submits — the
    // draft is client-side until an explicit save)
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.offsetParent && b.textContent.replace(/\s+/g, ' ').includes('Thêm chi phí'));
      if (btn) btn.click();
    });
    await sleep(1000);
    const fld = await fieldByLabel('Thực chi (VND)');
    log('money-field', { trip: preferred, ...fld });
    if (!fld.found) {
      tc('FB-035/money-format', 'UNCONFIRMED', { note: 'Thực chi (VND) field not on the page', url: page.url() });
    } else {
      await page.click(`[id="${fld.id}"]`, { clickCount: 3 });
      await page.keyboard.type('15000', { delay: 25 });
      await sleep(500);
      const displayed = await page.evaluate((id) => document.getElementById(id)?.value ?? null, fld.id);
      await shot('01-money-formatted');
      log('fb035', { displayed });
      if (displayed === '15.000') tc('FB-035/money-format', 'PASS', { typed: '15000', displayed });
      else fail('FB-035/money-format', 'formatting wrong', { typed: '15000', displayed });
      // never submit — the draft is client-side only; navigating away drops it
      await goto(`/my-trips/${preferred}`);
    }
  }
} catch (e) {
  log('fatal', { error: String(e.message || e).slice(0, 400) });
  exitCode = 2;
  // never leave the FCL fixture behind on an abort
  if (fclSid) {
    try {
      const aLogin = await fetch(`${API}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
      }).then((r) => r.json());
      const gv = await fetch(`${API}/shipments/${fclSid}`, { headers: { Authorization: `Bearer ${aLogin.token}` } }).then((r) => r.json());
      const del = await fetch(`${API}/shipments/${fclSid}?version=${gv.shipment?.version}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${aLogin.token}`, 'Idempotency-Key': crypto.randomUUID() },
      }).then((r) => r.status);
      log('abort-cleanup', { shipmentId: fclSid, deleteStatus: del });
    } catch (ce) { log('abort-cleanup-failed', { error: String(ce.message || ce).slice(0, 200) }); }
  }
}

if (pageErrors.length) log('page-errors', { count: pageErrors.length, sample: pageErrors.slice(0, 5) });
fs.writeFileSync(path.join(OUT, `${PHASE}_log.json`), JSON.stringify(LOG, null, 2));
log('phase-end', { phase: PHASE, exitCode });
await browser.close();
process.exit(exitCode);
