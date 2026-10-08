// Card 20261008_5 — lead staging QA. Shared Tabs: every tab carrying a count
// exposes an accessible name WITH a space ('Tất cả 147'), while the visible
// text keeps the glued count-span convention. Checked on two host surfaces.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-5-leadqa';
const EXPECT = 'dc599a82';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) })).json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const results = [];
  // Surface 1: /shipments status tabs (admin)
  {
    const token = await login('admin');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
      .filter((t) => t.offsetParent !== null && /\d/.test(t.textContent || ''))
      .map((t) => ({ text: (t.textContent || '').replace(/\s+/g, ' ').trim(), aria: t.getAttribute('aria-label') })));
    log('shipments-tabs', { tabs });
    results.push({ surface: '/shipments', tabs });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-shipments.png` });
    await page.close();
  }
  // Surface 2: /ops/wallet expense-history tabs (hoangnh)
  {
    const token = await login('hoangnh');
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.goto(`${BASE}/ops/wallet`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4500);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('[role="tab"]')]
      .filter((t) => t.offsetParent !== null && /\d/.test(t.textContent || ''))
      .map((t) => ({ text: (t.textContent || '').replace(/\s+/g, ' ').trim(), aria: t.getAttribute('aria-label') })));
    log('wallet-tabs', { tabs });
    results.push({ surface: '/ops/wallet', tabs });
    await page.screenshot({ path: `${QA}/${SCOPE}_ui-wallet.png` });
    await page.close();
  }
  // Verdict: every counted tab has aria-label = '<label> <count>' (spaced),
  // never glued; visible textContent keeps the glued convention.
  const bad = [];
  let checked = 0;
  for (const r of results) for (const t of r.tabs) {
    checked++;
    const m = (t.text || '').match(/^(.*?)\s*(\d+)$/);
    if (!t.aria) { bad.push({ surface: r.surface, t, why: 'no aria-label' }); continue; }
    if (!/\s\d+$/.test(t.aria)) { bad.push({ surface: r.surface, t, why: 'aria-label not spaced-before-count' }); continue; }
    if (m && t.aria !== `${m[1].trim()} ${m[2]}`) { bad.push({ surface: r.surface, t, why: 'aria-label mismatches visible label+count' }); continue; }
    if (t.aria === (t.text || '').replace(/\s+/g, '')) { bad.push({ surface: r.surface, t, why: 'aria-label glued' }); }
  }
  log('verdict-input', { checked, bad });
  if (checked > 0 && bad.length === 0) log('PASS-spaced-accessible-names', { checked, surfaces: results.map((r) => r.surface) });
  else { log('FAIL', { checked, bad }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
