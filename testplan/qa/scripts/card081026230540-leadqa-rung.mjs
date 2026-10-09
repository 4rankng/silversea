// Card 081026230540 — lead staging QA. Driver contact phone is tap-to-call:
// on /my-trips/79 (the round-8 reported trip) the 'SĐT liên hệ' 0900000001
// must be an <a href="tel:0900000001"> through the shared TelLink.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card081026230540-tel-link';
const EXPECT = '463712eb';
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
  await page.setViewport({ width: 390, height: 844 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/my-trips/79`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  const probe = await page.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ');
    const cells = [...document.querySelectorAll('div,span,a,p')].filter((e) => /SĐT liên hệ/i.test(e.textContent || '') && (e.textContent || '').length < 200);
    const label = cells[cells.length - 1]?.closest('[class*="fact"], [class*="row"], div, p') ?? cells[0];
    if (!label) return { err: 'no contact label' };
    const scope = label.parentElement?.parentElement ?? label.parentElement ?? label;
    const tel = [...scope.querySelectorAll('a[href^="tel:"]')].map((a) => ({ href: a.getAttribute('href'), text: (a.textContent || '').trim() }));
    const allTel = [...document.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href'));
    return { hasContactLabel: true, contact: body.includes('0900000001'), telLinksNearby: tel, allTelOnPage: allTel };
  });
  log('tel-probe', probe);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-trip79.png` });

  const ok = probe.telLinksNearby?.some((t) => t.href === 'tel:0900000001') ?? false;
  if (ok) log('PASS-tel-link', { href: 'tel:0900000001' });
  else { log('FAIL', { probe }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
