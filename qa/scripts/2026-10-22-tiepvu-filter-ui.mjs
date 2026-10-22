// Card 261022201006b — CUS date filter, rung-3 UI drive on the LOCAL worktree
// stack (frontend 7179 / backend 3006, DB 5441). Same 3-day VN boundary
// fixture as qa/scripts/2026-10-22-tiepvu-filter-boundary-probe.mjs, driven
// through the REAL Tổng quan screen:
//   F01 filter day A (boundary rows 00:30 + 23:45 VN) — both show, Z does not
//   F02 filter day B — Z shows under its OWN day (its only day), A's rows gone
// BEFORE-state evidence: probe logs (Z leaked under its old EDD day).
//
//   node qa/scripts/2026-10-22-tiepvu-filter-ui.mjs
// Env: FRONT_PORT (7179), API_PORT (3006).
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const FRONT = `http://localhost:${process.env.FRONT_PORT ?? 7179}`;
const API = `http://localhost:${process.env.API_PORT ?? 3006}/api`;
const OUT = path.resolve('qa/2026-10-22-tiepvu-b-c');
fs.mkdirSync(OUT, { recursive: true });
const LOG = path.join(OUT, '2026-10-22_tiepvu-b_ui-driver.log');
fs.writeFileSync(LOG, '');
const log = (line) => { console.log(line); fs.appendFileSync(LOG, line + '\n'); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `2026-10-22_tiepvu-b_ui-${name}.png`), fullPage: false });

let failures = 0;
const check = (name, ok, detail) => {
  log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
};
const jf = async (p, opts) => {
  const res = await fetch(`${API}${p}`, opts);
  let body = null; try { body = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body };
};
const auth = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
const psql = (sql) => execSync(`docker exec ss-prod-db psql -U postgres -d silversea -qtAX -c ${JSON.stringify(sql)}`).toString().trim();
const vnInstant = (day, hhmm) => {
  const [H, M] = hhmm.split(':').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, H, M) - 7 * 3600e3).toISOString();
};
const vnDay = (offset) => {
  const d = new Date(`${new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

const health = await fetch(`${API}/health`).then((r) => r.json()).catch(() => null);
log(`HEALTH status=${health?.status} api=${API} front=${FRONT}`);
if (health?.status !== 'ok') { log('ABORT: local API health not ok'); process.exit(2); }

const loginRes = await jf('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'cus', password: 'Abc123' }) });
const token = loginRes.body?.token;
if (!token) { log(`ABORT: login failed (${loginRes.status})`); process.exit(2); }
log('LOGIN ok role=CUS (cus)');

// ── Fixture: 3-day VN boundary set (same shape as the boundary probe) ──────
const dayA = vnDay(1), dayB = vnDay(2), day9 = vnDay(9);
const stamp = Date.now().toString().slice(-6);
const boot = (await jf('/catalogs/bootstrap', { headers: auth(token) })).body;
const customers = (await jf('/customers?limit=5', { headers: auth(token) })).body;
const cust = (customers.items ?? customers.rows ?? customers)[0];
const ct = (boot.containerTypes ?? [])[0];
const sid = {};
async function makeLot(tag, expectedDeliveryDate) {
  const r = await jf('/shipments/quick', {
    method: 'POST', headers: { ...auth(token), 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({
      customerId: cust.id, tradeDirection: 'IMPORT', blNumber: `TBFLUI${stamp}${tag}`,
      shippingLineName: 'MAERSK', expectedDeliveryDate, cargoMode: 'FCL',
      containers: [{ containerNumber: '', containerTypeId: ct.id }],
    }),
  });
  if (r.status !== 201) { log(`FIXTURE FAIL ${tag}: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`); process.exit(2); }
  sid[tag] = r.body.id;
}
await makeLot('E', day9); // appointment day A 23:45 VN (late boundary)
await makeLot('B', day9); // appointment day A 00:30 VN (early boundary)
await makeLot('Z', dayA); // EDD says day A, container reappointed to day B
const cids = (tag) => psql(`select id from shipment_containers where shipment_id=${sid[tag]} order by id`).split('\n').filter(Boolean).map(Number);
psql(`update shipment_containers set customer_appointment_at='${vnInstant(dayA, '23:45')}' where id=${cids('E')[0]}`);
psql(`update shipment_containers set customer_appointment_at='${vnInstant(dayA, '00:30')}' where id=${cids('B')[0]}`);
psql(`update shipment_containers set customer_appointment_at='${vnInstant(dayB, '10:00')}' where id=${cids('Z')[0]}`);
const dbProof = psql(`select bl_number || ' | EDD=' || coalesce(expected_delivery_date::text,'NULL') || ' | appt=' || coalesce(customer_appointment_at::text,'NULL') from shipments join shipment_containers on shipment_containers.shipment_id=shipments.id where bl_number like 'TBFLUI${stamp}%' order by bl_number`);
fs.writeFileSync(path.join(OUT, '2026-10-22_tiepvu-b_db-fixture.txt'),
  `fixture (VN days: A=${dayA} B=${dayB}):\n${dbProof}\n`);
log(`FIXTURE lots=${JSON.stringify(sid)} (bl prefix TBFLUI${stamp}) dayA=${dayA} dayB=${dayB}`);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
await page.evaluateOnNewDocument((t) => { if (location.origin.startsWith('http://localhost')) localStorage.setItem('token', t); }, token);
const consoleErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
const requests = [];
page.on('request', (r) => { if (r.url().includes('/api/shipments/cus-workspace')) requests.push(r.url()); });

const drive = async (day, name) => {
  requests.length = 0;
  await page.goto(`${FRONT}/shipments?searchSuffix=TBFLUI${stamp}&transportDateFrom=${day}&transportDateTo=${day}`, { waitUntil: 'networkidle2' });
  await sleep(1200);
  await shot(page, name);
  return page.evaluate(() => document.body.textContent ?? '');
};

// ── F01: filter day A — both boundary rows show; the reappointed Z does not ─
const textA = await drive(dayA, 'filter-dayA');
const apiA = requests.find((u) => u.includes('transportDateFrom='));
check('F01 request carries YYYY-MM-DD day-A bounds', Boolean(apiA?.includes(`transportDateFrom=${dayA}`)) && Boolean(apiA?.includes(`transportDateTo=${dayA}`)), apiA ?? 'no request captured');
check('F01 late-boundary lot (23:45 VN) shows under day A', textA.includes(`TBFLUI${stamp}E`));
check('F01 early-boundary lot (00:30 VN) shows under day A', textA.includes(`TBFLUI${stamp}B`));
check('F01 reappointed Z absent under its old EDD day A', !textA.includes(`TBFLUI${stamp}Z`));

// ── F02: filter day B — Z shows under its own day only ─────────────────────
const textB = await drive(dayB, 'filter-dayB');
check('F02 reappointed Z shows under its appointment day B', textB.includes(`TBFLUI${stamp}Z`));
check('F02 day-A boundary lots absent under day B', !textA.includes(`TBFLUI${stamp}Z`) && !textB.includes(`TBFLUI${stamp}E`) && !textB.includes(`TBFLUI${stamp}B`));

check('console errors none', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean');
await browser.close();

// ── Cleanup (fixture rows only) ────────────────────────────────────────────
psql(`update shipments set deleted_at=now() where bl_number like 'TBFLUI${stamp}%'`);
log(`CLEANUP fixture TBFLUI${stamp}% soft-deleted`);
log(`DONE failures=${failures}`);
process.exit(failures > 0 ? 1 : 0);
