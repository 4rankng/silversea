import { hydrateExpenseCashVoucher } from './expense-cash-voucher-source.service';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { TxnType, type ExpenseVoucherInput } from '@tingting/shared';
import { lockExpenseCashSources } from './expense-cash-lock.service';
import { expenseVoucherCode } from './expense-cash-command.service';
import type { GovernanceActionRow } from './governance-action-core.service';
import * as s from '../db/schema';
import type { Tx } from './trip-shared';
import { ApiError } from '../errors';
import { LedgerService } from './ledger.service';
import { assertTreasuryFundAssigned, assertVoucherFundMatches, resolveTreasuryPaymentContract, insertTreasuryMovement, appendTreasuryReversal } from './treasury.service';
import { getExpenseForCommand, requireExpenseFinance, type ExpenseActor } from './expense-accounting-write.service';
import { lockApplicationOwnedUniqueness } from './application-owned-uniqueness.service';
import { recordPaymentReceiptTx } from './payment-allocation.service';
import { allocateExpenseReceipt, reverseExpenseReceipt } from './expense-receipt-allocation.service';
import { recordDriverPayoutTx, recordVendorPaymentTx, recordOpsReimbursementTx } from './financial.service';
import { hydrateExpenseAccountingSource, type ExpenseAccountingSource } from './expense-accounting-source.service';

/** Card 20260927_147 — the per-source form is a 3-table join filtered by ONE source id,
 *  so a selection that reads it per row pays one query per row. This is the same join with
 *  `inArray`, grouped in memory: every requested id gets `{IN, OUT}`, zeroed when it has no
 *  recorded allocation, which is exactly what `getExpenseCashTotals` returned for it. */
export async function getExpenseCashTotalsBatch(tx: Tx, sourceIds: number[]): Promise<Map<number, { IN: number; OUT: number }>> {
  const totalsBySourceId = new Map<number, { IN: number; OUT: number }>();
  for (const sourceId of new Set(sourceIds)) totalsBySourceId.set(sourceId, { IN: 0, OUT: 0 });
  if (totalsBySourceId.size === 0) return totalsBySourceId;
  const rows = await tx.select({
    sourceId: s.expenseCashAllocations.expenseAccountingSourceId,
    direction: s.treasuryMovements.direction,
    amount: s.expenseCashAllocations.amount,
  })
    .from(s.expenseCashAllocations).innerJoin(s.expenseCashVouchers, eq(s.expenseCashVouchers.id, s.expenseCashAllocations.voucherId))
    .innerJoin(s.treasuryMovements, eq(s.treasuryMovements.id, s.expenseCashVouchers.treasuryMovementId))
    .where(and(inArray(s.expenseCashAllocations.expenseAccountingSourceId, [...totalsBySourceId.keys()]),
      eq(s.expenseCashVouchers.status, 'RECORDED')));
  for (const row of rows) {
    const totals = totalsBySourceId.get(row.sourceId);
    if (totals) totals[row.direction as 'IN' | 'OUT'] += Number(row.amount);
  }
  return totalsBySourceId;
}

/** Single-source form keeps the shared domain name: three call sites read one source's cash
 *  totals and must stay on the same join/filter as the batch form above. */
export async function getExpenseCashTotals(tx: Tx, sourceId: number) {
  return (await getExpenseCashTotalsBatch(tx, [sourceId])).get(sourceId)!;
}

export async function createExpenseVoucher(tx: Tx, actor: ExpenseActor, input: ExpenseVoucherInput, recordedAction?: GovernanceActionRow) {
  requireExpenseFinance(actor);
  const code = expenseVoucherCode(input);
  if (recordedAction) {
    const [existing] = await tx.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.code, code));
    if (existing) {
      const links = await tx.select({ kind: s.expenseAccountingSources.sourceKind, id: s.expenseAccountingSources.sourceId, version: s.expenseCashAllocations.sourceVersion, amount: s.expenseCashAllocations.amount })
        .from(s.expenseCashAllocations).innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
        .where(eq(s.expenseCashAllocations.voucherId, existing.id));
      if (existing.createdById !== actor.userId || links.length !== input.entries.length || input.entries.some(ref => !links.some(link => link.kind === ref.sourceKind && link.id === ref.sourceId && link.version === ref.expectedVersion && Number(link.amount) === ref.amount))) {
        throw new ApiError(409, 'Giao dịch đã có phân bổ chi phí khác.');
      }
      return hydrateExpenseCashVoucher(tx, existing);
    }
  }
  // Card 20260929_211 — the per-source cash totals used to be read INSIDE the
  // loop, one query per voucher line. lockExpenseCashSources has just resolved
  // every source row (and locked it, in the order it always did), so the ids
  // are already in hand: read every total in ONE query here, before the loop.
  //
  // This is deliberately a pure pre-read. The loop below keeps its exact shape,
  // its exact order and its exact 409/400 sequence — nothing about WHEN a
  // refusal fires moves, which is the one thing this refactor must not change.
  const linkedIds = await lockExpenseCashSources(tx, input.entries);
  const cashTotals = await getExpenseCashTotalsBatch(tx, [...linkedIds.values()]);
  const keys = input.entries.map(e => `${e.sourceKind}:${e.sourceId}`);
  if (new Set(keys).size !== keys.length) throw new ApiError(400, 'Không chọn trùng nguồn chi phí.');
  const items: Array<{ source: ExpenseAccountingSource; amount: number }> = [];
  // Approval-precedes-payment (case QA-2026-09-24-01): every source in a cash
  // voucher must be accountant-approved. Refusals list the offending rows by
  // fee name — never a bare kind-id.
  const unapproved: string[] = [];
  for (const ref of [...input.entries].sort((a, b) => `${a.sourceKind}:${a.sourceId}`.localeCompare(`${b.sourceKind}:${b.sourceId}`))) {
    const source = await getExpenseForCommand(tx, actor, ref);
    if (source.paymentHistoryUnattributed) throw new ApiError(409, 'Lịch sử thu/chi chưa được phân bổ cho khoản chi cũ; không được đoán số tiền còn lại.');
    if (!source.confirmedAt) { unapproved.push(source.feeName || `khoản ${ref.sourceKind}`); continue; }
    if (input.direction === 'OUT' && (!source.payableEntityType || !source.payableEntityId)) throw new ApiError(409, 'Khoản công ty trả trực tiếp không phải tiền hoàn cho người khai báo.');
    if (input.direction === 'OUT' && source.payableEntityType === 'FORWARDER' && !source.reconciliationId) throw new ApiError(409, 'Lập bảng hoàn ứng trước để trừ đúng tiền ứng đã nhận.');
    const cash = cashTotals.get(source.id) ?? await getExpenseCashTotals(tx, source.id);
    const remaining = input.direction === 'IN' ? Number(source.customerChargeAmount ?? 0) - cash.IN
      : Number(source.amount) - Number(source.allocatedAdvanceAmount) - cash.OUT;
    if (!Number.isSafeInteger(ref.amount) || ref.amount <= 0 || ref.amount > remaining) throw new ApiError(409, `Khoản ${ref.sourceKind}-${ref.sourceId} chỉ còn ${remaining}đ.`);
    items.push({ source, amount: ref.amount });
  }
  if (unapproved.length > 0) throw new ApiError(409, `Các khoản chưa được duyệt: ${[...new Set(unapproved)].join(', ')}`);
  const first = items[0].source;
  const entityType = input.direction === 'IN' ? 'CUSTOMER' : first.payableEntityType!;
  const entityId = input.direction === 'IN' ? first.customerId : first.payableEntityId!;
  if (items.some(({ source }) => input.direction === 'IN' ? source.customerId !== entityId
    : source.payableEntityType !== entityType || source.payableEntityId !== entityId)) throw new ApiError(400, 'Mỗi phiếu chỉ dành cho một đối tượng và một chiều thu/chi.');
  const amount = items.reduce((total, item) => total + item.amount, 0);
  if (!Number.isSafeInteger(amount) || amount > 999_999_999_999_999) throw new ApiError(400, 'Tổng phiếu vượt giới hạn.');
  await assertTreasuryFundAssigned(tx, input.treasuryAccountId);
  // Card 20260928_167 criterion 2 — a voucher must not mix funds, and the fund
  // must be the one the cost lines actually require. Callers normally send one
  // cost group per voucher, so this is usually a no-op; it earns its keep when
  // a UI "select all" mixes an invoiced chi-hộ row with a driver road fee.
  await assertVoucherFundMatches(tx, input.treasuryAccountId,
    items.map((i) => ({ costGroup: i.source.costGroup, feeName: i.source.feeName })));
  const treasury = await resolveTreasuryPaymentContract(tx, input, new Date());
  if (!treasury.treasuryAccountId || !treasury.valueDate || !treasury.physicalReference) throw new ApiError(400, 'Chọn quỹ, ngày và mã giao dịch thực tế.');
  await lockApplicationOwnedUniqueness(tx, 'expense-voucher-physical', [treasury.treasuryAccountId, input.direction, treasury.physicalReference]);
  let ledgerEntryId: number;
  let paymentReceiptId: number | null = null;
  let allocationBySource = new Map<number, number>();
  let movement: typeof s.treasuryMovements.$inferSelect;
  if (recordedAction) {
    ledgerEntryId = recordedAction.ledgerEntryId ?? Number(recordedAction.applicationResult?.ledgerId);
    paymentReceiptId = input.direction === 'IN' ? Number(recordedAction.applicationResult?.paymentReceiptId) : null;
    if (!Number.isInteger(ledgerEntryId) || (input.direction === 'IN' && !Number.isInteger(paymentReceiptId))) throw new ApiError(409, 'Thiếu nguồn tiền chuẩn để phân bổ.');
    const [original] = await tx.select().from(s.ledger).where(eq(s.ledger.id, ledgerEntryId));
    if (!original || original.entityType !== entityType || original.entityId !== entityId) throw new ApiError(409, 'Nguồn tiền không đúng đối tượng.');
    [movement] = await tx.select().from(s.treasuryMovements).where(paymentReceiptId ? eq(s.treasuryMovements.paymentReceiptId, paymentReceiptId) : eq(s.treasuryMovements.ledgerEntryId, ledgerEntryId));
    if (!movement || movement.direction !== input.direction || Number(movement.amount) !== amount || movement.treasuryAccountId !== treasury.treasuryAccountId || movement.physicalReference !== treasury.physicalReference) throw new ApiError(409, 'Nguồn tiền không khớp nội dung phiếu.');
    if (paymentReceiptId) allocationBySource = await allocateExpenseReceipt(tx, paymentReceiptId, items, actor.userId);
  } else if (input.direction === 'IN') {
    const receipt = await recordPaymentReceiptTx(tx, { customerId: entityId, receiptId: code, amount,
      allocatedBy: actor.userId, unappliedOnly: true, treasuryAccountId: treasury.treasuryAccountId,
      valueDate: treasury.valueDate, physicalReference: treasury.physicalReference });
    paymentReceiptId = receipt.id;
    allocationBySource = await allocateExpenseReceipt(tx, receipt.id, items, actor.userId);
    const [ledger] = await tx.select().from(s.ledger).where(and(eq(s.ledger.receiptId, receipt.receiptId),
      eq(s.ledger.entityType, 'CUSTOMER'), eq(s.ledger.entityId, entityId), eq(s.ledger.txnType, TxnType.PAYMENT_RECEIVED)));
    if (!ledger) throw new ApiError(409, 'Phiếu thu thiếu bút toán gốc.');
    ledgerEntryId = ledger.id;
    [movement] = await tx.select().from(s.treasuryMovements).where(eq(s.treasuryMovements.paymentReceiptId, receipt.id));
  } else {
    if (!['DRIVER', 'VENDOR', 'FORWARDER'].includes(entityType)) throw new ApiError(409, 'Khoản chi không có nguồn phải trả được hỗ trợ.');
    const common = { supplierId: entityId, amount: String(amount), receiptId: code, date: input.valueDate, note: input.note };
    const [account] = await tx.select({ type: s.treasuryAccounts.type }).from(s.treasuryAccounts).where(eq(s.treasuryAccounts.id, treasury.treasuryAccountId));
    const ledger = entityType === 'DRIVER'
      ? await recordDriverPayoutTx(tx, { driverId: entityId, amount, receiptId: code, payoutDate: input.valueDate, note: input.note, method: account.type === 'BANK' ? 'BANK' : 'CASH' })
      : entityType === 'VENDOR' ? await recordVendorPaymentTx(tx, common)
      : await recordOpsReimbursementTx(tx, { opsUserId: entityId, amount, receiptId: code, date: input.valueDate, note: input.note });
    ledgerEntryId = ledger.id;
    movement = await insertTreasuryMovement(tx, { treasuryAccountId: treasury.treasuryAccountId, direction: 'OUT',
      amount, valueDate: treasury.valueDate, physicalReference: treasury.physicalReference, ledgerEntryId,
      sourceVersion: ledger.id, paymentContractVersion: 2, createdBy: actor.userId });
  }
  const [voucher] = await tx.insert(s.expenseCashVouchers).values({ code, counterpartyType: entityType,
    counterpartyId: entityId, paymentReceiptId, treasuryMovementId: movement.id, createdById: actor.userId, note: input.note }).returning();
  await tx.insert(s.expenseCashAllocations).values(items.map(({ source, amount: allocated }) => ({ voucherId: voucher.id,
    expenseAccountingSourceId: source.id, sourceVersion: source.version, amount: String(allocated), paymentAllocationId: allocationBySource.get(source.id) ?? null })));
  await tx.update(s.expenseAccountingSources).set({ version: sql`${s.expenseAccountingSources.version} + 1`, updatedAt: new Date() })
    .where(inArray(s.expenseAccountingSources.id, items.map(i => i.source.id)));
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_VOUCHER_RECORDED', entityType: 'expense_cash_voucher', entityId: voucher.id,
    payload: { voucher, entries: items.map(({ source, amount: allocated }) => ({ sourceId: source.id, beforeVersion: source.version, amount: allocated })), treasuryMovementId: movement.id } });
  return hydrateExpenseCashVoucher(tx, voucher);
}

export async function reverseExpenseVoucher(tx: Tx, actor: ExpenseActor, id: number, input: { expectedVersion: number; reason: string; valueDate: string; physicalReference: string }) {
  requireExpenseFinance(actor);
  const sourceRefs = await tx.select({ sourceKind: s.expenseAccountingSources.sourceKind, sourceId: s.expenseAccountingSources.sourceId }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
    .where(eq(s.expenseCashAllocations.voucherId, id));
  await lockExpenseCashSources(tx, sourceRefs);
  await lockApplicationOwnedUniqueness(tx, 'expense-voucher', [id]);
  const [stored] = await tx.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, id)).for('update');
  if (!stored) throw new ApiError(404, 'Không tìm thấy phiếu.');
  const voucher = await hydrateExpenseCashVoucher(tx, stored);
  if (voucher.version !== input.expectedVersion || voucher.status !== 'RECORDED') throw new ApiError(409, 'Phiếu đã thay đổi hoặc đã đảo.');
  const sources = await tx.select({ source: s.expenseAccountingSources }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
    .where(eq(s.expenseCashAllocations.voucherId, id));

  await resolveTreasuryPaymentContract(tx, { treasuryAccountId: voucher.treasuryAccountId, valueDate: input.valueDate, physicalReference: input.physicalReference }, new Date());
  const [originalLedger] = await tx.select().from(s.ledger).where(eq(s.ledger.id, voucher.ledgerEntryId));
  if (!originalLedger || !voucher.treasuryMovementId) throw new ApiError(409, 'Thiếu liên kết giao dịch gốc; cần đối soát.');
  if (voucher.paymentReceiptId) {
    await reverseExpenseReceipt(tx, voucher.paymentReceiptId, actor.userId, input);
  } else {
    const reversal = await LedgerService.postEntry(tx, { txnType: TxnType.ADJUSTMENT,
      entityType: originalLedger.entityType as 'CUSTOMER' | 'DRIVER' | 'VENDOR' | 'FORWARDER' | 'CARRIER', entityId: originalLedger.entityId,
      debit: Number(originalLedger.credit), credit: Number(originalLedger.debit), receiptId: `REV-${voucher.code}`,
      note: input.reason, timestamp: new Date(`${input.valueDate}T00:00:00+07:00`) });
    await appendTreasuryReversal(tx, { originalMovementId: voucher.treasuryMovementId, amount: Number(voucher.amount), valueDate: input.valueDate,
      sourceVersion: voucher.version + 1, physicalReference: input.physicalReference, createdBy: actor.userId, ledgerEntryId: reversal.id });
  }
  const [after] = await tx.update(s.expenseCashVouchers).set({ status: 'REVERSED', version: voucher.version + 1,
    reversedById: actor.userId, reversalReason: input.reason }).where(eq(s.expenseCashVouchers.id, id)).returning();
  if (sources.length) await tx.update(s.expenseAccountingSources).set({ version: sql`${s.expenseAccountingSources.version} + 1`, updatedAt: new Date() }).where(inArray(s.expenseAccountingSources.id, sources.map(r => r.source.id)));
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_VOUCHER_REVERSED', entityType: 'expense_cash_voucher', entityId: id, payload: { before: voucher, after, reason: input.reason } });
  return after;
}

export async function allocateOutstandingExpenseVoucher(tx: Tx, actor: ExpenseActor, id: number, expectedVersion: number) {
  requireExpenseFinance(actor);
  const sourceRefs = await tx.select({ sourceKind: s.expenseAccountingSources.sourceKind, sourceId: s.expenseAccountingSources.sourceId }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
    .where(eq(s.expenseCashAllocations.voucherId, id));
  await lockExpenseCashSources(tx, sourceRefs);
  await lockApplicationOwnedUniqueness(tx, 'expense-voucher', [id]);
  const [voucher] = await tx.select().from(s.expenseCashVouchers).where(eq(s.expenseCashVouchers.id, id)).for('update');
  if (!voucher || !voucher.paymentReceiptId || voucher.status !== 'RECORDED' || voucher.version !== expectedVersion) {
    throw new ApiError(409, 'Phiếu đã thay đổi hoặc không có tiền khách chưa phân bổ.');
  }
  const links = await tx.select({ allocation: s.expenseCashAllocations, source: s.expenseAccountingSources }).from(s.expenseCashAllocations)
    .innerJoin(s.expenseAccountingSources, eq(s.expenseAccountingSources.id, s.expenseCashAllocations.expenseAccountingSourceId))
    .where(and(eq(s.expenseCashAllocations.voucherId, id), sql`${s.expenseCashAllocations.paymentAllocationId} is null`));
  const items = [];
  for (const link of links) items.push({ source: await hydrateExpenseAccountingSource(tx, link.source), amount: Number(link.allocation.amount) });
  const assignments = await allocateExpenseReceipt(tx, voucher.paymentReceiptId, items, actor.userId);
  if (!assignments.size) throw new ApiError(409, 'Chưa có công nợ chuyến/chứng từ để phân bổ. Tiền đã nhận vẫn được giữ trên phiếu thu.');
  for (const [sourceId, paymentAllocationId] of assignments) {
    await tx.update(s.expenseCashAllocations).set({ paymentAllocationId }).where(and(eq(s.expenseCashAllocations.voucherId, id), eq(s.expenseCashAllocations.expenseAccountingSourceId, sourceId)));
  }
  await tx.update(s.expenseCashVouchers).set({ version: voucher.version + 1 }).where(eq(s.expenseCashVouchers.id, id));
  await tx.insert(s.auditLogs).values({ userId: actor.userId, message: 'EXPENSE_RECEIPT_ALLOCATED', entityType: 'expense_cash_voucher', entityId: id,
    payload: { paymentReceiptId: voucher.paymentReceiptId, sourceIds: [...assignments.keys()], cashMovement: false } });
}
