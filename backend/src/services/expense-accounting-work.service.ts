import { and, eq, inArray, isNull } from 'drizzle-orm';
import { Role, round2dp, type ExpenseAccountingEntry, type ExpenseListQuery, type ExpenseWorkList, type ExpenseWorkRow } from '@tingting/shared';
import { db } from '../db';
import type { Tx } from './trip-shared';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import type { ExpenseActor } from './expense-accounting-write.service';
import { loadExpenseAccountingEntries } from './expense-accounting-reads.service';

const businessDay = (value: string) => value.length === 10 ? value : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
const amount = (value: string | null) => value == null ? null : Number(value);
const sum = (rows: Array<number | null>) => rows.includes(null) ? null : rows.reduce<number>((total, n) => round2dp(total + (n ?? 0)), 0);

/** One row per actual work/trip, including work without any submitted expense. */
export async function listExpenseAccountingWork(actor: ExpenseActor, query: ExpenseListQuery, transaction?: Tx): Promise<ExpenseWorkList> {
  if (![Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(actor.role)) throw new ApiError(403, 'Bạn không có quyền xem phơi phiếu.');
  const executor = transaction ?? db;
  const [work, entries, containerTypes, ports, assignments, carriers, suppliers, pairs, sites] = await Promise.all([
    executor.select({ t: { id: s.tripsComposite.id, status: s.tripsComposite.status, departureDate: s.tripsComposite.departureDate,
      totalRoadAllowance: s.tripsComposite.totalRoadAllowance, vehicleShiftAllowance: s.tripsComposite.vehicleShiftAllowance,
      tollCost: s.tripsComposite.tollCost, reconciledTollCost: s.tripsComposite.reconciledTollCost, reconciledExtraCost: s.tripsComposite.reconciledExtraCost,
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
    loadExpenseAccountingEntries(actor, { shipmentId: query.shipmentId, page: 1, limit: 100 }, executor),
    executor.select().from(s.containerTypes), executor.select().from(s.ports),
    executor.select().from(s.truckAccountantAssignments).where(isNull(s.truckAccountantAssignments.endedAt)),
    executor.select({ id: s.customers.id, name: s.customers.name }).from(s.customers),
    executor.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers), executor.select().from(s.tripPairs),
    executor.select({ id: s.operationalSites.id, name: s.operationalSites.name }).from(s.operationalSites),
  ]);
  const tripIds = work.map(w => w.t.id);
  const containers = tripIds.length ? await executor.select({ c: s.tripContainers, source: s.shipmentContainers }).from(s.tripContainers)
    .leftJoin(s.shipmentContainers, eq(s.shipmentContainers.id, s.tripContainers.sourceShipmentContainerId))
    .where(inArray(s.tripContainers.tripId, tripIds)) : [];
  const search = query.search?.trim().toLocaleLowerCase('vi');
  const all: ExpenseWorkRow[] = work.filter(({ t }) => t.status !== 'CANCELED'
    && (!query.truckId || t.truckId === query.truckId)
    && (query.accountantId == null || (assignments.find(a => a.truckId === t.truckId)?.accountantId ?? 0) === query.accountantId))
    .map(({ t, shipment, customer, route, plate, driver }) => {
      const rowEntries = entries.filter(e => e.tripId === t.id);
      const pair = pairs.find(p => p.id === t.activeTripPairId && p.status === 'ACTIVE');
      // Derived trip financial state is the cost authority. Submitted receipts
      // replace toll estimates there; adding them again here doubles the cost.
      const roadBreakdown: ExpenseWorkRow['roadBreakdown'] = {
        roadAllowance: amount(t.totalRoadAllowance), shiftAllowance: amount(t.vehicleShiftAllowance),
        toll: amount(t.reconciledTollCost ?? t.tollCost), extra: amount(t.reconciledExtraCost),
        tollBasis: t.reconciledTollCost != null ? 'ACTUAL' : t.tollCost != null ? 'ESTIMATED' : 'UNKNOWN',
        sharedWithTripId: pair ? (pair.firstTripId === t.id ? pair.secondTripId : pair.firstTripId) : null,
      };
      const cs = containers.filter(c => c.c.tripId === t.id);
      const first = cs[0]?.source;
      const firstType = cs[0]?.c.containerTypeId;
      return { id: `TRIP:${t.id}`, tripId: t.id, shipmentId: shipment.id, shipmentCode: shipment.shipmentCode ?? `#${shipment.id}`,
        scheduledAt: first?.customerAppointmentAt?.toISOString() ?? shipment.plannedReturnAt?.toISOString() ?? t.departureDate,
        factoryName: [...new Set(cs.map(c => sites.find(site => site.id === c.source?.operationalSiteId)?.name).filter(Boolean))].join(', ')
          || sites.find(site => site.id === shipment.operationalSiteId)?.name || shipment.factoryName || null,
        customerName: customer, routeName: route, containerNumber: cs.map(c => c.c.containerNumber).filter(Boolean).join(', ') || null,
        containerType: containerTypes.find(c => c.id === firstType)?.code ?? null,
        classification: t.activeTripPairId ? (pairs.find(p => p.id === t.activeTripPairId)?.pairKind === 'KEP' ? 'Kẹp' : 'Kết hợp') : 'Đơn',
        liftLocation: ports.find(p => p.id === first?.pickupPortId)?.name ?? first?.rawPickupPortName ?? null,
        dropLocation: ports.find(p => p.id === first?.dropoffPortId)?.name ?? first?.rawDropoffPortName ?? null,
        carrierName: t.carrierType === 'OWN' ? 'SilverSea' : (t.externalEntityType === 'SUPPLIER' ? suppliers : carriers).find(c => c.id === t.externalEntityId)?.name ?? 'Chưa xác định nhà xe',
        vehiclePlate: plate ?? t.externalPlateNumber, driverName: driver ?? t.externalDriverName,
        operationalNotes: shipment.operationalNotes, driverNotes: t.notes,
        receivable: sum(rowEntries.map(e => e.customerChargeAmount)), payable: sum(rowEntries.filter(e => e.costGroup !== 'DRIVER_ROAD').map(e => e.payerKind === 'COMPANY' ? 0 : e.payableEntityId == null ? null : e.amount)),
        roadBreakdown, road: sum([roadBreakdown.roadAllowance, roadBreakdown.shiftAllowance, roadBreakdown.toll, roadBreakdown.extra]), entries: rowEntries };
    }).flatMap(row => filterExpenseWorkRow(row, query, search))
    .sort((a, b) => query.groupByVehicle === 'true'
      ? (a.vehiclePlate ?? '').localeCompare(b.vehiclePlate ?? '', 'vi', { numeric: true }) || (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? '')
      : (b.scheduledAt ?? '').localeCompare(a.scheduledAt ?? ''));
  return { items: all.slice((query.page - 1) * query.limit, query.page * query.limit), total: all.length, page: query.page, limit: query.limit,
    totals: { receivable: sum(all.map(r => r.receivable)), payable: sum(all.map(r => r.payable)), road: sum(all.map(r => r.road)) } };
}

/** Source filters constrain the evidence and money shown; date always follows the visible work schedule. */
export function filterExpenseWorkRow(row: ExpenseWorkRow, query: ExpenseListQuery, search = query.search?.trim().toLocaleLowerCase('vi')): ExpenseWorkRow[] {
  const day = row.scheduledAt ? businessDay(row.scheduledAt) : null;
  if ((query.from && (!day || day < query.from)) || (query.to && (!day || day > query.to))) return [];
  const identityMatches = !search || [row.shipmentCode, row.customerName, row.factoryName, row.containerNumber, row.vehiclePlate, row.driverName, row.routeName]
    .some(value => value?.toLocaleLowerCase('vi').includes(search));
  const matchesSource = (entry: ExpenseAccountingEntry) => (!query.sourceKind || entry.sourceKind === query.sourceKind)
    && (query.payerId == null || entry.payerUserId === query.payerId)
    && (query.confirmed == null || Boolean(entry.confirmedAt) === (query.confirmed === 'true'))
    && (identityMatches || [entry.feeName, entry.invoiceNumber, entry.payerName, entry.note, entry.recoveryNote]
      .some(value => value?.toLocaleLowerCase('vi').includes(search!)));
  const entries = row.entries.filter(matchesSource);
  if (!entries.length && (!identityMatches || query.sourceKind || query.payerId != null || query.confirmed != null)) return [];
  return [{ ...row, entries,
    receivable: sum(entries.map(entry => entry.customerChargeAmount)),
    payable: sum(entries.filter(entry => entry.costGroup !== 'DRIVER_ROAD').map(entry => entry.payerKind === 'COMPANY' ? 0 : entry.payableEntityId == null ? null : entry.amount)),
  }];
}
