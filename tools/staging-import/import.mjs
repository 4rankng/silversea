#!/usr/bin/env node
/**
 * staging-import — drive the live Silversea HTTP API to populate master data and
 * a small set of real demo trips for the staging environment
 * (https://vantai.tingting.vip).
 *
 * Source of truth: `/Users/dev/My Drive/SilverSea/2. Raw_data/*.xlsx` (Vietnamese
 * spec sheets, written by the customer's planning team).
 *
 * Pipeline (each step is idempotent and saved as a QA artifact under qa/):
 *   1. login as admin → JWT
 *   2. upload the CLEANED data xlsx to /api/config/master-data-imports/analyze
 *      → master-import batch (customers, sites, routes, fleet, ports, drivers,
 *        debit-note template). Source: `clean-xlsx.py` strips data-quality
 *      issues from the raw 29.7 - DATA PM.xlsx so the all-or-nothing apply
 *      can succeed.
 *   3. POST /:id/apply  → apply the analyzed batch
 *   4. resolve canonical IDs by listing (customer, sites, fleet, routes, ports)
 *   5. POST /api/shipments/ for each of the 4 real trips from the dispatch demo
 *      (BILL DNKM13333 → NEWEB Hà Nam × 2 containers, BILL DNKM13334 → SUNRISE
 *      Bắc Giang × 2 containers, full debit-note prices)
 *
 * Usage:
 *   node tools/staging-import/import.mjs            # default: local backend
 *   BASE=http://localhost:3001 node import.mjs      # override API base
 *   BASE=https://vantai.tingting.vip node import.mjs # staging
 *
 * Local-only by default per the project contract (AGENTS.md). To run against
 * staging, also override ADMIN_USER / ADMIN_PASSWORD env vars.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const RAW_DIR = '/Users/dev/My Drive/SilverSea/2. Raw_data';
const QA_DIR = path.join(REPO_ROOT, 'qa', '2026-08-08_staging-import');

const BASE = process.env.BASE ?? 'http://localhost:3001';
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Abc123';

const crypto = await import('node:crypto');
const idempotencyKey = (scope) =>
  `staging-import:${scope}:${crypto.randomBytes(8).toString('hex')}`;

const MASTER_XLSX = process.env.MASTER_XLSX ?? path.join(QA_DIR, '29.7-DATA-PM-cleaned.xlsx');
const DISPATCH_XLSX = path.join(RAW_DIR, 'BẢNG DEMO PHẦN MỀM 2026- CUS- ĐIỀU XE - v2.xlsx');
// Run the data cleaner first if the cleaned file is missing or older than the source.
function ensureCleanedMaster() {
  const src = path.join(RAW_DIR, '29.7 - DATA PM.xlsx');
  if (!fs.existsSync(MASTER_XLSX) || fs.statSync(MASTER_XLSX).mtimeMs < fs.statSync(src).mtimeMs) {
    log(`  ▸ cleaning master xlsx (src mtime > cleaned mtime)…`);
    const { execSync } = process;
    execSync(`python3 "${path.join(__dirname, 'clean-xlsx.py')}"`, { stdio: 'inherit' });
  }
}

const log = (...a) => console.log(...a);
const die = (msg, extra) => {
  log('FATAL', msg, extra ?? '');
  process.exit(1);
};

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}
function writeArtifact(name, payload) {
  ensureDir(QA_DIR);
  const file = path.join(QA_DIR, name);
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2);
  fs.writeFileSync(file, body);
  return file;
}

async function http(method, urlPath, { token, body, isForm, expectStatus, idempotency } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (idempotency) headers['Idempotency-Key'] = idempotency;
  let payload;
  if (isForm) {
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  if (expectStatus !== undefined && res.status !== expectStatus) {
    die(`${method} ${urlPath} → ${res.status} (expected ${expectStatus})`, text.slice(0, 800));
  }
  return { status: res.status, json, text };
}

async function login() {
  const { status, json, text } = await http('POST', '/api/auth/login', {
    body: { identifier: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  if (status !== 200 || !json?.token) die('Login failed', text);
  log(`✓ login as ${json.user.username} (${json.user.role})`);
  return json.token;
}

async function uploadMasterData(token) {
  log('─ master data: analyze');
  const buf = fs.readFileSync(MASTER_XLSX);
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), path.basename(MASTER_XLSX));
  const { status, json, text } = await http('POST', '/api/config/master-data-imports/analyze', {
    token,
    body: form,
    isForm: true,
    idempotency: idempotencyKey('analyze'),
  });
  if (status !== 200 && status !== 201) die('analyze failed', text);
  writeArtifact('01-analyze.json', json);
  log(`  batch #${json.batch.id}  status=${json.batch.status}  rows=${json.batch.rows.length}  warnings=${(json.batch.warningCodes ?? []).join(',') || 'none'}`);
  const summary = json.batch.summary ?? {};
  for (const [k, v] of Object.entries(summary)) log(`    ${k}: ${v}`);
  return json.batch;
}

async function applyMasterData(token, batchId, expectedVersion) {
  log('─ master data: apply');
  const { status, json, text } = await http('POST', `/api/config/master-data-imports/${batchId}/apply`, {
    token,
    body: { expectedVersion },
    idempotency: idempotencyKey('apply'),
  });
  if (status !== 200 && status !== 201) die('apply failed', text);
  writeArtifact('02-apply.json', json);
  log(`  applied batch #${json.batch?.id ?? batchId}  status=${json.batch?.status ?? '?'}`);
  if (json.appliedCounts) {
    for (const [k, v] of Object.entries(json.appliedCounts)) log(`    applied ${k}: ${v}`);
  }
  return json;
}

async function listResource(token, urlPath) {
  const { status, json, text } = await http('GET', urlPath, { token, expectStatus: 200 });
  if (status !== 200) die(`list ${urlPath} failed`, text);
  return json;
}

async function resolveIds(token) {
  log('─ resolving canonical IDs from applied data');
  // Customers
  const customers = (await listResource(token, '/api/customers?limit=200')).items;
  const longMinh = customers.find((c) => /long\s*minh/i.test(c.name ?? ''));
  if (!longMinh) die('Could not find LONG MINH customer after import', JSON.stringify(customers, null, 2).slice(0, 2000));
  log(`  customer LONG MINH → id=${longMinh.id}`);

  // Operational sites (scoped to LONG MINH)
  const sites = (await listResource(token, `/api/shipments/operational-sites?customerId=${longMinh.id}&limit=200`)).items;
  const byName = new Map(sites.map((s) => [normalizeName(s.name), s]));
  const findSite = (name) => byName.get(normalizeName(name)) ?? die(`Site not found: ${name}`);

  const neweb = findSite('NEWEB-KHO 1');
  const sunrise = findSite('SUNRISE');
  log(`  sites → NEWEB-KHO 1 id=${neweb.id}  SUNRISE id=${sunrise.id}`);

  // Routes
  const routes = (await listResource(token, '/api/routes?limit=200')).items;
  // The XLSX has empty TUYẾN ĐƯỜNG, so routes may be empty. That's fine.
  log(`  routes: ${routes.length} found`);

  // Fleet — split into trucks (đầu kéo) and trailers (rơ-moóc)
  const trucks = (await listResource(token, '/api/trucks?limit=200')).items;
  const trailers = (await listResource(token, '/api/trailers?limit=200')).items;
  const fleet = [...trucks, ...trailers];
  const findVehicleByPlate = (plate) => {
    const norm = plate.replace(/[.\s]/g, '').toUpperCase();
    return fleet.find((v) => (v.licensePlate ?? '').replace(/[.\s]/g, '').toUpperCase() === norm)
      ?? fleet.find((v) => (v.trailerPlateNumber ?? '').replace(/[.\s]/g, '').toUpperCase() === norm)
      ?? die(`Vehicle not found: ${plate}`);
  };
  log(`  fleet: ${trucks.length} trucks + ${trailers.length} trailers`);

  // Drivers (separate table from users; drivers drive trucks)
  const drivers = (await listResource(token, '/api/drivers?limit=200')).items;
  const findDriverByName = (name) => {
    const norm = normalizeName(name);
    return drivers.find((d) => normalizeName(d.name).includes(norm))
      ?? die(`Driver not found: ${name}`);
  };
  log(`  drivers: ${drivers.length} found`);

  // Ports
  const ports = (await listResource(token, '/api/ports?limit=200')).items;
  // Prefer exact-name matches; fall back to "Lạch Huyện" HICT
  const namDinhVu = ports.find((p) => /^cảng\s*nam\s*đình\s*vũ$/i.test((p.name ?? '').trim()))
    ?? ports.find((p) => /nam\s*đình\s*vũ/i.test(p.name ?? ''))
    ?? ports[0];
  const lachHuyen = ports.find((p) => /lạch\s*huyện/i.test(p.name ?? '')) ?? ports[1] ?? ports[0];
  log(`  ports → nâng ${namDinhVu?.name ?? '?'} id=${namDinhVu?.id}  hạ ${lachHuyen?.name ?? '?'} id=${lachHuyen?.id}`);

  // Container type 40HC
  const containerTypes = (await listResource(token, '/api/container-types?limit=200')).items;
  const container40hc = containerTypes.find((c) => c.code === '40HC') ?? die('No 40HC container type');
  log(`  container type 40HC → id=${container40hc.id}`);

  // Cargo type
  const cargoTypes = (await listResource(token, '/api/cargo-types?limit=200')).items;
  const cargoContainer = cargoTypes.find((c) => /container/i.test(c.name ?? '')) ?? cargoTypes[0];
  log(`  cargo type → id=${cargoContainer.id} name=${cargoContainer.name}`);

  return {
    longMinh, sites, findSite, neweb, sunrise,
    routes, trucks, trailers, fleet, findVehicleByPlate,
    drivers, findDriverByName,
    ports, namDinhVu, lachHuyen,
    container40hc, cargoContainer,
  };
}

function normalizeName(s) {
  return (s ?? '').toString().toLowerCase().replace(/[\s\-_]+/g, '').replace(/[()]/g, '');
}

async function createShipment(token, payload, label) {
  const { status, json, text } = await http('POST', '/api/shipments', {
    token,
    body: payload,
    expectStatus: 201,
    idempotency: idempotencyKey(`ship:${label}`),
  });
  if (status !== 201) die('create shipment failed', `${text}\npayload=${JSON.stringify(payload)}`);
  return json;
}

async function attachContainer(token, shipmentId, expectedVersion, container) {
  const { status, json, text } = await http('PUT', `/api/shipments/${shipmentId}/containers`, {
    token,
    body: {
      expectedVersion,
      containers: [container],
    },
    idempotency: idempotencyKey(`cont:${shipmentId}:${container.containerNumber ?? 'nonum'}`),
  });
  if (status !== 200) {
    const err = new Error(`attach container failed: status=${status} body=${text} shipment=${shipmentId} payload=${JSON.stringify(container)}`);
    err.status = status;
    err.body = text;
    err.payload = container;
    throw err;
  }
  return json;
}

async function createShipments(token, ids) {
  log('─ creating 4 demo shipments from BẢNG DEMO …ĐIỀU XE v2');
  // Idempotency probe: list existing shipments for this customer with
  // matching booking_ref and skip those already present.
  const existing = (await listResource(token, `/api/shipments?customerId=${ids.longMinh.id}&limit=200`)).items ?? [];
  const existingByBooking = new Map();
  for (const s of existing) {
    if (s.bookingRef) existingByBooking.set(s.bookingRef, s);
  }

  const trips = [
    {
      label: 'DNKM13333 / NEWEB-KHO 1 / MSBU1245657 / 15H-154.98',
      bookingRef: 'DNKM13333',
      blNumber: '105254544125',
      factoryName: 'NEWEB-KHO 1',
      shippingLineName: 'MSC',
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      closingAt: '2026-07-30T08:00:00+07:00',
      customsCutoffAt: '2026-08-01T00:00:00+07:00',
      expectedDeliveryDate: '2026-07-30',
      cargoWeightKg: 7000,
      packageType: '40HC',
      site: ids.neweb,
      deliveryLocation: 'ĐỒNG VĂN, HÀ NAM',
      pickupWarehouseSiteId: ids.namDinhVu?.id,
      dropoffPortId: ids.lachHuyen?.id,
      containerNumber: 'MSBU1245657',
      vehiclePlate: '15H-154.98',
    },
    {
      label: 'DNKM13333 / NEWEB-KHO 1 / MSDU1245784 / 19H-04848',
      bookingRef: 'DNKM13333',
      blNumber: '105254544125',
      factoryName: 'NEWEB-KHO 1',
      shippingLineName: 'MSC',
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      closingAt: '2026-07-30T08:00:00+07:00',
      customsCutoffAt: '2026-08-01T00:00:00+07:00',
      expectedDeliveryDate: '2026-07-30',
      cargoWeightKg: 7000,
      packageType: '40HC',
      site: ids.neweb,
      deliveryLocation: 'ĐỒNG VĂN, HÀ NAM',
      pickupWarehouseSiteId: ids.namDinhVu?.id,
      dropoffPortId: ids.lachHuyen?.id,
      containerNumber: 'MSDU1245784',
      vehiclePlate: '19H-04848',
    },
    {
      label: 'DNKM13334 / SUNRISE / TGBU3190086 / 15H-209.51',
      bookingRef: 'DNKM13334',
      blNumber: '137465191612',
      factoryName: 'SUNRISE',
      shippingLineName: 'MSC',
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      closingAt: '2026-07-30T08:00:00+07:00',
      customsCutoffAt: '2026-08-01T00:00:00+07:00',
      expectedDeliveryDate: '2026-07-30',
      cargoWeightKg: 7000,
      packageType: '40HC',
      site: ids.sunrise,
      deliveryLocation: 'VÂN TRUNG, BẮC GIANG',
      pickupWarehouseSiteId: ids.namDinhVu?.id,
      dropoffPortId: ids.lachHuyen?.id,
      containerNumber: 'TGBU3190086',
      vehiclePlate: '15H-209.51',
    },
    {
      label: 'DNKM13334 / SUNRISE / MAGU2468720 / 15H-327.87',
      bookingRef: 'DNKM13334',
      blNumber: '137465191612',
      factoryName: 'SUNRISE',
      shippingLineName: 'MSC',
      cargoMode: 'FCL',
      tradeDirection: 'EXPORT',
      closingAt: '2026-07-30T08:00:00+07:00',
      customsCutoffAt: '2026-08-01T00:00:00+07:00',
      expectedDeliveryDate: '2026-07-30',
      cargoWeightKg: 7000,
      packageType: '40HC',
      site: ids.sunrise,
      deliveryLocation: 'VÂN TRUNG, BẮC GIANG',
      pickupWarehouseSiteId: ids.namDinhVu?.id,
      dropoffPortId: ids.lachHuyen?.id,
      containerNumber: 'MAGU2468720',
      vehiclePlate: '15H-327.87',
    },
  ];

  const created = [];
  for (const t of trips) {
    // For each booking_ref, count how many shipments already exist with that
    // bookingRef. We want exactly N shipments per booking where N = number of
    // containers in the demo (2 each).
    const sameBooking = existing.filter((s) => s.bookingRef === t.bookingRef);
    if (sameBooking.length >= 2) {
      log(`  · ${t.label} — already exists (${sameBooking.length} shipment(s) for ${t.bookingRef}); skipping`);
      // Still try to attach a container if missing — but only on the first
      // matching shipment for this booking to avoid double-attaching.
      const target = sameBooking.find((s) => (s.operationalNotes ?? '').includes(t.containerNumber))
        ?? sameBooking[0];
      try {
        const containers = (await listResource(token, `/api/shipments/${target.id}/containers`)).items ?? [];
        // The shipment already has a container (PUT /containers is a full
        // reconcile, so adding again would just upsert a 2nd one). Skip.
        if (containers.length > 0) {
          const lit = containers.find((c) => c.containerNumber === t.containerNumber);
          if (lit) log(`    · container ${t.containerNumber} already on shipment #${target.id}`);
          else log(`    · shipment #${target.id} already has ${containers.length} container(s) (${containers[0].containerNumber ?? 'no-number'}); skipping`);
          created.push({ ...t, shipment: target, skipped: true });
          continue;
        }
        try {
          await attachContainer(token, target.id, target.version, {
            containerTypeId: ids.container40hc.id,
            containerNumber: t.containerNumber,
            cargoWeightKg: t.cargoWeightKg,
            shippingLineName: t.shippingLineName,
            pickupPortId: t.pickupWarehouseSiteId ?? null,
            dropoffPortId: t.dropoffPortId ?? null,
          });
          log(`    + container ${t.containerNumber} (40HC, ${t.cargoWeightKg}kg) attached to existing shipment #${target.id}`);
        } catch (e) {
          log(`    ! literal container number rejected (${e?.message ?? e}); using numberless 40HC fallback`);
          await attachContainer(token, target.id, target.version, {
            containerTypeId: ids.container40hc.id,
            containerNumber: null,
            cargoWeightKg: t.cargoWeightKg,
            shippingLineName: t.shippingLineName,
            pickupPortId: t.pickupWarehouseSiteId ?? null,
            dropoffPortId: t.dropoffPortId ?? null,
          });
          log(`    + container (40HC, ${t.cargoWeightKg}kg, no number) attached to existing shipment #${target.id}`);
        }
      } catch (e) {
        log(`    ! container attach (existing) failed: ${e?.message ?? e}`);
      }
      created.push({ ...t, shipment: target, skipped: true });
      continue;
    }
    const payload = {
      customerId: ids.longMinh.id,
      routeId: null,
      cargoTypeId: ids.cargoContainer.id,
      responsibleUnitId: null,
      bookingRef: t.bookingRef,
      blNumber: t.blNumber,
      tradeDirection: t.tradeDirection,
      cargoMode: t.cargoMode,
      operationalSiteId: t.site.id,
      pickupWarehouseSiteId: t.pickupWarehouseSiteId ?? null,
      factoryName: t.factoryName,
      shippingLineName: t.shippingLineName,
      expectedDeliveryDate: t.expectedDeliveryDate,
      customsCutoffAt: t.customsCutoffAt,
      closingAt: t.closingAt,
      plannedReturnAt: null,
      cargoWeightKg: t.cargoWeightKg,
      cargoVolumeCbm: null,
      packageCount: 1,
      packageType: t.packageType,
      operationalNotes: `Container ${t.containerNumber} • Xe ${t.vehiclePlate} • Trả: ${t.deliveryLocation}`,
      pickupLocation: 'CẢNG NAM ĐÌNH VŨ',
      deliveryLocation: t.deliveryLocation,
      contactName: null,
      contactPhone: null,
    };
    const ship = await createShipment(token, payload, t.label);
    log(`  ✓ ${t.label} → shipment #${ship.id} code=${ship.shipmentCode ?? '?'}`);
    // Attach the 40HC container so the shipment is dispatchable. The
    // customer xlsx container numbers (e.g. MSBU1245657) frequently fail the
    // ISO 6346 check digit; we try the literal number first, and fall back
    // to a numberless container so the shipment still has dispatchable
    // shape.
    try {
      const result = await attachContainer(token, ship.id, ship.version, {
        containerTypeId: ids.container40hc.id,
        containerNumber: t.containerNumber,
        sealNumber: null,
        cargoWeightKg: t.cargoWeightKg,
        shippingLineName: t.shippingLineName,
        pickupPortId: t.pickupWarehouseSiteId ?? null,
        dropoffPortId: t.dropoffPortId ?? null,
      });
      log(`    + container ${t.containerNumber} (40HC, ${t.cargoWeightKg}kg) attached`);
      created.push({ ...t, shipment: ship, container: result });
    } catch (e) {
      log(`    ! container number ${t.containerNumber} rejected (likely ISO check digit); attaching numberless 40HC fallback`);
      try {
        const result = await attachContainer(token, ship.id, ship.version, {
          containerTypeId: ids.container40hc.id,
          containerNumber: null,
          sealNumber: null,
          cargoWeightKg: t.cargoWeightKg,
          shippingLineName: t.shippingLineName,
          pickupPortId: t.pickupWarehouseSiteId ?? null,
          dropoffPortId: t.dropoffPortId ?? null,
        });
        created.push({ ...t, shipment: ship, container: result, containerFallback: true });
        log(`    + container (40HC, ${t.cargoWeightKg}kg, no number) attached`);
      } catch (e2) {
        log(`    ! container attach (fallback) failed: ${e2?.message ?? e2}`);
        created.push({ ...t, shipment: ship, containerError: String(e) + ' | ' + String(e2) });
      }
    }
  }
  writeArtifact('03-shipments.json', created);
  return created;
}

async function main() {
  ensureDir(QA_DIR);
  log(`→ staging-import @ ${BASE}`);
  log(`  master xlsx: ${MASTER_XLSX}`);
  log(`  dispatch xlsx: ${DISPATCH_XLSX}`);
  log(`  QA dir: ${QA_DIR}`);

  if (!fs.existsSync(MASTER_XLSX)) die(`Master xlsx not found: ${MASTER_XLSX}`);

  ensureCleanedMaster();
  const token = await login();

  // Idempotency probe — if the master data is already present (sites for
  // LONG MINH include NEWEB-KHO 1, SUNRISE etc.), skip the import to avoid
  // re-analyzing the same xlsx.
  const probe = await http('GET', '/api/shipments/operational-sites?customerId=1&limit=200', { token, expectStatus: 200 });
  const existingSites = probe.json?.items ?? [];
  const hasImportedSites = existingSites.some((s) => /NEWEB-KHO 1/i.test(s.name ?? ''))
    && existingSites.some((s) => /SUNRISE/i.test(s.name ?? ''));
  if (hasImportedSites) {
    log(`✓ master data already present (${existingSites.length} sites for LONG MINH); skipping re-import`);
  } else {
    const batch = await uploadMasterData(token);
    if (batch.status !== 'APPLIED') {
      await applyMasterData(token, batch.id, batch.version);
    } else {
      log(`  (batch #${batch.id} already APPLIED; nothing to do)`);
    }
  }
  const ids = await resolveIds(token);
  writeArtifact('00-ids.json', {
    longMinh: { id: ids.longMinh.id, name: ids.longMinh.name },
    sites: ids.sites.map((s) => ({ id: s.id, code: s.code, name: s.name, type: s.type })),
    trucks: ids.trucks.map((t) => ({ id: t.id, plate: t.licensePlate })),
    trailers: ids.trailers.map((t) => ({ id: t.id, plate: t.licensePlate })),
    drivers: ids.drivers.map((d) => ({ id: d.id, name: d.name })),
    routes: ids.routes.map((r) => ({ id: r.id, name: r.name })),
    ports: ids.ports.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    container40hc: { id: ids.container40hc.id, code: ids.container40hc.code },
    cargoContainer: { id: ids.cargoContainer.id, name: ids.cargoContainer.name },
  });
  await createShipments(token, ids);
  log('─ DONE. Artifacts in qa/2026-08-08_staging-import/');
}

main().catch((e) => die(e?.stack ?? e?.message ?? String(e)));
