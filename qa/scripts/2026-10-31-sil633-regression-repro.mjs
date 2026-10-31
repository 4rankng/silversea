// SIL-633 regression repro — /shipments row-2 clip + next-row overlap.
// QA wave 31/10: the 2nd fact line of each lot row ('Chưa có nhà máy',
// 'Chưa phân xe'…) is cut in half and overlaps the following row.
// This script MEASURES the live page at 390 / 495 / 1440 and reports any
// element whose content box escapes its cell (clip/overlap evidence).
//   node qa/scripts/2026-10-31-sil633-regression-repro.mjs
// Env: FRONT_PORT (7177), API_PORT (3002).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7177}`;
const API = `http://localhost:${process.env.API_PORT ?? 3002}/api`;
const OUT = path.resolve('qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-31_sil633-regression_repro.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const token = loginRes ? (await loginRes.json())?.token : null;
if (!token) { log('ABORT: local login failed'); process.exit(2); }
log('LOGIN ok role=CUS');

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=2'] });

for (const [w, h] of [[390, 844], [495, 828], [1440, 1000]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${FRONT}/shipments?from=2026-10-01&to=2026-10-31`, { waitUntil: 'networkidle2', timeout: 45000 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));

  const report = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cus-dashboard-row')];
    const issues = [];
    const probe = (el, owner) => {
      // A child whose rect escapes the owner's box by > 2px = clipped/overlap.
      const o = owner.getBoundingClientRect();
      for (const child of owner.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.height === 0) continue;
        const overBottom = c.bottom - o.bottom;
        const overTop = o.top - c.top;
        if (overBottom > 2 || overTop > 2) {
          issues.push({
            kind: 'content-escapes-box',
            owner: owner.className.slice(0, 60),
            child: `${child.tagName.toLowerCase()}.${String(child.className).slice(0, 50)}`,
            text: (child.textContent ?? '').trim().slice(0, 40),
            overBottom: Math.round(overBottom), overTop: Math.round(overTop),
            ownerH: Math.round(o.height), childH: Math.round(c.height),
          });
          break; // one report per owner is enough evidence
        }
      }
    };
    // Row vs next-row overlap (cards band) — overlap when rects intersect.
    let rowOverlaps = 0;
    for (let i = 0; i < rows.length - 1; i++) {
      const a = rows[i].getBoundingClientRect();
      const b = rows[i + 1].getBoundingClientRect();
      if (b.top < a.bottom - 2) rowOverlaps += 1;
    }
    const sample = rows.slice(0, 12);
    for (const row of sample) {
      for (const cell of row.querySelectorAll('td, th')) probe(cell, cell);
      const trigger = row.querySelector('.cus-inline-trigger');
      if (trigger) probe(trigger, trigger);
    }
    const first = rows[0];
    const metrics = first ? {
      rowH: Math.round(first.getBoundingClientRect().height),
      rowGapNext: Math.round(rows[1].getBoundingClientRect().top - first.getBoundingClientRect().bottom),
      triggerCount: first.querySelectorAll('.cus-inline-trigger').length,
      multilineDisplay: getComputedStyle(first.querySelector('.cus-multiline-cell') ?? first).display,
      triggerDisplay: getComputedStyle(first.querySelector('.cus-inline-trigger')).display,
      triggerOverflow: getComputedStyle(first.querySelector('.cus-inline-trigger')).overflow,
    } : null;
    return { rows: rows.length, rowOverlaps, issues: issues.slice(0, 20), metrics };
  });

  await page.screenshot({ path: path.join(OUT, `2026-10-31_sil633-regression_${w}.png`) });
  log(`@${w} rows=${report.rows} rowOverlaps=${report.rowOverlaps} issues=${report.issues.length}`);
  log(`@${w} metrics=${JSON.stringify(report.metrics)}`);
  for (const issue of report.issues) log(`@${w} ISSUE ${JSON.stringify(issue)}`);
  await page.close();
}

await browser.close();
log('DONE');
