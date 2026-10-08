// Cards 071026210540 + 071026205810 — lead staging QA on cut 9e4e9713.
// A1: hoangnh /ops/wallet — Sổ quỹ Thu/Chi/Số dư cells carry the ₫ suffix.
// A2: bqhuong /my-trips/135 — Cảng nâng row shows the named fallback.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_kb210540-205810-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '9e4e9713' });
if (!String(health.buildHash || '').startsWith('9e4e9713')) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
  const j = await r.json();
  if (!j.token) throw new Error(`login ${id} failed: ${JSON.stringify(j).slice(0, 120)}`);
  return j.token;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  // A1 — wallet ₫ suffix
  {
    const token = await login('hoangnh');
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const scan = await page.evaluate(() => {
      const tables = [...document.querySelectorAll('table')];
      const fund = tables.find((t) => (t.textContent || '').includes('Diễn giải') && (t.textContent || '').includes('Số dư'));
      if (!fund) return { found: false };
      const rows = [...fund.querySelectorAll('tbody tr')];
      const cells = [];
      for (const tr of rows) {
        const tds = [...tr.querySelectorAll('td')];
        // Thu/Chi/Số dư = last three columns
        for (const td of tds.slice(-3)) {
          const txt = (td.textContent || '').trim();
          if (txt) cells.push(txt);
        }
      }
      const bad = cells.filter((c) => /[0-9]/.test(c) && !c.includes('₫'));
      return { found: true, rowCount: rows.length, cellSample: cells.slice(0, 8), moneyCells: cells.length, bad };
    });
    log('A1-wallet-scan', scan);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-wallet.png`, fullPage: false });
    if (!scan.found || scan.rowCount === 0) { log('FAIL-A1-no-fund-table-or-rows'); exitCode = 1; }
    else if (scan.bad.length > 0) { log('FAIL-A1-bare-money-cells', { bad: scan.bad.slice(0, 6) }); exitCode = 1; }
    else log('A1-PASS', { moneyCells: scan.moneyCells, allHaveDong: true });
    await page.close();
  }

  // A2 — trip 135 Cảng nâng fallback
  {
    const token = await login('bqhuong');
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1100 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/my-trips/135`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const scan = await page.evaluate(() => {
      const body = document.body.textContent || '';
      const at = body.indexOf('Cảng nâng');
      const around = at >= 0 ? body.slice(at, at + 60).replace(/\s+/g, ' ') : null;
      const hasHa = body.includes('Cảng hạ');
      return { hasNang: at >= 0, around, hasHa };
    });
    log('A2-trip135-scan', scan);
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-trip135.png`, fullPage: false });
    if (!scan.hasNang || !(scan.around || '').includes('Chưa có cảng nâng')) { log('FAIL-A2-fallback-missing'); exitCode = 1; }
    else log('A2-PASS', { fallback: 'Chưa có cảng nâng' });
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
