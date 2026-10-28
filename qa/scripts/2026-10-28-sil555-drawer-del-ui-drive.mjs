// SIL-555 UI drive — DV drawer "Chi tiết container" (Kế hoạch Tổng quát,
// /dispatch → DispatchContainerDetailDrawer), driven as dungnv (DISPATCHER —
// the ticket's repro role). Rung-3 contract per acceptance clause:
//   1 — the drawer's table gains a THAO TÁC column with a per-row "Xóa
//       container" danger button (the ticket: no delete control existed).
//   2 — SIL-177 guard: rows carrying a tờ khai show the DISABLED button with
//       the guard's own tooltip ("Cont có tờ khai <số> — gỡ tờ khai trước
//       khi xóa") — the FE never warn-and-allows past the BE 409.
//   3 — the gỡ-tờ-khai workflow the tooltip prescribes enables the button.
//   4 — the button opens the danger confirm naming the row (SIL-472
//       contract); "Xóa container" really deletes the row, the drawer
//       refetches (row gone, count drops), success toast surfaces.
// DB side effect is proven by the psql captures this run is wrapped in
// (qa/2026-10-28_sil555-drawer-del/db-*.txt): the throwaway row is added by
// the drive and deleted BY the flow under test, so the DB ends pre-drive.
//
// Typing rides DOM event synthesis (ENV LIMITATION documented in
// 2026-10-28-sil550-drawer-add-edit-ui-drive.mjs — CDP keyboard delivers no
// key events to authed app pages on Chrome 156 + puppeteer 25.16); all
// clicks are real DOM clicks on the real controls.
//
// Usage (worktree stack): node qa/scripts/2026-10-28-sil555-drawer-del-ui-drive.mjs
//   QA_BASE_URL=http://localhost:7196  QA_API=http://localhost:3102 (defaults)
// Output: qa/2026-10-28_sil555-drawer-del/<run>/*.png + assertions.json + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7196';
const API = process.env.QA_API || 'http://localhost:3102';
const RUN = process.env.QA_RUN_TAG || 'run1';
const OUT = resolve(process.cwd(), 'qa/2026-10-28_sil555-drawer-del', RUN);
const LOG = resolve(OUT, 'ui-driver.log');
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOT_LABEL = 'R42RV-FCL'; // the lot's Bill/Booking reference (aria-label identity)
const DECL = 'TK-R42RV-001'; // the lot's inherited per-cont tờ khai (SIL-177 guard fixture)

// ISO 6346 check digit (shared/src/calculations/iso6346.ts, DEF-20260804-005).
const LETTER_MAP = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19,
  J: 20, K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29,
  S: 30, T: 31, U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};
function withCheckDigit(base10) {
  let total = 0;
  for (let i = 0; i < 10; i += 1) {
    const char = base10[i];
    const value = i < 4 ? LETTER_MAP[char] : Number(char);
    total += value * (2 ** i);
  }
  const check = total % 11;
  return `${base10}${check === 10 ? 0 : check}`;
}
const THROWAWAY = withCheckDigit('MSKU823456');
log(`throwaway container number: ${THROWAWAY} (ISO 6346 check digit per shared/src/calculations/iso6346.ts)`);

const result = { run: RUN, role: 'dungnv (DISPATCHER)', lot: LOT_LABEL, throwaway: THROWAWAY, viewport: '1280x900 + 390x844', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; };

const browser = await puppeteer.launch({
  headless: true,
  defaultViewport: { width: 1280, height: 900 },
});

async function login(user, pass) {
  const page = await browser.newPage();
  await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
  await page.waitForSelector('input[name="username"]', { timeout: 45000 });
  await page.type('input[name="username"]', user);
  await page.type('input[name="password"]', pass);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

// DOM event synthesis (ENV LIMITATION above): native setter + input event is
// exactly what a keystroke produces for a React controlled input.
async function fillInput(page, selector, value) {
  await page.evaluate((sel, val) => {
    const el = document.querySelector(sel);
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, val);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, selector, value);
}

async function pressKey(page, selector, key) {
  await page.evaluate((sel, k) => {
    const el = document.querySelector(sel);
    el.focus();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }, selector, key);
}

async function openDrawer(page) {
  await page.goto(`${FE}/dispatch`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.master-plan-grid tbody tr', { timeout: 60000 });
  await fillInput(page, 'input[aria-label="Tìm kiếm lô hàng"]', 'R42RV');
  await sleep(1800);
  const trigger = await page.$(`button[aria-label="Xem chi tiết container của ${LOT_LABEL}"]`)
    ?? await page.$('button[aria-label^="Xem chi tiết container"]');
  if (!trigger) throw new Error(`no "Chi tiết container" trigger for lot ${LOT_LABEL}`);
  await trigger.evaluate((el) => el.click());
  await page.waitForSelector('.dispatch-container-detail__table', { timeout: 20000 });
  await sleep(700);
}

// The drawer's per-row readout: buttons keyed by row identity, count text.
function drawerState(page) {
  return page.evaluate((decl) => {
    const drawer = document.querySelector('.dispatch-container-detail');
    const rows = [...drawer.querySelectorAll('tbody tr')].map((tr) => {
      const button = tr.querySelector('button[aria-label^="Xóa container"]');
      return {
        text: tr.textContent.replace(/\s+/g, ' ').trim(),
        ariaLabel: button?.getAttribute('aria-label') ?? null,
        disabled: button?.hasAttribute('disabled') ?? null,
        title: button?.getAttribute('title') ?? null,
      };
    });
    return {
      countText: drawer.querySelector('header span')?.textContent ?? null,
      headers: [...drawer.querySelectorAll('thead th')].map((th) => th.textContent.trim()),
      rows,
      dialog: document.querySelector('.confirm-box')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
      toast: document.querySelector('.toast-container')?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    };
  }, DECL);
}

const page = await login('dungnv', 'Abc123');
log('login ok user=dungnv (DISPATCHER — the ticket repro role)');
await openDrawer(page);
// The THAO TÁC rail sits at the table's right edge (the __table-scroll band
// scrolls horizontally below the 1180px floor at this drawer width) — scroll
// it into full view so the evidence screenshots show the whole button.
await page.evaluate(() => {
  const scroller = document.querySelector('.dispatch-container-detail__table-scroll');
  if (scroller) scroller.scrollLeft = scroller.scrollWidth;
});
await sleep(300);

// ── Gate 1 — the new THAO TÁC column + per-row Xóa container button ─────────
let state = await drawerState(page);
check('Thao tác column rendered on the drawer table', state.headers.includes('Thao tác'), state.headers);
check('every container row carries a Xóa container control', state.rows.length > 0 && state.rows.every((r) => r.ariaLabel), state.rows.map((r) => r.ariaLabel));
log(`gate1 headers=${JSON.stringify(state.headers)} rows=${state.rows.length}`);
await page.screenshot({ path: resolve(OUT, 'ui-1-thao-tac-column-1280.png') });

// ── Gate 2 — SIL-177 guard: declared rows disabled with the guard tooltip ───
const declared = state.rows.filter((r) => r.disabled && (r.title ?? '').includes('gỡ tờ khai trước khi xóa'));
check('declared rows disable Xóa with the SIL-177 guard tooltip', declared.length >= 1, declared.map((r) => r.title));
const tripped = state.rows.filter((r) => r.disabled && (r.title ?? '').includes('đã gắn chuyến xe'));
log(`gate2 disabled-declared=${declared.length} disabled-tripped=${tripped.length}`);
await page.screenshot({ path: resolve(OUT, 'ui-2-guard-disabled-1280.png') });

// ── Gate 3 — add a throwaway row (it inherits the lot's tờ khai) ────────────
await page.evaluate(() => {
  [...document.querySelectorAll('.dispatch-container-detail__add button')].find((b) => b.textContent.includes('Thêm container')).click();
});
await page.waitForSelector('#dispatch-detail-add-number', { timeout: 5000 });
await fillInput(page, '#dispatch-detail-add-number', THROWAWAY);
await page.evaluate(() => {
  [...document.querySelectorAll('.dispatch-container-detail__add-actions button')].find((b) => b.textContent.trim() === 'Thêm').click();
});
await page.waitForFunction((n) => [...document.querySelectorAll('.dispatch-container-detail tbody tr')].some((tr) => tr.textContent.includes(n)), { timeout: 20000 }, THROWAWAY);
await sleep(900);
state = await drawerState(page);
const throwawayRow = state.rows.find((r) => r.text.includes(THROWAWAY));
check('throwaway row added (3 cont)', state.rows.length === 3 && throwawayRow != null, state.countText);
check('throwaway inherited tờ khai → Xóa disabled with guard tooltip', throwawayRow?.disabled === true && (throwawayRow?.title ?? '').includes(DECL), throwawayRow);
log(`gate3 added ${THROWAWAY}: count="${state.countText}" guard="${throwawayRow?.title}"`);
await page.screenshot({ path: resolve(OUT, 'ui-3-throwaway-guarded-1280.png') });

// ── Gate 4 — gỡ tờ khai (the tooltip's prescription) enables the button ─────
await page.evaluate((n) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(n));
  row.querySelector('button[aria-label^="Sửa số tờ khai"]').click();
}, THROWAWAY);
await page.waitForSelector('input[aria-label="Số tờ khai"]', { timeout: 5000 });
await fillInput(page, 'input[aria-label="Số tờ khai"]', '');
await pressKey(page, 'input[aria-label="Số tờ khai"]', 'Enter');
await page.waitForFunction((n) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(n));
  const b = row?.querySelector('button[aria-label^="Xóa container"]');
  return b != null && !b.hasAttribute('disabled');
}, { timeout: 20000 }, THROWAWAY).catch(() => {});
await sleep(700);
state = await drawerState(page);
const enabledRow = state.rows.find((r) => r.text.includes(THROWAWAY));
check('after gỡ tờ khai the Xóa button is enabled', enabledRow?.disabled === false, enabledRow);
log(`gate4 after clearing tờ khai: disabled=${enabledRow?.disabled}`);
await page.screenshot({ path: resolve(OUT, 'ui-4-remove-enabled-1280.png') });

// ── Gate 5 — confirm dialog names the row (SIL-472) ─────────────────────────
await page.evaluate((n) => {
  const row = [...document.querySelectorAll('.dispatch-container-detail tbody tr')].find((tr) => tr.textContent.includes(n));
  row.querySelector('button[aria-label^="Xóa container"]').click();
}, THROWAWAY);
await page.waitForSelector('.confirm-box', { timeout: 5000 });
await sleep(400);
state = await drawerState(page);
check('confirm dialog opens naming the row', (state.dialog ?? '').includes(`Xóa container ${THROWAWAY}?`), state.dialog);
check('confirm carries the danger "Xóa container" action + Hủy', await page.evaluate(() => {
  const box = document.querySelector('.confirm-box');
  const labels = [...box.querySelectorAll('button')].map((b) => b.textContent.trim());
  return labels.includes('Xóa container') && labels.includes('Hủy');
}), 'confirm buttons');
log(`gate5 dialog="${state.dialog}"`);
await page.screenshot({ path: resolve(OUT, 'ui-5-confirm-dialog-1280.png') });

// ── Gate 6 — the confirm really deletes the row (SIL-472 contract) ──────────
await page.evaluate(() => {
  [...document.querySelectorAll('.confirm-box button')].find((b) => b.textContent.trim() === 'Xóa container').click();
});
await page.waitForFunction((n) => ![...document.querySelectorAll('.dispatch-container-detail tbody tr')].some((tr) => tr.textContent.includes(n)), { timeout: 20000 }, THROWAWAY).catch(() => {});
await sleep(900);
state = await drawerState(page);
check('row deleted — drawer refetched to 2 cont', state.rows.length === 2 && !state.rows.some((r) => r.text.includes(THROWAWAY)), state.countText);
check('success toast surfaced', (state.toast ?? '').includes(`Đã xóa container ${THROWAWAY}.`), state.toast);
check('confirm dialog dismissed after the delete', state.dialog == null, state.dialog);
log(`gate6 after delete: count="${state.countText}" toast="${state.toast}"`);
await page.screenshot({ path: resolve(OUT, 'ui-6-deleted-1280.png') });

// ── 390 stacked view of the final drawer state ──────────────────────────────
await page.setViewport({ width: 390, height: 844 });
await sleep(700);
await page.screenshot({ path: resolve(OUT, 'ui-7-deleted-390.png') });
const stacked = await page.evaluate(() => {
  const row = document.querySelector('.dispatch-container-detail tbody tr');
  return { hasRemove: row?.querySelector('button[aria-label^="Xóa container"]') != null, label: row?.querySelector('td[data-label="Thao tác"]')?.getAttribute('data-label') ?? null };
});
check('390 stacked view keeps the Thao tác field + control', stacked.hasRemove && stacked.label === 'Thao tác', stacked);
await page.setViewport({ width: 1280, height: 900 });

// Health ping recorded for the evidence header (API under the drive).
const health = await page.evaluate(async (api) => {
  try {
    const res = await fetch(`${api}/api/health`);
    return { status: res.status, body: (await res.text()).slice(0, 200) };
  } catch (error) {
    return { status: 0, error: String(error) };
  }
}, API);
log(`api health: ${JSON.stringify(health)}`);

writeFileSync(resolve(OUT, 'assertions.json'), `${JSON.stringify(result, null, 2)}\n`);
log(`checks: ${result.checks.filter((c) => c.pass).length}/${result.checks.length} pass${result.failed ? ' — FAILED' : ''}`);
await browser.close();
process.exit(result.failed ? 1 : 0);
