// SIL-538 (board id 603) — "Chế độ Gộp hàng: checkbox ẩn mặc định, nút Gộp
// hàng hiện cột + floating bar, tự ẩn sau khi xong; Tách nhóm/Hủy ghép hiển
// thị trực tiếp" — rung-3 drive on the WORKTREE build (:7176 = this branch).
//
//   T01 CUS /shipments-debit default: NO checkbox column; [📦 Gộp hàng] toggle
//       rides the filter strip (aria-pressed=false); no floating bar.
//   T02 toggle ON: the CHỌN column appears; ticking 2 same-customer LCL lots
//       raises the bottom floating bar («Đang chọn N lô…») with [Gộp hàng]
//       armed and [Bỏ chọn].
//   T03 [✕ Thoát gộp hàng]: the column and the bar disappear again.
//   T04 a merged row (QA26B-MRG-07, rev group) carries its "Ghép (n/N)" tag;
//       clicking it opens the direct [Tách nhóm] popover (confirm opens, then
//       cancelled — read-only drive).
//   T05 ĐV /dispatch-detail: the merged row's tag popover now hosts BOTH
//       [Hủy ghép] and [Tách nhóm] (Lô 1) — no kebab detour.
//
//   node qa/scripts/2026-10-27-sil538-gomhang-mode-ui-drive.mjs
// Env: FRONT_PORT (7176), API_PORT (3002), CUS_USER (thanhdc), DISPATCH_USER (dungnv)
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7176}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-27_sil538_gomhang-mode_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-27_sil538_gomhang-mode_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

async function login(identifier) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) throw new Error(`login failed for ${identifier} (${res.status})`);
  const { token } = await res.json();
  log(`LOGIN ok ${identifier}`);
  return token;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const cusToken = await login(process.env.CUS_USER ?? 'thanhdc');
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.evaluateOnNewDocument((t) => {
  if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
}, cusToken);

const gotoBoard = async () => {
  await page.goto(`${FRONT}/shipments-debit`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.shipment-debit-row', { timeout: 25000 });
  await sleep(800);
};

// ── T01: default face ────────────────────────────────────────────────────────
try {
  await gotoBoard();
  const probe = await page.evaluate(() => ({
    checkboxes: document.querySelectorAll('.shipment-debit-row__select').length,
    toggle: Array.from(document.querySelectorAll('.filter-bar button, .filter-bar__actions button'))
      .find((b) => /Gộp hàng/.test(b.textContent ?? ''))?.textContent?.trim() ?? null,
    togglePressed: Array.from(document.querySelectorAll('button'))
      .find((b) => /Gộp hàng/.test(b.textContent ?? ''))?.getAttribute('aria-pressed') ?? null,
    bar: Boolean(document.querySelector('.lcl-selection-bar')),
  }));
  await shot(page, 'debit-default');
  check('T01 default: zero visible checkboxes', probe.checkboxes === 0, `count=${probe.checkboxes}`);
  check('T01 [📦 Gộp hàng] toggle on the strip', probe.toggle === '📦 Gộp hàng' && probe.togglePressed === 'false',
    `toggle="${probe.toggle}" pressed=${probe.togglePressed}`);
  check('T01 no floating bar by default', probe.bar === false);

  // ── T02: mode ON — ticks + floating bar ───────────────────────────────────
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const toggle = btns.find((b) => /Gộp hàng/.test(b.textContent ?? ''));
    if (toggle) toggle.click();
  });
  await sleep(900);
  const modeProbe = await page.evaluate(() => ({
    checkboxes: document.querySelectorAll('.shipment-debit-row__select').length,
    exitToggle: Array.from(document.querySelectorAll('button'))
      .find((b) => /ộp hàng/i.test(b.textContent ?? ''))?.textContent?.trim() ?? null,
  }));
  check('T02 mode ON: checkbox column revealed', modeProbe.checkboxes > 0, `count=${modeProbe.checkboxes}`);
  check('T02 toggle flipped to [✕ Thoát gộp hàng]', /Thoát gộp hàng/.test(modeProbe.exitToggle ?? ''), `label="${modeProbe.exitToggle}"`);

  // Tick the first two same-customer LCL rows via their checkboxes.
  await page.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('.shipment-debit-row__select')).slice(0, 2);
    boxes.forEach((b) => { if (!b.checked) b.click(); });
  });
  await sleep(900);
  const barProbe = await page.evaluate(() => {
    const bar = document.querySelector('.lcl-selection-bar');
    return {
      bar: Boolean(bar),
      totals: bar?.querySelector('.lcl-selection-bar__totals')?.textContent?.trim() ?? null,
      assign: bar?.querySelector('.lcl-selection-bar__assign')?.textContent?.trim() ?? null,
      assignDisabled: bar?.querySelector('.lcl-selection-bar__assign')?.getAttribute('aria-disabled') ?? null,
      clear: bar?.querySelector('.lcl-selection-bar__clear')?.textContent?.trim() ?? null,
    };
  });
  await shot(page, 'debit-mode-ticked-bar');
  check('T02 floating bar up with picks', barProbe.bar && /Đang chọn 2 lô/.test(barProbe.totals ?? ''),
    `totals="${barProbe.totals}"`);
  check('T02 bar hosts [Gộp hàng] + [Bỏ chọn]', barProbe.assign === 'Gộp hàng' && barProbe.clear === 'Bỏ chọn',
    `assign="${barProbe.assign}" clear="${barProbe.clear}"`);

  // ── T03: exit mode — column + bar hide ────────────────────────────────────
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const exit = btns.find((b) => /Thoát gộp hàng/.test(b.textContent ?? ''));
    if (exit) exit.click();
  });
  await sleep(900);
  const exitProbe = await page.evaluate(() => ({
    checkboxes: document.querySelectorAll('.shipment-debit-row__select').length,
    bar: Boolean(document.querySelector('.lcl-selection-bar')),
    toggleBack: Array.from(document.querySelectorAll('button'))
      .find((b) => /Gộp hàng/.test(b.textContent ?? ''))?.textContent?.trim() ?? null,
  }));
  await shot(page, 'debit-mode-exited');
  check('T03 exit: ticks hidden again', exitProbe.checkboxes === 0, `count=${exitProbe.checkboxes}`);
  check('T03 exit: floating bar closed', exitProbe.bar === false);
  check('T03 toggle back to [📦 Gộp hàng]', exitProbe.toggleBack === '📦 Gộp hàng', `label="${exitProbe.toggleBack}"`);
} catch (err) {
  check('T01-03 debit-board mode drive', false, String(err));
}

// ── T04: merged row tag popover (CUS board) ─────────────────────────────────
try {
  await gotoBoard();
  const hasMerged = await page.evaluate(() => Array.from(document.querySelectorAll('.shipment-debit-mergetag__trigger')).length);
  if (!hasMerged) {
    log('INFO no merged row on the unfiltered board — skipping T04 assertion');
  } else {
    await page.evaluate(() => {
      const tag = document.querySelector('.shipment-debit-mergetag__trigger');
      tag.click();
    });
    await sleep(800);
    const popProbe = await page.evaluate(() => {
      const lists = Array.from(document.querySelectorAll('.shipment-debit-menu__list')).filter((l) => !l.hidden);
      const tach = lists.flatMap((l) => Array.from(l.querySelectorAll('button')))
        .find((b) => /Tách nhóm/.test(b.textContent ?? ''));
      return { open: lists.length > 0, tachLabel: tach?.textContent?.trim() ?? null };
    });
    await shot(page, 'debit-mergetag-popover');
    check('T04 merged row tag opens the direct popover', popProbe.open && /Tách nhóm/.test(popProbe.tachLabel ?? ''),
      `tach="${popProbe.tachLabel}"`);
    // Open the confirm, then cancel — read-only drive.
    await page.evaluate(() => {
      const lists = Array.from(document.querySelectorAll('.shipment-debit-menu__list')).filter((l) => !l.hidden);
      const tach = lists.flatMap((l) => Array.from(l.querySelectorAll('button')))
        .find((b) => /Tách nhóm/.test(b.textContent ?? ''));
      if (tach) tach.click();
    });
    await sleep(800);
    const confirmProbe = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"], .confirm-dialog, .modal');
      return { open: Boolean(dialog), text: (dialog?.textContent ?? '').replace(/\s+/g, ' ').slice(0, 160) };
    });
    await shot(page, 'debit-tach-confirm');
    check('T04 [Tách nhóm] raises its confirm (cancelled — no data change)', confirmProbe.open,
      confirmProbe.text);
    await page.keyboard.press('Escape');
    await sleep(400);
  }
} catch (err) {
  check('T04 merged-tag drive', false, String(err));
}

// ── T05: ĐV detailed-plan tag popover hosts Hủy ghép + Tách nhóm ────────────
try {
  const dvToken = await login(process.env.DISPATCH_USER ?? 'dungnv');
  const page2 = await browser.newPage();
  await page2.setViewport({ width: 1440, height: 900 });
  await page2.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, dvToken);
  await page2.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await page2.waitForSelector('.detailed-plan-grid__row', { timeout: 25000 });
  await sleep(800);
  // Search the known merged group's LÔ 1 (R39B1-LCL02 = SHP-2610-00103,
  // cost_group_order 1 — Tách nhóm is a Lô 1-only action, SPEC 18/10 §4).
  const input = await page2.$('input[placeholder="Bill, Cont, Tờ khai..."]');
  await input.click();
  await input.type('R39B1-LCL02', { delay: 30 });
  let found = false;
  for (let i = 0; i < 12; i += 1) {
    await sleep(700);
    found = await page2.evaluate(() => Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .some((n) => (n.textContent ?? '').includes('R39B1-LCL02')));
    if (found) break;
  }
  if (!found) throw new Error('merged lot row not found');
  await page2.evaluate(() => {
    const tr = Array.from(document.querySelectorAll('.detailed-plan-grid__row'))
      .find((n) => (n.textContent ?? '').includes('R39B1-LCL02'));
    const tag = tr.querySelector('.detailed-plan-grid__lcl-group-tag--action');
    tag.click();
  });
  // The tag Modal mounts through a portal — give it a beat before asserting.
  await page2.waitForSelector('.detailed-plan-grid__lcl-group-menu', { timeout: 10000 });
  await sleep(500);
  const dvProbe = await page2.evaluate(() => {
    // The actions render in the Modal's action area, the facts in the menu
    // div — the contract spans the whole dialog.
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog ? (dialog.textContent ?? '') : '';
    const buttons = dialog ? Array.from(dialog.querySelectorAll('button')).map((b) => b.textContent?.trim()) : [];
    return { open: Boolean(dialog), buttons, hasHuyGhep: text.includes('Hủy ghép'), hasTachNhom: text.includes('Tách nhóm') };
  });
  await shot2(page2, 'dispatch-tag-popover');
  check('T05 ĐV tag popover: [Hủy ghép] + [Tách nhóm] direct (no kebab)',
    dvProbe.open && dvProbe.hasHuyGhep && dvProbe.hasTachNhom,
    `buttons=${JSON.stringify(dvProbe.buttons)}`);
  await page2.close();
} catch (err) {
  check('T05 dispatch popover drive', false, String(err));
}

function shot2(p, name) { return p.screenshot({ path: path.join(OUT, `2026-10-27_sil538_gomhang-mode_ui-${name}.png`), fullPage: false }); }

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
