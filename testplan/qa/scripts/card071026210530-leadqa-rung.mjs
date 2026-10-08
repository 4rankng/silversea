// Card 071026210530 — lead staging QA on cut 59c628f9: negative RECORDED rows
// in /ops/wallet Lịch sử chi phí carry 'bút toán điều chỉnh (dòng âm)'; positive
// RECORDED rows keep plain 'Đã ghi nhận'.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_kb210530-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '59c628f9' });
if (!String(health.buildHash || '').startsWith('59c628f9')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const scan = await page.evaluate(() => {
    const body = document.body.textContent || '';
    const negs = [...document.querySelectorAll('tr')].filter((tr) => tr.offsetParent !== null && /-\d/.test(tr.textContent || '') && /Lịch sử chi phí|EGLV|Lưu bãi|chi hộ/.test(tr.textContent || ''))
      .map((tr) => (tr.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140));
    const negQualified = negs.filter((t) => t.includes('bút toán điều chỉnh'));
    const posPlain = (body.match(/Đã ghi nhận(?!\s*—)/g) ?? []).length;
    const posQualified = (body.match(/Đã ghi nhận — bút toán điều chỉnh/g) ?? []).length;
    return { negRows: negs.slice(0, 6), negQualifiedCount: negQualified.length, posPlain, posQualified };
  });
  log('wallet-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-wallet-history.png`, fullPage: false });
  if (scan.negQualifiedCount === 0) { log('FAIL-no-negative-row-found-or-unqualified', scan); exitCode = 1; }
  else if (scan.posPlain === 0) { log('FAIL-positive-rows-missing-plain-label', scan); exitCode = 1; }
  else log('PASS-negative-qualified-positive-plain', scan);
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
