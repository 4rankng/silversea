/**
 * Ops settlement batches (đề nghị thanh toán — docs/prd/OpsVanHanh.md §5.4):
 * freeze the creator's open PENDING+APPROVED cash expenses into one numbered
 * batch accounting reviews and closes.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { ApiError } from '../errors';
import { groupOpsExpensesForSettlement } from './ops-expenses.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function generateOpsSettlementCode(tx: Tx, now: Date = new Date()): Promise<string> {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `OS-${yy}${mm}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6301, hashtext(${prefix}))`);
  const [row] = await tx
    .select({ maxCode: sql<string | null>`max(${s.opsSettlements.code})` })
    .from(s.opsSettlements)
    .where(sql`${s.opsSettlements.code} like ${prefix + '%'}`);
  let seq = 1;
  if (row?.maxCode) {
    seq = parseInt(row.maxCode.split('-').pop() || '0', 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(4, '0')}`;
}

/**
 * Freeze every open PENDING+APPROVED entry of the caller into a new batch.
 * The per-user advisory lock serializes concurrent creators; the row lock +
 * re-filter inside the transaction is the actual freeze authority.
 */
export async function createOpsSettlement(
  userId: number,
  note?: string | null,
  transaction?: Tx,
) {
  const run = async (tx: Tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(6302, ${userId})`);

    const entries = await tx
      .select({ id: s.opsExpenseEntries.id, amount: s.opsExpenseEntries.amount })
      .from(s.opsExpenseEntries)
      .where(and(
        eq(s.opsExpenseEntries.paidById, userId),
        isNull(s.opsExpenseEntries.opsSettlementId),
        inArray(s.opsExpenseEntries.approvalStatus, ['PENDING', 'APPROVED']),
      ))
      .for('update');
    if (entries.length === 0) {
      throw new ApiError(400, 'Không có khoản chi nào đang mở để lập đề nghị thanh toán.');
    }

    const total = entries.reduce((acc, entry) => acc + BigInt(entry.amount), 0n);
    const code = await generateOpsSettlementCode(tx);
    const [settlement] = await tx
      .insert(s.opsSettlements)
      .values({
        code,
        opsUserId: userId,
        totalAmount: total.toString(),
        note: note?.trim() || null,
      })
      .returning();
    await tx
      .update(s.opsExpenseEntries)
      .set({ opsSettlementId: settlement.id, updatedAt: new Date() })
      .where(inArray(
        s.opsExpenseEntries.id,
        entries.map((entry) => entry.id),
      ));
    return settlement;
  };
  return transaction ? run(transaction) : db.transaction(run);
}

export async function listOpsSettlements(filters: {
  opsUserId?: number;
  status?: 'PENDING' | 'APPROVED' | 'REJECTED';
  limit?: number;
}) {
  const conditions = [];
  if (filters.opsUserId != null) conditions.push(eq(s.opsSettlements.opsUserId, filters.opsUserId));
  if (filters.status) conditions.push(eq(s.opsSettlements.status, filters.status));
  return db
    .select({
      id: s.opsSettlements.id,
      code: s.opsSettlements.code,
      status: s.opsSettlements.status,
      totalAmount: s.opsSettlements.totalAmount,
      note: s.opsSettlements.note,
      createdAt: s.opsSettlements.createdAt,
      approvedAt: s.opsSettlements.approvedAt,
      opsUserId: s.opsSettlements.opsUserId,
      opsUserName: s.users.fullName,
    })
    .from(s.opsSettlements)
    .leftJoin(s.users, eq(s.users.id, s.opsSettlements.opsUserId))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(s.opsSettlements.id))
    .limit(filters.limit ?? 50);
}

export interface OpsSettlementDetail {
  settlement: {
    id: number;
    code: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    totalAmount: string;
    note: string | null;
    createdAt: string;
    approvedAt: string | null;
    opsUserId: number;
    opsUserName: string | null;
  };
  grouping: ReturnType<typeof groupOpsExpensesForSettlement>;
}

export async function getOpsSettlementDetail(
  settlementId: number,
): Promise<OpsSettlementDetail> {
  const [settlement] = await db
    .select({
      id: s.opsSettlements.id,
      code: s.opsSettlements.code,
      status: s.opsSettlements.status,
      totalAmount: s.opsSettlements.totalAmount,
      note: s.opsSettlements.note,
      createdAt: s.opsSettlements.createdAt,
      approvedAt: s.opsSettlements.approvedAt,
      opsUserId: s.opsSettlements.opsUserId,
      opsUserName: s.users.fullName,
    })
    .from(s.opsSettlements)
    .leftJoin(s.users, eq(s.users.id, s.opsSettlements.opsUserId))
    .where(eq(s.opsSettlements.id, settlementId))
    .limit(1);
  if (!settlement) throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');

  const entries = await db
    .select({
      id: s.opsExpenseEntries.id,
      shipmentId: s.opsExpenseEntries.shipmentId,
      shipmentCode: s.shipments.shipmentCode,
      customerName: s.customers.name,
      billRef: sql<string | null>`case when ${s.shipments.tradeDirection} = 'IMPORT'
        then ${s.shipments.blNumber} else ${s.shipments.bookingRef} end`,
      containerNumber: s.shipmentContainers.containerNumber,
      expenseTypeName: s.forwarderExpenseTypes.name,
      requiresInvoice: s.forwarderExpenseTypes.requiresInvoice,
      amount: s.opsExpenseEntries.amount,
      approvalStatus: s.opsExpenseEntries.approvalStatus,
    })
    .from(s.opsExpenseEntries)
    .leftJoin(s.shipments, eq(s.shipments.id, s.opsExpenseEntries.shipmentId))
    .leftJoin(s.customers, eq(s.customers.id, s.shipments.customerId))
    .leftJoin(
      s.shipmentContainers,
      eq(s.shipmentContainers.id, s.opsExpenseEntries.shipmentContainerId),
    )
    .leftJoin(
      s.forwarderExpenseTypes,
      eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode),
    )
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId))
    .orderBy(s.opsExpenseEntries.id);

  return {
    settlement: {
      ...settlement,
      createdAt: settlement.createdAt.toISOString(),
      approvedAt: settlement.approvedAt ? settlement.approvedAt.toISOString() : null,
    },
    grouping: groupOpsExpensesForSettlement(entries),
  };
}

/**
 * Accounting closes a batch: APPROVED only when every frozen entry is approved;
 * REJECTED unlinks all entries (they return to the open pool for the next
 * batch) and requires a reason.
 */
export async function decideOpsSettlement(
  approverId: number,
  settlementId: number,
  decision: 'APPROVED' | 'REJECTED',
  reason?: string,
  transaction?: Tx,
) {
  const [settlement] = await db
    .select()
    .from(s.opsSettlements)
    .where(eq(s.opsSettlements.id, settlementId))
    .limit(1);
  if (!settlement) throw new ApiError(404, 'Không tìm thấy đề nghị thanh toán.');
  if (settlement.status !== 'PENDING') {
    throw new ApiError(400, 'Phiếu đã được xử lý.');
  }

  if (decision === 'APPROVED') {
    const [pending] = await db
      .select({ id: s.opsExpenseEntries.id })
      .from(s.opsExpenseEntries)
      .where(and(
        eq(s.opsExpenseEntries.opsSettlementId, settlementId),
        eq(s.opsExpenseEntries.approvalStatus, 'PENDING'),
      ))
      .limit(1);
    if (pending) {
      throw new ApiError(400, 'Còn khoản chi chưa được duyệt trong phiếu này.');
    }
    const [updated] = await db
      .update(s.opsSettlements)
      .set({
        status: 'APPROVED',
        approvedById: approverId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      // Conditional write: a concurrent decision on the same batch cannot
      // double-apply.
      .where(and(
        eq(s.opsSettlements.id, settlementId),
        eq(s.opsSettlements.status, 'PENDING'),
      ))
      .returning();
    if (!updated) throw new ApiError(400, 'Phiếu đã được xử lý.');
    return updated;
  }

  const trimmed = reason?.trim();
  if (!trimmed) throw new ApiError(400, 'Cần lý do từ chối.');

  const run = async (tx: Tx) => {
    const [updated] = await tx
      .update(s.opsSettlements)
      .set({ status: 'REJECTED', rejectionReason: trimmed, updatedAt: new Date() })
      .where(and(
        eq(s.opsSettlements.id, settlementId),
        eq(s.opsSettlements.status, 'PENDING'),
      ))
      .returning();
    if (!updated) throw new ApiError(400, 'Phiếu đã được xử lý.');
    // Rejected batch: every frozen entry returns to the open pool for the
    // next batch (PRD §5.4 "khoản rơi khỏi phiếu").
    await tx
      .update(s.opsExpenseEntries)
      .set({ opsSettlementId: null, updatedAt: new Date() })
      .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId));
    return updated;
  };
  return transaction ? run(transaction) : db.transaction(run);
}
