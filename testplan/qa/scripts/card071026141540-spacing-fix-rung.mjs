import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141540-spacing-fix';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '1d2297e7' });
if (!String(health.buildHash || '').startsWith('1d2297e7')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/finance', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const scan = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      glued: (t.match(/\d\.?\d{0,3}đ/g) ?? []).slice(0, 8),
      spaced: (t.match(/[\d.]{3,}\s₫/g) ?? []).slice(0, 6),
      hasLegend: t.includes('73.500'),
    };
  });
  log('finance-scan', scan);
  await p.screenshot({ path: QA + '/' + SCOPE + '_finance.png', fullPage: false });
  const ok = scan.glued.length === 0 && scan.spaced.length > 0;
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
