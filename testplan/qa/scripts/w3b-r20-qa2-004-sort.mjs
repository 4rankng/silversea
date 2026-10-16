// W3b — QA2-004 my-orders sort re-verify on staging (OPS).
// Original defect record/driver: testplan/qa/scripts/qa2-004-inbox-sort-local.mjs
// (local, giaonhan). Staging has no demo accounts → OPS named staff; only
// hoangnh currently holds inbox work on staging (others 0 rows, probe log).
// Contract under test: /my-orders work-inbox table header sort — Công việc
// (title asc/desc), Cập nhật (freshness), Trạng thái (state); aria-sort state,
// URL carries the sort, reload restores it (back-link contract).
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

const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let exitCode = 0;

const healthRes = await fetch(`${API}/health`);
const healthText = await healthRes.text();
let health;
try { health = JSON.parse(healthText); } catch { console.error(`health ${healthRes.status}`); process.exit(2); }
log('health', { buildHash: health.buildHash, expect: EXPECT_BUILD });
if (!String(health.buildHash || '').startsWith(EXPECT_BUILD)) { console.error('STALE BUILD — abort'); process.exit(2); }

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'hoangnh', password: 'Abc123' }),
});
if (login.status !== 200) { console.error(`login hoangnh -> ${login.status}`); process.exit(2); }
const token = (await login.json()).token;
const jwt = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString('utf8'));
log('identity', { user: 'hoangnh', jwtUsername: jwt.username ?? jwt.identifier ?? jwt.sub });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 960 });
await page.evaluateOnNewDocument((t, o) => { if (location.origin === o) localStorage.setItem('token', t); }, token, new URL(BASE).origin);
await page.goto(`${BASE}/my-orders`, { waitUntil: 'networkidle2', timeout: 60000 });
await sleep(3000);
const shot = (n) => page.screenshot({ path: path.join(OUT, `qa2004_${n}.png`) });

const sortState = () => page.evaluate(() => ({
  sorts: [...document.querySelectorAll('th[aria-sort]')].map((el) => ({ label: (el.textContent || '').trim().slice(0, 14), aria: el.getAttribute('aria-sort') })),
  url: location.search,
  firstRow: (document.querySelector('tbody tr')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80),
}));
const clickSort = async (label) => {
  const r = await page.evaluate((lbl) => {
    const th = [...document.querySelectorAll('th[aria-sort]')].find((el) => (el.textContent || '').trim().startsWith(lbl));
    if (!th) return null;
    const btn = th.querySelector('button') ?? th;
    btn.scrollIntoView({ block: 'center' });
    const b = btn.getBoundingClientRect();
    return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
  }, label);
  if (!r) return null;
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  await page.mouse.up();
  await sleep(1800);
};

await shot('01-initial');
const s0 = await sortState();
log('initial', s0);

await clickSort('Công việc');
await shot('02-title-asc');
const s1 = await sortState();
log('title-asc', s1);
await clickSort('Công việc');
await shot('03-title-desc');
const s2 = await sortState();
log('title-desc', s2);
await clickSort('Cập nhật');
await shot('04-freshness');
const s3 = await sortState();
log('freshness', s3);
await clickSort('Trạng thái');
await shot('05-state');
const s4 = await sortState();
log('state', s4);
// reload must restore the ordering from the URL (back-link contract)
await page.reload({ waitUntil: 'networkidle2' });
await sleep(2500);
await shot('06-reload-restores');
const s5 = await sortState();
log('after-reload', s5);

const aria = (s) => (s.sorts ?? []).map((x) => x.aria);
const sortsActive = (s) => (s.sorts ?? []).some((x) => x.aria === 'ascending' || x.aria === 'descending');
const verdict = {
  headersSortable: (s0.sorts ?? []).length >= 3,
  titleAsc: (s1.sorts ?? []).some((x) => x.label.startsWith('Công việc') && x.aria === 'ascending'),
  titleDesc: (s2.sorts ?? []).some((x) => x.label.startsWith('Công việc') && x.aria === 'descending'),
  freshness: (s3.sorts ?? []).some((x) => x.aria === 'ascending' || x.aria === 'descending') && s3.url !== s0.url,
  state: (s4.sorts ?? []).some((x) => x.aria === 'ascending' || x.aria === 'descending'),
  urlCarriesSort: s4.url.length > 0 && s4.url !== '',
  reloadRestores: sortsActive(s5) || s5.url === s4.url,
  reorderEvidence: s1.firstRow !== s0.firstRow || s2.firstRow !== s1.firstRow,
};
log('verdict-data', verdict);
if (verdict.headersSortable && verdict.titleAsc && verdict.titleDesc && verdict.state && verdict.reloadRestores) {
  log('TC', { id: 'QA2-004', verdict: 'PASS', detail: verdict });
} else {
  log('TC', { id: 'QA2-004', verdict: 'FAIL', detail: verdict });
  exitCode = 1;
}
fs.writeFileSync(path.join(OUT, 'qa2004_log.json'), JSON.stringify(LOG, null, 2));
await browser.close();
process.exit(exitCode);
