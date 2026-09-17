import { and, eq, isNull, inArray, notInArray, or } from 'drizzle-orm';
import { Role, TxnType, type ExpenseSourceRef, type ExpenseAccountingUpdate, type ExpenseSourceKind } from '@tingting/shared';
import * as s from '../db/schema';
import type { AuthUser } from '../middleware/auth';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { assertShipmentAccountingUnlocked } from './shipment-accounting-lock.service';
import { assertExpenseSourceMutable, ensureLegacyExpenseSource, assertActiveExpensePayer, hydrateExpenseAccountingSource, type ExpenseAccountingSource } from './expense-accounting-source.service';
import { propagateExpenseApproval } from './source-change.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { lockTripFinancialAuthority } from './trip-financial-authority-lock.service';
import { assertExpenseEvidenceAttachments } from './expense-accounting-evidence.service';
import { refreshExpenseTripCosts } from './expense-trip-cost.service';
import { LedgerService } from './ledger.service';
import { linkExpenseToRealTrip } from './expense-source-trip-link.service';
import { assertActorCanAccessShipment } from './shipment-coordination.service';

export type ExpenseActor = Pick<AuthUser, 'userId' | 'role'>;
export function requireExpenseFinance(actor: ExpenseActor) {
  if (![Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT].includes(actor.role)) throw new ApiError(403, 'Chỉ kế toán hoặc quản lý được ghi nhận nghiệp vụ tài chính này.');
}
export function assertExpenseActorScope(actor: ExpenseActor, row: ExpenseAccountingSource) {
  if ([Role.ADMIN, Role.MANAGER, Role.ACCOUNTANT, Role.CUS].includes(actor.role)) return;
  if ([Role.OPS, Role.DRIVER].includes(actor.role) && (row.payerUserId === actor.userId || row.recordedById === actor.userId)) return;
  throw new ApiError(404, 'Không tìm thấy khoản chi trong phạm vi của bạn.');
}
export async function getExpenseForCommand(tx: Tx, actor: ExpenseActor, ref: ExpenseSourceRef) {
  const [link] = await tx.select({ tripId: s.expenseAccountingSources.tripId }).from(s.expenseAccountingSources)
    .where(and(eq(s.expenseAccountingSources.sourceKind, ref.sourceKind), eq(s.expenseAccountingSources.sourceId, ref.sourceId)));
  const [native] = !link?.tripId && ref.sourceKind === 'TRIP' ? await tx.select({ tripId: s.tripExpenses.tripId }).from(s.tripExpenses).where(eq(s.tripExpenses.id, ref.sourceId))
    : !link?.tripId && ref.sourceKind === 'DRIVER' ? await tx.select({ tripId: s.driverIncidentalCosts.tripId }).from(s.driverIncidentalCosts).where(eq(s.driverIncidentalCosts.id, ref.sourceId)) : [];
  const tripId = link?.tripId ?? native?.tripId;
  if (tripId) {
    const [trip] = await tx.select({ pairId: s.trips.activeTripPairId }).from(s.trips).where(eq(s.trips.id, tripId));
    const [pair] = trip?.pairId ? await tx.select().from(s.tripPairs).where(eq(s.tripPairs.id, trip.pairId)) : [];
    await lockTripFinancialAuthority(tx, pair?.status === 'ACTIVE' ? [pair.firstTripId, pair.secondTripId] : [tripId]);
  }
  const row = await ensureLegacyExpenseSource(tx, ref.sourceKind, ref.sourceId, actor.userId);
  assertExpenseActorScope(actor, row);
  if (actor.role === Role.CUS) await assertActorCanAccessShipment(tx, row.shipmentId, { ...actor, username: null, email: null, fullName: null });
  if (row.version !== ref.expectedVersion) throw new ApiError(409, `Khoản ${ref.sourceKind}-${ref.sourceId} đã thay đổi. Vui lòng tải lại.`);
  if (row.status !== 'RECORDED') throw new ApiError(409, 'Khoản chi đã hủy.');
  return row;
}

export async function auditExpenseChange(tx: Tx, actor: ExpenseActor, before: ExpenseAccountingSource, after: ExpenseAccountingSource, reason: string) {
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_ACCOUNTING_UPDATED', entityType: 'expense_accounting_source', entityId: before.id,
    payload: { reason, before, after } });
}

export async function updateAccountingExpense(tx: Tx, actor: ExpenseActor, kind: ExpenseSourceKind, id: number, input: ExpenseAccountingUpdate) {
  if (input.tripId) await lockTripFinancialAuthority(tx, [input.tripId]);
  const before = await getExpenseForCommand(tx, actor, { sourceKind: kind, sourceId: id, expectedVersion: input.expectedVersion });
  if (input.tripId && Object.keys(input).every(key => ['tripId', 'expectedVersion', 'reason'].includes(key))) {
    requireExpenseFinance(actor);
    await assertShipmentAccountingUnlocked(tx, before.shipmentId);
    let linked = await linkExpenseToRealTrip(tx, before, input.tripId);
    const [updated] = await tx.update(s.expenseAccountingSources).set({ version: before.version + 1 }).where(eq(s.expenseAccountingSources.id, linked.id)).returning();
    linked = await hydrateExpenseAccountingSource(tx, updated);
    if (linked.confirmedAt) linked = await syncExpenseBillingSource(tx, linked, actor.userId);
    await auditExpenseChange(tx, actor, before, linked, input.reason);
    return linked;
  }
  if (input.tripId) throw new ApiError(400, 'Liên kết chuyến là thao tác riêng để giữ nguyên lịch sử chi phí.');
  const evidenceOnly = Object.keys(input).every(key => ['expectedVersion', 'reason', 'photoStorageKeys'].includes(key));
  if (!evidenceOnly) await assertExpenseSourceMutable(tx, before);
  if (input.photoStorageKeys) await assertExpenseEvidenceAttachments(tx, actor, before, input.photoStorageKeys);
  if (input.photoStorageKeys && (before.confirmedAt || before.reconciliationId)
    && before.photoStorageKeys.some(key => !input.photoStorageKeys!.includes(key))) throw new ApiError(409, 'Giữ nguyên chứng từ đã đối chiếu; chỉ bổ sung ảnh.');
  if (actor.role === Role.CUS) {
    const permitted = new Set(['expectedVersion', 'reason', 'customerChargeAmount', 'recoveryNote']);
    if (Object.keys(input).some(key => !permitted.has(key))) throw new ApiError(403, 'CUS chỉ được xác định khoản thu khách và ghi chú.');
  } else if ([Role.OPS, Role.DRIVER].includes(actor.role)) {
    if (input.customerChargeAmount !== undefined || input.payerKind !== undefined || input.payerUserId !== undefined) throw new ApiError(403, 'Không được tự thay đổi khoản thu khách hoặc người thực chi.');
  } else requireExpenseFinance(actor);
  const payerId = input.payerUserId === undefined ? before.payerUserId : input.payerUserId;
  const payerKind = input.payerKind ?? before.payerKind;
  if (payerKind === 'USER' && !payerId) throw new ApiError(400, 'Chọn người thực chi.');
  if (payerId) await assertActiveExpensePayer(tx, payerId);
  let payableEntityType = before.payableEntityType;
  let payableEntityId = before.payableEntityId;
  if (payerKind === 'COMPANY') { payableEntityType = null; payableEntityId = null; }
  if (payerKind === 'USER' && payerId !== before.payerUserId) {
    const payer = await assertActiveExpensePayer(tx, payerId!);
    if (payer.role === Role.OPS) { payableEntityType = 'FORWARDER'; payableEntityId = payer.id; }
    else if (payer.role === Role.DRIVER) {
      const [driver] = await tx.select({ id: s.drivers.id }).from(s.drivers).where(eq(s.drivers.userId, payer.id));
      if (!driver) throw new ApiError(400, 'Tài khoản chưa liên kết lái xe.');
      payableEntityType = 'DRIVER'; payableEntityId = driver.id;
    } else throw new ApiError(400, 'Người thực chi phải là Ops hoặc lái xe.');
  }
  const { reason } = input;
  if (kind === 'INVOICE') throw new ApiError(409, 'Sửa chi phí hóa đơn từ hồ sơ hóa đơn kết hợp để giữ đồng bộ nguồn.');
  if (kind === 'OPS' && payerKind !== 'COMPANY' && (payerKind !== 'USER' || payableEntityType !== 'FORWARDER')) throw new ApiError(400, 'Khoản chi Ops phải giữ người chi Ops; thêm chi công ty từ bảng kế toán.');
  if (kind === 'DRIVER' && payerKind !== 'COMPANY' && (payerKind !== 'USER' || payableEntityType !== 'DRIVER')) throw new ApiError(400, 'Khoản chi lái xe phải liên kết đúng lái xe.');
  const metadata = { payerKind: payerKind === 'SUPPLIER' ? null : payerKind, costGroup: input.costGroup ?? before.costGroup, feeName: input.feeName ?? before.feeName,
    invoiceNumber: input.invoiceNumber === undefined ? before.invoiceNumber : input.invoiceNumber,
    invoiceDate: input.invoiceDate === undefined ? before.invoiceDate : input.invoiceDate,
    recoveryNote: input.recoveryNote === undefined ? before.recoveryNote : input.recoveryNote,
    customerChargeAmount: input.customerChargeAmount === undefined ? before.customerChargeAmount : String(input.customerChargeAmount),
    photoStorageKeys: input.photoStorageKeys ?? before.photoStorageKeys };
  const amount = input.amount === undefined ? before.amount : String(input.amount);
  if (metadata.costGroup === 'DRIVER_ROAD' && Number(metadata.customerChargeAmount ?? 0) !== 0) throw new ApiError(400, 'Tiền đường không thu khách; khoản thu phải thuộc chi phí lô hàng.');
  if (input.driverCostType && kind !== 'DRIVER') throw new ApiError(400, 'Loại phí lái xe chỉ áp dụng cho khoản chi lái xe.');
  const expenseDate = input.expenseDate ?? before.expenseDate;
  const note = input.note === undefined ? before.note : input.note;
  if (kind === 'OPS') await tx.update(s.opsExpenseEntries).set({ ...metadata, amount, paidAt: expenseDate, note,
    ...(payerId ? { paidById: payerId } : {}), updatedAt: new Date() }).where(eq(s.opsExpenseEntries.id, id));
  if (kind === 'DRIVER') await tx.update(s.driverIncidentalCosts).set({ ...metadata, ...(input.driverCostType ? { costType: input.driverCostType } : {}), amount, occurredAt: expenseDate, note,
    ...(payableEntityId ? { driverId: payableEntityId } : {}), receiptStorageKey: metadata.photoStorageKeys[0] ?? null }).where(eq(s.driverIncidentalCosts.id, id));
  if (kind === 'TRIP') {
    await tx.update(s.tripExpenses).set({ costGroup: metadata.costGroup, feeName: metadata.feeName, recoveryNote: metadata.recoveryNote,
      buyAmount: amount, sellAmount: metadata.customerChargeAmount ?? '0', expenseDate, note,
      invoiceNumber: metadata.invoiceNumber, invoiceDate: metadata.invoiceDate,
      forwarderId: payerKind === 'USER' ? payerId : null, supplierId: payerKind === 'SUPPLIER' ? payableEntityId : null,
      settlementMethod: payerKind === 'USER' ? 'OPS_ADVANCE' : 'COMPANY_DIRECT', updatedAt: new Date(),
    }).where(eq(s.tripExpenses.id, id));
  }
  const [link] = await tx.update(s.expenseAccountingSources).set({ version: before.version + 1, updatedAt: new Date() })
    .where(eq(s.expenseAccountingSources.id, before.id)).returning();
  let after = await hydrateExpenseAccountingSource(tx, link);
  if (!evidenceOnly && after.linkedTripExpenseId) after = await syncExpenseBillingSource(tx, after, actor.userId);
  await auditExpenseChange(tx, actor, before, after, reason);
  return after;
}

/** Customer-billing projection keeps one source ID; no cash or vendor expense is fabricated. */
export async function syncExpenseBillingSource(tx: Tx, source: ExpenseAccountingSource, actorId: number) {
  source = await linkExpenseToRealTrip(tx, source);
  if (source.customerChargeAmount == null) throw new ApiError(409, 'Chưa xác định khoản thu khách.');
  if (!source.tripId && !source.linkedTripExpenseId) return source; // Shipment costs remain available before dispatch.
  const charge = Number(source.customerChargeAmount);
  const principal = Math.min(Number(source.amount), charge);
  const fields = { buyAmount: source.amount, sellAmount: source.customerChargeAmount,
    recoverablePrincipalAmount: String(principal), serviceFeeAmount: String(charge - principal), expenseDate: source.expenseDate,
    invoiceNumber: source.invoiceNumber, invoiceDate: source.invoiceDate, note: source.note,
    updatedAt: new Date() };
  let expenseId = source.linkedTripExpenseId;
  if (expenseId) {
    const [expense] = await tx.select().from(s.tripExpenses).where(eq(s.tripExpenses.id, expenseId)).for('update');
    if (!expense) throw new ApiError(409, 'Nguồn chi phí của chứng từ không còn tồn tại.');
    await tx.update(s.tripExpenses).set({ ...fields, version: expense.version + 1 }).where(eq(s.tripExpenses.id, expenseId));
  } else {
    const type = source.costGroup === 'INVOICED_LIFT' ? 'LIFTING' : source.costGroup === 'INVOICED_DROP' ? 'LOWERING' : 'OTHER';
    const [expense] = await tx.insert(s.tripExpenses).values({ ...fields, tripId: source.tripId!, createdBy: actorId,
      expenseType: type, settlementMethod: 'COMPANY_DIRECT', approvalStatus: 'RECORDED',
      noInvoiceEvidenceTypes: source.photoStorageKeys.length > 0 ? ['RECEIPT'] : [],
    }).returning();
    expenseId = expense.id;
    const [linked] = await tx.update(s.expenseAccountingSources).set({ linkedTripExpenseId: expenseId }).where(eq(s.expenseAccountingSources.id, source.id)).returning();
    source = await hydrateExpenseAccountingSource(tx, linked);
  }
  if (expenseId) await propagateExpenseApproval(tx, { expenseId });
  return source;
}

/** Dispatch invokes this after linking the real trip and its source containers. */
export async function syncShipmentExpenseSources(tx: Tx, shipmentId: number, actorId: number) {
  const links = await tx.select().from(s.expenseAccountingSources).where(and(eq(s.expenseAccountingSources.shipmentId, shipmentId),
    eq(s.expenseAccountingSources.status, 'RECORDED'), isNull(s.expenseAccountingSources.tripId)));
  for (const link of links) {
    const before = await hydrateExpenseAccountingSource(tx, link);
    let after = await linkExpenseToRealTrip(tx, before);
    if (!after.tripId) continue;
    if (after.confirmedAt) after = await syncExpenseBillingSource(tx, after, actorId);
    const [updated] = await tx.update(s.expenseAccountingSources).set({ version: after.version + 1 }).where(eq(s.expenseAccountingSources.id, after.id)).returning();
    await auditExpenseChange(tx, { userId: actorId, role: Role.ACCOUNTANT }, before, await hydrateExpenseAccountingSource(tx, updated), 'Liên kết công việc thực tế khi phát lệnh');
  }
}

export async function confirmAccountingExpenses(tx: Tx, actor: ExpenseActor, entries: ExpenseSourceRef[]) {
  requireExpenseFinance(actor);
  const keys = entries.map(ref => `${ref.sourceKind}:${ref.sourceId}`);
  if (new Set(keys).size !== entries.length) throw new ApiError(400, 'Khoản chi bị chọn trùng.');
  const links = entries.length ? await tx.select().from(s.expenseAccountingSources).where(or(...entries.map(ref =>
    and(eq(s.expenseAccountingSources.sourceKind, ref.sourceKind), eq(s.expenseAccountingSources.sourceId, ref.sourceId))))) : [];
  const tripIds = links.map(l => l.tripId).filter((id): id is number => id != null);
  for (const [kind, table] of [['TRIP', s.tripExpenses], ['DRIVER', s.driverIncidentalCosts]] as const) {
    const ids = entries.filter(e => e.sourceKind === kind).map(e => e.sourceId);
    if (ids.length) tripIds.push(...(await tx.select({ tripId: table.tripId }).from(table).where(inArray(table.id, ids))).map(row => row.tripId));
  }
  const trips = tripIds.length ? await tx.select().from(s.trips).where(inArray(s.trips.id, tripIds)) : [];
  const pairIds = trips.map(t => t.activeTripPairId).filter((id): id is number => id != null);
  const pairs = pairIds.length ? await tx.select().from(s.tripPairs).where(inArray(s.tripPairs.id, pairIds)) : [];
  await lockTripFinancialAuthority(tx, [...tripIds, ...pairs.flatMap(p => [p.firstTripId, p.secondTripId])]);
  const result: ExpenseAccountingSource[] = [];
  for (const ref of [...entries].sort((a, b) => `${a.sourceKind}:${a.sourceId}`.localeCompare(`${b.sourceKind}:${b.sourceId}`))) {
    const before = await getExpenseForCommand(tx, actor, ref);
    await assertShipmentAccountingUnlocked(tx, before.shipmentId);
    if (before.paymentHistoryUnattributed) throw new ApiError(409, 'Lịch sử thu/chi chưa được phân bổ cho khoản chi cũ; không thể tạo nghĩa vụ thanh toán mới.');
    if (before.confirmedAt) throw new ApiError(409, `Khoản ${ref.sourceKind}-${ref.sourceId} đã đối chiếu.`);
    if (before.sourceKind === 'TRIP' && before.payableEntityType === 'FORWARDER') {
      const [legacySettlement] = await tx.select({ id: s.settlementExpenses.id }).from(s.settlementExpenses)
        .innerJoin(s.advanceSettlements, eq(s.advanceSettlements.id, s.settlementExpenses.settlementId))
        .where(and(eq(s.settlementExpenses.tripExpenseId, before.sourceId), notInArray(s.advanceSettlements.status, ['VOIDED', 'REVERSED']))).limit(1);
      if (legacySettlement) throw new ApiError(409, 'Khoản chi đã ghi nhận trong phiếu hoàn ứng hiện hành; không đối chiếu lại.');
    }
    if (!before.costGroup || before.customerChargeAmount == null || !before.payerKind) throw new ApiError(409, 'Hoàn thiện phân loại, người chi và khoản thu khách trước khi đối chiếu.');
    if (before.costGroup.startsWith('INVOICED_') && (!before.invoiceNumber || !before.invoiceDate)) throw new ApiError(409, 'Bổ sung số và ngày hóa đơn trước khi đối chiếu.');
    const [row] = await tx.update(s.expenseAccountingSources).set({ confirmedById: actor.userId, confirmedAt: new Date(),
      version: before.version + 1, updatedAt: new Date() }).where(eq(s.expenseAccountingSources.id, before.id)).returning();
    const after = await syncExpenseBillingSource(tx, await hydrateExpenseAccountingSource(tx, row), actor.userId);
    if ((after.sourceKind !== 'TRIP' || after.payableEntityType === 'FORWARDER') && after.payableEntityType && after.payableEntityId) {
      const amount = Number(after.amount);
      await LedgerService.postEntry(tx, { txnType: TxnType.VENDOR_EXPENSE, entityType: after.payableEntityType, entityId: after.payableEntityId,
        debit: after.payableEntityType === 'FORWARDER' ? amount : 0, credit: after.payableEntityType === 'FORWARDER' ? 0 : amount,
        receiptId: `EXPENSE_SOURCE:${after.id}`, txnId: after.id, note: `Chi phí ${after.feeName}` });
    }
    if (after.sourceKind === 'DRIVER' && after.tripId) await refreshExpenseTripCosts(tx, after.tripId);
    await auditExpenseChange(tx, actor, before, after, 'Đối chiếu chi phí');
    result.push(after);
  }
  return result;
}

export async function assignTruckAccountant(tx: Tx, actor: ExpenseActor, truckId: number, accountantId: number | null, expectedVersion: number) {
  requireExpenseFinance(actor);
  await lockApplicationOwnedUniqueness(tx, 'truck-accountant-assignment', [truckId]);
  const [truck] = await tx.select({ id: s.trucks.id }).from(s.trucks).where(eq(s.trucks.id, truckId));
  if (!truck) throw new ApiError(404, 'Không tìm thấy xe.');
  if (accountantId) {
    const user = await assertActiveExpensePayer(tx, accountantId);
    if (user.role !== Role.ACCOUNTANT) throw new ApiError(400, 'Chọn kế toán đang hoạt động.');
  }
  const [before] = await tx.select().from(s.truckAccountantAssignments).where(and(eq(s.truckAccountantAssignments.truckId, truckId), isNull(s.truckAccountantAssignments.endedAt))).for('update');
  if ((before?.version ?? 0) !== expectedVersion) throw new ApiError(409, 'Phân công xe vừa thay đổi.');
  if (before) await tx.update(s.truckAccountantAssignments).set({ endedAt: new Date() }).where(eq(s.truckAccountantAssignments.id, before.id));
  const [after] = await tx.insert(s.truckAccountantAssignments).values({ truckId, accountantId, version: expectedVersion + 1, assignedById: actor.userId }).returning();
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'TRUCK_ACCOUNTANT_ASSIGNED', entityType: 'truck_accountant_assignment', entityId: after.id, payload: { before: before ?? null, after } });
  return after;
}
