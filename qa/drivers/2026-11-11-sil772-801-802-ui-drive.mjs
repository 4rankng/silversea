// SIL-772 / SIL-801 / SIL-802 — UI DRIVEN (rung 3) verification on local dev,
// build = this worktree (fix/r20-772-801-802 on origin/main 1ae5afcb), role
// ACCOUNTANT (ketoan, dev-seed), viewport 1920×1080 for the Rev2 grid AC.
//
// SIL-772 (QA FAIL 1ae5afcb comment 5047): the KIỂM SOÁT LÔ HÀNG board must
//   render the NINE Rev2 groups, show NO horizontal scroll at 1920px, keep
//   TỔNG TRẢ (Tổng trả & Chi phí ngoài) inside the viewport, for FCL and LCL.
// SIL-801 (comment 5048): the TỔNG PHẢI THU KHÁCH group subtotal AND the foot
//   TỔNG CỘNG must wear the amber token (--warning-text), like the row cells.
// SIL-802 (comment 5049): the Q symbol must read blue rgb(23,92,211) on the
//   /timesheet legend AND the /timesheet/bao-cao fleet grid.
//
// All three surfaces are read-only drives: the script captures the persisted
// identity (API totals) before and after to prove no data changed.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://localhost:7177';
const API = `${BASE}/api`;
const QA = 'qa';
fs.mkdirSync(QA, { recursive: true });
const LOG = `${QA}/2026-11-11_r20-772-801-802_ui-driver.log`;
const log = [];
const say = (line) => { log.push(line); console.log(line); };
let checks = 0; const fails = [];
const check = (name, ok, detail = '') => {
  checks += 1;
  say(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let L = null;
for (let i = 1; i <= 3 && !L?.token; i++) {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: process.env.QA_USER ?? 'ketoan', password: 'Abc123' }),
  });
  const text = await res.text();
  try { L = JSON.parse(text); } catch { await sleep(1200 * i); }
}
if (!L?.token) { say('LOGIN FAILED'); fs.writeFileSync(LOG, log.join('\n')); process.exit(1); }
say(`LOGIN OK ketoan (ACCOUNTANT) — ${BASE}`);

const boardBefore = await (await fetch(`${API}/accounting/debit-board`, { headers: { Authorization: `Bearer ${L.token}` } })).json();
const tsBefore = await (await fetch(`${API}/timesheet/months?year=2026&month=11`, { headers: { Authorization: `Bearer ${L.token}` } })).json();
say(`PERSISTED BEFORE: debit-board rows ${boardBefore.total ?? boardBefore.items?.length}, timesheet 11/2026 rows ${tsBefore.items?.length}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), L.token);
page.on('pageerror', (err) => say(`PAGEERROR: ${err.message}`));

const shot = (name) => page.screenshot({ path: `${QA}/${name}` });
const rgb = (v) => getComputedStyle(v).color;
const NEAR = (a, b) => a.replaceAll(' ', '') === b.replaceAll(' ', '');

try {
  // ── SIL-772: the nine-group grid, FCL then LCL ──────────────────────────
  await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.debit-board tbody tr', { timeout: 60000 });
  await sleep(600);

  const fcl = await page.evaluate(() => {
    // Two zones may render (Chờ xác nhận + the board); the rounds ledger also
    // reuses the .debit-board class — scope to the SETTLED zone by its region.
    const region = document.querySelector('[aria-label="Bảng kế hoạch điều động tổng hợp"]');
    const heads = [...(region?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent?.trim());
    const wrap = region?.querySelector('.debit-board__wrap') ?? document.querySelector('.debit-board__wrap');
    const tongTra = [...(region?.querySelectorAll('thead th') ?? [])].find((th) => th.textContent?.includes('Tổng trả'));
    const tongTraRect = tongTra?.getBoundingClientRect();
    const picker = [...document.querySelectorAll('button')].some((b) => /Cột hiển thị/.test(b.textContent ?? ''));
    return {
      heads,
      wrapScroll: wrap ? `${wrap.scrollWidth}/${wrap.clientWidth}` : 'no-wrap',
      pageScroll: `${document.documentElement.scrollWidth}/${window.innerWidth}`,
      tongTraRight: tongTraRect ? Math.round(tongTraRect.right) : null,
      tongTraText: tongTra?.textContent?.trim() ?? null,
      rows: region?.querySelectorAll('tbody tr').length ?? 0,
      h1: document.querySelector('h1')?.textContent,
      pickerVisible: picker,
    };
  });
  say(`SIL-772 FCL: H1=${fcl.h1} rows=${fcl.rows}`);
  check('772 H1 KIỂM SOÁT LÔ HÀNG', fcl.h1 === 'KIỂM SOÁT LÔ HÀNG');
  const expected9 = ['Lô', 'Hàng hóa & Cont', 'Phương tiện', 'Cước phải thu', 'Tổng thu', 'Cước phải trả', 'Tổng trả & Chi phí ngoài', 'Lợi nhuận', 'Ghi chú & Đối soát'];
  check('772 exactly NINE Rev2 group headers', fcl.heads.length === 9 && expected9.every((name, i) => fcl.heads[i] === name), JSON.stringify(fcl.heads));
  check('772 no horizontal scroll in board wrap @1920', Number(fcl.wrapScroll.split('/')[0]) <= Number(fcl.wrapScroll.split('/')[1]), fcl.wrapScroll);
  check('772 no page horizontal scroll @1920', Number(fcl.pageScroll.split('/')[0]) <= Number(fcl.pageScroll.split('/')[1]), fcl.pageScroll);
  check('772 TỔNG TRẢ (Tổng trả & Chi phí ngoài) fully inside viewport', fcl.tongTraRight != null && fcl.tongTraRight <= 1920, `right=${fcl.tongTraRight}`);
  check('772 column picker gone (9/9 default, nothing hideable)', fcl.pickerVisible === false);
  await shot('2026-11-11_r20-772_ui-fcl-1920.png');

  await page.evaluate(() => {
    const lclBtn = [...document.querySelectorAll('.debit-cargo-view__btn')].find((b) => /Hàng Lẻ \(LCL\)/.test(b.textContent ?? ''));
    lclBtn?.click();
  });
  await sleep(1200);
  const lcl = await page.evaluate(() => {
    const region = document.querySelector('[aria-label="Bảng kế hoạch điều động tổng hợp"]');
    const wrap = region?.querySelector('.debit-board__wrap') ?? document.querySelector('.debit-board__wrap');
    const lclRow = region?.querySelector('tbody tr')?.textContent ?? '';
    return {
      wrapScroll: wrap ? `${wrap.scrollWidth}/${wrap.clientWidth}` : 'no-wrap',
      pageScroll: `${document.documentElement.scrollWidth}/${window.innerWidth}`,
      tongTraRight: Math.round([...(region?.querySelectorAll('thead th') ?? [])].find((th) => th.textContent?.includes('Tổng trả'))?.getBoundingClientRect().right ?? 9999),
      rows: region?.querySelectorAll('tbody tr').length ?? 0,
      lclFlavored: /Lẻ|Ghép cùng/.test(lclRow),
    };
  });
  check('772 LCL view: no horizontal scroll @1920', Number(lcl.wrapScroll.split('/')[0]) <= Number(lcl.wrapScroll.split('/')[1]), lcl.wrapScroll);
  check('772 LCL view: no page horizontal scroll @1920', Number(lcl.pageScroll.split('/')[0]) <= Number(lcl.pageScroll.split('/')[1]), lcl.pageScroll);
  check('772 LCL view: TỔNG TRẢ inside viewport', lcl.tongTraRight <= 1920, `right=${lcl.tongTraRight}`);
  say(`SIL-772 LCL: rows=${lcl.rows} lclFlavored=${lcl.lclFlavored}`);
  await shot('2026-11-11_r20-772_ui-lcl-1920.png');

  // ── SIL-801: amber on group subtotal + foot TỔNG CỘNG ───────────────────
  await page.setViewport({ width: 1600, height: 1000 });
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.shipment-debit-totals__sum', { timeout: 60000 });
  await sleep(800);
  const amber = await page.evaluate(() => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--warning-text)';
    document.body.appendChild(probe);
    const tokenRgb = getComputedStyle(probe).color;
    probe.remove();
    const group = document.querySelector('td.shipment-debit-group__sum--warn');
    const foot = document.querySelector('td.shipment-debit-totals__sum--warn');
    const rowWarn = document.querySelector('td.shipment-debit-money--warn');
    return {
      tokenRgb,
      group: group ? { text: group.textContent?.trim(), color: getComputedStyle(group).color } : null,
      foot: foot ? { text: foot.textContent?.trim(), color: getComputedStyle(foot).color } : null,
      rowWarn: rowWarn ? getComputedStyle(rowWarn).color : null,
      groupWarnCount: document.querySelectorAll('td.shipment-debit-group__sum--warn').length,
    };
  });
  say(`SIL-801: tokenRgb=${amber.tokenRgb} groupWarnCells=${amber.groupWarnCount}`);
  check('801 amber token present', amber.tokenRgb.length > 0, amber.tokenRgb);
  check('801 group subtotal warn cell EXISTS and is amber', amber.group != null && NEAR(amber.group.color, amber.tokenRgb), JSON.stringify(amber.group));
  check('801 foot TỔNG CỘNG warn cell EXISTS and is amber', amber.foot != null && NEAR(amber.foot.color, amber.tokenRgb), JSON.stringify(amber.foot));
  if (amber.rowWarn) check('801 row cells still amber (no regression)', NEAR(amber.rowWarn, amber.tokenRgb), amber.rowWarn);
  await shot('2026-11-11_r20-801_ui-amber-totals.png');

  // ── SIL-802: Q reads blue on legend + fleet grid ─────────────────────────
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/timesheet`, { waitUntil: 'networkidle2', timeout: 60000 });
  // The page auto-selects the FIRST driver; the local Q data lives on
  // Bùi Quang Hường (month 11/2026) — pick him in the custom "Chọn lái xe"
  // selector (UUI select: trigger button + listbox options, no native <select>).
  await page.waitForSelector('.ts-driver-select', { timeout: 30000 });
  await page.click('.ts-driver-select [aria-label="Chọn lái xe"], .ts-driver-select button');
  await page.waitForSelector('[role="option"], [role="listbox"] [role="button"], li', { timeout: 15000 });
  await page.evaluate(() => {
    const option = [...document.querySelectorAll('[role="option"], [role="menuitem"], li, button, [role="button"]')]
      .find((el) => el.textContent?.trim() === 'Bùi Quang Hường');
    option?.click();
  });
  await page.waitForSelector('.ts-grid .ts-cell', { timeout: 30000 });
  await sleep(400);
  const legendQ = await page.evaluate(() => {
    const q = document.querySelector('.ts-legend .ts-legend-sym--q');
    return q ? { text: q.textContent, color: getComputedStyle(q).color } : null;
  });
  check('802 legend Q letter carries the blue', legendQ != null && legendQ.color === 'rgb(23, 92, 211)', JSON.stringify(legendQ));
  await shot('2026-11-11_r20-802_ui-timesheet-legend-q.png');

  await page.goto(`${BASE}/timesheet/bao-cao`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.ts-report tbody tr', { timeout: 60000 });
  await sleep(400);
  const fleetQ = await page.evaluate(() => {
    const qs = [...document.querySelectorAll('td.ts-report__sym--q')];
    const first = qs[0];
    const control = [...document.querySelectorAll('td.ts-report__cell')].find((td) => td.textContent === 'Đ');
    return {
      qCount: qs.length,
      qText: first?.textContent,
      qColor: first ? getComputedStyle(first).color : null,
      controlColor: control ? getComputedStyle(control).color : null,
    };
  });
  say(`SIL-802 fleet: Q cells=${fleetQ.qCount} qColor=${fleetQ.qColor} đColor=${fleetQ.controlColor}`);
  check('802 fleet grid has Q cells', fleetQ.qCount > 0);
  check('802 fleet grid Q reads BLUE rgb(23,92,211)', fleetQ.qColor === 'rgb(23, 92, 211)', fleetQ.qColor ?? 'none');
  // Contrast control only when the seeded month actually carries a Đ cell
  // (local 11/2026 seeds exactly one Q day — no Đ to measure).
  if (fleetQ.controlColor != null) {
    check('802 control Đ is NOT the blue (contrast in same grid)', fleetQ.controlColor !== 'rgb(23, 92, 211)', fleetQ.controlColor);
  } else {
    say('  SKIP 802 Đ control — seeded month carries no Đ cell');
  }
  await shot('2026-11-11_r20-802_ui-fleet-q-blue.png');

  // Persisted identity AFTER (read-only drive — nothing may change).
  const boardAfter = await (await fetch(`${API}/accounting/debit-board`, { headers: { Authorization: `Bearer ${L.token}` } })).json();
  const tsAfter = await (await fetch(`${API}/timesheet/months?year=2026&month=11`, { headers: { Authorization: `Bearer ${L.token}` } })).json();
  const boardCountBefore = boardBefore.total ?? boardBefore.items?.length;
  const boardCountAfter = boardAfter.total ?? boardAfter.items?.length;
  check('persisted identity: debit-board row count unchanged', boardCountBefore === boardCountAfter, `${boardCountBefore} → ${boardCountAfter}`);
  check('persisted identity: timesheet 11/2026 rows unchanged', tsBefore.items?.length === tsAfter.items?.length, `${tsBefore.items?.length} → ${tsAfter.items?.length}`);
} catch (err) {
  say(`DRIVER ERROR: ${err.message}`);
  fails.push('driver-error');
} finally {
  await browser.close();
}

say(`CHECKS ${checks - fails.length}/${checks} PASS`);
fs.writeFileSync(LOG, `${log.join('\n')}\nEXIT=${fails.length === 0 ? 0 : 1}\n`);
process.exit(fails.length === 0 ? 0 : 1);
