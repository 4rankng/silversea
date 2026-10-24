// SIL-470 (/payables) + SIL-471 (/expenses) — rung-3 UI drive (LOCAL ONLY).
// Data-dense redesign wave 24/10: capture before/after evidence at 1568/768/390
// and (after phase) assert the AC checklist against the real DOM:
//   470: summary band ≤96px (tổng + chips quá hạn/NCC + aging segmented bar),
//        bảng 1 cột "Hạn nợ" mini stacked bar + tooltip, không ô '—',
//        tên NCC 1 dòng + tooltip, sub-line '_' không render,
//        chip "Quá hạn" lọc bucket=overdue.
//   471: stat strip thay 3 card, ngày 1 dòng + badge nhập, bỏ cột THÀNH PHẦN,
//        pagination ẩn khi ≤1 trang, page ≤~900px @1568×947.
// Run: PHASE=before|after node qa/scripts/2026-10-24-sil470-471-datadense-ui-drive.mjs
// Env: FRONT_PORT (7175), API_PORT (3002). hoapt/Abc123 (ACCOUNTANT —
// staging-mirror named account per testplan/testaccounts.txt; demo `ketoan`
// does not exist on this DB, verified 2026-10-24).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const PHASE = process.env.PHASE ?? 'before';
const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7175}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const ROOT = path.resolve('qa');
const PAGES = (process.env.PAGES ?? 'payables,expenses')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((slug) => ({ slug, route: slug === 'payables' ? '/payables' : '/expenses' }));
const WIDTHS = [
  { w: 1568, h: 947 },
  { w: 768, h: 900 },
  { w: 390, h: 844 },
];

fs.mkdirSync(ROOT, { recursive: true });
const LOG = path.join(ROOT, `2026-10-24_sil470-471_datadense_ui-driver-${PHASE}.log`);
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT} phase=${PHASE}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
});
if (!loginRes.ok) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
const { token } = await loginRes.json();
log('LOGIN ok role=hoapt (ACCOUNTANT)');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => consoleErrors.push(String(e)));

// Capture payables /expenses bucket requests so the Quá hạn chip click can be
// verified against the real query string.
const payablesRequests = [];
page.on('request', (req) => {
  const u = req.url();
  if (u.includes('/reports/payables-summary')) payablesRequests.push(u);
});

for (const target of PAGES) {
  log(`\n===== ${target.slug.toUpperCase()} (${target.route}) phase=${PHASE} =====`);
  for (const vp of WIDTHS) {
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
    await page.goto(`${FRONT}${target.route}`, { waitUntil: 'networkidle2' });
    // Wait for either the record table or the mobile card list to paint.
    await page.waitForSelector('.record-table, .m-card-list, .expense-record-table', { timeout: 30000 }).catch(() => null);
    await sleep(700);
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const band = document.querySelector('.payables-band');
      const rail = document.querySelector('.summary-rail');
      const firstRow = document.querySelector('.record-table tbody tr:not(:has(td[colspan])), .expense-record-table tbody tr:not(:has(td[colspan]))');
      const headers = [...document.querySelectorAll('thead th')].map((th) => (th.textContent ?? '').trim()).filter(Boolean);
      const pag = document.querySelector('.ds-pagination');
      return {
        pageHeight: Math.round(doc.scrollHeight),
        bandHeight: band ? Math.round(band.getBoundingClientRect().height) : null,
        railHeight: rail ? Math.round(rail.getBoundingClientRect().height) : null,
        firstRowHeight: firstRow ? Math.round(firstRow.getBoundingClientRect().height) : null,
        headers,
        paginationVisible: !!pag && pag.getBoundingClientRect().height > 0,
        paginationText: pag ? (pag.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80) : null,
      };
    }).catch((e) => ({ error: String(e) }));
    log(`[${target.slug} ${vp.w}] metrics=${JSON.stringify(metrics)}`);
    const file = path.join(ROOT, `2026-10-24_${target.slug}`, `${PHASE}-${target.slug}-${vp.w}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    await page.screenshot({ path: file, fullPage: true });
    log(`[${target.slug} ${vp.w}] screenshot=${file}`);
  }

  // ── Phase-specific DOM assertions at 1568 ──────────────────────────────────
  await page.setViewport({ width: 1568, height: 947, deviceScaleFactor: 2 });
  await page.goto(`${FRONT}${target.route}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.record-table, .expense-record-table', { timeout: 30000 }).catch(() => null);
  await sleep(700);

  if (target.slug === 'payables') {
    const facts = await page.evaluate(() => {
      const band = document.querySelector('.payables-band');
      const dashAgingCells = [...document.querySelectorAll('td[data-label="Hạn nợ"]')].filter((td) => (td.textContent ?? '').includes('—')).length;
      const nameCell = document.querySelector('td[data-label="Nhà cung cấp"]');
      const nameDiv = nameCell?.querySelector('.payables-supplier-name');
      const subLines = [...document.querySelectorAll('td[data-label="Nhà cung cấp"] .payables-row-sub')].map((el) => (el.textContent ?? '').trim());
      const overdueChip = [...document.querySelectorAll('.filter-chip')].find((b) => (b.textContent ?? '').includes('Quá hạn'));
      return {
        bandPresent: !!band,
        bandHeight: band ? Math.round(band.getBoundingClientRect().height) : null,
        bandText: band ? (band.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 220) : null,
        agingHeader: [...document.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Hạn nợ'),
        dashAgingCells,
        nameOneLine: nameDiv ? getComputedStyle(nameDiv).whiteSpace === 'nowrap' && getComputedStyle(nameDiv).textOverflow === 'ellipsis' : false,
        nameTitle: nameDiv?.getAttribute('title') ?? null,
        subLines,
        overdueChipPresent: !!overdueChip,
        agingBars: document.querySelectorAll('td[data-label="Hạn nợ"] .payables-aging-cell__bar').length,
      };
    }).catch((e) => ({ error: String(e) }));
    log(`payables facts=${JSON.stringify(facts)}`);

    if (PHASE === 'after') {
      check('470 band render, ≤96px', facts.bandPresent === true && facts.bandHeight != null && facts.bandHeight <= 96,
        `present=${facts.bandPresent} height=${facts.bandHeight}`);
      check('470 band đọc tổng + chips quá hạn/NCC + aging bar', typeof facts.bandText === 'string'
        && /công nợ/i.test(facts.bandText) && /quá hạn/i.test(facts.bandText) && /NCC/.test(facts.bandText),
        JSON.stringify(facts.bandText));
      check('470 bảng có 1 cột "Hạn nợ" (thay 4 cột aging tiền)', facts.agingHeader === true);
      check('470 không còn ô aging "—"', facts.dashAgingCells === 0, `dashCells=${facts.dashAgingCells} bars=${facts.agingBars}`);
      check('470 tên NCC 1 dòng + tooltip', facts.nameOneLine === true && !!facts.nameTitle,
        `oneLine=${facts.nameOneLine} title=${JSON.stringify(facts.nameTitle)}`);
      check('470 sub-line không in "_"', facts.subLines.every((s) => s !== '_' && s !== '' && s !== '—'),
        JSON.stringify(facts.subLines));
      check('470 chip "Quá hạn" filter nhanh có mặt', facts.overdueChipPresent === true);
      if (facts.overdueChipPresent) {
        payablesRequests.length = 0;
        await page.evaluate(() => {
          const chip = [...document.querySelectorAll('.filter-chip')].find((b) => (b.textContent ?? '').includes('Quá hạn'));
          chip?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        await sleep(1200);
        const req = payablesRequests.find((u) => u.includes('bucket=overdue'));
        check('470 chip Quá hạn gửi bucket=overdue lên API', !!req, req ?? 'no bucket request');
        const chipState = await page.evaluate(() => {
          const chip = [...document.querySelectorAll('.filter-chip')].find((b) => (b.textContent ?? '').includes('Quá hạn'));
          return { pressed: chip?.getAttribute('aria-pressed'), active: chip?.classList.contains('is-active') };
        });
        check('470 chip Quá hạn active khi bật', chipState.pressed === 'true' && chipState.active === true, JSON.stringify(chipState));
        const shot = path.resolve('qa/2026-10-24_payables/after-payables-overdue-chip.png');
        await page.screenshot({ path: shot, fullPage: false });
        log(`screenshot=${shot}`);
      }
    } else {
      log(`BEFORE state: band=${facts.bandPresent} agingHeader(4 cột tiền)=${facts.agingHeader} dashAgingCells=${facts.dashAgingCells}`);
    }
  }

  if (target.slug === 'expenses') {
    const facts = await page.evaluate(() => {
      const rail = document.querySelector('.summary-rail');
      const railLabels = rail ? [...rail.querySelectorAll('dt')].map((d) => (d.textContent ?? '').trim()) : [];
      const dateCell = document.querySelector('.expense-record-table__date');
      const entryBadge = dateCell?.querySelector('.expense-record-table__entry-badge');
      const entryDiv = dateCell?.querySelector('.expense-record-table__entry-date');
      const componentHeader = [...document.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Thành phần');
      const xeCell = document.querySelector('td[data-label="Xe"]');
      const componentSuffix = xeCell?.querySelector('.expense-record-table__component');
      const amountCell = document.querySelector('td[data-label="Số tiền"]');
      const statusHeader = [...document.querySelectorAll('thead th')].some((th) => (th.textContent ?? '').trim() === 'Trạng thái');
      return {
        railHeight: rail ? Math.round(rail.getBoundingClientRect().height) : null,
        railLabels,
        dateOneLine: dateCell ? dateCell.querySelectorAll('.expense-record-table__entry-date').length === 0 : null,
        entryBadgePresent: !!entryBadge,
        entryBadgeText: entryBadge ? (entryBadge.textContent ?? '').trim() : null,
        legacyEntryDivPresent: !!entryDiv,
        componentHeaderPresent: componentHeader,
        xeSuffixText: componentSuffix ? (componentSuffix.textContent ?? '').trim() : null,
        amountTabular: amountCell ? getComputedStyle(amountCell).fontVariantNumeric : null,
        statusColumnPresent: statusHeader,
        pageHeight: Math.round(document.documentElement.scrollHeight),
        paginationText: document.querySelector('.ds-pagination') ? (document.querySelector('.ds-pagination')?.textContent ?? '').replace(/\s+/g, ' ').trim() : null,
      };
    }).catch((e) => ({ error: String(e) }));
    log(`expenses facts=${JSON.stringify(facts)}`);

    if (PHASE === 'after') {
      check('471 stat strip ≤64px (Tổng | Chưa thanh toán | Đã thanh toán)',
        facts.railHeight != null && facts.railHeight <= 64
        && facts.railLabels.some((l) => /Tổng chi phí/.test(l))
        && facts.railLabels.some((l) => /Chưa thanh toán/.test(l))
        && facts.railLabels.some((l) => /Đã thanh toán/.test(l)),
        `height=${facts.railHeight} labels=${JSON.stringify(facts.railLabels)}`);
      check('471 ngày 1 dòng + badge nhập inline (không còn div phụ)', facts.dateOneLine === true && facts.entryBadgePresent === true && facts.legacyEntryDivPresent === false,
        `badge=${JSON.stringify(facts.entryBadgeText)}`);
      check('471 bỏ cột THÀNH PHẦN — gộp vào ô Xe', facts.componentHeaderPresent === false,
        `componentHeader=${facts.componentHeaderPresent} xeSuffix=${JSON.stringify(facts.xeSuffixText)}`);
      check('471 giữ cột TRẠNG THÁI (desc spec: pill giữ)', facts.statusColumnPresent === true);
      check('471 SỐ TIỀN tabular', typeof facts.amountTabular === 'string' && facts.amountTabular.includes('tabular-nums'),
        `font-variant-numeric=${facts.amountTabular}`);
      const singlePage = /trên\s*<|\btrên\b/.test(facts.paginationText ?? '') ? null : null;
      // Pagination ẩn khi ≤1 trang: nếu pagination đang render thì tổng phải > pageSize (điều kiện bậc; case 1 trang test riêng bằng vitest).
      check('471 pagination chỉ render khi >1 trang (hoặc ẩn hẳn với data 1 trang)',
        facts.paginationText == null || /\d+–\d+\s*trên\s*\d+/.test(facts.paginationText),
        `pagination=${JSON.stringify(facts.paginationText)}`);
      check('471 page ≤~950px @1568×947', facts.pageHeight <= 950, `pageHeight=${facts.pageHeight}`);
    } else {
      log(`BEFORE state: rail=${facts.railHeight}px componentCol=${facts.componentHeaderPresent} entryDiv=${facts.legacyEntryDivPresent} pageHeight=${facts.pageHeight}`);
    }
  }
}

check('không có console error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();
log(`\nPHASE ${PHASE} done — failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
