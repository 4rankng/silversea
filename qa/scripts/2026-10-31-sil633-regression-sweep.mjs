// SIL-633 regression — wide-band sweep on staging (read-only).
// Tests 600/700/768/820/999/1024/1280 + every row, stronger detectors:
// child-escapes-owner AND sibling-text-intersection (overlap evidence).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const STG = 'https://vantai.tingting.vip';
const OUT = path.resolve('testplan/assets');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.resolve('qa/2026-10-31_sil633-regression_sweep-staging.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };

const loginRes = await fetch(`${STG}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const token = (await loginRes.json())?.token;
if (!token) { log('ABORT login'); process.exit(2); }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--force-device-scale-factor=2'] });

for (const [w, h] of [[600, 900], [700, 900], [768, 900], [820, 1000], [999, 900], [1024, 900], [1280, 1000]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);
  await page.goto(`${STG}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.cus-dashboard-row', { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 700));

  const report = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.cus-dashboard-row')];
    const issues = [];
    const rectsIntersect = (a, b) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 3
      && Math.min(a.right, b.right) - Math.max(a.left, b.left) > 3;
    for (const owner of rows) {
      const o = owner.getBoundingClientRect();
      for (const child of owner.querySelectorAll('*')) {
        const c = child.getBoundingClientRect();
        if (c.height === 0) continue;
        if (c.bottom - o.bottom > 2) {
          issues.push({ kind: 'escapes-owner', owner: String(owner.className).slice(0, 36), child: `${child.tagName.toLowerCase()}.${String(child.className).slice(0, 40)}`, text: (child.textContent ?? '').trim().slice(0, 30), over: Math.round(c.bottom - o.bottom), ownerH: Math.round(o.height) });
          break;
        }
      }
    }
    // Line-level overlap: any two text-bearing leaf nodes whose rects intersect
    // while not being ancestor/descendant = painted over each other.
    const leaves = [...document.querySelectorAll('.cus-dashboard-row')]
      .flatMap((r) => [...r.querySelectorAll('*')])
      .filter((el) => el.children.length === 0 && (el.textContent ?? '').trim().length > 0);
    let overlaps = 0;
    const overlapSamples = [];
    for (let i = 0; i < leaves.length && overlaps < 6; i++) {
      for (let j = i + 1; j < leaves.length; j++) {
        if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
        if (rectsIntersect(leaves[i].getBoundingClientRect(), leaves[j].getBoundingClientRect())) {
          overlaps += 1;
          overlapSamples.push({ a: (leaves[i].textContent ?? '').trim().slice(0, 22), b: (leaves[j].textContent ?? '').trim().slice(0, 22) });
          break;
        }
      }
    }
    return { rows: rows.length, issues: issues.slice(0, 6), overlaps, overlapSamples };
  });
  await page.screenshot({ path: path.join(OUT, `sil633-regression-sweep-staging-${w}.png`) });
  log(`@${w} rows=${report.rows} escapes=${report.issues.length} textOverlaps=${report.overlaps}`);
  for (const i of report.issues) log(`@${w} ESCAPE ${JSON.stringify(i)}`);
  for (const s of report.overlapSamples) log(`@${w} OVERLAP ${JSON.stringify(s)}`);
  await page.close();
}
await browser.close();
log('DONE');
