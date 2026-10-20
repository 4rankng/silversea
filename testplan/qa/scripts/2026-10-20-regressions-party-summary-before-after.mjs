// Before/after pair for card 201026095604b: seeds the fixture once, flips the
// component to HEAD (old full-name display), screenshots BEFORE, restores the
// working-tree version (short-name display), screenshots AFTER.
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://localhost:7175';
const API = 'http://localhost:3002/api';
const OUT = path.resolve(import.meta.dirname, '../../../qa/2026-10-20-regressions');
const REPO = path.resolve(import.meta.dirname, '../../..');
const COMPONENT = 'frontend/src/features/accounting/PartyMonthlyProductionSummary.tsx';
const LOG = [];
const log = (step, obj = {}) => { const e = { at: new Date().toISOString(), step, ...obj }; LOG.push(e); console.log(JSON.stringify(e)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DAY = '2026-08-20';
const SUF = `r20b-${Date.now().toString(36)}`;
const FULL_THU = `CÔNG TY TNHH MTV ${SUF.toUpperCase()}`;
const SHORT_THU = `${SUF.toUpperCase()} MINH`;
const SHORT_TRA = `${SUF.toUpperCase()} XANH`;

const psql = (sql) => execFileSync('docker', ['exec', 'ss-prod-db', 'psql', '-U', 'postgres', '-d', 'silversea', '-qtA', '-c', sql], { encoding: 'utf8' }).trim();
const created = { ids: {} };
const ins = (table, sql) => {
  const id = Number(psql(`insert into ${table} ${sql} returning id;`));
  (created.ids[table] = created.ids[table] || []).push(id);
  return id;
};
const cleanup = () => {
  for (const [table, col] of [['expense_accounting_sources', 'id'], ['ops_expense_entries', 'id'], ['forwarder_expense_types', 'id'], ['trip_carrier_info', 'trip_id'], ['trips', 'id'], ['shipment_fulfillments', 'id'], ['shipment_containers', 'id'], ['shipments', 'id'], ['routes', 'id'], ['customers', 'id']]) {
    for (const id of created.ids[table] ?? []) { try { psql(`delete from ${table} where ${col} = ${id};`); } catch { /* best-effort */ } }
  }
};

const loginRes = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const { token } = await loginRes.json();

const drive = async (shotName) => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
  await page.goto(`${BASE}/debt`, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(5000);
  await page.evaluate((from, to) => {
    for (const [name, value] of [['pmSummaryFrom', from], ['pmSummaryTo', to]]) {
      const input = document.querySelector(`.pm-summary input[name="${name}"]`);
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, DAY, DAY);
  await page.waitForFunction(() => !!document.querySelector('.pm-summary table'), { timeout: 30000, polling: 500 }).catch(() => {});
  await sleep(1200);
  const state = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.pm-summary td[data-label="Chủ xe"]')].map((td) => td.textContent.trim());
    return { cells };
  });
  // Scroll the summary into view so the shot shows the party column.
  await page.evaluate(() => document.querySelector('.pm-summary')?.scrollIntoView({ block: 'center' }));
  await sleep(300);
  await page.screenshot({ path: path.join(OUT, shotName), fullPage: false });
  await browser.close();
  return state;
};

try {
  // Seed.
  const cThu = ins('customers', `(name, short_name, status) values ('${FULL_THU}', '${SHORT_THU}', 'ACTIVE')`);
  const cTra = ins('customers', `(name, short_name, status, is_carrier) values ('CÔNG TY CP ${SUF.toUpperCase()}', '${SHORT_TRA}', 'ACTIVE', true)`);
  const route = ins('routes', `(name) values ('R20B ${SUF}')`);
  const shipment = ins('shipments', `(customer_id, route_id, cargo_mode, status, expected_delivery_date) values (${cThu}, ${route}, 'FCL', 'DISPATCHED', '${DAY}')`);
  const container = ins('shipment_containers', `(shipment_id, container_number) values (${shipment}, 'R20B${(Date.now() % 100000).toString().slice(0, 7)}')`);
  const fulfillment = ins('shipment_fulfillments', `(shipment_id, shipment_container_id, fulfillment_type, cargo_mode, source_shipment_version) values (${shipment}, ${container}, 'FCL_CONTAINER', 'FCL', 1)`);
  const trip = ins('trips', `(fulfillment_id, shipment_id, customer_id, route_id, trip_code, departure_date, status) values (${fulfillment}, ${shipment}, ${cThu}, ${route}, 'TRP-${SUF}', '${DAY}', 'IN_TRANSIT')`);
  (created.ids['trip_carrier_info'] = []).push(Number(psql(`insert into trip_carrier_info (trip_id, carrier_type, external_entity_id, external_entity_type) values (${trip}, 'EXTERNAL', ${cTra}, 'CUSTOMER') returning id;`)));
  const feeCode = `R20B_${SUF}`;
  ins('forwarder_expense_types', `(code, name, status, category, requires_invoice) values ('${feeCode}', 'R20B phí QA', 'ACTIVE', 'LIFT', false)`);
  const entry = ins('ops_expense_entries', `(shipment_id, shipment_container_id, expense_type_code, amount, customer_charge_amount, cost_group, payer_kind, paid_at) values (${shipment}, ${container}, '${feeCode}', '2000000', '2500000', 'OPS_REGULAR', 'USER', '${DAY}')`);
  ins('expense_accounting_sources', `(source_kind, source_id, shipment_id, trip_id, confirmed_at, version) values ('OPS', ${entry}, ${shipment}, ${trip}, now(), 3)`);
  log('seeded', { SUF });

  // BEFORE: flip component to HEAD (old full-name display).
  const worktreeFile = path.join(REPO, COMPONENT);
  const modified = fs.readFileSync(worktreeFile, 'utf8');
  const headVersion = execFileSync('git', ['-C', REPO, 'show', `HEAD:${COMPONENT}`], { encoding: 'utf8' });
  fs.writeFileSync(worktreeFile, headVersion);
  await sleep(2500); // vite HMR
  const before = await drive('party-summary-before-fullnames.png');
  log('before', { cells: before.cells });

  // AFTER: restore the working-tree version.
  fs.writeFileSync(worktreeFile, modified);
  await sleep(2500);
  const after = await drive('party-summary-after-shortnames.png');
  log('after', { cells: after.cells });

  const pass = before.cells.includes(FULL_THU) && !before.cells.includes(SHORT_THU)
    && after.cells.includes(SHORT_THU) && !after.cells.includes(FULL_THU);
  log('verdict', { pass, beforeShowsFullName: before.cells.includes(FULL_THU), afterShowsShortName: after.cells.includes(SHORT_THU) });
  if (!pass) process.exitCode = 1;
} catch (err) {
  log('driver-error', { message: err.message });
  process.exitCode = 1;
} finally {
  cleanup();
  log('cleanup-done');
  fs.writeFileSync(path.join(OUT, 'party-summary-before-after.log'), LOG.map((l) => JSON.stringify(l)).join('\n') + '\n');
}
