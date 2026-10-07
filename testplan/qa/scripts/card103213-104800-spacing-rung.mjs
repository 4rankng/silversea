import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card103213-104800-spacing';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '564c0453' });
if (!String(health.buildHash || '').startsWith('564c0453')) { log('build-currency-FAIL'); process.exit(2); }
const drvTok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }) })).json()).token;
const admTok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const pd = await b.newPage();
  await pd.setViewport({ width: 390, height: 900 });
  await pd.evaluateOnNewDocument((t) => localStorage.setItem('token', t), drvTok);
  await pd.goto(BASE + '/my-trips/96', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const trip = await pd.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      certSpaced: /Chứng từ \d\/\d/.test(t), certGlued: /Chứng từ\d\/\d/.test(t),
      imgSpaced: /Ảnh \d\/\d/.test(t), imgGlued: /Ảnh\d\/\d/.test(t),
      costSpaced: /Chi phí \d\/\d/.test(t), costGlued: /Chi phí\d\/\d/.test(t),
      sample: (t.match(/Chứng từ\s?\d\/\d|Ảnh\s?\d\/\d|Chi phí\s?[\d\/]+/g) ?? []).slice(0, 6),
    };
  });
  log('trip96-header', trip);
  await pd.screenshot({ path: QA + '/' + SCOPE + '_trip96-390.png', fullPage: false });
  await pd.goto(BASE + '/my-penalties', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const pen = await pd.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      glued: (t.match(/VI PHẠM\S|KHẤU TRỪ\S/g) ?? []).slice(0, 4),
      spaced: (t.match(/VI PHẠM [TZ]\d{2}\/\d{4}|KHẤU TRỪ [TZ]\d{2}\/\d{4}/g) ?? []).slice(0, 4),
      hasContent: t.length > 200,
    };
  });
  log('penalties', pen);
  await pd.screenshot({ path: QA + '/' + SCOPE + '_penalties-390.png', fullPage: false });
  await pd.close();
  const pa = await b.newPage();
  await pa.setViewport({ width: 1280, height: 1000 });
  await pa.evaluateOnNewDocument((t) => localStorage.setItem('token', t), admTok);
  await pa.goto(BASE + '/finance', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(6000);
  const fin = await pa.evaluate(() => {
    const t = document.body.innerText || '';
    return {
      chuyenSpaced: /\d\s?chuyến × giá cước chặng/.test(t) && !/\dchuyến ×/.test(t),
      dotSpaced: !/\.[A-ZÀ-Ỹa-z]/.test(t.replace(/\.\s/g, '')) ? null : (/\. [A-ZÀ-Ỹ]/.test(t)),
      gluedScan: (t.match(/\d(chuyến|tháng|cont|kỳ)[^\s\d]/g) ?? []).slice(0, 6),
      hasChuyen: t.includes('chuyến × giá cước chặng'),
    };
  });
  log('finance', fin);
  await pa.screenshot({ path: QA + '/' + SCOPE + '_finance-1280.png', fullPage: false });
  await pa.close();
  const ok = trip.certSpaced && !trip.certGlued && !trip.costGlued && pen.glued.length === 0 && fin.chuyenSpaced === true;
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
