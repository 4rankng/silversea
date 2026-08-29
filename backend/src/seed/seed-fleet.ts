/**
 * Seed the fleet: trucks (BKS), trailers (romooc), and drivers (DS NHÂN SỮ
 * Lái xe rows). Trucks are matched to their named driver where the name
 * resolves against the driver roster.
 *
 * `trucks` has no tonnage column; the Excel "Loại hình xe" class
 * (NẶNG 2 CẦU 3 GIÀN, etc.) and tonnage are captured in `notes` only — this
 * is a documented representability gap (see docs/customer-workflow-gap-analysis.md §2).
 *
 * Part of plans/260731-customer-audit-reseed.
 */
import { sql } from 'drizzle-orm';
import { reassignTruckDriverInTx } from '../services/truck-driver-assignment.service';
import { db } from '../db/index.js';
import * as s from '../db/schema/index.js';
import { trucks as truckSeeds, drivers as driverSeeds } from './data/index.js';
import { normalizedTextEquals } from './seed-identity.js';

export interface FleetSeedResult {
  truckByPlate: Map<string, number>;
  driverByName: Map<string, number>;
}

/** Normalize a Vietnamese name for fuzzy matching (strip accents, lowercase). */
function normName(name: string): string {
  return (name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function seedFleet(): Promise<FleetSeedResult> {
  const truckByPlate = new Map<string, number>();
  const driverByName = new Map<string, number>();

  // --- Drivers (unique on name where deletedAt is null; no explicit index but
  //     the app treats name as the natural key). Insert-or-skip by name. ---
  for (const d of driverSeeds) {
    const existing = await db.select({ id: s.drivers.id })
      .from(s.drivers)
      .where(sql`lower(btrim(${s.drivers.name})) = lower(btrim(${d.name})) AND ${s.drivers.deletedAt} IS NULL`);
    const row = {
      name: d.name,
      phone: d.phone || null,
      baseSalary: '5000000', // placeholder until payroll imports real base salaries
      status: 'ACTIVE' as const,
      socialInsurance: '0',
    };
    let id: number;
    if (existing.length > 0) {
      await db.update(s.drivers).set({ ...row, updatedAt: new Date() })
        .where(sql`${s.drivers.id} = ${existing[0]!.id}`);
      id = existing[0]!.id;
    } else {
      const [ins] = await db.insert(s.drivers).values(row).returning({ id: s.drivers.id });
      id = ins!.id;
    }
    driverByName.set(normName(d.name), id);
  }
  console.log(`✅ Drivers seeded! (${driverSeeds.length})`);

  // --- Trailers (romooc). unique on license_plate. ---
  const trailerPlates = new Set<string>();
  for (const t of truckSeeds) {
    if (!t.trailerPlate) continue;
    const tp = t.trailerPlate.toUpperCase();
    if (trailerPlates.has(tp)) continue;
    trailerPlates.add(tp);
    const is40 = tp.includes('RM'); // RM-series romoocs are heavy/40ft-class
    const [existingTrailer] = await db.select({ id: s.trailers.id })
      .from(s.trailers)
      .where(normalizedTextEquals(s.trailers.licensePlate, tp))
      .limit(1);
    if (existingTrailer) {
      await db.update(s.trailers).set({
        licensePlate: tp,
        type: is40 ? '40FT' : '20FT',
        status: 'ACTIVE',
        deletedAt: null,
        updatedAt: new Date(),
      }).where(sql`${s.trailers.id} = ${existingTrailer.id}`);
    } else {
      await db.insert(s.trailers).values({
        licensePlate: tp,
        type: is40 ? '40FT' : '20FT',
        status: 'ACTIVE',
      });
    }
  }
  console.log(`✅ Trailers seeded! (${trailerPlates.size})`);

  // --- Trucks (BKS). unique on license_plate. ---
  for (const t of truckSeeds) {
    const plate = t.plate.toUpperCase();
    const driverId = t.driverName ? driverByName.get(normName(t.driverName)) ?? null : null;
    const trailerRow = t.trailerPlate
      ? await db.select({ id: s.trailers.id }).from(s.trailers)
          .where(normalizedTextEquals(s.trailers.licensePlate, t.trailerPlate.toUpperCase()))
      : [];
    const noteParts = [t.vehicleClass && `Loại hình: ${t.vehicleClass}`].filter(Boolean);
    if (t.maxPayloadKg) noteParts.push(`Tải trọng tối đa: ${t.maxPayloadKg} kg`);
    if (t.preferredRoute) noteParts.push(`Tuyến ưu tiên: ${t.preferredRoute}`);
    const [existingTruck] = await db.select({ id: s.trucks.id })
      .from(s.trucks)
      .where(normalizedTextEquals(s.trucks.licensePlate, plate))
      .limit(1);
    let truckId: number;
    if (existingTruck) {
      await db.update(s.trucks).set({
        licensePlate: plate,
        trailerPlateNumber: t.trailerPlate || null,
        currentTrailerId: trailerRow[0]?.id ?? null,
        status: 'ACTIVE',
        deletedAt: null,
        updatedAt: new Date(),
      }).where(sql`${s.trucks.id} = ${existingTruck.id}`);
      truckId = existingTruck.id;
    } else {
      const [createdTruck] = await db.insert(s.trucks).values({
        licensePlate: plate,
        trailerPlateNumber: t.trailerPlate || null,
        currentTrailerId: trailerRow[0]?.id ?? null,
        status: 'ACTIVE',
      }).returning({ id: s.trucks.id });
      truckId = createdTruck!.id;
    }
    truckByPlate.set(plate, truckId);

    // Link driver to truck if both resolved.
    if (driverId) {
      await db.transaction((tx) => reassignTruckDriverInTx(tx, { truckId, driverId, createdBy: null }));
    }
  }
  console.log(`✅ Trucks seeded! (${truckSeeds.length})`);

  return { truckByPlate, driverByName };
}

export { normName };
