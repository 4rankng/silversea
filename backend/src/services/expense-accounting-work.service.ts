import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role, round2dp, type ExpenseListQuery, type ExpenseWorkList, type ExpenseWorkRow } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { ExpenseActor } from './expense-accounting-write.service';
import { loadExpenseAccountingEntries } from './expense-accounting-reads.service';

const sum = (rows: Array<number | null>) => rows.includes(null) ? null : rows.reduce<number>((total, n) => round2dp(total + (n ?? 0)), 0);

/** One row per actual work/trip, including work without any submitted expense. */
export async function listExpenseAccountingWork(actor: ExpenseActor, query: ExpenseListQuery): Promise<ExpenseWorkList> {
  if (![Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(actor.role)) throw new ApiError(403, 'Bạn không có quyền xem phơi phiếu.');
  const [work, entries, containerTypes, ports, assignments, carriers, suppliers, pairs] = await Promise.all([
    db.select({ t: { id: s.tripsComposite.id, status: s.tripsComposite.status, departureDate: s.tripsComposite.departureDate,
      truckId: s.tripsComposite.truckId, activeTripPairId: s.tripsComposite.activeTripPairId,
      carrierType: s.tripsComposite.carrierType, externalPlateNumber: s.tripsComposite.externalPlateNumber,
      externalEntityId: s.tripsComposite.externalEntityId, externalEntityType: s.tripsComposite.externalEntityType,
      externalDriverName: s.tripsComposite.externalDriverName, notes: s.tripsComposite.instructionNotes }, shipment: s.shipments, customer: s.customers.name,
      route: s.routes.name, plate: s.trucks.licensePlate, driver: s.drivers.name }).from(s.tripsComposite)
      .innerJoin(s.shipments, eq(s.shipments.id, s.tripsComposite.shipmentId))
      .innerJoin(s.customers, eq(s.customers.id, s.tripsComposite.customerId))
      .leftJoin(s.routes, eq(s.routes.id, s.tripsComposite.routeId)).leftJoin(s.trucks, eq(s.trucks.id, s.tripsComposite.truckId))
      .leftJoin(s.drivers, eq(s.drivers.id, s.tripsComposite.driverId))
      .where(and(isNull(s.tripsComposite.deletedAt), query.shipmentId ? eq(s.tripsComposite.shipmentId, query.shipmentId) : undefined)),
    loadExpenseAccountingEntries(actor, { shipmentId: query.shipmentId, page: 1, limit: 100 }, db),
    db.select().from(s.containerTypes), db.select().from(s.ports),
    db.select().from(s.truckAccountantAssignments).where(isNull(s.truckAccountantAssignments.endedAt)),
    db.select({ id: s.customers.id, name: s.customers.name }).from(s.customers),
    db.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers), db.select().from(s.tripPairs),
  ]);
  const tripIds = work.map(w => w.t.id);
  const containers = tripIds.length ? await db.select({ c: s.tripContainers, source: s.shipmentContainers }).from(s.tripContainers)
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.tripContainers.sourceShipmentContainerId))
    .where(inArray(s.tripContainers.tripId, tripIds)) : [];
  const search = query.search?.trim().toLocaleLowerCase('vi');
  const all: ExpenseWorkRow[] = work.filter(({ t }) => t.status !== 'CANCELED'
    && (!query.from || t.departureDate >= query.from) && (!query.to || t.departureDate <= query.to)
    && (!query.truckId || t.truckId === query.truckId)
    && (query.accountantId == null || (assignments.find(a => a.truckId === t.truckId)?.accountantId ?? 0) === query.accountantId))
    .map(({ t, shipment, customer, route, plate, driver }) => {
      const rowEntries = entries.filter(e => e.tripId === t.id);
      const cs = containers.filter(c => c.c.tripId === t.id);
      const first = cs[0]?.source;
      const firstType = cs[0]?.c.containerTypeId;
      return { id: `TRIP:${t.id}`, tripId: t.id, shipmentId: shipment.id, shipmentCode: shipment.shipmentCode ?? `#${shipment.id}`,
        scheduledAt: first?.customerAppointmentAt?.toISOString() ?? t.departureDate,
        customerName: customer, routeName: route, containerNumber: cs.map(c => c.c.containerNumber).filter(Boolean).join(', ') || null,
        containerType: containerTypes.find(c => c.id === firstType)?.code ?? null,
        classification: t.activeTripPairId ? (pairs.find(p => p.id === t.activeTripPairId)?.pairKind === 'KEP' ? 'Kẹp' : 'Kết hợp') : 'Đơn',
        liftLocation: ports.find(p => p.id === first?.pickupPortId)?.name ?? first?.rawPickupPortName ?? null,
        dropLocation: ports.find(p => p.id === first?.dropoffPortId)?.name ?? first?.rawDropoffPortName ?? null,
        carrierName: t.carrierType === 'OWN' ? 'SilverSea' : (t.externalEntityType === 'SUPPLIER' ? suppliers : carriers).find(c => c.id === t.externalEntityId)?.name ?? 'Chưa xác định nhà xe',
        vehiclePlate: plate ?? t.externalPlateNumber, driverName: driver ?? t.externalDriverName,
        operationalNotes: shipment.operationalNotes, driverNotes: t.notes,
        receivable: sum(rowEntries.map(e => e.customerChargeAmount)), payable: sum(rowEntries.filter(e => e.costGroup !== 'DRIVER_ROAD').map(e => e.payerKind === 'COMPANY' ? 0 : e.payableEntityId == null ? null : e.amount)),
        road: sum(rowEntries.filter(e => e.costGroup === 'DRIVER_ROAD').map(e => e.amount)), entries: rowEntries };
    }).filter(row => !search || [row.shipmentCode, row.customerName, row.containerNumber, row.vehiclePlate, row.driverName, row.routeName]
      .some(v => v?.toLocaleLowerCase('vi').includes(search)))
    .sort((a, b) => query.groupByVehicle === 'true'
      ? (a.vehiclePlate ?? '').localeCompare(b.vehiclePlate ?? '', 'vi', { numeric: true }) || (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? '')
      : (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''));
  return { items: all.slice((query.page - 1) * query.limit, query.page * query.limit), total: all.length, page: query.page, limit: query.limit,
    totals: { receivable: sum(all.map(r => r.receivable)), payable: sum(all.map(r => r.payable)), road: sum(all.map(r => r.road)) } };
}
