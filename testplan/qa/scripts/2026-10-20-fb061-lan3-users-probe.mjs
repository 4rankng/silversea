// FB-061 lan 3 (card 201026112400) — staging /users residual probe.
// Lan 2 (0b870f61) cleaned the user ROWS (72 users, 0 signature) and its UI
// drive only scanned `table tbody tr`. The /users page ALSO renders the
// "Đơn vị phụ trách" business-unit catalog (BusinessUnitsManager, admin-only)
// from the same /api/auth/users payload — and staging (prod-mirror) still
// holds the demo-seed unit CUS-DEMO / "Đơn vị CUS Demo" (backend/src/seed.ts
// seedClerkScope). This probe scans the WHOLE page body, not just rows.
// Read-only: login admin → GET /api/auth/users → drive /users @1440 + @390.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
// PHASE=after renames artifacts for the post-fix drive (§7 naming: a PASS
// artifact must never live in a "*before*" file). --gate turns the verdict
// into an exit code so CI wiring cannot false-pass a dirty page.
const PHASE = process.env.PHASE === 'after' ? 'after' : 'before';
const GATE = process.argv.includes('--gate');
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-fb061-lan3-users');
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash });

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
log('users_wire', {
  count: usersWire.items?.length, total: usersWire.total,
  businessUnits: usersWire.businessUnits,
});

// Sample-data signatures on the /users SURFACE (rows + unit catalog + KPI).
const FORBIDDEN = [
  ['cus-demo-name', /Nhân viên CUS\s*Demo/i],
  ['dieuvan-demo-name', /Nhân viên Điều vận\s*Demo/i],
  ['customer-demo-name', /Khách hàng\s*Demo/i],
  ['haha-probe', /HAHA/i],
  ['e2e-token', /e2e-/i],
  ['e2e-dispatcher-name', /E2E Dispatcher/i],
  ['demo-business-unit', /Đơn vị CUS\s*Demo/i],
  ['demo-unit-code', /CUS-DEMO/],
];
const wireUsernames = usersWire.items.map((u) => u.username);
const wireHay = [
  ...usersWire.items.map((u) => `${u.username} ${u.fullName ?? ''}`),
  ...((usersWire.businessUnits ?? []).map((b) => `${b.code ?? ''} ${b.name ?? ''}`)),
];
const wireHits = FORBIDDEN.filter(([, re]) => wireHay.some((t) => re.test(t)));
log('wire_scan', { hits: wireHits.map(([n]) => n) });

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

  const rowTexts = [];
  let pagesWalked = 0;
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

  const rowsText = rowTexts.join('\n');
  // WHOLE-PAGE scan (lan 2 gap: its DOM assert covered rows only).
  const bodyText = await page.evaluate(() => document.body.innerText);
  const bodyHits = FORBIDDEN.filter(([, re]) => re.test(bodyText)).map(([n]) => n);
  const rowHits = FORBIDDEN.filter(([, re]) => re.test(rowsText)).map(([n]) => n);

  const shot = path.join(OUT, `201026112400_${PHASE}_ui-${tag}-users-page.png`);
  await page.screenshot({ path: shot, fullPage: true });

  log(`ui_${tag}`, {
    url: page.url(), pagesWalked, rowsRendered: rowTexts.length,
    bodyHits, rowHits,
    screenshot: path.basename(shot), consoleErrors: errors.length,
  });
  fs.writeFileSync(path.join(OUT, `201026112400_${PHASE}_ui-${tag}-dom.txt`), bodyText);
  fs.writeFileSync(path.join(OUT, `201026112400_${PHASE}_ui-${tag}-rows.txt`), rowsText);

  await page.close();
  return { bodyHits, errors };
}

const a = await driveUsers(1440, 1000, '01-desktop1440');
const b = await driveUsers(390, 844, '02-mobile390');
await browser.close();

const verdict = {
  wireHits: wireHits.map(([n]) => n),
  bodyHits1440: a.bodyHits, bodyHits390: b.bodyHits,
  consoleErrors: a.errors.length + b.errors.length,
};
fs.writeFileSync(path.join(OUT, `users-probe-${PHASE}-driver.log`), LOG.map((e) => JSON.stringify(e)).join('\n') + '\n' + JSON.stringify(verdict) + '\n');
const dirty = verdict.wireHits.length + verdict.bodyHits1440.length + verdict.bodyHits390.length;
console.log(dirty > 0
  ? `FB-061 LAN3 ${PHASE.toUpperCase()} PROBE: DIRTY (${JSON.stringify(verdict)}) — residual sample data renders on /users`
  : `FB-061 LAN3 ${PHASE.toUpperCase()} PROBE: CLEAN (${JSON.stringify(verdict)}) — no sample signature renders`);
if (GATE && dirty > 0) process.exit(1);
process.exit(0);
