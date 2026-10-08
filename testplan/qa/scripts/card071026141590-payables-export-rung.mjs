import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026141590-payables-export';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '649c0b29' });
if (!String(health.buildHash || '').startsWith('649c0b29')) { log('build-currency-FAIL'); process.exit(2); }
const tok = (await (await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }) })).json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), tok);
  await p.goto(BASE + '/payables', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  const spot = await p.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /^Xuất báo cáo$/.test((x.textContent || '').trim()));
    if (!b) return { error: 'NO_BTN', labels: [...document.querySelectorAll('button')].filter((x) => x.offsetParent !== null).map((x) => (x.textContent || '').trim()).filter((t) => /Xuất|xuất/i.test(t)).slice(0, 5) };
    b.scrollIntoView({ block: 'center' });
    const r = b.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (hit && (hit === b || b.contains(hit))) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : { error: 'HIT_MISS', hit: hit ? (hit.textContent || '').trim().slice(0, 24) : null };
  });
  log('export-btn', spot);
  if (spot.error) { log('FAIL-btn'); exitCode = 1; } else {
    await p.mouse.move(spot.x, spot.y); await p.mouse.down(); await p.mouse.up();
    let busySeen = false; let toastSeen = null; let restored = false;
    for (let i = 0; i < 12; i += 1) {
      await sleep(700);
      const st = await p.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && (/Xuất báo cáo|Đang xuất/.test((x.textContent || '').trim())));
        const t = document.body.innerText || '';
        return { btnLabel: btn ? (btn.textContent || '').trim() : null, disabled: btn ? btn.disabled : null, toast: (t.match(/Đã xuất công nợ phải trả[^\n.]*/)|| [])[0] ?? null };
      });
      if (st.btnLabel && st.btnLabel.includes('Đang xuất')) busySeen = true;
      if (st.toast) toastSeen = st.toast;
      if (st.btnLabel === 'Xuất báo cáo' && st.disabled === false && i > 0) { restored = true; log('cycle', st); break; }
      if (i === 11) log('cycle-final', st);
    }
    log('result', { busySeen, toastSeen, restored });
    await p.screenshot({ path: QA + '/' + SCOPE + '_after.png', fullPage: false });
    const ok = restored && Boolean(toastSeen);
    log('verdict', { ok });
    if (!ok) exitCode = 1;
  }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(QA + '/' + SCOPE + '_ui-driver.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await b.close();
  process.exit(exitCode);
}
