/**
 * Ops fleet tracking (docs/prd/OpsVanHanh.md §4): read-only view of the trucks
 * an Ops owns, each paired with its current dispatch + driver-synced status,
 * plus the admin assignment command that feeds it.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, asc, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { ApiError } from '../errors';

export interface OpsFleetTruckItem {
  truckId: number;
  licensePlate: string;
  trailerPlate: string | null;
  tripId: number | null;
  tripCode: string | null;
  shipmentCode: string | null;
  driverName: string | null;
  /** null = no current trip → "Đang rảnh" */
  status: 'CREATED' | 'IN_TRANSIT' | 'COMPLETED' | null;
  lastEventType: string | null;
  updatedAt: string | null;
}

function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export async function getOpsFleet(userId: number): Promise<OpsFleetTruckItem[]> {
  const trucks = await db
    .select({
      truckId: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
      trailerPlate: s.trucks.trailerPlateNumber,
    })
    .from(s.truckOpsAssignments)
    .innerJoin(
      s.trucks,
      and(eq(s.trucks.id, s.truckOpsAssignments.truckId), isNull(s.trucks.deletedAt)),
    )
    .where(and(
      eq(s.truckOpsAssignments.opsUserId, userId),
      eq(s.truckOpsAssignments.isActive, true),
    ))
    .orderBy(asc(s.trucks.licensePlate));

  if (trucks.length === 0) return [];
  const truckIds = trucks.map((truck) => truck.truckId);

  // Live trips always show. Completed trips are candidates only when they
  // finished today (VN local) — "Đã hoàn thành" is the newest completion of
  // the day, so long hauls that departed days ago still count.
  const vnToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const vnStartOfToday = new Date(`${vnToday}T00:00:00+07:00`);
  const trips = await db
    .select({
      id: s.trips.id,
      truckId: s.trips.truckId,
      tripCode: s.trips.tripCode,
      status: s.trips.status,
      updatedAt: s.trips.updatedAt,
      completedAt: s.trips.completedAt,
      driverName: s.drivers.name,
      shipmentCode: s.shipments.shipmentCode,
    })
    .from(s.trips)
    .leftJoin(s.drivers, eq(s.drivers.id, s.trips.driverId))
    .leftJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
    .where(and(
      inArray(s.trips.truckId, truckIds),
      isNull(s.trips.deletedAt),
      ne(s.trips.status, 'CANCELED'),
      or(
        inArray(s.trips.status, ['CREATED', 'IN_TRANSIT']),
        gte(s.trips.completedAt, vnStartOfToday),
      )!,
    ))
    .orderBy(desc(s.trips.updatedAt));

  // Per truck keep: the live trip (IN_TRANSIT beats CREATED), else the newest
  // COMPLETED — the query above already bounds completed candidates to
  // "finished today (VN)", so any COMPLETED row here qualifies.
  const picked = new Map<number, (typeof trips)[number]>();
  for (const trip of trips) {
    if (trip.truckId == null) continue; // inArray already implies membership
    if (trip.status === 'CREATED' || trip.status === 'IN_TRANSIT') {
      const current = picked.get(trip.truckId);
      if (!current || current.status === 'COMPLETED' || (
        current.status === 'CREATED' && trip.status === 'IN_TRANSIT'
      )) {
        picked.set(trip.truckId, trip);
      }
    } else if (!picked.has(trip.truckId)) {
      picked.set(trip.truckId, trip);
    }
  }

  const activeTripIds = [...picked.values()]
    .filter((trip) => trip.status === 'IN_TRANSIT' || trip.status === 'CREATED')
    .map((trip) => trip.id);
  const latestEventByTrip = new Map<number, { eventType: string; createdAt: Date }>();
  if (activeTripIds.length > 0) {
    const events = await db
      .select({
        tripId: s.driverProgressEvents.tripId,
        eventType: s.driverProgressEvents.eventType,
        createdAt: s.driverProgressEvents.createdAt,
      })
      .from(s.driverProgressEvents)
      .where(inArray(s.driverProgressEvents.tripId, activeTripIds))
      .orderBy(desc(s.driverProgressEvents.createdAt));
    for (const event of events) {
      if (!latestEventByTrip.has(event.tripId)) {
        latestEventByTrip.set(event.tripId, {
          eventType: event.eventType,
          createdAt: event.createdAt,
        });
      }
    }
  }

  return trucks.map((truck) => {
    const trip = picked.get(truck.truckId);
    const event = trip ? latestEventByTrip.get(trip.id) : undefined;
    return {
      truckId: truck.truckId,
      licensePlate: truck.licensePlate,
      trailerPlate: truck.trailerPlate,
      tripId: trip?.id ?? null,
      tripCode: trip?.tripCode ?? null,
      shipmentCode: trip?.shipmentCode ?? null,
      driverName: trip?.driverName ?? null,
      // The CANCELED member of the enum is filtered out above; narrow for the
      // response type.
      status: (trip?.status ?? null) as OpsFleetTruckItem['status'],
      lastEventType: event?.eventType ?? null,
      updatedAt: isoOrNull(trip?.updatedAt ?? null),
    };
  });
}

/** Active truck→ops assignments with names, for the admin fleet control. */
export async function listActiveTruckOpsAssignments(): Promise<Array<{
  truckId: number;
  opsUserId: number;
  opsUserName: string | null;
}>> {
  return db
    .select({
      truckId: s.truckOpsAssignments.truckId,
      opsUserId: s.truckOpsAssignments.opsUserId,
      opsUserName: s.users.fullName,
    })
    .from(s.truckOpsAssignments)
    .leftJoin(s.users, eq(s.users.id, s.truckOpsAssignments.opsUserId))
    .where(eq(s.truckOpsAssignments.isActive, true));
}

/**
 * Admin assigns (or clears, opsUserId = null) the single active Ops owner of a
 * truck. Deactivating the previous row first keeps the partial unique index
 * happy; the transaction makes reassignment atomic.
 */
export async function setTruckOpsAssignment(
  truckId: number,
  opsUserId: number | null,
): Promise<{ opsUserId: number | null }> {
  const [truck] = await db
    .select({ id: s.trucks.id })
    .from(s.trucks)
    .where(and(eq(s.trucks.id, truckId), isNull(s.trucks.deletedAt)))
    .limit(1);
  if (!truck) throw new ApiError(404, 'Không tìm thấy xe');

  if (opsUserId != null) {
    const [opsUser] = await db
      .select({ id: s.users.id, role: s.users.role })
      .from(s.users)
      .where(eq(s.users.id, opsUserId))
      .limit(1);
    if (!opsUser || opsUser.role !== 'OPS') {
      throw new ApiError(400, 'Người được gán phải có vai trò OPS');
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(s.truckOpsAssignments)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(
        eq(s.truckOpsAssignments.truckId, truckId),
        eq(s.truckOpsAssignments.isActive, true),
      ));
    if (opsUserId != null) {
      await tx.insert(s.truckOpsAssignments).values({ truckId, opsUserId });
    }
  });

  return { opsUserId };
}
