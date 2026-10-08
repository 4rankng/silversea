// Card 081026093520 — lead staging QA on cut a1dc8b1f. Every /shipments
// status tab carries its FULL-SET count (from the API's statusCounts, never
// the loaded page). Cross-checks tab labels against the workspace API.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card081026093520-leadqa';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: 'a1dc8b1f' });
if (!String(health.buildHash || '').startsWith('a1dc8b1f')) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

// API truth: statusCounts of the unfiltered workspace list (page loads few rows)
const ws = await fetch(`${API}/shipments/cus-workspace?limit=4`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const truth = { total: ws.total, statusCounts: ws.statusCounts, rowsLoaded: (ws.items ?? []).length };
log('api-truth', truth);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/shipments`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(4500);
  const scan = await page.evaluate(() => {
    const cands = [...document.querySelectorAll('button,a,[role="tab"]')].filter((e) => e.offsetParent !== null);
    const tabish = cands.filter((x) => /^(Tất cả|Chưa chốt lịch|Chờ điều xe|Chờ đối soát)/.test((x.textContent || '').trim()));
    return {
      tabs: tabish.map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()),
      rows: document.querySelectorAll('tbody tr').length,
    };
  });
  log('tabs-scan', scan);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-tabs.png` });

  const tabCount = (label) => {
    const t = scan.tabs.find((x) => x.startsWith(label));
    const m = t ? t.match(/(\d+)\s*$/) : null;
    return m ? Number(m[1]) : null;
  };
  const sc = truth.statusCounts ?? {};
  const checks = [
    { tab: 'Tất cả', want: truth.total, got: tabCount('Tất cả') },
    { tab: 'Chưa chốt lịch', want: sc.needsSchedule ?? null, got: tabCount('Chưa chốt lịch') },
    { tab: 'Chờ điều xe', want: sc.needsVehicle ?? null, got: tabCount('Chờ điều xe') },
    { tab: 'Chờ đối soát', want: sc.waitingAccounting ?? null, got: tabCount('Chờ đối soát') },
  ];
  log('count-checks', { checks, rowsOnPage: scan.rows, note: 'page shows fewer rows than the counts — full-set rule' });
  const bad = checks.filter((c) => c.want === null || c.got === null || c.want !== c.got);
  // the count must NOT equal the loaded page rows when total > rows (never page-derived)
  const pageDerived = checks.filter((c) => c.got !== null && scan.rows < c.want && c.got === scan.rows);
  if (bad.length === 0 && pageDerived.length === 0) log('PASS-full-set-counts', { checks });
  else { log('FAIL', { bad, pageDerived }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
