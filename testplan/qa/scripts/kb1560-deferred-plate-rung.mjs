// Card 071026141560 rung — a plateless row whose carrier is EXTERNAL reads
// "CUS sẽ bổ sung" on BOTH the dispatch detailed-plan cell and the
// shipment-detail ledger badge; the generic "Chưa gán biển số" stays for
// OWN/unassigned rows. Fixture (KB1560) seeds the exact state the #359
// deferred save produces (planned EXTERNAL, plate NULL) and is purged.
import puppeteer from 'puppeteer';
import { createRequire } from 'node:module';
import { appendFileSync } from 'node:fs';
const require = createRequire('/Volumes/LexarSSD/projects/silversea-prod/backend/index.ts');
const postgres = require('postgres');
const sql = postgres({ host: 'localhost', port: 5441, database: 'silversea', user: 'postgres', password: 'postgres', max: 1 });
const QA = '/Volumes/LexarSSD/projects/silversea-prod/qa';
const step = (s, o) => { const e = { at: new Date().toISOString(), step: s, ...o }; appendFileSync(`${QA}/2026-10-07_card071026141560_ui-driver.log`, JSON.stringify(e) + '\n'); console.log(JSON.stringify(e)); };

const API = 'http://localhost:3002/api';
const login = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identifier: 'admin', password: 'Abc123' }) });
const session = await login.json();
const token = session.token ?? session.accessToken ?? session?.data?.token;
step('login', { gotToken: Boolean(token) });

const suffix = `kb1560-${Date.now()}`;
const ids = {};
try {
  const q = async (query, vars = []) => await sql.unsafe(query, vars);
  const [admin] = await q("SELECT id FROM users WHERE role='ADMIN' ORDER BY id LIMIT 1");
  // External carriers ride the customers table (cus_workspace_planned_carrier
  // aliases customers) — the same identity the #359 editor's carrier list uses.
  const [carrier] = await q("INSERT INTO customers (name, created_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [`KB1560 NCC xe ngoài ${suffix}`]);
  const [customer] = await q("INSERT INTO customers (name, created_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [`KB1560 KH ${suffix}`]);
  const [route] = await q("INSERT INTO routes (name, created_at, updated_at) VALUES ($1, now(), now()) RETURNING id", [`KB1560 tuyen ${suffix}`]);
  const [site] = await q("INSERT INTO operational_sites (customer_id, code, name, site_type, address, created_at, updated_at) VALUES ($1,$2,$3,'FACTORY','KB1560', now(), now()) RETURNING id", [customer.id, `KB1560-${suffix}`, `KB1560 NM ${suffix}`]);
  const [ctype] = await q("INSERT INTO container_types (code, name) VALUES ($1,$2) RETURNING id", [`K56${suffix.slice(-7)}`.slice(0, 20), 'KB1560 type']);
  // appointment = today 02:00Z (09:00 VN) so transportDate is today → the
  // pre-loading warning band (__vehicle-pending) also renders.
  const t0 = new Date(Date.now() - 7 * 3600_000).toISOString().slice(0, 11) + '02:00:00Z';
  const [shipment] = await q("INSERT INTO shipments (customer_id, route_id, cargo_mode, shipment_code, status, closing_at, created_by, created_at, updated_at) VALUES ($1,$2,'FCL',$3,'READY_FOR_DISPATCH',$4,$5, now(), now()) RETURNING id", [customer.id, route.id, `KB1560-${suffix.slice(-9)}`, t0, admin.id]);
  const [container] = await q("INSERT INTO shipment_containers (shipment_id, route_id, operational_site_id, container_type_id, container_number, customer_appointment_at, created_by, created_at, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7, now(), now()) RETURNING id", [shipment.id, route.id, site.id, ctype.id, `K56${suffix.slice(-6)}`.toUpperCase(), t0, admin.id]);
  const [ff] = await q("INSERT INTO shipment_fulfillments (shipment_id, fulfillment_type, cargo_mode, shipment_container_id, source_shipment_version, planned_carrier_type, planned_external_carrier_id, planned_vehicle_plate_number, created_by, created_at, updated_at) VALUES ($1,'FCL_CONTAINER','FCL',$2,1,'EXTERNAL',$3,NULL,$4, now(), now()) RETURNING id, version", [shipment.id, container.id, carrier.id, admin.id]);
  Object.assign(ids, { carrier: carrier.id, customer: customer.id, route: route.id, site: site.id, ctype: ctype.id, shipment: shipment.id, container: container.id, ff: ff.id });
  step('fixture', { shipmentId: shipment.id, fulfillmentId: ff.id, carrierName: `KB1560 NCC xe ngoài ${suffix}` });

  // API evidence: the ledger payload now carries carrierType for the row.
  const det = await fetch(`${API}/shipments/cus-workspace/${shipment.id}`, { headers: { Authorization: `Bearer ${token}` } });
  const detBody = await det.json();
  const row = (detBody.containers ?? []).find((r) => r.containerNumber === `K56${suffix.slice(-6)}`.toUpperCase());
  step('api-workspace', { status: det.status, carrierType: row?.carrierType, plate: row?.plateNumber, carrierName: row?.carrierName });
  if (row?.carrierType !== 'EXTERNAL' || row?.plateNumber !== null) throw new Error('workspace payload missing EXTERNAL/plateless identity');

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', (req) => { void req.continue(); });
    await page.evaluateOnNewDocument((t) => localStorage.setItem('token', t), token);
    await page.setViewport({ width: 1440, height: 1000 });

    // Surface 1 — dispatch detailed-plan grid: the #359 cell placeholder.
    await page.goto('http://localhost:7175/dispatch-detail', { waitUntil: 'domcontentloaded', timeout: 60000 });
    const typed = await page.evaluate(() => {
      const input = document.querySelector('input[type="search"], input[placeholder*="Tìm"]') || document.querySelector('input');
      if (!input) return false;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'KB1560');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    });
    step('grid-search', { typed });
    await page.waitForFunction(() => document.body.innerText.includes('KB1560'), { timeout: 90000 });
    const gridProbe = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tr, [class*="row"]')].find((r) => r.textContent.includes('KB1560'));
      return { hasDeferredCopy: row?.textContent.includes('CUS sẽ bổ sung') ?? false, hasOwnCopy: row?.textContent.includes('Chưa phân xe') ?? false, carrierShown: row?.textContent.includes('KB1560 NCC xe ngoài') ?? false };
    });
    step('grid-probe', gridProbe);
    if (!gridProbe.hasDeferredCopy) throw new Error('grid cell missing CUS sẽ bổ sung');
    await page.screenshot({ path: `${QA}/2026-10-07_card071026141560_ui-grid.png` });

    // Surface 2 — the container workboard (/shipments-detail) hosts the
    // ledger; its Phân xe cell must read CUS sẽ bổ sung for the fixture row.
    await page.goto('http://localhost:7175/shipments-detail', { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(() => document.body.innerText.includes('KB1560'), { timeout: 90000 });
    } catch {
      await page.screenshot({ path: `${QA}/2026-10-07_card071026141560_ui-ledger-timeout.png` });
      const snippet = await page.evaluate(() => document.body.innerText.slice(0, 600));
      step('ledger-wait-timeout', { snippet });
      throw new Error('ledger never showed the fixture row');
    }
    const ledgerProbe = await page.evaluate(() => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('KB1560'));
      return { hasDeferredCopy: row?.textContent.includes('CUS sẽ bổ sung') ?? false, hasGenericBadge: row?.textContent.includes('Chưa gán biển số') ?? false, guidance: row?.textContent.includes('Phối hợp Điều vận') ?? false };
    });
    step('ledger-probe', ledgerProbe);
    if (!ledgerProbe.hasDeferredCopy || ledgerProbe.hasGenericBadge) throw new Error('ledger badge wrong');
    const table = await page.$('.shipment-container-ledger');
    if (table) await table.screenshot({ path: `${QA}/2026-10-07_card071026141560_ui-ledger.png` });
    await page.screenshot({ path: `${QA}/2026-10-07_card071026141560_ui-ledger-page.png` });
    // Same row at the narrower control widths (badge is an inline swap; the
    // screenshots document the stacked-cell rendering).
    for (const width of [768, 390]) {
      await page.setViewport({ width, height: 1000 });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const narrowProbe = await page.evaluate(() => {
        const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('KB1560'));
        return { hasDeferredCopy: row?.textContent.includes('CUS sẽ bổ sung') ?? false };
      });
      step(`ledger-probe-${width}`, narrowProbe);
      if (!narrowProbe.hasDeferredCopy) throw new Error(`deferred copy missing at ${width}px`);
      await page.screenshot({ path: `${QA}/2026-10-07_card071026141560_ui-ledger-${width}.png` });
    }
  } finally {
    await browser.close();
  }

  // Persisted identity: the fulfillment keeps planned EXTERNAL + NULL plate.
  const [dbRow] = await q('SELECT planned_carrier_type, planned_vehicle_plate_number FROM shipment_fulfillments WHERE id = $1', [ids.ff]);
  step('db-identity', { plannedCarrierType: dbRow.planned_carrier_type, plate: dbRow.planned_vehicle_plate_number });
  if (dbRow.planned_carrier_type !== 'EXTERNAL' || dbRow.planned_vehicle_plate_number !== null) throw new Error('persisted identity drifted');
  console.log('RUNG PASS');
} catch (err) {
  step('FAIL', { error: String(err && err.message ? err.message : err) });
  console.log('RUNG FAIL:', err && err.message ? err.message : err);
  process.exitCode = 1;
} finally {
  try {
    if (ids.ff) await sql.unsafe('DELETE FROM shipment_fulfillments WHERE id = $1', [ids.ff]);
    if (ids.container) await sql.unsafe('DELETE FROM shipment_containers WHERE id = $1', [ids.container]);
    if (ids.shipment) await sql.unsafe('DELETE FROM shipments WHERE id = $1', [ids.shipment]);
    if (ids.carrier) await sql.unsafe('DELETE FROM customers WHERE id = $1', [ids.carrier]);
    if (ids.customer) await sql.unsafe('DELETE FROM customers WHERE id = $1', [ids.customer]);
    if (ids.route) await sql.unsafe('DELETE FROM routes WHERE id = $1', [ids.route]);
    if (ids.site) await sql.unsafe('DELETE FROM operational_sites WHERE id = $1', [ids.site]);
    if (ids.ctype) await sql.unsafe('DELETE FROM container_types WHERE id = $1', [ids.ctype]);
    step('purge', { ok: true });
  } catch (e) {
    step('purge-error', { error: String(e) });
  }
  await sql.end({ timeout: 5 });
}
