// SIL-730 (id 850) — rung-3 UI drive (AGENTS §9).
// /my-orders is retired (Spec fix 2 II.5 AC1): the Ops post-login landing is
// /ops/orders, and the direct /my-orders URL redirects there — no more empty
// 'Lệnh giao nhận' screen ('Cần làm 0 | 0 lô'). Role: hoangnh (OPS).
// Stack: frontend http://localhost:7189 → backend :3005 → dev DB :5441 (ss-prod-db).
import puppeteer from 'puppeteer-core';
import { mkdirSync, appendFileSync } from 'node:fs';

const BASE = 'http://localhost:7189';
const API = 'http://localhost:3005/api';
const ART = 'qa';
const LOG = 'qa/2026-11-08_sil730_ui-driver.log';
mkdirSync(ART, { recursive: true });
const log = (line) => { const text = `${new Date().toISOString()} ${line}`; console.log(text); appendFileSync(LOG, `${text}\n`); };
appendFileSync(LOG, `\n=== run ${new Date().toISOString()} ===\n`);

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }),
});
const { token } = await login.json();
log(`login hoangnh: ${token ? 'OK' : 'FAIL'}`);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--window-size=1440,1000'],
  defaultViewport: { width: 1440, height: 1000 },
});
const page = await browser.newPage();
await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

const shot = async (name) => { await page.screenshot({ path: `${ART}/2026-11-08_sil730_ui-${name}.png`, fullPage: false }); log(`shot ${name}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const expect = (cond, what) => { log(`${cond ? 'PASS' : 'FAIL'} ${what}`); if (!cond) failures += 1; };

try {
  // 1. Post-login landing: '/' must land the Ops home /ops/orders.
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  const landing = await page.evaluate(() => ({
    url: location.pathname,
    heading: document.querySelector('main h1')?.textContent ?? null,
    emptyLegacy: document.body.innerText.includes('Cần làm'),
    sidebarHasLegacy: document.body.innerText.includes('Lệnh giao nhận'),
    workRows: document.querySelectorAll('main table tbody tr').length,
  }));
  log(`landing url=${landing.url} heading=${landing.heading} rows=${landing.workRows}`);
  expect(landing.url === '/ops/orders', `post-login landing is /ops/orders (got ${landing.url})`);
  expect(!landing.emptyLegacy, 'no legacy empty-workboard copy (Cần làm 0)');
  expect(!landing.sidebarHasLegacy, 'sidebar carries no Lệnh giao nhận entry');
  await shot('01-ops-landing');

  // 2. Direct /my-orders URL redirects to /ops/orders.
  await page.goto(`${BASE}/my-orders`, { waitUntil: 'networkidle2' });
  await sleep(1500);
  const redirect = await page.evaluate(() => ({
    url: location.pathname,
    heading: document.querySelector('main h1')?.textContent ?? null,
  }));
  log(`redirect url=${redirect.url} heading=${redirect.heading}`);
  expect(redirect.url === '/ops/orders', `direct /my-orders redirects to /ops/orders (got ${redirect.url})`);
  await shot('02-my-orders-redirect');
} catch (error) {
  failures += 1;
  log(`DRIVE ERROR: ${error.message}`);
  await shot('99-error');
} finally {
  await browser.close();
  log(`DRIVER_EXIT:${failures === 0 ? 0 : 1} failures=${failures}`);
}
process.exit(failures === 0 ? 0 : 1);
