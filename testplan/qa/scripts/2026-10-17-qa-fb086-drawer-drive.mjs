// FB-086 chain + FB-111 + supersede — the /shipments workboard drawer is now
// the ONLY add/remove surface (owner merged 171026182554).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/fb086drawer';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 440)}`); };
let token;
for (let i = 0; i < 4; i++) {
  const r0 = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
  if (r0.ok) { token = (await r0.json()).token; break; }
  await sleep(1500);
}
if (!token) throw new Error('login thanhdc failed after retries');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(5000);
  const fillSeg = async (aria, val) => {
    await page.evaluate((a) => {
      const i = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === a);
      if (!i) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, '');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.focus();
    }, aria);
    await page.keyboard.type(val, { delay: 30 });
    await sleep(150);
  };
  await fillSeg('Ngày — Từ ngày', '15');
  await fillSeg('Tháng — Từ ngày', '10');
  await fillSeg('Năm — Từ ngày', '2026');
  await fillSeg('Ngày — Đến ngày', '25');
  await fillSeg('Tháng — Đến ngày', '10');
  await fillSeg('Năm — Đến ngày', '2026');
  await sleep(2500);
  await page.evaluate(() => {
    const i = [...document.querySelectorAll('input')].find((x) => x.getAttribute('aria-label') === 'Tìm lô hàng');
    i?.focus();
  });
  await page.keyboard.type('KBQA-DET-2', { delay: 40 });
  await sleep(3000);
  // open the lot drawer (Chi tiết / quick dialog on the row)
  const opened = await page.evaluate(() => {
    const tr = [...document.querySelectorAll('tr')].find((r) => /KBQA-DET-2/.test(r.textContent || ''));
    if (!tr) return 'no-row';
    const b = [...tr.querySelectorAll('button')].find((x) => /mở chi tiết lô hàng/i.test(x.getAttribute('aria-label') || '')) ?? [...tr.querySelectorAll('button')].find((x) => /^chi tiết$/i.test((x.textContent || '').trim()));
    if (!b) return 'no-btn';
    b.click();
    return true;
  });
  console.log('drawer opened:', JSON.stringify(opened));
  await sleep(2800);
  const drawer = await page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')][0];
    if (!d) return null;
    return {
      text: (d.textContent || '').slice(0, 200),
      hasAdd: [...d.querySelectorAll('button')].some((b) => /thêm container/i.test(b.textContent || '')),
      lichCont: (d.textContent || '').match(/Lịch cont[^\\n]{0,80}|LỊCH TRÌNH & ĐIỀU XE[^\\n]{0,120}/)?.[0] ?? null,
    };
  });
  await page.screenshot({ path: `${SHOTS}/01-drawer-open.png` });
  record('fb086-drawer-has-add-button', !!drawer && drawer.hasAdd === true, JSON.stringify(drawer)?.slice(0, 380) + ` · ${SHOTS}/01-drawer-open.png`);
  if (drawer?.hasAdd) {
    // add a container: number + type
    await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const b = [...d.querySelectorAll('button')].find((x) => /thêm container/i.test(x.textContent || ''));
      b.click();
    });
    await sleep(1500);
    const filled = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const inputs = [...d.querySelectorAll('input')];
      const num = inputs.find((i) => /số container/i.test(i.placeholder || '') || /số container/i.test(i.getAttribute('aria-label') || ''));
      if (!num) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(num, 'KBQU0006663');
      num.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    await sleep(400);
    // pick loại cont = 20'DC if a select exists; then submit the add
    const addPt = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const btns = [...d.querySelectorAll('button')].filter((b) => /^thêm$/i.test((b.textContent || '').trim()) && !b.disabled);
      if (!btns.length) return null;
      const r = btns[btns.length - 1].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    if (addPt) { await page.mouse.click(addPt.x, addPt.y); }
    await sleep(4000);
    await page.screenshot({ path: `${SHOTS}/02-after-add.png` });
    const after = await page.evaluate(() => {
      const d = [...document.querySelectorAll('[role="dialog"]')][0];
      const t = d ? (d.textContent || '') : '';
      return {
        sched: t.match(/2x20'DC|2x40|2 cont|×2|Lịch cont[^\\n]{0,100}/)?.[0] ?? null,
        contCount: (t.match(/KBQU0006663/g) ?? []).length,
      };
    });
    record('fb086-add-updates-schedule', filled === true && !!after.sched, `filled=${filled} after=${JSON.stringify(after)} · ${SHOTS}/02-after-add.png`);
    // inheritance: read the new row's fields via API
    const inherit = await page.evaluate(async () => {
      const det = await (await fetch('/api/shipments/cus-workspace/875', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } })).json();
      const rows = (det.containers ?? []).map((c) => ({ n: c.containerNumber, route: c.routeId, lift: c.pickupPortId, drop: c.dropoffPortId, appt: c.customerAppointmentAt, type: c.containerTypeId }));
      return rows;
    });
    const src = inherit?.find((c) => c.n === 'KBQU0004444');
    const neo = inherit?.find((c) => c.n === 'KBQU0006663');
    record('fb111-added-cont-inherits', !!src && !!neo && neo.route === src.route && neo.lift === src.lift && neo.drop === src.drop && neo.appt === src.appt,
      `src=${JSON.stringify(src)} new=${JSON.stringify(neo)}`);
  }
  // supersede: /shipments/:id has no Thêm container
  await page.goto(`${BASE}/shipments/875`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(4500);
  const detailAdd = await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /thêm container/i.test((x.textContent || '') + (x.getAttribute('aria-label') || '')));
    return b ? (b.textContent || '').trim() : null;
  });
  await page.screenshot({ path: `${SHOTS}/03-detail-no-add.png` });
  record('supersede-no-add-on-shipments-id', detailAdd === null, `button=${JSON.stringify(detailAdd)} · ${SHOTS}/03-detail-no-add.png`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
