// SIL-540 font-fallback probe — if Inter is unavailable (blocked load, older
// cache), Vietnamese stacked diacritics render in a fallback face whose ink
// extents can exceed the 14.85px fractional line box and get top-shaved by
// the FB-043 `overflow: hidden`. This measures the cell with Inter removed.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil540-schedule-cell');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver-fontprobe.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
// Block webfont loads to force the fallback face (headless has no Inter locally anyway).
await page.setRequestInterception(true);
page.on('request', (req) => {
  const url = req.url();
  if (/\.(woff2?|ttf|otf)(\?|$)/i.test(url) || /fonts\.(googleapis|gstatic)\.com/.test(url)) req.abort();
  else req.continue();
});
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

for (const fontFamily of ['default', "'Helvetica Neue', Arial, sans-serif", 'system-ui']) {
  await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']", { timeout: 60000 });
  await sleep(400);
  if (fontFamily !== 'default') {
    await page.evaluate((ff) => {
      const style = document.createElement('style');
      style.textContent = `.cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger { font-family: ${ff} !important; }`;
      document.head.append(style);
    }, fontFamily);
    await sleep(200);
  }
  const m = await page.evaluate(() => {
    const trigger = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger");
    const first = trigger.children[0];
    const r = first.getBoundingClientRect();
    const cs = getComputedStyle(first);
    // Ink extent probe: measure the text's actual bounding box via a Range.
    const range = document.createRange();
    range.selectNodeContents(first);
    const ink = range.getBoundingClientRect();
    return {
      text: first.textContent.slice(0, 40),
      fontFamily: cs.fontFamily.slice(0, 40),
      boxH: +r.height.toFixed(2), boxTop: +r.top.toFixed(2),
      inkTop: +ink.top.toFixed(2), inkBottom: +ink.bottom.toFixed(2), inkH: +ink.height.toFixed(2),
      shavedBy: +(r.top - ink.top).toFixed(2),
      clipped: ink.top < r.top - 0.2 || ink.bottom > r.bottom + 0.2,
      nextTop: trigger.children[1] ? +trigger.children[1].getBoundingClientRect().top.toFixed(2) : null,
      gapToNext: trigger.children[1] ? +(trigger.children[1].getBoundingClientRect().top - r.bottom).toFixed(2) : null,
    };
  });
  log(`font=${fontFamily} → ${JSON.stringify(m)}`);
  const cell = await page.$(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
  await cell.screenshot({ path: resolve(OUT, `fontprobe-${fontFamily.replace(/[^a-z]+/gi, '-').slice(0, 24)}.png`) });
}
log('fontprobe done');
await browser.close();
