import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { resolveSalaryPeriodDateRange } from './salary-period.service';
import type { Tx } from './trip-shared';

export type PeriodLockDomain = 'SALARY' | 'FUEL' | 'DEBIT_NOTE';
export type PeriodLockScopeType = 'GLOBAL' | 'CUSTOMER';
export type PeriodLockCycle = 'MONTHLY' | 'WEEKLY';

export interface PeriodWindow {
  cycle: PeriodLockCycle;
  periodKey: string;
  periodStart: string;
  periodEnd: string;
}

export interface PeriodLockScope {
  scopeType: PeriodLockScopeType;
  scopeId: number;
}

export interface PeriodLockRef extends PeriodWindow, PeriodLockScope {
  domain: PeriodLockDomain;
}

export interface FuelLateApprovalLink {
  sourcePeriodLockId: number;
  sourcePeriod: string;
  targetPeriod: string;
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WEEKLY_MODE = 'WEEKLY';
const GLOBAL_SCOPE: PeriodLockScope = { scopeType: 'GLOBAL', scopeId: 0 };
const DEBIT_NOTE_REOPEN_BLOCKING_STATUSES = ['SENT', 'PENDING_CONFIRM', 'CONFIRMED', 'PARTIAL_PAID', 'PAID', 'CANCELED'];

function parseIsoDate(value: string): Date {
  if (!ISO_DATE_PATTERN.test(value)) {
    throw new ApiError(400, `Ngày không hợp lệ: ${value}`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, `Ngày không hợp lệ: ${value}`);
  }
  return parsed;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return formatIsoDate(date);
}

function monthBounds(date: string): PeriodWindow {
  const parsed = parseIsoDate(date);
  const year = parsed.getUTCFullYear();
  const month = parsed.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 0));
  return {
    cycle: 'MONTHLY',
    periodKey: `${year}-${String(month + 1).padStart(2, '0')}`,
    periodStart: formatIsoDate(start),
    periodEnd: formatIsoDate(end),
  };
}

function weekBounds(date: string): PeriodWindow {
  const parsed = parseIsoDate(date);
  const day = parsed.getUTCDay();
  const offsetToMonday = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + offsetToMonday);
  const start = formatIsoDate(parsed);
  const end = addDays(start, 6);
  return {
    cycle: 'WEEKLY',
    periodKey: `${start}:${end}`,
    periodStart: start,
    periodEnd: end,
  };
}

function normalizeToday(today: Date = new Date()): string {
  return formatIsoDate(new Date(Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  )));
}

function isLaterRange(rangeFrom: string, rangeTo: string): boolean {
  return parseIsoDate(rangeFrom).getTime() > parseIsoDate(rangeTo).getTime();
}

export function resolveDebitNoteCycleMode(rawMode: string | null | undefined): PeriodLockCycle {
  return rawMode === WEEKLY_MODE ? 'WEEKLY' : 'MONTHLY';
}

export function resolveDebitNoteWindowForRange(
  rangeFrom: string,
  rangeTo: string,
  rawMode: string | null | undefined,
): PeriodWindow {
  if (isLaterRange(rangeFrom, rangeTo)) {
    throw new ApiError(400, 'Kỳ giấy báo nợ không hợp lệ: ngày bắt đầu phải trước hoặc bằng ngày kết thúc');
  }
  const cycle = resolveDebitNoteCycleMode(rawMode);
  const fromWindow = cycle === 'WEEKLY' ? weekBounds(rangeFrom) : monthBounds(rangeFrom);
  const toWindow = cycle === 'WEEKLY' ? weekBounds(rangeTo) : monthBounds(rangeTo);
  if (fromWindow.periodKey !== toWindow.periodKey) {
    const cycleLabel = cycle === 'WEEKLY' ? 'tuần' : 'tháng';
    throw new ApiError(400, `Kỳ giấy báo nợ phải nằm gọn trong một ${cycleLabel} theo chu kỳ thanh toán của khách hàng`);
  }
  return toWindow;
}

export async function resolveDebitNotePeriodAuthority(
  tx: Tx,
  customerId: number,
  rangeFrom: string,
  rangeTo: string,
): Promise<PeriodLockRef> {
  const [customer] = await tx.select({ debitNoteMode: s.customers.debitNoteMode })
    .from(s.customers)
    .where(eq(s.customers.id, customerId))
    .limit(1);
  if (!customer) {
    throw new ApiError(404, 'Không tìm thấy khách hàng đã chọn');
  }
  const window = resolveDebitNoteWindowForRange(rangeFrom, rangeTo, customer.debitNoteMode);
  return {
    domain: 'DEBIT_NOTE',
    scopeType: 'CUSTOMER',
    scopeId: customerId,
    ...window,
  };
}

export async function resolveSalaryPeriodAuthority(period: string): Promise<PeriodLockRef> {
  const [yearStr, monthStr] = period.split('-');
  if (!yearStr || !monthStr) {
    throw new ApiError(400, `Kỳ lương không hợp lệ: ${period}`);
  }
  const year = Number(yearStr);
  const month = Number(monthStr);
  const range = await resolveSalaryPeriodDateRange(month, year);
  return {
    domain: 'SALARY',
    ...GLOBAL_SCOPE,
    cycle: 'MONTHLY',
    periodKey: period,
    periodStart: range.start,
    periodEnd: range.end,
  };
}

export function resolveFuelPeriodAuthority(date: string): PeriodLockRef {
  const window = monthBounds(date);
  return {
    domain: 'FUEL',
    ...GLOBAL_SCOPE,
    ...window,
  };
}

async function readPeriodLock(
  tx: Tx | typeof db,
  ref: PeriodLockRef,
): Promise<typeof s.periodLocks.$inferSelect | null> {
  const [row] = await tx.select()
    .from(s.periodLocks)
    .where(and(
      eq(s.periodLocks.domain, ref.domain),
      eq(s.periodLocks.scopeType, ref.scopeType),
      eq(s.periodLocks.scopeId, ref.scopeId),
      eq(s.periodLocks.periodKey, ref.periodKey),
    ))
    .limit(1);
  return row ?? null;
}

export async function closePeriodLock(
  tx: Tx,
  ref: PeriodLockRef,
  actorId: number,
  note?: string | null,
): Promise<typeof s.periodLocks.$inferSelect> {
  const existing = await readPeriodLock(tx, ref);
  if (existing?.status === 'CLOSED') {
    return existing;
  }
  if (existing) {
    const [updated] = await tx.update(s.periodLocks)
      .set({
        cycle: ref.cycle,
        periodStart: ref.periodStart,
        periodEnd: ref.periodEnd,
        status: 'CLOSED',
        closedBy: actorId,
        closedAt: new Date(),
        reopenedBy: null,
        reopenedAt: null,
        note: note ?? existing.note,
        reopenNote: null,
        updatedAt: new Date(),
      })
      .where(eq(s.periodLocks.id, existing.id))
      .returning();
    return updated!;
  }

  const [inserted] = await tx.insert(s.periodLocks).values({
    domain: ref.domain,
    scopeType: ref.scopeType,
    scopeId: ref.scopeId,
    cycle: ref.cycle,
    periodKey: ref.periodKey,
    periodStart: ref.periodStart,
    periodEnd: ref.periodEnd,
    status: 'CLOSED',
    closedBy: actorId,
    note: note ?? null,
  }).returning();
  return inserted!;
}

async function assertDebitNotePeriodCanReopen(tx: Tx, lock: typeof s.periodLocks.$inferSelect): Promise<void> {
  if (lock.scopeType !== 'CUSTOMER') return;

  const docs = await tx.select({
    id: s.billingDocuments.id,
    debitNoteStatus: s.billingDocuments.debitNoteStatus,
  })
    .from(s.billingDocuments)
    .where(and(
      eq(s.billingDocuments.type, 'DEBIT_NOTE'),
      eq(s.billingDocuments.entityType, 'CUSTOMER'),
      eq(s.billingDocuments.entityId, lock.scopeId),
      isPeriodOverlappingLock(lock),
      sql`${s.billingDocuments.deletedAt} is null`,
    ))
    .orderBy(desc(s.billingDocuments.createdAt));

  const blockedDoc = docs.find((doc) =>
    doc.debitNoteStatus != null &&
    DEBIT_NOTE_REOPEN_BLOCKING_STATUSES.includes(doc.debitNoteStatus),
  );
  if (blockedDoc) {
    throw new ApiError(
      409,
      `Kỳ giấy báo nợ ${lock.periodKey} đã được phát hành hoặc khóa, không thể mở lại trực tiếp`,
    );
  }

  if (docs.length === 0) return;
  const docIds = docs.map((doc) => doc.id);
  const [allocation] = await tx.select({ id: s.paymentAllocations.id })
    .from(s.paymentAllocations)
    .where(and(
      eq(s.paymentAllocations.targetType, 'BILLING_DOCUMENT'),
      inArray(s.paymentAllocations.targetId, docIds),
    ))
    .limit(1);
  if (allocation) {
    throw new ApiError(
      409,
      `Kỳ giấy báo nợ ${lock.periodKey} đã có thanh toán, chỉ được xử lý bằng điều chỉnh ở kỳ đang mở`,
    );
  }
}

export async function reopenPeriodLock(
  tx: Tx,
  ref: PeriodLockRef,
  actorId: number,
  note?: string | null,
): Promise<typeof s.periodLocks.$inferSelect> {
  const existing = await readPeriodLock(tx, ref);
  if (!existing) {
    throw new ApiError(404, `Kỳ ${ref.periodKey} chưa được khóa`);
  }
  if (existing.status === 'REOPENED') {
    return existing;
  }
  if (existing.domain === 'FUEL') {
    throw new ApiError(
      409,
      `Kỳ nhiên liệu ${existing.periodKey} chỉ được xử lý bằng điều chỉnh ở kỳ đang mở; không hỗ trợ mở lại trực tiếp`,
    );
  }
  if (existing.domain === 'DEBIT_NOTE') {
    await assertDebitNotePeriodCanReopen(tx, existing);
  }
  const [updated] = await tx.update(s.periodLocks)
    .set({
      status: 'REOPENED',
      reopenedBy: actorId,
      reopenedAt: new Date(),
      reopenNote: note ?? null,
      updatedAt: new Date(),
    })
    .where(eq(s.periodLocks.id, existing.id))
    .returning();
  return updated!;
}

function isPeriodOverlappingLock(lock: Pick<typeof s.periodLocks.$inferSelect, 'periodStart' | 'periodEnd'>) {
  return and(
    lte(s.billingDocuments.rangeFrom, lock.periodEnd),
    gte(s.billingDocuments.rangeTo, lock.periodStart),
  );
}

export async function getClosedPeriodLock(
  tx: Tx | typeof db,
  ref: PeriodLockRef,
): Promise<typeof s.periodLocks.$inferSelect | null> {
  const lock = await readPeriodLock(tx, ref);
  return lock?.status === 'CLOSED' ? lock : null;
}

export async function assertDebitNotePeriodWritable(
  tx: Tx,
  ref: PeriodLockRef,
): Promise<void> {
  const closed = await getClosedPeriodLock(tx, ref);
  if (!closed) return;
  throw new ApiError(
    409,
    `Kỳ giấy báo nợ ${ref.periodKey} đã khóa. Dữ liệu đến muộn phải vào kỳ đang mở dưới dạng điều chỉnh, không sửa trực tiếp kỳ cũ.`,
  );
}

async function loadTripDates(tx: Tx, tripIds: readonly number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (tripIds.length === 0) return map;
  const rows = await tx.select({
    id: s.trips.id,
    departureDate: s.trips.departureDate,
  }).from(s.trips).where(inArray(s.trips.id, [...tripIds]));
  for (const row of rows) map.set(row.id, row.departureDate);
  return map;
}

async function loadExpenseDates(tx: Tx, expenseIds: readonly number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (expenseIds.length === 0) return map;
  const rows = await tx.select({
    id: s.tripExpenses.id,
    invoiceDate: s.tripExpenses.invoiceDate,
    createdAt: s.tripExpenses.createdAt,
  }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, [...expenseIds]));
  for (const row of rows) {
    const fallback = row.createdAt.toISOString().slice(0, 10);
    map.set(row.id, row.invoiceDate ?? fallback);
  }
  return map;
}

export async function resolveBillingDocumentSourcePeriodLocks(
  tx: Tx,
  customerId: number,
  rangeFrom: string,
  rangeTo: string,
  lines: ReadonlyArray<{
    sourceType: 'TRIP' | 'EXPENSE' | 'ADHOC';
    sourceId: number | null;
  }>,
): Promise<number[]> {
  const authority = await resolveDebitNotePeriodAuthority(tx, customerId, rangeFrom, rangeTo);
  const tripIds = lines
    .filter((line) => line.sourceType === 'TRIP' && line.sourceId != null)
    .map((line) => line.sourceId as number);
  const expenseIds = lines
    .filter((line) => line.sourceType === 'EXPENSE' && line.sourceId != null)
    .map((line) => line.sourceId as number);
  const tripDates = await loadTripDates(tx, tripIds);
  const expenseDates = await loadExpenseDates(tx, expenseIds);

  const sourceRefs = new Map<string, PeriodLockRef>();
  for (const line of lines) {
    let sourceDate: string | undefined;
    if (line.sourceType === 'TRIP' && line.sourceId != null) {
      sourceDate = tripDates.get(line.sourceId);
    } else if (line.sourceType === 'EXPENSE' && line.sourceId != null) {
      sourceDate = expenseDates.get(line.sourceId);
    }
    if (!sourceDate) continue;

    const sourceWindow = authority.cycle === 'WEEKLY'
      ? weekBounds(sourceDate)
      : monthBounds(sourceDate);
    if (sourceWindow.periodKey === authority.periodKey) continue;
    sourceRefs.set(sourceWindow.periodKey, {
      domain: 'DEBIT_NOTE',
      scopeType: authority.scopeType,
      scopeId: authority.scopeId,
      ...sourceWindow,
    });
  }

  if (sourceRefs.size === 0) return [];

  const currentPeriodClosed = await getClosedPeriodLock(tx, authority);
  if (currentPeriodClosed) {
    throw new ApiError(
      409,
      `Kỳ đích ${authority.periodKey} đã khóa. Dữ liệu đến muộn phải vào một kỳ giấy báo nợ đang mở.`,
    );
  }

  const lockIds: number[] = [];
  for (const ref of sourceRefs.values()) {
    const closed = await getClosedPeriodLock(tx, ref);
    if (closed) lockIds.push(closed.id);
  }
  return [...new Set(lockIds)];
}

export async function replaceBillingDocumentSourcePeriodLocks(
  tx: Tx,
  documentId: number,
  periodLockIds: readonly number[],
): Promise<void> {
  await tx.delete(s.billingDocumentSourcePeriodLocks)
    .where(eq(s.billingDocumentSourcePeriodLocks.documentId, documentId));
  if (periodLockIds.length === 0) return;
  await tx.insert(s.billingDocumentSourcePeriodLocks).values(
    periodLockIds.map((periodLockId) => ({
      documentId,
      periodLockId,
    })),
  );
}

export async function assertFuelPeriodCanAbsorbLateApproval(
  tx: Tx | typeof db,
  expenseDate: string,
  asOfDate: string = normalizeToday(),
): Promise<void> {
  await resolveFuelLateApprovalLinks(tx, [expenseDate], asOfDate);
}

export async function resolveFuelLateApprovalLinks(
  tx: Tx | typeof db,
  sourceDates: readonly string[],
  targetDate: string,
): Promise<FuelLateApprovalLink[]> {
  const uniqueSourceDates = [...new Set(sourceDates)];
  if (uniqueSourceDates.length === 0) {
    return [];
  }

  const target = resolveFuelPeriodAuthority(targetDate);
  const closedTarget = await getClosedPeriodLock(tx, target);
  const links: FuelLateApprovalLink[] = [];
  const seenLockIds = new Set<number>();

  for (const sourceDate of uniqueSourceDates) {
    const source = resolveFuelPeriodAuthority(sourceDate);
    const closedSource = await getClosedPeriodLock(tx, source);
    if (!closedSource) {
      continue;
    }
    if (source.periodKey === target.periodKey) {
      throw new ApiError(
        409,
        `Kỳ nhiên liệu ${source.periodKey} đã khóa. Dữ liệu đến muộn phải vào kỳ tháng đang mở dưới dạng điều chỉnh, không sửa trực tiếp kỳ cũ.`,
      );
    }
    if (closedTarget) {
      throw new ApiError(
        409,
        `Kỳ nhiên liệu ${source.periodKey} đã khóa và hiện không còn kỳ tháng đang mở để nhận điều chỉnh muộn`,
      );
    }
    if (seenLockIds.has(closedSource.id)) {
      continue;
    }
    seenLockIds.add(closedSource.id);
    links.push({
      sourcePeriodLockId: closedSource.id,
      sourcePeriod: source.periodKey,
      targetPeriod: target.periodKey,
    });
  }

  return links;
}

export async function listPeriodLocks(opts: {
  domain?: PeriodLockDomain;
  scopeType?: PeriodLockScopeType;
  scopeId?: number;
} = {}) {
  const conditions = [];
  if (opts.domain) conditions.push(eq(s.periodLocks.domain, opts.domain));
  if (opts.scopeType) conditions.push(eq(s.periodLocks.scopeType, opts.scopeType));
  if (opts.scopeId != null) conditions.push(eq(s.periodLocks.scopeId, opts.scopeId));

  const query = db.select().from(s.periodLocks);
  return conditions.length > 0
    ? query.where(and(...conditions)).orderBy(asc(s.periodLocks.domain), desc(s.periodLocks.periodStart))
    : query.orderBy(asc(s.periodLocks.domain), desc(s.periodLocks.periodStart));
}
