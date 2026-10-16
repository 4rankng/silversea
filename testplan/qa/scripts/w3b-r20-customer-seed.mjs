// W3b — customer-seed visibility re-check on staging (case QA-2026-10-04-345).
// Defect: QA/test rows mixing into the Khách hàng / Nhà xe catalogs ("trộn danh sách").
// Expected: default list = real customers only; ?isCarrier=true = separate
// carrier catalog; no test/QA rows anywhere. READ-ONLY — no mutations here.
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '7dcdcf33';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3b-r20-verify');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

// QA-ish name patterns (case-insensitive) — the classes case-345 cleaned
const QA_PATTERNS = /test|probe|e2e|qafixture|qaw3b|qawa|r20-|c21|fixture|demo|k22|w3a|w3b/i;

const healthRes = await fetch(`${API}/health`);
const healthText = await healthRes.text();
let health;
try { health = JSON.parse(healthText); } catch { console.error(`health ${healthRes.status}`); process.exit(2); }
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) { console.error('STALE BUILD — abort'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
const token = (await login.json()).token;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() };

const listCustomers = async (qs) => {
  const r = await fetch(`${API}/customers${qs}`, { headers: H }).then((x) => x.json());
  const items = r.items ?? r.customers ?? r ?? [];
  return Array.isArray(items) ? items : [];
};

const def = await listCustomers('?limit=100');
const carriers = await listCustomers('?isCarrier=true&limit=100');
const nameOf = (c) => c.name ?? c.customerName ?? c.companyName ?? '?';
log('api-default', { count: def.length, names: def.map(nameOf) });
log('api-carriers', { count: carriers.length, names: carriers.map(nameOf) });

const defHits = def.map(nameOf).filter((n) => QA_PATTERNS.test(n));
const carrierHits = carriers.map(nameOf).filter((n) => QA_PATTERNS.test(n));
log('api-pattern-hits', { defHits, carrierHits });

// UI: the Khách hàng catalog page as admin (the surface customers actually see)
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.evaluateOnNewDocument((t, o) => { if (location.origin === o) localStorage.setItem('token', t); }, token, new URL(BASE).origin);
await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
await page.screenshot({ path: path.join(OUT, 'customer-seed_01-catalog.png') });
const ui = await page.evaluate(() => {
  const main = document.querySelector('main') ?? document.body;
  const rows = [...main.querySelectorAll('tbody tr')].map((tr) => tr.textContent.replace(/\s+/g, ' ').trim().slice(0, 90)).slice(0, 60);
  return { url: location.pathname, heading: main.querySelector('h1,h2')?.textContent?.trim() ?? null, rows };
});
log('ui-catalog', ui);

// CUS-side surface too: the Khách hàng combobox on /shipments/new (tiepvv)
const cLogin = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
});
const cToken = (await cLogin.json()).token;
await page.evaluateOnNewDocument((t, o) => { if (location.origin === o) localStorage.setItem('token', t); }, cToken, new URL(BASE).origin);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
await page.evaluate(() => {
  const labels = [...document.querySelectorAll('label')].filter((l) => l.offsetParent);
  const l = labels.find((x) => x.textContent.trim().startsWith('Khách hàng'));
  const el = l?.getAttribute('for') ? document.getElementById(l.getAttribute('for')) : l?.querySelector('input');
  el?.focus();
  el?.click();
});
await sleep(900);
await page.keyboard.type('a', { delay: 40 });
await sleep(1500);
const picker = await page.evaluate(() => [...document.querySelectorAll('[role="option"]')].filter((o) => o.offsetParent).map((o) => o.textContent.trim().slice(0, 60)));
await page.screenshot({ path: path.join(OUT, 'customer-seed_02-picker.png') });
const pickerHits = picker.filter((n) => QA_PATTERNS.test(n));
log('ui-picker', { options: picker.length, sample: picker.slice(0, 12), hits: pickerHits });

const verdict = { defHits, carrierHits, pickerHits };
log('verdict-data', verdict);
if (!defHits.length && !carrierHits.length && !pickerHits.length) log('TC', { id: 'CUSTOMER-SEED-VISIBILITY', verdict: 'PASS' });
else { log('TC', { id: 'CUSTOMER-SEED-VISIBILITY', verdict: 'FAIL', hits: verdict }); exitCode = 1; }

fs.writeFileSync(path.join(OUT, 'customer-seed_log.json'), JSON.stringify(LOG, null, 2));
await browser.close();
process.exit(exitCode);
