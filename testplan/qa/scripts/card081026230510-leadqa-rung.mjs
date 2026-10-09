// Card 081026230510 (FB-001) — lead staging QA. One click on the NGÀY GIỜ
// ĐÓNG TRẢ field BODY (dead space outside the segments) opens the combined
// date+time picker; a segment click stays caret-only (owner law 061026172803).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card081026230510-fb001-picker';
const EXPECT = 'e9339ad1';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'thanhdc', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const locate = () => page.evaluate(() => {
    const root = document.querySelector('[data-split-datetime]');
    if (!root) return { err: 'no field root' };
    const r = root.getBoundingClientRect();
    const seg = root.querySelector('input[data-seg], input[class*="date-seg"]');
    const segR = seg?.getBoundingClientRect();
    // dead space = a point inside the root but right of the last segment group
    // dead space = FAR RIGHT of the cell body, right of the whole segment
    // cluster ([HH:mm][DD/MM/YYYY]...body) — root.right minus a small inset
    const deadX = r.right - 8;
    const segX = segR ? segR.x + segR.width / 2 : null;
    return {
      root: { x: Math.round(r.x), w: Math.round(r.width), y: Math.round(r.y + r.height / 2) },
      deadX: Math.round(deadX), segX: segX != null ? Math.round(segX) : null,
      label: seg?.getAttribute('aria-label') || null,
    };
  });

  const rung = async (w) => {
    await page.setViewport({ width: w, height: w <= 500 ? 844 : 900 });
    await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    // bring the field into view before measuring (long create-form at 390)
    await page.evaluate(() => document.querySelector('[data-split-datetime]')?.scrollIntoView({ block: 'center' }));
    await sleep(1200);
    const loc = await locate();
    log('locate', { w, ...loc });
    if (loc.err) return { err: loc.err };

    // portaled picker is position:fixed — offsetParent is ALWAYS null there;
    // judge visibility by rect (non-zero, on-screen)
    const dialogOpen = () => page.evaluate(() =>
      Boolean([...document.querySelectorAll('[role="dialog"]')].find((d) => {
        if (!/Chọn ngày giờ/i.test(d.textContent || '')) return false;
        const r = d.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
      })));

    // PATH A: real pointer click on dead space → picker MUST open
    await page.mouse.move(loc.deadX, loc.root.y);
    await page.mouse.down(); await page.mouse.up();
    await sleep(700);
    const aOpen = await dialogOpen();
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-deadspace-${w}.png` });
    // close via Escape
    await page.keyboard.press('Escape'); await sleep(500);

    // PATH B: real pointer click on a segment → picker MUST NOT open
    let bOpen = null, bFocus = null;
    if (loc.segX != null) {
      await page.mouse.move(loc.segX, loc.root.y);
      await page.mouse.down(); await page.mouse.up();
      await sleep(700);
      bOpen = await dialogOpen();
      bFocus = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.className || null);
      await page.screenshot({ path: `${QA}/${SCOPE}_ui-segment-${w}.png` });
    }
    return { aOpen, bOpen, bFocus };
  };

  const r1440 = await rung(1440);
  log('rung-1440', r1440);
  const r390 = await rung(390);
  log('rung-390', r390);

  const ok = r1440.aOpen === true && r1440.bOpen === false && r390.aOpen === true;
  if (ok) log('PASS-picker-tap-surface', { dead1440: r1440.aOpen, segment1440: r1440.bOpen, dead390: r390.aOpen });
  else { log('FAIL', { r1440, r390 }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
