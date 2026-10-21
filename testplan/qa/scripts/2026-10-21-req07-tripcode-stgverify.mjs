// REQ-07 — format mã chuyến trong Driver App — STAGING verify, READ-ONLY.
// Scenarios REQ07T-01..03 from testplan/2026-10-21-req07-tripcode.md, driven at
// 390px against https://vantai.tingting.vip. Derived from
// 2026-10-21-req07-tripcode-ui-drive.mjs (local) with BASE/API/auth moved to
// staging. Only GETs + the login POST (no password change, no business write).
//
//   node testplan/qa/scripts/2026-10-21-req07-tripcode-stgverify.mjs
//
// Env: STG_BASE (https://vantai.tingting.vip), BUILD_HASH (454fab6b),
//      DRIVERS (comma list, data-bearing drivers; default vvtrung,tvtham),
//      EMPTY_DRIVER (bqhuong — the brief's named driver).
// The expected label derives from the tripCode the API returns for the driver
// (TRP-<YYYYMM>-<seq> → "TRP <yyyy>-<mm> · <seq>"), never a hardcoded literal.
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.STG_BASE ?? 'https://vantai.tingting.vip';
const API = `${BASE}/api`;
const ANCHOR = process.env.BUILD_HASH ?? '454fab6b';
const DRIVERS = (process.env.DRIVERS ?? 'vvtrung,tvtham').split(',');
const EMPTY_DRIVER = process.env.EMPTY_DRIVER ?? 'bqhuong';
const PASSWORD = 'Abc123'; // staging rule, testplan/testaccounts.txt
const OUT = path.resolve('qa/2026-10-21-req07-tripcode-stgverify');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, 'ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, `${line}\n`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};

// Anchor gate: run before every evidence capture. Drift => stop, no evidence.
const assertAnchor = async (where) => {
  const h = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
  log(`HEALTH@${where} ${new Date().toISOString()} status=${h?.status} buildHash=${h?.buildHash}`);
  if (h?.status !== 'ok' || h?.buildHash !== ANCHOR) {
    log(`ABORT: build drift at ${where} (expected ${ANCHOR}, got ${h?.buildHash})`);
    process.exit(3);
  }
};

const login = async (identifier) => {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password: PASSWORD }),
  });
  if (!res.ok) { log(`ABORT: login failed for ${identifier} (${res.status})`); process.exit(2); }
  log(`LOGIN ok driver=${identifier}`);
  return (await res.json()).token;
};
const get = (p, token) => fetch(`${API}${p}`, { headers: { Authorization: `Bearer ${token}` } })
  .then((r) => r.json());

const labelFor = (code) => {
  const m = code.match(/^TRP-(\d{4})(\d{2})-(\d+)$/);
  return m ? `TRP ${m[1]}-${m[2]} · ${m[3].padStart(4, '0')}` : code;
};

await assertAnchor('run-start');

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const consoleErrors = [];
const domFacts = {};

const newPage = async (token) => {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((t, origin) => { if (location.origin === origin) localStorage.setItem('token', t); }, token, BASE);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text()}`); });
  return page;
};
const shot = async (page, name, where) => {
  await assertAnchor(where);
  await page.screenshot({ path: path.join(OUT, `ui-${name}.png`), fullPage: false });
};

// ── REQ07T-01 / REQ07T-02: every data-bearing staging driver ────────────────
for (const driver of DRIVERS) {
  const token = await login(driver);
  const board = await get('/driver/me/journey-board', token);
  const cards = (board.items ?? []).filter((c) => c.tripCode);
  log(`BOARD driver=${driver} items=${board.items?.length ?? 0} withTripCode=${cards.length}`);
  if (cards.length === 0) { check(`${driver} has board data`, false, 'no card with tripCode'); continue; }
  const card = cards[0];
  const expected = labelFor(card.tripCode);
  const bill = card.blNumber ?? card.bookingRef;
  log(`TARGET driver=${driver} tripId=${card.tripId} tripCode=${card.tripCode} bill=${bill} expected="${expected}"`);

  const page = await newPage(token);
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.driver-journey-card', { timeout: 30000 });
  await sleep(600);
  await shot(page, `01-list-390-${driver}`, `T01-${driver}`);
  const codeLines = await page.$$eval('[data-testid="trip-code"]', (els) => els.map((el) => el.textContent?.trim()));
  const body = await page.evaluate(() => document.body.textContent);
  check(`T01 ${driver} formatted code line`, codeLines.includes(`Mã chuyến ${expected}`), JSON.stringify(codeLines));
  check(`T01 ${driver} raw generator string absent`, !body.includes(card.tripCode));
  check(`T01 ${driver} SHP- code never displayed`, !body.includes(card.shipmentCode));
  check(`T01 ${driver} every code line carries Mã chuyến label`, codeLines.every((l) => l?.startsWith('Mã chuyến')), JSON.stringify(codeLines));
  const billLead = await page.$eval('.driver-journey-card__bill', (el) => el.textContent?.trim());
  check(`T01 ${driver} bill/booking still lead identity`, Boolean(bill) && billLead.includes(bill), billLead);
  domFacts[`${driver}-list`] = { codeLines, billLead };

  await page.goto(`${BASE}/my-trips/${card.tripId}`, { waitUntil: 'networkidle2' });
  await page.waitForSelector('.driver-task-fact', { timeout: 30000 });
  await sleep(600);
  await shot(page, `02-detail-390-${driver}`, `T02-${driver}`);
  const fact = await page.evaluate(() => {
    const first = document.querySelector('.driver-task-fact');
    return {
      label: first?.querySelector('.driver-task-fact__label')?.textContent?.trim(),
      value: first?.querySelector('.driver-task-fact__value')?.textContent?.trim(),
      order: Array.from(document.querySelectorAll('.driver-task-fact__label')).map((el) => el.textContent?.trim()),
      values: Array.from(document.querySelectorAll('.driver-task-fact')).slice(0, 3).map((el) => el.textContent?.trim()),
    };
  });
  check(`T02 ${driver} first fact row is Mã chuyến`, fact.label === 'Mã chuyến', fact.label ?? 'none');
  check(`T02 ${driver} formatted value`, fact.value === expected, fact.value ?? 'none');
  check(`T02 ${driver} schedule row follows`, fact.order[1] === 'Ngày giờ kế hoạch', JSON.stringify(fact.order.slice(0, 3)));
  const detailBody = await page.evaluate(() => document.body.textContent);
  check(`T02 ${driver} raw generator string absent`, !detailBody.includes(card.tripCode));
  domFacts[`${driver}-detail`] = fact;
  await page.close();
}

// ── Brief's named driver: empty-state evidence (no trips on staging) ────────
{
  const token = await login(EMPTY_DRIVER);
  const board = await get('/driver/me/journey-board', token);
  log(`BOARD driver=${EMPTY_DRIVER} items=${board.items?.length ?? 0} (named driver in brief)`);
  const page = await newPage(token);
  await page.goto(`${BASE}/my-trips`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, `01-list-390-${EMPTY_DRIVER}-empty`, `T01-${EMPTY_DRIVER}`);
  const txt = await page.evaluate(() => document.body.textContent);
  domFacts[`${EMPTY_DRIVER}-list`] = { cards: await page.$$eval('.driver-journey-card', (e) => e.length), snippet: txt.slice(0, 200) };
  check(`${EMPTY_DRIVER} list renders without trip-code rows`, (await page.$$('[data-testid="trip-code"]')).length === (board.items ?? []).filter((c) => c.tripCode).length);
  await page.close();
}

// ── REQ07T-03: penalty with real trip — count first, drive if any exist ─────
{
  const adminToken = await login('admin');
  const all = await get('/penalties?limit=100&page=1', adminToken);
  const insights = await get('/penalties/insights', adminToken).catch(() => null);
  log(`PENALTY-COUNT admin GET /penalties total=${all.total} statusCounts=${JSON.stringify(all.statusCounts)} itemsWithTripId=${(all.items ?? []).filter((p) => p.tripId).length}`);
  log(`PENALTY-INSIGHTS month=${JSON.stringify(insights?.month)} ytd=${JSON.stringify(insights?.ytd)} driverTotal=${insights?.driverTotal}`);
  fs.writeFileSync(path.join(OUT, 'api-penalties-count.json'), JSON.stringify({ at: new Date().toISOString(), total: all.total, statusCounts: all.statusCounts, items: all.items, insightsMonth: insights?.month, insightsYtd: insights?.ytd }, null, 2));
  const withTrip = (all.items ?? []).filter((p) => p.tripId && p.tripCode);

  let penaltyDriver = DRIVERS[0];
  if (withTrip.length > 0) {
    log(`T03 real penalty with trip exists: id=${withTrip[0].id} tripCode=${withTrip[0].tripCode} driverId=${withTrip[0].driverId}`);
    log('T03 NOTE: driver login for that driver is out of the named set — extend DRIVERS to drive it');
  } else {
    log('T03 NOT-COVERED-ATTEMPTED: 0 penalties with a trip on staging; formatted meta row cannot be UI-driven without creating a financial record (forbidden: staging data immutable, read-only brief)');
  }
  const token = await login(penaltyDriver);
  const mine = await get('/driver/me/penalties', token);
  log(`PENALTY-DRIVER driver=${penaltyDriver} items=${mine.items?.length ?? 0}`);
  const page = await newPage(token);
  await page.goto(`${BASE}/my-penalties`, { waitUntil: 'networkidle2' });
  await sleep(900);
  await shot(page, `03-penalties-390-${penaltyDriver}`, `T03-${penaltyDriver}`);
  const penaltyText = await page.evaluate(() => document.body.textContent);
  check('T03 penalty surface renders cleanly (empty-state)', /Vi phạm|Chưa có/i.test(penaltyText));
  if (mine.items?.length) {
    const metas = (mine.items).filter((p) => p.tripId && p.tripCode);
    for (const p of metas) {
      check(`T03 formatted meta for penalty ${p.id}`, penaltyText.includes(labelFor(p.tripCode)) && !penaltyText.includes(p.tripCode));
    }
  }
  await page.close();
}

check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
fs.writeFileSync(path.join(OUT, 'dom-facts.json'), JSON.stringify(domFacts, null, 2));
await browser.close();
log('DATA: read-only run — only GETs and login POSTs; no shipment/trip/penalty mutated');
log(`DONE failures=${failures}`);
process.exit(failures === 0 ? 0 : 1);
