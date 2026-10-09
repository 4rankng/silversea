// Card 091026091500 (FB-001 round 2) — lead staging QA. NEW owner contract
// for the combinedPicker host: a real click on the SEGMENT input of the
// NGÀY GIỜ ĐÓNG TRẢ field opens the combined picker; typing keeps caret
// editing (auto-advance); double-click still yields exactly one dialog.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card091026091500-fb001r2-picker';
const EXPECT = 'fba9f508';
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
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);

  const locate = () => page.evaluate(() => {
    const root = document.querySelector('[data-split-datetime]');
    if (!root) return { err: 'no field' };
    const seg = root.querySelector('input[data-seg], input[class*="date-seg"]');
    if (!seg) return { err: 'no segment' };
    const segR = seg.getBoundingClientRect();
    const rootR = root.getBoundingClientRect();
    return {
      segX: Math.round(segR.x + segR.width / 2), y: Math.round(segR.y + segR.height / 2),
      rootW: Math.round(rootR.width),
    };
  });
  await page.evaluate(() => document.querySelector('[data-split-datetime]')?.scrollIntoView({ block: 'center' }));
  await sleep(1200);
  const loc = await locate();
  log('locate', loc);
  if (loc.err) { log('FAIL', loc); process.exit(1); }

  // rect-based visibility (position:fixed portal — offsetParent is always null)
  const dialogCount = () => page.evaluate(() =>
    [...document.querySelectorAll('[role="dialog"]')].filter((d) => {
      if (!/Chọn ngày giờ/i.test(d.textContent || '')) return false;
      const r = d.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    }).length);

  // AC1: single click on the SEGMENT opens the picker
  await page.mouse.move(loc.segX, loc.y);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  const singleOpen = await dialogCount();
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-segment-click.png` });

  // AC2: typing with the picker open keeps caret editing (08 + auto-advance)
  await page.keyboard.type('08', { delay: 90 });
  await sleep(600);
  const typed = await page.evaluate(() => {
    const segs = [...document.querySelectorAll('[data-split-datetime] input[data-seg], [data-split-datetime] input[class*="date-seg"]')];
    return { values: segs.map((i) => i.value), focused: document.activeElement?.getAttribute('aria-label') || null };
  });
  const stillOpen = await dialogCount();
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-typed.png` });

  // AC1b: double-click still yields exactly ONE dialog
  await page.keyboard.press('Escape'); await sleep(500);
  await page.mouse.move(loc.segX, loc.y);
  await page.mouse.down(); await page.mouse.up();
  await sleep(80);
  await page.mouse.down(); await page.mouse.up();
  await sleep(800);
  const dblCount = await dialogCount();
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-double-click.png` });

  log('verdict-input', { singleOpen, typed, stillOpenAfterTyping: stillOpen, dblCount });
  const ac1 = singleOpen === 1;
  const ac2 = typed.values?.[0] === '08' && Boolean(typed.focused);
  const ac3 = dblCount === 1;
  if (ac1 && ac2 && ac3) log('PASS-segment-opens-picker', { contract: 'combined host: any field click opens picker; typing keeps caret' });
  else { log('FAIL', { ac1, ac2, ac3 }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
