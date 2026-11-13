/**
 * Ops settlement batches (phiếu quyết toán — docs/prd/OpsVanHanh.docx §5.4):
 * freeze the creator's open PENDING+APPROVED cash expenses into one numbered
 * batch accounting reviews and closes.
 */
import { db } from '../db';
import * as s from '../db/schema';
import { acquireAdvisoryLock, lockKeys } from './advisory-lock.service';
import { and, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { ApiError } from '../errors';
import { groupOpsExpensesForSettlement } from './ops-expenses.service';
import { loadLotContainerIdentities, withLotIdentity } from './settlement-lot-identity.service';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** SIL-751 r4 (QA 09/11, staging e6db602f) — the phiếu header is the sum of
 *  ITS LINES under the card-197 law, derived at read time; the stored
 *  `ops_settlements.total_amount` column is write-time state that can go
 *  stale (OS-2611-0005 printed a stored 1.080.000₫ over lines that sum
 *  1.070.000₫ after an accountant amount edit). Every phiếu list reader
 *  projects its header through this one SQL fragment — the query-level
 *  `sumExcludingNegative` (strictly negative dropped, 0 kept, money never
 *  leaves `numeric`) — so no surface can print the stored column again. */
export const opsSettlementTotalFromLinesSql = (): SQL<string> =>
  sql<string>`coalesce((select sum(${s.opsExpenseEntries.amount}) filter (where ${s.opsExpenseEntries.amount} >= 0)
    from ${s.opsExpenseEntries}
    where ${s.opsExpenseEntries.opsSettlementId} = ${s.opsSettlements.id}), '0')`;

/** SIL-751 — the ONE writer-side recompute: any mutation of a phiếu's linked
 *  entries (unlink on reject, accountant amount edit) re-derives the stored
 *  header from its lines inside the caller's transaction. Moved here from
 *  ops-expenses.service.ts — the settlement's stored total belongs to the
 *  settlement's own service, and the accountant edit path
 *  (expense-accounting-write) now calls it through this import without a
 *  cycle. Same SQL law as `opsSettlementTotalFromLinesSql`. */
export async function recomputeOpsSettlementTotal(
  tx: Tx,
  settlementId: number,
): Promise<void> {
  const [row] = await tx
    .select({ total: sql<string>`coalesce(sum(${s.opsExpenseEntries.amount}) filter (where ${s.opsExpenseEntries.amount} >= 0), 0)` })
    .from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId));
  await tx
    .update(s.opsSettlements)
    .set({ totalAmount: (row?.total ?? '0').toString(), updatedAt: new Date() })
    .where(eq(s.opsSettlements.id, settlementId));
}

/** Card 20260928_197 — the frozen-batch total carries the `sumExcludingNegative`
 *  rule: a strictly negative entry is dropped from `totalAmount`, never netted
 *  against the positive entries. Integer VND, so the skip is expressed in
 *  BigInt (no float ever touches the money) with the same ">= 0" predicate the
 *  shared helper uses. Exported (SIL-751 r4): every phiếu reader derives the
 *  header from its lines through this one implementation, so a stored header
 *  can never disagree with the lines it froze. */
export function sumOpsAmounts(entries: ReadonlyArray<{ amount: string }>): bigint {
  return entries.reduce((acc, entry) => {
    const amount = BigInt(entry.amount);
    return amount < 0n ? acc : acc + amount;
  }, 0n);
}

async function generateOpsSettlementCode(tx: Tx, now: Date = new Date()): Promise<string> {
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `OS-${yy}${mm}`;
  await acquireAdvisoryLock(tx, lockKeys.opsSettlementCodePrefix(prefix));
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
 * Freeze every open RECORDED+APPROVED entry of the caller into a new DRAFT
 * batch. The per-user advisory lock serializes concurrent creators; the row
 * lock + re-filter inside the transaction is the actual freeze authority.
 * QA 2026-11-04: the batch starts DRAFT ("Bản nháp cần hoàn tất" in
 * OpsSettlementsPanel) — finalizeOpsSettlement (DRAFT|PENDING → RECORDED)
 * and reopenOpsSettlementDraft (DRAFT|PENDING → VOIDED) are the only exits.
 * Inserting RECORDED here had orphaned both endpoints and the UI buttons.
 */
export async function createOpsSettlement(
  userId: number,
  note?: string | null,
  transaction?: Tx,
) {
  const run = async (tx: Tx) => {
    await acquireAdvisoryLock(tx, lockKeys.opsUser(userId));

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

    const total = sumOpsAmounts(entries);
    const code = await generateOpsSettlementCode(tx);
    const [settlement] = await tx
      .insert(s.opsSettlements)
      .values({
        code,
        opsUserId: userId,
        status: 'DRAFT',
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
      // SIL-751 r4 — the header IS the sum of the phiếu's lines (card-197
      // law, derived at read). The stored column is write-time state that
      // went stale under accountant edits (OS-2611-0005: 1.080.000 stored
      // over 1.070.000 of lines) and is never printed again.
      totalAmount: opsSettlementTotalFromLinesSql(),
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
      // SIL-751 r4 — the stored column is NOT selected: the header returned
      // below is derived from `entries` (sumOpsAmounts), never printed stale.
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
      tradeDirection: s.shipments.tradeDirection,
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

  // SIL-811 — the lot container identity (roll-call + per-cont tờ khai) behind
  // the sheet's identity titles, batched in one query.
  const identities = await loadLotContainerIdentities(db, entries.map((entry) => entry.shipmentId));

  return {
    settlement: {
      ...settlement,
      // SIL-751 r4 — the detail header derives from the SAME entries the
      // sheet below prints (one BigInt sum, card-197 law), so the header,
      // the sheet's TỔNG CỘNG and a reviewer's manual line-add can never
      // disagree (OS-2611-0005: stored 1.080.000 vs lines 1.070.000).
      totalAmount: sumOpsAmounts(entries).toString(),
      createdAt: settlement.createdAt.toISOString(),
      approvedAt: settlement.approvedAt ? settlement.approvedAt.toISOString() : null,
    },
    grouping: groupOpsExpensesForSettlement(
      entries.map((entry) => withLotIdentity(entry, identities.get(entry.shipmentId))),
    ),
  };
}

/** A settlement records reconciliation, never an unperformed payment.
 *  Card 191026160000 — the receipt photo is OPTIONAL evidence: Ops hands the
 *  accountant paper invoices for reconciliation, so a missing photo must not
 *  block (or brand) a settlement. The old photo gate is gone; the engine's own
 *  reconciliation rules still apply downstream. */
async function assertOpsSettlementEvidence(tx: Tx, expenseIds: number[]) {
  if (expenseIds.length === 0) throw new ApiError(400, 'Phiếu không có khoản chi.');
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
    const total = sumOpsAmounts(entries);
    const [recorded] = await tx.update(s.opsSettlements).set({ status: 'RECORDED', totalAmount: total.toString(), updatedAt: new Date() })
      .where(eq(s.opsSettlements.id, settlementId)).returning();
    await tx.insert(s.auditLogs).values({ userId, entityType: 'ops-settlements', entityId: settlementId, message: 'Ghi nhận phiếu quyết toán trực tiếp', payload: { beforeStatus: settlement.status, status: 'RECORDED' } });
    return recorded;
  };
  return transaction ? run(transaction) : db.transaction(run);
}

/** Release a historical incomplete batch so its owner can correct evidence and recreate it. */
export async function reopenOpsSettlementDraft(userId: number, settlementId: number, tx: Tx) {
  await acquireAdvisoryLock(tx, lockKeys.opsUser(userId));
  const [settlement] = await tx.select().from(s.opsSettlements)
    .where(and(eq(s.opsSettlements.id, settlementId), eq(s.opsSettlements.opsUserId, userId))).for('update');
  if (!settlement) throw new ApiError(404, 'Không tìm thấy phiếu quyết toán.');
  if (!['DRAFT', 'PENDING'].includes(settlement.status)) throw new ApiError(409, 'Chỉ phiếu nháp chưa ghi nhận được mở để bổ sung.');
  const entries = await tx.select({ id: s.opsExpenseEntries.id }).from(s.opsExpenseEntries)
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId)).for('update');
  await tx.update(s.opsExpenseEntries).set({ opsSettlementId: null, updatedAt: new Date() })
    .where(eq(s.opsExpenseEntries.opsSettlementId, settlementId));
  // SIL-751 — the released entries detach above, so the frozen batch total
  // would ghost on: a VOIDED phiếu listing zero lines but still claiming its
  // old total_amount breaks the "header = sum of its lines" invariant in the
  // list. The audit payload below keeps the original total for history.
  const [result] = await tx.update(s.opsSettlements).set({ status: 'VOIDED', totalAmount: '0', updatedAt: new Date() })
    .where(eq(s.opsSettlements.id, settlementId)).returning();
  await tx.insert(s.auditLogs).values({ userId, entityType: 'ops-settlements', entityId: settlementId,
    message: 'Mở khoản chi trong phiếu nháp để bổ sung', payload: { beforeStatus: settlement.status, status: 'VOIDED', releasedExpenseIds: entries.map(row => row.id), totalAmount: settlement.totalAmount } });
  return result;
}
