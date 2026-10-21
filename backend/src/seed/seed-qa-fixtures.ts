/**
 * ENV-01 QA-fixture seed executor (runs AFTER the stgdb sync + purge).
 *
 * Writes the `stgqa-fixtures.ts` catalog into the configured DATABASE_URL so
 * QA has a demo unit + sample lots right after a prod→staging sync — người
 * dùng không phải nhập liệu 2 lần khi thử nghiệm.
 *
 * Idempotent on natural keys (BU code, customer code, site code,
 * shipment_code, container number): a second run converges rows in place
 * (reviving soft-deleted fixture rows the purge hid) instead of duplicating
 * them, so `make stgqa` (and re-running the seed alone) is safe to repeat.
 *
 * Usage (from backend/):
 *   STGQA_ENV=local   npx tsx src/seed/seed-qa-fixtures.ts
 *   STGQA_ENV=staging (on the server, via make stgqa:
 *                     node dist/seed/seed-qa-fixtures.js)
 *
 * Hard interlock, same law as purge-qa-fixtures.ts: refuses to run without
 * an explicit env grant and refuses a DATABASE_URL that points at the prod
 * host. The fixture rows carry QA marker signatures, so prod-mirror reads
 * hide them (FB-061) and `make qapurge` removes them — re-seed to restore.
 */
import { and, eq, sql } from 'drizzle-orm';
import { db, client } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { buildStgqaFixtureSet } from './stgqa-fixtures.js';

/** Purge/seed environments the executor accepts. */
export type StgqaEnv = 'local' | 'staging';

/**
 * Pure gate — null when allowed, otherwise the refusal reason. Shared shape
 * with the password reset's gate so tests can pin both.
 */
export function stgqaEnvBlocked(env: NodeJS.ProcessEnv = process.env): string | null {
  const granted = env.STGQA_ENV;
  if (granted !== 'local' && granted !== 'staging') {
    return `STGQA-REFUSED: STGQA_ENV must be 'local' or 'staging' (got '${granted ?? 'unset'}') — the QA fixture seed never runs implicitly.`;
  }
  const url = env.DATABASE_URL ?? '';
  if (/silversea\.tingting/.test(url)) {
    return 'STGQA-REFUSED: DATABASE_URL points at the prod host — QA fixtures never touch prod.';
  }
  return null;
}

function assertEnvAllowed(): void {
  const reason = stgqaEnvBlocked();
  if (reason) {
    console.error(reason);
    process.exit(1);
  }
}

/** Fixture-row census of one table by the QA-ENV01 identifier prefix. */
async function countBy(table: 'bu' | 'kh' | 'kho' | 'lot' | 'cont'): Promise<number> {
  switch (table) {
    case 'bu':
      return scalar(`SELECT count(*)::int AS c FROM business_units WHERE code = 'QA-DEMO'`);
    case 'kh':
      return scalar(`SELECT count(*)::int AS c FROM customers WHERE code = 'QAKH-DEMO' AND deleted_at IS NULL`);
    case 'kho':
      return scalar(`SELECT count(*)::int AS c FROM operational_sites WHERE code = 'QAKHO-DEMO' AND deleted_at IS NULL`);
    case 'lot':
      return scalar(`SELECT count(*)::int AS c FROM shipments WHERE shipment_code LIKE 'QAENV01-%' AND deleted_at IS NULL`);
    case 'cont':
      return scalar(`SELECT count(*)::int AS c FROM shipment_containers WHERE container_number LIKE 'QATU%'`);
    default: {
      const never: never = table;
      throw new Error(`unreachable census target: ${String(never)}`);
    }
  }
}

async function scalar(query: string): Promise<number> {
  const result = await db.execute(sql.raw(query)) as unknown;
  const list = Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;
  return Number(list?.[0]?.c ?? 0);
}

async function seedBusinessUnit(): Promise<number> {
  const unit = buildStgqaFixtureSet().businessUnit;
  const [existing] = await db.select({ id: s.businessUnits.id })
    .from(s.businessUnits)
    .where(eq(s.businessUnits.code, unit.code))
    .limit(1);
  if (existing) {
    await db.update(s.businessUnits)
      .set({ name: unit.name, status: unit.status, updatedAt: new Date() })
      .where(eq(s.businessUnits.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db.insert(s.businessUnits)
    .values({ code: unit.code, name: unit.name, status: unit.status })
    .returning({ id: s.businessUnits.id });
  return inserted!.id;
}

async function seedCustomer(): Promise<number> {
  const customer = buildStgqaFixtureSet().customer;
  // Soft-deleted rows keep the seed-day code: revive in place instead of
  // inserting a duplicate (the active name+taxcode unique index would allow
  // it, and a second row would strand the purge/seed cycle).
  const [existing] = await db.select({ id: s.customers.id })
    .from(s.customers)
    .where(eq(s.customers.code, customer.code))
    .orderBy(s.customers.id)
    .limit(1);
  if (existing) {
    await db.update(s.customers)
      .set({
        name: customer.name,
        shortName: customer.shortName,
        taxCode: customer.taxCode,
        address: customer.address,
        contactPerson: customer.contactPerson,
        phone: customer.phone,
        status: 'ACTIVE',
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(s.customers.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db.insert(s.customers)
    .values({
      name: customer.name,
      shortName: customer.shortName,
      code: customer.code,
      taxCode: customer.taxCode,
      address: customer.address,
      contactPerson: customer.contactPerson,
      phone: customer.phone,
      status: 'ACTIVE',
    })
    .returning({ id: s.customers.id });
  return inserted!.id;
}

async function seedWarehouse(customerId: number): Promise<number> {
  const warehouse = buildStgqaFixtureSet().warehouse;
  const [existing] = await db.select({ id: s.operationalSites.id })
    .from(s.operationalSites)
    .where(and(
      eq(s.operationalSites.customerId, customerId),
      eq(s.operationalSites.code, warehouse.code),
    ))
    .orderBy(s.operationalSites.id)
    .limit(1);
  if (existing) {
    // The purge scrubs (renames) site rows rather than deleting them; restore
    // the full fixture identity so the lot intake can find the nhà xe again.
    await db.update(s.operationalSites)
      .set({
        name: warehouse.name,
        shortName: warehouse.shortName,
        address: warehouse.address,
        contactName: warehouse.contactName,
        contactPhone: warehouse.contactPhone,
        isActive: true,
        deletedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(s.operationalSites.id, existing.id));
    return existing.id;
  }
  const [inserted] = await db.insert(s.operationalSites)
    .values({
      customerId,
      code: warehouse.code,
      name: warehouse.name,
      shortName: warehouse.shortName,
      siteType: warehouse.siteType,
      address: warehouse.address,
      contactName: warehouse.contactName,
      contactPhone: warehouse.contactPhone,
    })
    .returning({ id: s.operationalSites.id });
  return inserted!.id;
}

/** Canonical container_types code → id (nullable: catalog missing ⇒ link stays
 *  NULL rather than inventing master data on a mirror). */
async function containerTypeIdByCode(code: string): Promise<number | null> {
  const [row] = await db.select({ id: s.containerTypes.id })
    .from(s.containerTypes)
    .where(eq(s.containerTypes.code, code))
    .limit(1);
  return row?.id ?? null;
}

async function seedShipment(
  fixture: ReturnType<typeof buildStgqaFixtureSet>['shipments'][number],
  ids: { businessUnitId: number; customerId: number; warehouseSiteId: number },
): Promise<number> {
  const [existing] = await db.select({ id: s.shipments.id })
    .from(s.shipments)
    .where(eq(s.shipments.shipmentCode, fixture.shipmentCode))
    .limit(1);
  const values = {
    customerId: ids.customerId,
    responsibleUnitId: ids.businessUnitId,
    pickupWarehouseSiteId: ids.warehouseSiteId,
    status: fixture.status,
    tradeDirection: fixture.tradeDirection,
    cargoMode: fixture.cargoMode,
    isCombined: fixture.isCombined,
    bookingRef: fixture.bookingRef,
    blNumber: fixture.blNumber,
    factoryName: fixture.factoryName,
    operationalNotes: fixture.operationalNotes,
    expectedDeliveryDate: fixture.expectedDeliveryDate,
    packageCount: fixture.packageCount,
    packageType: fixture.packageType,
    cargoWeightKg: fixture.cargoWeightKg,
    contactName: fixture.contactName,
    contactPhone: fixture.contactPhone,
    deletedAt: null,
    updatedAt: new Date(),
  };
  let shipmentId: number;
  if (existing) {
    shipmentId = existing.id;
    await db.update(s.shipments).set(values).where(eq(s.shipments.id, shipmentId));
  } else {
    const [inserted] = await db.insert(s.shipments)
      .values({ shipmentCode: fixture.shipmentCode, ...values })
      .returning({ id: s.shipments.id });
    shipmentId = inserted!.id;
  }
  return shipmentId;
}

async function seedContainers(
  shipmentId: number,
  containers: ReturnType<typeof buildStgqaFixtureSet>['shipments'][number]['containers'],
): Promise<void> {
  for (const container of containers) {
    const [existing] = await db.select({ id: s.shipmentContainers.id })
      .from(s.shipmentContainers)
      .where(and(
        eq(s.shipmentContainers.shipmentId, shipmentId),
        eq(s.shipmentContainers.containerNumber, container.containerNumber),
      ))
      .limit(1);
    const containerTypeId = await containerTypeIdByCode(container.containerTypeCode);
    if (existing) {
      await db.update(s.shipmentContainers)
        .set({ containerTypeId, sealNumber: container.sealNumber, updatedAt: new Date() })
        .where(eq(s.shipmentContainers.id, existing.id));
      continue;
    }
    await db.insert(s.shipmentContainers).values({
      shipmentId,
      containerTypeId,
      containerNumber: container.containerNumber,
      sealNumber: container.sealNumber,
    });
  }
}

async function main(): Promise<void> {
  assertEnvAllowed();
  console.log(`STGQA-SEED-START env=${process.env.STGQA_ENV}`);
  const set = buildStgqaFixtureSet();

  const businessUnitId = await seedBusinessUnit();
  const customerId = await seedCustomer();
  const warehouseSiteId = await seedWarehouse(customerId);
  console.log(`STGQA-SEED unit=QA-DEMO(${businessUnitId}) kh=QAKH-DEMO(${customerId}) kho=QAKHO-DEMO(${warehouseSiteId})`);

  for (const fixture of set.shipments) {
    const shipmentId = await seedShipment(fixture, { businessUnitId, customerId, warehouseSiteId });
    await seedContainers(shipmentId, fixture.containers);
    console.log(`STGQA-SEED lot=${fixture.shipmentCode}(${shipmentId}) ${fixture.cargoMode}${fixture.isCombined ? '+KEP' : ''} cont=${fixture.containers.length}`);
  }

  // Census in the seed's own vocabulary (identifier-gated, app-visible rows).
  const [bu, kh, kho, lot, cont] = await Promise.all([
    countBy('bu'), countBy('kh'), countBy('kho'), countBy('lot'), countBy('cont'),
  ]);
  console.log(`STGQA-SEED-SUMMARY units=${bu} customers=${kh} warehouses=${kho} lots=${lot} containers=${cont}`);
  await client.end({ timeout: 5 });
}

// Run directly (tsx src/seed/seed-qa-fixtures.ts); importable for tests.
if (process.argv[1]?.includes('seed-qa-fixtures')) {
  void main();
}
