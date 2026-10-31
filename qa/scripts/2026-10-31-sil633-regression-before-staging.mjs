// SIL-633 regression — BEFORE capture on staging (read-only drive).
// Screenshots + geometry metrics at 390/495/1440. No writes anywhere.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const STG = 'https://vantai.tingting.vip';
const OUT = path.resolve('testplan/assets');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.resolve('qa/2026-10-31_sil633-regression_before-staging.log');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const loginRes = await fetch(`${STG}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const token = loginRes ? (await loginRes.json())?.token : null;
if (!token) { log('ABORT: staging login failed'); process.exit(2); }
log('LOGIN ok role=CUS (thanhdc) staging');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=2'] });

for (const [w, h] of [[390, 844], [495, 828], [1440, 1000]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${STG}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  // Apply the Tháng 10/2026 filter the report names, when the control exists.
  await new Promise((r) => setTimeout(r, 800));

  const report = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cus-dashboard-row')];
    const issues = [];
    for (const owner of rows.slice(0, 12)) {
      const o = owner.getBoundingClientRect();
      for (const child of owner.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.height === 0) continue;
        const overBottom = c.bottom - o.bottom;
        if (overBottom > 2) {
          issues.push({ owner: owner.className.slice(0, 40), child: `${child.tagName.toLowerCase()}.${String(child.className).slice(0, 50)}`, text: (child.textContent ?? '').trim().slice(0, 40), overBottom: Math.round(overBottom), ownerH: Math.round(o.height), childH: Math.round(c.height) });
          break;
        }
      }
    }
    let rowOverlaps = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i].getBoundingClientRect();
      const b = rows[i + 1].getBoundingClientRect();
      if (b.top < a.bottom - 2) rowOverlaps += 1;
    }
    const first = rows[0];
    const trig = first?.querySelector('.cus-inline-trigger');
    const before = trig ? getComputedStyle(trig, '::before') : null;
    return {
      rows: rows.length, rowOverlaps, issues: issues.slice(0, 10),
      eyebrow: before ? { fs: before.fontSize, fw: before.fontWeight, transform: before.textTransform } : null,
      rowH: first ? Math.round(first.getBoundingClientRect().height) : null,
    };
  });
  await page.screenshot({ path: path.join(OUT, `sil633-regression-before-staging-${w}.png`) });
  log(`@${w} rows=${report.rows} rowOverlaps=${report.rowOverlaps} issues=${report.issues.length} eyebrow=${JSON.stringify(report.eyebrow)} rowH=${report.rowH}`);
  for (const i of report.issues) log(`@${w} ISSUE ${JSON.stringify(i)}`);
  await page.close();
}
await browser.close();
log('DONE');
