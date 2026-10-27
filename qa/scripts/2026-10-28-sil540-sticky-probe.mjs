// SIL-540 sticky-thead occlusion probe — scroll the Q1-177 row partially
// under the pinned thead and screenshot: the reported "first line half-cut,
// touching the second line" is exactly what a half-occluded row looks like
// inside the schedule cell crop.
import puppeteer from 'puppeteer';
import { mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil540-schedule-cell');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver-sticky.log');
const log = (l) => { appendFileSync(LOG, `${new Date().toISOString()} ${l}\n`); console.log(l); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
await page.goto(`${FE}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await page.goto(`${FE}/login`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForSelector('input[name="username"]', { timeout: 45000 });
await page.type('input[name="username"]', 'admin');
await page.type('input[name="password"]', 'Abc123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });

// Unfiltered list (many rows → real scrolling + sticky pin), find Q1-177 by paging search
await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 60000 });
await sleep(500);

// scroll .app-body until the schedule cell's first line sits at the thead edge
const info = await page.evaluate(() => {
  const scroller = document.querySelector('.app-body');
  const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
  const th = document.querySelector('.cus-dashboard-table thead th');
  return { scrollable: scroller?.scrollHeight ?? 0, client: scroller?.clientHeight ?? 0, tdTop: td?.getBoundingClientRect().top, thH: th?.getBoundingClientRect().height };
});
log(`scroll info ${JSON.stringify(info)}`);

for (const dy of [4, 8, 12, 16, 20]) {
  await page.evaluate((d) => {
    const scroller = document.querySelector('.app-body');
    // scroll so the row's first line rises under the pinned header edge
    scroller.scrollTop = 0;
    const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
    const th = document.querySelector('.cus-dashboard-table thead th');
    const target = th.getBoundingClientRect().bottom + d;
    const delta = td.getBoundingClientRect().top - target;
    scroller.scrollTop = delta;
  }, dy);
  await sleep(200);
  await page.screenshot({ path: resolve(OUT, `sticky-scroll-dy${dy}.png`) });
  const m = await page.evaluate(() => {
    const th = document.querySelector('.cus-dashboard-table thead th');
    const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
    const first = td.querySelector('.cus-inline-trigger').children[0];
    const fr = first.getBoundingClientRect();
    return { headerBottom: +th.getBoundingClientRect().bottom.toFixed(1), firstLineTop: +fr.top.toFixed(1), occludedPx: +(th.getBoundingClientRect().bottom - fr.top).toFixed(1) };
  });
  log(`dy=${dy} ${JSON.stringify(m)}`);
}
writeFileSync(resolve(OUT, 'sticky-probe.json'), JSON.stringify({ ok: true }));
log('sticky probe done');
await browser.close();
