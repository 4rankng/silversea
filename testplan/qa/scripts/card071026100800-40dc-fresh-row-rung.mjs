import puppeteer from 'puppeteer';
const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-07_card071026100800-40dc-fresh-row';
const LOG = [];
const log = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const health = await fetch(API + '/health').then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: '564c0453' });
if (!String(health.buildHash || '').startsWith('564c0453')) { log('build-currency-FAIL'); process.exit(2); }
const login = await fetch(API + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const token = (await login.json()).token;
const b = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const p = await b.newPage();
  await p.setViewport({ width: 1440, height: 1000 });
  await p.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await p.goto(BASE + '/shipments/new', { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  // Row 1 type: react-aria combobox — focus, type filter, ArrowDown, Enter.
  const combo = await p.evaluate(() => {
    const el = document.querySelector('input[aria-label="Loại container"]');
    if (!el || el.offsetParent === null) return null;
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (!combo) { log('FAIL-no-combo'); process.exit(1); }
  await p.mouse.move(combo.x, combo.y); await p.mouse.down(); await p.mouse.up();
  await sleep(300);
  await p.evaluate(() => { document.querySelector('input[aria-label="Loại container"]')?.focus(); });
  await p.keyboard.type('40DC', { delay: 70 });
  await sleep(900);
  await p.keyboard.press('ArrowDown');
  await sleep(250);
  await p.keyboard.press('Enter');
  await sleep(500);
  const row1 = await p.evaluate(() => {
    const c = document.querySelector('input[aria-label="Loại container"]');
    const n = [...document.querySelectorAll('input')].find((x) => x.offsetParent !== null && /TCKU|Số container/i.test((x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || '')));
    return { comboVal: c?.value ?? null, numVal: n?.value ?? null };
  });
  log('row1', row1);
  // Row 1 number: real typing.
  const num = await p.evaluate(() => {
    const n = [...document.querySelectorAll('input')].find((x) => x.offsetParent !== null && /TCKU|Số container/i.test((x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || '')));
    if (!n) return null; n.scrollIntoView({ block: 'center' });
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (num) { await p.mouse.move(num.x, num.y); await p.mouse.down(); await p.mouse.up(); await sleep(200);
    await p.evaluate(() => { const n = [...document.querySelectorAll('input')].find((x) => x.offsetParent !== null && /TCKU|Số container/i.test((x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || ''))); n?.focus(); n?.select?.(); });
    await p.keyboard.type('QATU1008005', { delay: 60 });
  }
  await sleep(400);
  // Tap 'Thêm container'.
  const addBtn = await p.evaluate(() => {
    const bx = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && /^Thêm container$/.test((x.textContent || '').trim()));
    if (!bx) return null; bx.scrollIntoView({ block: 'center' });
    const r = bx.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return (hit && (hit === bx || bx.contains(hit))) ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null;
  });
  if (!addBtn) { log('FAIL-add-btn'); process.exit(1); }
  await p.mouse.move(addBtn.x, addBtn.y); await p.mouse.down(); await p.mouse.up();
  await sleep(1500);
  const st = await p.evaluate(() => {
    const combos = [...document.querySelectorAll('input[aria-label="Loại container"]')].filter((x) => x.offsetParent !== null);
    const nums = [...document.querySelectorAll('input')].filter((x) => x.offsetParent !== null && /TCKU|Số container/i.test((x.placeholder || '') + ' ' + (x.getAttribute('aria-label') || '')));
    return { comboVals: combos.map((c) => c.value), numVals: nums.map((n) => n.value) };
  });
  log('after-add', st);
  await p.screenshot({ path: QA + '/' + SCOPE + '_new-row.png', fullPage: false });
  const ok = st.comboVals.length >= 2 && /40DC/.test(st.comboVals[0] ?? '') && (st.comboVals[1] ?? 'x') === '' && (st.numVals[1] ?? 'x') === '';
  log('verdict', { ok });
  if (!ok) exitCode = 1;
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  const fs = await import('node:fs');
  fs.writeFileSync(QA + '/' + SCOPE + '_ui-driver.log', LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await b.close();
  process.exit(exitCode);
}
