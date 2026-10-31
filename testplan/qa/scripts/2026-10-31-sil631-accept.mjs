// SIL-631 driver UI acceptance driver — for EXISTING paired trips (no setup).
// Usage: REUSE via args: node 2026-10-31-sil631-accept.mjs <tripA> <tripB>
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'http://localhost:3002/api';
const FRONT = process.env.QA_BASE || 'http://localhost:7175';
const [TRIP_A, TRIP_B] = process.argv.slice(2, 4).map(Number);
if (!TRIP_A || !TRIP_B) { console.error('usage: node ... <tripA> <tripB>'); process.exit(2); }
const OUT = path.resolve('qa/2026-10-31-sil631-retest');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'sil631-accept.log');
fs.appendFileSync(LOG, `\n=== accept run ${new Date().toISOString()} trips ${TRIP_A}/${TRIP_B} ===\n`);
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
let failures = 0;
const check = (name, ok, detail = '') => { log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) failures += 1; };

const driverLogin = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
if (!driverLogin.ok) throw new Error('driver login failed');
const dToken = (await driverLogin.json()).token;
const authed = { Authorization: `Bearer ${dToken}` };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, dToken);

const acceptOnDetail = async (tripId, tag) => {
  await page.goto(`${FRONT}/my-trips/${tripId}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1500);
  await shot(page, `${tag}-1-detail`);
  let btn = null;
  for (let i = 0; i < 10; i++) {
    btn = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, a'));
      const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/));
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { text: b.textContent } : null;
    });
    if (btn) break;
    await sleep(1000);
  }
  if (!btn) { log(`${tag}: no "Nhận lệnh" button visible`); await shot(page, `${tag}-2-nobtn`); return { clicked: false, blocked: false }; }
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'));
    const b = btns.find((x) => (x.textContent || '').replace(/\s+/g, ' ').trim().match(/^Nhận lệnh/));
    b.click();
  });
  await sleep(3000);
  await shot(page, `${tag}-3-after`);
  const bodyText = await page.evaluate(() => (document.body.textContent || ''));
  const blocked = /Xe đang chạy chuyến/.test(bodyText);
  const trip = await fetch(`${API}/driver/me/trips/${tripId}`, { headers: authed }).then((r) => r.json());
  log(`${tag}: blocked=${blocked} status=${trip.status}`);
  return { clicked: true, blocked, status: trip.status };
};

const resA = await acceptOnDetail(TRIP_A, 'legA');
check('leg A nhận lệnh → Đang chạy (IN_TRANSIT)', resA.clicked && resA.status === 'IN_TRANSIT', `status=${resA.status} blocked=${resA.blocked}`);
const resB = await acceptOnDetail(TRIP_B, 'legB');
check('leg B nhận lệnh KHÔNG bị chặn "Xe đang chạy chuyến" (SIL-631)', resB.clicked && !resB.blocked && resB.status === 'IN_TRANSIT', `status=${resB.status} blocked=${resB.blocked}`);
const tripsFinal = await Promise.all([TRIP_A, TRIP_B].map((id) => fetch(`${API}/driver/me/trips/${id}`, { headers: authed }).then((r) => r.json())));
check('CẢ HAI chuyến đều Đang chạy đồng thời (ruling 602)', tripsFinal.every((t) => t.status === 'IN_TRANSIT'), JSON.stringify(tripsFinal.map((t) => ({ id: t.id, st: t.status }))));

await browser.close();
log(`DONE failures=${failures}`);
process.exit(failures ? 1 : 0);
