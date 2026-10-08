/**
 * CUS workspace status census (card 081026093520): FULL-set per-status counts
 * for the "Chưa chốt lịch / Chờ điều xe / Chờ đối soát" tabs, over the SAME
 * filtered set the list's `total` counts (the status-tab lens itself excluded —
 * that lens is client-side by contract and `total` never sees it either). Each
 * count sizes exactly the rows that tab's lens reveals across pages, so a
 * numeral can never disagree with the list behind it and the four tab counts
 * read as one scale.
 *
 * Every derivation here goes through the SAME builders the rows themselves use
 * (`deriveScheduleReadiness` / `deriveVehicleReadiness` /
 * `currentAssignmentIdentity` / `getShipmentFinanceConfirmationSummaries`) —
 * deliberately no SQL mirror of the readiness rules: one rule, two callers.
 */
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import { db, type Executor } from '../db';
import * as s from '../db/schema';
import { plannedCarrier } from './cus-workspace-sql.service';
import { getShipmentFinanceConfirmationSummaries } from './shipment-accounting-lock-reads.service';
import {
  currentAssignmentIdentity,
  deriveCusBucket,
  deriveScheduleReadiness,
  deriveVehicleReadiness,
  indexAssignmentRows,
} from './cus-workspace-builders.service';

export type CusShipmentStatusCounts = {
  needsSchedule: number;
  needsVehicle: number;
  waitingAccounting: number;
};

/**
 * Count the three readiness buckets across every shipment the caller's
 * conditions select. `conditions` is the list's own WHERE set (built once by
 * the caller), so the counts follow base filter/search exactly like `total`.
 */
export async function loadCusShipmentStatusCounts(
  conditions: SQL[],
  executor: Executor = db,
): Promise<CusShipmentStatusCounts> {
  const counts: CusShipmentStatusCounts = { needsSchedule: 0, needsVehicle: 0, waitingAccounting: 0 };
  const shipments = await executor.select({
    id: s.shipments.id,
    status: s.shipments.status,
    cargoMode: s.shipments.cargoMode,
    expectedDeliveryDate: s.shipments.expectedDeliveryDate,
    closingAt: s.shipments.closingAt,
    plannedReturnAt: s.shipments.plannedReturnAt,
  }).from(s.shipments)
    .where(and(...conditions));
  if (shipments.length === 0) return counts;
  const shipmentIds = shipments.map((row) => row.id);

  // Same sources, same WHEREs as the page's support load (loadSupportRows),
  // trimmed to the fields the readiness derivations read.
  const [containerRows, fulfillmentRows, lockRows, confirmations] = await Promise.all([
    executor.select({
      id: s.shipmentContainers.id,
      shipmentId: s.shipmentContainers.shipmentId,
      customerAppointmentAt: s.shipmentContainers.customerAppointmentAt,
    }).from(s.shipmentContainers)
      .where(inArray(s.shipmentContainers.shipmentId, shipmentIds)),
    executor.select({
      shipmentContainerId: s.shipmentFulfillments.shipmentContainerId,
      shipmentId: s.shipmentFulfillments.shipmentId,
      plannedCarrierType: s.shipmentFulfillments.plannedCarrierType,
      plannedExternalCarrierId: s.shipmentFulfillments.plannedExternalCarrierId,
      plannedExternalCarrierVehicleId: s.shipmentFulfillments.plannedExternalCarrierVehicleId,
      plannedVehiclePlateNumber: s.shipmentFulfillments.plannedVehiclePlateNumber,
      plannedCarrierName: plannedCarrier.name,
      plannedCarrierShortName: plannedCarrier.shortName,
    }).from(s.shipmentFulfillments)
      .leftJoin(plannedCarrier, eq(plannedCarrier.id, s.shipmentFulfillments.plannedExternalCarrierId))
      .where(and(
        inArray(s.shipmentFulfillments.shipmentId, shipmentIds),
        isNull(s.shipmentFulfillments.canceledAt),
      )),
    executor.select({ shipmentId: s.shipmentAccountingLocks.shipmentId })
      .from(s.shipmentAccountingLocks)
      .where(and(
        inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds),
        isNull(s.shipmentAccountingLocks.releasedAt),
      )),
    getShipmentFinanceConfirmationSummaries(shipmentIds, executor),
  ]);

  const containersByShipment = new Map<number, typeof containerRows>();
  for (const row of containerRows) {
    const bucket = containersByShipment.get(row.shipmentId) ?? [];
    bucket.push(row);
    containersByShipment.set(row.shipmentId, bucket);
  }
  const assignments = indexAssignmentRows(fulfillmentRows);
  const lockedShipments = new Set(lockRows.map((row) => row.shipmentId));

  for (const shipment of shipments) {
    const hasActiveLock = lockedShipments.has(shipment.id);
    const containers = containersByShipment.get(shipment.id) ?? [];
    const lotIdentity = currentAssignmentIdentity(assignments.byShipment.get(shipment.id) ?? null);
    const scheduleReadiness = deriveScheduleReadiness({
      cargoMode: shipment.cargoMode,
      expectedDeliveryDate: shipment.expectedDeliveryDate,
      closingAt: shipment.closingAt,
      plannedReturnAt: shipment.plannedReturnAt,
      containerAppointments: containers.map((container) => container.customerAppointmentAt),
      bucket: deriveCusBucket(shipment.status, hasActiveLock),
    });
    const vehicleReadiness = deriveVehicleReadiness({
      containerIdentities: containers.map((container) => {
        const identity = currentAssignmentIdentity(assignments.byContainer.get(container.id) ?? null);
        return { carrierType: identity.carrierType, plateNumber: identity.plateNumber };
      }),
      lotIdentity,
    });
    // The tab predicates — the SAME expressions the FE's LOT_STATUS_TABS
    // `matches` apply when a tab slices the loaded page (twin pinned by the
    // FE render tests and the route tests' page-walk count).
    if (scheduleReadiness === 'WAITING_DATE') counts.needsSchedule += 1;
    if (vehicleReadiness === 'WAITING_CARRIER' || vehicleReadiness === 'WAITING_PLATE') {
      counts.needsVehicle += 1;
    }
    const confirmation = confirmations.get(shipment.id);
    if (!hasActiveLock
      && (confirmation?.status === 'PENDING' || confirmation?.status === 'STALE')) {
      counts.waitingAccounting += 1;
    }
  }
  return counts;
}
