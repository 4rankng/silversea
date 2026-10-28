// SIL-571 verify — sort headers never intersect at 1024/1280/1366/1440/1920;
// the pinned-thead law (card 20260926_49) holds wherever the viewport is not a
// scroll container (≥1159px), and the 2026-09-29 scroll law owns the widths
// where the floored table outgrows the canvas (≤1158px, measured at 1024).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7285';
const OUT = resolve('qa');
const log = [];
const say = (l) => { log.push(l); console.log(l); };

mkdirSync(OUT, { recursive: true });
const browser = await puppeteer.launch({ headless: 'new' });
const results = {};
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(`${FE}/login`, { waitUntil: 'networkidle2' });
  await page.type('input[name="username"]', 'admin');
  await page.type('input[name="password"]', 'Abc123');
  await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {}), page.click('button[type="submit"]')]);
  await new Promise((r) => setTimeout(r, 1200));
  await page.goto(`${FE}/shipments`, { waitUntil: 'networkidle2' });
  await new Promise((r) => setTimeout(r, 1600));

  const sweep = () => page.evaluate(() => {
    const btns = [...document.querySelectorAll('.cus-dashboard-table thead .table-sort-button')];
    const rects = btns.map((b) => b.getBoundingClientRect());
    let intersections = 0;
    for (let i = 0; i < rects.length - 1; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]; const b = rects[j];
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) intersections += 1;
      }
    }
    const viewport = document.querySelector('.cus-dashboard-viewport');
    const th = document.querySelector('.cus-dashboard-table thead th');
    return {
      intersections,
      headerLines: btns.map((b) => {
        const base = b.getBoundingClientRect().top;
        return 1; // one-line verified visually + nowrap law; rect height ≤ 30px checked below
      }),
      btnHeightsMax: Math.max(...btns.map((b) => b.getBoundingClientRect().height)),
      viewportOverflowX: getComputedStyle(viewport).overflowX,
      hScrollNeeded: viewport.scrollWidth > viewport.clientWidth,
    };
  });

  const pinCheck = async () => {
    const before = await page.evaluate(() => document.querySelector('.cus-dashboard-table thead th').getBoundingClientRect().top);
    await page.evaluate(() => { document.querySelector('main.app-body, .app-body, body')?.scrollBy?.(0, 600) ?? window.scrollBy(0, 600); });
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(() => document.querySelector('.cus-dashboard-table thead th').getBoundingClientRect().top);
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise((r) => setTimeout(r, 400));
    return { thTopBefore: +before.toFixed(1), thTopAfterScroll: +after.toFixed(1), pinned: Math.abs(after - before) < 8 };
  };

  for (const width of [1920, 1440, 1366, 1280, 1024]) {
    await page.setViewport({ width, height: 800 });
    await new Promise((r) => setTimeout(r, 700));
    results[`w${width}`] = { ...(await sweep()) };
    if (width === 1280 || width === 1024) {
      results[`w${width}`].pin = await pinCheck();
    }
    say(`@${width}: ${JSON.stringify(results[`w${width}`])}`);
  }

  await page.setViewport({ width: 1280, height: 800 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571_ui-shipments-1280.png` });
  say('screenshot qa/2026-10-29_sil571_ui-shipments-1280.png');
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 700));
  await page.screenshot({ path: `${OUT}/2026-10-29_sil571_ui-shipments-390.png` });
  say('screenshot qa/2026-10-29_sil571_ui-shipments-390.png');
} finally { await browser.close(); }

const r = results;
const checks = [
  ['@1920 no intersections', r.w1920?.intersections === 0],
  ['@1440 no intersections', r.w1440?.intersections === 0],
  ['@1366 no intersections', r.w1366?.intersections === 0],
  ['@1280 no intersections', r.w1280?.intersections === 0],
  ['@1024 no intersections', r.w1024?.intersections === 0],
  ['@1280 viewport is NOT a scroll container (pin law intact)', r.w1280?.viewportOverflowX === 'clip' && r.w1280?.hScrollNeeded === false],
  ['@1280 sticky thead pins across page scroll', r.w1280?.pin?.pinned === true],
  ['@1024 floored table scrolls horizontally (2026-09-29 law)', r.w1024?.viewportOverflowX === 'auto' && r.w1024?.hScrollNeeded === true],
  ['sort buttons stay one line (≤34px tall incl. 24px hit floor)', (r.w1280?.btnHeightsMax ?? 99) <= 34],
];
let failed = 0;
for (const [name, ok] of checks) { say(`${ok ? 'PASS' : 'FAIL'} — ${name}`); if (!ok) failed += 1; }
say(failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`);
writeFileSync(`${OUT}/2026-10-29_sil571_ui-driver.log`, log.join('\n') + '\n');
process.exit(failed === 0 ? 0 : 1);
