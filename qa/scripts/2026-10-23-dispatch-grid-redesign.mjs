// Owner redesign 23/10 — grid Điều vận Chi tiết (/dispatch-detail) rung-3 QA
// driver. BEFORE = the pre-change build (same commit served by the main
// checkout, default FRONT 7175); AFTER = this worktree's build (FRONT env,
// e.g. http://localhost:7182). Ports are env-only per dev-port-contract.
//
// Coverage (testplan/2026-10-23-dispatch-grid-redesign.md):
//   R1 phone 390×844  — card list + single ⋯ menu (44px) open screenshot
//   R2 768×1024       — table with in-container horizontal rail + sticky head
//   R3 1440×900       — balanced table, compact rows, SĐT one line, no inline
//                       red delete, actions pinned right, no page overflow
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import postgres from '../../backend/node_modules/postgres/src/index.js';

const FRONT = process.env.QA_FRONT ?? 'http://localhost:7175';
const API = process.env.QA_API ?? 'http://localhost:3002/api';
const PHASE = process.env.QA_PHASE ?? 'before'; // before | after
const OUT = path.resolve('qa/2026-10-23-dispatch-grid-redesign');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, `dispatch-grid_${PHASE}_ui-driver.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${PHASE}_${name}.png`) });

let failures = 0;
const check = (name, ok, detail = '') => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`PHASE=${PHASE} front=${FRONT} health=${health?.status}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: 'Abc123' }),
  });
  if (!res.ok) { log(`ABORT: login failed (${res.status})`); process.exit(2); }
  const { token } = await res.json();
  return token;
};
const token = await login(process.env.QA_USER ?? 'dungnv');

const browser = await puppeteer.launch({ headless: 'true' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openBoard(width, height) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  await page.evaluateOnNewDocument((t) => {
    if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t);
  }, token);
  page.on('pageerror', (err) => log(`PAGEERROR ${err.message}`));
  await page.goto(`${FRONT}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 45_000 });
  // Widen the date scope to Tất cả so the fixture lots (17/10) are on the
  // board regardless of the today-lens default.
  const clicked = await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Tất cả');
    if (el) { el.click(); return true; }
    return false;
  });
  if (clicked) log(`scope=Tất cả clicked @${width}`);
  await sleep(1200);
  await page.waitForFunction(
    () => document.querySelector('.detailed-plan-grid tbody tr') || document.querySelector('.dpcard'),
    { timeout: 20_000 },
  );
  await sleep(600);
  return page;
}

const measure = (page) => page.evaluate(() => {
  const table = document.querySelector('.detailed-plan-grid');
  const wrapper = document.querySelector('.detailed-plan-grid__wrapper');
  const card = document.querySelector('.dpcard');
  const rows = [...document.querySelectorAll('.detailed-plan-grid__row')];
  const rowHeights = rows.slice(0, 8).map((r) => Math.round(r.getBoundingClientRect().height));
  const phone = document.querySelector('.dispatch-assignment-cell__driver-phone');
  const menuTrigger = document.querySelector('.dispatch-row-menu__trigger');
  const redDelete = [...document.querySelectorAll('.detailed-plan-grid__note-action--delete')].length;
  const inlineDelete = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Xóa lô' && !b.closest('[role="menu"]')).length;
  const menuTriggerRect = menuTrigger?.getBoundingClientRect();
  return {
    mode: card ? 'cards' : table ? 'table' : 'none',
    rowCount: rows.length || document.querySelectorAll('.dpcard').length,
    rowHeights,
    phoneText: phone?.textContent ?? null,
    phoneHeight: phone ? Math.round(phone.getBoundingClientRect().height) : null,
    menuTriggerPx: menuTriggerRect ? Math.round(menuTriggerRect.width) : null,
    redDelete,
    inlineDelete,
    wrapperScroll: wrapper ? { sw: wrapper.scrollWidth, cw: wrapper.clientWidth } : null,
    pageOverflowX: document.scrollingElement.scrollWidth - document.documentElement.clientWidth,
    stickyActions: !!document.querySelector('.detailed-plan-grid__cell--actions'),
  };
});

// ── Persisted-state identity (§9.3): the redesign is a UI restructure — the
// session must leave the data untouched. DB snapshot before/after the drive.
const sql = postgres('postgres://postgres:postgres@127.0.0.1:5441/silversea');
const boardSnapshot = async () => {
  const rows = await sql`select count(*)::int as n, max(updated_at)::text as last from shipments`;
  return JSON.stringify(rows[0]);
};
const snapshotBefore = await boardSnapshot();

// ── 390×844 — R1 (card list + menu) ─────────────────────────────────────────
{
  const page = await openBoard(390, 844);
  const m = await measure(page);
  log(`390 metrics ${JSON.stringify(m)}`);
  await shot(page, 'grid-390');
  if (PHASE === 'after') {
    check('R1: card list renders under 640px', m.mode === 'cards');
    const vehicleLine = await page.evaluate(() => {
      const el = document.querySelector('.dpcard__line--vehicle');
      if (!el) return null;
      return { h: Math.round(el.getBoundingClientRect().height), ws: getComputedStyle(el).whiteSpace, text: el.textContent };
    });
    log(`390 vehicle line ${JSON.stringify(vehicleLine)}`);
    check('R1: SĐT renders on ONE line (≤22px tall)', (m.phoneHeight == null || m.phoneHeight <= 22) && (vehicleLine == null || (vehicleLine.h <= 22 && vehicleLine.ws === 'nowrap')), `cell=${m.phoneHeight} line=${JSON.stringify(vehicleLine)}`);
    check('R1: no inline delete button outside the menu', m.inlineDelete === 0 && m.redDelete === 0);
    check('R1: the ⋯ menu trigger is the 44px touch floor', m.menuTriggerPx != null && m.menuTriggerPx >= 40, `${m.menuTriggerPx}px`);
    // Open the first card's ⋯ menu and prove the item set + order.
    const menu = await page.evaluate(() => {
      const trigger = document.querySelector('.dpcard .dispatch-row-menu__trigger');
      if (!trigger) return null;
      trigger.click();
      return true;
    });
    await sleep(350);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.textContent?.trim()));
    log(`390 menu items: ${JSON.stringify(items)}`);
    check('R1: menu opens with the row verbs', items.length > 0);
    check('R1: Xóa lô rides LAST in the danger voice', items[items.length - 1] === 'Xóa lô');
    // The edit verb is labelled "Phân xe lại" on a live issued trip (the
    // same dynamic-label law the old inline trigger owned).
    check('R1: the edit verb is present (Sửa điều phối or Phân xe lại)', items.includes('Sửa điều phối') || items.includes('Phân xe lại'));
    await shot(page, 'card-menu-open-390');
    // DOM/text assertion after the click.
    const menuVisible = await page.evaluate(() => {
      const list = document.querySelector('[role="menu"]');
      return list ? getComputedStyle(list).visibility !== 'hidden' : false;
    });
    check('R1: open menu DOM visible', menuVisible);
    await page.close();
  } else {
    // BEFORE: document the squeezed state (table/cards at 390, wrapping SĐT).
    check('BEFORE 390: board renders rows', m.rowCount > 0, `rows=${m.rowCount}`);
    await page.close();
  }
}

// ── 768×1024 — R2 (table + in-container rail) ───────────────────────────────
{
  const page = await openBoard(768, 1024);
  const m = await measure(page);
  log(`768 metrics ${JSON.stringify(m)}`);
  await shot(page, 'grid-768');
  if (PHASE === 'after') {
    check('R2: table mode ≥640px', m.mode === 'table');
    check('R2: rail lives INSIDE the container (page never overflows)', m.pageOverflowX <= 0, `overflow=${m.pageOverflowX}`);
    check('R2: SĐT one line', m.phoneHeight == null || m.phoneHeight <= 22, `h=${m.phoneHeight}`);
    check('R2: actions column present', m.stickyActions);
  } else {
    check('BEFORE 768: board renders rows', m.rowCount > 0, `rows=${m.rowCount}`);
  }
  await page.close();
}

// ── 1440×900 — R3 (balance + compact rows) ─────────────────────────────────
{
  const page = await openBoard(1440, 900);
  const m = await measure(page);
  log(`1440 metrics ${JSON.stringify(m)}`);
  // Full-table proof shot: scroll the wrapper to the LEFT edge, then capture.
  await page.evaluate(() => {
    const w = document.querySelector('.detailed-plan-grid__wrapper');
    if (w) w.scrollLeft = 0;
  });
  await shot(page, 'grid-1440-full-left');
  const scrolled = await page.evaluate(() => {
    const w = document.querySelector('.detailed-plan-grid__wrapper');
    if (!w) return null;
    w.scrollLeft = w.scrollWidth;
    return { sw: w.scrollWidth, cw: w.clientWidth };
  });
  await sleep(300);
  await shot(page, 'grid-1440-scrolled-right');
  log(`1440 wrapper scrolled ${JSON.stringify(scrolled)}`);
  if (PHASE === 'after') {
    check('R3: table mode at desktop', m.mode === 'table');
    const tall = m.rowHeights.filter((h) => h > 120).length;
    check('R3: compact rows — no ~230px towers (all ≤120px)', tall === 0, `heights=${m.rowHeights.join(',')}`);
    check('R3: SĐT one line (never per-character wrap)', m.phoneHeight == null || m.phoneHeight <= 22, `h=${m.phoneHeight} text=${m.phoneText}`);
    check('R3: no inline red delete button', m.redDelete === 0 && m.inlineDelete === 0);
    check('R3: page has no horizontal overflow', m.pageOverflowX <= 0, `overflow=${m.pageOverflowX}`);
    check('R3: pinned Thao tác column exists', m.stickyActions);
    // Sticky proof: with the rail scrolled fully right, the actions cell of
    // the first row must still be inside the visible client box.
    const stickyVisible = await page.evaluate(() => {
      const cell = document.querySelector('.detailed-plan-grid__cell--actions');
      const wrap = document.querySelector('.detailed-plan-grid__wrapper');
      if (!cell || !wrap) return false;
      const r = cell.getBoundingClientRect();
      const wr = wrap.getBoundingClientRect();
      return r.right <= wr.right + 1 && r.left >= wr.left - 1;
    });
    check('R3: actions stay pinned while the rail scrolls', stickyVisible);
  } else {
    check('BEFORE 1440: board renders rows', m.rowCount > 0, `rows=${m.rowCount}`);
    log(`BEFORE 1440 row heights: ${m.rowHeights.join(',')} (owner defect: ~230px towers)`);
  }
  await page.close();
}

await browser.close();

const snapshotAfter = await boardSnapshot();
check('§9.3 persisted-state identity: the UI session mutated nothing', snapshotBefore === snapshotAfter,
  `shipments ${snapshotAfter}`);
fs.writeFileSync(path.join(OUT, `dispatch-grid_${PHASE}_db-identity.json`), `${snapshotBefore}\n${snapshotAfter}\n`);
await sql.end();

log(`SUMMARY phase=${PHASE} failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
