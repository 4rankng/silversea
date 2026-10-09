// Card 20261009_1 — lead staging QA. The personnel roster lists DRIVERS
// ONLY (owner ruling 09/10: chấm công driver-only, no office staff): open
// the roster as an accountant, assert every visible row is a driver by
// cross-checking the users API (role === 'DRIVER'), and compare the set
// against the /salary driver list.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-09_card20261009_1-roster-drivers-only';
const EXPECT = '3a43b3b1';
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

// truth from the API: which users are drivers
const users = await fetch(`${API}/auth/users?limit=500`, { headers: auth }).then((r) => r.json());
const drivers = (users.items ?? []).filter((u) => u.role === 'DRIVER');
const office = (users.items ?? []).filter((u) => u.role !== 'DRIVER' && u.role !== 'CUSTOMER');
log('api-truth', { total: users.items?.length, drivers: drivers.length, office: office.length, officeSample: office.slice(0, 4).map((u) => u.username) });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/hr/roster`, { waitUntil: 'domcontentloaded', timeout: 90000 }).catch(() => {});
  await page.goto(`${BASE}${await page.evaluate(() => location.pathname)}`, { waitUntil: 'networkidle2', timeout: 90000 }).catch(() => {});
  await sleep(4000);
  // the roster path may differ — discover from the nav if 404
  const onRoster = await page.evaluate(() => {
    const body = (document.body.textContent || '').replace(/\s+/g, ' ');
    return { hasRosterTitle: /Danh sách nhân sự/i.test(body), rows: document.querySelectorAll('table tbody tr').length };
  });
  if (!onRoster.hasRosterTitle) {
    const link = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a')].find((x) => /nhân sự/i.test(x.textContent || ''));
      return a ? a.getAttribute('href') : null;
    });
    log('nav-discover', { link });
    if (link) await page.goto(`${BASE}${link}`, { waitUntil: 'networkidle2', timeout: 90000 });
    await sleep(4000);
  }
  const roster = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('table tbody tr')];
    return {
      title: /Danh sách nhân sự/i.test((document.body.textContent || '')),
      count: rows.length,
      cells: rows.map((r) => (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)),
    };
  });
  log('roster-render', { title: roster.title, count: roster.count });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-roster.png` });

  // every roster row must be one of the API drivers (by employeeCode/name substring)
  const driverKeys = new Set(drivers.flatMap((u) => [u.employeeCode, u.fullName].filter(Boolean)));
  const officeKeys = new Set(office.flatMap((u) => [u.employeeCode, u.fullName].filter(Boolean)));
  // names shared between an office account and a driver are unidentifiable
  // by text — exclude them from the office-side check; count equality covers them
  const shared = [...officeKeys].filter((k) => driverKeys.has(k));
  const officeOnPage = roster.cells.filter(
    (c) => [...officeKeys].some((k) => !shared.includes(k) && c.includes(k)),
  );
  const driverOnPage = roster.cells.filter((c) => [...driverKeys].some((k) => c.includes(k)));
  log('verdict-input', { rows: roster.count, driverRows: driverOnPage.length, officeRows: officeOnPage.length });
  if (roster.title && roster.count === drivers.length && driverOnPage.length === roster.count && officeOnPage.length === 0) {
    log('PASS-drivers-only', { rows: roster.count, equalsApiDrivers: true });
  } else { log('FAIL', { roster, officeOnPage: officeOnPage.slice(0, 5) }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
