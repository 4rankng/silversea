// Cards 081026091110 + 081026091900 — lead staging QA on cut 22837bc3.
// B1: dispatcher /shipments/405 loads fully (no 'Chưa tải được tài khoản').
// B2: /my-trips/79 — negative TOLL row carries the adjusting-entry qualifier;
//     positive TOLL row stays plain (read-only).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb091110-091900-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '22837bc3' });
if (!String(health.buildHash || '').startsWith('22837bc3')) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => { const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) }); return (await r.json()).token; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // ── B1: dispatcher shipment detail loads ──
  {
    const token = await login('dungnv');
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 80)); });
    await page.setViewport({ width: 1920, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments/405`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(5000);
    const scan = await page.evaluate(() => {
      const body = (document.body.textContent || '').replace(/\s+/g, ' ');
      return {
        authError: body.includes('Chưa tải được tài khoản'),
        hasDetail: body.includes('Chi tiết lô hàng'),
        h1: [...document.querySelectorAll('h1,h2')].map((e) => (e.textContent || '').trim()).filter(Boolean).slice(0, 3),
      };
    });
    log('B1-detail-scan', { ...scan, consoleErrors: consoleErrors.slice(0, 3) });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-b1-shipments-405.png` });
    if (scan.authError || !scan.hasDetail) { log('FAIL-B1'); exitCode = 1; }
    else log('B1-PASS', {});
    await page.close();
  }

  // ── B2: trip 79 toll qualifiers ──
  {
    const token = await login('bqhuong');
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/my-trips/79`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(5000);
    const scan = await page.evaluate(() => {
      const body = (document.body.textContent || '').replace(/\s+/g, ' ');
      const negIdx = body.indexOf('TOLL-30.000');
      const posIdx = body.indexOf('TOLL30.000');
      const negQualified = negIdx >= 0 && body.slice(negIdx, negIdx + 120).includes('bút toán điều chỉnh');
      const posPlain = posIdx >= 0 && !body.slice(posIdx, posIdx + 120).includes('bút toán điều chỉnh');
      return { hasNeg: negIdx >= 0, hasPos: posIdx >= 0, negQualified, posPlain };
    });
    log('B2-toll-scan', scan);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-b2-trip79-toll.png` });
    if (scan.hasNeg && scan.negQualified && scan.posPlain) log('B2-PASS', {});
    else { log('FAIL-B2', scan); exitCode = 1; }
    await page.close();
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
