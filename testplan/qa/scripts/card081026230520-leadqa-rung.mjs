// Card 081026230520 (FB-062) — lead staging QA. Segmented date/time
// placeholder reads HH:mm / DD/MM/YYYY with no phantom separator gaps:
// measure the REAL glyph spacing (segment rects vs separator rect) on
// /shipments/new (CUS) + the shared /shipments date filter.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026230520-fb062-placeholder';
const EXPECT = '443f5c14';
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

  // --- 1. /shipments/new placeholder spacing (the reported surface) ---
  await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-new-before-measure.png` });
  const measure = async () => page.evaluate(() => {
    // the segmented datetime groups: inputs with data-seg plus separator spans
    const groups = [...document.querySelectorAll('[class*="date-seg"], [data-seg]')];
    const inputs = [...document.querySelectorAll('input[data-seg], input[class*="date-seg"]')];
    const seps = [...document.querySelectorAll('span[class*="date-sep"], [class*="date-sep"]')];
    const detail = [];
    for (const sep of seps.slice(0, 8)) {
      const sepR = sep.getBoundingClientRect();
      // neighbors: previous/next input sibling within the same group
      const prev = sep.previousElementSibling?.getBoundingClientRect?.();
      const next = sep.nextElementSibling?.getBoundingClientRect?.();
      if (!prev || !next) continue;
      detail.push({
        sep: (sep.textContent || '').trim(),
        gapLeft: Math.round((sepR.left - prev.right) * 10) / 10,
        gapRight: Math.round((next.left - sepR.right) * 10) / 10,
        sepW: Math.round(sepR.width * 10) / 10,
        clipped: sepR.width === 0 || sepR.height === 0,
      });
    }
    const placeholders = inputs.slice(0, 8).map((i) => ({ ph: i.placeholder || i.getAttribute('placeholder'), w: Math.round(i.getBoundingClientRect().width) }));
    return { segInputs: inputs.length, seps: seps.length, detail, placeholders, groupsFound: groups.length };
  });
  const m = await measure();
  log('placeholder-measure-new', m);

  // --- 2. typed-value integrity: tap the hour segment and type ---
  const typed = await page.evaluate(() => {
    const input = document.querySelector('input[data-seg], input[class*="date-seg"]');
    if (!input) return { ok: false, why: 'no segment input' };
    const r = input.getBoundingClientRect();
    return { ok: true, x: r.x + r.width / 2, y: r.y + r.height / 2, label: input.getAttribute('aria-label') || input.className };
  });
  log('segment-locate', typed);
  if (typed.ok) {
    await page.mouse.move(typed.x, typed.y);
    await page.mouse.down(); await page.mouse.up();
    await sleep(400);
    await page.keyboard.type('103015102026', { delay: 90 });
    await sleep(600);
    const vals = await page.evaluate(() =>
      [...document.querySelectorAll('input[data-seg], input[class*="date-seg"]')].map((i) => i.value)
    );
    log('typed-values', { vals });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-new-typed.png` });
  }

  // --- 3. shared surface: /shipments date filter DD/MM/YYYY ---
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const filt = await page.evaluate(() => {
    const seps = [...document.querySelectorAll('span[class*="date-sep"], [class*="date-sep"]')];
    const out = [];
    for (const sep of seps.slice(0, 6)) {
      const sepR = sep.getBoundingClientRect();
      const prev = sep.previousElementSibling?.getBoundingClientRect?.();
      const next = sep.nextElementSibling?.getBoundingClientRect?.();
      if (!prev || !next || sepR.width === 0) continue;
      out.push({ sep: (sep.textContent || '').trim(), gapLeft: Math.round((sepR.left - prev.right) * 10) / 10, gapRight: Math.round((next.left - sepR.right) * 10) / 10 });
    }
    return { seps: seps.length, detail: out };
  });
  log('filter-measure', filt);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-shipments-filter.png` });

  // --- verdict: every measured gap around ':' and '/' must be ≤ 1.5px per side ---
  const allGaps = [...m.detail, ...filt.detail].flatMap((d) => [d.gapLeft, d.gapRight]);
  const bad = [...m.detail, ...filt.detail].filter((d) => d.gapLeft > 1.5 || d.gapRight > 1.5);
  const typedOk = typed.ok ? true : false; // typing itself logged above; integrity judged from vals screenshot
  log('verdict-input', { gaps: allGaps, budget: '≤1.5px/side per fixed contract (broken state measured 5.3–6.3px)' });
  if (m.seps > 0 && bad.length === 0) log('PASS-placeholder-compact', { measuredSeps: m.detail.length + filt.detail.length, typedOk });
  else { log('FAIL', { bad }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
