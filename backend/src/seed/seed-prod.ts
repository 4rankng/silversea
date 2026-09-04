import bcrypt from 'bcryptjs';
import { and, count, eq, isNull, sql } from 'drizzle-orm';
import { Role } from '@tingting/shared';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import {
  prodStaff, prodDrivers, prodCustomers, prodSites, prodRoutes,
  prodTractors, prodTrailers, prodPorts, prodCarriers,
} from './data/prod-master-data.js';
import { seedReference } from './seed-reference';
import { seedLiftPricing } from './seed-lift-pricing';
import { seedCustomers } from './seed-customers';
import { seedPricingTables } from './seed-pricing-tables';
import { seedOperationalSites } from './seed-operational-sites';
import { seedPorts } from './seed-ports';
import { seedVehiclesFromExcel } from './seed-vehicles-from-excel';
import { upsertPartnerFromTaxCode } from '../services/legal-partner.service';
import { reassignTruckDriverInTx } from '../services/truck-driver-assignment.service';

// ─── Prod seed: real customer master data only ───────────────────────────────
// Loads the 2026-09-04 two-file delivery: master data from "4.9 - Import
// data form.xlsx" (drivers, customers, sites, routes, ports, fleet, carrier
// suppliers) and staff accounts from "User & Role.xlsx" (NV001..NV022 with
// R_* role codes — the account authority). Shared role logins such as
// ketoan/dieuvan/cus are STAGING-only and are never seeded here.
// Intentionally EXCLUDES every demo generator (sample customers, demo
// shipments/trips, bulk rows, demo AR/AP, CUS demo scope).
// Idempotent: every step upserts by a stable natural key (username, name,
// tax code, code, plate). Stale rows from earlier deliveries that the sheet
// no longer lists are HARD-deleted when nothing references them.

const ROLE_BY_GROUP: Record<string, Role> = {
  'Ban Giám Đốc': Role.MANAGER,
  'Giám đốc': Role.MANAGER,
  'PGĐ': Role.MANAGER,
  'Kế toán': Role.ACCOUNTANT,
  'Kế Toán': Role.ACCOUNTANT,
  'Ops': Role.OPS,
  'Điều vận': Role.DISPATCHER,
  'Điều Vận': Role.DISPATCHER,
  'Cus': Role.CUS,
  'CUS': Role.CUS,
};

// Staff accounts key on the customer's R_* permission codes (User & Role.xlsx).
const ROLE_BY_CODE: Record<string, Role> = {
  R_ADMIN: Role.ADMIN,
  R_ACC: Role.ACCOUNTANT,
  R_DIS: Role.DISPATCHER,
  R_CUS: Role.CUS,
  R_OPS: Role.OPS,
};

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

// Diacritic-fold so sheet corrections (Diệp -> Điệp) still match loaded rows.
const fold = (v: string | null | undefined): string => (v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .trim().toLowerCase();

const foldPlate = (raw: string): string => {
  const squashed = raw.replace(/\s+/g, '').replace(',', '.');
  const m = squashed.match(/^(\d{2}[A-Za-z]{1,2})-?(\d{2,5})\.?(\d{2})$/);
  return m ? `${m[1]!}-${m[2]!}.${m[3]!}` : raw.replace(/\s+/g, '');
};

export async function seedProdUsers(passwordHash: string): Promise<void> {
  console.log('Seeding prod staff logins (User & Role.xlsx: NV001..NV022)...');
  // The bootstrap admin is prepended (not in the sheet) so a fresh provision
  // gets it from the seed itself; it must run FIRST — it releases employee
  // code NV001 for the sheet's Nguyễn Thị Phương (unique index).
  const staffWithAdmin = [{
    username: 'admin', employeeCode: 'ADMIN', fullName: 'Quản trị viên',
    roleCode: null as string | null, roleGroup: 'Ban Giám Đốc' as string | null,
  }, ...prodStaff];
  for (const u of staffWithAdmin) {
    const role = u.username === 'admin' ? Role.ADMIN
      : (ROLE_BY_CODE[u.roleCode ?? ''] ?? ROLE_BY_GROUP[u.roleGroup ?? '']);
    if (!role) {
      console.log(`  ! unknown role for ${u.username} (${u.roleCode ?? u.roleGroup})`);
      continue;
    }
    const [existing] = await db.select({ id: s.users.id })
      .from(s.users)
      .where(eq(sql`lower(btrim(${s.users.username}))`, norm(u.username)))
      .limit(1);
    if (existing) {
      // Refresh roster fields only — never reset a password the account
      // owner may have changed since the account was created. Email clears
      // to null: accounts carry no email in User & Role.xlsx.
      await db.update(s.users)
        .set({ employeeCode: u.employeeCode, fullName: u.fullName, role, email: null, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(s.users.id, existing.id));
    } else {
      await db.insert(s.users).values({
        username: u.username, employeeCode: u.employeeCode, fullName: u.fullName,
        passwordHash, role, status: 'ACTIVE',
      });
    }
  }
  console.log(`  staff logins: ${staffWithAdmin.length} (admin + NV001..NV022)`);
}

export async function seedProdDrivers(passwordHash: string): Promise<void> {
  console.log('Seeding prod drivers (+ DRIVER user logins)...');
  // Driver profiles are matched in JS (code first, then diacritic-folded
  // name) so sheet spelling fixes (Diệp -> Điệp) update the loaded row
  // instead of forking a duplicate.
  const profiles = await db.select({ id: s.drivers.id, code: s.drivers.code, name: s.drivers.name })
    .from(s.drivers)
    .where(isNull(s.drivers.deletedAt));
  for (const d of prodDrivers) {
    // DRIVER login: username = the sheet's driver code, password Abc123 for
    // new accounts only — existing logins keep their current password.
    const [existingUser] = await db.select({ id: s.users.id })
      .from(s.users)
      .where(eq(sql`lower(btrim(${s.users.username}))`, norm(d.username)))
      .limit(1);
    let userId: number;
    if (existingUser) {
      userId = existingUser.id;
      await db.update(s.users)
        .set({ role: Role.DRIVER, fullName: d.name, status: 'ACTIVE', updatedAt: new Date() })
        .where(eq(s.users.id, existingUser.id));
    } else {
      const [created] = await db.insert(s.users).values({
        username: d.username, fullName: d.name, passwordHash,
        role: Role.DRIVER, status: 'ACTIVE',
      }).returning({ id: s.users.id });
      userId = created!.id;
    }
    const matched = profiles.find((row) => (row.code != null && norm(row.code) === norm(d.code))
      || fold(row.name) === fold(d.name));
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
    if (matched) {
      await db.update(s.drivers)
        .set({ ...driverValues, name: d.name, updatedAt: new Date() })
        .where(eq(s.drivers.id, matched.id));
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
  console.log('Seeding prod routes (Tuyến đường sheet)...');
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
  // Hard-delete routes from earlier deliveries that the sheet no longer
  // lists (Đồng Văn I/III, Nếnh, Nếnh 2...). Guarded by live references so
  // pricing-owned routes (ASKEY / Hải Phòng-NEWEB / SUNRISE+  SJ) survive.
  const kept = new Set(prodRoutes.map((r) => norm(r.name)));
  const allRoutes = await db.select({ id: s.routes.id, name: s.routes.name })
    .from(s.routes)
    .where(isNull(s.routes.deletedAt));
  for (const row of allRoutes) {
    if (kept.has(norm(row.name))) continue;
    const refs = await Promise.all([
      db.select({ n: count() }).from(s.trips).where(eq(s.trips.routeId, row.id)),
      db.select({ n: count() }).from(s.shipments).where(eq(s.shipments.routeId, row.id)),
      db.select({ n: count() }).from(s.pricingTables).where(eq(s.pricingTables.routeId, row.id)),
      db.select({ n: count() }).from(s.roadAllowances).where(eq(s.roadAllowances.routeId, row.id)),
      db.select({ n: count() }).from(s.weightPricingTiers).where(eq(s.weightPricingTiers.routeId, row.id)),
      db.select({ n: count() }).from(s.fuelNorms).where(eq(s.fuelNorms.routeId, row.id)),
      db.select({ n: count() }).from(s.operationalSites).where(eq(s.operationalSites.routeId, row.id)),
      db.select({ n: count() }).from(s.routePolylines).where(eq(s.routePolylines.routeId, row.id)),
    ]);
    const total = refs.reduce((sum, [r]) => sum + Number(r?.n ?? 0), 0);
    if (total === 0) {
      await db.delete(s.routes).where(eq(s.routes.id, row.id));
      console.log(`  route deleted (stale, unreferenced): ${row.name}`);
    } else {
      console.log(`  route kept (referenced by ${total} rows): ${row.name}`);
    }
  }
}

// July-extract rows the 4.9 sheet renamed — mapping the loaded display name
// to the sheet's new name lets the upsert enrich ONE row (and adopt the new
// identity) instead of forking a second row for the same physical port.
// Keys AND values are diacritic-folded (fold()-space) since lookups compare
// folded names.
const PORT_NAME_ALIASES: Record<string, string> = {
  'cang xanh - green port': 'cang green port',
  'cang xanh vip - vip green port': 'cang vipgreenport',
  'hateco - hhit': 'cang hateco',
  'icd': 'bai icd tan cang',
};

export async function seedProdPorts(): Promise<void> {
  console.log(`Seeding prod ports/yards (${prodPorts.length})...`);
  const sheetNames = new Set(prodPorts.map((p) => fold(p.name)));
  // Include soft-deleted rows: ports.code is a FULL unique index, so a
  // soft-deleted row still owns its code. Matching one reactivates it under
  // the sheet's identity instead of crashing on the code collision.
  const existingPorts = await db.select({ id: s.ports.id, code: s.ports.code, name: s.ports.name, deletedAt: s.ports.deletedAt })
    .from(s.ports);
  for (const p of prodPorts) {
    // Match by code first, then by (aliased) folded name — the canonical
    // seeder (seed-ports.ts, July extract) may own the row under a different
    // display name for the same code (e.g. "TC - HICT" for HICT). The sheet
    // is authoritative: a matched row adopts its name and code.
    const enrichValues = {
      address: p.address,
      classification: p.classification,
      legalEntity: p.legalEntity,
      isLachHuyen: p.isLachHuyen,
      opsPortalUrl: p.opsPortalUrl,
      position: p.position,
    } as const;
    const matched = existingPorts.find((row) => (p.code != null && row.code === p.code)
      || fold(row.name) === fold(p.name)
      || PORT_NAME_ALIASES[fold(row.name)] === fold(p.name));
    // The July seeder re-inserts its original rows on every seed run, so a
    // name/alias match can land on a stale duplicate while the canonical row
    // (matched earlier by its own sheet entry) already carries the sheet's
    // code. Resolve before writing: the code holder wins, the duplicate goes.
    let target = matched;
    if (matched && p.code != null) {
      const holder = existingPorts.find((row) => row.id !== matched.id && row.code === p.code);
      if (holder) {
        const [dupPriced] = await db.select({ n: count() })
          .from(s.liftPricing)
          .where(eq(s.liftPricing.portId, matched.id));
        if (Number(dupPriced?.n ?? 0) === 0) {
          await db.delete(s.ports).where(eq(s.ports.id, matched.id));
          console.log(`  port duplicate removed: ${matched.name} (code ${p.code} kept by ${holder.name})`);
          target = holder;
        } else {
          console.log(`  ! code ${p.code} held by ${holder.name}; enriching ${matched.name} under its old code`);
          target = matched;
        }
      }
    }
    if (target) {
      const codeCollision = p.code != null
        && existingPorts.some((row) => row.id !== target.id && row.code === p.code);
      const newCode = codeCollision ? target.code : (p.code ?? target.code);
      await db.update(s.ports)
        .set({ ...enrichValues, name: p.name, code: newCode, deletedAt: null, updatedAt: new Date() })
        .where(eq(s.ports.id, target.id));
      console.log(`  port: ${p.name}${fold(target.name) !== fold(p.name) ? ` (was: ${target.name})` : ''}${target.deletedAt != null ? ' (reactivated)' : ''}`);
      target.name = p.name;
      target.code = newCode;
      target.deletedAt = null;
    } else {
      const [created] = await db.insert(s.ports)
        .values({ ...enrichValues, name: p.name, code: p.code ?? undefined })
        .returning({ id: s.ports.id, code: s.ports.code, name: s.ports.name, deletedAt: s.ports.deletedAt });
      existingPorts.push(created!);
    }
  }
  // Hard-delete ports the sheet dropped (e.g. Cảng Hoàng Diệu) — guarded by
  // lift-pricing references so priced ports are never orphaned. Soft-deleted
  // rows stay deleted (they may still own their code in the unique index).
  for (const row of existingPorts) {
    if (row.deletedAt != null) continue;
    const keptBySheet = sheetNames.has(fold(row.name)) || Object.values(PORT_NAME_ALIASES).includes(fold(row.name));
    if (keptBySheet) continue;
    const [priced] = await db.select({ n: count() })
      .from(s.liftPricing)
      .where(eq(s.liftPricing.portId, row.id));
    if (Number(priced?.n ?? 0) === 0) {
      await db.delete(s.ports).where(eq(s.ports.id, row.id));
      console.log(`  port deleted (stale, no pricing): ${row.name}`);
    } else {
      console.log(`  port kept (has ${priced!.n} lift-pricing rows): ${row.name}`);
    }
  }
  console.log(`  ports: ${prodPorts.length}`);
}

export async function seedProdFleetExtras(): Promise<void> {
  console.log('Seeding fleet spec data (trucks, trailers, pairings)...');
  const numToStr = (v: number | null): string | null => (v == null ? null : String(v));

  // Earlier loads stored plates exactly as typed in the sheet (commas,
  // stray spaces: "15RM-023,26", "15H - 15077"). Normalize loaded plates to
  // the canonical shape first so the plate-keyed upserts below hit the
  // existing rows instead of forking duplicates.
  const truckRows = await db.select({ id: s.trucks.id, plate: s.trucks.licensePlate }).from(s.trucks);
  for (const row of truckRows) {
    const normalized = foldPlate(row.plate);
    if (normalized !== row.plate) {
      await db.update(s.trucks).set({ licensePlate: normalized, updatedAt: new Date() })
        .where(eq(s.trucks.id, row.id));
      console.log(`  truck plate normalized: ${row.plate} -> ${normalized}`);
    }
  }
  const trailerRows = await db.select({ id: s.trailers.id, plate: s.trailers.licensePlate }).from(s.trailers);
  for (const row of trailerRows) {
    const normalized = foldPlate(row.plate);
    if (normalized !== row.plate) {
      await db.update(s.trailers).set({ licensePlate: normalized, updatedAt: new Date() })
        .where(eq(s.trailers.id, row.id));
      console.log(`  trailer plate normalized: ${row.plate} -> ${normalized}`);
    }
  }

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
  // Tractor -> driver assignment ("Đang ghép với lái xe" column). Uses the
  // app's own reassignment service (1 xe 1 lái semantics, idempotent no-op
  // when the pair is already assigned).
  const driversForFleet = await db.select({ id: s.drivers.id, name: s.drivers.name })
    .from(s.drivers)
    .where(and(isNull(s.drivers.deletedAt), eq(s.drivers.status, 'ACTIVE')));
  let assigned = 0;
  for (const t of prodTractors) {
    if (!t.driverName) continue;
    const [truckRow] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(eq(s.trucks.licensePlate, t.plate))
      .limit(1);
    const driver = driversForFleet.find((d) => fold(d.name) === fold(t.driverName));
    if (!truckRow || !driver) {
      console.log(`  ! no truck/driver for pairing ${t.plate} <-> ${t.driverName}`);
      continue;
    }
    await db.transaction(async (tx) => {
      await reassignTruckDriverInTx(tx, {
        truckId: truckRow.id, driverId: driver.id, createdBy: null, skipAdvisoryLock: true,
      });
    });
    assigned += 1;
  }
  console.log(`  trailers: ${prodTrailers.length}, pairings applied, drivers assigned: ${assigned}`);
}

export async function seedProdCarriers(): Promise<void> {
  console.log('Seeding prod carrier suppliers (Nhà xe sheet)...');
  for (const c of prodCarriers) {
    const partnerId = await upsertPartnerFromTaxCode(c.taxCode);
    const [existing] = await db.select({ id: s.suppliers.id })
      .from(s.suppliers)
      .where(and(
        isNull(s.suppliers.deletedAt),
        partnerId != null
          ? and(eq(s.suppliers.partnerId, partnerId), sql`lower(btrim(${s.suppliers.name})) = ${norm(c.name)}`)
          : sql`lower(btrim(${s.suppliers.name})) = ${norm(c.name)}`,
      ))
      .limit(1);
    const values = {
      name: c.name,
      shortName: c.shortName,
      contactPerson: c.contactPerson,
      phone: c.phone,
      taxCode: c.taxCode,
      partnerId,
      types: ['CARRIER'],
      primaryType: 'CARRIER',
      status: 'ACTIVE',
      updatedAt: new Date(),
    };
    if (existing) {
      await db.update(s.suppliers).set(values).where(eq(s.suppliers.id, existing.id));
    } else {
      await db.insert(s.suppliers).values(values);
    }
  }
  console.log(`  carriers: ${prodCarriers.length}`);
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
  await seedProdCarriers();
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
