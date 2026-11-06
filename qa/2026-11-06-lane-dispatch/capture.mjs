// SIL-685 + SIL-686 UI driver — the §9 evidence run.
// Command: node qa/2026-11-06-lane-dispatch/capture.mjs
// Drives the real pages at 1440/1920 as dieuvan (DISPATCHER), asserts the
// FB-056 one-line toolbar and the FB-063 one-line headers, captures the
// screenshots and the API row identity, writes capture.log.
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync } from 'node:fs';

const OUT = new URL('.', import.meta.url).pathname;
const BASE = 'http://localhost:7175';
mkdirSync(OUT, { recursive: true });
const log = (line) => { console.log(line); appendFileSync(`${OUT}capture.log`, `${line}\n`); };

const assert = (cond, label) => {
  log(`${cond ? 'PASS' : 'FAIL'}  ${label}`);
  if (!cond) process.exitCode = 1;
  return cond;
};

const browser = await puppeteer.launch({ headless: 'new' });
try {
  const page = await browser.newPage();
  const apiCalls = [];
  page.on('response', async (res) => {
    const url = res.request().url();
    if (url.includes('/api/shipments/dispatch-detail-plan-rows') || url.includes('/api/shipments?')) {
      apiCalls.push({ q: url.split('?')[1] ?? '', status: res.status() });
    }
  });

  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2' });
  // The login fields are label-associated (no aria-label attributes); the
  // username box is the first text input, the password box types=password.
  await page.waitForSelector('input', { timeout: 15000 });
  await page.type('input:not([type="password"])', 'dieuvan');
  await page.type('input[type="password"]', 'Abc123');
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"], button:not([type])'),
  ]);
  await page.waitForFunction(() => !location.pathname.startsWith('/login'), { timeout: 30000 });
  log(`login ok → ${await page.evaluate(() => location.pathname)}`);

  const measure = () => page.evaluate(() => {
    const bar = document.querySelector('.filter-bar--card');
    const barRect = bar?.getBoundingClientRect();
    // A toolbar row: bar children whose vertical extents overlap the bar's
    // first item sit on row 1; any child starting below = extra row.
    const tops = [...(bar?.children ?? [])]
      .filter((el) => el.getBoundingClientRect().width > 1)
      .map((el) => el.getBoundingClientRect().top - barRect.top);
    const rowTops = [...new Set(tops.map((t) => Math.round(t / 24)))];
    const ths = [...document.querySelectorAll('.detailed-plan-grid thead th, .ds-table thead th, thead th')];
    const headers = ths.map((th) => ({
      label: th.textContent.trim().slice(0, 30),
      ws: getComputedStyle(th).whiteSpace,
      oneLine: th.clientHeight <= 46 && th.scrollWidth <= th.clientWidth + 1,
    }));
    return {
      path: location.pathname,
      viewport: innerWidth,
      toolbarH: barRect ? Math.round(barRect.height) : null,
      toolbarRows: rowTops.length,
      theadH: Math.round(document.querySelector('thead')?.getBoundingClientRect().height ?? 0),
      headerAllOneLine: headers.every((h) => h.oneLine),
      headersNotNowrap: headers.filter((h) => h.ws !== 'nowrap').map((h) => h.label),
      rowCount: document.querySelectorAll('tbody tr').length,
    };
  });

  for (const width of [1440, 1920]) {
    const height = width === 1440 ? 900 : 1080;
    await page.setViewport({ width, height });
    for (const pathName of ['/dispatch-detail', '/dispatch']) {
      await page.goto(`${BASE}${pathName}`, { waitUntil: 'networkidle2' });
      await new Promise((r) => setTimeout(r, 1800));
      const m = await measure();
      const shot = `${OUT}${pathName === '/dispatch' ? '685-dispatch' : '685-686-detail'}-${width}.png`;
      await page.screenshot({ path: shot });
      log(`shot → ${shot}`);
      assert(m.toolbarRows === 1, `SIL-685 ${pathName}@${width}: toolbar is ONE visual row (h=${m.toolbarH}, rows=${m.toolbarRows})`);
      assert(m.toolbarH >= 44 && m.toolbarH <= 48, `SIL-685 ${pathName}@${width}: toolbar height in the 44–48px band (h=${m.toolbarH})`);
      if (pathName === '/dispatch-detail') {
        assert(m.headerAllOneLine, `SIL-686 /dispatch-detail@${width}: every header one line (thead h=${m.theadH}, non-nowrap: ${JSON.stringify(m.headersNotNowrap)})`);
      }
      log(`info ${pathName}@${width}: rows=${m.rowCount}`);
    }
  }

  // API identity: the detail board's list query answered 200 with the month
  // scope on the default load (read-only persisted state, unchanged).
  const detailCalls = apiCalls.filter((c) => c.q.includes('page=') || c.q === '');
  assert(detailCalls.some((c) => c.status === 200), `API identity: dispatch-detail-plan-rows answered 200 (${detailCalls.length} calls, last q=${detailCalls.at(-1)?.q ?? 'n/a'})`);
  log(`api calls: ${JSON.stringify(detailCalls.slice(-3))}`);

  // SIL-685 functional drive: the folded range still filters. Open `Bộ lọc`
  // on /dispatch-detail@1440, type 05 into the from-day segment, expect the
  // board's first row to move to 05/11 and the list API to carry dateFrom.
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1500));
  const apiCallsBefore = apiCalls.length;
  await page.click('.filter-dropdown__trigger');
  await page.waitForSelector('[role="dialog"] .filter-dropdown__body', { timeout: 5000 });
  assert(true, 'SIL-685 dialog opens from the one-line toolbar');
  const presetInDialog = await page.evaluate(() => document.querySelector('[role="dialog"] .filter-dropdown__presets')?.textContent ?? '');
  assert(presetInDialog.includes('Hôm nay'), 'SIL-685 day scope reachable inside Bộ lọc at the folded width');
  const firstBefore = await page.evaluate(() => document.querySelector('.detailed-plan-grid tbody tr td')?.textContent?.slice(0, 16));
  await page.type('#detailed-plan-date-range', '05');
  await new Promise((r) => setTimeout(r, 2000));
  const firstAfter = await page.evaluate(() => document.querySelector('.detailed-plan-grid tbody tr td')?.textContent?.slice(0, 16));
  const rangeCall = apiCalls.slice(apiCallsBefore).find((c) => c.q.includes('dateFrom=2026-11-05'));
  assert(firstBefore !== firstAfter && (firstAfter ?? '').startsWith('05/11'), `SIL-685 folded range filters the board (first row ${firstBefore} → ${firstAfter})`);
  assert(!!rangeCall, `SIL-685 list API carried the typed range (q=${rangeCall?.q ?? 'MISSING'})`);
  const shot = `${OUT}685-detail-dialog-range-1440.png`;
  await page.screenshot({ path: shot });
  log(`shot → ${shot}`);

} finally {
  await browser.close();
}
log(`exit ${process.exitCode ?? 0}`);
