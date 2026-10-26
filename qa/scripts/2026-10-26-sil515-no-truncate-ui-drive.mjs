// SIL-515 UI drive — Kế hoạch Chi tiết Xe: no truncation, no overlap.
//
// /dispatch-detail (DISPATCHER `dieuvan`): the table (≥640px mode) must
// satisfy the SIL-515 owner law (26/10):
//   1. NO cell truncates — every value line computes `white-space: normal`,
//      `text-overflow: clip`-family (not `ellipsis`) and never hides a line
//      (`-webkit-line-clamp` absent from computed overflow behaviour);
//   2. NO line overflows its own cell box (scrollWidth ≤ clientWidth,
//      bounding rect inside its <td>) — the "Ngày giao đè Trả hàng" overlap
//      class;
//   3. header labels wrap fully (scrollHeight ≤ clientHeight on the sort
//      buttons — the 2-line clamp is gone);
//   4. the full text of the schedule/customer lines is on screen (each
//      line's rendered textContent length matches its visible content —
//      no hidden overflow tail).
// Read-only: login + GETs + filter text entry only.
//
// Usage: cd frontend && PHASE=before|after node ../qa/scripts/2026-10-26-sil515-no-truncate-ui-drive.mjs
// Output: qa/2026-10-26-sil515-no-truncate/<phase>/*.png + JSON on stdout.

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7197';
const QA_USER = process.env.QA_USER || 'dieuvan';
const QA_PASS = process.env.QA_PASS || 'Abc123';
const PHASE = process.env.PHASE || 'before';
const OUT = resolve(process.cwd(), `../qa/2026-10-26-sil515-no-truncate/${PHASE}`);
mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
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
  if (page.url().includes('login')) throw new Error(`login failed for ${user}`);
  return page;
}

const page = await login(QA_USER, QA_PASS);

async function driveAt(width, height, tag) {
  await page.setViewport({ width, height });
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  // Wait for either the table or the empty state, then make sure rows exist.
  await page.waitForSelector('.detailed-plan-grid__wrapper, .ds-empty, [class*="empty"]', { timeout: 45000 });
  await sleep(900);
  const hasTable = await page.$('table.detailed-plan-grid');
  if (!hasTable) {
    // Try clearing the filters ("Xóa lọc") so the default board renders.
    const cleared = await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Xóa lọc');
      if (btn && !btn.disabled) { btn.click(); return true; }
      return false;
    });
    if (cleared) {
      await page.waitForSelector('table.detailed-plan-grid', { timeout: 30000 }).catch(() => {});
      await sleep(900);
    }
  }
  const state = await page.evaluate(() => {
    const table = document.querySelector('table.detailed-plan-grid');
    if (!table) return { table: false };
    const rows = table.querySelectorAll('tbody tr');
    const firstRowText = rows[0]?.textContent.replace(/\s+/g, ' ').trim().slice(0, 220) ?? null;
    return { table: true, rowCount: rows.length, firstRowText };
  });
  if (!state.table || state.rowCount === 0) {
    return { tag, width, ...state, error: 'no table rows rendered' };
  }

  // ── The law assertions (run against the live DOM) ─────────────────────────
  const audit = await page.evaluate(() => {
    const table = document.querySelector('table.detailed-plan-grid');
    // Table-mode value lines (NOT the phone dpcard surface).
    const lineSelector = [
      '.detailed-plan-grid__line',
      '.ops-schedule__datetime',
      '.dispatch-assignment-cell__carrier',
      '.dispatch-assignment-cell__plate',
      '.dispatch-assignment-cell__driver',
      '.dispatch-assignment-cell__driver-phone',
      '.dispatch-assignment-cell__estimate',
      '.detailed-plan-grid__classification',
      '.detailed-plan-grid__lcl-group-tag',
      '.detailed-plan-grid__combined-note',
      '.dispatch-driver-note__tasks',
      '.dispatch-driver-note__text',
    ].join(',');
    const violations = { nowrap: [], ellipsis: [], clamp: [], overflowX: [], outsideCell: [] };
    const seen = new Set();
    for (const el of table.querySelectorAll(lineSelector)) {
      const cs = getComputedStyle(el);
      const desc = `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`.slice(0, 120);
      const text = (el.textContent || '').trim().slice(0, 40);
      const key = `${desc}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cs.whiteSpace === 'nowrap') violations.nowrap.push(key);
      if (cs.textOverflow === 'ellipsis') violations.ellipsis.push(key);
      if (cs.display === '-webkit-box' || el.style.webkitLineClamp) violations.clamp.push(key);
      // A wrapped line must never overflow its own line box horizontally.
      if (el.scrollWidth > el.clientWidth + 1) {
        violations.overflowX.push(`${key} scrollW=${el.scrollWidth} clientW=${el.clientWidth}`);
      }
      // And never paint outside its <td> (the "Ngày giao đè Trả hàng" class).
      const td = el.closest('td');
      if (td) {
        const lr = el.getBoundingClientRect();
        const tr = td.getBoundingClientRect();
        if (lr.right > tr.right + 1 || lr.left < tr.left - 1) {
          violations.outsideCell.push(`${key} line=[${Math.round(lr.left)}..${Math.round(lr.right)}] td=[${Math.round(tr.left)}..${Math.round(tr.right)}]`);
        }
      }
    }
    // Header labels: fully visible (the sort button must not hide a 3rd line).
    const headerClipped = [];
    for (const btn of table.querySelectorAll('thead .detailed-plan-grid__sort')) {
      const label = btn.textContent.replace(/\s+/g, ' ').trim();
      if (btn.scrollHeight > btn.clientHeight + 2) {
        headerClipped.push(`${label} scrollH=${btn.scrollHeight} clientH=${btn.clientHeight}`);
      }
    }
    // Headline defect check: schedule datetime vs the neighbouring route cell.
    let scheduleOverlap = null;
    const sched = table.querySelector('tbody .ops-schedule__datetime');
    if (sched) {
      const td = sched.closest('td');
      const routeTd = td?.nextElementSibling;
      if (routeTd) {
        const a = sched.getBoundingClientRect();
        const b = routeTd.getBoundingClientRect();
        scheduleOverlap = { scheduleRight: Math.round(a.right), routeLeft: Math.round(b.left), overlaps: a.right > b.left + 1 };
      }
    }
    return { violations, headerClipped, scheduleOverlap };
  });

  // ── Screenshots: header band + first rows, full pane ──────────────────────
  await page.screenshot({ path: resolve(OUT, `dispatch-detail-${tag}-full.png`) });
  const wrapper = await page.$('.detailed-plan-grid__wrapper');
  if (wrapper) await wrapper.screenshot({ path: resolve(OUT, `dispatch-detail-${tag}-table.png`) });

  return { tag, width, ...state, ...audit };
}

const at1440 = await driveAt(1440, 900, '1440');
const at1280 = await driveAt(1280, 800, '1280');

// ── Stress pass: long ticket-shaped values, live DOM (no DB write) ─────────
// The QA fixture rows are short; SIL-515's screenshot rows carried a long
// datetime ("Ngày giao 23/10/2026 …") and an unbroken long port token
// ("NORIGHTFREIG…"). Same audit, values inflated client-side first.
async function stressAt(width, height, tag) {
  await page.setViewport({ width, height });
  await page.goto(`${FE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('table.detailed-plan-grid', { timeout: 45000 });
  await sleep(700);
  await page.evaluate(() => {
    const set = (el, text) => { if (el) el.textContent = text; };
    const firstRow = document.querySelector('table.detailed-plan-grid tbody tr');
    set(firstRow?.querySelector('.ops-schedule__datetime'), 'Ngày giao 23/10/2026 08:00 – 17:00 giờ điều vận dài');
    const lines = firstRow?.querySelectorAll('.detailed-plan-grid__line') ?? [];
    if (lines[0]) lines[0].textContent = 'NORIGHTFREIGHTINTERNATIONALLONGPORTNAME';
    if (lines[1]) lines[1].textContent = 'CÔNG TY TNHH MTV LOGISTICS VẬN TẢI QUỐC TẾ KHÁCH HÀNG DÀI';
    if (lines[2]) lines[2].textContent = 'Bill: SIL503LCL434916EXTREMELYLONGBOOKINGREFERENCE';
    const routeCell = firstRow?.querySelector('td[data-label="Tuyến đường"] .detailed-plan-grid__line');
    if (routeCell) routeCell.textContent = 'Tuyến Lạch Huyện – KCN Đồng Vang Nhập hàng lẻ tuyến dài';
  });
  await sleep(300);
  const audit = await page.evaluate(() => {
    const table = document.querySelector('table.detailed-plan-grid');
    const lineSelector = [
      '.detailed-plan-grid__line',
      '.ops-schedule__datetime',
    ].join(',');
    const violations = { nowrap: [], ellipsis: [], overflowX: [], outsideCell: [] };
    const seen = new Set();
    for (const el of table.querySelectorAll(lineSelector)) {
      const cs = getComputedStyle(el);
      const text = (el.textContent || '').trim().slice(0, 30);
      const key = `${el.className}|${text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (cs.whiteSpace === 'nowrap') violations.nowrap.push(key);
      if (cs.textOverflow === 'ellipsis') violations.ellipsis.push(key);
      if (el.scrollWidth > el.clientWidth + 1) violations.overflowX.push(`${key} ${el.scrollWidth}>${el.clientWidth}`);
      const td = el.closest('td');
      if (td) {
        const lr = el.getBoundingClientRect();
        const tr = td.getBoundingClientRect();
        if (lr.right > tr.right + 1 || lr.left < tr.left - 1) violations.outsideCell.push(`${key}`);
      }
    }
    // Full text on screen: every stressed line's textContent is rendered
    // (no hidden tail) — innerText (visibility-aware) matches textContent.
    const hiddenTail = [];
    for (const el of table.querySelectorAll(lineSelector)) {
      if ((el.innerText || '').replace(/\s+/g, '') !== (el.textContent || '').replace(/\s+/g, '')) {
        hiddenTail.push(el.className);
      }
    }
    return { violations, hiddenTail };
  });
  await page.screenshot({ path: resolve(OUT, `dispatch-detail-${tag}-stress.png`) });
  const wrapper = await page.$('.detailed-plan-grid__wrapper');
  if (wrapper) await wrapper.screenshot({ path: resolve(OUT, `dispatch-detail-${tag}-stress-table.png`) });
  return { tag, width, ...audit };
}

const stress1440 = await stressAt(1440, 900, '1440');
const stress1280 = await stressAt(1280, 800, '1280');

const report = { phase: PHASE, url: `${FE}/dispatch-detail`, user: QA_USER, at1440, at1280, stress1440, stress1280 };
writeFileSync(resolve(OUT, 'ui-drive-assertions.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
