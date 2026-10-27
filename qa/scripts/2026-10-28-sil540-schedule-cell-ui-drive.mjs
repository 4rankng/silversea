// SIL-540 UI drive — /shipments LỊCH TRÌNH & ĐIỀU XE cell on lot Q1-177.
//
// Contract (board id 606): the cell's FIRST line ("08:00 25/10/2026 · ASKEY…")
// renders only the bottom half of its glyphs and touches/overlaps the second
// line ("Toàn bộ chờ phân xe"). Expected: both lines fully visible, no overlap.
//
// This script drives the real page, screenshots the cell before/after the fix
// (pass QA_EXPECT=after to switch the artifact suffix) and records geometry
// measurements (rects + computed styles + scroll/client extents) that prove
// whether the first line is clipped/overlapping.
//
// Usage: cd frontend && node ../qa/scripts/2026-10-28-sil540-schedule-cell-ui-drive.mjs
// Output: qa/2026-10-28_sil540-schedule-cell/*.{png,json} + ui-driver.log

import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const PHASE = process.env.QA_EXPECT || 'before';
const OUT = resolve(process.cwd(), `../qa/2026-10-28_sil540-schedule-cell`);
const LOG = resolve(OUT, `ui-driver-${PHASE}.log`);
mkdirSync(OUT, { recursive: true });
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };

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
  await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
  return page;
}

const result = { phase: PHASE, viewport: '1440x900', role: 'ADMIN (admin)', lot: 'Q1-177 (shipment id 196)', checks: [] };
const check = (name, pass, detail) => { result.checks.push({ name, pass, detail }); if (!pass) result.failed = true; log(`${pass ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`); };

const page = await login('admin', 'Abc123');
log('login ok user=admin (ADMIN)');

await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']", { timeout: 60000 });
await page.evaluate(() => document.fonts?.ready);
await sleep(800);

const shot = (name) => `qa/2026-10-28_sil540-schedule-cell/${PHASE}-${name}.png`;

// Full page context
await page.screenshot({ path: resolve(OUT, `${PHASE}-page.png`), fullPage: false });
log(`screenshot ${shot('page')}`);

const geometry = await page.evaluate(() => {
  const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
  if (!td) return { found: false };
  const trigger = td.querySelector('.cus-inline-trigger');
  const row = td.closest('tr');
  const triggerStyle = getComputedStyle(trigger);
  const children = [...trigger.children].map((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className,
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      rect: { top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), height: +r.height.toFixed(1), width: +r.width.toFixed(1) },
      fontSize: cs.fontSize,
      lineHeight: cs.lineHeight,
      whiteSpace: cs.whiteSpace,
      overflow: cs.overflow,
      overflowX: cs.overflowX,
      overflowY: cs.overflowY,
      textOverflow: cs.textOverflow,
      clipPath: cs.clipPath,
      scrollW: el.scrollWidth,
      clientW: el.clientWidth,
      scrollH: el.scrollHeight,
      clientH: el.clientHeight,
    };
  });
  const tRect = trigger.getBoundingClientRect();
  const tdStyle = getComputedStyle(td);
  return {
    found: true,
    tdRect: (() => { const r = td.getBoundingClientRect(); return { top: +r.top.toFixed(1), height: +r.height.toFixed(1), width: +r.width.toFixed(1) }; })(),
    tdPadding: tdStyle.padding,
    tdOverflow: tdStyle.overflow,
    triggerRect: { top: +tRect.top.toFixed(1), bottom: +tRect.bottom.toFixed(1), height: +tRect.height.toFixed(1), width: +tRect.width.toFixed(1) },
    triggerStyle: {
      display: triggerStyle.display, height: triggerStyle.height, minHeight: triggerStyle.minHeight,
      lineHeight: triggerStyle.lineHeight, fontSize: triggerStyle.fontSize,
      gridAutoRows: triggerStyle.gridAutoRows, gridTemplateRows: triggerStyle.gridTemplateRows,
      alignContent: triggerStyle.alignContent, alignItems: triggerStyle.alignItems, gap: triggerStyle.gap,
      overflow: triggerStyle.overflow, padding: triggerStyle.padding,
    },
    rowHeight: row.getBoundingClientRect().height,
    children,
  };
});

if (!geometry.found) {
  check('schedule cell found on /shipments for Q1-177', false, { reason: 'cell missing' });
} else {
  check('schedule cell found on /shipments for Q1-177', true, { trigger: geometry.triggerRect });
  log('geometry ' + JSON.stringify(geometry, null, 1));

  // Overlap / clipping assertions from measured geometry.
  const first = geometry.children[0];
  const rest = geometry.children.slice(1);
  check('first line text is the appointment line', /08:00|25\/10/.test(first?.text ?? ''), first?.text);
  const overlaps = rest.filter((c) => c.rect.top < first.rect.bottom - 0.5);
  check('first line does not overlap the next line', overlaps.length === 0, { firstBottom: first.rect.bottom, overlapping: overlaps.map((c) => ({ cls: c.cls, top: c.rect.top })) });

  // A line box shorter than its content height = clipped glyphs.
  check('first line box tall enough for its glyphs (no vertical clip)', first.rect.height >= first.scrollH - 0.5 && first.clientH >= first.scrollH - 0.5, { rectH: first.rect.height, scrollH: first.scrollH, clientH: first.clientH });

  // Screenshot of the row + cell for the visual record.
  const row = await page.$(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
  await row.screenshot({ path: resolve(OUT, `${PHASE}-cell.png`) });
  const rowHandle = await page.$(".cus-dashboard-table tbody tr");
  await rowHandle.screenshot({ path: resolve(OUT, `${PHASE}-row.png`) });
  log(`screenshots ${shot('cell')} + ${shot('row')}`);
}

writeFileSync(resolve(OUT, `assertions-${PHASE}.json`), JSON.stringify(result, null, 2));
log(`EXIT=${result.failed ? 1 : 0}`);
await browser.close();
process.exit(result.failed ? 1 : 0);
