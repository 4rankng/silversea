// SIL-540 width sweep — find the band where the LỊCH TRÌNH & ĐIỀU XE cell
// clips/overlaps. Measures every schedule cell on the filtered result across
// desktop widths (table band ≥1000px) and the card band (<1000px).
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil540-schedule-cell');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver-sweep.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
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
log('login ok');

const WIDTHS = [1440, 1366, 1280, 1180, 1024, 999, 768, 390];
const report = [];
for (const width of WIDTHS) {
  await page.setViewport({ width, height: 900 });
  await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']", { timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  await sleep(500);
  const m = await page.evaluate(() => {
    const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
    const trigger = td?.querySelector('.cus-inline-trigger');
    if (!trigger) return { found: false };
    const kids = [...trigger.children].map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        cls: String(el.className).slice(0, 40),
        text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 48),
        top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1),
        scrollH: el.scrollHeight, clientH: el.clientHeight,
        scrollW: el.scrollWidth, clientW: el.clientWidth,
        fs: cs.fontSize, lh: cs.lineHeight, ws: cs.whiteSpace, ov: `${cs.overflowX}/${cs.overflowY}`,
      };
    });
    return { found: true, kids };
  });
  let defect = null;
  if (m.found) {
    for (let i = 0; i < m.kids.length; i++) {
      const k = m.kids[i];
      if (k.scrollH > k.clientH + 0.5) defect = defect || []; 
      if (k.scrollH > k.clientH + 0.5) defect.push({ kind: 'vclip', i, ...k });
      const next = m.kids[i + 1];
      if (next && next.top < k.bottom - 0.5) { defect = defect || []; defect.push({ kind: 'overlap', i, withNextTop: next.top, bottom: k.bottom }); }
    }
  }
  await page.screenshot({ path: resolve(OUT, `sweep-${width}.png`) });
  report.push({ width, defect, kids: m.kids });
  log(`width=${width} defect=${JSON.stringify(defect)}`);
}
writeFileSync(resolve(OUT, 'sweep.json'), JSON.stringify(report, null, 2));
log('sweep done');
await browser.close();
