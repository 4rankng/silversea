// FB-020 (card 171026205400) — UI rung: driver trip detail /my-trips/:id.
// Local stack ports follow the dev-port contract (7175 frontend / 3002 api);
// override via QA_FRONTEND/QA_API env when the contract ports are busy (this
// rung's recorded run used 7276/3093 because the main checkout held 7175/3002
// and a sibling worktree had taken 3092).
// DB 5441 (local dev mirror). Fixture: shipment 123269 / container 54995 /
// fulfillment 53877 / trip 67894 (IMPORT FCL, portless, no free-text drop,
// snapshot deliverySite = LM Võ Cường), driver dvthuc. Read-only drive: the
// page is data-only for this case.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.env.QA_FRONTEND || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = 'qa';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'dvthuc', password: 'Abc123' }),
}).then((r) => r.json());
const token = login.token;
if (!token) throw new Error('dvthuc login failed');

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
page.on('pageerror', (e) => console.log('PAGEERROR', String(e).slice(0, 200)));
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

const log = [];
const step = (name, obj) => { log.push({ at: new Date().toISOString(), step: name, ...obj }); console.log(name, JSON.stringify(obj)); };

await page.goto(`${BASE}/my-trips/67894`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);

// The login token must be live (not bounced to /login).
if (page.url().includes('/login')) throw new Error(`bounced to login: ${page.url()}`);
step('url', { url: page.url() });

// Fact grid rows.
const facts = await page.evaluate(() => Array.from(document.querySelectorAll('.driver-task-fact')).map((el) => ({
  label: el.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? null,
  value: el.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
})));
step('facts', { facts });
const valueOf = (label) => facts.find((f) => f.label === label)?.value ?? null;

const cangHa = valueOf('Cảng hạ');
const diaChi = valueOf('Địa chỉ giao hàng');
step('assert', {
  cangHa,
  diaChi,
  cangHaOk: cangHa === 'LM Võ Cường',
  diaChiOk: diaChi === 'Nhà máy Long Minh - Võ Cường, Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh',
  noEmptyHạ: cangHa !== 'Chưa có cảng hạ',
});

await page.screenshot({ path: `${OUT}/2026-10-17_fb020_ui-1-cang-ha.png`, fullPage: false });
await page.screenshot({ path: `${OUT}/2026-10-17_fb020_ui-2-full.png`, fullPage: true });

fs.writeFileSync(`${OUT}/2026-10-17_fb020_ui-driver.log`, JSON.stringify({ env: { BASE, API, driver: 'dvthuc', trip: 67894 }, log }, null, 2));

if (cangHa !== 'LM Võ Cường') throw new Error(`Cảng hạ wrong: ${cangHa}`);
if (diaChi !== 'Nhà máy Long Minh - Võ Cường, Khu 2, Phường Võ Cường, Tỉnh Bắc Ninh') throw new Error(`Địa chỉ giao hàng wrong: ${diaChi}`);

// ── TC-FB020-002 control: a trip WITH a recorded dropoff port renders the
// two rows ĐÚNG RIÊNG (port under Cảng hạ, factory under Địa chỉ giao
// hàng) — trip 44277, dvthuc, IMPORT, dropoff port 8578 (the FB-082
// fixture, driven 2026-10-12 as well).
await page.goto(`${BASE}/my-trips/44277`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
if (page.url().includes('/login')) throw new Error(`control: bounced to login: ${page.url()}`);
const factsControl = await page.evaluate(() => Array.from(document.querySelectorAll('.driver-task-fact')).map((el) => ({
  label: el.querySelector('.driver-task-fact__label')?.textContent?.trim() ?? null,
  value: el.querySelector('.driver-task-fact__value')?.textContent?.trim() ?? null,
})));
const valueOfControl = (label) => factsControl.find((f) => f.label === label)?.value ?? null;
const cangHa2 = valueOfControl('Cảng hạ');
const diaChi2 = valueOfControl('Địa chỉ giao hàng');
step('control-44277', {
  cangHa: cangHa2,
  diaChi: diaChi2,
  distinct: Boolean(cangHa2 && diaChi2 && cangHa2 !== diaChi2),
});
await page.screenshot({ path: `${OUT}/2026-10-17_fb020_ui-3-control-port.png`, fullPage: false });
fs.writeFileSync(`${OUT}/2026-10-17_fb020_ui-driver.log`, JSON.stringify({ env: { BASE, API, driver: 'dvthuc', trip: 67894, controlTrip: 44277 }, log }, null, 2));
if (!cangHa2 || !diaChi2 || cangHa2 === diaChi2) throw new Error(`control rows not distinct: HA='${cangHa2}' vs DX='${diaChi2}'`);

await browser.close();
console.log('RUNG OK');
process.exit(0);
