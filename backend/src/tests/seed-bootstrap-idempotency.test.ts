import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { OPS_EXPENSE_TYPE_DEFAULTS, Role } from '@tingting/shared';
import { seed } from '../seed';
import { customers as customerSeedRows, drivers as driverSeedRows, trucks as fleetTruckSeedRows } from '../seed/data';
import { seedFleet } from '../seed/seed-fleet';
import { normalizeSeedText } from '../seed/seed-identity';

const DEMO_USERNAMES = ['admin', 'giamdoc', 'ketoan', 'cus', 'dieuvan', 'laixe', 'giaonhan', 'thu', 'pho', 'quyet', 'customer'];
const ROOT_TRUCK_PLATES = ['60C-12345', '60C-23456', '60C-34567', '60C-45678', '60C-56789'];
const ROOT_CONTAINER_CODES = ['20DC', '20OT', '20RF', '40DC', '40HC', '40RF', '45HC'];
const ROOT_PORT_NAMES = [
  'Cảng Hải Phòng',
  'Cảng Đình Vũ',
  'TC - HICT',
  'Cảng Tân Cảng 128 Hải Phòng',
  'Cảng Tân Vũ',
  'Cảng Nam Hải Đình Vũ',
  'Cảng VIP Greenport',
  'ICD Hoàng Thành',
];
const ROOT_PORT_CODES = ['HPH', 'DVU', 'HICT', 'TC128', 'TVU', 'NHDV', 'VIPG', 'HTHA'];
const CUSTOMER_SEED_TAX_CODES = customerSeedRows.map((row) => row.taxCode);
const SAMPLE_TAX_CODES = ['0101234567', '0107654321'];
const REFERENCE_PORT_NAMES = ['Cảng Tân Vũ', 'Cảng Đình Vũ', 'Bãi SITC', 'Bãi GFT'];
const REFERENCE_CONTAINER_CODES = ['20DC', '40DC', '40HC'];
const FLEET_DRIVER_NAMES = driverSeedRows.map((row) => row.name);
const FLEET_TRAILER_PLATES = [...new Set(
  fleetTruckSeedRows
    .map((row) => row.trailerPlate.toUpperCase())
    .filter((value) => value.length > 0),
)];
const FLEET_TRUCK_PLATES = fleetTruckSeedRows.map((row) => row.plate.toUpperCase());
const CUS_DEMO_CODE = 'CUS-DEMO';
const CUS_DEMO_NAME = 'Đơn vị CUS Demo';
const OPS_EXPENSE_TYPE_CODES = Object.keys(OPS_EXPENSE_TYPE_DEFAULTS);
const LIFT_EFFECTIVE_DATE = '2026-08-01';

type SeedSnapshot = {
  demoUserIds: number[];
  rootTruckIds: number[];
  rootContainerTypeIds: number[];
  rootPortIds: number[];
  forwarderExpenseTypeIds: number[];
  customerSeedIds: number[];
  customerSeedPartnerIds: number[];
  sampleCustomerIds: number[];
  liftPricingIds: number[];
  clerkBusinessUnitIds: number[];
  clerkBusinessUnitLinkIds: number[];
  clerkCustomerLinkIds: number[];
};

type FleetSnapshot = {
  driverIds: number[];
  trailerIds: number[];
  truckIds: number[];
};

type UserSnapshot = typeof s.users.$inferSelect;

function sortedIds(ids: Array<number | null | undefined>): number[] {
  return [...new Set(ids.filter((value): value is number => typeof value === 'number'))].sort((a, b) => a - b);
}

async function collectSeedSnapshot(): Promise<SeedSnapshot> {
  const usernameKeys = DEMO_USERNAMES.map(normalizeSeedText);
  const users = await db.select({ id: s.users.id, username: s.users.username })
    .from(s.users)
    .where(sql`lower(btrim(${s.users.username})) in (${sql.join(usernameKeys.map((key) => sql`${key}`), sql`, `)})`);

  const rootTruckRows = await db.select({ id: s.trucks.id, licensePlate: s.trucks.licensePlate })
    .from(s.trucks)
    .where(inArray(s.trucks.licensePlate, ROOT_TRUCK_PLATES));

  const containerTypeRows = await db.select({ id: s.containerTypes.id, code: s.containerTypes.code })
    .from(s.containerTypes)
    .where(inArray(s.containerTypes.code, ROOT_CONTAINER_CODES));

  const portRows = await db.select({ id: s.ports.id, code: s.ports.code, name: s.ports.name })
    .from(s.ports)
    .where(sql`
      lower(btrim(${s.ports.code})) in (${sql.join(ROOT_PORT_CODES.map((code) => sql`${normalizeSeedText(code)}`), sql`, `)})
      or lower(btrim(${s.ports.name})) in (${sql.join(ROOT_PORT_NAMES.map((name) => sql`${normalizeSeedText(name)}`), sql`, `)})
    `);

  const forwarderRows = await db.select({ id: s.forwarderExpenseTypes.id, code: s.forwarderExpenseTypes.code })
    .from(s.forwarderExpenseTypes)
    .where(inArray(s.forwarderExpenseTypes.code, OPS_EXPENSE_TYPE_CODES));

  const customerRows = await db.select({
    id: s.customers.id,
    taxCode: s.customers.taxCode,
    partnerId: s.customers.partnerId,
  }).from(s.customers)
    .where(inArray(s.customers.taxCode, CUSTOMER_SEED_TAX_CODES));

  const sampleCustomerRows = await db.select({
    id: s.customers.id,
  }).from(s.customers)
    .where(inArray(s.customers.taxCode, SAMPLE_TAX_CODES));

  const liftRows = await db.select({
    id: s.liftPricing.id,
  }).from(s.liftPricing)
    .where(eq(s.liftPricing.effectiveDate, LIFT_EFFECTIVE_DATE));

  const [clerk] = await db.select({ id: s.users.id }).from(s.users)
    .where(eq(s.users.username, 'cus'))
    .limit(1);

  const businessUnits = await db.select({ id: s.businessUnits.id })
    .from(s.businessUnits)
    .where(sql`
      ${normalizeSeedText(CUS_DEMO_CODE)} = coalesce(nullif(lower(btrim(${s.businessUnits.code})), ''), '')
      or ${normalizeSeedText(CUS_DEMO_NAME)} = lower(btrim(${s.businessUnits.name}))
    `);
  const businessUnitIds = businessUnits.map((row) => row.id);

  const businessUnitLinks = clerk && businessUnitIds.length > 0
    ? await db.select({ id: s.userBusinessUnitLinks.id })
        .from(s.userBusinessUnitLinks)
        .where(and(
          eq(s.userBusinessUnitLinks.userId, clerk.id),
          inArray(s.userBusinessUnitLinks.businessUnitId, businessUnitIds),
        ))
    : [];

  const customerLinkIds = clerk
    ? await db.select({ id: s.userCustomerLinks.id })
        .from(s.userCustomerLinks)
        .where(and(
          eq(s.userCustomerLinks.userId, clerk.id),
          inArray(s.userCustomerLinks.customerId, sampleCustomerRows.map((row) => row.id)),
        ))
    : [];

  return {
    demoUserIds: sortedIds(users.map((row) => row.id)),
    rootTruckIds: sortedIds(rootTruckRows.map((row) => row.id)),
    rootContainerTypeIds: sortedIds(containerTypeRows.map((row) => row.id)),
    rootPortIds: sortedIds(portRows.map((row) => row.id)),
    forwarderExpenseTypeIds: sortedIds(forwarderRows.map((row) => row.id)),
    customerSeedIds: sortedIds(customerRows.map((row) => row.id)),
    customerSeedPartnerIds: sortedIds(customerRows.map((row) => row.partnerId)),
    sampleCustomerIds: sortedIds(sampleCustomerRows.map((row) => row.id)),
    liftPricingIds: sortedIds(liftRows.map((row) => row.id)),
    clerkBusinessUnitIds: sortedIds(businessUnitIds),
    clerkBusinessUnitLinkIds: sortedIds(businessUnitLinks.map((row) => row.id)),
    clerkCustomerLinkIds: sortedIds(customerLinkIds.map((row) => row.id)),
  };
}

async function collectFleetSnapshot(): Promise<FleetSnapshot> {
  const drivers = await db.select({ id: s.drivers.id })
    .from(s.drivers)
    .where(sql`lower(btrim(${s.drivers.name})) in (${sql.join(FLEET_DRIVER_NAMES.map((name) => sql`${normalizeSeedText(name)}`), sql`, `)})`);

  const trailers = await db.select({ id: s.trailers.id })
    .from(s.trailers)
    .where(inArray(s.trailers.licensePlate, FLEET_TRAILER_PLATES));

  const trucks = await db.select({ id: s.trucks.id })
    .from(s.trucks)
    .where(inArray(s.trucks.licensePlate, FLEET_TRUCK_PLATES));

  return {
    driverIds: sortedIds(drivers.map((row) => row.id)),
    trailerIds: sortedIds(trailers.map((row) => row.id)),
    truckIds: sortedIds(trucks.map((row) => row.id)),
  };
}

async function fetchUserSnapshot(username: string): Promise<UserSnapshot> {
  const [user] = await db.select()
    .from(s.users)
    .where(eq(s.users.username, username))
    .limit(1);
  assert.ok(user, `expected seeded user ${username} to exist`);
  return user;
}

async function fetchUserSnapshotById(id: number): Promise<UserSnapshot> {
  const [user] = await db.select()
    .from(s.users)
    .where(eq(s.users.id, id))
    .limit(1);
  assert.ok(user, `expected user id=${id} to exist`);
  return user;
}

after(async () => {
  await client.end();
});

describe('seed bootstrap app-owned idempotency', () => {
  test('full seed does not resurrect stale normalized variants and creates canonical demo users separately', async () => {
    const cusBefore = await fetchUserSnapshot('cus');
    const opsBefore = await fetchUserSnapshot('giaonhan');
    const invalidPasswordHash = await bcrypt.hash('NotTheSeedPassword', 10);
    const softDeletedAt = new Date('2026-08-01T00:00:00.000Z');
    let createdCusId: number | null = null;
    let createdOpsId: number | null = null;

    try {
      await db.update(s.users).set({
        username: ' CUS ',
        email: 'legacy-cus@example.test',
        phone: '0199999991',
        fullName: 'CUS legacy',
        passwordHash: invalidPasswordHash,
        role: sql`'CLERK'`,
        status: 'INACTIVE',
        deletedAt: softDeletedAt,
      }).where(eq(s.users.id, cusBefore.id));
      await db.update(s.users).set({
        username: ' GIAONHAN ',
        email: 'legacy-ops@example.test',
        phone: '0199999992',
        fullName: 'Giao nhận legacy',
        passwordHash: invalidPasswordHash,
        role: sql`'FORWARDER'`,
        status: 'INACTIVE',
        deletedAt: softDeletedAt,
      }).where(eq(s.users.id, opsBefore.id));

      await seed();

      const cusLegacyAfterSeed = await fetchUserSnapshotById(cusBefore.id);
      const opsLegacyAfterSeed = await fetchUserSnapshotById(opsBefore.id);
      const cusCanonical = await fetchUserSnapshot('cus');
      const opsCanonical = await fetchUserSnapshot('giaonhan');
      const scopeAfterSeed = await collectSeedSnapshot();

      assert.equal(cusLegacyAfterSeed.username, ' CUS ');
      assert.equal(cusLegacyAfterSeed.email, 'legacy-cus@example.test');
      assert.equal(cusLegacyAfterSeed.phone, '0199999991');
      assert.equal(cusLegacyAfterSeed.fullName, 'CUS legacy');
      assert.equal(String(cusLegacyAfterSeed.role), 'CLERK');
      assert.equal(cusLegacyAfterSeed.status, 'INACTIVE');
      assert.equal(cusLegacyAfterSeed.deletedAt?.toISOString(), softDeletedAt.toISOString());
      assert.equal(await bcrypt.compare('NotTheSeedPassword', cusLegacyAfterSeed.passwordHash), true);

      assert.equal(opsLegacyAfterSeed.username, ' GIAONHAN ');
      assert.equal(opsLegacyAfterSeed.email, 'legacy-ops@example.test');
      assert.equal(opsLegacyAfterSeed.phone, '0199999992');
      assert.equal(opsLegacyAfterSeed.fullName, 'Giao nhận legacy');
      assert.equal(String(opsLegacyAfterSeed.role), 'FORWARDER');
      assert.equal(opsLegacyAfterSeed.status, 'INACTIVE');
      assert.equal(opsLegacyAfterSeed.deletedAt?.toISOString(), softDeletedAt.toISOString());
      assert.equal(await bcrypt.compare('NotTheSeedPassword', opsLegacyAfterSeed.passwordHash), true);

      assert.notEqual(cusCanonical.id, cusBefore.id);
      assert.equal(cusCanonical.email, 'cus@nepo.vn');
      assert.equal(cusCanonical.phone, '0900000005');
      assert.equal(cusCanonical.fullName, 'Nhân viên CUS Demo');
      assert.equal(cusCanonical.role, Role.CUS);
      assert.equal(cusCanonical.status, 'ACTIVE');
      assert.equal(cusCanonical.deletedAt, null);
      assert.equal(await bcrypt.compare('Abc123', cusCanonical.passwordHash), true);

      assert.notEqual(opsCanonical.id, opsBefore.id);
      assert.equal(opsCanonical.email, 'giaonhan@nepo.vn');
      assert.equal(opsCanonical.phone, '0900000004');
      assert.equal(opsCanonical.fullName, 'Nguyễn Văn Giao');
      assert.equal(opsCanonical.role, Role.OPS);
      assert.equal(opsCanonical.status, 'ACTIVE');
      assert.equal(opsCanonical.deletedAt, null);
      assert.equal(await bcrypt.compare('Abc123', opsCanonical.passwordHash), true);

      createdCusId = cusCanonical.id;
      createdOpsId = opsCanonical.id;

      assert.ok(scopeAfterSeed.clerkBusinessUnitLinkIds.length >= 1);
      assert.ok(scopeAfterSeed.clerkCustomerLinkIds.length >= SAMPLE_TAX_CODES.length);

      await seed();

      assert.deepEqual(await fetchUserSnapshot('cus'), cusCanonical);
      assert.deepEqual(await fetchUserSnapshot('giaonhan'), opsCanonical);
      assert.deepEqual(await fetchUserSnapshotById(cusBefore.id), cusLegacyAfterSeed);
      assert.deepEqual(await fetchUserSnapshotById(opsBefore.id), opsLegacyAfterSeed);
      assert.deepEqual(await collectSeedSnapshot(), scopeAfterSeed);
    } finally {
      const createdIds = [createdCusId, createdOpsId].filter((value): value is number => value != null);
      if (createdIds.length > 0) {
        await db.delete(s.userShipmentLinks).where(inArray(s.userShipmentLinks.userId, createdIds));
        await db.delete(s.userBusinessUnitLinks).where(inArray(s.userBusinessUnitLinks.userId, createdIds));
        await db.delete(s.userCustomerLinks).where(inArray(s.userCustomerLinks.userId, createdIds));
      }
      if (createdCusId != null) {
        await db.delete(s.users).where(eq(s.users.id, createdCusId));
      }
      if (createdOpsId != null) {
        await db.delete(s.users).where(eq(s.users.id, createdOpsId));
      }
      await db.update(s.users).set({
        username: cusBefore.username,
        email: cusBefore.email,
        phone: cusBefore.phone,
        fullName: cusBefore.fullName,
        passwordHash: cusBefore.passwordHash,
        role: cusBefore.role,
        status: cusBefore.status,
        customerId: cusBefore.customerId,
        customerAccountType: cusBefore.customerAccountType,
        createdAt: cusBefore.createdAt,
        updatedAt: cusBefore.updatedAt,
        deletedAt: cusBefore.deletedAt,
      }).where(eq(s.users.id, cusBefore.id));
      await db.update(s.users).set({
        username: opsBefore.username,
        email: opsBefore.email,
        phone: opsBefore.phone,
        fullName: opsBefore.fullName,
        passwordHash: opsBefore.passwordHash,
        role: opsBefore.role,
        status: opsBefore.status,
        customerId: opsBefore.customerId,
        customerAccountType: opsBefore.customerAccountType,
        createdAt: opsBefore.createdAt,
        updatedAt: opsBefore.updatedAt,
        deletedAt: opsBefore.deletedAt,
      }).where(eq(s.users.id, opsBefore.id));
    }
  });

  test('full seed keeps the same canonical ids on repeat runs', async () => {
    await seed();
    const before = await collectSeedSnapshot();
    const adminBefore = await fetchUserSnapshot('admin');
    const customerBefore = await fetchUserSnapshot('customer');

    assert.ok(before.demoUserIds.length >= DEMO_USERNAMES.length);
    assert.ok(before.rootTruckIds.length >= ROOT_TRUCK_PLATES.length);
    assert.ok(before.rootContainerTypeIds.length >= REFERENCE_CONTAINER_CODES.length);
    assert.ok(before.rootPortIds.length >= REFERENCE_PORT_NAMES.length);
    assert.ok(before.forwarderExpenseTypeIds.length >= OPS_EXPENSE_TYPE_CODES.length);
    assert.ok(before.customerSeedIds.length >= CUSTOMER_SEED_TAX_CODES.length);
    assert.ok(before.customerSeedPartnerIds.length >= CUSTOMER_SEED_TAX_CODES.length);
    assert.ok(before.sampleCustomerIds.length >= SAMPLE_TAX_CODES.length);
    assert.ok(before.clerkBusinessUnitIds.length >= 1);
    assert.ok(before.clerkBusinessUnitLinkIds.length >= 1);
    assert.ok(before.clerkCustomerLinkIds.length >= SAMPLE_TAX_CODES.length);
    assert.ok(before.liftPricingIds.length >= 24);

    await seed();
    const after = await collectSeedSnapshot();
    const adminAfter = await fetchUserSnapshot('admin');
    const customerAfter = await fetchUserSnapshot('customer');

    assert.deepEqual(after, before);
    assert.deepEqual(adminAfter, adminBefore);
    assert.deepEqual(customerAfter, customerBefore);
  });

  test('fleet reseed keeps the same driver, trailer, and truck ids', async () => {
    await seedFleet();
    const before = await collectFleetSnapshot();

    assert.ok(before.driverIds.length >= FLEET_DRIVER_NAMES.length);
    assert.ok(before.trailerIds.length >= FLEET_TRAILER_PLATES.length);
    assert.ok(before.truckIds.length >= FLEET_TRUCK_PLATES.length);

    await seedFleet();
    const after = await collectFleetSnapshot();

    assert.deepEqual(after, before);
  });
});
