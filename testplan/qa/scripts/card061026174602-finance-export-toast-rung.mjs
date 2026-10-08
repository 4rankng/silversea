// Card 061026174602 — staging rung: /finance "Xuất Excel" must show a busy
// label while the workbook builds (AC1, best-effort live — build is fast),
// a success toast 'Đã xuất Báo cáo lãi lỗ ra tệp Excel.' (AC2), and fire NO
// mutation requests (read-only surface: client-side xlsx build). Error toast
// (AC3) is unit-pinned, not live-injectable here. Real mouse taps only
// (move → down → up at hit-tested coordinates); width matrix
// 1280/1440/1920/2560, idle + toast full-page shots per width.
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-06_finance-export-ui';
const EXPECT_BUILD = 'ed4637f7';
const DL_DIR = '/tmp/finance-export-dl';
const SUCCESS_TOAST = 'Đã xuất Báo cáo lãi lỗ ra tệp Excel.';
const WIDTHS = [1280, 1440, 1920, 2560];

const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Build-currency check: score nothing on a stale build.
const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, status: health.status, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) {
  log('build-currency-FAIL', { serving: health.buildHash });
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, JSON.stringify(LOG, null, 1));
  process.exit(2);
}

// Accountant login (staging roster account).
const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoapt', password: 'Abc123' }),
});
if (!login.ok) throw new Error(`hoapt login ${login.status}`);
const loginJson = await login.json();
const token = loginJson.token ?? loginJson.accessToken;
log('login-hoapt', { ok: true, role: 'ACCOUNTANT' });

mkdirSync(QA, { recursive: true });
mkdirSync(DL_DIR, { recursive: true });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let exitCode = 0;
try {
  const page = await browser.newPage();
  const mutations = [];
  page.on('request', (req) => {
    const m = req.method();
    if (!['GET', 'OPTIONS', 'HEAD'].includes(m)) mutations.push(`${m} ${req.url()}`);
  });
  const cdp = await page.createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR, eventsEnabled: true });
  const downloads = [];
  cdp.on('Browser.downloadWillBegin', (e) => { downloads.push(e.suggestedFilename); log('download-begin', { name: e.suggestedFilename }); });

  await page.setViewport({ width: 1920, height: 1000 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/finance`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);

  const screenProbe = await page.evaluate(() => ({
    url: location.href,
    hasExport: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Xuất Excel')),
    heading: (document.querySelector('h1,h2')?.textContent || '').trim().slice(0, 80),
  }));
  log('screen', screenProbe);
  if (!screenProbe.hasExport) { log('FAIL-no-export-button'); exitCode = 1; }

  const measure = () => page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes('Xuất Excel'));
    if (!btn) return { missing: true };
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { missing: true };
    const mid = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    const hit = document.elementFromPoint(mid.x, mid.y);
    return {
      x: mid.x, y: mid.y, text: (btn.textContent || '').trim(), disabled: btn.disabled,
      hitOk: !!hit && (hit === btn || btn.contains(hit)),
      inViewport: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth,
    };
  });

  const tapExport = async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const t = await measure();
      if (t.missing) { log('measure-missing', { attempt }); await sleep(700); continue; }
      if (!t.inViewport) { await page.mouse.wheel({ deltaY: 300 }); await sleep(700); continue; }
      if (!t.hitOk) { log('hit-test-fail', { attempt, t }); await sleep(500); continue; }
      await page.mouse.move(t.x, t.y);
      await page.mouse.down();
      await page.mouse.up();
      // Busy-label probe: the client-side build starts on click (after up) —
      // tight-poll for the locked label while the workbook builds.
      const busyT0 = Date.now();
      let busySeen = false;
      while (Date.now() - busyT0 < 1500) {
        if (await page.evaluate(() => [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('Đang xuất')))) { busySeen = true; break; }
      }
      log('tap', { ...t, busySeen });
      return { ...t, busySeen };
    }
    return null;
  };

  const waitToast = async (text, timeoutMs = 15000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      const found = await page.evaluate((txt) => {
        const el = [...document.querySelectorAll('body *')].find((n) => n.children.length === 0 && (n.textContent || '').trim() === txt);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const root = el.closest('[role="status"],[role="alert"],[class*="toast" i],[data-sonner-toast]');
        return { text: (el.textContent || '').trim(), x: Math.round(r.x), y: Math.round(r.y), role: root?.getAttribute?.('role') ?? null };
      }, text);
      if (found) return found;
      await sleep(80);
    }
    return null;
  };

  const fullPageShot = async (name) => {
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const path = `${QA}/${SCOPE}_${name}.png`;
    if (h > 12000) { await page.screenshot({ path }); log('shot-viewport-capped', { name, scrollHeight: h }); return; }
    await page.screenshot({ path, fullPage: true });
    log('shot', { name, scrollHeight: h });
  };

  const results = [];
  for (const w of WIDTHS) {
    await page.setViewport({ width: w, height: 1000 });
    await sleep(1200);
    await fullPageShot(`idle-${w}`);
    const tap = await tapExport();
    if (!tap) { log('FAIL-tap', { width: w }); results.push({ w, toast: null }); exitCode = 1; break; }
    const toast = await waitToast(SUCCESS_TOAST);
    log('toast', { width: w, ...toast });
    await fullPageShot(`toast-${w}`);
    results.push({ w, toast: !!toast, busySeen: tap.busySeen, buttonWasLocked: tap.disabled });
    if (!toast) { log('FAIL-no-toast', { width: w }); exitCode = 1; break; }
    await sleep(600); // let the toast dismiss before the next width
  }

  // Read-only surface proof: no mutation request fired during the whole rung.
  log('mutations', { count: mutations.length, items: mutations.slice(0, 10) });
  if (mutations.length > 0) { log('FAIL-mutations-fired'); exitCode = 1; }
  const dlFiles = readdirSync(DL_DIR);
  log('downloads', { events: downloads, filesOnDisk: dlFiles });

  log('summary', { results, successToasts: results.filter((r) => r.toast).length, busySeenAny: results.some((r) => r.busySeen) });
} catch (err) {
  log('driver-error', { message: String(err && err.message || err) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, JSON.stringify(LOG, null, 1));
  await browser.close();
  process.exit(exitCode);
}
