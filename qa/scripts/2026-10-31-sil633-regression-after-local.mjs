// SIL-633 (id 737) regression tail — AFTER capture on the fixed local build.
// Screenshots + eyebrow line-box metrics at 390/495/1440. Read-only drive.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7177}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const SHOTS = path.resolve('testplan/assets');
fs.mkdirSync(SHOTS, { recursive: true });
const LOG = path.resolve('qa/2026-10-31_sil633-regression_after-local.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const token = (await loginRes.json())?.token;
if (!token) { log('ABORT login'); process.exit(2); }
log('LOGIN ok role=CUS local (fixed build)');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=2'] });

for (const [w, h] of [[390, 844], [495, 828], [1440, 1000]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${FRONT}/shipments`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));

  const m = await page.evaluate(() => {
    const first = document.querySelector('.cus-dashboard-row');
    const trig = first?.querySelector('.cus-inline-trigger');
    const before = trig ? getComputedStyle(trig, '::before') : null;
    const rows = [...document.querySelectorAll('.cus-dashboard-row')];
    let escapes = 0, overlaps = 0;
    for (const row of rows) {
      const ro = row.getBoundingClientRect();
      for (const child of row.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.height > 0 && c.bottom - ro.bottom > 2) { escapes += 1; break; }
      }
    }
    for (let i = 0; i < rows.length - 1; i++) {
      if (rows[i + 1].getBoundingClientRect().top < rows[i].getBoundingClientRect().bottom - 2) overlaps += 1;
    }
    return {
      eyebrow: before ? { fs: before.fontSize, lh: before.lineHeight, fw: before.fontWeight, transform: before.textTransform } : null,
      rows: rows.length, escapes, overlaps,
      rowH: first ? Math.round(first.getBoundingClientRect().height) : null,
    };
  });
  await page.screenshot({ path: path.join(SHOTS, `sil633-regression-after-local-${w}.png`) });
  const okLh = m.eyebrow && parseFloat(m.eyebrow.lh) >= 14.8;
  log(`@${w} eyebrow=${JSON.stringify(m.eyebrow)} lhContainsInk=${okLh} rows=${m.rows} escapes=${m.escapes} overlaps=${m.overlaps} rowH=${m.rowH}`);
  await page.close();
}
await browser.close();
log('DONE');
