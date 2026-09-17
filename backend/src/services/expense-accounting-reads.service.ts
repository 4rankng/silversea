import { projectExpenseAdvancesAsOf } from './expense-advance-asof.service';
import { alias } from 'drizzle-orm/pg-core';
import { getAdvanceFundedAmounts } from './advance-funding.service';
import { getAdvanceConsumedAmounts } from './advance-consumption.service';
import { hydrateExpenseCashVoucher } from './expense-cash-voucher-source.service';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm';
import { Role, EXPENSE_COST_GROUP_LABELS, DRIVER_EXPENSE_SUGGESTIONS, OPS_EXPENSE_SUGGESTIONS, expenseDateSchema, round2dp,
  type ExpenseAccountingEntry, type ExpenseAccountingList, type ExpenseListQuery, type ExpenseSourceKind,
  type ExpenseReconciliation, type ExpenseVoucher, type TruckAccountantAssignment } from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { hydrateExpenseAccountingSource, type ExpenseAccountingSource } from './expense-accounting-source.service';

type Actor = Pick<AuthUser, 'userId' | 'role'>;
type Executor = Tx | typeof db;
type Source = ExpenseAccountingSource & { legacy?: boolean };
type Allocation = { sourceId: number; direction: string; amount: string; status: string; valueDate: string; reversalValueDate?: string | null };
const financeRoles: readonly Role[] = [Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT];
const isFinance = (actor: Actor) => financeRoles.includes(actor.role);
const key = (row: { sourceKind: string; sourceId: number }) => `${row.sourceKind}:${row.sourceId}`;
const sum = (values: readonly number[]) => values.reduce((total, value) => round2dp(total + value), 0);
const nullableSum = (values: readonly (number | null)[]) => values.includes(null) ? null : sum(values as number[]);
const iso = (value: Date | null) => value?.toISOString() ?? null;
const vietnamToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function requireFinance(actor: Actor) { if (!isFinance(actor)) throw new ApiError(403, 'Bạn không có quyền xem nghiệp vụ quỹ này.'); }
function requireRead(actor: Actor) {
  if (![...financeRoles, Role.CUS, Role.OPS, Role.DRIVER].includes(actor.role)) throw new ApiError(403, 'Bạn không có quyền xem chi phí.');
}

/** Deduplicate the billing mirror even when a source-kind filter hides its owner. */
export function uniqueExpenseSources(rows: readonly Source[]): Source[] {
  const native = rows.filter(row => !row.legacy);
  const canonicalKeys = new Set(native.map(key));
  const linked = new Set(native.filter(row => row.sourceKind !== 'TRIP').map(row => row.linkedTripExpenseId));
  return rows.filter(row => !(row.legacy && canonicalKeys.has(key(row))) && !(row.sourceKind === 'TRIP' && linked.has(row.sourceId)));
}

export function expensePaymentAmounts(row: Source, allocations: readonly Allocation[], asOfDate: string) {
  if (row.legacy || row.paymentHistoryUnattributed) return { receivedAmount: null, paidAmount: null, outstandingReceivable: null, outstandingPayable: null };
  const current = allocations.filter(a => a.sourceId === row.id && a.valueDate <= asOfDate && (a.status === 'RECORDED' || (a.status === 'REVERSED' && a.reversalValueDate != null && a.reversalValueDate > asOfDate)));
  const receivedAmount = sum(current.filter(a => a.direction === 'IN').map(a => Number(a.amount)));
  const paidAmount = sum(current.filter(a => a.direction === 'OUT').map(a => Number(a.amount)));
  const payableKnown = row.payerKind === 'COMPANY' || (row.payableEntityType != null && row.payableEntityId != null);
  return { receivedAmount, paidAmount,
    outstandingReceivable: row.customerChargeAmount == null ? null : round2dp(Number(row.customerChargeAmount) - receivedAmount),
    outstandingPayable: !payableKnown ? null : row.payerKind === 'COMPANY' ? 0 : round2dp(Number(row.amount) - Number(row.allocatedAdvanceAmount) - paidAmount) };
}

export function filterExpenseEntries(rows: readonly ExpenseAccountingEntry[], actor: Actor, query: ExpenseListQuery): ExpenseAccountingEntry[] {
  requireRead(actor);
  if (query.from && query.to && query.from > query.to) throw new ApiError(400, 'Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
  const search = query.search?.trim().toLocaleLowerCase('vi');
  return rows.filter(row => row.status === 'RECORDED'
    && (isFinance(actor) || actor.role === Role.CUS || (row.payerUserId === actor.userId || row.recordedById === actor.userId))
    && (!query.sourceKind || row.sourceKind === query.sourceKind)
    && (!query.from || row.expenseDate >= query.from) && (!query.to || row.expenseDate <= query.to)
    && (query.shipmentId == null || row.shipmentId === query.shipmentId)
    && (query.payerId == null || row.payerUserId === query.payerId)
    && (query.truckId == null || row.truckId === query.truckId)
    && (query.accountantId == null || (query.accountantId === 0 ? row.accountantId == null : row.accountantId === query.accountantId))
    && (query.confirmed == null || Boolean(row.confirmedAt) === (query.confirmed === 'true'))
    && (!search || [row.shipmentCode, row.tripCode, row.truckPlate, row.customerName, row.containerNumber, row.feeName, row.invoiceNumber, row.payerName, row.driverName, row.routeName].some(value => value?.toLocaleLowerCase('vi').includes(search))))
    .sort((a, b) => {
      if (query.groupByVehicle === 'true') {
        const vehicle = (a.truckPlate ?? '\uffff').localeCompare(b.truckPlate ?? '\uffff', 'vi', { numeric: true }) || (a.truckId ?? Number.MAX_SAFE_INTEGER) - (b.truckId ?? Number.MAX_SAFE_INTEGER);
        if (vehicle) return vehicle;
      }
      return b.expenseDate.localeCompare(a.expenseDate) || b.shipmentId - a.shipmentId || a.sourceKind.localeCompare(b.sourceKind) || b.sourceId - a.sourceId;
    });
}

export function expenseEntryPage(rows: readonly ExpenseAccountingEntry[], actor: Actor, query: ExpenseListQuery): ExpenseAccountingList {
  const filtered = filterExpenseEntries(rows, actor, query);
  return { items: filtered.slice((query.page - 1) * query.limit, query.page * query.limit), total: filtered.length, page: query.page, limit: query.limit,
    canViewPayments: actor.role !== Role.CUS,
    unknownReceivableCount: filtered.filter(row => row.outstandingReceivable == null).length,
    unknownPayableCount: filtered.filter(row => row.outstandingPayable == null).length,
    totals: { amount: sum(filtered.map(row => row.amount)), customerChargeAmount: nullableSum(filtered.map(row => row.customerChargeAmount)),
      receivedAmount: nullableSum(filtered.map(row => row.receivedAmount)), paidAmount: nullableSum(filtered.map(row => row.paidAmount)),
      outstandingReceivable: nullableSum(filtered.map(row => row.outstandingReceivable)), outstandingPayable: nullableSum(filtered.map(row => row.outstandingPayable)) } };
}

function legacySource(input: Partial<Source> & Pick<Source, 'sourceKind' | 'sourceId' | 'shipmentId' | 'customerId' | 'expenseTypeCode' | 'amount' | 'expenseDate'>): Source {
  return { id: -input.sourceId, version: 1, shipmentContainerId: null, tripId: null, truckId: null, costGroup: null,
    feeName: input.expenseTypeCode, customerChargeAmount: null, invoiceNumber: null, invoiceDate: null,
    payerKind: null, payerUserId: null, payableEntityType: null, payableEntityId: null, recordedById: null,
    confirmedById: null, confirmedAt: null, note: null, recoveryNote: null, photoStorageKeys: [], linkedTripExpenseId: null,
    reconciliationId: null, allocatedAdvanceAmount: '0', status: 'RECORDED', createdAt: new Date(0), updatedAt: new Date(0), paymentHistoryUnattributed: true, ...input, legacy: true };
}

async function loadSources(executor: Executor, actor: Actor, query: ExpenseListQuery, includeVoided = false, ref?: { sourceKind: ExpenseSourceKind; sourceId: number }): Promise<Source[]> {
  const own = actor.role === Role.OPS || actor.role === Role.DRIVER;
  // CUS is internal staff: current shipment scope includes every nondeleted
  // lot, regardless of creator, customer or assignment. Preserve that policy.
  const visibleShipmentIds = actor.role === Role.CUS
    ? (await executor.select({ id: s.shipments.id }).from(s.shipments).where(isNull(s.shipments.deletedAt))).map(row => row.id)
    : undefined;
  if (visibleShipmentIds && query.shipmentId != null && !visibleShipmentIds.includes(query.shipmentId)) throw new ApiError(404, 'Không tìm thấy lô hàng');
  const shipmentScope = (column: typeof s.expenseAccountingSources.shipmentId | typeof s.opsExpenseEntries.shipmentId | typeof s.trips.shipmentId) =>
    visibleShipmentIds ? inArray(column, visibleShipmentIds) : undefined;
  const dateRange = (column: typeof s.opsExpenseEntries.paidAt | typeof s.driverIncidentalCosts.occurredAt) =>
    [query.from ? gte(column, query.from) : undefined, query.to ? lte(column, query.to) : undefined];
  const links = await executor.select({ link: s.expenseAccountingSources }).from(s.expenseAccountingSources)
    .innerJoin(s.shipments, eq(s.shipments.id, s.expenseAccountingSources.shipmentId)).where(and(
    isNull(s.shipments.deletedAt), isNotNull(s.shipments.customerId),
    ref ? or(and(eq(s.expenseAccountingSources.sourceKind, ref.sourceKind), eq(s.expenseAccountingSources.sourceId, ref.sourceId)),
      ref.sourceKind === 'TRIP' ? eq(s.expenseAccountingSources.linkedTripExpenseId, ref.sourceId) : undefined) : undefined,
    includeVoided ? undefined : eq(s.expenseAccountingSources.status, 'RECORDED'),
    shipmentScope(s.expenseAccountingSources.shipmentId),
    query.shipmentId ? eq(s.expenseAccountingSources.shipmentId, query.shipmentId) : undefined));
  const canonical = await Promise.all(links.map(({ link }) => hydrateExpenseAccountingSource(executor, link)));
  // Legacy rows remain read-only projections. Reading must not materialize sources, cash or confirmation facts.
  const [ops, driver, trip] = await Promise.all([
    actor.role === Role.DRIVER || (ref && ref.sourceKind !== 'OPS') ? [] : executor.select({ expense: s.opsExpenseEntries, customerId: s.shipments.customerId }).from(s.opsExpenseEntries)
      .innerJoin(s.shipments, eq(s.shipments.id, s.opsExpenseEntries.shipmentId)).where(and(
        isNull(s.shipments.deletedAt), isNotNull(s.shipments.customerId), ref ? eq(s.opsExpenseEntries.id, ref.sourceId) : undefined,
        shipmentScope(s.opsExpenseEntries.shipmentId),
        inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'APPROVED']), ...dateRange(s.opsExpenseEntries.paidAt),
        own ? eq(s.opsExpenseEntries.paidById, actor.userId) : undefined,
        query.shipmentId ? eq(s.opsExpenseEntries.shipmentId, query.shipmentId) : undefined)),
    actor.role === Role.OPS || (ref && ref.sourceKind !== 'DRIVER') ? [] : executor.select({ expense: s.driverIncidentalCosts, trip: s.trips, userId: s.drivers.userId }).from(s.driverIncidentalCosts)
      .innerJoin(s.trips, eq(s.trips.id, s.driverIncidentalCosts.tripId)).innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .innerJoin(s.drivers, eq(s.drivers.id, s.driverIncidentalCosts.driverId)).where(and(
        isNull(s.shipments.deletedAt), isNotNull(s.shipments.customerId), ref ? eq(s.driverIncidentalCosts.id, ref.sourceId) : undefined,
        shipmentScope(s.trips.shipmentId),
        ...dateRange(s.driverIncidentalCosts.occurredAt), own ? eq(s.drivers.userId, actor.userId) : undefined,
        query.shipmentId ? eq(s.trips.shipmentId, query.shipmentId) : undefined)),
    actor.role === Role.DRIVER || (ref && ref.sourceKind !== 'TRIP') ? [] : executor.select({ expense: s.tripExpenses, trip: s.trips }).from(s.tripExpenses)
      .innerJoin(s.trips, eq(s.trips.id, s.tripExpenses.tripId)).innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .where(and(inArray(s.tripExpenses.approvalStatus, ['RECORDED', 'APPROVED']),
        isNull(s.shipments.deletedAt), isNotNull(s.shipments.customerId), ref ? eq(s.tripExpenses.id, ref.sourceId) : undefined,
        shipmentScope(s.trips.shipmentId),
        own ? eq(s.tripExpenses.forwarderId, actor.userId) : undefined, query.shipmentId ? eq(s.trips.shipmentId, query.shipmentId) : undefined)),
  ]);
  const fallbacks: Source[] = [
    ...ops.flatMap(({ expense: e, customerId }) => customerId == null ? [] : [legacySource({ sourceKind: 'OPS', sourceId: e.id, shipmentId: e.shipmentId,
      shipmentContainerId: e.shipmentContainerId, customerId, expenseTypeCode: e.expenseTypeCode, amount: e.amount, expenseDate: e.paidAt,
      payerKind: 'USER', payerUserId: e.paidById, payableEntityType: 'FORWARDER', payableEntityId: e.paidById, note: e.note })]),
    ...driver.flatMap(({ expense: e, trip: t, userId }) => t.shipmentId == null ? [] : [legacySource({ sourceKind: 'DRIVER', sourceId: e.id,
      shipmentId: t.shipmentId, tripId: t.id, truckId: t.truckId, customerId: t.customerId, expenseTypeCode: e.costType, amount: e.amount,
      expenseDate: e.occurredAt, costGroup: e.costGroup, feeName: e.feeName ?? e.costType,
      customerChargeAmount: e.customerChargeAmount, invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate,
      payerKind: e.payerKind ?? 'USER', payerUserId: e.payerKind === 'COMPANY' ? null : userId,
      payableEntityType: e.payerKind === 'COMPANY' ? null : 'DRIVER', payableEntityId: e.payerKind === 'COMPANY' ? null : e.driverId,
      recordedById: e.recordedBy, note: e.note, recoveryNote: e.recoveryNote,
      photoStorageKeys: e.photoStorageKeys.length ? e.photoStorageKeys : e.receiptStorageKey ? [e.receiptStorageKey] : [] })]),
    ...trip.flatMap(({ expense: e, trip: t }) => t.shipmentId == null ? [] : [legacySource({ sourceKind: 'TRIP', sourceId: e.id, version: e.version,
      shipmentId: t.shipmentId, tripId: t.id, truckId: t.truckId, customerId: t.customerId, expenseTypeCode: e.expenseType, amount: e.buyAmount,
      customerChargeAmount: e.sellAmount, expenseDate: e.expenseDate ?? t.departureDate, invoiceNumber: e.invoiceNumber, invoiceDate: e.invoiceDate,
      payerKind: e.settlementMethod === 'OPS_ADVANCE' && e.forwarderId != null ? 'USER' : null,
      payerUserId: e.forwarderId, payableEntityType: e.settlementMethod === 'OPS_ADVANCE' && e.forwarderId != null ? 'FORWARDER' : null,
      payableEntityId: e.settlementMethod === 'OPS_ADVANCE' ? e.forwarderId : null, recordedById: e.createdBy, note: e.note, linkedTripExpenseId: e.id })]),
  ];
  // A voided canonical source must suppress its still-readable historical source too.
  const hidden = includeVoided ? [] : await executor.select({ sourceKind: s.expenseAccountingSources.sourceKind, sourceId: s.expenseAccountingSources.sourceId, linkedTripExpenseId: s.expenseAccountingSources.linkedTripExpenseId })
    .from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.status, 'VOIDED'));
  const hiddenKeys = new Set(hidden.map(key));
  const hiddenTrips = new Set(hidden.map(row => row.linkedTripExpenseId));
  return uniqueExpenseSources([...canonical, ...fallbacks]).filter(row => !hiddenKeys.has(key(row)) && !(row.sourceKind === 'TRIP' && hiddenTrips.has(row.sourceId)));
}

export async function loadExpenseAccountingEntries(actor: Actor, query: ExpenseListQuery, executor: Executor, asOfDate = vietnamToday(), includeVoided = false, ref?: { sourceKind: ExpenseSourceKind; sourceId: number }): Promise<ExpenseAccountingEntry[]> {
  requireRead(actor); expenseDateSchema.parse(asOfDate);
  const sources = (await loadSources(executor, actor, query, includeVoided, ref)).filter(row => isFinance(actor) || actor.role === Role.CUS
    || row.payerUserId === actor.userId || row.recordedById === actor.userId);
  if (!sources.length) return [];
  const ids = (values: Array<number | null>) => [...new Set(values.filter((value): value is number => value != null))];
  const shipmentIds = ids(sources.map(row => row.shipmentId));
  const tripIds = ids(sources.map(row => row.tripId));
  const userIds = ids(sources.map(row => row.payerUserId));
  const reversalMovement = alias(s.treasuryMovements, 'expense_reversal');
  const [shipments, trips, users, customers, containers, assignments, locks, allocations, photos, attachments] = await Promise.all([
    executor.select().from(s.shipments).where(inArray(s.shipments.id, shipmentIds)),
    tripIds.length ? executor.select({ trip: { id: s.tripsComposite.id, tripCode: s.tripsComposite.tripCode, driverId: s.tripsComposite.driverId,
        carrierType: s.tripsComposite.carrierType, externalEntityId: s.tripsComposite.externalEntityId, externalEntityType: s.tripsComposite.externalEntityType,
        externalPlateNumber: s.tripsComposite.externalPlateNumber, externalDriverName: s.tripsComposite.externalDriverName,
        costSubmissionNote: s.tripsComposite.costSubmissionNote }, driverName: s.drivers.name, driverUserId: s.drivers.userId, routeName: s.routes.name }).from(s.tripsComposite)
      .leftJoin(s.drivers, eq(s.drivers.id, s.tripsComposite.driverId)).leftJoin(s.routes, eq(s.routes.id, s.tripsComposite.routeId)).where(inArray(s.tripsComposite.id, tripIds)) : [],
    userIds.length ? executor.select({ id: s.users.id, name: s.users.fullName, username: s.users.username }).from(s.users).where(inArray(s.users.id, userIds)) : [],
    executor.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(inArray(s.customers.id, ids(sources.map(row => row.customerId)))),
    executor.select().from(s.shipmentContainers).where(inArray(s.shipmentContainers.shipmentId, shipmentIds)),
    executor.select({ assignment: s.truckAccountantAssignments, plate: s.trucks.licensePlate }).from(s.trucks)
      .leftJoin(s.truckAccountantAssignments, and(eq(s.truckAccountantAssignments.truckId, s.trucks.id), isNull(s.truckAccountantAssignments.endedAt))),
    executor.select({ shipmentId: s.shipmentAccountingLocks.shipmentId }).from(s.shipmentAccountingLocks).where(and(inArray(s.shipmentAccountingLocks.shipmentId, shipmentIds), isNull(s.shipmentAccountingLocks.releasedAt))),
    executor.select({ sourceId: s.expenseCashAllocations.expenseAccountingSourceId, amount: s.expenseCashAllocations.amount, direction: s.treasuryMovements.direction,
      status: s.expenseCashVouchers.status, valueDate: s.treasuryMovements.valueDate, reversalValueDate: reversalMovement.valueDate }).from(s.expenseCashAllocations)
      .innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
      .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
      .leftJoin(reversalMovement, and(eq(reversalMovement.reversalOfId, s.treasuryMovements.id), eq(reversalMovement.status, 'POSTED'), eq(reversalMovement.amount, s.treasuryMovements.amount)))
      .where(and(inArray(s.expenseCashAllocations.expenseAccountingSourceId, sources.filter(row => !row.legacy).map(row => row.id)), lte(s.treasuryMovements.valueDate, asOfDate))),
    executor.select().from(s.opsExpensePhotos).where(inArray(s.opsExpensePhotos.opsExpenseId, sources.filter(row => row.sourceKind === 'OPS').map(row => row.sourceId))),
    executor.select().from(s.expenseAccountingEvidence).where(inArray(s.expenseAccountingEvidence.expenseAccountingSourceId, sources.filter(row => !row.legacy).map(row => row.id))),
  ]);
  const trucks = await executor.select({ id: s.trucks.id, plate: s.trucks.licensePlate }).from(s.trucks).where(inArray(s.trucks.id, ids(sources.map(row => row.truckId))));
  const externalIds = ids(trips.map(row => row.trip.externalEntityId));
  const [carrierCustomers, carrierSuppliers] = externalIds.length ? await Promise.all([
    executor.select({ id: s.customers.id, name: s.customers.name }).from(s.customers).where(inArray(s.customers.id, externalIds)),
    executor.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers).where(inArray(s.suppliers.id, externalIds)),
  ]) : [[], []];
  return sources.filter(row => actor.role !== Role.DRIVER || (row.sourceKind === 'DRIVER' && trips.find(item => item.trip.id === row.tripId)?.driverUserId === actor.userId)).map(row => {
    const shipment = shipments.find(item => item.id === row.shipmentId);
    const trip = trips.find(item => item.trip.id === row.tripId);
    const payer = users.find(item => item.id === row.payerUserId);
    const assignment = assignments.find(item => item.assignment?.truckId === row.truckId)?.assignment;
    const storedPhotos = row.photoStorageKeys.length ? row.photoStorageKeys : row.sourceKind === 'OPS' ? photos.filter(photo => photo.opsExpenseId === row.sourceId).map(photo => photo.storageKey) : [];
    const payment = expensePaymentAmounts(row, allocations.filter(item => item.direction === 'IN' || item.direction === 'OUT')
      .map(item => ({ ...item, direction: item.direction as 'IN' | 'OUT' })), asOfDate);
    const canViewPayments = actor.role !== Role.CUS;
    const carrier = trip?.trip.carrierType === 'OWN' ? { name: 'SilverSea', code: 'SILVERSEA_INTERNAL' }
      : trip?.trip.externalEntityId ? {
        name: (trip.trip.externalEntityType === 'SUPPLIER' ? carrierSuppliers : carrierCustomers).find(c => c.id === trip.trip.externalEntityId)?.name ?? `Nhà xe #${trip.trip.externalEntityId}`,
        code: `${trip.trip.externalEntityType}:${trip.trip.externalEntityId}`,
      } : null;
    return { ...row, id: row.id, version: row.version, amount: Number(row.amount), customerChargeAmount: row.customerChargeAmount == null ? null : Number(row.customerChargeAmount),
      shipmentCode: shipment?.shipmentCode ?? `#${row.shipmentId}`, tripCode: trip?.trip.tripCode ?? null,
      truckPlate: trucks.find(truck => truck.id === row.truckId)?.plate ?? trip?.trip.externalPlateNumber ?? null,
      customerName: customers.find(customer => customer.id === row.customerId)?.name ?? shipment?.rawCustomerName ?? `#${row.customerId}`,
      containerNumber: containers.find(container => container.id === row.shipmentContainerId)?.containerNumber ?? null,
      payerName: payer?.name ?? payer?.username ?? null, confirmedAt: iso(row.confirmedAt), photoStorageKeys: [...new Set([...storedPhotos, ...attachments.filter(e => e.expenseAccountingSourceId === row.id).map(e => e.storageKey)])],
      ...payment, ...(canViewPayments ? {} : { receivedAmount: null, paidAmount: null, outstandingReceivable: null, outstandingPayable: null }),
      allocatedAdvanceAmount: canViewPayments && !row.legacy ? Number(row.allocatedAdvanceAmount) : null,
      accountantId: assignment?.accountantId ?? null, evidenceMissing: storedPhotos.length === 0 && !attachments.some(e => e.expenseAccountingSourceId === row.id),
      locked: row.status !== 'RECORDED' || !!row.confirmedAt || !!row.reconciliationId || locks.some(lock => lock.shipmentId === row.shipmentId)
        || (payment.paidAmount ?? 0) > 0 || (payment.receivedAmount ?? 0) > 0,
      reconciliationId: canViewPayments ? row.reconciliationId : null,
      driverName: trip?.driverName ?? trip?.trip.externalDriverName ?? null, routeName: trip?.routeName ?? shipment?.rawRouteName ?? null,
      carrierName: carrier?.name ?? null, carrierCode: carrier?.code ?? null,
      operationalNotes: shipment?.operationalNotes ?? null, customerNotes: shipment?.customerNotes ?? null, driverNotes: trip?.trip.costSubmissionNote ?? null,
      canViewPayments, financialMetadataComplete: !row.legacy && row.customerChargeAmount != null && (row.payerKind === 'COMPANY' || row.payableEntityId != null), isLegacy: Boolean(row.legacy) };
  });
}

export async function listExpenseAccountingEntries(actor: Actor, query: ExpenseListQuery, tx?: Tx) {
  return expenseEntryPage(await loadExpenseAccountingEntries(actor, query, tx ?? db), actor, query);
}
export async function getExpenseAccountingEntry(actor: Actor, kind: ExpenseSourceKind, id: number, tx?: Tx) {
  const rows = await loadExpenseAccountingEntries(actor, { page: 1, limit: 100 }, tx ?? db, vietnamToday(), true, { sourceKind: kind, sourceId: id });
  const found = rows.find(row => row.sourceKind === kind && row.sourceId === id);
  if (!found) throw new ApiError(404, 'Không tìm thấy khoản chi trong phạm vi của bạn.');
  return found;
}

export async function listTruckAccountantAssignments(actor: Actor, tx?: Tx): Promise<TruckAccountantAssignment[]> {
  requireFinance(actor);
  return (tx ?? db).select({ truckId: s.trucks.id, truckPlate: s.trucks.licensePlate, accountantId: s.truckAccountantAssignments.accountantId,
    accountantName: s.users.fullName, version: s.truckAccountantAssignments.version, assignedAt: s.truckAccountantAssignments.assignedAt }).from(s.trucks)
    .leftJoin(s.truckAccountantAssignments, and(eq(s.truckAccountantAssignments.truckId, s.trucks.id), isNull(s.truckAccountantAssignments.endedAt)))
    .leftJoin(s.users, eq(s.users.id, s.truckAccountantAssignments.accountantId)).where(isNull(s.trucks.deletedAt)).orderBy(asc(s.trucks.licensePlate))
    .then(rows => rows.map(row => ({ ...row, version: row.version ?? 0, assignedAt: iso(row.assignedAt) })));
}

export async function getExpenseVoucher(actor: Actor, id: number, tx?: Tx): Promise<ExpenseVoucher> {
  requireFinance(actor); const executor = tx ?? db;
  const [stored] = await executor.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, id));
  if (!stored) throw new ApiError(404, 'Không tìm thấy phiếu thu/chi.');
  const voucher = await hydrateExpenseCashVoucher(executor, stored);
  const [reversalMovement] = await executor.select().from(s.treasuryMovements)
    .where(eq(s.treasuryMovements.reversalOfId, stored.treasuryMovementId));
  const reversal = reversalMovement ? { valueDate: reversalMovement.valueDate, physicalReference: reversalMovement.physicalReference,
    amount: Number(reversalMovement.amount), reason: stored.reversalReason, reversedById: stored.reversedById } : null;
  const entries = await executor.select({ sourceKind: s.expenseAccountingSources.sourceKind, sourceId: s.expenseAccountingSources.sourceId,
    expectedVersion: s.expenseCashAllocations.sourceVersion, amount: s.expenseCashAllocations.amount }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
    .where(eq(s.expenseCashAllocations.voucherId, id)).orderBy(asc(s.expenseCashAllocations.id));
  const [receipt] = voucher.paymentReceiptId ? await executor.select().from(s.paymentReceipts).where(eq(s.paymentReceipts.id, voucher.paymentReceiptId)) : [];
  const [account] = await executor.select({ name: s.treasuryAccounts.name }).from(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, voucher.treasuryAccountId));
  const [counterparty] = voucher.counterpartyType === 'CUSTOMER'
    ? await executor.select({ name: s.customers.name }).from(s.customers).where(eq(s.customers.id, voucher.counterpartyId))
    : voucher.counterpartyType === 'DRIVER'
      ? await executor.select({ name: s.drivers.name }).from(s.drivers).where(eq(s.drivers.id, voucher.counterpartyId))
      : voucher.counterpartyType === 'FORWARDER'
        ? await executor.select({ name: s.users.fullName, username: s.users.username }).from(s.users).where(eq(s.users.id, voucher.counterpartyId))
        : await executor.select({ name: s.suppliers.name }).from(s.suppliers).where(eq(s.suppliers.id, voucher.counterpartyId));
  return { ...voucher, reversal, counterpartyName: counterparty?.name ?? (counterparty && 'username' in counterparty ? counterparty.username : null), treasuryAccountName: account?.name ?? null, unappliedAmount: Number(receipt?.unappliedAmount ?? 0), amount: Number(voucher.amount), createdAt: voucher.createdAt.toISOString(), entries: entries.map(entry => ({ ...entry, amount: Number(entry.amount) })) };
}
export async function listExpenseVouchers(actor: Actor, tx?: Tx) {
  requireFinance(actor); const executor = tx ?? db;
  const rows = await executor.select({ id: s.expenseCashVouchers.id }).from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId)).orderBy(desc(s.treasuryMovements.valueDate), desc(s.expenseCashVouchers.id));
  return Promise.all(rows.map(row => getExpenseVoucher(actor, row.id, tx)));
}

export async function getExpenseReconciliation(actor: Actor, id: number, tx?: Tx): Promise<ExpenseReconciliation> {
  const executor = tx ?? db;
  if (!isFinance(actor) && actor.role !== Role.OPS) throw new ApiError(403, 'Bạn không có quyền xem bảng hoàn ứng.');
  const [row] = await executor.select().from(s.expenseReconciliations).where(and(eq(s.expenseReconciliations.id, id), actor.role === Role.OPS ? eq(s.expenseReconciliations.opsUserId, actor.userId) : undefined));
  if (!row) throw new ApiError(404, 'Không tìm thấy bảng hoàn ứng.');
  let entries = await executor.select().from(s.expenseAccountingSources).where(eq(s.expenseAccountingSources.reconciliationId, id));
  if (row.voidedAt) {
    const [release] = await executor.select({ payload: s.auditLogs.payload }).from(s.auditLogs).where(and(eq(s.auditLogs.entityType, 'expense_reconciliation'), eq(s.auditLogs.entityId, id), eq(s.auditLogs.message, 'EXPENSE_RECONCILIATION_RELEASED'))).limit(1);
    const snapshot = release?.payload as { sources?: typeof entries } | undefined;
    entries = snapshot?.sources ?? [];
  }
  const sourceIds = entries.map(entry => entry.id);
  const [payments, refunds] = row.voidedAt ? [[], []] : await Promise.all([
    // A released batch had no active cash at release; later payments belong to its replacement.
    executor.select({ amount: s.expenseCashAllocations.amount }).from(s.expenseCashAllocations).innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
      .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
      .where(and(inArray(s.expenseCashAllocations.expenseAccountingSourceId, sourceIds), eq(s.expenseCashVouchers.status, 'RECORDED'), eq(s.treasuryMovements.direction, 'OUT'))),
    executor.select({ amount: s.treasuryMovements.amount }).from(s.expenseCashVouchers).innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId)).where(and(eq(s.expenseCashVouchers.reconciliationId, id), eq(s.expenseCashVouchers.status, 'RECORDED'), eq(s.treasuryMovements.direction, 'IN'))),
  ]);
  const advances = await executor.select({ advanceRequestId: s.expenseReconciliationAdvances.advanceRequestId, amount: s.expenseReconciliationAdvances.amount, reason: s.advanceRequests.reason })
    .from(s.expenseReconciliationAdvances).leftJoin(s.advanceRequests, eq(s.advanceRequests.id, s.expenseReconciliationAdvances.advanceRequestId))
    .where(eq(s.expenseReconciliationAdvances.reconciliationId, id)).orderBy(asc(s.expenseReconciliationAdvances.advanceRequestId));
  const initialDifference = round2dp(Number(row.amount) - Number(row.advanceAmount));
  const paidAmount = sum(payments.map(payment => Number(payment.amount))), refundedAmount = sum(refunds.map(refund => Number(refund.amount)));
  return { ...row, voidedAt: row.voidedAt?.toISOString() ?? null, amount: Number(row.amount), advanceAmount: Number(row.advanceAmount), initialDifference, paidAmount, refundedAmount,
    remainingDifference: row.voidedAt ? 0 : round2dp(initialDifference - paidAmount + refundedAmount), createdAt: row.createdAt.toISOString(),
    entries: entries.map(entry => ({ sourceKind: entry.sourceKind, sourceId: entry.sourceId, expectedVersion: entry.version })),
    advances: advances.map(advance => ({ ...advance, amount: Number(advance.amount) })) };
}
export async function listExpenseReconciliations(actor: Actor, tx?: Tx) {
  if (!isFinance(actor) && actor.role !== Role.OPS) throw new ApiError(403, 'Bạn không có quyền xem bảng hoàn ứng.');
  const executor = tx ?? db;
  const rows = await executor.select({ id: s.expenseReconciliations.id }).from(s.expenseReconciliations)
    .where(actor.role === Role.OPS ? eq(s.expenseReconciliations.opsUserId, actor.userId) : undefined).orderBy(desc(s.expenseReconciliations.id));
  return Promise.all(rows.map(row => getExpenseReconciliation(actor, row.id, tx)));
}

export interface ExpenseAccountingReportRow { entityType: string; entityId: number; entityName: string; carrierCode: string | null;
  lift: number; drop: number; other: number; total: number; settled: number | null; outstanding: number | null; entries: ExpenseAccountingEntry[] }
const compareExpenseReportRows = (a: ExpenseAccountingReportRow, b: ExpenseAccountingReportRow) =>
  a.entityName.localeCompare(b.entityName, 'vi') || a.entityType.localeCompare(b.entityType) || a.entityId - b.entityId;
export function expenseAccountingReportRows(entries: readonly ExpenseAccountingEntry[], direction: 'IN' | 'OUT') {
  const groups = new Map<string, ExpenseAccountingReportRow>(); let unknownCount = 0;
  for (const row of entries) {
    const amount = direction === 'IN' ? row.customerChargeAmount : row.payerKind === 'COMPANY' ? 0 : row.payableEntityId == null ? null : row.amount;
    if (amount == null) { unknownCount++; continue; } if (amount === 0) continue;
    const carrierReport = direction === 'OUT' && row.carrierCode != null && row.sourceKind !== 'INVOICE';
    const entityType = direction === 'IN' ? 'CUSTOMER' : carrierReport ? 'CARRIER' : row.payableEntityType!;
    const entityId = direction === 'IN' ? row.customerId : carrierReport ? Number(row.carrierCode!.split(':')[1] ?? 0) : row.payableEntityId!;
    const carrierCode = carrierReport ? row.carrierCode : null;
    const groupKey = `${entityType}:${entityId}:${carrierCode ?? ''}`;
    const group = groups.get(groupKey) ?? { entityType, entityId, entityName: direction === 'IN' ? row.customerName : carrierReport ? row.carrierName! : row.payerName ?? `${entityType} #${entityId}`,
      carrierCode, lift: 0, drop: 0, other: 0, total: 0, settled: 0, outstanding: 0, entries: [] };
    const category = row.costGroup === 'INVOICED_LIFT' ? 'lift' : row.costGroup === 'INVOICED_DROP' ? 'drop' : 'other';
    group.entries.push(row);
    group[category] = sum([group[category], amount]); group.total = sum([group.total, amount]);
    const cash = direction === 'IN' ? row.receivedAmount : nullableSum([row.paidAmount, row.allocatedAdvanceAmount]);
    const remaining = direction === 'IN' ? row.outstandingReceivable : row.outstandingPayable;
    group.settled = nullableSum([group.settled, cash]); group.outstanding = nullableSum([group.outstanding, remaining]);
    if (cash == null || remaining == null) unknownCount++;
    groups.set(groupKey, group);
  }
  const items = [...groups.values()].sort(compareExpenseReportRows);
  return { items, unknownCount, totals: { lift: sum(items.map(row => row.lift)), drop: sum(items.map(row => row.drop)), other: sum(items.map(row => row.other)),
    total: sum(items.map(row => row.total)), settled: nullableSum(items.map(row => row.settled)), outstanding: nullableSum(items.map(row => row.outstanding)) } };
}
export async function getExpenseAccountingReport(actor: Actor, query: ExpenseListQuery & { direction: 'IN' | 'OUT'; asOfDate?: string }, tx?: Tx) {
  requireFinance(actor); const asOfDate = query.asOfDate ?? vietnamToday();
  const executor = tx ?? db;
  const current = await loadExpenseAccountingEntries(actor, query, executor, asOfDate);
  const rows = filterExpenseEntries(await projectExpenseAdvancesAsOf(executor, current, asOfDate), actor, query);
  const report = expenseAccountingReportRows(rows, query.direction);
  const supplierIds = [...new Set(report.items.filter(row => row.entityType === 'VENDOR').map(row => row.entityId))];
  if (supplierIds.length) {
    // Historical liabilities retain their counterparty even when the supplier
    // is inactive. The expense payer is not necessarily the payable supplier.
    const suppliers = await executor.select({ id: s.suppliers.id, name: s.suppliers.name }).from(s.suppliers)
      .where(inArray(s.suppliers.id, supplierIds));
    const names = new Map(suppliers.map(supplier => [supplier.id, supplier.name]));
    for (const row of report.items) if (row.entityType === 'VENDOR') row.entityName = names.get(row.entityId) ?? row.entityName;
    report.items.sort(compareExpenseReportRows);
  }
  return { direction: query.direction, dateBasis: 'expenseDate' as const, from: query.from ?? null, to: query.to ?? null, asOfDate, ...report };
}

export async function getExpenseAccountingCatalog(actor: Actor, tx?: Tx) {
  requireRead(actor); const executor = tx ?? db;
  const base = { costGroups: Object.entries(EXPENSE_COST_GROUP_LABELS).map(([code, label]) => ({ code, label })), driverCostSuggestions: DRIVER_EXPENSE_SUGGESTIONS, opsFeeSuggestions: OPS_EXPENSE_SUGGESTIONS };
  if (!isFinance(actor)) return { ...base, treasuryAccounts: [], accountants: [], opsUsers: [], truckAssignments: [], advances: [], pendingAdvances: [] };
  const [treasuryAccounts, people, truckAssignments, advances] = await Promise.all([
    executor.select().from(s.treasuryAccounts).where(eq(s.treasuryAccounts.status, 'ACTIVE')).orderBy(asc(s.treasuryAccounts.name)),
    executor.select({ id: s.users.id, name: s.users.fullName, username: s.users.username, role: s.users.role }).from(s.users)
      .where(and(inArray(s.users.role, [Role.ACCOUNTANT, Role.OPS, Role.DRIVER]), eq(s.users.status, 'ACTIVE'), isNull(s.users.deletedAt)))
      .then(rows => rows.map(person => ({ ...person, name: person.name?.trim() || person.username }))),
    listTruckAccountantAssignments(actor, tx),
    executor.select().from(s.advanceRequests).where(eq(s.advanceRequests.status, 'RECORDED')),
  ]);
  const ids = advances.map(row => row.id);
  const [funded, consumed] = await Promise.all([getAdvanceFundedAmounts(executor, ids), getAdvanceConsumedAmounts(executor, ids)]);
  const pendingAdvances = advances.filter(row => !funded.has(row.id)).map(row => ({ id: row.id, opsUserId: row.requesterId,
    amount: Number(row.amount), reason: row.reason, date: row.createdAt.toISOString().slice(0, 10), name: row.requesterNameSnapshot }));
  const eligible = new Map<number, { id: number; opsUserId: number; amount: number; remainingAmount: number; date: string; name: string | null }>();
  for (const advance of advances) {
    const allocated = consumed.get(advance.id) ?? 0;
    const amount = Math.min(Number(advance.amount), (funded.get(advance.id) ?? 0));
    const remainingAmount = round2dp(amount - allocated);
    if (remainingAmount > 0) eligible.set(advance.id, { id: advance.id, opsUserId: advance.requesterId, amount, remainingAmount, date: advance.createdAt.toISOString().slice(0, 10), name: advance.requesterNameSnapshot });
  }
  return { ...base, accounts: treasuryAccounts, staff: people, suppliers: await executor.select().from(s.suppliers).where(eq(s.suppliers.status, 'ACTIVE')), expenseTypes: await executor.select().from(s.forwarderExpenseTypes).where(eq(s.forwarderExpenseTypes.status, 'ACTIVE')), treasuryAccounts, accountants: people.filter(person => person.role === Role.ACCOUNTANT), opsUsers: people.filter(person => person.role === Role.OPS), truckAssignments, pendingAdvances, advances: [...eligible.values()] };
}
