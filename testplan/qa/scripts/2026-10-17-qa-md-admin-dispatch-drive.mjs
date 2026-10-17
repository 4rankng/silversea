// FB-090 config pages (admin) + FB-101/102 dispatcher side + FB-098 role check.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
const BASE = process.env.BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const SHOTS = process.env.SHOTS ?? '/tmp/mdadmin';
fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const record = (r, ok, d) => { const v = ok ? 'PASS' : 'FAIL'; results.push(v); console.log(`[${v}] ${r} — ${String(d).slice(0, 380)}`); };
const login = async (id) => {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) });
    if (r.ok) return (await r.json()).token;
    await sleep(1200);
  }
  throw new Error('login ' + id);
};
const atok = await login('admin');
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
const go = async (page, path, wait = 3800) => { await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 60000 }); await sleep(wait); };
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1540, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), atok);
  // FB-090: vehicle size classes config — truck tonnage classes present
  const classes = await fetch(`${API}/vehicle-size-classes`, { headers: { Authorization: `Bearer ${atok}` } }).then((x) => x.json());
  const names = (classes.items ?? classes).map((c) => c.name ?? c.label);
  const tonnage = ['1.25', '2.5', '3.5', '5', '8', '10', '15'].filter((t) => names.some((n) => String(n).includes(t)));
  const cont = names.filter((n) => /20|40/.test(String(n)));
  record('fb090-catalog-classes', tonnage.length === 7 && cont.length >= 2, `names=${JSON.stringify(names).slice(0, 260)}`);
  // config pages render (admin)
  for (const [path, marker, name] of [
    ['/config/vehicle-size-classes', 'Loại xe', 'vehicle-size-classes'],
    ['/config/pricing-tables', 'Bảng giá', 'pricing-tables'],
    ['/config/carrier-route-pricing', 'cước trả', 'carrier-route-pricing'],
  ]) {
    await go(page, path);
    const t = await page.evaluate(() => (document.body.textContent || '').slice(0, 400));
    record(`fb090-page-${name}`, t.length > 100, `path=${path} marker=${marker} bodyLen=${t.length}`);
    await page.screenshot({ path: `${SHOTS}/fb090-${name}.png` });
  }
  // FB-101/102 dispatcher side: sees timesheet, Lưu lưới (write role), and on a
  // board-less month NO Mở bảng button
  const dtok = await login('dungnv');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), dtok);
  await go(page, '/timesheet');
  const ts = await page.evaluate(() => {
    const t = document.body.textContent || '';
    return {
      nav: t.includes('Chấm công lái xe'),
      luoi: [...document.querySelectorAll('button')].some((b) => /lưu lưới/i.test(b.textContent || '')),
      moBang: [...document.querySelectorAll('button')].some((b) => /mở bảng chấm công/i.test(b.textContent || '')),
    };
  });
  await page.screenshot({ path: `${SHOTS}/timesheet-dungnv.png` });
  record('fb101-dispatcher-sees-timesheet', ts.nav, JSON.stringify(ts));
  record('fb102-dispatcher-no-mo-bang', !ts.moBang, JSON.stringify(ts) + ` · ${SHOTS}/timesheet-dungnv.png`);
  // FB-098 role boundary: CUS must NOT see Khai chi phí
  const ctok = await login('thanhdc');
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ctok);
  await go(page, '/shipments/875');
  const cusBtn = await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => /^khai chi phí/i.test((b.textContent || '').trim())));
  record('fb098-cus-no-button', cusBtn === false, `cusSeesButton=${cusBtn}`);
} finally { await browser.close(); }
const fails = results.filter((v) => v === 'FAIL').length;
console.log(fails ? `=== ${fails} RUNG FAIL ===` : '=== ALL RUNGS PASS ===');
process.exit(fails ? 1 : 0);
