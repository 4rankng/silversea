// SIL-540 — sweep EVERY row's LỊCH TRÌNH & ĐIỀU XE cell across the real
// unfiltered /shipments pages as dungnv @1440, reporting any row whose
// schedule cell shows a vertical clip or line overlap.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const FE = process.env.QA_BASE_URL || 'http://localhost:7175';
const OUT = resolve(process.cwd(), '../qa/2026-10-28_sil540-schedule-cell');
mkdirSync(OUT, { recursive: true });
const LOG = resolve(OUT, 'ui-driver-allsweep.log');
const log = (line) => { appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`); console.log(line); };
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
await page.type('input[name="username"]', 'dungnv');
await page.type('input[name="password"]', 'Abc123');
await Promise.all([
  page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
  page.click('button[type="submit"]'),
]);
await page.waitForFunction(() => localStorage.getItem('token') || localStorage.getItem('auth_token'), { timeout: 30000 });
log('login ok dungnv (DISPATCHER)');

const findings = [];
for (const url of [
  `${FE}/shipments`,
  `${FE}/shipments?bucket=unassigned`,
  `${FE}/shipments?bucket=plated`,
  `${FE}/shipments?bucket=accounting`,
]) {
  await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.cus-dashboard-table tbody tr', { timeout: 60000 });
  await page.evaluate(() => document.fonts?.ready);
  await sleep(700);
  const res = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('.cus-dashboard-table tbody tr').forEach((tr) => {
      const td = tr.querySelector("td[data-label='Lịch trình & điều xe']");
      const trigger = td?.querySelector('.cus-inline-trigger');
      if (!trigger) return;
      const id = tr.querySelector('th')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 40);
      const kids = [...trigger.children].map((el) => {
        const r = el.getBoundingClientRect();
        return { text: (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 44), top: +r.top.toFixed(1), bottom: +r.bottom.toFixed(1), h: +r.height.toFixed(1), scrollH: el.scrollHeight, clientH: el.clientHeight };
      });
      const defects = [];
      kids.forEach((k, i) => {
        if (k.scrollH > k.clientH + 0.5) defects.push({ kind: 'vclip', i, line: k.text });
        const n = kids[i + 1];
        if (n && n.top < k.bottom - 0.5) defects.push({ kind: 'overlap', i, line: k.text });
      });
      out.push({ id, defects, kids });
    });
    return out;
  });
  for (const row of res) {
    if (row.defects.length) {
      findings.push({ url, row });
      log(`DEFECT ${url} row="${row.id}" ${JSON.stringify(row.defects)} lines=${JSON.stringify(row.kids.map(k => k.text))}`);
    }
  }
  log(`${url} rows=${res.length} clean=${res.filter(r => !r.defects.length).length}`);
}
writeFileSync(resolve(OUT, 'allsweep.json'), JSON.stringify(findings, null, 2));
log(findings.length ? `FOUND ${findings.length} defective rows` : 'no defective rows on real data @1440 dungnv');
await browser.close();
