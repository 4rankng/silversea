// Card 081026072302 — lead staging QA. The closed 'Chứng từ giao hàng' card
// stays one row ≤ ~60px on phone widths across the closed states (trips 117
// and 138 — status-row variant; trip 79 — text variant control).
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026072302-leadqa';
const EXPECT = '7db0c910';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'bqhuong', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  const results = [];
  for (const trip of [117, 138, 79]) {
    for (const w of [320, 390, 768]) {
      await page.setViewport({ width: w, height: w <= 500 ? 844 : 900 });
      await page.goto(`${BASE}/my-trips/${trip}`, { waitUntil: 'networkidle2', timeout: 90000 });
      await sleep(4000);
      const m = await page.evaluate(() => {
        const label = [...document.querySelectorAll('h1,h2,h3,h4,div,section')].filter((e) => e.offsetParent !== null && /chứng từ giao hàng/i.test(e.textContent || '') && (e.textContent || '').length < 400)[0];
        if (!label) return { err: 'no card label' };
        // the closed footer body is the card's layout container
        const body = label.closest('[class*="driver-task-footer"], [class*="card"], section') ?? label.parentElement;
        const r = (body ?? label).getBoundingClientRect();
        return { height: Math.round(r.height), cls: ((body ?? label).className || '').toString().slice(0, 60) };
      });
      log('measure', { trip, w, ...m });
      results.push({ trip, w, h: m.height ?? null });
      if (w === 390) await page.screenshot({ path: `${QA}/${SCOPE}_ui-trip${trip}-${w}.png` });
    }
  }
  const bad = results.filter((r) => r.h === null || r.h > 66);
  log('verdict-input', { results, budget: '≤~60px phone; 66px hard ceiling incl. rounding' });
  if (results.length === 9 && bad.length === 0) log('PASS-one-row-height', { results });
  else { log('FAIL', { bad }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
