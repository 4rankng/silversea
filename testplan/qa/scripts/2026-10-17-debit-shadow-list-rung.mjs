/**
 * Case 2026-10-17 — /shipments-debit shadow line must NAME the trips it
 * excludes: `Xem danh sách (N)` expands inline to Mã chuyến · lô · khách hàng
 * · ngày chạy · phí, for every role that can see the line.
 *
 * Rung-3 driver (UI DRIVEN requires all four artifact kinds):
 *   qa/2026-10-17_debit-shadow-list_ui-1-line.png       (line + toggle, pre-click)
 *   qa/2026-10-17_debit-shadow-list_ui-2-open.png       (after the click)
 *   qa/2026-10-17_debit-shadow-list_ui-3-manager.png    (MANAGER — read-only role)
 *   qa/2026-10-17_debit-shadow-list_ui-4-phone390.png   (phone width)
 *   qa/2026-10-17_debit-shadow-list_ui-dom.json         (DOM/text assertions)
 *   qa/2026-10-17_debit-shadow-list_ui-driver.log       (step log + exit status)
 *
 * Usage: node testplan/qa/scripts/2026-10-17-debit-shadow-list-rung.mjs [baseUrl]
 */
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = (process.argv[2] || 'http://localhost:7175').replace(/\/$/, '');
const API = `${BASE}/api`;
const QA = '/Volumes/LexarSSD/projects/silversea/qa';
const SCOPE = '2026-10-17_debit-shadow-list';

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

const checks = {};
const check = (name, ok, detail = {}) => { checks[name] = ok; log(ok ? 'CHECK-PASS' : 'CHECK-FAIL', { check: name, ...detail }); };

let exitCode = 0;
try {
  const health = await fetch(`${API}/health`).then((r) => r.json());
  log('health', { buildHash: health.buildHash ?? null });

  const login = async (identifier) => {
    const body = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: 'Abc123' }),
    }).then((r) => r.json());
    if (!body.token) { log('login-FAIL', { identifier, body: JSON.stringify(body).slice(0, 160) }); process.exit(2); }
    return { token: body.token, role: body.user?.role ?? null };
  };

  // ── API rung: payload identity + internal consistency ─────────────────────
  const ketoan = await login('ketoan');
  const summary = await fetch(`${API}/shipments/debit-summary?lockStatus=ALL`, {
    headers: { Authorization: `Bearer ${ketoan.token}` },
  }).then((r) => r.json());
  const trips = summary.excludedTrips ?? [];
  const sumTrips = trips.reduce((acc, t) => acc + Number(t.feeSum), 0);
  log('api-summary', {
    excludedCount: summary.excludedCount,
    excludedSum: summary.excludedSum,
    tripsLength: trips.length,
    sumOfFees: String(sumTrips),
    sample: trips[0] ?? null,
  });
  check('API carries trip identities', trips.length > 0 && trips.length === summary.excludedCount,
    { tripsLength: trips.length, excludedCount: summary.excludedCount });
  check('entries sum to excludedSum', Math.abs(sumTrips - Number(summary.excludedSum)) < 0.005,
    { sumTrips, excludedSum: summary.excludedSum });

  const target = trips[0];
  // DB side-effect proof (read-only change): the listed trip row + its lot,
  // captured before any click and compared after.
  const snapSql = `SELECT t.id, t.trip_code, t.fulfillment_id IS NULL AS unattached, t.departure_date,
                          s.id, s.status, s.updated_at,
                          coalesce(sum(te.buy_amount) filter (where te.buy_amount > 0), 0)
                     FROM trips t
                     JOIN shipments s ON s.id = t.shipment_id
                     LEFT JOIN trip_expenses te ON te.trip_id = t.id AND te.approval_status <> 'VOIDED'
                    WHERE t.id = ${Number.isFinite(Number(target?.tripId)) ? Number(target.tripId) : -1}
                    GROUP BY t.id, t.trip_code, t.departure_date, s.id, s.status, s.updated_at;`;
  const before = psql(snapSql);
  log('db-before', { row: before });
  const beforeFields = before.split(' | ');
  check('payload trip is fulfillment-NULL in the DB', beforeFields[2] === 't',
    { unattachedFlag: beforeFields[2], row: before.slice(0, 200) });

  const openLine = async (page, expectRole) => {
    for (let i = 0; i < 25; i++) {
      if (await page.$('.shipment-debit-shadow-line')) break;
      await sleep(1200);
    }
    const line = await page.$eval('.shipment-debit-shadow-line', (el) => ({
      text: (el.textContent || '').replace(/\s+/g, ' ').trim(),
      role: el.getAttribute('role'),
    })).catch(() => null);
    const toggle = await page.$('.shipment-debit-shadow-line__toggle');
    const toggleText = toggle ? await toggle.evaluate((el) => (el.textContent || '').trim()) : null;
    log('line-visible', { role: expectRole, line, toggleText });
    return { line, toggle };
  };

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

  // ── Role 1: ACCOUNTANT — THE click ────────────────────────────────────────
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoan.token);
  await page.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);

  const { line, toggle } = await openLine(page, 'ACCOUNTANT');
  check('line renders with role=status', Boolean(line && line.role === 'status'), { line });
  check('line states N chuyến — X ₫ — chưa vào chốt',
    Boolean(line && /chuyến chưa gán đầu việc vận chuyển — .+ ₫ chưa vào chốt/.test(line.text)), { text: line?.text });
  check('line carries the toggle', Boolean(toggle), { toggleText: toggle ? 'present' : 'MISSING' });
  const toggleText = await toggle?.evaluate((el) => (el.textContent || '').trim());
  check('toggle names the count', Boolean(toggleText && /Xem danh sách \(\d+\)/.test(toggleText)), { toggleText });
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-1-line.png` });

  // Pre-click: the list is not rendered at all.
  const preList = await page.$('#shipment-debit-shadow-trips');
  check('collapsed = list not in the DOM', preList === null);

  await toggle.evaluate((el) => el.click());
  await sleep(600);
  const opened = await page.evaluate(() => {
    const list = document.getElementById('shipment-debit-shadow-trips');
    const btn = document.querySelector('.shipment-debit-shadow-line__toggle');
    return {
      expanded: btn?.getAttribute('aria-expanded'),
      btnText: (btn?.textContent || '').trim(),
      rows: list ? list.querySelectorAll('li').length : 0,
      firstRow: list ? (list.querySelector('li')?.textContent || '').replace(/\s+/g, ' ').trim() : null,
      allText: (list?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 400),
    };
  });
  log('after-click', opened);
  await page.screenshot({ path: `${QA}/${SCOPE}_ui-2-open.png` });
  check('click flips aria-expanded + relabels to Ẩn danh sách',
    opened.expanded === 'true' && opened.btnText === 'Ẩn danh sách', { opened });
  check('list renders every trip in the payload', opened.rows === trips.length, { rows: opened.rows, trips: trips.length });
  const expectRowBits = [target.tripCode ?? 'Chưa có mã chuyến', target.lotLabel, String(target.departureDate ?? '')].filter(Boolean);
  check('first row names the trip the API named',
    expectRowBits.every((bit) => (opened.firstRow ?? '').includes(bit)),
    { expectRowBits, firstRow: opened.firstRow });

  // Collapse again — the list leaves the DOM.
  await page.click('.shipment-debit-shadow-line__toggle');
  await sleep(400);
  const collapsed = await page.evaluate(() => ({
    listGone: document.getElementById('shipment-debit-shadow-trips') === null,
    expanded: document.querySelector('.shipment-debit-shadow-line__toggle')?.getAttribute('aria-expanded'),
    lineStillThere: Boolean(document.querySelector('.shipment-debit-shadow-line')),
  }));
  log('after-collapse', collapsed);
  check('collapse removes the list and keeps the line',
    collapsed.listGone && collapsed.expanded === 'false' && collapsed.lineStillThere, { collapsed });

  const after = psql(snapSql);
  check('navigation/edit-free: trip + lot row identical before/after', before === after && before.length > 0,
    { before, after });
  await page.close();

  // ── Role 2: MANAGER (read-only) — the old dead-end, now actionable ────────
  const manager = await login('giamdoc');
  const pageM = await browser.newPage();
  await pageM.setViewport({ width: 1440, height: 900 });
  await pageM.evaluateOnNewDocument((t) => localStorage.setItem('token', t), manager.token);
  await pageM.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  const m = await openLine(pageM, 'MANAGER');
  check('MANAGER sees the line + toggle', Boolean(m.line && m.toggle), { line: m.line, toggle: Boolean(m.toggle) });
  if (m.toggle) {
    await m.toggle.evaluate((el) => el.click());
    await sleep(600);
    const mRows = await pageM.evaluate(() => document.querySelectorAll('#shipment-debit-shadow-trips li').length);
    check('MANAGER can open the list (no canManage gate)', mRows > 0, { mRows });
    await pageM.screenshot({ path: `${QA}/${SCOPE}_ui-3-manager.png` });
  }
  await pageM.close();

  // ── Width 390: the line sits above both layouts — same disclosure ─────────
  const pageP = await browser.newPage();
  await pageP.setViewport({ width: 390, height: 844 });
  await pageP.evaluateOnNewDocument((t) => localStorage.setItem('token', t), ketoan.token);
  await pageP.goto(`${BASE}/shipments-debit`, { waitUntil: 'networkidle2', timeout: 90000 });
  await sleep(2500);
  const p = await openLine(pageP, 'PHONE-390');
  check('phone 390 renders the line + toggle', Boolean(p.line && p.toggle), { line: p.line, toggle: Boolean(p.toggle) });
  if (p.toggle) {
    await p.toggle.evaluate((el) => el.click());
    await sleep(600);
    const pRows = await pageP.evaluate(() => document.querySelectorAll('#shipment-debit-shadow-trips li').length);
    check('phone 390 opens the list', pRows === trips.length, { pRows });
    await pageP.screenshot({ path: `${QA}/${SCOPE}_ui-4-phone390.png` });
  }
  await pageP.close();

  await browser.close();
  writeFileSync(`${QA}/${SCOPE}_ui-dom.json`, JSON.stringify({
    scope: SCOPE, baseUrl: BASE, runAt: new Date().toISOString(),
    accounts: { accountant: 'ketoan', manager: 'giamdoc' },
    api: { excludedCount: summary.excludedCount, excludedSum: summary.excludedSum, trips: trips.slice(0, 5) },
    checks, dbBefore: before, dbAfter: after,
  }, null, 2));
  if (Object.values(checks).some((v) => !v)) exitCode = 1;
  log(exitCode === 0 ? 'RUN-PASS' : 'RUN-FAIL',
    { passed: Object.values(checks).filter(Boolean).length, total: Object.keys(checks).length });
} catch (err) {
  log('DRIVER-ERROR', { message: String(err?.message || err).slice(0, 500) });
  exitCode = 1;
} finally {
  log('exit-status', { exitCode });
  writeFileSync(`${QA}/${SCOPE}_ui-driver.log`, LOG.map((e) => JSON.stringify(e)).join('\n') + '\n');
  console.error(`driver exit=${exitCode} log=${QA}/${SCOPE}_ui-driver.log`);
  process.exit(exitCode);
}
