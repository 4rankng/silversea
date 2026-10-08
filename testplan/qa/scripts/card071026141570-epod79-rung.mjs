import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141570-epod79';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '1e319334' });
if (!String(health.buildHash || '').startsWith('1e319334')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 390, height: 900 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/my-trips/79/pod', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const st = await p.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      hardError: t.includes('Không tải được chuyến'),
      emptyState: t.includes('Chưa có tệp nào') || t.includes('chưa có chứng từ') || t.includes('Chưa có tệp'),
      guard: t.includes('Không thể xác định chuyến đi'),
      tripStatus: (t.match(/Mới tạo|Chưa hoàn thành|CREATED/) ?? [])[0] ?? null,
      sample: t.replace(/\s+/g, ' ').slice(0, 220),
    };
  });
  log('pod79', st);
  await p.screenshot({ path: QA + '/' + SCOPE + '_pod-390.png', fullPage: false });
  const ok = st.hardError === false && (st.emptyState === true || st.guard === true);
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
