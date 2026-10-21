// R29 re-verify (2026-10-21) — FB-019: driver accept-banner must NOT leak the
// internal TRP code. Staging c643ef1e, driver bqhuong (mobile 390).
// Staging state (probed): trip 228 TRP-202610-0122 RUNNING on truck 15H-117.55
// (bqhuong's own — board will vouch: booking R27E2E-001); NEW cards on the same
// truck: trip 206 (ful 596), 173 (ful 352), 162 (ful 322).
// Repro QA: open a NEW lệnh → "Nhận lệnh vận chuyển" → backend 409 (busy truck,
// message embeds TRP-202610-0122) → banner + toast must name Số Bill/Booking
// (or stay generic) and NEVER render TRP-…
// Usage: node testplan/qa/scripts/2026-10-21-r29-fb019-staging.mjs [tripId]
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.QA_API || 'https://vantai.tingting.vip/api';
const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const OUT = path.resolve('qa/2026-10-21-r29-verify/fb019');
fs.mkdirSync(OUT, { recursive: true });
const TRIP_ID = process.argv[2] || process.env.FB019_TRIP_ID || '206';
const INTERNAL_CODE = /TRP-\d{6}-\d+/;

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const results = [];
let exitCode = 0;
const record = (id, pass, detail) => { results.push({ id, pass, detail }); log('RESULT', { id, pass, detail }); if (!pass) exitCode = 1; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier, password: 'Abc123' }) });
  if (!res.ok) throw new Error(`login ${identifier} -> ${res.status}`);
  return (await res.json()).token;
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log('health', { status: health?.status, build: health?.buildHash });
if (health?.buildHash !== 'c643ef1e' && !process.env.QA_IGNORE_BUILD) { log('ABORT: build mismatch'); process.exit(2); }

const token = await login('bqhuong');
log('login bqhuong ok');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--hide-scrollbars'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  let rejectionBody = null;
  page.on('response', async (res) => {
    if (res.status() === 409 && /\/progress/.test(res.url())) {
      rejectionBody = await res.text().catch(() => null);
      log('net_409', { url: res.url(), body: (rejectionBody ?? '').slice(0, 260) });
    }
  });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/my-trips/${TRIP_ID}`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(3000);
  const st0 = await page.evaluate(() => ({
    url: location.pathname,
    title: document.querySelector('h1, h2')?.textContent?.trim().slice(0, 80) ?? null,
    acceptBtn: Boolean(document.querySelector('button.driver-task-accept-sticky__btn')),
    bodyHasTrp: /TRP-\d{6}-\d+/.test(document.body.innerText),
    bodyTrpMatches: (document.body.innerText.match(/TRP-\d{6}-\d+/g) ?? []).slice(0, 5),
  }));
  log('page_open', st0);
  await page.screenshot({ path: path.join(OUT, '01-before-accept.png'), fullPage: true });
  if (!st0.acceptBtn) { record('accept button present', false, JSON.stringify(st0)); throw new Error('no accept button'); }

  await page.click('button.driver-task-accept-sticky__btn');
  await sleep(2600);
  const st1 = await page.evaluate(() => ({
    banner: document.querySelector('[data-testid="blocking-trip-banner"]')?.textContent?.trim() ?? null,
    toasts: Array.from(document.querySelectorAll('[role="alert"], [role="status"], .toast, [class*="toast"]'))
      .map((el) => el.textContent?.trim()).filter(Boolean).slice(0, 6),
    bannerLink: document.querySelector('[data-testid="blocking-trip-banner"] a')?.textContent?.trim() ?? null,
  }));
  log('after_accept', st1);
  await page.screenshot({ path: path.join(OUT, '02-after-accept-banner.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'dom-after-accept.txt'), JSON.stringify(st1, null, 2));
  fs.writeFileSync(path.join(OUT, 'net-409-body.txt'), rejectionBody ?? 'NO 409 CAPTURED');

  const banner = st1.banner ?? '';
  const toasts = (st1.toasts ?? []).join(' | ');
  record('FB-019: 409 rejected by busy truck (backend still embeds TRP internally — captured)',
    Boolean(rejectionBody) && INTERNAL_CODE.test(rejectionBody ?? ''),
    `body=${(rejectionBody ?? 'none').slice(0, 200)}`);
  record('FB-019: banner renders WITHOUT the internal TRP code',
    Boolean(banner) && !INTERNAL_CODE.test(banner),
    `banner=${banner.slice(0, 200)}`);
  record('FB-019: banner names the blocking trip by Số Bill/Booking (board vouches: R27E2E-001) — or honest generic copy',
    banner.includes('R27E2E-001') || banner.includes('chưa hoàn thành'),
    `banner=${banner.slice(0, 200)} link=${st1.bannerLink}`);
  record('FB-019: toast surface also free of the TRP code',
    toasts.length > 0 ? !INTERNAL_CODE.test(toasts) : true,
    `toasts=${toasts.slice(0, 300)}`);
  record('FB-019: whole driver page contains no TRP code anywhere',
    !st1.bodyHasTrp && !INTERNAL_CODE.test(banner + toasts),
    `pageTrpMatches=${JSON.stringify(st1.bodyTrpMatches)}`);

  await page.close();
} catch (error) {
  record('driver', false, String(error?.stack ?? error));
}
fs.writeFileSync(path.join(OUT, 'ui-driver.log'), JSON.stringify({ results, log: LOG }, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} pass — exit ${exitCode}`);
await browser.close();
process.exit(exitCode);
