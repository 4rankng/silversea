/**
 * Ops settlement batches (phiếu quyết toán — docs/prd/OpsVanHanh.md §5.4):
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
        inArray(s.opsExpenseEntries.approvalStatus, ['RECORDED', 'APPROVED']),
      ))
      .for('update');
    if (entries.length === 0) {
      throw new ApiError(400, 'Không có khoản chi nào đang mở để lập phiếu quyết toán.');
    }

    await assertOpsSettlementEvidence(tx, entries.map((entry) => entry.id));

    const total = entries.reduce((acc, entry) => acc + BigInt(entry.amount), 0n);
    const code = await generateOpsSettlementCode(tx);
    const [settlement] = await tx
      .insert(s.opsSettlements)
      .values({
        code,
        opsUserId: userId,
        status: 'RECORDED',
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
  status?: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
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
    status: 'DRAFT' | 'RECORDED' | 'VOIDED' | 'PENDING' | 'APPROVED' | 'REJECTED';
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
  if (!settlement) throw new ApiError(404, 'Không tìm thấy phiếu quyết toán.');

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

/** A settlement records reconciliation, never an unperformed payment. */
async function assertOpsSettlementEvidence(tx: Tx, expenseIds: number[]) {
  if (expenseIds.length === 0) throw new ApiError(400, 'Phiếu không có khoản chi.');
  const rows = await tx.select({ id: s.opsExpenseEntries.id, requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
    .from(s.opsExpenseEntries)
    .leftJoin(s.forwarderExpenseTypes, eq(s.forwarderExpenseTypes.code, s.opsExpenseEntries.expenseTypeCode))
    .where(inArray(s.opsExpenseEntries.id, expenseIds));
  const photos = await tx.select({ id: s.opsExpensePhotos.opsExpenseId }).from(s.opsExpensePhotos)
    .where(inArray(s.opsExpensePhotos.opsExpenseId, expenseIds));
  const documented = new Set(photos.map((photo) => photo.id));
  const missing = rows.filter((row) => row.requiresInvoice && !documented.has(row.id));
  if (missing.length) throw new ApiError(400, `Bổ sung chứng từ cho ${missing.length} khoản chi trước khi quyết toán.`);
}

export async function finalizeOpsSettlement(userId: number, settlementId: number, transaction?: Tx) {
  const run = async (tx: Tx) => {
    const [settlement] = await tx.select().from(s.opsSettlements)
      .where(and(eq(s.opsSettlements.id, settlementId), eq(s.opsSettlements.opsUserId, userId)))
      .for('update');
    if (!settlement) throw new ApiError(404, 'Không tìm thấy phiếu quyết toán.');
    if (settlement.status !== 'DRAFT' && settlement.status !== 'PENDING') throw new ApiError(409, 'Phiếu đã được ghi nhận hoặc đã hủy.');
    const entries = await tx.select({ id: s.opsExpenseEntries.id, amount: s.opsExpenseEntries.amount, status: s.opsExpenseEntries.approvalStatus })
      .from(s.opsExpenseEntries).where(eq(s.opsExpenseEntries.opsSettlementId, settlementId)).for('update');
    if (!entries.length) throw new ApiError(400, 'Phiếu không có khoản chi để quyết toán.');
    if (entries.some((entry) => entry.status !== 'RECORDED' && entry.status !== 'APPROVED')) throw new ApiError(400, 'Phiếu còn khoản chi chưa ghi nhận hợp lệ.');
    await assertOpsSettlementEvidence(tx, entries.map((entry) => entry.id));
    const total = entries.reduce((sum, entry) => sum + BigInt(entry.amount), 0n);
    const [recorded] = await tx.update(s.opsSettlements).set({ status: 'RECORDED', totalAmount: total.toString(), updatedAt: new Date() })
      .where(eq(s.opsSettlements.id, settlementId)).returning();
    await tx.insert(s.auditLogs).values({ userId, entityType: 'ops-settlements', entityId: settlementId, message: 'Ghi nhận phiếu quyết toán trực tiếp', payload: { beforeStatus: settlement.status, status: 'RECORDED' } });
    return recorded;
  };
  return transaction ? run(transaction) : db.transaction(run);
}

/** Release a historical incomplete batch so its owner can correct evidence and recreate it. */
export async function reopenOpsSettlementDraft(userId: number, settlementId: number, tx: Tx) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(6302, ${userId})`);
  const [settlement] = await tx.select().from(s.opsSettlements)
    .where(and(eq(s.opsSettlements.id, settlementId), eq(s.opsSettlements.opsUserId, userId))).for('update');
  if (!settlement) throw new ApiError(404, 'Không tìm thấy phiếu quyết toán.');
  if (!['DRAFT', 'PENDING'].includes(settlement.status)) throw new ApiError(409, 'Chỉ phiếu nháp chưa ghi nhận được mở để bổ sung.');
  const entries = await tx.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId)).for('update');
  await tx.update(s.opsExpenseEntries).set({ opsSettlementId: null, updatedAt: new Date() })
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId));
  const [result] = await tx.update(s.opsSettlements).set({ status: 'VOIDED', updatedAt: new Date() })
    .where(eq(s.opsSettlements.id, settlementId)).returning();
  await tx.insert(s.auditLogs).values({ userId, entityType: 'ops-settlements', entityId: settlementId,
    message: 'Mở khoản chi trong phiếu nháp để bổ sung', payload: { beforeStatus: settlement.status, status: 'VOIDED', releasedExpenseIds: entries.map(row => row.id), totalAmount: settlement.totalAmount } });
  return result;
}
