import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141650-currency-unit';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '49be9523' });
if (!String(health.buildHash || '').startsWith('49be9523')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/customers', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const scan = await p.evaluate(() => {
    const t = document.body.innerText || '';
    const row = [...document.querySelectorAll('tbody tr')].find((x) => (x.textContent || '').includes('LONG MINH'));
    const doubled = (t.match(/\d\s?(?:tr|tỷ|k)\s?₫/g) ?? []).slice(0, 6);
    const thuCell = row ? ((row.textContent || '').match(/Thu[^\n]{0,30}/) ?? [null])[0] : null;
    return { longMinhFound: Boolean(row), thuCell, doubled, traZero: /Trả 0 ₫/.test(t) };
  });
  log('customers-scan', scan);
  await p.screenshot({ path: QA + '/' + SCOPE + '_customers.png', fullPage: false });
  const ok = scan.longMinhFound && scan.doubled.length === 0 && /Thu 19 tr(?!\s*₫)/.test(scan.thuCell ?? '') && scan.traZero;
  log('verdict', { ok });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(QA + '/' + SCOPE + '_ui-driver.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await b.close();
  process.exit(exitCode);
}
