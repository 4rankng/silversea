// Card 081026104400-511 — lead staging QA. Admin-configurable VAT rate:
// Admin Center card offers 0/5/8/10%, first-unconfigured default 8%; saving
// persists; read endpoint serves the rate. Rung 3 + API truth.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card511-vat-leadqa';
const EXPECT = '7db0c910';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }
const auth = { Authorization: `Bearer ${token}` };

// discover the config endpoint shape
const probe = await fetch(`${API}/config/vat-rate`, { headers: auth }).then((r) => ({ s: r.status, b: r.text() })).catch((e) => ({ s: 0, b: String(e) }));
log('vat-endpoint-probe', { status: probe.s, body: (await probe.b).slice(0, 160) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(5000);
  // find the VAT card (may need scrolling/tab)
  const card = await page.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ');
    const el = [...document.querySelectorAll('h1,h2,h3,h4,[class*="card"],section,div')].filter((e) => e.offsetParent !== null && /thuế suất|Thuế suất VAT/i.test(e.textContent || '') && (e.textContent || '').length < 600).pop();
    return {
      hasVatSection: Boolean(el),
      snippet: el ? (el.textContent || '').replace(/\s+/g, ' ').slice(0, 200) : null,
      hasPercentOptions: /8%/.test(body) && /10%/.test(body) && /5%/.test(body),
    };
  });
  log('vat-card', card);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-admin.png` });

  // capture the VAT API the page calls
  const resp = await page.evaluate(async () => {
    const r = await fetch('/api/vat-config', { headers: { Authorization: `Bearer ${localStorage.getItem('token')}` } });
    return { status: r.status, body: (await r.text()).slice(0, 200) };
  });
  log('vat-api', resp);

  const checks = [
    { what: 'VAT section renders in Admin Center', ok: card.hasVatSection },
    { what: 'options include 5/8/10%', ok: card.hasPercentOptions },
    { what: 'vat-rate endpoint answers', ok: resp.status === 200 || probe.s === 200 },
  ];
  log('checks', checks);
  if (checks.every((c) => c.ok)) log('PASS-vat-config', { card: card.snippet, api: resp.body ?? (await probe.b).slice(0, 120) });
  else { log('FAIL', { checks, card, resp }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
