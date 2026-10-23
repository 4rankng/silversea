// Review 22/10 HIGH #1 — drawer sibling refresh after tờ khai fan-out.
// Post-fix verification on the /shipments DRAWER surface (the host whose
// applySavedContainerLine patches one line only). LOCAL ONLY 7178 → 3005.
import puppeteer from 'puppeteer';
import { execSync } from 'node:child_process';

const BASE = process.env.BASE ?? 'http://localhost:7178';
const API = `${BASE}/api`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();

let L = null;
for (let i = 0; i < 3 && !L?.token; i++) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
  try { L = await r.json(); } catch { }
  if (!L?.token) await sleep(1000);
}
const T = L.token;
const jf = async (path, opts) => {
  const res = await fetch(`${API}${path}`, opts);
  let body = null; try { body = await res.json(); } catch { }
  return { status: res.status, body };
};
const auth = (e = {}) => ({ Authorization: `Bearer ${T}`, 'Content-Type': 'application/json', ...e });

const boot = (await jf('/catalogs/bootstrap', { headers: auth() })).body;
const customers = (await jf('/customers?limit=5', { headers: auth() })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const stamp = Date.now().toString().slice(-5);
const TK = `HAGHTB296${stamp}`;
const created = await jf('/shipments/quick', { method: 'POST', headers: auth({ 'Idempotency-Key': crypto.randomUUID() }), body: JSON.stringify({
  customerId: cust.id, tradeDirection: 'IMPORT', blNumber: TK,
  containers: [
    { containerNumber: 'MSKU1234565', containerTypeId: ct.id },
    { containerNumber: 'CSQU3054383', containerTypeId: ct.id },
    { containerNumber: '', containerTypeId: ct.id },
  ],
}) });
const sid = created.body.id;
console.log(`fixture lot=${sid} bl=${TK} (2 có số + 1 placeholder)`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), T);
const results = [];
const check = (id, ok, detail = '') => { results.push({ id, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}${detail ? ' :: ' + detail : ''}`); };

await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(1500);
const search = await page.$('input[placeholder*="Tìm"], input[type="search"], input[aria-label*="Tìm"]');
if (search) { await search.click({ clickCount: 3 }); await search.type(TK); await sleep(1600); }
const openBtn = await page.$(`::-p-xpath(//button[starts-with(@aria-label,'Mở chi tiết lô hàng')][contains(@aria-label,'${TK}')])`);
check('drawer open', Boolean(openBtn));
await openBtn.click();
await sleep(2000);
await page.screenshot({ path: '/tmp/tokhai-shots/d1-drawer-open.png' });

// Tờ khai row#1 (MSKU) commit với fan-out → placeholder row#3 phải tự fill TRONG drawer
const triggers = await page.$$('.cus-declaration-trigger');
check('drawer tờ khai triggers', triggers.length === 3, `n=${triggers.length}`);
await triggers[0].click();
await sleep(400);
const inp = await page.$('input[id^="declaration-input-"]');
await page.evaluate((node, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, v);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}, inp, `${TK}-D1`);
await page.keyboard.press('Enter');
await sleep(2800);
await page.screenshot({ path: '/tmp/tokhai-shots/d2-drawer-fanout.png' });
const vals = await page.evaluate(() => [...document.querySelectorAll('.cus-declaration-trigger')].map((b) => b.textContent.trim()));
check('R2 drawer siblings filled in-place', vals[0] === `${TK}-D1` && vals[2] === `${TK}-D1`, vals.join('|'));
const db = psql(`select declaration_number from shipment_containers where shipment_id=${sid} order by id`);
check('R2 DB proof', db.split('\n').filter((v) => v.trim() === `${TK}-D1`).length === 3, db.replace(/\n/g, '|'));

// Row#2 (CSQU) đặt số riêng — divergence; rồi copy từ #1: KHÔNG còn nút copy
const tr2 = await page.$$('.cus-declaration-trigger');
await tr2[1].click();
await sleep(350);
const inp2 = await page.$('input[id^="declaration-input-"]');
await page.evaluate((node, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, v);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}, inp2, `${TK}-D2`);
await page.keyboard.press('Enter');
await sleep(2600);
const tr3 = await page.$$('.cus-declaration-trigger');
await tr3[0].click();
await sleep(350);
const inp3 = await page.$('input[id^="declaration-input-"]');
await page.evaluate((node, v) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(node, v);
  node.dispatchEvent(new Event('input', { bubbles: true }));
}, inp3, `${TK}-D1X`);
await page.keyboard.press('Enter');
await sleep(2800);
await page.screenshot({ path: '/tmp/tokhai-shots/d3-drawer-divergence.png' });
const vals2 = await page.evaluate(() => [...document.querySelectorAll('.cus-declaration-trigger')].map((b) => b.textContent.trim()));
check('R3 drawer divergence kept', vals2[1] === `${TK}-D2`, vals2.join('|'));
// Sau khi mọi ô đã có số: nút Copy biến mất (emptyDeclarationCount stale đã được sửa)
await sleep(400);
const copyButtons = await page.$$('.cus-declaration-copy');
check('R2 copy affordance clears when full', copyButtons.length === 0, `n=${copyButtons.length}`);

import fs from 'node:fs';
fs.copyFileSync('/tmp/tokhai-shots/d1-drawer-open.png', 'qa/2026-10-22-cus-tokhai-cont/ui-drawer-fanout-open.png');
fs.copyFileSync('/tmp/tokhai-shots/d2-drawer-fanout.png', 'qa/2026-10-22-cus-tokhai-cont/ui-drawer-fanout-filled.png');
fs.copyFileSync('/tmp/tokhai-shots/d3-drawer-divergence.png', 'qa/2026-10-22-cus-tokhai-cont/ui-drawer-fanout-divergence.png');
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} drawer checks passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
