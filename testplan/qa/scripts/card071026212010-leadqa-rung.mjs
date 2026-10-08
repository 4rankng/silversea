// Card 071026212010 — lead staging QA on cut 781f746a: all four /finance
// P&L summary cards carry values (non-repro verification of the 21:16 report).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb212010-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '781f746a' });
if (!String(health.buildHash || '').startsWith('781f746a')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const api = await fetch(`${API}/reports/pnl?month=10&year=2026`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
log('api-pnl', { totalRevenue: api.totalRevenue, grossProfit: api.grossProfit, netProfit: api.netProfit, keys: Object.keys(api).length });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const scan = await page.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ');
    const grab = (label, span) => {
      const at = body.indexOf(label);
      return at < 0 ? null : body.slice(at + label.length, at + label.length + span).trim();
    };
    return {
      doanhThu: grab('Tổng doanh thu', 20),
      gop: grab('Lợi nhuận gộp', 20),
      bien: grab('Biên lợi nhuận gộp', 20),
      rong: grab('Lợi nhuận ròng', 20),
    };
  });
  log('cards-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-finance-rail.png`, fullPage: false });
  const hasNum = (s) => Boolean(s && /[0-9]/.test(s));
  if (hasNum(scan.doanhThu) && hasNum(scan.gop) && hasNum(scan.bien) && hasNum(scan.rong)) {
    log('PASS-all-four-cards-populated', scan);
  } else { log('FAIL-empty-card', scan); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
