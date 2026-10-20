// Ticket 201026090200 (card 191026202000) — staging re-verify on the CURRENT
// build: the chốt-debit board must show operational SHORT names in Thông tin
// lô hàng + Phân xe (fix 65acec44). Read-only; hard build-currency gate —
// the original verify-fail was a stale staging backend, so a verdict without
// the build check would repeat the same false alarm.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const OUT = process.env.OUT_DIR || path.resolve(import.meta.dirname, '../../../qa/2026-10-20-verifyfail');
const EXPECT_BUILD = process.env.EXPECT_BUILD || 'c7d305ce';
const IDENTIFIER = process.env.IDENTIFIER || 'hoapt'; // ACCOUNTANT — QA repro role
const PASSWORD = 'Abc123';
fs.mkdirSync(OUT, { recursive: true });

const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const health = await (await fetch(`${API}/health`)).json();
log('build_gate', { buildHash: health.buildHash, expected: EXPECT_BUILD, ok: health.buildHash === EXPECT_BUILD });
if (health.buildHash !== EXPECT_BUILD) {
  fs.writeFileSync(path.join(OUT, '201026090200_build-gate.json'), JSON.stringify(health, null, 2));
  console.error('BLOCKED: staging build is not the current build');
  process.exit(2);
}

const login = await fetch(`${API}/auth/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ identifier: IDENTIFIER, password: PASSWORD }),
});
if (!login.ok) { console.error(`BLOCKED: login ${IDENTIFIER} -> ${login.status}`); process.exit(2); }
const { token, user } = await login.json();
log('login', { user: user?.username ?? IDENTIFIER, role: user?.role });

// Wire proof straight from the deployed backend (the class the fix touched).
// The defect law is narrow: a full LEGAL name (starts with "CÔNG TY") must not
// ride the board when an operational short name exists. Abbreviated names like
// "TNHH SX TM Dệt May Vân Trung" ARE short names, not leaks.
const wire = await (await fetch(`${API}/accounting/debit-board?page=1&limit=50`, { headers: { Authorization: `Bearer ${token}` } })).json();
const wireRows = wire.items ?? wire.data ?? wire.rows ?? [];
const wireCustomer = wireRows.slice(0, 10).map((r) => r.customerName ?? null);
const wireLongMinh = wireRows.filter((r) => typeof r.customerName === 'string' && /LONG MINH/i.test(r.customerName)).map((r) => r.customerName);
const wireFullLegal = [...new Set(wireRows.map((r) => r.customerName ?? null).filter((n) => typeof n === 'string' && n.trim().startsWith('CÔNG TY')))];
log('wire_probe', { rowCount: wireRows.length, customerNameSamples: wireCustomer, longMinhWireNames: [...new Set(wireLongMinh)], fullLegalNamesLeaking: wireFullLegal });

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
await page.evaluateOnNewDocument((t) => {
  localStorage.setItem('token', t);
  localStorage.setItem('accounting-debit-hidden-cols', '[]'); // explicit show-all → Phân xe renders
}, token);

await page.goto(`${BASE}/accounting/chot-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
await page.waitForSelector('.debit-board, [class*="empty"]', { timeout: 90000 });
await sleep(2000);

const board = await page.evaluate(() => {
  const cells = (sel) => [...document.querySelectorAll(sel)].map((el) => (el.textContent || '').trim());
  const lotCells = cells('.debit-col--lot .name-cell');
  const truckCells = cells('.debit-col--truck .name-cell');
  return {
    lotCellCount: lotCells.length,
    lotSamples: lotCells.slice(0, 8),
    truckCellCount: truckCells.length,
    truckSamples: truckCells.slice(0, 8),
    longMinhCell: lotCells.find((t) => t === 'LONG MINH') ?? null,
    longMinhFullLeak: lotCells.find((t) => /CÔNG TY TNHH MTV LONG MINH/i.test(t)) ?? null,
    truckFullLeak: truckCells.find((t) => /CÔNG TY|TNHH|CỔ PHẦN/i.test(t)) ?? null,
    firstTruckCell: truckCells[0] ?? null,
  };
});
log('board_read', board);
await page.screenshot({ path: path.join(OUT, '201026090200_ui-01-debit-board.png') });

const detail = await page.evaluate(() => {
  const grab = (sel, want) => {
    const el = [...document.querySelectorAll(sel)].find((n) => (n.textContent || '').trim() === want);
    if (!el) return null;
    el.scrollIntoView({ block: 'center' });
    return { text: (el.textContent || '').trim(), title: el.getAttribute('title'), aria: el.getAttribute('aria-label') };
  };
  return {
    customer: grab('.debit-col--lot .name-cell', 'LONG MINH'),
    // B77 is a local-dev fixture label; staging's live short carrier is BIỂN XANH.
    carrier: grab('.debit-col--truck .name-cell', 'B77') ?? grab('.debit-col--truck .name-cell', 'BIỂN XANH') ?? { text: null },
  };
});
await sleep(600);
if (detail.customer) await page.screenshot({ path: path.join(OUT, '201026090200_ui-02-customer-shortname.png') });
if (detail.carrier?.text) await page.screenshot({ path: path.join(OUT, '201026090200_ui-03-phanxe-shortname.png') });
await browser.close();

const checks = [
  { name: 'board rendered rows', ok: board.lotCellCount > 0 },
  { name: 'LONG MINH short name cell present', ok: Boolean(board.longMinhCell) },
  { name: 'no full legal LONG MINH leaks in Thông tin lô hàng', ok: !board.longMinhFullLeak },
  { name: 'no full legal carrier name leaks in Phân xe', ok: !board.truckFullLeak },
  { name: 'wire LONG MINH rows carry the short name exactly', ok: wireLongMinh.length > 0 && wireLongMinh.every((n) => n === 'LONG MINH') },
  { name: 'wire carries no CÔNG TY-prefixed legal names (65acec44 live)', ok: wireFullLegal.length === 0 },
  { name: 'customer tooltip present on NameCell', ok: detail.customer ? Boolean(detail.customer.title) : false },
];
const failed = checks.filter((c) => !c.ok);
for (const c of checks) log('check', { name: c.name, ok: c.ok });
log('console_errors', { count: errors.length, errors: errors.slice(0, 5) });
fs.writeFileSync(path.join(OUT, '201026090200_ui-driver.log'), JSON.stringify(LOG, null, 2));
console.log(failed.length === 0 && errors.length === 0 ? 'RUNG3_DRIVE_PASS' : 'RUNG3_DRIVE_FAIL');
process.exit(failed.length === 0 && errors.length === 0 ? 0 : 1);
