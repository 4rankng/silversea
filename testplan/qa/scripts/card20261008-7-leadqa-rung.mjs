// Card 20261008_7 — lead staging QA. The detail-plan union's điều phối branch
// now honors the topbar month window: the grid's plan-rows request carries
// dateFrom/dateTo, and the revealed rows match the same-window API total.
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const SCOPE = '2026-10-08_card20261008-7-leadqa';
const EXPECT = '6585dc16';
const LOG = [];
const log = (step, obj) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const health = await fetch(`${API}/health`).then((r) => r.json());
log('health', { buildHash: health.buildHash, expect: EXPECT });
if (!String(health.buildHash || '').startsWith(EXPECT)) { log('build-currency-FAIL'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'dungnv', password: 'Abc123' }) });
const token = (await login.json()).token;
if (!token) { log('login-FAIL'); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1100 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);

  const planReqs = [];
  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('/dispatch-detail-plan-rows')) planReqs.push(u.replace(BASE + '/api', '').slice(0, 160));
  });

  await page.goto(`${BASE}/dispatch-detail`, { waitUntil: 'networkidle2', timeout: 90000 });
  let rows = 0;
  for (let i = 0; i < 15 && !rows; i++) { await sleep(3000); rows = await page.evaluate(() => document.querySelectorAll('tbody tr').length); }
  await sleep(2000);
  log('grid', { rows, planRequests: planReqs.slice(0, 4) });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-grid.png` });

  // The default topbar window is the current month — the request must carry it
  const last = planReqs[planReqs.length - 1] ?? '';
  const hasFrom = /dateFrom=2026-10-01/.test(last);
  const hasTo = /dateTo=2026-10-31/.test(last);

  // Same-window API total vs revealed rows (grid pages at 50; count pages)
  const apiSame = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50&dateFrom=2026-10-01&dateTo=2026-10-31`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const apiNone = await fetch(`${API}/shipments/dispatch-detail-plan-rows?limit=50`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
  const sameTotal = apiSame.total ?? (apiSame.items ?? []).length;
  const noneTotal = apiNone.total ?? (apiNone.items ?? []).length;
  log('api-compare', { sameWindow: sameTotal, noWindow: noneTotal, gridRows: rows });

  const checks = [
    { what: 'grid request carries dateFrom of the month', ok: hasFrom },
    { what: 'grid request carries dateTo of the month', ok: hasTo },
    { what: 'grid rows equal the same-window API total', ok: rows === sameTotal || (sameTotal > 50 && rows <= sameTotal), note: `rows=${rows} same=${sameTotal}` },
  ];
  log('checks', checks);
  if (checks[0].ok && checks[1].ok && checks[2].ok) log('PASS-date-parity', { sameWindow: sameTotal, noWindow: noneTotal });
  else { log('FAIL', { checks, last }); exitCode = 1; }
} catch (err) {
  log('driver-error', { message: String(err && err.message || err).slice(0, 300) });
  exitCode = 1;
} finally {
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  await browser.close();
  process.exit(exitCode);
}
