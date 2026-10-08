import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141580-costrow-label';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '9e000bf1' });
if (!String(health.buildHash || '').startsWith('9e000bf1')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/ops/wallet', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const scan = await p.evaluate(() => {
    const t = document.body.innerText || '';
    const rows = [...document.querySelectorAll('tbody tr, [class*="row"]')].filter((x) => x.offsetParent !== null && (x.textContent || '').includes('Phí chi hộ khác'));
    const btnInfo = (r) => [...r.querySelectorAll('button')].map((b) => ({ t: (b.textContent || '').trim(), a: b.getAttribute('aria-label') || '', title: b.title || '' })).filter((x) => /Sửa|Xóa/.test(x.t + x.a + x.title));
    const withActions = rows.filter((r) => { const b = btnInfo(r); return b.some((x) => /Sửa/.test(x.t + x.a + x.title)) && b.some((x) => /Xóa/.test(x.t + x.a + x.title)); });
    const otherRaw = (t.match(/\bOTHER\b/g) ?? []).length;
    const chiPhiOther = t.includes('Chi phí: Phí chi hộ khác');
    return { labeledRows: rows.length, withActions: withActions.length, actionSample: rows.length ? btnInfo(rows[0]) : [], otherRaw, chiPhiOther, sample: (rows[0]?.textContent || '').replace(/\s+/g, ' ').slice(0, 140) };
  });
  log('wallet-scan', scan);
  await p.screenshot({ path: QA + '/' + SCOPE + '_wallet.png', fullPage: false });
  const ok = scan.labeledRows > 0 && scan.withActions > 0 && scan.otherRaw === 0;
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
