// SIL-604 (id 707) — mode band card height probe — rung 3 measurement (§9).
// QA retest 30/10 (build fad9bdf6): at 1307px the band-1 card measured 83px
// (AC 56–72px; inner row 59px in range — the overage is the 12px card
// padding), and at 390px the stacked card measured 171px.
// Measures `#shipment-section-mode` and its rows at 1307 and 390 on the
// house contract server (fe :7175 / be :3002 — card 20260928_192; override
// with QA_BASE/QA_API).
// Artifacts: qa/2026-10-30_sil604_band-1307.png / _band-390.png
//            qa/2026-10-30_sil604_band-measure.log
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require2 = createRequire(import.meta.dirname + '/../../../package.json');
const puppeteer = require2('puppeteer-core');

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa');
fs.mkdirSync(OUT, { recursive: true });
const LOG_PATH = path.join(OUT, '2026-10-30_sil604_band-measure.log');
const LOG = [];
let exitCode = 0;
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};

(async () => {
  log('start', { base: BASE, api: API });
  let browser;
  try {
    const loginRes = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier: 'dieuvan', password: 'Abc123' }),
    });
    const token = (await loginRes.json().catch(() => ({}))).token;
    if (!token) { log('login', { verdict: 'FAIL', status: loginRes.status }); throw new Error('no token'); }
    log('login', { verdict: 'PASS' });

    browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.QA_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox'],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((t) => { localStorage.setItem('token', t); }, token);

    const measure = () => page.evaluate(() => {
      const band = document.querySelector('#shipment-section-mode');
      const cs = band ? getComputedStyle(band) : null;
      const row = band?.querySelector('.csc-mode-band__row');
      const legend = band?.querySelector('.csc-mode legend');
      return {
        cardHeight: band ? Math.round(band.getBoundingClientRect().height) : null,
        padding: cs ? `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}` : null,
        rowHeight: row ? Math.round(row.getBoundingClientRect().height) : null,
        legendHeight: legend ? Math.round(legend.getBoundingClientRect().height) : null,
      };
    });

    // 1307×~800 — the QA repro width.
    await page.setViewport({ width: 1307, height: 800 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 1500));
    const m1307 = await measure();
    log('measure-1307', { verdict: 'PASS', ...m1307 });
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil604_band-1307.png') });

    // 390×844 — the stacked phone record.
    await page.setViewport({ width: 390, height: 844 });
    await new Promise((r) => setTimeout(r, 600));
    const m390 = await measure();
    log('measure-390', { verdict: 'PASS', ...m390 });
    await page.screenshot({ path: path.join(OUT, '2026-10-30_sil604_band-390.png') });

    const ac = m1307.cardHeight >= 56 && m1307.cardHeight <= 72;
    log('AC-1307-56-72', { verdict: ac ? 'PASS' : 'FAIL', cardHeight: m1307.cardHeight });
    if (!ac) exitCode = 1;
  } catch (err) {
    log('fatal', { verdict: 'FAIL', message: String(err) });
    exitCode = 1;
  } finally {
    await browser?.close();
  }
  fs.writeFileSync(LOG_PATH, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  log('done', { exitCode });
  process.exit(exitCode);
})();
