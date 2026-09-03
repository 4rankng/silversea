import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import {
  prodStaff, prodDrivers, prodCustomers, prodSites, prodRoutes,
  prodTractors, prodTrailers,
} from './data/prod-master-data.js';
import { seedReference } from './seed-reference';
import { seedLiftPricing } from './seed-lift-pricing';
import { seedCustomers } from './seed-customers';
import { seedPricingTables } from './seed-pricing-tables';
import { seedOperationalSites } from './seed-operational-sites';
import { seedPorts } from './seed-ports';
import { seedVehiclesFromExcel } from './seed-vehicles-from-excel';

// ─── Prod seed: real customer master data only ───────────────────────────────
// Loads the 2026-09-03 Excel delivery (staff/roles, drivers, customers, sites,
// routes, fleet) and intentionally EXCLUDES every demo generator (sample
// customers, demo shipments/trips, bulk rows, demo AR/AP, CUS demo scope).
// Idempotent: every step upserts by a stable natural key (username, name,
// tax code, code, plate).

const ROLE_BY_GROUP: Record<string, Role> = {
  'Ban Giám Đốc': Role.MANAGER,
  'Kế toán': Role.ACCOUNTANT,
  'Ops': Role.OPS,
  'Điều vận': Role.DISPATCHER,
  'Cus': Role.CUS,
};

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

export async function seedProdUsers(passwordHash: string): Promise<void> {
  console.log('Seeding prod staff + driver logins...');
  for (const u of prodStaff) {
    const role = u.username === 'admin' ? Role.ADMIN : ROLE_BY_GROUP[u.roleGroup];
    if (!role) {
      console.log(`  ! unknown role group ${u.roleGroup} for ${u.username}`);
      continue;
    }
    const values = {
      username: u.username,
      fullName: u.fullName,
      passwordHash,
      role,
      status: 'ACTIVE',
    };
    const [existing] = await db.select({ id: s.users.id })
      .from(s.users)
      .where(eq(sql`lower(btrim(${s.users.username}))`, norm(u.username)))
      .limit(1);
    if (existing) {
      await db.update(s.users)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.users.id, existing.id));
    } else {
      await db.insert(s.users).values(values);
    }
  }
  console.log(`  staff: ${prodStaff.length} (admin + nv001..nvXXX)`);
}

export async function seedProdDrivers(passwordHash: string): Promise<void> {
  console.log('Seeding prod drivers (+ DRIVER user logins)...');
  for (const d of prodDrivers) {
    // DRIVER login: username = the sheet's driver code, password Abc123.
    const [existingUser] = await db.select({ id: s.users.id })
      .from(s.users)
      .where(eq(sql`lower(btrim(${s.users.username}))`, norm(d.username)))
      .limit(1);
    let userId: number;
    if (existingUser) {
      userId = existingUser.id;
      await db.update(s.users)
        .set({ role: Role.DRIVER, fullName: d.name, passwordHash, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(s.users.id, existingUser.id));
    } else {
      const [created] = await db.insert(s.users).values({
        username: d.username, fullName: d.name, passwordHash,
        role: Role.DRIVER, status: 'ACTIVE',
      }).returning({ id: s.users.id });
      userId = created!.id;
    }
    // Driver profile row linked to the login.
    const [existingDriver] = await db.select({ id: s.drivers.id })
      .from(s.drivers)
      .where(eq(sql`lower(btrim(${s.drivers.name}))`, norm(d.name)))
      .limit(1);
    if (existingDriver) {
      await db.update(s.drivers)
        .set({ userId, phone: d.phone, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(s.drivers.id, existingDriver.id));
    } else {
      await db.insert(s.drivers).values({
        userId, name: d.name, phone: d.phone, status: 'ACTIVE',
      });
    }
  }
  console.log(`  drivers: ${prodDrivers.length}`);
}

export async function seedProdCustomers(): Promise<void> {
  console.log('Seeding prod customers (LOGCOM; Long Minh comes via seedCustomers)...');
  for (const c of prodCustomers) {
    if (norm(c.code) === 'longminh') continue; // owned by the canonical seeder
    const values = {
      name: c.name,
      shortName: c.code,
      taxCode: c.taxCode,
      contactPerson: c.director,
      phone: c.directorPhone,
      contactInfo: c.email,
      paymentTermDays: c.paymentTermCuocDays,
      status: 'ACTIVE',
      debitNoteMode: 'MONTHLY',
    } as const;
    const [existing] = await db.select({ id: s.customers.id })
      .from(s.customers)
      .where(and(
        isNull(s.customers.deletedAt),
        eq(sql`lower(btrim(${s.customers.taxCode}))`, norm(c.taxCode)),
      ))
      .limit(1);
    if (existing) {
      await db.update(s.customers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.customers.id, existing.id));
    } else {
      await db.insert(s.customers).values(values);
    }
    console.log(`  customer: ${c.code} -> ${c.name}`);
  }
}

export async function seedProdSites(): Promise<void> {
  console.log('Seeding prod operational sites (8 factories/warehouses)...');
  for (const site of prodSites) {
    // Resolve the owning customer by the sheet's code (LONGMINH / LOGCOM) —
    // Long Minh's canonical shortName is 'LONG MINH', so accept both shapes.
    let customerId: number | null = null;
    const candidates = [site.customerCode, norm(site.customerCode) === 'longminh' ? 'LONG MINH' : null]
      .filter((v): v is string => Boolean(v));
    for (const code of candidates) {
      const [row] = await db.select({ id: s.customers.id })
        .from(s.customers)
        .where(and(
          isNull(s.customers.deletedAt),
          eq(sql`upper(btrim(${s.customers.shortName}))`, code.trim().toUpperCase()),
        ))
        .limit(1);
      if (row) { customerId = row.id; break; }
    }
    if (!customerId) {
      console.log(`  ! customer not found for site ${site.code} (${site.customerCode}) — skipped`);
      continue;
    }
    const values = {
      customerId,
      code: site.code,
      name: site.name,
      shortName: site.shortName ?? site.code,
      siteType: site.name.toLowerCase().includes('kho') ? 'WAREHOUSE' : 'FACTORY',
      address: site.address ?? '',
      strictRules: site.note,
      googleMapsUrl: site.mapsUrl,
      contactPhone: site.contactPhone,
      updatedAt: new Date(),
    } as const;
    const [existing] = await db.select({ id: s.operationalSites.id })
      .from(s.operationalSites)
      .where(and(
        isNull(s.operationalSites.deletedAt),
        eq(s.operationalSites.customerId, customerId),
        eq(s.operationalSites.code, site.code),
      ))
      .limit(1);
    if (existing) {
      await db.update(s.operationalSites)
        .set({ ...values, version: sql`${s.operationalSites.version} + 1` })
        .where(eq(s.operationalSites.id, existing.id));
    } else {
      await db.insert(s.operationalSites).values({ ...values, isActive: true });
    }
    console.log(`  site: ${site.code} -> ${site.name}`);
  }
}

export async function seedProdRoutes(): Promise<void> {
  console.log('Seeding prod routes (5)...');
  for (const r of prodRoutes) {
    const values = {
      name: r.name,
      shortName: r.shortName ?? '',
      distanceKm: r.distanceKm,
      isMountain: false,
    };
    const [existing] = await db.select({ id: s.routes.id })
      .from(s.routes)
      .where(and(
        isNull(s.routes.deletedAt),
        eq(sql`lower(btrim(${s.routes.name}))`, norm(r.name)),
      ))
      .limit(1);
    if (existing) {
      await db.update(s.routes)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.routes.id, existing.id));
    } else {
      await db.insert(s.routes).values(values);
    }
    console.log(`  route: ${r.name}`);
  }
}

export async function seedProdFleetExtras(): Promise<void> {
  console.log('Seeding fleet units new since the July extract (trucks + trailers + pairings)...');
  const fleetPlates = new Set(
    (await db.select({ plate: s.trucks.licensePlate }).from(s.trucks)).map(t => t.plate),
  );
  for (const t of prodTractors) {
    if (fleetPlates.has(t.plate)) continue;
    const [existing] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.plate))
      .limit(1);
    if (existing) continue;
    await db.insert(s.trucks).values({ licensePlate: t.plate, status: 'ACTIVE' });
    console.log(`  truck: ${t.plate}`);
  }
  const driverByNormName = new Map(
    (await db.select({ id: s.drivers.id, name: s.drivers.name }).from(s.drivers))
      .map(d => [norm(d.name), d.id]),
  );
  for (const t of prodTractors) {
    if (!t.driverName) continue;
    const driverId = driverByNormName.get(norm(t.driverName));
    if (!driverId) continue;
    const [truckRow] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.plate))
      .limit(1);
    if (!truckRow) continue;
    const [existingAssignment] = await db.select({ id: s.truckDriverAssignments.id })
      .from(s.truckDriverAssignments)
      .where(and(
        eq(s.truckDriverAssignments.truckId, truckRow.id),
        isNull(s.truckDriverAssignments.endsAt),
      ))
      .limit(1);
    if (existingAssignment) continue;
    await db.insert(s.truckDriverAssignments).values({ truckId: truckRow.id, driverId });
  }
  // Trailer ROWS are intentionally NOT created: the sheet carries no trailer
  // type (a NOT NULL enum), and the canonical fleet seeder tracks trailers as
  // plates on trucks (trailerPlateNumber). Only the tractor<->trailer pairing
  // from the Mooc sheet is applied.
  for (const t of prodTrailers) {
    if (!t.pairedTractor) continue;
    const [truckRow] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.pairedTractor))
      .limit(1);
    if (!truckRow) continue;
    await db.update(s.trucks)
      .set({ trailerPlateNumber: t.plate, updatedAt: new Date() })
      .where(eq(s.trucks.id, truckRow.id));
  }
}

export async function seedProd(): Promise<void> {
  const passwordHash = await bcrypt.hash('Abc123', 10);
  // Reference + master data from the canonical real-data seeders (upserts).
  const reference = await seedReference();
  await seedLiftPricing(reference);
  await seedCustomers();
  await seedPricingTables(reference, await seedCustomers());
  await seedOperationalSites();
  // seedFactories is intentionally excluded: its July-extract codes (NEWEB-KHO 1)
  // duplicate the Sep-2026 sheet codes (NEWEB-1) loaded by seedProdSites.
  await seedPorts();
  await seedVehiclesFromExcel();
  await seedProdUsers(passwordHash);
  await seedProdDrivers(passwordHash);
  await seedProdCustomers();
  await seedProdSites();
  await seedProdRoutes();
  await seedProdFleetExtras();
  console.log('');
  console.log('✅ Prod seed complete (master data only — no demo rows).');
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  seedProd()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Prod seed failed:', err);
      process.exit(1);
    });
}
