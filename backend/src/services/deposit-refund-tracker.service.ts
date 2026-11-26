import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { insertTreasuryMovement } from './treasury.service';
import { ApiError } from '../errors';
import { expenseDateSchema, expenseVndSchema, round2dp, TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import type { AuthUser } from '../middleware/auth';
import type { ExpenseActor } from './expense-accounting-write.service';
import { requireExpenseFinance } from './expense-accounting-write.service';
import type { Tx } from './trip-shared';

export const DEPOSIT_STATUSES = ['CHUA_HOAN_CUOC', 'DA_HOAN_CUOC'] as const;
export type DepositStatus = typeof DEPOSIT_STATUSES[number];

// SIL-764 (id 885) — the one-board-two-kinds classification: tiền cược
// container vs khoản tạm thu sửa chữa vỏ container. Board rows are filterable
// by it; every pre-column row defaults to CUOC_CONTAINER.
export const DEPOSIT_CATEGORIES = ['CUOC_CONTAINER', 'TAM_THU_SUA_CHUA'] as const;
export type DepositCategory = typeof DEPOSIT_CATEGORIES[number];

export function assertDepositCategory(category: string | undefined | null): asserts category is DepositCategory | undefined {
  if (category != null && !DEPOSIT_CATEGORIES.includes(category as DepositCategory)) {
    throw new ApiError(400, 'Phân loại phải là "Cược container" hoặc "Tạm thu sửa chữa".');
  }
}

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
  /** SIL-764 — the [Cược container] | [Tạm thu sửa chữa] classification. */
  category?: DepositCategory;
}
export interface DepositTrackerWarningState {
  cvOverdueCount: number;
  unrefundedTotal: number;
}

/** Asia/Ho_Chi_Minh is fixed UTC+7 with no DST — the VN calendar day of an
 *  instant is a constant +7h shift. Staging containers run UTC, so the
 *  7-day boundary must be pinned to VN calendar days, never a rolling UTC
 *  window (the old math flagged lots up to ~7h early/late). */
export function vnCalendarDate(instant: Date): string {
  return new Date(instant.getTime() + 7 * 3_600_000).toISOString().slice(0, 10);
}

/** "Quá 7 ngày chưa nộp công văn" (card 20260923_14, MỤC 03): a lot with no
 *  CV date flags when TODAY (VN) is past the deposit day + 7 — from the 8th
 *  VN calendar day after the tracker row landed. */
export const CV_OVERDUE_DAYS = 7;

export interface CvOverdueRow {
  status: string;
  cvSubmittedDate: string | null;
  createdAt: Date;
  /** Ngày cược (card 051026231522) — the ONLY 7-day anchor (SIL-914): a row
   *  without it has no cược day, so the 7-day clock has not started and the
   *  row never counts as overdue (the audit's JH202609258 case — createdAt
   *  is a data-entry artifact, not a cược day). */
  depositDate?: string | null;
}

export function isCvOverdue(row: CvOverdueRow, now: Date = new Date()): boolean {
  if (row.status !== 'CHUA_HOAN_CUOC' || row.cvSubmittedDate != null) return false;
  // SIL-914 (audit 24/11 mục 6.4): only lots WITH a ngày cược can be overdue —
  // the old createdAt fallback counted un-anchored rows ("chưa nhập ngày cược")
  // as overdue on a day nobody bet.
  if (row.depositDate == null) return false;
  const anchorDay = row.depositDate;
  const todayDay = vnCalendarDate(now);
  const diff = Math.round((Date.UTC(
    Number(todayDay.slice(0, 4)), Number(todayDay.slice(5, 7)) - 1, Number(todayDay.slice(8, 10)),
  ) - Date.UTC(
    Number(anchorDay.slice(0, 4)), Number(anchorDay.slice(5, 7)) - 1, Number(anchorDay.slice(8, 10)),
  )) / 86_400_000);
  return diff > CV_OVERDUE_DAYS;
}

// ─── SIL-1061 (K2.118/K2.150) — partial recovery laws ────────────────────────
// The ĐÃ-hoàn-cược tick no longer means "all of it": KT records the amount
// actually received (0 ≤ đã hoàn ≤ số cược) and the day it landed. The whole
// state machine lives in these pure helpers so the money laws are unit-testable
// without a DB (owner ruling: BE tests are unit-only).

export type DepositTrackerRowSelect = typeof s.depositRefundTrackers.$inferSelect;

export interface DepositRefundTickInput {
  /** Optimistic lock: the caller approves the displayed số tiền cược. */
  expectedDepositAmount?: number;
  /** The tranche received NOW; omitted = everything still outstanding
   *  (legacy full-refund identity: the first tick with no amount completes). */
  recoveredAmount?: number;
  /** Ngày nhận thực tế — mandatory whenever an explicit amount is sent. */
  refundReceivedDate?: string;
}

export interface DepositRefundTickPlan {
  tranche: number;
  newRecovered: number;
  refundReceivedDate: string;
  status: DepositStatus;
}

/** Số tiền còn lại phải hoàn của một dòng (số cược − đã hoàn, không âm). */
export function depositRemaining(row: Pick<DepositTrackerRowSelect, 'depositAmount' | 'recoveredAmount'>): number {
  return Math.max(0, Number(row.depositAmount) - Number(row.recoveredAmount ?? 0));
}

/** The tick law. Throws ApiError(400/409) exactly like the route would. */
export function resolveRefundTick(
  row: Pick<DepositTrackerRowSelect, 'id' | 'status' | 'depositAmount' | 'recoveredAmount'>,
  input: DepositRefundTickInput,
  todayIso: string,
): DepositRefundTickPlan {
  const deposit = Number(row.depositAmount);
  if (deposit <= 0) throw new ApiError(409, 'Chưa có số tiền cược — điền số tiền trước khi ghi nhận đã hoàn cược.');
  if (input.expectedDepositAmount !== undefined) {
    if (!expenseVndSchema.safeParse(input.expectedDepositAmount).success || input.expectedDepositAmount <= 0) {
      throw new ApiError(400, 'Số tiền xác nhận hoàn cược phải là số nguyên dương.');
    }
    if (deposit !== input.expectedDepositAmount) {
      throw new ApiError(409, 'Số tiền cược đã thay đổi. Tải lại và xác nhận số tiền mới.');
    }
  }
  const already = Number(row.recoveredAmount ?? 0);
  // The observed repro law (SIL-1061 §3): ticking an already-completed row is
  // blocked loudly — a row is complete when its status flipped or the recorded
  // recovery has eaten the whole bet. A PARTIALLY ticked row still ticks (the
  // next tranche), so the double-post guard is "nothing left", not "any
  // movement exists".
  if (row.status === 'DA_HOAN_CUOC' || already >= deposit) {
    throw new ApiError(409, 'Dòng này đã ghi nhận hoàn cược — không thể tích lại.');
  }
  let tranche = deposit - already;
  if (input.recoveredAmount !== undefined) {
    if (!expenseVndSchema.safeParse(input.recoveredAmount).success || input.recoveredAmount <= 0) {
      throw new ApiError(400, 'Số tiền đã hoàn phải là số nguyên dương.');
    }
    tranche = input.recoveredAmount;
  }
  if (already + tranche > deposit) {
    throw new ApiError(400, `Số tiền đã hoàn vượt số tiền cược (cược ${deposit.toLocaleString('vi-VN')} ₫, đã hoàn trước đó ${already.toLocaleString('vi-VN')} ₫, nhập ${tranche.toLocaleString('vi-VN')} ₫).`);
  }
  // KB Ch.2 §2.4.7: đã hoàn > 0 BẮT BUỘC có ngày nhận thực tế. A legacy
  // default tick (no explicit amount) keeps its old identity: the system
  // stamps the VN day of the click, exactly like refundPostedAt always did.
  let refundReceivedDate: string;
  if (input.refundReceivedDate !== undefined) {
    refundReceivedDate = normalizeDepositDate(input.refundReceivedDate);
  } else if (input.recoveredAmount !== undefined) {
    throw new ApiError(400, 'Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận thực tế.');
  } else {
    refundReceivedDate = todayIso;
  }
  const newRecovered = already + tranche;
  return {
    tranche,
    newRecovered,
    refundReceivedDate,
    status: newRecovered >= deposit ? 'DA_HOAN_CUOC' : 'CHUA_HOAN_CUOC',
  };
}

/** The exact ledger payload the tick posts — pinned by the regression test:
 *  refund money is a fund ADJUSTMENT (credit-only), NOT transport revenue,
 *  receipt-coded DEPOSIT_TRACKER:{id}. */
export function depositRefundLedgerEntry(
  row: Pick<DepositTrackerRowSelect, 'id' | 'shipmentId' | 'billNumber'>,
  tranche: number,
) {
  return {
    txnType: TxnType.ADJUSTMENT,
    entityType: 'CARRIER' as const,
    entityId: row.shipmentId ?? row.id,
    debit: 0,
    credit: tranche,
    receiptId: `DEPOSIT_TRACKER:${row.id}`,
    txnId: row.id,
    note: `Hoàn cược container - Bill ${row.billNumber}`,
  };
}

/** The exact treasury movement payload — one IN movement per tick tranche. */
export function depositRefundTreasuryMovement(
  treasuryAccountId: number,
  row: Pick<DepositTrackerRowSelect, 'id' | 'billNumber'>,
  tranche: number,
  ledgerEntryId: number,
  createdBy: number,
  valueDate: string,
) {
  return {
    treasuryAccountId,
    direction: 'IN' as const,
    amount: tranche,
    valueDate,
    physicalReference: `HOAN-CUOC-${row.id}-${row.billNumber}`,
    paymentContractVersion: 1,
    ledgerEntryId,
    sourceVersion: 1,
    createdBy,
  };
}

export interface DepositRecoveryEditInput {
  recoveredAmount?: number | string | null;
  refundReceivedDate?: string | null;
}

export interface DepositRecoveryEditPlan {
  recoveredAmount: string;
  refundReceivedDate: string | null;
  status: DepositStatus;
}

/** The "Cập nhật hoàn cược" edit law for the two recovery fields (validated
 *  against the row's FINAL số tiền cược, so an amount edit in the same payload
 *  is covered): 0 ≤ đã hoàn ≤ số cược; đã hoàn > 0 ⇒ ngày nhận bắt buộc;
 *  đã hoàn không thể giảm sau khi bút toán quỹ đã chạy; còn lại = 0 ⇒ ĐÃ. */
export function resolveRecoveryEdit(
  row: Pick<DepositTrackerRowSelect, 'status' | 'depositAmount' | 'recoveredAmount' | 'refundReceivedDate' | 'refundPostedMovementId'>,
  input: DepositRecoveryEditInput,
  finalDepositAmount: number,
): DepositRecoveryEditPlan {
  const posted = Number(row.recoveredAmount ?? 0);
  let recovered: number;
  if (input.recoveredAmount === undefined) {
    recovered = posted;
  } else if (input.recoveredAmount === null || input.recoveredAmount === '') {
    recovered = 0;
  } else {
    recovered = Number(input.recoveredAmount);
    if (!expenseVndSchema.safeParse(recovered).success) {
      throw new ApiError(400, 'Số tiền đã hoàn phải là số nguyên không âm.');
    }
    if (row.refundPostedMovementId != null && recovered < posted) {
      throw new ApiError(400, 'Dòng đã ghi nhận hoàn cược qua bút toán quỹ — không thể giảm số đã hoàn.');
    }
  }
  if (finalDepositAmount > 0 && recovered > finalDepositAmount) {
    throw new ApiError(400, `Số tiền đã hoàn vượt số tiền cược (cược ${finalDepositAmount.toLocaleString('vi-VN')} ₫, đã hoàn ${recovered.toLocaleString('vi-VN')} ₫).`);
  }
  const refundReceivedDate = input.refundReceivedDate === undefined
    ? row.refundReceivedDate
    : input.refundReceivedDate
      ? normalizeDepositDate(input.refundReceivedDate)
      : null;
  if (recovered > 0 && !refundReceivedDate) {
    throw new ApiError(400, 'Số tiền đã hoàn lớn hơn 0 bắt buộc có Ngày nhận thực tế.');
  }
  return {
    recoveredAmount: String(recovered),
    refundReceivedDate,
    status: finalDepositAmount > 0 && recovered >= finalDepositAmount ? 'DA_HOAN_CUOC' : row.status,
  };
}

/** K6.34 §6.4 — default board order: chưa-hoàn-cược lên đầu, rồi theo cột NGÀY
 *  (ngày cược ?? ngày tạo) tăng dần — ngày xa nhất trước, ngày gần nhất sau;
 *  cùng ngày thì id tăng dần. SIL-963: khóa ngày PHẢI là giá trị cột NGÀY đang
 *  hiển thị — khóa expectedRefundDate cũ vừa sai cột vừa đẩy dòng có ngày dự
 *  kiến hoàn lên trên dòng không có (PostgreSQL ASC = NULLS LAST). */
export const depositTrackerListOrder = [
  sql`case when ${s.depositRefundTrackers.status} = 'CHUA_HOAN_CUOC' then 0 else 1 end`,
  sql`coalesce(${s.depositRefundTrackers.depositDate}, ${s.depositRefundTrackers.createdAt}) asc`,
  asc(s.depositRefundTrackers.id),
];

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
    // SIL-764 — lọc theo phân loại (Cược container / Tạm thu sửa chữa).
    filters.category ? eq(s.depositRefundTrackers.category, filters.category) : undefined,
  ].filter(Boolean);
  const rows = await db.select().from(s.depositRefundTrackers)
    .where(baseConditions.length ? and(...baseConditions) : undefined)
    .orderBy(...depositTrackerListOrder);
  const warnings = buildWarnings(rows);
  return { items: rows, total: rows.reduce((sum, row) => sum + Number(row.depositAmount), 0), warnings };
}

/** The two standing warnings: (1) lots older than 7 days without a CV date
 *  and still unrefunded — the COUNT of such lots; (2) the total money still
 *  unrefunded. Both are computed over the FILTERED set (work order c12 _14:
 *  "N đếm theo lọc hiện tại"). SIL-1061: the money line counts what is still
 *  OUTSTANDING (số cược − đã hoàn) — a partially recovered row no longer
 *  bills its whole bet into the warning. */
function buildWarnings(rows: Array<typeof s.depositRefundTrackers.$inferSelect>): DepositTrackerWarningState {
  const now = new Date();
  const cvOverdue = rows.filter((row) => isCvOverdue(row, now));
  const unrefunded = rows.filter((row) => row.status === 'CHUA_HOAN_CUOC');
  return {
    cvOverdueCount: cvOverdue.length,
    unrefundedTotal: round2dp(unrefunded.reduce((sum, row) => sum + depositRemaining(row), 0)),
  };
}

export interface DepositWeekRow {
  weekStart: string;
  label: string;
  count: number;
  depositAmount: number;
  refundedAmount: number;
}

export interface DepositWeeklySummary {
  weeks: DepositWeekRow[];
  totals: { count: number; depositAmount: number; refundedAmount: number };
}

/** Monday (YYYY-MM-DD) of the ISO calendar day's Mon–Sun week. */
function mondayOf(isoDay: string): string {
  const date = new Date(`${isoDay}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  return date.toISOString().slice(0, 10);
}

/** "Tổng quát về tiền" weekly container-deposit series (REQ-5.10-01): one row
 *  per Mon–Sun calendar week covering [from,to], empty weeks zeroed. The weeks
 *  run full (weekStart stays the true Monday) but INCLUSION is clamped to the
 *  range edges per series' own day: count + depositAmount bucket by createdAt,
 *  refundedAmount (only ĐÃ-hoàn-cược rows) buckets by
 *  COALESCE(refundPostedAt, updatedAt) — each counted only when that day falls
 *  inside [from,to]. Totals are exactly the sums of the week rows. */
export async function getDepositWeeklySummary(actor: ExpenseActor, filters: { from: string; to: string }): Promise<DepositWeeklySummary> {
  requireExpenseFinance(actor);
  expenseDateSchema.parse(filters.from);
  expenseDateSchema.parse(filters.to);
  if (filters.from > filters.to) throw new ApiError(400, 'Ngày từ phải trước hoặc bằng ngày đến.');
  const { from, to } = filters;
  const fromStart = new Date(`${from}T00:00:00Z`);
  const toEnd = new Date(`${to}T23:59:59.999Z`);
  const rows = await db.select().from(s.depositRefundTrackers).where(or(
    and(gte(s.depositRefundTrackers.createdAt, fromStart), lte(s.depositRefundTrackers.createdAt, toEnd)),
    and(
      eq(s.depositRefundTrackers.status, 'DA_HOAN_CUOC'),
      or(
        and(gte(s.depositRefundTrackers.refundPostedAt, fromStart), lte(s.depositRefundTrackers.refundPostedAt, toEnd)),
        and(isNull(s.depositRefundTrackers.refundPostedAt), gte(s.depositRefundTrackers.updatedAt, fromStart), lte(s.depositRefundTrackers.updatedAt, toEnd)),
      ),
    ),
  ));
  const weeks: DepositWeekRow[] = [];
  const firstWeekStart = mondayOf(from);
  const lastWeekStart = mondayOf(to);
  for (let weekStart = firstWeekStart; weekStart <= lastWeekStart; weekStart = addDays(weekStart, 7)) {
    weeks.push({
      weekStart,
      label: `Tuần ${weekStart.slice(8, 10)}/${weekStart.slice(5, 7)}`,
      count: 0, depositAmount: 0, refundedAmount: 0,
    });
  }
  // Week position of a day inside [from,to]: whole days since the first Monday
  // divided by 7 — the sorted weeks array IS the lookup table.
  const dayIndex = (isoDay: string) => Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000;
  const firstWeekIndex = dayIndex(firstWeekStart);
  for (const row of rows) {
    const amount = Number(row.depositAmount);
    const createdDay = row.createdAt.toISOString().slice(0, 10);
    if (createdDay >= from && createdDay <= to) {
      const week = weeks[Math.floor((dayIndex(createdDay) - firstWeekIndex) / 7)]!;
      week.count += 1;
      week.depositAmount += amount;
    }
    if (row.status === 'DA_HOAN_CUOC') {
      const postedDay = (row.refundPostedAt ?? row.updatedAt).toISOString().slice(0, 10);
      if (postedDay >= from && postedDay <= to) {
        weeks[Math.floor((dayIndex(postedDay) - firstWeekIndex) / 7)]!.refundedAmount += amount;
      }
    }
  }
  for (const week of weeks) {
    week.depositAmount = round2dp(week.depositAmount);
    week.refundedAmount = round2dp(week.refundedAmount);
  }
  return {
    weeks,
    totals: {
      count: weeks.reduce((sum, week) => sum + week.count, 0),
      depositAmount: round2dp(weeks.reduce((sum, week) => sum + week.depositAmount, 0)),
      refundedAmount: round2dp(weeks.reduce((sum, week) => sum + week.refundedAmount, 0)),
    },
  };
}

export async function createDepositTracker(actor: ExpenseActor, input: {
  shipmentId?: number | null; billNumber: string; customerName: string; carrierName: string;
  depositAmount: number | string; cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null;
  /** Ngày cược (card 051026231522) — dd/mm/yy or ISO; nullable. */
  depositDate?: string | null;
  /** Default CHUA_HOAN_CUOC. DA_HOAN_CUOC at create composes the ĐÃ-hoàn-cược
   *  tick below in the same tx — the treasury posting runs exactly once. */
  status?: DepositStatus;
  /** SIL-764 — Phân loại; defaults to CUOC_CONTAINER (existing-row law). */
  category?: DepositCategory;
}, conn: typeof db | Tx = db): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  assertDepositCategory(input.category);
  const amount = Number(input.depositAmount);
  if (!expenseVndSchema.safeParse(amount).success || amount <= 0) throw new ApiError(400, 'Số tiền cược phải là số nguyên dương.');
  const cvDate = input.cvSubmittedDate ? normalizeDepositDate(input.cvSubmittedDate) : null;
  const expectedDate = input.expectedRefundDate ? normalizeDepositDate(input.expectedRefundDate) : (cvDate ? addDays(cvDate, 14) : null);
  const depositDate = input.depositDate ? normalizeDepositDate(input.depositDate) : null;
  const run = async (tx: Tx) => {
    const [row] = await tx.insert(s.depositRefundTrackers).values({
      shipmentId: input.shipmentId ?? null,
      billNumber: input.billNumber.trim(),
      customerName: input.customerName.trim(),
      carrierName: input.carrierName.trim(),
      depositAmount: String(amount),
      depositDate,
      cvSubmittedDate: cvDate,
      expectedRefundDate: expectedDate,
      note: input.note?.trim() || null,
      // SIL-764 — undefined falls to the column default CUOC_CONTAINER.
      category: input.category,
    }).returning();
    // Trạng thái ĐÃ hoàn cược at create: the collection posts into the
    // company fund through the standing treasury engine — never a hand-rolled
    // money movement. Insert + posting share one transaction, and the
    // movement guard inside markDepositRefunded keeps it exactly-once.
    return input.status === 'DA_HOAN_CUOC'
      ? markDepositRefunded(actor, row.id, tx, { expectedDepositAmount: amount })
      : row;
  };
  // Invariant: a non-default `conn` is always a caller transaction (the only
  // call shapes are `createDepositTracker(actor, input)` and `…(actor, input,
  // tx)`), so the DA composition joins that transaction; the pool default
  // opens one to keep insert + posting atomic.
  return conn === db ? db.transaction(run) : run(conn as Tx);
}

/** KT fills/edits the deposit day (SIL-878 — auto-intake rows stamp hôm nay;
 *  the KT corrects it when the customer actually deposited earlier/later), the
 *  CV date; the expected refund date defaults to CV + 14 days server-side and
 *  stays editable afterwards. SIL-764: the Phân loại rides the same edit
 *  dialog. */
// SIL-1012 — the actor carries its display name (the request's AuthUser does):
// the audit row snapshots actor_name at write time so the trail names WHO
// changed the amount even if the account is later renamed or deleted.
export async function updateDepositTrackerDates(actor: Pick<AuthUser, 'userId' | 'role' | 'fullName' | 'username'>, trackerId: number, input: {
  depositDate?: string | null;
  cvSubmittedDate?: string | null; expectedRefundDate?: string | null; note?: string | null; depositAmount?: number | string;
  category?: DepositCategory;
  /** SIL-1061 — số đã hoàn + ngày nhận thực tế edit with the same dialog. */
  recoveredAmount?: number | string | null;
  refundReceivedDate?: string | null;
}, conn?: Tx): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  assertDepositCategory(input.category);
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
    const depositDate = input.depositDate === undefined ? row.depositDate
      : input.depositDate ? normalizeDepositDate(input.depositDate) : null;
    const defaultExpected = cvDate ? addDays(cvDate, 14) : null;
    const nextExpected = input.expectedRefundDate === undefined ? row.expectedRefundDate ?? defaultExpected
      : input.expectedRefundDate ? normalizeDepositDate(input.expectedRefundDate) : defaultExpected;
    // SIL-1061 — the recovery fields validate against the FINAL amount in the
    // same payload (an amount edit cannot smuggle đã hoàn past the new bet).
    const recovery = resolveRecoveryEdit(row, input, amount);
    const [fresh] = await tx.update(s.depositRefundTrackers).set({
      depositDate,
      depositAmount: String(amount),
      cvSubmittedDate: cvDate,
      expectedRefundDate: nextExpected,
      recoveredAmount: recovery.recoveredAmount,
      refundReceivedDate: recovery.refundReceivedDate,
      status: recovery.status,
      note: input.note !== undefined ? (input.note?.trim() || null) : row.note,
      category: input.category ?? row.category,
      updatedAt: new Date(),
    }).where(eq(s.depositRefundTrackers.id, trackerId)).returning();
    // CR-011 §6.4 — the KT amount edit leaves an audit trail (actor, row,
    // old→new) in the SAME transaction, so a changed số tiền cược can never
    // escape the ledger of who changed it. Only an actual change writes.
    if (String(amount) !== String(row.depositAmount)) {
      await tx.insert(s.auditLogs).values({
        userId: actor.userId,
        actorName: actor.fullName ?? actor.username ?? null,
        message: 'DEPOSIT_TRACKER_UPDATED',
        entityType: 'deposit_refund_tracker',
        entityId: trackerId,
        payload: { before: String(row.depositAmount), after: String(amount) },
      });
    }
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
    // Ngày cược = the VN calendar day the row lands (card 051026231522) — the
    // intake day is the deposit day; KT may correct it later if the customer
    // deposited on another day.
    depositDate: vnCalendarDate(new Date()),
  }).returning();
  if (Number(row.depositAmount) === 0) {
    await conn.update(s.depositRefundTrackers).set({ depositAmount: '0' }).where(eq(s.depositRefundTrackers.id, row.id));
  }
}

/** The ĐÃ-hoan-cuoc tick: one tx — re-checks the state, posts the received
 *  tranche into the configured company fund through the standing treasury
 *  engine (ledger entry + one IN movement, exactly-linked sources), stamps the
 *  row. SIL-1061: the tick records số đã hoàn từng phần + ngày nhận thực tế
 *  (default = everything still outstanding); a partially ticked row stays
 *  CHUA_HOAN_CUOC and ticks again for the next tranche. Ticking a row with
 *  nothing left outstanding is rejected loudly. */
export async function markDepositRefunded(actor: ExpenseActor, trackerId: number, conn?: Tx, input: DepositRefundTickInput = {}): Promise<typeof s.depositRefundTrackers.$inferSelect> {
  requireExpenseFinance(actor);
  const refund = async (tx: Tx) => {
    const [row] = await tx.select().from(s.depositRefundTrackers)
      .where(eq(s.depositRefundTrackers.id, trackerId)).limit(1).for('update');
    if (!row) throw new ApiError(404, 'Không tìm thấy dòng theo dõi hoàn cược.');
    const plan = resolveRefundTick(row, input, vnCalendarDate(new Date()));
    const account = await resolveCompanyAccount(tx);
    const ledgerEntry = await LedgerService.postEntry(tx, depositRefundLedgerEntry(row, plan.tranche));
    const movement = await insertTreasuryMovement(tx, depositRefundTreasuryMovement(
      account.id, row, plan.tranche, ledgerEntry.id, actor.userId, new Date().toISOString().slice(0, 10),
    ));
    await tx.update(s.depositRefundTrackers).set({
      status: plan.status,
      recoveredAmount: String(plan.newRecovered),
      refundReceivedDate: plan.refundReceivedDate,
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
