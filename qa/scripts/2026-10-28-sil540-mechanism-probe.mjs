// SIL-540 mechanism probe — stress the LỊCH TRÌNH & ĐIỀU XE cell with
// synthetic worst-case states (long text, extra groups, zoom, DPR) and
// record which state reproduces "first line half-clipped / overlapping".
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil540-schedule-cell');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver-probe.log');
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

const measure = () => page.evaluate(() => {
  const td = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']");
  const trigger = td?.querySelector('.cus-inline-trigger');
  if (!trigger) return { found: false };
  const kids = [...trigger.children].map((el) => {
    const r = el.getBoundingClientRect();
    return {
      text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 40),
      top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1),
      scrollH: el.scrollHeight, clientH: el.clientHeight,
    };
  });
  const defects = [];
  kids.forEach((k, i) => {
    if (k.scrollH > k.clientH + 0.5) defects.push({ kind: 'vclip', i, h: k.h, scrollH: k.scrollH });
    const n = kids[i + 1];
    if (n && n.top < k.bottom - 0.5) defects.push({ kind: 'overlap', i });
  });
  return { found: true, kids, defects };
});

const cases = [
  ['baseline', null],
  ['long-factory', () => {
    const el = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger > span");
    el.textContent = '08:00 25/10/2026 · CÔNG TY TNHH CÔNG NGHỆ ASKEY VIỆT NAM XƯỞNG 1 · 2x20DC';
  }],
  ['two-groups', () => {
    const trigger = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger");
    const first = trigger.querySelector(':scope > span');
    const clone = first.cloneNode(true);
    clone.textContent = '14:00 26/10/2026 · ASKEY - XƯỞNG 2 · 1x40HC';
    first.after(clone);
  }],
  ['three-groups', () => {
    const trigger = document.querySelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger");
    const first = trigger.querySelector(':scope > span');
    for (const t of ['14:00 26/10/2026 · ASKEY - XƯỞNG 2 · 1x40HC', '09:00 27/10/2026 · NEWEB - XƯỞNG 3 · 3x20DC']) {
      const clone = first.cloneNode(true);
      clone.textContent = t;
      first.after(clone);
    }
  }],
];

const results = [];
for (const [width, dpr] of [[1440, 1], [1280, 1], [1440, 2], [1280, 2], [1024, 2]]) {
  await page.setViewport({ width, height: 900, deviceScaleFactor: dpr });
  await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe']", { timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  await sleep(400);
  for (const [name, mutate] of cases) {
    await page.waitForSelector(".cus-dashboard-table td[data-label='Lịch trình & điều xe'] .cus-inline-trigger > span", { timeout: 60000 });
    await sleep(300);
    if (mutate) await page.evaluate(mutate);
    const m = await measure();
    results.push({ width, dpr, case: name, defects: m.defects ?? null, kids: m.kids });
    if (m.defects && m.defects.length) {
      log(`DEFECT @${width}/dpr${dpr}/${name}: ${JSON.stringify(m.defects)}`);
      await page.screenshot({ path: resolve(OUT, `probe-${width}-dpr${dpr}-${name}.png`) });
    }
    // reload for next case (clean slate)
    if (mutate) {
      await page.goto(`${FE}/shipments?searchSuffix=Q1-177`, { waitUntil: 'networkidle2', timeout: 60000 });
      await sleep(300);
    }
  }
  log(`width=${width} dpr=${dpr} done`);
}
writeFileSync(resolve(OUT, 'probe.json'), JSON.stringify(results, null, 2));
log('probe done — any defect lines above?');
await browser.close();
