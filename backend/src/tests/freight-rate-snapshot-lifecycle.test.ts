/**
 * Freight rate snapshot lifecycle — T1 wiring tests.
 *
 * Locks the engine-integration contracts from
 * `Phương án tính cước tự động.docx` §2-D/§3 (see PRD CuocPhiThietKeDB.md):
 *   - FCL container intake (type + appointment arriving together) locks an
 *     AUTO snapshot with all 4 trace ids and the frozen amounts.
 *   - Transport-date change supersedes: a NEW snapshot row is inserted and
 *     the old row is never mutated (chốt Câu 2 = A).
 *   - MANUAL fallback is non-blocking: missing base price / missing terms /
 *     lag-before-first-period degrade to a MANUAL row that flags manual
 *     entry instead of failing the intake.
 *   - Ad-hoc (Lệnh chạy ngoài) shipments bypass the engine entirely.
 *   - Snapshot read model reconstructs the formula + derives AUTO/MANUAL.
 *   - Preview endpoint resolves without persisting; debit-note override
 *     endpoint enforces reason-iff-diff and the financial role gate.
 *
 * Fixture isolation mirrors freight-pricing-engine.test.ts: a `${suffix}-…`
 * namespace per run, rows deleted in `after()`. Canonical vehicle classes
 * (CONT20/CONT40) are ensured via onConflictDoNothing and deliberately KEPT —
 * they are the documented seed set of vehicle_size_classes, not test litter.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { eq } from 'drizzle-orm';
import { Role } from '@tingting/shared';

import { client, db } from '../db';
import * as s from '../db/schema';
import { disconnectRedis } from '../lib/redis';
import { initEnforcer } from '../casbin/enforcer';
import { casbinAuthz } from '../middleware/casbin';
import { globalErrorHandler } from '../middleware/errorHandler';
import shipmentRoutes from '../routes/shipments';
import financialRoutes from '../routes/financial';
import { freightRatePreviewRoutes } from '../routes/financial/freight-rate.routes';
import { createShipment } from '../services/shipment-create.service';
import { updateShipment } from '../services/shipment-update.service';
import { batchUpsertShipmentContainers } from '../services/shipment-containers.service';
import { updateCusShipmentContainerLine } from '../services/cus-shipment-workspace-writes.service';
import { getShipmentDetail } from '../services/shipment-detail-reads.service';
import {
  getShipmentFreightRateView,
  lockShipmentFreightRate,
  resolveFreightRateWithManualFallback,
} from '../services/freight-rate-snapshot-lifecycle.service';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ─── Date scaffolding (unique per run, mirrors the engine test suite) ────────
const SUITE_BASE_DATE = (() => {
  // Far-future window so this run's fuel periods never collide with other
  // runs on the global fuel_price_periods.effective_from unique key.
  const n = Number(suffix.replace(/\D/g, '').slice(-6)) % 4000;
  const d = new Date('2028-01-01');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
})();
const addDays = (iso: string, days: number) => {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};
const TRANSPORT_DATE = addDays(SUITE_BASE_DATE, 10);

// ─── Fixture trackers ────────────────────────────────────────────────────────
const createdCustomerIds: number[] = [];
const createdRouteIds: number[] = [];
const createdTermsIds: number[] = [];
const createdPricingTableIds: number[] = [];
const createdNormIds: number[] = [];
const createdFuelPricePeriodIds: number[] = [];
const createdShipmentIds: number[] = [];
const createdSnapshotIds: number[] = [];
const createdOverrideIds: number[] = [];
const createdUserIds: number[] = [];
let server: http.Server;
let baseUrl = '';
let adminId = 0;
let accountantId = 0;
let opsId = 0;
let driverId = 0;

// ─── Fixtures ────────────────────────────────────────────────────────────────

async function ensureCanonicalVehicleClasses() {
  await db.insert(s.vehicleSizeClasses)
    .values([
      { code: 'CONT20', name: "Container 20'", isContainer: true, sortOrder: 70 },
      { code: 'CONT40', name: "Container 40'", isContainer: true, sortOrder: 71 },
    ])
    .onConflictDoNothing();
}

async function getOrCreateContainerType40() {
  const [existing] = await db.select().from(s.containerTypes)
    .where(eq(s.containerTypes.code, '40DC')).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(s.containerTypes)
    .values({ code: '40DC', name: "40'DC" }).returning();
  return created;
}

async function mkCustomer(label: string) {
  const [c] = await db.insert(s.customers)
    .values({ name: `FreightLock ${label} ${suffix}` }).returning();
  createdCustomerIds.push(c.id);
  return c;
}

async function mkRoute(label: string) {
  const [r] = await db.insert(s.routes)
    .values({ name: `FreightLock route ${label} ${suffix}` }).returning();
  createdRouteIds.push(r.id);
  return r;
}

async function mkTerms(customerId: number, routeId: number, overrides: Partial<typeof s.freightRateTerms.$inferInsert> = {}) {
  const [t] = await db.insert(s.freightRateTerms).values({
    customerId,
    routeId,
    sharePct: overrides.sharePct ?? '2',
    billingKmOneWay: overrides.billingKmOneWay ?? 130,
    billingKmMultiplier: overrides.billingKmMultiplier ?? '2',
    baseFuelPrice: overrides.baseFuelPrice ?? '17842.5926',
    fuelLagDays: overrides.fuelLagDays ?? 1,
    // AUTO-path fixtures represent customer-CONFIRMED terms (20260917_11):
    // unconfirmed terms now yield MANUAL from the engine.
    fuelLagConfirmed: true,
    surchargeThresholdMode: 'NONE' as string,
    surchargeThresholdPct: null,
    surchargeThresholdAbs: null,
    effectiveDate: '2026-01-01',
    note: `FreightLock terms ${suffix}`,
  }).returning();
  createdTermsIds.push(t.id);
  return t;
}

async function mkPricingTable(customerId: number, routeId: number, rateKey: string, price: string) {
  const [p] = await db.insert(s.pricingTables).values({
    customerId, routeId, rateKey, price, effectiveDate: '2026-01-01',
  }).returning();
  createdPricingTableIds.push(p.id);
  return p;
}

async function mkNorm(vehicleSizeClassCode: string, litersPerKm: string) {
  const [cls] = await db.select().from(s.vehicleSizeClasses)
    .where(eq(s.vehicleSizeClasses.code, vehicleSizeClassCode)).limit(1);
  assert.ok(cls, `vehicle class ${vehicleSizeClassCode} must exist`);
  const [n] = await db.insert(s.fuelConsumptionNorms).values({
    vehicleSizeClassId: cls.id,
    litersPerKm,
    effectiveDate: '2026-01-01',
  }).returning();
  createdNormIds.push(n.id);
  return n;
}

async function mkFuelPeriod(unitPrice: string, effectiveFrom: string) {
  // fuel_price_periods.effective_from is globally unique and other suites
  // share this DB — retry a day forward on collision instead of failing.
  for (let attempt = 0; attempt < 60; attempt++) {
    const iso = addDays(effectiveFrom, attempt);
    const inserted = await db.insert(s.fuelPricePeriods)
      .values({ unitPrice, effectiveFrom: iso })
      .onConflictDoNothing()
      .returning();
    if (inserted[0]) {
      createdFuelPricePeriodIds.push(inserted[0].id);
      return inserted[0];
    }
  }
  throw new Error(`could not find a free fuel period date near ${effectiveFrom}`);
}

async function mkShipment(input: Partial<Parameters<typeof createShipment>[0]> & { customerId?: number | null }) {
  const shipment = await createShipment({
    isAdHoc: false,
    cargoMode: 'FCL',
    routeId: null,
    ...input,
  } as Parameters<typeof createShipment>[0]);
  createdShipmentIds.push(shipment.id);
  return shipment;
}

async function createUser(role: Role) {
  const [user] = await db.insert(s.users).values({
    username: `freight-lock-${role}-${suffix}`,
    passwordHash: 'test-only',
    role,
    status: 'ACTIVE',
  }).returning({ id: s.users.id, role: s.users.role });
  createdUserIds.push(user.id);
  return user;
}

async function api(method: string, path: string, actorId: number, body?: Record<string, unknown>) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `freight-lock-${suffix}-${Math.random()}`,
      'X-Test-User-Id': String(actorId),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    parsed = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: parsed };
}

// ─── Expected math (docx §2 formula, km×2 locked Câu 4=A) ────────────────────
// terms: sharePct 2, billingKmOneWay 130, ×2 ⇒ billedKm 260; norm 0.35 l/km ⇒ 91 l
// base 3,900,000 ⇒ freight = round(3,900,000 × 1.02) = 3,978,000
// fuel base F = 17,842.5926; lag 1
//   transport D+10 → target D+9 → latest period ≤ D+9 = P2 (D+7, 21,740)
//   surcharge = round(3,897.4074 × 91) = 354,664 ⇒ total 4,332,664
//   transport D+18 → target D+17 → P3 (D+14, 27,620)
//   surcharge = round(9,777.4074 × 91) = 889,744 ⇒ total 4,867,744
const FREIGHT = 3_978_000;
const SURCHARGE_D10 = 354_664;
const TOTAL_D10 = FREIGHT + SURCHARGE_D10;
const SURCHARGE_D18 = 889_744;
const TOTAL_D18 = FREIGHT + SURCHARGE_D18;

// ─── Suite ───────────────────────────────────────────────────────────────────

let customerA = 0;
let routeA = 0;
let containerType40Id = 0;
let autoShipmentId = 0;

before(async () => {
  await initEnforcer();
  await ensureCanonicalVehicleClasses();
  containerType40Id = (await getOrCreateContainerType40()).id;

  const [cA] = [await mkCustomer('A')];
  customerA = cA.id;
  const [rA] = [await mkRoute('A')];
  routeA = rA.id;
  await mkTerms(customerA, routeA);
  await mkPricingTable(customerA, routeA, 'CONT40', '3900000');
  await mkNorm('CONT40', '0.35');
  await mkFuelPeriod('19270', SUITE_BASE_DATE);
  await mkFuelPeriod('21740', addDays(SUITE_BASE_DATE, 7));
  await mkFuelPeriod('27620', addDays(SUITE_BASE_DATE, 14));

  adminId = (await createUser(Role.ADMIN)).id;
  accountantId = (await createUser(Role.ACCOUNTANT)).id;
  opsId = (await createUser(Role.OPS)).id;
  driverId = (await createUser(Role.DRIVER)).id;

  const app = express();
  app.use(express.json());
  const roleById = new Map<number, Role>([
    [adminId, Role.ADMIN],
    [accountantId, Role.ACCOUNTANT],
    [opsId, Role.OPS],
    [driverId, Role.DRIVER],
  ]);
  // Test-only principal injection mirrors the auth middleware contract.
  app.use((req, _res, next) => {
    const raw = req.headers['x-test-user-id'];
    const id = Array.isArray(raw) ? raw[0] : raw;
    const role = roleById.get(Number(id)) ?? Role.ADMIN;
    (req as unknown as { user?: { userId: number; role: Role } }).user = {
      userId: Number(id) || adminId,
      role,
    };
    next();
  });
  app.use('/api/shipments', casbinAuthz('shipments'), shipmentRoutes);
  app.use('/api/pricing', casbinAuthz('shipments'), freightRatePreviewRoutes);
  app.use('/api', casbinAuthz('financial'), financialRoutes);
  app.use(globalErrorHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  for (const id of createdOverrideIds) {
    await db.delete(s.debitNoteOverrides).where(eq(s.debitNoteOverrides.id, id)).catch(() => {});
  }
  for (const id of createdSnapshotIds) {
    await db.delete(s.freightRateSnapshots).where(eq(s.freightRateSnapshots.id, id)).catch(() => {});
  }
  for (const id of createdShipmentIds) {
    await db.delete(s.shipmentStatusHistory).where(eq(s.shipmentStatusHistory.shipmentId, id)).catch(() => {});
    await db.delete(s.shipmentContainers).where(eq(s.shipmentContainers.shipmentId, id)).catch(() => {});
    await db.delete(s.shipments).where(eq(s.shipments.id, id)).catch(() => {});
  }
  for (const id of createdFuelPricePeriodIds) {
    await db.delete(s.fuelPricePeriods).where(eq(s.fuelPricePeriods.id, id)).catch(() => {});
  }
  for (const id of createdNormIds) {
    await db.delete(s.fuelConsumptionNorms).where(eq(s.fuelConsumptionNorms.id, id)).catch(() => {});
  }
  for (const id of createdPricingTableIds) {
    await db.delete(s.pricingTables).where(eq(s.pricingTables.id, id)).catch(() => {});
  }
  for (const id of createdTermsIds) {
    await db.delete(s.freightRateTerms).where(eq(s.freightRateTerms.id, id)).catch(() => {});
  }
  for (const id of createdRouteIds) {
    await db.delete(s.routes).where(eq(s.routes.id, id)).catch(() => {});
  }
  for (const id of createdCustomerIds) {
    await db.delete(s.customers).where(eq(s.customers.id, id)).catch(() => {});
  }
  for (const id of createdUserIds) {
    await db.delete(s.users).where(eq(s.users.id, id)).catch(() => {});
  }
  await client.end();
  await disconnectRedis();
});

describe('freight rate snapshot lifecycle (T1 wiring)', () => {
  test('FCL container intake locks an AUTO snapshot with full trace + amounts', async () => {
    const shipment = await mkShipment({ customerId: customerA, routeId: routeA });
    autoShipmentId = shipment.id;
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      // Null container number is legal intake (placeholder before the BL
      // arrives) and avoids the ISO-6346 check-digit rule.
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
    }]);

    const view = await getShipmentFreightRateView(shipment.id);
    assert.ok(view.latest, 'snapshot must exist after container intake');
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(view.latest!.source, 'AUTO');
    assert.equal(view.latest!.freightAmount, FREIGHT);
    assert.equal(view.latest!.surchargeAmount, SURCHARGE_D10);
    assert.equal(view.latest!.totalAmount, TOTAL_D10);
    assert.ok(view.latest!.rateTermsId > 0, 'rateTermsId trace must be populated');
    assert.ok(view.latest!.pricingTableId > 0, 'pricingTableId trace must be populated');
    assert.ok(view.latest!.fuelNormId > 0, 'fuelNormId trace must be populated');
    assert.ok(view.latest!.fuelPricePeriodId > 0, 'fuelPricePeriodId trace must be populated');
    assert.equal(view.latest!.billedKm, 260);
    assert.equal(view.latest!.liters, 91);
    // Reconstructed read-side formula (numbers normalized).
    assert.match(view.latest!.formula, /3900000 × \(1 \+ 2(\.00)?%\)/);
  });

  test('FCL with container-level route locks AUTO (route sourced from the routed container)', async () => {
    // The CUS create form sends FCL routes at container level, so
    // shipments.route_id stays null on the real flow — the lock must source
    // the route from the routed container instead of bailing, or FCL lots
    // never freeze a rate ("đóng băng tại Ngày vận chuyển" never happens).
    const shipment = await mkShipment({ customerId: customerA, routeId: null });
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
      routeId: routeA,
    }]);

    const view = await getShipmentFreightRateView(shipment.id);
    assert.ok(view.latest, 'container-routed FCL must lock a snapshot at intake');
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(view.latest!.source, 'AUTO');
    assert.equal(view.latest!.freightAmount, FREIGHT);
    assert.equal(view.latest!.totalAmount, TOTAL_D10);
    assert.ok(view.latest!.rateTermsId > 0, 'rateTermsId trace must be populated');
    assert.ok(view.latest!.pricingTableId > 0, 'pricingTableId trace must be populated');
    assert.ok(view.latest!.fuelNormId > 0, 'fuelNormId trace must be populated');
    assert.ok(view.latest!.fuelPricePeriodId > 0, 'fuelPricePeriodId trace must be populated');
    assert.equal(view.latest!.billedKm, 260);
    assert.equal(view.latest!.liters, 91);
  });

  test('anchor container wins on multi-route FCL lots (per-container/per-trip lock)', async () => {
    // Mixed-route lots lock each container's own route: the anchor container
    // (dispatch passes the fulfillment's container) decides the engine's
    // route input, so a second container on another route prices by that
    // route's terms — never by the first container's.
    const customerB = await mkCustomer('MixedRoute');
    const routeB = await mkRoute('MixedRoute');
    await mkTerms(customerB.id, routeB.id);
    await mkPricingTable(customerB.id, routeB.id, 'CONT40', '2000000');
    // The intake lock prices by the FIRST routed container (routeA), so this
    // customer also needs terms + a price row for that pair to resolve AUTO.
    await mkTerms(customerB.id, routeA);
    await mkPricingTable(customerB.id, routeA, 'CONT40', '3900000');
    const shipment = await mkShipment({ customerId: customerB.id, routeId: null });
    const containers = await batchUpsertShipmentContainers(shipment.id, adminId, [
      { containerTypeId: containerType40Id, routeId: routeA, customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00` },
      { containerTypeId: containerType40Id, routeId: routeB.id, customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00` },
    ]);
    const anchorB = containers[1].id;

    const viewBefore = await getShipmentFreightRateView(shipment.id);
    assert.ok(viewBefore.latest, 'intake locks using the first routed container');
    createdSnapshotIds.push(viewBefore.latest!.id);
    assert.equal(viewBefore.latest!.totalAmount, TOTAL_D10, 'first routed container (routeA) prices the intake lock');

    await db.transaction(async tx => {
      await lockShipmentFreightRate(tx, { shipmentId: shipment.id, shipmentContainerId: anchorB });
    });

    const viewAfter = await getShipmentFreightRateView(shipment.id);
    assert.equal(viewAfter.snapshotCount, 2, 'anchor lock supersedes via INSERT');
    createdSnapshotIds.push(viewAfter.latest!.id);
    // freight round(2,000,000 × 1.02) = 2,040,000 + surcharge 354,664
    assert.equal(viewAfter.latest!.totalAmount, 2_394_664, 'anchor container (routeB) must price the lock');
  });

  test('no route on shipment nor containers stays silent (no snapshot, engine untouched)', async () => {
    const shipment = await mkShipment({ customerId: customerA, routeId: null });
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
      // no routeId — nothing to price by
    }]);

    const view = await getShipmentFreightRateView(shipment.id);
    assert.equal(view.latest, null, 'routeless FCL still writes nothing');
    assert.equal(view.snapshotCount, 0);
  });

  test('shipment detail exposes the latest snapshot read-only view', async () => {
    const detail = await getShipmentDetail(autoShipmentId);
    assert.ok(detail.freightRate?.latest, 'detail flows must carry freightRate.latest');
    assert.equal(detail.freightRate!.latest!.totalAmount, TOTAL_D10);
    assert.equal(detail.freightRate!.snapshotCount, 1);
  });

  test('transport-date change supersedes: new row inserted, old row immutable', async () => {
    const before = await getShipmentFreightRateView(autoShipmentId);
    const firstSnapshotId = before.latest!.id;
    const [row] = await db.select().from(s.freightRateSnapshots)
      .where(eq(s.freightRateSnapshots.id, firstSnapshotId));
    assert.ok(row);

    const [fresh] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, autoShipmentId));
    await updateShipment(autoShipmentId, {
      expectedVersion: fresh.version,
      expectedDeliveryDate: addDays(TRANSPORT_DATE, 8),
    });

    const after = await getShipmentFreightRateView(autoShipmentId);
    assert.equal(after.snapshotCount, 2, 'date change must insert a second snapshot');
    assert.notEqual(after.latest!.id, firstSnapshotId);
    createdSnapshotIds.push(after.latest!.id);
    // FCL anchors to the container's own appointment, which did not move, so
    // the superseding row may repeat the amounts — the CONTRACT under test is
    // INSERT-only supersede, never mutation of the frozen row.
    assert.deepEqual(
      { ...after.latest!, id: 0, computedAt: '' },
      { ...before.latest!, id: 0, computedAt: '' },
      'same anchor date ⇒ same frozen amounts on the new row',
    );

    // Immutability (chốt Câu 2=A): the frozen row is byte-for-byte unchanged.
    const [rowAfter] = await db.select().from(s.freightRateSnapshots)
      .where(eq(s.freightRateSnapshots.id, firstSnapshotId));
    assert.deepEqual(rowAfter, row, 'supersede must never mutate the frozen snapshot');
  });

  test('container appointment change (CUS workspace) re-anchors the rate', async () => {
    const [container] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, autoShipmentId)).limit(1);
    assert.ok(container);
    const [fresh] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, autoShipmentId));

    await updateCusShipmentContainerLine({
      shipmentId: autoShipmentId,
      containerId: container.id,
      input: {
        expectedShipmentVersion: fresh.version,
        customerAppointmentAt: `${addDays(TRANSPORT_DATE, 8)}T08:00:00+07:00`,
      },
      actor: { userId: adminId, role: Role.ADMIN, username: 'freight-lock-admin', email: null, fullName: null },
    });

    const view = await getShipmentFreightRateView(autoShipmentId);
    assert.equal(view.snapshotCount, 3, 'appointment change must supersede again');
    assert.equal(view.latest!.totalAmount, TOTAL_D18);
    createdSnapshotIds.push(view.latest!.id);
  });

  // ─── TC-CUOC-005 — lag via container appointment edit (not expectedDeliveryDate) ──
  //
  // FCL anchors to the container's customerAppointmentAt, NOT the shipment-level
  // expectedDeliveryDate. A shipment-level date change re-locks with identical
  // amounts by design (tested above). To exercise lag, we must edit the CONTAINER
  // appointment across a fuel-period boundary.
  //
  // Setup: fuel_lag_days=1; P2 at D+7 (21740), P3 at D+14 (27620).
  //   Step 1: create shipment with appointment at D+13 → target D+12 → uses P2.
  //   Step 2: move appointment to D+14 → target D+13 → still P2 (P3 starts D+14).
  //   Step 3: move appointment to D+15 → target D+14 → uses P3 (≥ P3.effectiveFrom).
  // The test asserts that the fuelPricePeriodId changes only when the lag-adjusted
  // target crosses the period boundary, and that amounts update accordingly.

  test('TC-CUOC-005: lag via container appointment edit selects correct fuel period', async () => {
    // --- Setup: fresh customer/route/terms with lag=1, two fuel periods ---
    const cust = await mkCustomer('Lag');
    const route = await mkRoute('Lag');
    await mkTerms(cust.id, route.id, { fuelLagDays: 1 });
    await mkPricingTable(cust.id, route.id, 'CONT40', '3900000');
    // CONT40 norm (0.35 l/km) already exists from before() — do not re-insert
    // (unique constraint on vehicle_size_class_id + effective_date).
    // P2 at D+7 (21740) — already seeded in before(); add P3 at D+14 (27620)
    // for this test. The periods are global, so we use addDays on SUITE_BASE_DATE.
    const p3 = await mkFuelPeriod('27620', addDays(SUITE_BASE_DATE, 14));
    createdFuelPricePeriodIds.push(p3.id);

    // Step 1: appointment at D+13 → target = D+13 − 1 = D+12 → P2 (D+7 ≤ D+12 < D+14)
    const shipment = await mkShipment({ customerId: cust.id, routeId: route.id, cargoMode: 'FCL' });
    createdShipmentIds.push(shipment.id);
    const appointD13 = `${addDays(SUITE_BASE_DATE, 13)}T08:00:00+07:00`;
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: appointD13,
    }]);

    const view1 = await getShipmentFreightRateView(shipment.id);
    assert.ok(view1.latest, 'snapshot must exist after intake');
    createdSnapshotIds.push(view1.latest!.id);
    assert.equal(view1.latest!.source, 'AUTO');
    // P2 (21740) is used: surcharge = round((21740 − 17842.5926) × 91) = 354664
    assert.equal(view1.latest!.surchargeAmount, SURCHARGE_D10,
      'D+13 appointment → target D+12 → must use P2 (21740)');
    assert.equal(view1.latest!.totalAmount, TOTAL_D10);
    const p2PeriodId = view1.latest!.fuelPricePeriodId;

    // Step 2: move appointment to D+14 → target = D+13 → still P2 (D+13 < D+14)
    const [container] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(eq(s.shipmentContainers.shipmentId, shipment.id)).limit(1);
    assert.ok(container);
    const [fresh] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const appointD14 = `${addDays(SUITE_BASE_DATE, 14)}T08:00:00+07:00`;

    await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: fresh.version, customerAppointmentAt: appointD14 },
      actor: { userId: adminId, role: Role.ADMIN, username: 'freight-lock-admin', email: null, fullName: null },
    });

    const view2 = await getShipmentFreightRateView(shipment.id);
    assert.equal(view2.snapshotCount, 2, 'appointment change must supersede');
    createdSnapshotIds.push(view2.latest!.id);
    // Target = D+13 → still P2; amounts unchanged.
    assert.equal(view2.latest!.fuelPricePeriodId, p2PeriodId,
      'D+14 appointment → target D+13 → must still use P2');
    assert.equal(view2.latest!.totalAmount, TOTAL_D10,
      'amounts must not change when lag target stays in same period');

    // Step 3: move appointment to D+15 → target = D+14 → crosses into P3
    const [fresh2] = await db.select({ version: s.shipments.version })
      .from(s.shipments).where(eq(s.shipments.id, shipment.id));
    const appointD15 = `${addDays(SUITE_BASE_DATE, 15)}T08:00:00+07:00`;

    await updateCusShipmentContainerLine({
      shipmentId: shipment.id,
      containerId: container.id,
      input: { expectedShipmentVersion: fresh2.version, customerAppointmentAt: appointD15 },
      actor: { userId: adminId, role: Role.ADMIN, username: 'freight-lock-admin', email: null, fullName: null },
    });

    const view3 = await getShipmentFreightRateView(shipment.id);
    assert.equal(view3.snapshotCount, 3, 'must supersede again');
    createdSnapshotIds.push(view3.latest!.id);
    // Target = D+14 → P3 (27620) is now the latest period ≤ target.
    assert.notEqual(view3.latest!.fuelPricePeriodId, p2PeriodId,
      'D+15 appointment → target D+14 → must switch to P3');
    assert.equal(view3.latest!.surchargeAmount, SURCHARGE_D18,
      'P3 (27620) surcharge: round((27620 − 17842.5926) × 91) = 889744');
    assert.equal(view3.latest!.totalAmount, TOTAL_D18);
  });

  test('missing base price degrades to MANUAL — intake proceeds unblocked', async () => {
    // Same customer/route family but no pricing-table row for CONT40 (the
    // CONT40 norm from before() already covers the class).
    const customer = await mkCustomer('B');
    const route = await mkRoute('B');
    await mkTerms(customer.id, route.id);

    const shipment = await mkShipment({ customerId: customer.id, routeId: route.id });
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
    }]);

    const view = await getShipmentFreightRateView(shipment.id);
    assert.ok(view.latest, 'MANUAL snapshot must still be written');
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(view.latest!.source, 'MANUAL');
    assert.equal(view.latest!.totalAmount, 0);
    assert.match(view.latest!.formula, /Thiếu giá gốc/);
  });

  test('missing terms degrade to MANUAL with the config hint', async () => {
    const customer = await mkCustomer('C');
    const route = await mkRoute('C');
    // No terms row at all for this pair.
    const shipment = await mkShipment({ customerId: customer.id, routeId: route.id });
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
    }]);
    const view = await getShipmentFreightRateView(shipment.id);
    assert.ok(view.latest);
    createdSnapshotIds.push(view.latest!.id);
    assert.equal(view.latest!.source, 'MANUAL');
    assert.match(view.latest!.formula, /điều khoản cước/);
  });

  test('lag before the first fuel period degrades to MANUAL (no 404 escape)', async () => {
    // Target a date strictly before the EARLIEST period in the DB (periods are
    // global and shared with other suites, so "before my fixtures" is not
    // enough). The engine's fuel lookup misses and the fallback keeps the
    // flow non-blocking.
    const [earliest] = await db
      .select({ effectiveFrom: s.fuelPricePeriods.effectiveFrom })
      .from(s.fuelPricePeriods)
      .orderBy(s.fuelPricePeriods.effectiveFrom)
      .limit(1);
    assert.ok(earliest, 'fuel periods must exist for the lag edge case');
    const resolved = await resolveFreightRateWithManualFallback({
      customerId: customerA,
      routeId: routeA,
      vehicleSizeClassCode: 'CONT40',
      transportDate: addDays(earliest.effectiveFrom, -40),
    });
    assert.equal(resolved.source, 'MANUAL');
    assert.equal(resolved.total, 0);
    assert.match(resolved.formula, /giá dầu/);
  });

  test('ad-hoc (Lệnh chạy ngoài) shipments bypass the engine entirely', async () => {
    const shipment = await createShipment({
      isAdHoc: true,
      rawCustomerName: 'Khách vãng lai test',
      routeId: routeA,
      cargoMode: 'FCL',
    });
    await batchUpsertShipmentContainers(shipment.id, adminId, [{
      containerTypeId: containerType40Id,
      customerAppointmentAt: `${TRANSPORT_DATE}T08:00:00+07:00`,
    }]);
    const view = await getShipmentFreightRateView(shipment.id);
    assert.equal(view.latest, null, 'ad-hoc must never write a snapshot');
    assert.equal(view.snapshotCount, 0);
  });

  test('preview endpoint resolves AUTO without persisting', async () => {
    const res = await api('GET',
      `/pricing/freight-preview?customerId=${customerA}&routeId=${routeA}&vehicleSizeClassCode=CONT40&transportDate=${TRANSPORT_DATE}`,
      adminId);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.source, 'AUTO');
    assert.equal(res.body.total, TOTAL_D10);
    // No snapshot was written by the preview itself (intake + date change +
    // appointment change account for all 3 rows).
    const view = await getShipmentFreightRateView(autoShipmentId);
    assert.equal(view.snapshotCount, 3, 'preview must not persist');
  });

  test('preview MANUAL variant + RBAC negative (DRIVER 403)', async () => {
    const manual = await api('GET',
      `/pricing/freight-preview?customerId=${customerA}&routeId=${routeA}&vehicleSizeClassCode=15T&transportDate=${TRANSPORT_DATE}`,
      adminId);
    assert.equal(manual.status, 200);
    assert.equal(manual.body.source, 'MANUAL');

    const denied = await api('GET',
      `/pricing/freight-preview?customerId=${customerA}&routeId=${routeA}&vehicleSizeClassCode=CONT40&transportDate=${TRANSPORT_DATE}`,
      driverId);
    assert.equal(denied.status, 403, 'DRIVER has no shipments read');
  });

  test('debit-note override: reason required iff final ≠ system; snapshot read-back', async () => {
    const view = await getShipmentFreightRateView(autoShipmentId);
    const snapshotId = view.latest!.id;

    // Missing reason while final differs from the frozen system freight.
    const missingReason = await api('PUT', `/pricing/snapshots/${snapshotId}/override`, accountantId, {
      finalDebitFreight: 4_000_000,
    });
    assert.equal(missingReason.status, 400, JSON.stringify(missingReason.body));

    // OPS has no financial grant — write attempt must 403 before any row.
    const opsDenied = await api('PUT', `/pricing/snapshots/${snapshotId}/override`, opsId, {
      finalDebitFreight: 4_000_000,
      overrideReason: 'ops không được phép',
    });
    assert.ok([401, 403].includes(opsDenied.status), `expected denial, got ${opsDenied.status}`);

    // No override yet on a live snapshot: the frontend client treats 404 as
    // null, so the GET must 404 (not 200-with-wrapper).
    const noOverrideYet = await api('GET', `/pricing/snapshots/${snapshotId}/override`, accountantId);
    assert.equal(noOverrideYet.status, 404, JSON.stringify(noOverrideYet.body));

    const created = await api('PUT', `/pricing/snapshots/${snapshotId}/override`, accountantId, {
      finalDebitFreight: 4_000_000,
      overrideReason: 'Đàm phán lại giá cước tháng 9',
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    // Response body is the override row itself (frontend DebitNoteOverrideRow).
    assert.equal((created.body as { finalDebitFreight: number }).finalDebitFreight, 4_000_000);
    assert.equal((created.body as { systemCalculatedFreight: number }).systemCalculatedFreight, TOTAL_D18);
    const overrideId = (created.body as { id: number }).id;
    createdOverrideIds.push(overrideId);

    // After the upsert the override GET returns the row directly.
    const overrideGet = await api('GET', `/pricing/snapshots/${snapshotId}/override`, accountantId);
    assert.equal(overrideGet.status, 200);
    assert.equal((overrideGet.body as { finalDebitFreight: number }).finalDebitFreight, 4_000_000);

    const readBack = await api('GET', `/pricing/snapshots/${snapshotId}`, accountantId);
    assert.equal(readBack.status, 200);
    const override = (readBack.body as { override: { finalDebitFreight: number; systemCalculatedFreight: number } }).override;
    assert.ok(override, 'override must ride the snapshot read model');
    assert.equal(override.finalDebitFreight, 4_000_000);
    assert.equal(override.systemCalculatedFreight, TOTAL_D18, 'system freight comes from the frozen row');

    // The shipment detail view also carries the override.
    const detail = await getShipmentDetail(autoShipmentId);
    assert.equal(detail.freightRate!.latest!.override!.finalDebitFreight, 4_000_000);
  });
});
