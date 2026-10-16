// W3b — QA1-007 required-asterisk contract on staging (build must equal main src 7dcdcf33).
// Spec: testplan/cycles/2026-10/2026-10-14-qa1-007-create-required-asterisk contract
// (2026-10-14-qa1-007-create-required-asterisks.md). Ad-hoc (Lệnh chạy ngoài)
// waives catalog prerequisites → those asterisks disappear.
// Usage: node w3b-r20-qa1-007-asterisks.mjs <normal|adhoc>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require2 = createRequire('/Volumes/LexarSSD/projects/silversea/package.json');
const puppeteer = require2('puppeteer');

const API = 'https://vantai.tingting.vip/api';
const BASE = 'https://vantai.tingting.vip';
const EXPECT_BUILD = process.env.QA_EXPECT_BUILD || '7dcdcf33';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-16_w3b-r20-verify');
fs.mkdirSync(OUT, { recursive: true });
const PHASE = process.argv[2] || 'normal';

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;
const hasMark = (s) => /\*/.test(s ?? '');
const pick = (arr, name) => arr.find((s) => s.startsWith(name));

// health gate
const healthRes = await fetch(`${API}/health`);
const healthText = await healthRes.text();
let health;
try { health = JSON.parse(healthText); } catch { console.error(`health ${healthRes.status}`); process.exit(2); }
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) { console.error('STALE BUILD — abort'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'tiepvv', password: 'Abc123' }),
});
const token = (await login.json()).token;

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.evaluateOnNewDocument((t, o) => { if (location.origin === o) localStorage.setItem('token', t); }, token, new URL(BASE).origin);
await page.goto(`${BASE}/shipments/new`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(2500);
const shot = (n) => page.screenshot({ path: path.join(OUT, `qa1007-${PHASE}_${n}.png`) });

const switchLcl = async () => {
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('label')]
      .find((e) => e.offsetParent && e.textContent.replace(/\s+/g, ' ').trim().startsWith('Hàng lẻ'));
    if (el) el.click();
  });
  await sleep(1500);
};
// toggle Lệnh chạy ngoài (identity flag checkbox — click the input itself)
const setAdhoc = async () => {
  const st = await page.evaluate(() => {
    const box = [...document.querySelectorAll('label')].find((l) => l.offsetParent && l.textContent.includes('Lệnh chạy ngoài'))?.querySelector('input[type="checkbox"]');
    if (!box) return { found: false };
    const before = box.checked;
    box.click();
    return { found: true, before, after: box.checked };
  });
  await sleep(1500);
  log('adhoc-toggle', st);
  if (!st.found || st.before === st.after) throw new Error('ad-hoc toggle did not flip');
};
// dump mark state: real <label> texts + FCL cell data-labels
const dumpMarks = () => page.evaluate(() => {
  const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
  const labels = [...document.querySelectorAll('label')].filter((l) => l.offsetParent).map((l) => norm(l.textContent));
  const cells = [...document.querySelectorAll('[data-label]')].filter((c) => c.offsetParent).map((c) => norm(c.getAttribute('data-label')));
  return { labels, cells };
});

if (PHASE === 'adhoc') await setAdhoc();
const fclMarks = await dumpMarks();
log(`${PHASE}-fcl-labels`, fclMarks);
await shot('01-fcl');
await switchLcl();
const lclMarks = await dumpMarks();
log(`${PHASE}-lcl-labels`, lclMarks);
await shot('02-lcl');

if (PHASE === 'normal') {
  const lclChecks = ['Kho lấy hàng', 'Quy cách đóng gói', 'Số lượng', 'Trọng lượng (kg)', 'Ngày giao hàng'].map((n) => ({ n, ok: hasMark(pick(lclMarks.labels, n)) }));
  const cbmClean = !hasMark(pick(lclMarks.labels, 'Thể tích (CBM)'));
  const fclChecks = ['Loại container', 'Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ', 'Ngày giờ đóng trả'].map((n) => ({ n, ok: hasMark(pick(fclMarks.cells, n)) }));
  log('normal-verdict-data', { lclmodes: 'both dumped', lclChecks, cbmClean, fclChecks });
  if (lclChecks.every((c) => c.ok) && cbmClean && fclChecks.every((c) => c.ok)) log('TC', { id: 'QA1-007-normal', verdict: 'PASS' });
  else { log('TC', { id: 'QA1-007-normal', verdict: 'FAIL', lclChecks, cbmClean, fclChecks }); exitCode = 1; }
} else {
  // ad-hoc: catalog waivers drop the marks on the LCL route + FCL
  // factory/route/ports; Loại container and Ngày giờ đóng trả stay required
  const lclRoute = pick(lclMarks.labels, 'Tuyến đường') ?? '(not rendered)';
  const fclWaived = ['Nhà máy', 'Tuyến đường', 'Cảng nâng', 'Cảng hạ'].map((n) => ({ n, raw: pick(fclMarks.cells, n) ?? '(not rendered)' }));
  const fclStill = ['Loại container', 'Ngày giờ đóng trả'].map((n) => ({ n, raw: pick(fclMarks.cells, n) ?? '(not rendered)' }));
  log('adhoc-verdict-data', { lclRoute, fclWaived, fclStill });
  const waivedClean = fclWaived.every((c) => !hasMark(c.raw) && c.raw !== '(not rendered)');
  const lclRouteClean = !hasMark(lclRoute) && lclRoute !== '(not rendered)';
  const stillMarked = fclStill.every((c) => hasMark(c.raw));
  if (lclRouteClean && waivedClean && stillMarked) log('TC', { id: 'QA1-007-adhoc', verdict: 'PASS' });
  else { log('TC', { id: 'QA1-007-adhoc', verdict: 'FAIL', lclRouteClean, waivedClean, stillMarked }); exitCode = 1; }
}

fs.writeFileSync(path.join(OUT, `qa1007-${PHASE}_log.json`), JSON.stringify(LOG, null, 2));
await browser.close();
process.exit(exitCode);
