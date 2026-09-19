import { and, desc, eq, ilike, isNotNull, isNull, inArray, lt, notInArray, sql } from 'drizzle-orm';
import type {
  AccountantWorkInboxItem,
  AdminHealthInboxItem,
  CustomerWorkInboxItem,
  DriverWorkInboxItem,
  ManagerWorkInboxItem,
  OperationsWorkInboxItem,
  WorkInboxItemBase,
  WorkInboxResponseOf,
} from '@tingting/shared';
import { db } from '../db';
import * as s from '../db/schema';
import { getForwarderTrips } from './forwarder-trip-query.service';
import { COMPANY_INFO_SETTING_KEYS } from './company-info.service';
import { ApiError } from '../errors';

export type InboxQuery = { view?: string; search?: string; page: number; limit: number; sortBy?: WorkInboxSortKey; sortDir?: 'asc' | 'desc' };

// Server-side sort keys for inbox lanes — one per lane table data column (the
// action column is decorative). Applied in pageWorkInboxItems before slicing,
// so pagination follows the requested order. Absent params keep the historical
// priority → due-date → id order untouched. The last three keys are manager-lane
// columns; the whitelist is a superset of what any single lane renders, and
// items without those fields sort last via the nulls-last wrapper.
export const WORK_INBOX_SORT_KEYS = [
  'title',
  'readiness',
  'blockers',
  'freshness',
  'ownerLabel',
  'ageHours',
  'impact',
] as const;
export type WorkInboxSortKey = (typeof WORK_INBOX_SORT_KEYS)[number];

const emptyParty = [] as WorkInboxItemBase['blockers'];
const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;
const MAX_INBOX_CANDIDATES = 2_000;
function assertCompleteCandidateScan(rows: readonly unknown[]) {
  if (rows.length > MAX_INBOX_CANDIDATES) {
    throw new ApiError(503, 'Hộp công việc có quá nhiều bản ghi để tính chính xác. Vui lòng thu hẹp tìm kiếm.');
  }
}

type InboxSortValue = string | number | null;
function inboxSortValue<T extends WorkInboxItemBase>(item: T, key: WorkInboxSortKey): InboxSortValue {
  switch (key) {
    case 'title': return item.title;
    case 'readiness': return item.blockers.length;
    case 'blockers': return item.blockers.length + item.advisories.length;
    case 'freshness': return item.freshnessAt;
    // Manager-lane columns: fields exist only on ManagerWorkInboxItem; on any
    // other lane's items they are absent → null → sorts last (nulls-last).
    case 'ownerLabel': return (item as Partial<ManagerWorkInboxItem>).owner?.ownerLabel ?? null;
    case 'ageHours': return (item as Partial<ManagerWorkInboxItem>).ageHours ?? null;
    case 'impact': return (item as Partial<ManagerWorkInboxItem>).impact ?? null;
  }
}

export function pageWorkInboxItems<T extends WorkInboxItemBase>(items: T[], query: InboxQuery): WorkInboxResponseOf<T> {
  const selected = query.view && ['ACTION', 'WAITING', 'DONE'].includes(query.view.toUpperCase()) ? query.view.toUpperCase() : undefined;
  const term = query.search?.trim().toLocaleLowerCase('vi-VN');
  // Default lane order: priority desc, due date asc (nulls last), stable id.
  const defaultOrder = (a: T, b: T) =>
    b.priority - a.priority
    || (a.dueAt == null ? 1 : b.dueAt == null ? -1 : a.dueAt.localeCompare(b.dueAt))
    || a.id.localeCompare(b.id);
  const filtered = items.filter((item) => (!selected || item.state === selected) && (!term || `${item.title} ${item.subtitle ?? ''}`.toLocaleLowerCase('vi-VN').includes(term)));
  if (query.sortBy) {
    const key = query.sortBy;
    const direction = query.sortDir === 'desc' ? -1 : 1;
    // Explicit sort: nulls/absent values stay last in both directions, and the
    // default order chain remains the tiebreaker so pages stay deterministic.
    filtered.sort((a, b) => {
      const left = inboxSortValue(a, key);
      const right = inboxSortValue(b, key);
      if (left == null && right == null) return defaultOrder(a, b);
      if (left == null) return 1;
      if (right == null) return -1;
      if (left === right) return defaultOrder(a, b);
      return (left < right ? -1 : 1) * direction;
    });
  } else {
    filtered.sort(defaultOrder);
  }
  const counts = { action: items.filter((item) => item.state === 'ACTION').length, waiting: items.filter((item) => item.state === 'WAITING').length, done: items.filter((item) => item.state === 'DONE').length };
  return { asOf: new Date().toISOString(), timezone: 'Asia/Ho_Chi_Minh', counts, page: query.page, limit: query.limit, total: filtered.length, totalPages: Math.ceil(filtered.length / query.limit), items: filtered.slice((query.page - 1) * query.limit, query.page * query.limit) };
}

export async function customerWorkInbox(customerId: number, query: InboxQuery) {
  const shipments = await db.select({
    id: s.shipments.id,
    code: s.shipments.shipmentCode,
    blNumber: s.shipments.blNumber,
    bookingRef: s.shipments.bookingRef,
    status: s.shipments.status,
    due: s.shipments.expectedDeliveryDate,
    updatedAt: s.shipments.updatedAt,
  }).from(s.shipments).where(and(eq(s.shipments.customerId, customerId), isNull(s.shipments.deletedAt), notInArray(s.shipments.status, ['NEW', 'PENDING_DATE', 'CANCELED']), query.search?.trim() ? ilike(s.shipments.shipmentCode, `%${query.search.trim()}%`) : undefined)).orderBy(desc(s.shipments.updatedAt)).limit(MAX_INBOX_CANDIDATES + 1);
  assertCompleteCandidateScan(shipments);
  // Resolve container numbers in a single in-clause query and bucket them
  // per shipment. The previous correlated subquery on `shipment_containers`
  // returned the same string for every shipment (Drizzle template rendered
  // the outer `s.shipments.id` reference into a constant), so the inbox
  // always showed three identical shared containers.
  const shipmentIds = shipments.map((shipment) => shipment.id);
  // Lot display identity = business keys (Số Bill/Booking + số tờ khai);
  // shipmentCode and bare ids are banned from display text.
  const declarationRows = shipmentIds.length === 0 ? [] : await db.select({
    shipmentId: s.shipmentDeclarations.shipmentId,
    declarationNumber: s.shipmentDeclarations.declarationNumber,
  }).from(s.shipmentDeclarations)
    .where(inArray(s.shipmentDeclarations.shipmentId, shipmentIds))
    .orderBy(s.shipmentDeclarations.id);
  const declarationNumbersByLot = new Map<number, string>();
  for (const row of declarationRows) {
    if (row.declarationNumber == null || row.declarationNumber === '') continue;
    const current = declarationNumbersByLot.get(row.shipmentId);
    declarationNumbersByLot.set(row.shipmentId, current == null ? row.declarationNumber : `${current}, ${row.declarationNumber}`);
  }
  const containerRows = shipmentIds.length === 0 ? [] : await db.select({
    shipmentId: s.shipmentContainers.shipmentId,
    containerNumber: s.shipmentContainers.containerNumber,
  }).from(s.shipmentContainers)
    .where(and(inArray(s.shipmentContainers.shipmentId, shipmentIds), isNotNull(s.shipmentContainers.containerNumber)))
    .orderBy(s.shipmentContainers.id);
  const containerSummaryByShipment = new Map<number, string>();
  for (const row of containerRows) {
    if (row.shipmentId == null || row.containerNumber == null) continue;
    const prev = containerSummaryByShipment.get(row.shipmentId) ?? '';
    containerSummaryByShipment.set(row.shipmentId, prev ? `${prev}, ${row.containerNumber}` : row.containerNumber);
  }
  const deliveries = shipmentIds.length === 0 ? [] : await db.select({ shipmentId: s.deliveryAttempts.shipmentId, tripId: s.deliveryAttempts.tripId, eventId: s.deliveryAttempts.customerVisibleEventId, eventVersion: s.customerVisibleEvents.contentVersion, occurredAt: s.deliveryAttempts.occurredAt }).from(s.deliveryAttempts).innerJoin(s.customerVisibleEvents, eq(s.customerVisibleEvents.id, s.deliveryAttempts.customerVisibleEventId)).where(inArray(s.deliveryAttempts.shipmentId, shipmentIds)).orderBy(desc(s.deliveryAttempts.occurredAt));
  const deliveryEventIds = deliveries.flatMap((delivery) => delivery.eventId == null ? [] : [delivery.eventId]);
  const supersedingEvents = deliveryEventIds.length === 0 ? [] : await db.select({ supersedesEventId: s.customerVisibleEvents.supersedesEventId }).from(s.customerVisibleEvents).where(inArray(s.customerVisibleEvents.supersedesEventId, deliveryEventIds));
  const supersededEventIds = new Set(supersedingEvents.flatMap((event) => event.supersedesEventId == null ? [] : [event.supersedesEventId]));
  const latestDeliveryByShipment = new Map<number, typeof deliveries[number]>();
  for (const delivery of deliveries) if (!supersededEventIds.has(delivery.eventId ?? -1) && !latestDeliveryByShipment.has(delivery.shipmentId)) latestDeliveryByShipment.set(delivery.shipmentId, delivery);
  const deliveryTripIds = deliveries.flatMap((delivery) => delivery.tripId == null ? [] : [delivery.tripId]);
  const podRows = deliveryTripIds.length === 0 ? [] : await db.select({ tripId: s.tripPodSubmissions.tripId, status: s.tripPodSubmissions.status, version: s.tripPodSubmissions.submissionVersion, id: s.tripPodSubmissions.id }).from(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.tripId, deliveryTripIds)).orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id));
  const latestPodByTrip = new Map<number, typeof podRows[number]>();
  for (const pod of podRows) if (!latestPodByTrip.has(pod.tripId)) latestPodByTrip.set(pod.tripId, pod);
  const responses = deliveryEventIds.length === 0 ? [] : await db.select({ eventId: s.customerDeliveryResponses.customerVisibleEventId, eventVersion: s.customerDeliveryResponses.eventVersion }).from(s.customerDeliveryResponses).where(and(eq(s.customerDeliveryResponses.customerId, customerId), inArray(s.customerDeliveryResponses.customerVisibleEventId, deliveryEventIds)));
  const responseKeys = new Set(responses.map((response) => `${response.eventId}:${response.eventVersion}`));
  const items: CustomerWorkInboxItem[] = [];
  for (const shipment of shipments) {
    const delivery = latestDeliveryByShipment.get(shipment.id);
    const hasResponse = delivery?.eventId != null && responseKeys.has(`${delivery.eventId}:${delivery.eventVersion}`);
    const needsResponse = Boolean(delivery && !hasResponse);
    const done = shipment.status === 'COMPLETED' && hasResponse;
    const acceptedPod = delivery?.tripId != null && latestPodByTrip.get(delivery.tripId)?.status === 'ACCEPTED';
    items.push({ id: `shipment:${shipment.id}`, entityType: 'shipment', entityId: shipment.id, title: [shipment.blNumber, shipment.bookingRef, declarationNumbersByLot.get(shipment.id)].filter(Boolean).join(' / ') || '—', subtitle: done ? 'Đã hoàn tất và đã phản hồi giao hàng' : needsResponse ? 'Tài xế đã báo giao; đang chờ phản hồi của khách hàng' : 'Đang theo dõi', state: done ? 'DONE' : needsResponse ? 'ACTION' : 'WAITING', priority: needsResponse ? 100 : done ? 0 : 30, dueAt: shipment.due ? new Date(`${shipment.due}T00:00:00.000Z`).toISOString() : null, freshnessAt: (delivery?.occurredAt ?? shipment.updatedAt).toISOString(), blockers: emptyParty, advisories: emptyParty, nextAction: needsResponse && delivery?.eventId ? { label: 'Phản hồi giao hàng', targetRoute: `/portal/shipments/${shipment.id}` } : null, targetRoute: `/portal/shipments/${shipment.id}`, shipmentId: shipment.id, containerSummary: containerSummaryByShipment.get(shipment.id) ?? null,
      // Delivery truth is EVENT-derived: a driver report or accepted POD is
      // evidence; only a genuinely IN_TRANSIT shipment may claim transport.
      // An assigned-but-not-departed lot reads NO_REPORT — the portal list
      // must never claim movement the shipment's own history disproves.
      deliveryTruth: acceptedPod ? 'POD_ACCEPTED' : delivery ? 'DRIVER_REPORTED' : shipment.status === 'IN_TRANSIT' ? 'IN_TRANSIT' : 'NO_REPORT', deliveryResponseRequired: needsResponse, deliveryEventId: delivery?.eventId ?? null, deliveryEventVersion: delivery?.eventVersion ?? null });
  }
  return pageWorkInboxItems(items, query);
}

export async function driverWorkInbox(driverId: number, query: InboxQuery) {
  const rows = await db.select({
    tripId: s.trips.id,
    fulfillmentId: s.trips.fulfillmentId,
    code: s.trips.tripCode,
    shipmentCode: s.shipments.shipmentCode,
    status: s.trips.status,
    start: s.trips.plannedStartAt,
    updatedAt: s.trips.updatedAt,
    paperAt: s.trips.paperOrderCollectedAt,
    origin: s.trips.canonicalOrigin,
    destination: s.trips.canonicalDestination,
    pickupLocation: s.shipments.pickupLocation,
    deliveryLocation: s.shipments.deliveryLocation,
    contactName: s.shipments.contactName,
    contactPhone: s.shipments.contactPhone,
    containerSummary: sql<string | null>`coalesce(
      (select string_agg(tc.container_number, ', ' order by tc.id) from trip_containers tc where tc.trip_id = ${s.trips.id} and tc.container_number is not null),
      (select string_agg(sc.container_number, ', ' order by sc.id) from shipment_containers sc where sc.shipment_id = ${s.shipments.id} and sc.container_number is not null)
    )`,
  }).from(s.trips)
    .innerJoin(s.shipmentFulfillments, eq(s.shipmentFulfillments.id, s.trips.fulfillmentId))
    .innerJoin(s.shipments, eq(s.shipments.id, s.shipmentFulfillments.shipmentId))
    .where(and(eq(s.trips.driverId, driverId), isNull(s.trips.deletedAt), isNull(s.shipmentFulfillments.canceledAt), inArray(s.trips.status, ['CREATED', 'IN_TRANSIT', 'COMPLETED'])));
  const tripIds = rows.map((row) => row.tripId);
  const [progressRows, podRows] = tripIds.length === 0 ? [[], []] as const : await Promise.all([
    db.select({ tripId: s.driverProgressEvents.tripId, eventType: s.driverProgressEvents.eventType, occurredAt: s.driverProgressEvents.occurredAt, id: s.driverProgressEvents.id }).from(s.driverProgressEvents).where(and(inArray(s.driverProgressEvents.tripId, tripIds), inArray(s.driverProgressEvents.eventType, ['ORDER_RECEIVED', 'PICKED_UP', 'LOADING_OR_RETURNING', 'DELIVERED']))).orderBy(desc(s.driverProgressEvents.occurredAt), desc(s.driverProgressEvents.id)),
    db.select({ tripId: s.tripPodSubmissions.tripId, status: s.tripPodSubmissions.status, version: s.tripPodSubmissions.submissionVersion, id: s.tripPodSubmissions.id, updatedAt: s.tripPodSubmissions.updatedAt }).from(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.tripId, tripIds)).orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id)),
  ]);
  const latestProgressByTrip = new Map<number, typeof progressRows[number]>();
  for (const progress of progressRows) if (!latestProgressByTrip.has(progress.tripId)) latestProgressByTrip.set(progress.tripId, progress);
  const latestPodByTrip = new Map<number, typeof podRows[number]>();
  for (const pod of podRows) if (!latestPodByTrip.has(pod.tripId)) latestPodByTrip.set(pod.tripId, pod);
  const items: DriverWorkInboxItem[] = rows.map((row) => {
    const waiting = row.status === 'CREATED' && !row.paperAt;
    const done = row.status === 'COMPLETED';
    const latestProgress = latestProgressByTrip.get(row.tripId);
    const latestPod = latestPodByTrip.get(row.tripId);
    const delivered = latestProgress?.eventType === 'DELIVERED';
    const acceptedPod = latestPod?.status === 'ACCEPTED' || latestPod?.status === 'SUBMITTED';
    const nextLabel = delivered ? acceptedPod ? 'Hoàn tất chuyến' : latestPod?.status === 'REJECTED' ? 'Bổ sung POD' : 'Nộp POD' : latestProgress ? 'Cập nhật tiến độ' : 'Xác nhận đã nhận lệnh';
    const milestone = done ? null : delivered ? acceptedPod ? 'Hoàn tất chuyến' : latestPod?.status === 'REJECTED' ? 'Bổ sung POD giao hàng' : 'Nộp POD giao hàng' : latestProgress?.eventType === 'LOADING_OR_RETURNING' ? 'Báo đã giao hàng' : latestProgress?.eventType === 'PICKED_UP' ? 'Báo đang trả hoặc xếp hàng' : latestProgress?.eventType === 'ORDER_RECEIVED' ? 'Báo đã lấy hàng' : 'Xác nhận đã nhận lệnh gốc';
    const state = done ? 'DONE' : waiting ? 'WAITING' : 'ACTION';
    const blockers = waiting ? [{ code: 'PAPER_ORDER', label: 'Chưa giao lệnh gốc', ownerRole: 'OPS', ownerLabel: 'Điều hành' }] : emptyParty;
    return { id: `trip:${row.tripId}`, entityType: 'trip', entityId: row.tripId, title: row.code ?? '—', subtitle: waiting ? 'Đang chờ Vận hành giao lệnh gốc' : done ? 'Đã hoàn thành' : milestone, state, priority: waiting ? 60 : done ? 0 : 80, dueAt: iso(row.start), freshnessAt: (latestPod?.updatedAt ?? latestProgress?.occurredAt ?? row.updatedAt).toISOString(), blockers, advisories: emptyParty, nextAction: done || !row.fulfillmentId || nextLabel == null ? null : { label: nextLabel, targetRoute: `/my-trips/${row.tripId}` }, targetRoute: `/my-trips/${row.tripId}`, fulfillmentId: row.fulfillmentId, tripId: row.tripId, shipmentCode: row.shipmentCode, containerSummary: row.containerSummary, origin: row.origin ?? row.pickupLocation, destination: row.destination ?? row.deliveryLocation, contactName: row.contactName, contactPhone: row.contactPhone, milestone, paperOrderReady: Boolean(row.paperAt), podState: latestPod?.status ?? 'MISSING' };
  });
  return pageWorkInboxItems(items, query);
}

export async function operationsWorkInbox(userId: number, query: InboxQuery) {
  const rows = await getForwarderTrips(userId);
  const tripIds = rows.flatMap((row) => row.tripId == null ? [] : [row.tripId]);
  const [tripFacts, tripContainers, completionScopes] = tripIds.length === 0
    ? [[], [], []] as const
    : await Promise.all([
      db.select({ id: s.trips.id, paperAt: s.trips.paperOrderCollectedAt, updatedAt: s.trips.updatedAt, driverName: s.drivers.name }).from(s.trips).leftJoin(s.drivers, eq(s.drivers.id, s.trips.driverId)).where(inArray(s.trips.id, tripIds)),
      db.select({ tripId: s.tripContainers.tripId, id: s.tripContainers.id }).from(s.tripContainers).where(inArray(s.tripContainers.tripId, tripIds)),
      db.select({ tripId: s.tripExpenseCompletionScopes.tripId, tripContainerId: s.tripExpenseCompletionScopes.tripContainerId, status: s.tripExpenseCompletionScopes.status }).from(s.tripExpenseCompletionScopes).where(inArray(s.tripExpenseCompletionScopes.tripId, tripIds)),
    ]);
  const factsByTrip = new Map(tripFacts.map((fact) => [fact.id, fact]));
  const items: OperationsWorkInboxItem[] = rows.map((row) => {
    const tripId = row.tripId;
    const fact = tripId == null ? undefined : factsByTrip.get(tripId);
    const exchangeIncomplete = row.orderExchangeStatus !== 'COMPLETED';
    // Terminal trips (completed/canceled) can never complete a paper handoff
    // through the driver-facing flow — the server guard rejects updates on
    // ended records. Advertising the handoff action there steers Ops into an
    // impossible step; unresolved handoff on a terminal trip is a dispatcher
    // responsibility instead.
    const terminalTrip = tripId != null && (row.tripStatus === 'COMPLETED' || row.tripStatus === 'CANCELED');
    const handoff = tripId != null && !exchangeIncomplete && !fact?.paperAt && !terminalTrip;
    const requiredContainerIds = tripId == null ? [] : tripContainers.filter((container) => container.tripId === tripId).map((container) => container.id);
    const completedScopeKeys = new Set(tripId == null ? [] : completionScopes.filter((scope) => scope.tripId === tripId && scope.status === 'COMPLETED').map((scope) => scope.tripContainerId == null ? 'general' : String(scope.tripContainerId)));
    const incompleteExpenses = tripId != null && (!completedScopeKeys.has('general') || requiredContainerIds.some((id) => !completedScopeKeys.has(String(id))));
    const done = tripId != null && row.tripStatus === 'COMPLETED' && !incompleteExpenses;
    const terminalHandoffUnresolved = terminalTrip && !exchangeIncomplete && !fact?.paperAt;
    const blockers = exchangeIncomplete ? [{ code: 'ORDER_EXCHANGE', label: 'Chưa hoàn tất đổi lệnh', ownerRole: 'OPS', ownerLabel: 'Vận hành' }] : terminalHandoffUnresolved ? [{ code: 'PAPER_ORDER_TERMINAL', label: 'Chuyến đã kết thúc — bàn giao lệnh giấy cần điều vận xử lý', ownerRole: 'DISPATCHER', ownerLabel: 'Điều vận' }] : handoff ? [{ code: 'PAPER_ORDER', label: 'Chưa hoàn tất bàn giao lệnh giấy', ownerRole: 'OPS', ownerLabel: 'Vận hành' }] : incompleteExpenses ? [{ code: 'EXPENSE_EVIDENCE', label: 'Chi phí hoặc chứng từ chưa hoàn thiện', ownerRole: 'OPS', ownerLabel: 'Vận hành' }] : emptyParty;
    const targetRoute = tripId == null ? '/my-orders' : `/my-forwarder-trips/${tripId}`;
    const exchangeActionLabel = row.orderExchangeStatus === 'PENDING' ? 'Bắt đầu đổi lệnh' : 'Xác nhận đã đổi lệnh';
    // Business keys only: shipmentCode (SHP-, id-derived) and bare ids are
    // banned from display strings — Số Bill/Booking + số tờ khai identify a
    // lot, tripCode (independent counter) identifies a trip.
    const lotBusinessLabel = [row.billNumber, row.bookingNumber, row.declarationNumbers].filter(Boolean).join(' / ');
    return { id: tripId == null ? `shipment:${row.shipmentId}:pretrip` : `shipment:${row.shipmentId}:trip:${tripId}`, entityType: tripId == null ? 'shipment_order_exchange' : 'fulfillment_trip', entityId: tripId ?? row.shipmentId, title: tripId == null ? (lotBusinessLabel || '—') : (row.tripCode ?? '—'), subtitle: `${row.containerNumbers ?? 'Chưa có container'} · ${row.customerName ?? 'Khách hàng'} · ${fact?.driverName ?? row.truckPlate ?? 'Chưa phân tài xế'}`, state: done ? 'DONE' : blockers.length ? 'ACTION' : 'WAITING', priority: blockers.length ? 90 : done ? 0 : 40, dueAt: row.departureDate ? new Date(`${row.departureDate}T00:00:00.000Z`).toISOString() : null, freshnessAt: fact?.updatedAt.toISOString() ?? row.orderExchangeCompletedAt?.toISOString() ?? row.orderExchangeStartedAt?.toISOString() ?? new Date().toISOString(), blockers, advisories: emptyParty, nextAction: exchangeIncomplete ? { label: exchangeActionLabel, targetRoute } : terminalHandoffUnresolved ? { label: 'Chuyến đã kết thúc — liên hệ điều vận', targetRoute: '/my-orders' } : handoff ? { label: 'Bàn giao lệnh gốc', targetRoute } : incompleteExpenses ? { label: 'Hoàn thiện chi phí', targetRoute } : null, targetRoute, shipmentId: row.shipmentId, shipmentVersion: row.shipmentVersion, tripId, containerSummary: row.containerNumbers ?? row.containerTypeSummary, driverName: fact?.driverName ?? null, truckPlate: row.truckPlate, paperOrderState: fact?.paperAt ? 'COMPLETED' : exchangeIncomplete ? 'PENDING' : 'IN_PROGRESS', orderExchangeState: row.orderExchangeStatus, expenseEvidenceComplete: !incompleteExpenses };
  });
  return pageWorkInboxItems(items, query);
}

export async function financialWorkInbox(query: InboxQuery) {
  const rows = await db.select({ id: s.tripsComposite.id, code: s.tripsComposite.tripCode, pod: s.tripsComposite.podRecoveredAt, status: s.tripsComposite.status, dirty: s.tripsComposite.arSnapshotDirty, updatedAt: s.tripsComposite.updatedAt }).from(s.tripsComposite).where(and(eq(s.tripsComposite.status, 'COMPLETED'), isNull(s.tripsComposite.deletedAt), query.search?.trim() ? ilike(s.tripsComposite.tripCode, `%${query.search.trim()}%`) : undefined)).orderBy(desc(s.tripsComposite.updatedAt)).limit(MAX_INBOX_CANDIDATES + 1);
  assertCompleteCandidateScan(rows);
  const tripIds = rows.map((row) => row.id);
  const [podRows, pendingExpenseRows, settlementRows, snapshotRows, attemptRows, responseRows] = tripIds.length === 0 ? [[], [], [], [], [], []] as const : await Promise.all([
    db.select({ tripId: s.tripPodSubmissions.tripId, id: s.tripPodSubmissions.id, status: s.tripPodSubmissions.status, version: s.tripPodSubmissions.submissionVersion }).from(s.tripPodSubmissions).where(inArray(s.tripPodSubmissions.tripId, tripIds)).orderBy(desc(s.tripPodSubmissions.submissionVersion), desc(s.tripPodSubmissions.id)),
    db.select({ tripId: s.tripExpenses.tripId }).from(s.tripExpenses).where(and(inArray(s.tripExpenses.tripId, tripIds), inArray(s.tripExpenses.approvalStatus, ['DRAFT', 'PENDING', 'RETURN_FOR_EVIDENCE']))),
    db.select({ tripId: s.tripExpenses.tripId, expenseId: s.tripExpenses.id, settlementStatus: s.advanceSettlements.status }).from(s.tripExpenses).leftJoin(s.settlementExpenses, eq(s.settlementExpenses.tripExpenseId, s.tripExpenses.id)).leftJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId)).where(and(inArray(s.tripExpenses.tripId, tripIds), eq(s.tripExpenses.settlementMethod, 'OPS_ADVANCE'))),
    db.select({ tripId: s.profitabilitySnapshots.tripId }).from(s.profitabilitySnapshots).where(inArray(s.profitabilitySnapshots.tripId, tripIds)),
    db.select({ id: s.deliveryAttempts.id, tripId: s.deliveryAttempts.tripId }).from(s.deliveryAttempts).where(inArray(s.deliveryAttempts.tripId, tripIds)),
    db.select({ tripId: s.deliveryAttempts.tripId, attemptId: s.deliveryAttempts.id, decision: s.customerDeliveryResponses.decision }).from(s.deliveryAttempts).leftJoin(s.customerDeliveryResponses, eq(s.customerDeliveryResponses.deliveryAttemptId, s.deliveryAttempts.id)).where(inArray(s.deliveryAttempts.tripId, tripIds)),
  ]);
  const latestPodByTrip = new Map<number, typeof podRows[number]>();
  for (const pod of podRows) if (!latestPodByTrip.has(pod.tripId)) latestPodByTrip.set(pod.tripId, pod);
  const pendingExpenseTripIds = new Set(pendingExpenseRows.map((expense) => expense.tripId));
  const snapshotTripIds = new Set(snapshotRows.map((snapshot) => snapshot.tripId));
  const items: AccountantWorkInboxItem[] = [];
  for (const row of rows) {
    const latestPod = latestPodByTrip.get(row.id);
    const tripSettlementRows = settlementRows.filter((expense) => expense.tripId === row.id);
    const attempts = attemptRows.filter((attempt) => attempt.tripId === row.id);
    const responses = responseRows.filter((response) => response.tripId === row.id);
    // Internal e-POD approval removed: a saved submission (not a draft, not
    // customer-rejected) is ready evidence for accounting reconciliation.
    const acceptedPodReady = latestPod?.status != null
      && latestPod.status !== 'DRAFT'
      && latestPod.status !== 'REJECTED';
    const settlementComplete = tripSettlementRows.every((expense) => expense.settlementStatus === 'RECORDED');
    const profitabilitySnapshotReady = snapshotTripIds.has(row.id) && !row.dirty;
    const blockers = [];
    if (!acceptedPodReady) blockers.push({ code: 'POD', label: 'Chưa có e-POD hợp lệ', ownerRole: 'OPS', ownerLabel: 'Vận hành' });
    if (pendingExpenseTripIds.has(row.id)) blockers.push({ code: 'EXPENSE_APPROVAL', label: 'Khoản chi cần hoàn thiện dữ liệu hoặc chứng từ', ownerRole: 'ACCOUNTANT', ownerLabel: 'Kế toán' });
    if (!settlementComplete) blockers.push({ code: 'SETTLEMENT', label: 'Quyết toán tạm ứng chưa hoàn tất', ownerRole: 'OPS', ownerLabel: 'Vận hành' });
    if (!profitabilitySnapshotReady) blockers.push({ code: 'PROFITABILITY', label: 'Thiếu ảnh chụp lợi nhuận hiện hành', ownerRole: 'ACCOUNTANT', ownerLabel: 'Kế toán' });
    const disputed = responses.some((response) => response.decision === 'DISPUTED');
    const unanswered = attempts.length > 0 && responses.some((response) => response.decision == null);
    const advisories = disputed ? [{ code: 'CUSTOMER_DISPUTE', label: 'Khách hàng báo sai lệch giao hàng (không chặn tài chính)', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' }] : unanswered ? [{ code: 'CUSTOMER_NO_RESPONSE', label: 'Khách hàng chưa phản hồi giao hàng (không chặn tài chính)', ownerRole: 'CUSTOMER', ownerLabel: 'Khách hàng' }] : emptyParty;
    const targetRoute = `/accounting?view=transport&search=${encodeURIComponent(row.code ?? String(row.id))}`;
    items.push({ id: `trip:${row.id}`, entityType: 'trip', entityId: row.id, title: row.code ?? '—', subtitle: blockers.length ? 'Cần hoàn thiện điều kiện tài chính' : 'Sẵn sàng đối soát', state: blockers.length ? 'WAITING' : 'ACTION', priority: blockers.length ? 70 : 90, dueAt: null, freshnessAt: row.updatedAt.toISOString(), blockers, advisories, nextAction: { label: 'Mở hồ sơ vận tải', targetRoute }, targetRoute, tripId: row.id, acceptedPod: acceptedPodReady, expenseApprovalPending: pendingExpenseTripIds.has(row.id), settlementComplete, profitabilitySnapshotReady });
  }
  return pageWorkInboxItems(items, query);
}

export async function managerDecisionInbox(userId: number, query: InboxQuery) {
  const nowDate = new Date();
  const [disputes, overdueHandoffs, slaExceptions] = await Promise.all([
    db.select({
      id: s.customerDeliveryResponses.id,
      attemptId: s.customerDeliveryResponses.deliveryAttemptId,
      reason: s.customerDeliveryResponses.reason,
      respondedAt: s.customerDeliveryResponses.respondedAt,
    }).from(s.customerDeliveryResponses)
      .where(eq(s.customerDeliveryResponses.decision, 'DISPUTED')),
    db.select({
      id: s.trips.id,
      code: s.trips.tripCode,
      plannedStartAt: s.trips.plannedStartAt,
      orderExchangeCompletedAt: s.shipments.orderExchangeCompletedAt,
    }).from(s.trips)
      .innerJoin(s.shipments, eq(s.shipments.id, s.trips.shipmentId))
      .where(and(
        isNull(s.trips.deletedAt),
        isNotNull(s.shipments.orderExchangeCompletedAt),
        isNull(s.trips.paperOrderCollectedAt),
        lt(s.trips.plannedStartAt, nowDate),
        inArray(s.trips.status, ['CREATED', 'IN_TRANSIT']),
      )),
    db.select({
      id: s.shipments.id,
      code: s.shipments.shipmentCode,
      cutoffAt: s.shipments.customsCutoffAt,
      updatedAt: s.shipments.updatedAt,
    }).from(s.shipments)
      .where(and(
        isNull(s.shipments.deletedAt),
        isNotNull(s.shipments.customsCutoffAt),
        lt(s.shipments.customsCutoffAt, nowDate),
        notInArray(s.shipments.status, ['COMPLETED', 'CANCELED']),
      )),
  ]);
  const now = Date.now();
  const ageHours = (date: Date) => Math.max(0, (now - date.getTime()) / 3_600_000);
  const items: ManagerWorkInboxItem[] = disputes.map((row) => ({
    id: `delivery-dispute:${row.id}`, entityType: 'delivery_response', entityId: row.id,
    title: 'Phản hồi sai lệch giao hàng cần quyết định', subtitle: row.reason,
    state: 'ACTION', priority: 100, dueAt: null, freshnessAt: row.respondedAt.toISOString(),
    blockers: [{ code: 'CUSTOMER_DISPUTE', label: 'Khách hàng phản hồi sai lệch', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' }], advisories: emptyParty,
    nextAction: { label: 'Xử lý phản hồi', targetRoute: `/dashboard?disputeId=${row.id}` },
    targetRoute: `/dashboard?disputeId=${row.id}`,
    owner: { code: 'MANAGER', label: 'Cần quyết định', ownerRole: 'MANAGER', ownerLabel: 'Quản lý' },
    ageHours: ageHours(row.respondedAt), impact: 'Có thể ảnh hưởng quan hệ khách hàng; không chặn đóng tài chính.',
  }));
  for (const row of overdueHandoffs) {
    const startedAt = row.plannedStartAt ?? row.orderExchangeCompletedAt!;
    items.push({
      id: `paper-handoff:${row.id}`, entityType: 'trip', entityId: row.id,
      title: `${row.code ?? '—'} quá hạn bàn giao lệnh gốc`,
      subtitle: 'Đổi lệnh đã hoàn tất nhưng tài xế chưa nhận lệnh gốc', state: 'ACTION', priority: 96,
      dueAt: row.plannedStartAt?.toISOString() ?? null, freshnessAt: row.orderExchangeCompletedAt!.toISOString(),
      blockers: [{ code: 'PAPER_HANDOFF_OVERDUE', label: 'Bàn giao lệnh gốc quá hạn', ownerRole: 'OPS', ownerLabel: 'Vận hành' }], advisories: emptyParty,
      nextAction: { label: 'Mở hồ sơ chuyến', targetRoute: `/trips/${row.id}` }, targetRoute: `/trips/${row.id}`,
      owner: { code: 'OPS', label: 'Bàn giao lệnh gốc', ownerRole: 'OPS', ownerLabel: 'Vận hành' },
      ageHours: ageHours(startedAt), impact: 'Tài xế có thể không đủ chứng từ để tiếp tục hành trình.',
    });
  }
  for (const row of slaExceptions) {
    items.push({
      id: `shipment-sla:${row.id}`, entityType: 'shipment', entityId: row.id,
      title: `${row.code ?? '—'} quá hạn cut-off`, subtitle: 'Lô hàng chưa hoàn tất sau thời điểm cut-off hải quan',
      state: 'ACTION', priority: 94, dueAt: row.cutoffAt!.toISOString(), freshnessAt: row.updatedAt.toISOString(),
      blockers: [{ code: 'CUSTOMS_CUTOFF_OVERDUE', label: 'Quá hạn cut-off hải quan', ownerRole: 'DISPATCHER', ownerLabel: 'Điều vận' }], advisories: emptyParty,
      nextAction: { label: 'Xem chi tiết lô hàng', targetRoute: `/shipments-detail?shipmentId=${row.id}` }, targetRoute: `/shipments-detail?shipmentId=${row.id}`,
      owner: { code: 'DISPATCHER', label: 'Xử lý ngoại lệ SLA', ownerRole: 'DISPATCHER', ownerLabel: 'Điều vận' },
      ageHours: ageHours(row.cutoffAt!), impact: 'Có nguy cơ phát sinh lưu bãi hoặc trễ cam kết giao hàng.',
    });
  }
  // 2026-09-10 (phê duyệt removed, chunk 7): the approval-queue leg is GONE —
  // every flow that fed it now applies at request time, so the manager inbox
  // no longer surfaces pending approvals.
  return pageWorkInboxItems(items, query);
}

type HealthSource<T> = { ok: true; value: T } | { ok: false };
async function healthSource<T>(load: () => Promise<T>): Promise<HealthSource<T>> {
  try { return { ok: true, value: await load() }; } catch { return { ok: false }; }
}

export async function adminHealth(query: InboxQuery) {
  const companyKeys = Object.values(COMPANY_INFO_SETTING_KEYS);
  const [audit, failedJobs, failedEmail, setup, userAccess, configuration] = await Promise.all([
    healthSource(() => db.select({ id: s.auditLogs.id, message: s.auditLogs.message, timestamp: s.auditLogs.timestamp }).from(s.auditLogs).orderBy(desc(s.auditLogs.timestamp)).limit(1)),
    healthSource(() => db.select({ id: s.durableEffectJobs.id, updatedAt: s.durableEffectJobs.updatedAt }).from(s.durableEffectJobs).where(eq(s.durableEffectJobs.status, 'FAILED'))),
    healthSource(() => db.select({ id: s.customerEmailLogs.id, updatedAt: s.customerEmailLogs.updatedAt }).from(s.customerEmailLogs).where(eq(s.customerEmailLogs.status, 'FAILED'))),
    healthSource(() => db.select({ key: s.appSettings.key, value: s.appSettings.value, updatedAt: s.appSettings.updatedAt }).from(s.appSettings).where(inArray(s.appSettings.key, companyKeys))),
    healthSource(() => db.select({ id: s.users.id, role: s.users.role, status: s.users.status, updatedAt: s.users.updatedAt }).from(s.users).where(isNull(s.users.deletedAt))),
    healthSource(async () => {
      const [routes, customers, trucks, drivers] = await Promise.all([
        db.select({ id: s.routes.id }).from(s.routes).where(isNull(s.routes.deletedAt)),
        db.select({ id: s.customers.id }).from(s.customers).where(isNull(s.customers.deletedAt)),
        db.select({ id: s.trucks.id }).from(s.trucks).where(isNull(s.trucks.deletedAt)),
        db.select({ id: s.drivers.id }).from(s.drivers).where(isNull(s.drivers.deletedAt)),
      ]);
      return { routes: routes.length, customers: customers.length, trucks: trucks.length, drivers: drivers.length };
    }),
  ]);
  const now = new Date().toISOString();
  const unavailableSourceCount = [audit, failedJobs, failedEmail, setup, userAccess, configuration].filter((source) => !source.ok).length;
  const items: AdminHealthInboxItem[] = [{ id: 'health:database', entityType: 'system_health', entityId: 'database', title: 'Nguồn dữ liệu PostgreSQL', subtitle: unavailableSourceCount ? `${unavailableSourceCount} nguồn dữ liệu không khả dụng` : 'Sẵn sàng', state: unavailableSourceCount ? 'WAITING' : 'DONE', priority: unavailableSourceCount ? 95 : 0, dueAt: null, freshnessAt: now, blockers: unavailableSourceCount ? [{ code: 'DATABASE_SOURCE_UNAVAILABLE', label: 'Một hoặc nhiều nguồn PostgreSQL không đọc được', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }] : emptyParty, advisories: emptyParty, nextAction: unavailableSourceCount ? { label: 'Kiểm tra hệ thống', targetRoute: '/config' } : null, targetRoute: '/config', healthState: unavailableSourceCount ? 'UNAVAILABLE' : 'HEALTHY', source: 'database' }];
  const unavailable = (source: string, title: string): AdminHealthInboxItem => ({ id: `health:${source}:unavailable`, entityType: 'system_health', entityId: source, title, subtitle: 'Nguồn dữ liệu không khả dụng', state: 'WAITING', priority: 80, dueAt: null, freshnessAt: now, blockers: [{ code: 'SOURCE_UNAVAILABLE', label: 'Không thể đọc nguồn dữ liệu', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }], advisories: emptyParty, nextAction: { label: 'Kiểm tra cấu hình', targetRoute: '/config' }, targetRoute: '/config', healthState: 'UNAVAILABLE', source });

  if (!setup.ok) items.push(unavailable('setup', 'Mức độ hoàn tất thiết lập'));
  else {
    const requiredKeys = [COMPANY_INFO_SETTING_KEYS.name, COMPANY_INFO_SETTING_KEYS.address, COMPANY_INFO_SETTING_KEYS.taxCode];
    const configured = new Map(setup.value.map((row) => [row.key, row.value.trim()]));
    const missing = requiredKeys.filter((key) => !configured.get(key));
    items.push({ id: 'health:setup', entityType: 'system_health', entityId: 'setup', title: 'Mức độ hoàn tất thiết lập', subtitle: missing.length ? `Thiếu ${missing.length} trường hồ sơ doanh nghiệp bắt buộc` : 'Hồ sơ doanh nghiệp cốt lõi đã đầy đủ', state: missing.length ? 'ACTION' : 'DONE', priority: missing.length ? 85 : 10, dueAt: null, freshnessAt: setup.value.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, new Date(0)).toISOString(), blockers: missing.length ? [{ code: 'SETUP_INCOMPLETE', label: 'Thiết lập doanh nghiệp chưa đầy đủ', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }] : emptyParty, advisories: emptyParty, nextAction: missing.length ? { label: 'Hoàn tất hồ sơ', targetRoute: '/config/company-info' } : null, targetRoute: '/config/company-info', healthState: missing.length ? 'FAILED' : 'HEALTHY', source: 'setup' });
  }

  if (!userAccess.ok) items.push(unavailable('users_permissions', 'Người dùng và phân quyền'));
  else {
    const active = userAccess.value.filter((row) => row.status === 'ACTIVE');
    const roles = new Set(active.map((row) => row.role));
    items.push({ id: 'health:users-permissions', entityType: 'system_health', entityId: 'users_permissions', title: 'Người dùng và phân quyền', subtitle: `${active.length} tài khoản hoạt động · ${roles.size} vai trò`, state: active.length ? 'DONE' : 'ACTION', priority: active.length ? 10 : 90, dueAt: null, freshnessAt: active.reduce((latest, row) => row.updatedAt > latest ? row.updatedAt : latest, new Date(0)).toISOString(), blockers: active.length ? emptyParty : [{ code: 'NO_ACTIVE_USERS', label: 'Không có tài khoản hoạt động', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }], advisories: emptyParty, nextAction: { label: 'Quản lý người dùng', targetRoute: '/users' }, targetRoute: '/users', healthState: active.length ? 'HEALTHY' : 'FAILED', source: 'users_permissions' });
  }

  if (!configuration.ok) items.push(unavailable('configuration', 'Sức khỏe cấu hình vận hành'));
  else {
    const missingCatalogs = Object.entries(configuration.value).filter(([, count]) => count === 0).map(([name]) => name);
    items.push({ id: 'health:configuration', entityType: 'system_health', entityId: 'configuration', title: 'Sức khỏe cấu hình vận hành', subtitle: missingCatalogs.length ? `Danh mục chưa có dữ liệu: ${missingCatalogs.join(', ')}` : `${configuration.value.routes} tuyến · ${configuration.value.customers} khách · ${configuration.value.trucks} xe · ${configuration.value.drivers} tài xế`, state: missingCatalogs.length ? 'ACTION' : 'DONE', priority: missingCatalogs.length ? 75 : 5, dueAt: null, freshnessAt: now, blockers: missingCatalogs.length ? [{ code: 'CONFIG_INCOMPLETE', label: 'Danh mục vận hành chưa đầy đủ', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }] : emptyParty, advisories: emptyParty, nextAction: missingCatalogs.length ? { label: 'Mở cấu hình', targetRoute: '/config' } : null, targetRoute: '/config', healthState: missingCatalogs.length ? 'FAILED' : 'HEALTHY', source: 'configuration' });
  }

  if (!audit.ok) items.push(unavailable('audit', 'Hoạt động kiểm toán gần đây'));
  else items.push({ id: 'health:audit', entityType: 'system_health', entityId: 'audit', title: 'Hoạt động kiểm toán gần đây', subtitle: audit.value[0]?.message ?? 'Chưa có hoạt động kiểm toán', state: 'DONE', priority: 0, dueAt: null, freshnessAt: audit.value[0]?.timestamp.toISOString() ?? now, blockers: emptyParty, advisories: emptyParty, nextAction: null, targetRoute: '/audit-log', healthState: 'HEALTHY', source: 'audit' });

  if (!failedJobs.ok) items.push(unavailable('durable_effect_jobs', 'Tác vụ giao nhận và thông báo'));
  else {
    const latest = failedJobs.value.reduce((value, row) => row.updatedAt > value ? row.updatedAt : value, new Date(0));
    items.push({ id: 'health:durable-effect-jobs', entityType: 'system_health', entityId: 'durable_effect_jobs', title: 'Tác vụ giao nhận và thông báo', subtitle: failedJobs.value.length ? `${failedJobs.value.length} tác vụ đang thất bại` : 'Không có tác vụ thất bại', state: failedJobs.value.length ? 'ACTION' : 'DONE', priority: failedJobs.value.length ? 100 : 0, dueAt: null, freshnessAt: failedJobs.value.length ? latest.toISOString() : now, blockers: failedJobs.value.length ? [{ code: 'FAILED_DELIVERY_JOBS', label: 'Tác vụ bền vững cần xử lý', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }] : emptyParty, advisories: emptyParty, nextAction: failedJobs.value.length ? { label: 'Kiểm tra cấu hình', targetRoute: '/config' } : null, targetRoute: '/config', healthState: failedJobs.value.length ? 'FAILED' : 'HEALTHY', source: 'durable_effect_jobs' });
  }
  if (!failedEmail.ok) items.push(unavailable('customer_email_logs', 'Tình trạng email khách hàng'));
  else {
    const latest = failedEmail.value.reduce((value, row) => row.updatedAt > value ? row.updatedAt : value, new Date(0));
    items.push({ id: 'health:customer-email-logs', entityType: 'system_health', entityId: 'customer_email_logs', title: 'Tình trạng email khách hàng', subtitle: failedEmail.value.length ? `${failedEmail.value.length} email gửi thất bại` : 'Không có email gửi thất bại', state: failedEmail.value.length ? 'ACTION' : 'DONE', priority: failedEmail.value.length ? 90 : 0, dueAt: null, freshnessAt: failedEmail.value.length ? latest.toISOString() : now, blockers: failedEmail.value.length ? [{ code: 'FAILED_CUSTOMER_EMAILS', label: 'Email khách hàng cần xử lý', ownerRole: 'ADMIN', ownerLabel: 'Quản trị' }] : emptyParty, advisories: emptyParty, nextAction: failedEmail.value.length ? { label: 'Kiểm tra cấu hình', targetRoute: '/config' } : null, targetRoute: '/config', healthState: failedEmail.value.length ? 'FAILED' : 'HEALTHY', source: 'customer_email_logs' });
  }
  return pageWorkInboxItems(items, query);
}
