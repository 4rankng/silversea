/**
 * Case 2026-10-16 — /shipments-debit CHỨNG TỪ cell link: label "Chi tiết →"
 * (owner: "Chi tiet is enough, no need chi tiet lo hang").
 *
 * Rung-3 driver: drives the REAL control in a real browser, clicks it, and
 * asserts the destination — plus proves the navigation is read-only (the
 * shipments row is byte-identical before/after the click).
 *
 * Artifacts (repo contract §9, naming §7):
 *   qa/2026-10-16_debit-detail-link_ui-1-cell.png      (label in situ)
 *   qa/2026-10-16_debit-detail-link_ui-2-destination.png (after the click)
 *   qa/2026-10-16_debit-detail-link_ui-dom.json        (DOM assertions)
 *   qa/2026-10-16_debit-detail-link_ui-driver.log      (step log + exit status)
 *
 * Usage: node testplan/qa/scripts/2026-10-16-debit-detail-link-rung.mjs [baseUrl]
 *        baseUrl default http://localhost:7175
 */
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:7175').replace(/\/$/, '');
const W = Number(process.env.W || 1440);
const H = Number(process.env.H || (W <= 500 ? 844 : 900));
const SUF = process.env.W ? `-${W}` : '';
const API = `${BASE}/api`;
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const SCOPE = `2026-10-16_debit-detail-link${SUF}`;
const EXPECT_LABEL = 'Chi tiết →';
const STALE_LABEL = 'Chi tiết lô hàng →';

mkdirSync(QA, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => {
  const e = { at: new Date().toISOString(), step, ...obj };
  LOG.push(e);
  console.log(JSON.stringify(e));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql) => execFileSync(
  'docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-At', '-F', ' | ', '-c', sql],
  { encoding: 'utf8' },
).trim();

let exitCode = 0;
try {
  // ── Environment: local stack, real backend ──────────────────────────────
  const health = await fetch(`${API}/health`).then((r) => r.json());
  log('health', { buildHash: health.buildHash ?? null, status: health.status ?? 'ok' });

  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier: 'ketoan', password: 'Abc123' }),
  }).then((r) => r.json());
  if (!login.token) { log('login-FAIL', { body: JSON.stringify(login).slice(0, 200) }); process.exit(2); }
  log('login', { role: login.user?.role ?? null });

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: W, height: H });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), login.token);

  // ── Open the screen ─────────────────────────────────────────────────────
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  for (let i = 0; i < 20; i++) {
    if (await page.$('.shipment-debit-row__detail-link')) break;
    await sleep(1500);
  }

  // ── Assertion 1: every docs-cell link carries the SHORT label ───────────
  const links = await page.$$eval('.shipment-debit-row__detail-link', (els) => els.map((el) => ({
    label: (el.textContent || '').replace(/\s+/g, ' ').trim(),
    title: el.getAttribute('title'),
    href: el.getAttribute('href'),
  })));
  log('labels-scanned', { count: links.length, labels: [...new Set(links.map((l) => l.label))] });
  if (links.length === 0) { log('FAIL', { why: 'no detail links rendered — screen did not load rows' }); exitCode = 1; }

  const stale = links.filter((l) => l.label === STALE_LABEL);
  const wrong = links.filter((l) => l.label !== EXPECT_LABEL);
  const titlesOk = links.every((l) => l.title === 'Xem chi tiết lô hàng');
  log('label-assert', { expected: EXPECT_LABEL, staleCount: stale.length, wrongCount: wrong.length, titlesOk });

  const target = links[0];
  const shipmentId = Number((target?.href || '').match(/\/shipments\/(\d+)/)?.[1] ?? NaN);
  log('target', { shipmentId, href: target?.href });

  // Pre-click evidence: the label as it really renders, in its cell.
  const cell = await page.$('.shipment-debit-row__docs');
  if (cell) await cell.screenshot({ path: `${QA}/${SCOPE}_ui-1-cell.png` });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-1-page.png` });

  // ── Read-only proof: DB identity before / after the click ───────────────
  const snapSql = `SELECT id, shipment_code, status, version, bl_number, updated_at FROM shipments WHERE id = ${Number.isFinite(shipmentId) ? shipmentId : -1};`;
  const before = psql(snapSql);
  log('db-before', { row: before });

  // ── THE CLICK (rung 3 is the click) ─────────────────────────────────────
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 60000 }).catch(() => null),
    page.click('.shipment-debit-row__detail-link'),
  ]);
  await sleep(2500);
  const afterUrl = page.url();
  const destText = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 600));
  const destHeading = await page.evaluate(() => document.querySelector('h1, .page-header__title-visible')?.textContent?.trim() ?? null);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-2-destination.png`, fullPage: false });
  const after = psql(snapSql);
  log('db-after', { row: after });
  log('post-click-dom', { url: afterUrl, heading: destHeading, bodyExcerpt: destText.slice(0, 300) });

  // ── Verdicts ────────────────────────────────────────────────────────────
  const checks = {
    'links rendered': links.length > 0,
    'every link reads exactly "Chi tiết →"': links.length > 0 && wrong.length === 0,
    'no link still reads "Chi tiết lô hàng →"': stale.length === 0,
    'hover title keeps the full meaning': titlesOk,
    'click lands on /shipments/<id>': new RegExp(`/shipments/${shipmentId}($|\\?)`).test(afterUrl),
    'destination renders content (not a blank/error page)': Boolean(destHeading) || destText.length > 120,
    'navigation is read-only (DB row identical before/after)': before === after && before.length > 0,
  };
  for (const [name, ok] of Object.entries(checks)) log(ok ? 'CHECK-PASS' : 'CHECK-FAIL', { check: name });

  writeFileSync(`${QA}/${SCOPE}_ui-dom.json`, JSON.stringify({
    scope: SCOPE, baseUrl: BASE, account: 'ketoan (ACCOUNTANT)', runAt: new Date().toISOString(),
    links, checks, before, after, afterUrl, destHeading, destTextExcerpt: destText.slice(0, 400),
  }, null, 2));

  if (Object.values(checks).some((v) => !v)) exitCode = 1;
  log(exitCode === 0 ? 'RUN-PASS' : 'RUN-FAIL', { checksPassed: Object.values(checks).filter(Boolean).length, checksTotal: Object.keys(checks).length });
  await browser.close();
} catch (err) {
  log('DRIVER-ERROR', { message: String(err?.message || err).slice(0, 400) });
  exitCode = 1;
} finally {
  log('exit-status', { exitCode });
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.error(`driver exit=${exitCode} log=${QA}/${SCOPE}_ui-driver.log`);
  process.exit(exitCode);
}
