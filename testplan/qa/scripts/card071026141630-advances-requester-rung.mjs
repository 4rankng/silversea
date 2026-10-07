import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141630-advances-requester';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '106a7233' });
if (!String(health.buildHash || '').startsWith('106a7233')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/advances', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const scan = await p.evaluate(() => {
    const text = document.body.innerText || '';
    const byLines = (text.match(/bởi[^\n]{0,60}/g) ?? []).map((x) => x.trim());
    const empty = byLines.filter((x) => /bởi\s*$/.test(x) || /^bởi$/.test(x.trim()));
    return { byCount: byLines.length, samples: byLines.slice(0, 6), emptyCount: empty.length, empty };
  });
  log('advances-scan', scan);
  await p.screenshot({ path: QA + '/' + SCOPE + '_advances.png', fullPage: false });
  const ok = scan.byCount > 0 && scan.emptyCount === 0;
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
