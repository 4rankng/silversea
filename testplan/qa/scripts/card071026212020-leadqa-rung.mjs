// Card 071026212020 — lead staging QA on cut 2032a23d: no migration phrase
// ('Chưa chuyển đổi đầy đủ') anywhere on /finance/treasury; accounts without a
// cutover date show no caption; accounts with one may show 'Chuyển đổi: <time>'.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb212020-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '2032a23d' });
if (!String(health.buildHash || '').startsWith('2032a23d')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance/treasury`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const scan = await page.evaluate(() => {
    const body = document.body.textContent || '';
    const phraseCount = (body.match(/Chưa chuyển đổi/g) ?? []).length;
    const captionCount = (body.match(/Chuyển đổi:/g) ?? []).length;
    // account cells: the treasury table rows
    const rows = [...document.querySelectorAll('tbody tr')].filter((e) => e.offsetParent !== null).length;
    const statusCol = body.includes('Đầy đủ') || body.includes('Một phần') || body.includes('Chưa khả dụng');
    return { phraseCount, captionCount, rows, statusCol };
  });
  log('treasury-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-treasury.png`, fullPage: false });
  if (scan.rows === 0) { log('FAIL-no-rows'); exitCode = 1; }
  else if (scan.phraseCount > 0) { log('FAIL-migration-phrase-present', { phraseCount }); exitCode = 1; }
  else log('PASS-no-migration-phrase', { rows: scan.rows, captionWithCutover: scan.captionCount, statusCol: scan.statusCol });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
