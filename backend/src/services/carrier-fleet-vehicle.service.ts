import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

function formatPlate(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function normalizePlate(value: string): string {
  return formatPlate(value).replace(/[^A-Z0-9]/g, '');
}

async function assertActiveCarrier(carrierId: number, tx?: Tx) {
  const executor = tx ?? db;
  const [carrier] = await executor.select({
    id: s.customers.id,
    status: s.customers.status,
    isCarrier: s.customers.isCarrier,
  }).from(s.customers).where(and(
    eq(s.customers.id, carrierId),
    isNull(s.customers.deletedAt),
  )).limit(1);
  if (!carrier || !carrier.isCarrier || carrier.status !== 'ACTIVE') {
    throw new ApiError(409, 'Nhà xe không tồn tại hoặc không còn hoạt động.');
  }
}

/**
 * Reverse lookup: plate → owning carrier (BUG 3 autofill). Two sources,
 * catalog first: carrier-fleet-vehicles rows, then fleet-page truck links
 * (trucks.carrier_id — separator-insensitive match). Normalizes with the
 * shared plate normalizer so dashed/dotted plates match their stored
 * alphanumeric form; a LOCKED (non-ACTIVE) carrier resolves to nulls on
 * BOTH fields so the editor never auto-fills an entity the dispatch write
 * would later 409 on.
 */
export async function resolveCarrierByPlate(plate: string): Promise<{ carrierId: number | null; carrierName: string | null }> {
  const normalized = normalizePlate(plate);
  const [row] = await db.select({
    carrierId: s.carrierFleetVehicles.carrierId,
    carrierName: s.customers.name,
    status: s.customers.status,
  })
    .from(s.carrierFleetVehicles)
    .innerJoin(s.customers, eq(s.carrierFleetVehicles.carrierId, s.customers.id))
    .where(and(
      eq(s.carrierFleetVehicles.normalizedPlate, normalized),
      eq(s.carrierFleetVehicles.isActive, true),
      isNull(s.carrierFleetVehicles.deletedAt),
      isNull(s.customers.deletedAt),
    ))
    .orderBy(desc(s.carrierFleetVehicles.id))
    .limit(1);
  if (row) {
    // Catalog hit: a LOCKED carrier resolves to nulls on BOTH fields so the
    // editor never auto-fills an entity the dispatch write would later 409 on.
    if (row.status !== 'ACTIVE') return { carrierId: null, carrierName: null };
    return { carrierId: row.carrierId, carrierName: row.carrierName };
  }
  // Fleet-page links (trucks.carrier_id) resolve with the same contract —
  // separator-insensitive plate match (15E-016.26 ≡ 15E01626); only ACTIVE
  // trucks owned by ACTIVE carriers qualify, so the explicit link always
  // wins over the generic internal-fleet default.
  const [truck] = await db.select({
    carrierId: s.trucks.carrierId,
    carrierName: s.customers.name,
  })
    .from(s.trucks)
    .innerJoin(s.customers, and(
      eq(s.customers.id, s.trucks.carrierId),
      eq(s.customers.status, 'ACTIVE'),
      isNull(s.customers.deletedAt),
    ))
    .where(and(
      sql`regexp_replace(upper(${s.trucks.licensePlate}), '[^A-Z0-9]', '', 'g') = ${normalized}`,
      eq(s.trucks.status, 'ACTIVE'),
      isNull(s.trucks.deletedAt),
    ))
    .orderBy(desc(s.trucks.id))
    .limit(1);
  if (truck) return { carrierId: truck.carrierId, carrierName: truck.carrierName };
  return { carrierId: null, carrierName: null };
}

export async function listCarrierFleetVehicles(carrierId: number) {
  await assertActiveCarrier(carrierId);
  return db.select().from(s.carrierFleetVehicles).where(and(
    eq(s.carrierFleetVehicles.carrierId, carrierId),
    isNull(s.carrierFleetVehicles.deletedAt),
  )).orderBy(asc(s.carrierFleetVehicles.licensePlate), asc(s.carrierFleetVehicles.id));
}

export async function createCarrierFleetVehicle(input: {
  carrierId: number;
  licensePlate: string;
  isActive: boolean;
  actorUserId: number;
}, tx?: Tx) {
  const executor = tx ?? db;
  await assertActiveCarrier(input.carrierId, tx);
  const licensePlate = formatPlate(input.licensePlate);
  const normalizedPlate = normalizePlate(input.licensePlate);
  if (normalizedPlate.length < 5) throw new ApiError(400, 'Biển số xe không hợp lệ.');
  const [duplicate] = await executor.select({ id: s.carrierFleetVehicles.id })
    .from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.carrierId, input.carrierId),
      eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
      isNull(s.carrierFleetVehicles.deletedAt),
    ))
    .limit(1);
  if (duplicate) throw new ApiError(409, 'Biển số này đã có trong danh sách xe của nhà xe.');
  const [vehicle] = await executor.insert(s.carrierFleetVehicles).values({
    carrierId: input.carrierId,
    licensePlate,
    normalizedPlate,
    isActive: input.isActive,
    createdBy: input.actorUserId,
    updatedBy: input.actorUserId,
  }).returning();
  return vehicle;
}

export async function updateCarrierFleetVehicle(id: number, input: {
  licensePlate?: string;
  isActive?: boolean;
  actorUserId: number;
}, tx?: Tx) {
  const executor = tx ?? db;
  const [existing] = await executor.select().from(s.carrierFleetVehicles).where(and(
    eq(s.carrierFleetVehicles.id, id),
    isNull(s.carrierFleetVehicles.deletedAt),
  )).limit(1);
  if (!existing) throw new ApiError(404, 'Không tìm thấy xe của nhà xe.');
  const normalizedPlate = input.licensePlate == null ? existing.normalizedPlate : normalizePlate(input.licensePlate);
  const licensePlate = input.licensePlate == null ? existing.licensePlate : formatPlate(input.licensePlate);
  if (normalizedPlate.length < 5) throw new ApiError(400, 'Biển số xe không hợp lệ.');
  const [duplicate] = await executor.select({ id: s.carrierFleetVehicles.id })
    .from(s.carrierFleetVehicles)
    .where(and(
      eq(s.carrierFleetVehicles.carrierId, existing.carrierId),
      eq(s.carrierFleetVehicles.normalizedPlate, normalizedPlate),
      isNull(s.carrierFleetVehicles.deletedAt),
    ))
    .limit(1);
  if (duplicate && duplicate.id !== id) {
    throw new ApiError(409, 'Biển số này đã có trong danh sách xe của nhà xe.');
  }
  const [vehicle] = await executor.update(s.carrierFleetVehicles).set({
    licensePlate,
    normalizedPlate,
    isActive: input.isActive ?? existing.isActive,
    updatedBy: input.actorUserId,
    updatedAt: new Date(),
  }).where(eq(s.carrierFleetVehicles.id, id)).returning();
  return vehicle;
}

