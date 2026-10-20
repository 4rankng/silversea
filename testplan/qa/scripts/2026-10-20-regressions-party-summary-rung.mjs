// Card 201026095604b rung-3 — party summary short display names + ID-first
// ledger join. Seeds an isolated one-day fixture (customer with short_name on
// the THU side; carrier-customer with short_name on the TRA side), drives
// /debt as ACCOUNTANT with that window, asserts the party column prints the
// OPERATIONAL SHORT NAME with the full name in the tooltip, captures the wire
// identity (partyShortName/partyId/partyKind) + the aging wire, then removes
// the fixture.
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.QA_BASE || 'http://localhost:7175';
const API = process.env.QA_API || 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
fs.mkdirSync(OUT, { recursive: true });
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY = '2026-08-20';
const SUF = `r20b-${Date.now().toString(36)}`;
const FULL_THU = `CÔNG TY TNHH MTV ${SUF.toUpperCase()}`;
const SHORT_THU = `${SUF.toUpperCase()} MINH`;
const FULL_TRA = `CÔNG TY CP VẬN TẢI ${SUF.toUpperCase()}`;
const SHORT_TRA = `${SUF.toUpperCase()} XANH`;

const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-qtA', '-c', sql], { encoding: 'utf8' }).trim();

const created = { ids: {} };
const ins = (table, col, sql) => {
  const id = psql(`insert into ${table} ${sql} returning id;`);
  created.ids[table] = created.ids[table] || [];
  created.ids[table].push(Number(id));
  return Number(id);
};

const cleanup = () => {
  // Children first: sources → entries → fee types → carrier info → trip →
  // fulfillment → container → shipment → route → customers.
  const order = [
    ['expense_accounting_sources', 'id'],
    ['ops_expense_entries', 'id'],
    ['forwarder_expense_types', 'id'],
    ['trip_carrier_info', 'trip_id'],
    ['trips', 'id'],
    ['shipment_fulfillments', 'id'],
    ['shipment_containers', 'id'],
    ['shipments', 'id'],
    ['routes', 'id'],
    ['customers', 'id'],
  ];
  for (const [table, col] of order) {
    for (const id of created.ids[table] ?? []) {
      try { psql(`delete from ${table} where ${col} = ${id};`); } catch { /* best-effort */ }
    }
  }
};

try {
  // ── Seed ──────────────────────────────────────────────────────────────
  const cThu = ins('customers', 'id', `(name, short_name, status) values ('${FULL_THU}', '${SHORT_THU}', 'ACTIVE')`);
  const cTra = ins('customers', 'id', `(name, short_name, status, is_carrier) values ('${FULL_TRA}', '${SHORT_TRA}', 'ACTIVE', true)`);
  const route = ins('routes', 'id', `(name) values ('R20B ${SUF}')`);
  const shipment = ins('shipments', 'id', `(customer_id, route_id, cargo_mode, status, expected_delivery_date) values (${cThu}, ${route}, 'FCL', 'DISPATCHED', '${DAY}')`);
  const container = ins('shipment_containers', 'id', `(shipment_id, container_number) values (${shipment}, 'R20B${(Date.now() % 100000).toString().slice(0, 7)}')`);
  const fulfillment = ins('shipment_fulfillments', 'id', `(shipment_id, shipment_container_id, fulfillment_type, cargo_mode, source_shipment_version) values (${shipment}, ${container}, 'FCL_CONTAINER', 'FCL', 1)`);
  const trip = ins('trips', 'id', `(fulfillment_id, shipment_id, customer_id, route_id, trip_code, departure_date, status) values (${fulfillment}, ${shipment}, ${cThu}, ${route}, 'TRP-${SUF}', '${DAY}', 'IN_TRANSIT')`);
  const tci = psql(`insert into trip_carrier_info (trip_id, carrier_type, external_entity_id, external_entity_type) values (${trip}, 'EXTERNAL', ${cTra}, 'CUSTOMER') returning id;`);
  created.ids['trip_carrier_info'] = created.ids['trip_carrier_info'] || [];
  created.ids['trip_carrier_info'].push(Number(tci));
  const feeCode = `R20B_${SUF}`;
  const feeType = ins('forwarder_expense_types', 'id', `(code, name, status, category, requires_invoice) values ('${feeCode}', 'R20B phí QA', 'ACTIVE', 'LIFT', false)`);
  const entry = ins('ops_expense_entries', 'id', `(shipment_id, shipment_container_id, expense_type_code, amount, customer_charge_amount, cost_group, payer_kind, paid_at) values (${shipment}, ${container}, '${feeCode}', '2000000', '2500000', 'OPS_REGULAR', 'USER', '${DAY}')`);
  ins('expense_accounting_sources', 'id', `(source_kind, source_id, shipment_id, trip_id, confirmed_at, version) values ('OPS', ${entry}, ${shipment}, ${trip}, now(), 3)`);
  log('seeded', { cThu, cTra, trip, day: DAY });

  // ── Wire identity (API, rung-2 companion) ─────────────────────────────
  const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
  const { token } = await login.json();
  const [thuWire, traWire, agingWire] = await Promise.all([
    fetch(`${API}/expense-accounting/phoi-phieu/report?kind=THU&dateFrom=${DAY}&dateTo=${DAY}&scope=ALL`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    fetch(`${API}/expense-accounting/phoi-phieu/report?kind=TRA&dateFrom=${DAY}&dateTo=${DAY}&scope=ALL`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
    fetch(`${API}/reports/receivables-aging?page=1&limit=500`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
  ]);
  const thuRow = thuWire.rows.find((r) => r.party === FULL_THU);
  const traRow = traWire.rows.find((r) => r.party === SHORT_TRA);
  const agingThu = (agingWire.customers ?? []).find((c) => c.customerId === cThu) ?? null;
  log('wire', {
    thu: thuRow && { party: thuRow.party, partyShortName: thuRow.partyShortName, partyId: thuRow.partyId, partyKind: thuRow.partyKind },
    tra: traRow && { party: traRow.party, partyId: traRow.partyId, partyKind: traRow.partyKind },
    agingHasCustomer: agingThu && { customerId: agingThu.customerId, totalOutstanding: agingThu.totalOutstanding },
  });

  // ── Drive /debt (rung 3) ──────────────────────────────────────────────
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/debt`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(6000);
  const setDay = async (name, value) => page.evaluate((n, v) => {
    const input = document.querySelector(`.pm-summary input[name="${n}"]`);
    if (!input) throw new Error(`no ${n} input`);
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, name, value);
  await setDay('pmSummaryFrom', DAY);
  await setDay('pmSummaryTo', DAY);
  // Wait for the period queries to refetch and the table to come back.
  await page.waitForFunction(
    () => !document.querySelector('.pm-summary [role=status]') && !!document.querySelector('.pm-summary table'),
    { timeout: 30000, polling: 500 },
  ).catch(() => {});
  await sleep(1500);
  const ui = await page.evaluate((shortThu, shortTra, fullThu) => {
    const section = document.querySelector('.pm-summary');
    if (!section) return { tableFound: false, sectionFound: false, bodyHint: document.body.innerText.slice(0, 120) };
    const table = section.querySelector('table');
    if (!table) return { tableFound: false, sectionFound: true, sectionText: section.textContent?.replace(/\s+/g, ' ').trim().slice(0, 240) };
    const cell = (label) => [...table.querySelectorAll('td[data-label="Chủ xe"]')].find((td) => td.textContent.trim() === label);
    const thuCell = cell(shortThu);
    const traCell = cell(shortTra);
    const conNo = (c) => c?.closest('tr')?.querySelector('td[data-label="Còn nợ"]')?.textContent?.trim() ?? null;
    const legalNameLeak = [...table.querySelectorAll('td[data-label="Chủ xe"]')].some((td) => td.textContent.includes('CÔNG TY'));
    return {
      tableFound: true,
      thuShown: !!thuCell, thuTooltip: thuCell?.getAttribute('title') ?? null,
      thuConNo: conNo(thuCell),
      traShown: !!traCell, traConNo: conNo(traCell),
      legalNameLeak,
      fullThuStillAbsentAsDisplay: !cell(fullThu),
    };
  }, SHORT_THU, SHORT_TRA, FULL_THU);
  log('ui', ui);
  await page.screenshot({ path: path.join(OUT, 'party-summary-after-shortnames.png'), fullPage: false });
  await browser.close();

  const pass = ui.tableFound && ui.thuShown && ui.thuTooltip === FULL_THU && ui.thuConNo === '0 ₫' && ui.traShown && !ui.legalNameLeak && ui.fullThuStillAbsentAsDisplay;
  log('verdict', { pass });
  if (!pass) process.exitCode = 1;
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  try { cleanup(); log('cleanup-done'); } catch (e) { log('cleanup-error', { message: e.message }); }
  fs.writeFileSync(path.join(OUT, 'party-summary-driver.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
