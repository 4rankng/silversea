// Card 20261009_2 — lead staging QA. Finance roles read the driver roster:
// ACCOUNTANT gets 200 + the 43-driver projected list on /auth/users/roster
// (and the page renders it), DISPATCHER is denied, admin path unchanged.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card20261009_2-roster-403';
const EXPECT = 'fca551ee';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = async (id) => (await (await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: id, password: 'Abc123' }) })).json()).token;

// API truth per role
const accountantTok = await login('hoapt');
const dispatcherTok = await login('dungnv');
const adminTok = await login('admin');

const acc = await fetch(`${API}/auth/users/roster`, { headers: { Authorization: `Bearer ${accountantTok}` } });
const accBody = acc.status === 200 ? await acc.json() : { raw: await acc.text() };
log('api-accountant', { status: acc.status, items: accBody.items?.length, total: accBody.total, sampleKeys: accBody.items?.[0] ? Object.keys(accBody.items[0]) : null });

const dis = await fetch(`${API}/auth/users/roster`, { headers: { Authorization: `Bearer ${dispatcherTok}` } });
log('api-dispatcher', { status: dis.status });

const adm = await fetch(`${API}/auth/users/roster`, { headers: { Authorization: `Bearer ${adminTok}` } });
const admBody = adm.status === 200 ? await adm.json() : {};
log('api-admin', { status: adm.status, items: admBody.items?.length });

// UI: hoapt opens the roster page (menu audience) — real pointer navigation
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), accountantTok);
  const failures = [];
  page.on('response', (r) => { if (r.url().includes('/auth/users/roster') && r.status() >= 400) failures.push(r.status()); });
  await page.goto(`${BASE}/hr/roster`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4000);
  const roster = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    return {
      title: /Danh sách nhân sự/i.test((document.body.textContent || '')),
      count: rows.length,
      first: rows[0]?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 70) ?? null,
    };
  });
  log('ui-accountant-roster', { ...roster, rosterFetchFailures: failures });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-accountant.png` });

  const okApi = acc.status === 200 && accBody.items?.length === accBody.total && adm.status === 200 && admBody.items?.length === accBody.items?.length;
  const okDenied = dis.status === 403;
  const okUi = roster.title && roster.count === (accBody.items?.length ?? -1) && failures.length === 0;
  if (okApi && okDenied && okUi) log('PASS-roster-for-finance', { api: accBody.items.length, ui: roster.count, dispatcher: 403 });
  else { log('FAIL', { okApi, okDenied, okUi }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
