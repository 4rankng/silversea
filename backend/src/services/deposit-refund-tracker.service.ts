import { and, asc, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { insertTreasuryMovement } from './treasury.service';
import { ApiError } from '../errors';
import { expenseDateSchema, expenseVndSchema, TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import type { ExpenseActor } from './expense-accounting-write.service';
import { requireExpenseFinance } from './expense-accounting-write.service';
import type { Tx } from './trip-shared';

export const DEPOSIT_STATUSES = ['CHUA_HOAN_CUOC', 'DA_HOAN_CUOC'] as const;
export type DepositStatus = typeof DEPOSIT_STATUSES[number];

/** dd/mm/yy (the customer's typing pattern) or ISO accepted; returns ISO. */
export function normalizeDepositDate(input: string): string {
  const trimmed = input.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    expenseDateSchema.parse(trimmed);
    return trimmed;
  }
  const match = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!match) throw new ApiError(400, 'Ngày phải theo mẫu dd/mm/yy hoặc yyyy-mm-dd.');
  const [, day, month, year] = match;
  const iso = `20${year}-${month}-${day}`;
  expenseDateSchema.parse(iso);
  return iso;
}

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The active configured company treasury account receives deposit refunds.
 *  None configured → loud 409: money never posts to a guessed account. */
async function resolveCompanyAccount(tx: typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0]) {
  const [account] = await tx.select().from(s.treasuryAccounts)
    .where(and(
      eq(s.treasuryAccounts.fundCode, 'COMPANY'),
      eq(s.treasuryAccounts.status, 'ACTIVE'),
    ))
    .orderBy(asc(s.treasuryAccounts.id))
    .limit(1);
  if (!account) throw new ApiError(409, 'Chưa có tài khoản quỹ công ty đang hoạt động — không thể ghi nhận thu hoàn cược.');
  return account;
}

export interface DepositTrackerFilters {
  from?: string; to?: string; status?: DepositStatus;
}
export interface DepositTrackerWarningState {
  cvOverdueCount: number;
  unrefundedTotal: number;
}

export async function listDepositTrackers(actor: ExpenseActor, filters: DepositTrackerFilters): Promise<{
  items: Array<typeof s.depositRefundTrackers.$inferSelect>;
  total: number;
  warnings: DepositTrackerWarningState;
}> {
  requireExpenseFinance(actor);
  if (filters.from) expenseDateSchema.parse(filters.from);
  if (filters.to) expenseDateSchema.parse(filters.to);
  const baseConditions = [
    filters.from ? gte(s.depositRefundTrackers.createdAt, new Date(`${filters.from}T00:00:00Z`)) : undefined,
    filters.to ? lte(s.depositRefundTrackers.createdAt, new Date(`${filters.to}T23:59:59Z`)) : undefined,
    filters.status ? eq(s.depositRefundTrackers.status, filters.status) : undefined,
  ].filter(Boolean);
  const rows = await db.select().from(s.depositRefundTrackers)
    .where(baseConditions.length ? and(...baseConditions) : undefined)
    .orderBy(
      // Chưa-hoàn-cược first, then oldest due date first (nulls first); refunded
      // rows sink below by refund date descending.
      sql`case when ${s.depositRefundTrackers.status} = 'CHUA_HOAN_CUOC' then 0 else 1 end`,
      asc(s.depositRefundTrackers.expectedRefundDate),
      asc(s.depositRefundTrackers.cvSubmittedDate),
      asc(s.depositRefundTrackers.id),
    );
  const warnings = buildWarnings(rows);
  return { items: rows, total: rows.reduce((sum, row) => sum + Number(row.depositAmount), 0), warnings };
}

/** The two standing warnings: (1) lots older than 7 days without a CV date
 *  and still unrefunded — the COUNT of such lots; (2) the total money still
 *  unrefunded. Both are computed over the FILTERED set. */
function buildWarnings(rows: Array<typeof s.depositRefundTrackers.$inferSelect>): DepositTrackerWarningState {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const cvOverdue = rows.filter((row) =>
    row.status === 'CHUA_HOAN_CUOC'
    && row.cvSubmittedDate == null
    && new Date(`${row.createdAt.toISOString().slice(0, 10)}T00:00:00Z`) < sevenDaysAgo);
  const unrefunded = rows.filter((row) => row.status === 'CHUA_HOAN_CUOC');
  return {
    cvOverdueCount: cvOverdue.length,
    unrefundedTotal: unrefunded.reduce((sum, row) => sum + Number(row.depositAmount), 0),
  };
}

export async function createDepositTracker(actor: ExpenseActor, input: {
  shipmentId?: number | null; billNumber: string; customerName: string; carrierName: string;
  depositAmount: number | string; cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null;
}, conn: typeof db | Tx = db): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  const amount = Number(input.depositAmount);
  if (!expenseVndSchema.safeParse(amount).success || amount <= 0) throw new ApiError(400, 'Số tiền cược phải là số nguyên dương.');
  const cvDate = input.cvSubmittedDate ? normalizeDepositDate(input.cvSubmittedDate) : null;
  const expectedDate = input.expectedRefundDate ? normalizeDepositDate(input.expectedRefundDate) : (cvDate ? addDays(cvDate, 14) : null);
  const [row] = await conn.insert(s.depositRefundTrackers).values({
    shipmentId: input.shipmentId ?? null,
    billNumber: input.billNumber.trim(),
    customerName: input.customerName.trim(),
    carrierName: input.carrierName.trim(),
    depositAmount: String(amount),
    cvSubmittedDate: cvDate,
    expectedRefundDate: expectedDate,
    note: input.note?.trim() || null,
  }).returning();
  return row;
}

/** KT fills/edits the CV date; the expected refund date defaults to CV + 14
 *  days server-side and stays editable afterwards. */
export async function updateDepositTrackerDates(actor: ExpenseActor, trackerId: number, input: {
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null; depositAmount?: number | string;
}, conn?: Tx): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  const update = async (tx: Tx) => {
    const [row] = await tx.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.id, trackerId)).limit(1).for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy dòng theo dõi hoàn cược.');
    if (row.status === 'DA_HOAN_CUOC') throw new ApiError(409, 'Dòng đã hoàn cược — không thể chỉnh sửa.');
    const amount = input.depositAmount === undefined ? Number(row.depositAmount) : Number(input.depositAmount);
    if (input.depositAmount !== undefined && (!expenseVndSchema.safeParse(amount).success || amount <= 0)) {
      throw new ApiError(400, 'Số tiền cược phải là số nguyên dương.');
    }
    const cvDate = input.cvSubmittedDate === undefined ? row.cvSubmittedDate
      : input.cvSubmittedDate ? normalizeDepositDate(input.cvSubmittedDate) : null;
    const defaultExpected = cvDate ? addDays(cvDate, 14) : null;
    const nextExpected = input.expectedRefundDate === undefined ? row.expectedRefundDate ?? defaultExpected
      : input.expectedRefundDate ? normalizeDepositDate(input.expectedRefundDate) : defaultExpected;
    const [fresh] = await tx.update(s.depositRefundTrackers).set({
      depositAmount: String(amount),
      cvSubmittedDate: cvDate,
      expectedRefundDate: nextExpected,
      note: input.note !== undefined ? (input.note?.trim() || null) : row.note,
      updatedAt: new Date(),
    }).where(eq(s.depositRefundTrackers.id, trackerId)).returning();
    return fresh!;
  };
  return conn ? update(conn) : db.transaction(update);
}

/** Auto-create from the intake tick ("có cược"): the tracker row lands with
 *  customer/carrier/bill from the lot; the amount only when the customer
 *  supplied one (KT fills by hand otherwise — handled by update/patch
 *  surface). KT manual creation uses createDepositTracker. */
export async function recordDepositFromIntake(input: {
  shipmentId: number; customerName: string; carrierName: string; billNumber: string; expectedAmount?: number | string | null;
}, conn: typeof db | Tx = db): Promise<void> {
  const amount = Number(input.expectedAmount ?? 0);
  if (!expenseVndSchema.safeParse(amount).success) throw new ApiError(400, 'Tiền cược dự kiến không hợp lệ.');
  const [existing] = await conn.select({ id: s.depositRefundTrackers.id })
    .from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.shipmentId, input.shipmentId)).limit(1);
  if (existing) return;
  const [row] = await conn.insert(s.depositRefundTrackers).values({
    shipmentId: input.shipmentId,
    billNumber: input.billNumber.trim(),
    customerName: input.customerName.trim(),
    carrierName: input.carrierName.trim(),
    depositAmount: String(amount),
  }).returning();
  if (Number(row.depositAmount) === 0) {
    await conn.update(s.depositRefundTrackers).set({ depositAmount: '0' }).where(eq(s.depositRefundTrackers.id, row.id));
  }
}

/** The ĐÃ-hoan-cuoc tick: one tx — re-checks the status, posts the collection
 *  into the configured company fund through the standing treasury engine (ledger
 *  entry + one IN movement, exactly-linked sources), stamps the row. Re-tick
 *  is rejected loudly; the movement id guards double posts across lanes. */
export async function markDepositRefunded(actor: ExpenseActor, trackerId: number, conn?: Tx, expectedDepositAmount?: number): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  if (expectedDepositAmount !== undefined && (!expenseVndSchema.safeParse(expectedDepositAmount).success || expectedDepositAmount <= 0)) {
    throw new ApiError(400, 'Số tiền xác nhận hoàn cược phải là số nguyên dương.');
  }
  const refund = async (tx: Tx) => {
    const [row] = await tx.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.id, trackerId)).limit(1).for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy dòng theo dõi hoàn cược.');
    if (row.status === 'DA_HOAN_CUOC' || row.refundPostedMovementId != null) {
      throw new ApiError(409, 'Dòng này đã ghi nhận hoàn cược — không thể tích lại.');
    }
    if (expectedDepositAmount !== undefined && Number(row.depositAmount) !== expectedDepositAmount) {
      throw new ApiError(409, 'Số tiền cược đã thay đổi. Tải lại và xác nhận số tiền mới.');
    }
    if (Number(row.depositAmount) <= 0) throw new ApiError(409, 'Chưa có số tiền cược — điền số tiền trước khi ghi nhận đã hoàn cược.');
    const account = await resolveCompanyAccount(tx);
    const ledgerEntry = await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      entityType: 'CARRIER',
      entityId: row.shipmentId ?? row.id,
      debit: 0,
      credit: Number(row.depositAmount),
      receiptId: `DEPOSIT_TRACKER:${row.id}`,
      txnId: row.id,
      note: `Hoàn cược container - Bill ${row.billNumber}`,
    });
    const movement = await insertTreasuryMovement(tx, {
      treasuryAccountId: account.id,
      direction: 'IN',
      amount: Number(row.depositAmount),
      valueDate: new Date().toISOString().slice(0, 10),
      physicalReference: `HOAN-CUOC-${row.id}-${row.billNumber}`,
      paymentContractVersion: 1,
      ledgerEntryId: ledgerEntry.id,
      sourceVersion: 1,
      createdBy: actor.userId,
    });
    await tx.update(s.depositRefundTrackers).set({
      status: 'DA_HOAN_CUOC',
      refundPostedMovementId: movement.id,
      refundPostedAt: new Date(),
      refundPostedBy: actor.userId,
      updatedAt: new Date(),
    }).where(eq(s.depositRefundTrackers.id, trackerId));
    const [fresh] = await tx.select().from(s.depositRefundTrackers).where(eq(s.depositRefundTrackers.id, trackerId));
    return fresh!;
  };
  return conn ? refund(conn) : db.transaction(refund);
}
