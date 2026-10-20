// FB-061 lan 2 (card 201026112400) — RUNG-3 UI drive on STAGING after the
// purge deploy: admin → /users. The card's sample-user class (demo-seed trio
// + e2e-/HAHA probes) must not render; the real roster must. Read-only.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-lan2-users');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expect: '0b870f61' });

// Wire truth first (the DOM assert cross-checks against it).
const loginRes = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }),
});
if (!loginRes.ok) { console.error(`BLOCKED: login admin -> ${loginRes.status}`); process.exit(2); }
const { token, user } = await loginRes.json();
log('login', { identifier: 'admin', role: user?.role });

const usersWire = await (await fetch(`${API}/auth/users?limit=500`, {
  headers: { Authorization: `Bearer ${token}` },
})).json();
log('users_wire', { count: usersWire.items?.length, total: usersWire.total });

const FORBIDDEN = [
  ['cus-demo-name', /Nhân viên CUS\s*Demo/i],
  ['dieuvan-demo-name', /Nhân viên Điều vận\s*Demo/i],
  ['customer-demo-name', /Khách hàng\s*Demo/i],
  ['haha-probe', /HAHA/i],
  ['e2e-token', /e2e-/i],
  ['e2e-dispatcher-name', /E2E Dispatcher/i],
];
const wireUsernames = usersWire.items.map((u) => u.username);
const wireHits = FORBIDDEN.filter(([, re]) => wireUsernames.some((un) => re.test(un)) || usersWire.items.some((u) => re.test(String(u.fullName ?? ''))));
if (wireHits.length) { console.error(`WIRE FAIL: ${wireHits.map(([n]) => n).join(', ')}`); process.exit(2); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function driveUsers(width, height, tag) {
  const page = await browser.newPage();
  await page.setViewport({ width, height });
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  await page.evaluateOnNewDocument((t) => {
    localStorage.setItem('token', t);
  }, token);
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(3000);

  const forbiddenHits = [];
  const rowTexts = [];
  let pagesWalked = 0;
  // Walk the pagination to the end: every visible row is scanned, so a
  // sample user hiding on page 7 cannot slip a single-page scan.
  for (;;) {
    pagesWalked += 1;
    await page.waitForSelector('table tbody tr', { timeout: 30000 });
    const pageRows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody tr')).map((tr) => tr.innerText),
    );
    rowTexts.push(...pageRows);
    const next = await page.$('button[aria-label="Trang sau"]');
    const disabled = await page.evaluate((el) => el === null || el.disabled, next);
    if (!next || disabled) break;
    await next.click();
    await sleep(1200);
    if (pagesWalked > 30) { console.error('PAGE WALK RUNAWAY'); process.exit(2); }
  }

  const allText = rowTexts.join('\n');
  const domHits = FORBIDDEN.filter(([, re]) => re.test(allText)).map(([n]) => n);
  // Guard against a blank/failed render passing the forbidden scan: the
  // whole real roster must render across the walked pages.
  const missingRoster = wireUsernames.filter((u) => !allText.includes(u));

  const shot = path.join(OUT, `201026112400_after_ui-${tag}-users-page.png`);
  await page.screenshot({ path: shot, fullPage: true });
  const bodyText = await page.evaluate(() => document.body.innerText);

  log(`ui_${tag}`, {
    url: page.url(), pagesWalked, rowsRendered: rowTexts.length,
    domHits, missingRosterCount: missingRoster.length,
    screenshot: path.basename(shot), consoleErrors: errors.length,
  });
  fs.writeFileSync(path.join(OUT, `201026112400_after_ui-${tag}-dom.txt`), bodyText);
  fs.writeFileSync(path.join(OUT, `201026112400_after_ui-${tag}-rows.txt`), rowTexts.join('\n---\n'));

  if (errors.length) { console.error(`CONSOLE ERRORS: ${errors.join(' | ')}`); process.exit(2); }
  if (domHits.length) { console.error(`DOM FAIL @${width}: ${domHits.join(', ')}`); process.exit(2); }
  if (missingRoster.length) { console.error(`RENDER GUARD FAIL: ${missingRoster.length} wire users never rendered, e.g. ${missingRoster.slice(0, 5)}`); process.exit(2); }
  if (rowTexts.length !== wireUsernames.length) { console.error(`ROW COUNT FAIL: rendered ${rowTexts.length} != wire ${wireUsernames.length}`); process.exit(2); }
  await page.close();
}

await driveUsers(1440, 1000, '01-desktop1440');
await driveUsers(390, 844, '02-mobile390');

await browser.close();
fs.writeFileSync(path.join(OUT, '201026112400_after_ui-driver.log'), LOG.map((e) => JSON.stringify(e)).join('\n') + '\nexit=0\n');
console.log('FB-061 LAN2 USERS UI DRIVE PASS (0 sample signatures rendered; roster present; wire==DOM cross-checked)');
process.exit(0);
