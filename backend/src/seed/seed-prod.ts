import bcrypt from 'bcryptjs';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import {
  prodStaff, prodDrivers, prodCustomers, prodSites, prodRoutes,
  prodTractors, prodTrailers, prodPorts,
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
  // The sheet lists only NV001..NV022; the shared admin login is a bootstrap
  // entry prepended here so a fresh provision gets it from the seed itself.
  const staffWithAdmin = [{
    username: 'admin', employeeCode: 'ADMIN', fullName: 'Quản trị viên', roleGroup: 'Ban Giám Đốc',
  }, ...prodStaff];
  for (const u of staffWithAdmin) {
    const role = u.username === 'admin' ? Role.ADMIN : ROLE_BY_GROUP[u.roleGroup];
    if (!role) {
      console.log(`  ! unknown role group ${u.roleGroup} for ${u.username}`);
      continue;
    }
    const values = {
      username: u.username,
      employeeCode: u.employeeCode,
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
  console.log(`  staff: ${staffWithAdmin.length} (admin + nv001..nv022)`);
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
    const driverValues = {
      userId,
      phone: d.phone,
      code: d.code,
      idNumber: d.idNumber,
      licenseNumber: d.licenseNumber,
      licenseExpiryDate: d.licenseExpiryDate,
      bankName: d.bankName,
      bankAccount: d.bankAccount,
      salaryType: d.salaryType,
      status: 'ACTIVE',
    } as const;
    if (existingDriver) {
      await db.update(s.drivers)
        .set({ ...driverValues, updatedAt: new Date() })
        .where(eq(s.drivers.id, existingDriver.id));
    } else {
      await db.insert(s.drivers).values({ name: d.name, ...driverValues });
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
      accountantName: c.accountantName,
      accountantPhone: c.accountantPhone,
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
      contactName: site.contactName,
      contactPhone: site.contactPhone,
      warehouseContactInfo: site.warehouseContactInfo,
      liftInfo: site.liftInfo,
      dropInfo: site.dropInfo,
      cleaningInfo: site.cleaningInfo,
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
      code: r.code,
      shortName: r.shortName ?? '',
      loadPoint: r.loadPoint,
      note: r.note,
      distanceKm: r.distanceKm,
      tollsStations: r.tolls,
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

export async function seedProdPorts(): Promise<void> {
  console.log(`Seeding prod ports/yards (${prodPorts.length})...`);
  for (const p of prodPorts) {
    // The canonical seeder (seed-ports.ts, July extract) may already own this
    // port under a different display name for the same code (e.g. "TC - HICT"
    // vs this sheet's "Cảng Lạch Huyện - HICT") — match by code FIRST so we
    // enrich the existing row instead of colliding on the unique code index.
    // Only the new descriptive fields are set on an existing row; name/code
    // stay owned by whichever seeder created the row first.
    const enrichValues = {
      address: p.address,
      classification: p.classification,
      legalEntity: p.legalEntity,
      isLachHuyen: p.isLachHuyen,
      opsPortalUrl: p.opsPortalUrl,
      position: p.position,
    } as const;
    const [existingByCode] = p.code
      ? await db.select({ id: s.ports.id })
        .from(s.ports)
        .where(and(isNull(s.ports.deletedAt), eq(s.ports.code, p.code)))
        .limit(1)
      : [undefined];
    const [existing] = existingByCode
      ? [existingByCode]
      : await db.select({ id: s.ports.id })
        .from(s.ports)
        .where(and(
          isNull(s.ports.deletedAt),
          eq(sql`lower(btrim(${s.ports.name}))`, norm(p.name)),
        ))
        .limit(1);
    if (existing) {
      await db.update(s.ports)
        .set({ ...enrichValues, updatedAt: new Date() })
        .where(eq(s.ports.id, existing.id));
    } else {
      await db.insert(s.ports).values({ ...enrichValues, name: p.name, code: p.code ?? undefined });
    }
  }
  console.log(`  ports: ${prodPorts.length}`);
}

export async function seedProdFleetExtras(): Promise<void> {
  console.log('Seeding fleet spec data (trucks, trailers, pairings)...');
  const numToStr = (v: number | null): string | null => (v == null ? null : String(v));

  // Tractors: upsert the sheet's spec fields, merging over the July extract
  // (trailerPlateNumber/trailerType stay owned by the canonical seeder).
  for (const t of prodTractors) {
    const values = {
      vehicleClass: t.vehicleClass,
      brand: t.brand,
      towCapacityTons: numToStr(t.towCapacityTons),
      fuelLPer100kmLoaded: numToStr(t.fuelLPer100kmLoaded),
      fuelLPer100kmEmpty: numToStr(t.fuelLPer100kmEmpty),
      preferredRoute: t.preferredRoute,
      note: t.note,
    };
    const [existing] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.plate))
      .limit(1);
    if (existing) {
      await db.update(s.trucks)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.trucks.id, existing.id));
    } else {
      await db.insert(s.trucks).values({ licensePlate: t.plate, status: 'ACTIVE', ...values });
      console.log(`  truck added: ${t.plate}`);
    }
  }
  // Trailers: the fleet sheet maps 1:1 (plate + spec fields), so trailer
  // rows are created here — type stays null where Loại Moóc is blank.
  for (const t of prodTrailers) {
    const values = {
      type: (t.type === '20FT' || t.type === '40FT' ? t.type : null) as '20FT' | '40FT' | null,
      maxPayloadTons: numToStr(t.maxPayloadTons),
      maxAxleLoadFrontTons: numToStr(t.maxAxleLoadFrontTons),
      maxAxleLoadRearTons: numToStr(t.maxAxleLoadRearTons),
      inspectionDeadline: t.inspectionDeadline,
      note: t.note,
    };
    const [existing] = await db.select({ id: s.trailers.id })
      .from(s.trailers)
      .where(eq(s.trailers.licensePlate, t.plate))
      .limit(1);
    if (existing) {
      await db.update(s.trailers)
        .set({ ...values, updatedAt: new Date() })
        .where(eq(s.trailers.id, existing.id));
    } else {
      await db.insert(s.trailers).values({ licensePlate: t.plate, status: 'ACTIVE', ...values });
    }
  }
  // Pairing: tractor <- trailer (Mooc sheet), stored as trailerPlateNumber
  // (the canonical plate link) and currentTrailerId (the FK the app reads).
  for (const t of prodTrailers) {
    if (!t.pairedTractor) continue;
    const [trailerRow] = await db.select({ id: s.trailers.id })
      .from(s.trailers)
      .where(eq(s.trailers.licensePlate, t.plate))
      .limit(1);
    const [truckRow] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.pairedTractor))
      .limit(1);
    if (!truckRow) continue;
    await db.update(s.trucks)
      .set({
        trailerPlateNumber: t.plate,
        currentTrailerId: trailerRow?.id ?? null,
        updatedAt: new Date(),
      })
      .where(eq(s.trucks.id, truckRow.id));
  }
  console.log(`  trailers: ${prodTrailers.length}, pairings applied`);
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
  await seedProdPorts();
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
