// One-shot instrumented pass for card 061026221826 (diagnostic).
import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const p = await b.newPage();
const reqs = [];
p.on('response', async (res) => { const m = res.request().method(); if (m !== 'GET' && m !== 'OPTIONS') { const t = await res.text().catch(() => ''); reqs.push({ m, s: res.status(), u: res.url().replace(BASE, '').slice(0, 70), b: t.slice(0, 150) }); } });
await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
await p.setViewport({ width: 1920, height: 1100 });
await p.goto(`${BASE}/trips/135/edit`, { waitUntil: 'networkidle2', timeout: 90000 });
await new Promise(r => setTimeout(r, 5000));
const tap = async (pt) => { await p.mouse.move(pt.x, pt.y); await p.mouse.down(); await p.mouse.up(); };
const pt = await p.evaluate(() => { const el = document.getElementById('completedAt'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
await tap(pt);
await new Promise(r => setTimeout(r, 200));
await p.evaluate(() => { const el = document.getElementById('completedAt'); el.focus(); el.select(); });
await p.keyboard.type('03/10/2026', { delay: 70 });
await new Promise(r => setTimeout(r, 500));
const sv = await p.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(x => /^Lưu cập nhật$/.test((x.textContent || '').trim()));
  if (!btn) return null;
  btn.scrollIntoView({ block: 'center' });
  const r = btn.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await tap(sv);
let applied = false;
for (let i = 0; i < 15; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const st = await p.evaluate(() => {
    const btns = [...document.querySelectorAll('button')].filter(x => x.offsetParent !== null);
    const apply = btns.find(x => /Áp dụng/.test(x.textContent || ''));
    const refused = (document.body.textContent || '').includes('không thể trước');
    return { apply: apply ? (() => { const r = apply.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })() : null, refused, url: location.pathname };
  });
  if (st.apply && !applied) { await tap(st.apply); applied = true; }
  if (st.refused || st.url !== '/trips/135/edit') { console.log('FULL' + JSON.stringify({ reqs, finalUrl: st.url, refused: st.refused, applied })); await b.close(); process.exit(0); }
  if (i === 14) { console.log('FULL' + JSON.stringify({ reqs, finalUrl: st.url, refused: st.refused, applied, note: 'still-on-edit-after-15s' })); }
}
await p.screenshot({ path: `${QA}/2026-10-07_kb221826-final-state.png`, fullPage: false });
await b.close();
