import { and, asc, desc, eq, inArray, isNull, lt, or } from 'drizzle-orm';

import { round2dp } from '@tingting/shared';

import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { todayIsoVn } from '../lib/vn-date';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import {
  resolveFuelLateApprovalLinks,
  resolveFuelPeriodAuthority,
} from './period-lock.service';
import type {
  GovernanceActionRow,
  GovernanceApplyResult,
} from './governance-transition.service';

type FuelInvoiceRow = typeof s.fuelInvoices.$inferSelect;
type FuelInvoiceCorrectionRow = typeof s.governanceActions.$inferSelect;
type FuelPeriodAdjustmentRow = typeof s.fuelPeriodAdjustments.$inferSelect;

function amountsMatch(left: number, right: number): boolean {
  return round2dp(left) === round2dp(right);
}

function currentApprovalDate(): string {
  return todayIsoVn();
}

async function resolveFinalFuelLateApprovalLinks(
  tx: Tx,
  sourceDates: readonly string[],
  targetDate: string,
) {
  const periodKeys = [...new Set([
    ...sourceDates.map((date) => resolveFuelPeriodAuthority(date).periodKey),
    resolveFuelPeriodAuthority(targetDate).periodKey,
  ])];
  if (periodKeys.length > 0) {
    await tx.select({ id: s.periodLocks.id })
      .from(s.periodLocks)
      .where(and(
        eq(s.periodLocks.domain, 'FUEL'),
        eq(s.periodLocks.scopeType, 'GLOBAL'),
        eq(s.periodLocks.scopeId, 0),
        inArray(s.periodLocks.periodKey, periodKeys),
      ))
      .orderBy(asc(s.periodLocks.periodKey))
      .for('update');
  }
  return resolveFuelLateApprovalLinks(tx, sourceDates, targetDate);
}

function isFuelExpenseType(value: string): boolean {
  return value.trim().toLowerCase().includes('fuel');
}

type FuelExpenseAuthority = {
  id: number;
  tripId: number;
  supplierId: number | null;
  expenseType: string;
  approvalStatus: string;
  expenseDate: string | null;
  invoiceNumber: string | null;
  declarationNumber: string | null;
  buyAmount: string;
};

function normalizeReference(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function buildAuthoritativeReferences(expense: FuelExpenseAuthority): string[] {
  const refs = [
    normalizeReference(expense.invoiceNumber),
    normalizeReference(expense.declarationNumber),
  ].filter((value): value is string => value != null);
  return [...new Set(refs)];
}

function photoCountByExpenseId(photos: Array<{ tripExpenseId: number }>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const photo of photos) {
    counts.set(photo.tripExpenseId, (counts.get(photo.tripExpenseId) ?? 0) + 1);
  }
  return counts;
}

function fuelInvoiceVersion(updatedAt: Date): number {
  return Math.max(1, updatedAt.getTime());
}

function toFuelInvoiceView<T extends FuelInvoiceRow>(invoice: T) {
  return {
    ...invoice,
    version: fuelInvoiceVersion(invoice.updatedAt),
  };
}

type FuelInvoiceEffectiveSnapshot = {
  correctionType: 'ADJUSTMENT' | 'REVERSAL';
  invoice: {
    supplierId: number;
    invoiceNumber: string;
    invoiceDate: string;
    totalLiters: number;
    unitPrice: number;
    totalAmount: number;
    note: string | null;
  } | null;
  allocations: Array<FuelInvoiceAllocationInput & { amount: string }>;
};

type FuelLateApprovalDelta = {
  sourceVersion: number;
  payableAmount: string;
  lateApprovalLinks: Array<{
    sourcePeriodLockId: number;
    sourcePeriod: string;
    targetPeriod: string;
  }>;
};

function parseFuelLateApprovalDelta(
  value: Record<string, unknown> | null | undefined,
): FuelLateApprovalDelta {
  const sourceVersion = Number(value?.sourceVersion);
  const payableAmount = typeof value?.payableAmount === 'string'
    ? value.payableAmount
    : String(value?.payableAmount ?? '');
  const rawLinks = Array.isArray(value?.lateApprovalLinks) ? value.lateApprovalLinks : [];
  const lateApprovalLinks = rawLinks.map((raw) => {
    if (!raw || typeof raw !== 'object') {
      throw new ApiError(409, 'Yêu cầu duyệt hóa đơn nhiên liệu thiếu liên kết kỳ khóa hợp lệ');
    }
    const sourcePeriodLockId = Number(raw.sourcePeriodLockId);
    const sourcePeriod = typeof raw.sourcePeriod === 'string' ? raw.sourcePeriod : '';
    const targetPeriod = typeof raw.targetPeriod === 'string' ? raw.targetPeriod : '';
    if (
      !Number.isInteger(sourcePeriodLockId)
      || sourcePeriodLockId <= 0
      || !sourcePeriod
      || !targetPeriod
      || sourcePeriod === targetPeriod
    ) {
      throw new ApiError(409, 'Yêu cầu duyệt hóa đơn nhiên liệu thiếu liên kết kỳ khóa hợp lệ');
    }
    return {
      sourcePeriodLockId,
      sourcePeriod,
      targetPeriod,
    };
  });
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1 || !payableAmount) {
    throw new ApiError(409, 'Yêu cầu duyệt thiếu dữ liệu kỳ khóa nguồn hợp lệ');
  }
  return {
    sourceVersion,
    payableAmount,
    lateApprovalLinks,
  };
}

function toFuelInvoiceSnapshot(
  invoice: FuelInvoiceRow,
  allocations: Array<FuelInvoiceAllocationInput & { amount: string }>,
): FuelInvoiceEffectiveSnapshot {
  return {
    correctionType: 'ADJUSTMENT',
    invoice: {
      supplierId: invoice.supplierId,
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: invoice.invoiceDate,
      totalLiters: Number(invoice.totalLiters),
      unitPrice: Number(invoice.unitPrice),
      totalAmount: Number(invoice.totalAmount),
      note: invoice.note,
    },
    allocations,
  };
}

function allocationRowsToInput(
  allocations: Array<typeof s.fuelInvoiceAllocations.$inferSelect>,
): Array<FuelInvoiceAllocationInput & { amount: string }> {
  return allocations.map((allocation) => ({
    tripId: allocation.tripId,
    truckId: allocation.truckId,
    tripExpenseId: allocation.tripExpenseId,
    voucherReference: allocation.voucherReference,
    voucherDate: allocation.voucherDate,
    liters: Number(allocation.liters),
    amount: allocation.amount,
    note: allocation.note,
  }));
}

async function findLatestApprovedFuelInvoiceCorrection(
  executor: Tx | typeof db,
  invoiceId: number,
) {
  const [action] = await executor.select().from(s.governanceActions)
    .where(and(
      eq(s.governanceActions.subjectType, 'FUEL_INVOICE'),
      eq(s.governanceActions.subjectId, invoiceId),
      eq(s.governanceActions.actionKind, 'FUEL_INVOICE_CORRECTION'),
      eq(s.governanceActions.status, 'APPROVED'),
    ))
    .orderBy(desc(s.governanceActions.id))
    .limit(1);
  return action;
}

async function toEffectiveFuelInvoiceView(
  executor: Tx | typeof db,
  invoice: FuelInvoiceRow,
  allocationRows: Array<typeof s.fuelInvoiceAllocations.$inferSelect>,
  suppliedCorrection?: FuelInvoiceCorrectionRow | null,
) {
  const correction = suppliedCorrection === undefined
    ? await findLatestApprovedFuelInvoiceCorrection(executor, invoice.id)
    : suppliedCorrection;
  const base = {
    ...toFuelInvoiceView(invoice),
    allocations: allocationRowsToInput(allocationRows),
  };
  if (!correction) return base;

  const snapshot = correction.afterSnapshot as FuelInvoiceEffectiveSnapshot;
  if (snapshot.correctionType === 'REVERSAL') {
    return {
      ...base,
      approvalStatus: 'REVERSED',
      effectiveCorrection: {
        actionId: correction.id,
        correctionType: snapshot.correctionType,
        reason: correction.reason,
        approvedBy: correction.approverId,
        approvedAt: correction.approvedAt,
      },
    };
  }
  if (!snapshot.invoice) {
    throw new ApiError(409, 'Bản điều chỉnh hóa đơn nhiên liệu thiếu dữ liệu hiệu lực');
  }
  return {
    ...base,
    ...snapshot.invoice,
    allocations: snapshot.allocations,
    effectiveCorrection: {
      actionId: correction.id,
      correctionType: snapshot.correctionType,
      reason: correction.reason,
      approvedBy: correction.approverId,
      approvedAt: correction.approvedAt,
    },
  };
}

function assertLinkedFuelExpenseAuthority(params: {
  allocationLabel: string;
  tripId: number;
  invoiceSupplierId: number;
  voucherReference: string;
  voucherDate: string;
  computedAmount: number;
  expense: FuelExpenseAuthority | undefined;
  photoCount: number;
}) {
  const {
    allocationLabel,
    tripId,
    invoiceSupplierId,
    voucherReference,
    voucherDate,
    computedAmount,
    expense,
    photoCount,
  } = params;

  if (!expense) {
    throw new ApiError(400, `Không tìm thấy chi phí nhiên liệu cho ${allocationLabel}`);
  }
  if (expense.tripId !== tripId) {
    throw new ApiError(400, 'Chi phí nhiên liệu không thuộc chuyến đã chọn');
  }
  if (!isFuelExpenseType(expense.expenseType)) {
    throw new ApiError(400, 'Chi phí đã chọn không phải chi phí nhiên liệu thực tế');
  }
  if (expense.supplierId !== invoiceSupplierId) {
    throw new ApiError(400, 'Chi phí nhiên liệu không khớp nhà cung cấp trên hóa đơn');
  }
  if (expense.approvalStatus !== 'APPROVED') {
    throw new ApiError(400, 'Chi phí nhiên liệu chưa được phê duyệt');
  }
  if (!expense.expenseDate) {
    throw new ApiError(400, 'Chi phí nhiên liệu chưa có ngày chi thực tế để đối chiếu');
  }
  if (expense.expenseDate !== voucherDate) {
    throw new ApiError(400, `${allocationLabel} phải trùng ngày chi ${expense.expenseDate} của chi phí nhiên liệu`);
  }
  const approvedAmount = Number(expense.buyAmount);
  if (!amountsMatch(computedAmount, approvedAmount)) {
    throw new ApiError(
      400,
      `${allocationLabel} không khớp chi phí nhiên liệu đã duyệt: ${computedAmount} != ${approvedAmount}`,
    );
  }

  const authoritativeReferences = buildAuthoritativeReferences(expense);
  const normalizedVoucherReference = normalizeReference(voucherReference);
  if (authoritativeReferences.length > 0) {
    if (!normalizedVoucherReference || !authoritativeReferences.includes(normalizedVoucherReference)) {
      throw new ApiError(
        400,
        `${allocationLabel} phải khớp chứng từ đã duyệt của chi phí nhiên liệu: ${authoritativeReferences.join(' / ')}`,
      );
    }
    return;
  }

  if (photoCount <= 0) {
    throw new ApiError(
      400,
      'Chi phí nhiên liệu chưa có số hóa đơn/tờ khai và cũng chưa có ảnh phiếu bơm hoặc chứng từ',
    );
  }
}

export interface FuelInvoiceAllocationInput {
  tripId: number;
  truckId?: number | null;
  tripExpenseId?: number | null;
  voucherReference: string;
  voucherDate: string;
  liters: number;
  note?: string | null;
}

export interface FuelInvoiceInput {
  supplierId: number;
  invoiceNumber: string;
  invoiceDate: string;
  totalLiters: number;
  unitPrice: number;
  note?: string | null;
  allocations: FuelInvoiceAllocationInput[];
}

function normalizeFuelInvoiceInput(input: FuelInvoiceInput): FuelInvoiceInput {
  const invoiceNumber = input.invoiceNumber.trim();
  if (!invoiceNumber) throw new ApiError(400, 'Số hóa đơn nhiên liệu là bắt buộc');
  if (!Number.isFinite(input.totalLiters) || input.totalLiters <= 0) {
    throw new ApiError(400, 'Tổng số lít hóa đơn phải lớn hơn 0');
  }
  if (!Number.isFinite(input.unitPrice) || input.unitPrice <= 0) {
    throw new ApiError(400, 'Đơn giá nhiên liệu phải lớn hơn 0');
  }
  return {
    ...input,
    invoiceNumber,
    totalLiters: round2dp(input.totalLiters),
    unitPrice: round2dp(input.unitPrice),
    note: input.note?.trim() || null,
    allocations: input.allocations.map((allocation) => ({
      ...allocation,
      voucherReference: allocation.voucherReference.trim(),
      liters: round2dp(allocation.liters),
      note: allocation.note?.trim() || null,
    })),
  };
}

async function assertFuelSupplier(
  executor: Tx,
  supplierId: number,
): Promise<void> {
  const [supplier] = await executor.select({
    id: s.suppliers.id,
    isFuelSupplier: s.suppliers.isFuelSupplier,
    types: s.suppliers.types,
  }).from(s.suppliers)
    .where(and(eq(s.suppliers.id, supplierId), isNull(s.suppliers.deletedAt)))
    .limit(1);
  if (!supplier) throw new ApiError(404, 'Không tìm thấy nhà cung cấp nhiên liệu');
  if (!supplier.isFuelSupplier && !(supplier.types ?? []).includes('FUEL')) {
    throw new ApiError(400, 'Nhà cung cấp chưa được phân loại là nhà cung cấp nhiên liệu');
  }
}

async function buildAllocationRows(
  tx: Tx,
  invoiceId: number,
  input: FuelInvoiceInput,
) {
  const tripIds = [...new Set(input.allocations.map((allocation) => allocation.tripId))];
  const expenseIds = [...new Set(input.allocations
    .map((allocation) => allocation.tripExpenseId ?? null)
    .filter((expenseId): expenseId is number => expenseId != null))];
  const trips = tripIds.length > 0
    ? await tx.select({
      id: s.trips.id,
      tripCode: s.trips.tripCode,
      truckId: s.trips.truckId,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(inArray(s.trips.id, tripIds))
    : [];
  const expenses = expenseIds.length > 0
    ? await tx.select({
      id: s.tripExpenses.id,
      tripId: s.tripExpenses.tripId,
      supplierId: s.tripExpenses.supplierId,
      expenseType: s.tripExpenses.expenseType,
      approvalStatus: s.tripExpenses.approvalStatus,
      expenseDate: s.tripExpenses.expenseDate,
      invoiceNumber: s.tripExpenses.invoiceNumber,
      declarationNumber: s.tripExpenses.declarationNumber,
      buyAmount: s.tripExpenses.buyAmount,
    }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds))
    : [];
  const expensePhotos = expenseIds.length > 0
    ? await tx.select({
      tripExpenseId: s.tripExpensePhotos.tripExpenseId,
    }).from(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.tripExpenseId, expenseIds))
    : [];
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));
  const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
  const photoCountById = photoCountByExpenseId(expensePhotos);

  let allocatedLiters = 0;
  const rows = input.allocations.map((allocation) => {
    const trip = tripById.get(allocation.tripId);
    if (!trip || trip.deletedAt) {
      throw new ApiError(400, 'Không tìm thấy chuyến đã chọn cho dòng phân bổ');
    }
    if (!allocation.voucherReference) {
      throw new ApiError(400, 'Mỗi dòng phân bổ phải có số phiếu hoặc nhật ký đổ nhiên liệu');
    }
    if (!Number.isFinite(allocation.liters) || allocation.liters <= 0) {
      throw new ApiError(400, 'Số lít trên mỗi dòng phân bổ phải lớn hơn 0');
    }
    if (allocation.tripExpenseId != null) {
      assertLinkedFuelExpenseAuthority({
        allocationLabel: `Dòng phân bổ chuyến ${trip.tripCode ?? 'chưa có mã'}`,
        tripId: allocation.tripId,
        invoiceSupplierId: input.supplierId,
        voucherReference: allocation.voucherReference,
        voucherDate: allocation.voucherDate,
        computedAmount: round2dp(allocation.liters * input.unitPrice),
        expense: expenseById.get(allocation.tripExpenseId),
        photoCount: photoCountById.get(allocation.tripExpenseId) ?? 0,
      });
    }
    const truckId = allocation.truckId ?? trip.truckId;
    if (truckId == null) {
      throw new ApiError(400, `Chuyến ${trip.tripCode ?? 'chưa có mã'} chưa có xe để phân bổ nhiên liệu`);
    }
    if (allocation.truckId != null && trip.truckId != null && allocation.truckId !== trip.truckId) {
      throw new ApiError(400, `Xe phân bổ không khớp xe của chuyến ${trip.tripCode ?? 'chưa có mã'}`);
    }
    allocatedLiters = round2dp(allocatedLiters + allocation.liters);
    return {
      fuelInvoiceId: invoiceId,
      tripId: allocation.tripId,
      truckId,
      tripExpenseId: allocation.tripExpenseId ?? null,
      voucherReference: allocation.voucherReference,
      voucherDate: allocation.voucherDate,
      liters: String(allocation.liters),
      amount: String(round2dp(allocation.liters * input.unitPrice)),
      note: allocation.note ?? null,
    };
  });
  if (allocatedLiters > input.totalLiters) {
    throw new ApiError(
      400,
      `Tổng số lít phân bổ ${allocatedLiters} vượt số lít hóa đơn ${input.totalLiters}`,
    );
  }
  return rows;
}

export async function createFuelInvoice(
  rawInput: FuelInvoiceInput,
  actorId: number,
  transaction?: Tx,
) {
  const input = normalizeFuelInvoiceInput(rawInput);
  const execute = async (tx: Tx) => {
    await assertFuelSupplier(tx, input.supplierId);
    const [invoice] = await tx.insert(s.fuelInvoices).values({
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      totalLiters: String(input.totalLiters),
      unitPrice: String(input.unitPrice),
      totalAmount: String(round2dp(input.totalLiters * input.unitPrice)),
      note: input.note ?? null,
      createdBy: actorId,
    }).returning();
    const rows = await buildAllocationRows(tx, invoice.id, input);
    if (rows.length > 0) await tx.insert(s.fuelInvoiceAllocations).values(rows);
    return {
      ...toFuelInvoiceView(invoice),
      allocations: rows,
      allocatedLiters: rows.reduce((sum, row) => sum + Number(row.liters), 0),
    };
  };
  return runInTx(transaction, execute);
}

export async function updateFuelInvoice(
  invoiceId: number,
  rawInput: FuelInvoiceInput,
  expectedVersion: number,
  transaction?: Tx,
) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, 'Phiên bản hóa đơn nhiên liệu không hợp lệ');
  }
  const input = normalizeFuelInvoiceInput(rawInput);
  const execute = async (tx: Tx) => {
    const [existing] = await tx.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, invoiceId))
      .limit(1)
      .for('update');
    if (!existing) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    if (fuelInvoiceVersion(existing.updatedAt) !== expectedVersion) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được cập nhật. Vui lòng tải lại trước khi lưu');
    }
    if (existing.approvalStatus !== 'PENDING') {
      throw new ApiError(409, 'Chỉ được sửa hóa đơn nhiên liệu đang chờ duyệt');
    }
    await assertFuelSupplier(tx, input.supplierId);
    const rows = await buildAllocationRows(tx, invoiceId, input);
    await tx.delete(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceId));
    if (rows.length > 0) await tx.insert(s.fuelInvoiceAllocations).values(rows);
    const nextUpdatedAt = new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1));
    const [updated] = await tx.update(s.fuelInvoices).set({
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      totalLiters: String(input.totalLiters),
      unitPrice: String(input.unitPrice),
      totalAmount: String(round2dp(input.totalLiters * input.unitPrice)),
      note: input.note ?? null,
      updatedAt: nextUpdatedAt,
    }).where(eq(s.fuelInvoices.id, invoiceId)).returning();
    return { ...toFuelInvoiceView(updated!), allocations: rows };
  };
  return runInTx(transaction, execute);
}

export async function getFuelInvoice(invoiceId: number) {
  const [invoice] = await db.select().from(s.fuelInvoices)
    .where(eq(s.fuelInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
  const allocations = await db.select().from(s.fuelInvoiceAllocations)
    .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceId))
    .orderBy(s.fuelInvoiceAllocations.id);
  return toEffectiveFuelInvoiceView(db, invoice, allocations);
}

function encodeFuelInvoiceCursor(invoice: FuelInvoiceRow): string {
  return `${invoice.invoiceDate}:${invoice.id}`;
}

function decodeFuelInvoiceCursor(cursor: string): { invoiceDate: string; id: number } {
  const match = /^(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(cursor);
  const id = Number(match?.[2]);
  if (!match || !Number.isSafeInteger(id) || id <= 0) {
    throw new ApiError(400, 'Con trỏ danh sách hóa đơn nhiên liệu không hợp lệ');
  }
  return { invoiceDate: match[1], id };
}

async function loadEffectiveFuelInvoiceRows(rows: FuelInvoiceRow[]) {
  const invoiceIds = rows.map((invoice) => invoice.id);
  if (invoiceIds.length === 0) {
    return [];
  }
  const [allocationRows, correctionRows] = await Promise.all([
    db.select().from(s.fuelInvoiceAllocations)
      .where(inArray(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceIds))
      .orderBy(s.fuelInvoiceAllocations.fuelInvoiceId, s.fuelInvoiceAllocations.id),
    db.select().from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'FUEL_INVOICE'),
        inArray(s.governanceActions.subjectId, invoiceIds),
        eq(s.governanceActions.actionKind, 'FUEL_INVOICE_CORRECTION'),
        eq(s.governanceActions.status, 'APPROVED'),
      ))
      .orderBy(s.governanceActions.subjectId, desc(s.governanceActions.id)),
  ]);
  const allocationsByInvoice = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    const current = allocationsByInvoice.get(allocation.fuelInvoiceId) ?? [];
    current.push(allocation);
    allocationsByInvoice.set(allocation.fuelInvoiceId, current);
  }
  const correctionByInvoice = new Map<number, FuelInvoiceCorrectionRow>();
  for (const correction of correctionRows) {
    if (correction.subjectId != null && !correctionByInvoice.has(correction.subjectId)) {
      correctionByInvoice.set(correction.subjectId, correction);
    }
  }
  return Promise.all(rows.map((invoice) =>
    toEffectiveFuelInvoiceView(
      db,
      invoice,
      allocationsByInvoice.get(invoice.id) ?? [],
      correctionByInvoice.get(invoice.id) ?? null,
    )));
}

export async function listFuelInvoices(filters: {
  supplierId?: number;
  status?: string;
  limit?: number;
  cursor?: string;
} = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 100);
  const rawPageSize = filters.status == null ? limit : Math.max(limit, 50);
  let scanCursor = filters.cursor ? decodeFuelInvoiceCursor(filters.cursor) : null;
  const items: Array<Awaited<ReturnType<typeof toEffectiveFuelInvoiceView>>> = [];

  while (items.length < limit) {
    const conditions = [
      filters.supplierId != null ? eq(s.fuelInvoices.supplierId, filters.supplierId) : undefined,
      scanCursor != null
        ? or(
          lt(s.fuelInvoices.invoiceDate, scanCursor.invoiceDate),
          and(
            eq(s.fuelInvoices.invoiceDate, scanCursor.invoiceDate),
            lt(s.fuelInvoices.id, scanCursor.id),
          ),
        )
        : undefined,
    ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
    const fetchedRows = await db.select().from(s.fuelInvoices)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(s.fuelInvoices.invoiceDate), desc(s.fuelInvoices.id))
      .limit(rawPageSize + 1);
    const rows = fetchedRows.slice(0, rawPageSize);
    if (rows.length === 0) {
      return { items, nextCursor: null };
    }

    const effectiveRows = await loadEffectiveFuelInvoiceRows(rows);
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const effectiveRow = effectiveRows[index]!;
      if (filters.status == null || effectiveRow.approvalStatus === filters.status) {
        items.push(effectiveRow);
      }
      if (items.length === limit) {
        const hasUnscannedRows = index < rows.length - 1 || fetchedRows.length > rawPageSize;
        return {
          items,
          nextCursor: hasUnscannedRows ? encodeFuelInvoiceCursor(row) : null,
        };
      }
    }

    if (fetchedRows.length <= rawPageSize) {
      return { items, nextCursor: null };
    }
    scanCursor = {
      invoiceDate: rows[rows.length - 1]!.invoiceDate,
      id: rows[rows.length - 1]!.id,
    };
  }

  return { items, nextCursor: null };
}

export async function approveFuelInvoice(
  invoiceId: number,
  actorId: number,
  actorRole: string,
  expectedVersion: number,
  reason = 'Đề nghị duyệt hóa đơn nhiên liệu',
  transaction?: Tx,
): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('FUEL_INVOICE_APPROVAL', actorRole);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, 'Phiên bản hóa đơn nhiên liệu không hợp lệ');
  }
  const normalizedReason = reason.trim();
  if (!normalizedReason) throw new ApiError(400, 'Lý do đề nghị duyệt là bắt buộc');

  const execute = async (tx: Tx) => {
    const [invoice] = await tx.select()
      .from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, invoiceId))
      .limit(1)
      .for('update');

    if (!invoice) {
      throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    }
    if (fuelInvoiceVersion(invoice.updatedAt) !== expectedVersion) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được cập nhật. Vui lòng tải lại trước khi duyệt');
    }
    if (invoice.approvalStatus !== 'PENDING') {
      throw new ApiError(409, `Không thể duyệt hóa đơn đang ở ${invoice.approvalStatus}`);
    }
    if (invoice.createdBy != null && invoice.createdBy === actorId) {
      throw new ApiError(403, 'Không thể duyệt hóa đơn nhiên liệu do chính mình tạo');
    }
    const [existingAction] = await tx.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'FUEL_INVOICE'),
        eq(s.governanceActions.subjectId, invoice.id),
        eq(s.governanceActions.actionKind, 'FUEL_INVOICE_APPROVAL'),
        inArray(s.governanceActions.status, ['PENDING_CHECK', 'PENDING_APPROVAL']),
      ))
      .limit(1);
    if (existingAction) {
      throw new ApiError(409, 'Hóa đơn đã có yêu cầu duyệt đang chờ xử lý');
    }

    const allocations = await tx.select()
      .from(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceId))
      .orderBy(s.fuelInvoiceAllocations.id);

    const expenseIds = [...new Set(allocations
      .map((allocation) => allocation.tripExpenseId ?? null)
      .filter((expenseId): expenseId is number => expenseId != null))];
    const expenses = expenseIds.length > 0
      ? await tx.select({
        id: s.tripExpenses.id,
        tripId: s.tripExpenses.tripId,
        supplierId: s.tripExpenses.supplierId,
        expenseType: s.tripExpenses.expenseType,
        approvalStatus: s.tripExpenses.approvalStatus,
        expenseDate: s.tripExpenses.expenseDate,
        invoiceNumber: s.tripExpenses.invoiceNumber,
        declarationNumber: s.tripExpenses.declarationNumber,
        buyAmount: s.tripExpenses.buyAmount,
      }).from(s.tripExpenses).where(inArray(s.tripExpenses.id, expenseIds))
      : [];
    const expensePhotos = expenseIds.length > 0
      ? await tx.select({
        tripExpenseId: s.tripExpensePhotos.tripExpenseId,
      }).from(s.tripExpensePhotos).where(inArray(s.tripExpensePhotos.tripExpenseId, expenseIds))
      : [];
    const expenseById = new Map(expenses.map((expense) => [expense.id, expense]));
    const photoCountById = photoCountByExpenseId(expensePhotos);
    const lateApprovalLinks = await resolveFuelLateApprovalLinks(
      tx,
      allocations.map((allocation) => allocation.voucherDate),
      currentApprovalDate(),
    );

    if (allocations.length === 0) {
      throw new ApiError(400, 'Hóa đơn nhiên liệu chưa có dòng phân bổ theo xe');
    }

    const unitPrice = Number(invoice.unitPrice);
    const expectedTotalLiters = Number(invoice.totalLiters);
    const expectedTotalAmount = Number(invoice.totalAmount);

    let allocatedLiters = 0;
    let allocatedAmount = 0;
    for (const allocation of allocations) {
      const liters = Number(allocation.liters);
      const amount = Number(allocation.amount);
      if (!allocation.voucherReference.trim()) {
        throw new ApiError(400, 'Dòng phân bổ thiếu số phiếu hoặc nhật ký đổ nhiên liệu');
      }
      const computedAmount = round2dp(liters * unitPrice);
      if (!amountsMatch(amount, computedAmount)) {
        throw new ApiError(
          400,
          `Dòng phân bổ ${allocation.id} không khớp đơn giá hóa đơn: ${amount} != ${computedAmount}`,
        );
      }
      if (allocation.tripExpenseId == null) {
        throw new ApiError(
          400,
          `Dòng phân bổ ${allocation.id} chưa liên kết chi phí nhiên liệu thực tế đã duyệt`,
        );
      }
      const expense = expenseById.get(allocation.tripExpenseId);
      assertLinkedFuelExpenseAuthority({
        allocationLabel: `Dòng phân bổ ${allocation.id}`,
        tripId: allocation.tripId,
        invoiceSupplierId: invoice.supplierId,
        voucherReference: allocation.voucherReference,
        voucherDate: allocation.voucherDate,
        computedAmount,
        expense,
        photoCount: photoCountById.get(allocation.tripExpenseId) ?? 0,
      });
      allocatedLiters += liters;
      allocatedAmount += amount;
    }

    if (!amountsMatch(allocatedLiters, expectedTotalLiters)) {
      throw new ApiError(
        400,
        `Tổng số lít phân bổ ${round2dp(allocatedLiters)} không khớp hóa đơn ${round2dp(expectedTotalLiters)}`,
      );
    }
    if (!amountsMatch(allocatedAmount, expectedTotalAmount)) {
      throw new ApiError(
        400,
        `Tổng tiền phân bổ ${round2dp(allocatedAmount)} không khớp hóa đơn ${round2dp(expectedTotalAmount)}`,
      );
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'FUEL_INVOICE',
      subjectId: invoice.id,
      subjectKey: `fuel-invoice:${invoice.id}:approval:${expectedVersion}`,
      actionKind: 'FUEL_INVOICE_APPROVAL',
      reason: normalizedReason,
      originalVersion: 1,
      originalPeriodLockId: lateApprovalLinks[0]?.sourcePeriodLockId ?? null,
      beforeSnapshot: {
        approvalStatus: invoice.approvalStatus,
        sourceVersion: expectedVersion,
        totalLiters: invoice.totalLiters,
        totalAmount: invoice.totalAmount,
        supplierId: invoice.supplierId,
        allocationCount: allocations.length,
      },
      afterSnapshot: {
        approvalStatus: 'APPROVED',
        targetPeriod: lateApprovalLinks[0]?.targetPeriod ?? invoice.invoiceDate.slice(0, 7),
      },
      deltaSnapshot: {
        payableAmount: invoice.totalAmount,
        sourceVersion: expectedVersion,
        lateApprovalLinks,
      },
      makerId: actorId,
      makerRole: actorRole,
    }).returning();
    return action;
  };
  return runInTx(transaction, execute);
}

export async function requestFuelInvoiceCorrection(input: {
  invoiceId: number;
  expectedVersion: number;
  reason: string;
  correctionType: 'ADJUSTMENT' | 'REVERSAL';
  correctedInvoice?: FuelInvoiceInput;
  makerId: number;
  makerRole: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('FUEL_INVOICE_CORRECTION', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) {
    throw new ApiError(400, 'Lý do điều chỉnh hóa đơn nhiên liệu là bắt buộc');
  }
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new ApiError(400, 'Phiên bản hóa đơn nhiên liệu không hợp lệ');
  }
  if (input.correctionType === 'ADJUSTMENT' && !input.correctedInvoice) {
    throw new ApiError(400, 'Bản điều chỉnh phải có giá trị hóa đơn sau điều chỉnh');
  }
  if (input.correctionType === 'REVERSAL' && input.correctedInvoice) {
    throw new ApiError(400, 'Hoàn tác không được kèm giá trị hóa đơn thay thế');
  }

  const execute = async (tx: Tx) => {
    const [invoice] = await tx.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, input.invoiceId))
      .limit(1)
      .for('update');
    if (!invoice) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    if (invoice.approvalStatus !== 'APPROVED') {
      throw new ApiError(409, 'Chỉ hóa đơn nhiên liệu đã duyệt mới được lập điều chỉnh hoặc hoàn tác');
    }
    if (fuelInvoiceVersion(invoice.updatedAt) !== input.expectedVersion) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được cập nhật. Vui lòng tải lại trước khi điều chỉnh');
    }

    const allocationRows = await tx.select().from(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoice.id))
      .orderBy(s.fuelInvoiceAllocations.id);
    const latestCorrection = await findLatestApprovedFuelInvoiceCorrection(tx, invoice.id);
    const beforeSnapshot = latestCorrection
      ? latestCorrection.afterSnapshot as FuelInvoiceEffectiveSnapshot
      : toFuelInvoiceSnapshot(invoice, allocationRowsToInput(allocationRows));
    if (beforeSnapshot.correctionType === 'REVERSAL') {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được hoàn tác và không thể điều chỉnh tiếp');
    }
    const [activeCorrection] = await tx.select({ id: s.governanceActions.id })
      .from(s.governanceActions)
      .where(and(
        eq(s.governanceActions.subjectType, 'FUEL_INVOICE'),
        eq(s.governanceActions.subjectId, invoice.id),
        eq(s.governanceActions.actionKind, 'FUEL_INVOICE_CORRECTION'),
        inArray(s.governanceActions.status, [
          'PENDING_CHECK',
          'PENDING_APPROVAL',
          'RETURNED_FOR_EVIDENCE',
        ]),
      ))
      .limit(1);
    if (activeCorrection) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã có yêu cầu điều chỉnh đang chờ xử lý');
    }

    let afterSnapshot: FuelInvoiceEffectiveSnapshot;
    if (input.correctionType === 'REVERSAL') {
      afterSnapshot = {
        correctionType: 'REVERSAL',
        invoice: null,
        allocations: [],
      };
    } else {
      const normalized = normalizeFuelInvoiceInput(input.correctedInvoice!);
      await assertFuelSupplier(tx, normalized.supplierId);
      const correctedRows = await buildAllocationRows(tx, invoice.id, normalized);
      afterSnapshot = {
        correctionType: 'ADJUSTMENT',
        invoice: {
          supplierId: normalized.supplierId,
          invoiceNumber: normalized.invoiceNumber,
          invoiceDate: normalized.invoiceDate,
          totalLiters: normalized.totalLiters,
          unitPrice: normalized.unitPrice,
          totalAmount: round2dp(normalized.totalLiters * normalized.unitPrice),
          note: normalized.note ?? null,
        },
        allocations: correctedRows.map((row) => ({
          tripId: row.tripId,
          truckId: row.truckId,
          tripExpenseId: row.tripExpenseId,
          voucherReference: row.voucherReference,
          voucherDate: row.voucherDate,
          liters: Number(row.liters),
          amount: row.amount,
          note: row.note,
        })),
      };
    }

    const [action] = await tx.insert(s.governanceActions).values({
      subjectType: 'FUEL_INVOICE',
      subjectId: invoice.id,
      subjectKey: `fuel-invoice:${invoice.id}`,
      actionKind: 'FUEL_INVOICE_CORRECTION',
      reason,
      // The exact millisecond source version is retained in deltaSnapshot.
      // originalVersion stays within the existing 32-bit governance column.
      originalVersion: Math.max(1, Math.floor(input.expectedVersion / 1000)),
      beforeSnapshot: beforeSnapshot as unknown as Record<string, unknown>,
      afterSnapshot: afterSnapshot as unknown as Record<string, unknown>,
      deltaSnapshot: {
        correctionType: input.correctionType,
        sourceVersion: input.expectedVersion,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    }).returning();
    return action;
  };
  return runInTx(input.transaction, execute);
}

export async function applyFuelInvoiceGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (
    action.subjectType === 'FUEL_INVOICE'
    && action.actionKind === 'FUEL_INVOICE_APPROVAL'
    && action.subjectId != null
    && action.approverId != null
  ) {
    const [invoice] = await tx.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, action.subjectId))
      .limit(1)
      .for('update');
    if (!invoice) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    if (invoice.approvalStatus !== 'PENDING') {
      throw new ApiError(409, `Không thể duyệt hóa đơn đang ở ${invoice.approvalStatus}`);
    }
    const delta = parseFuelLateApprovalDelta(action.deltaSnapshot as Record<string, unknown> | null);
    if (fuelInvoiceVersion(invoice.updatedAt) !== delta.sourceVersion) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã thay đổi; yêu cầu duyệt không thể áp dụng');
    }
    const allocations = await tx.select({
      voucherDate: s.fuelInvoiceAllocations.voucherDate,
    }).from(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoice.id))
      .orderBy(s.fuelInvoiceAllocations.id);
    if (allocations.length === 0) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu không còn dòng phân bổ để xác định kỳ nguồn');
    }
    const finalLateApprovalLinks = await resolveFinalFuelLateApprovalLinks(
      tx,
      allocations.map((allocation) => allocation.voucherDate),
      currentApprovalDate(),
    );
    const nextUpdatedAt = new Date(Math.max(Date.now(), invoice.updatedAt.getTime() + 1));
    const [approved] = await tx.update(s.fuelInvoices)
      .set({
        approvalStatus: 'APPROVED',
        approvedBy: action.approverId,
        approvedAt: new Date(),
        updatedAt: nextUpdatedAt,
      })
      .where(and(
        eq(s.fuelInvoices.id, invoice.id),
        eq(s.fuelInvoices.approvalStatus, 'PENDING'),
      ))
      .returning({ id: s.fuelInvoices.id });
    if (!approved) {
      throw new ApiError(409, 'Hóa đơn đã được người khác xử lý. Vui lòng tải lại.');
    }
    let lateAdjustments: FuelPeriodAdjustmentRow[] = [];
    if (finalLateApprovalLinks.length > 0) {
      if (action.approvedAt == null || action.approverId == null) {
        throw new ApiError(409, 'Yêu cầu duyệt nhiên liệu thiếu thông tin phê duyệt để ghi nhận kỳ điều chỉnh');
      }
      lateAdjustments = await tx.insert(s.fuelPeriodAdjustments).values(
        finalLateApprovalLinks.map((link) => ({
          governanceActionId: action.id,
          fuelInvoiceId: invoice.id,
          sourcePeriodLockId: link.sourcePeriodLockId,
          sourcePeriod: link.sourcePeriod,
          targetPeriod: link.targetPeriod,
        })),
      ).returning();
    }
    return {
      applicationResult: {
        fuelInvoiceId: invoice.id,
        approvalStatus: 'APPROVED',
        payableAmount: delta.payableAmount,
        lateFuelAdjustmentIds: lateAdjustments.map((row) => row.id),
      },
    };
  }
  if (
    action.subjectType !== 'FUEL_INVOICE'
    || action.actionKind !== 'FUEL_INVOICE_CORRECTION'
    || action.subjectId == null
  ) {
    throw new ApiError(409, 'Yêu cầu không thuộc điều chỉnh hóa đơn nhiên liệu');
  }
  const delta = action.deltaSnapshot as Record<string, unknown> | null;
  const sourceVersion = Number(delta?.sourceVersion);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 1) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh thiếu phiên bản nguồn hợp lệ');
  }

  const [invoice] = await tx.select().from(s.fuelInvoices)
    .where(eq(s.fuelInvoices.id, action.subjectId))
    .limit(1)
    .for('update');
  if (!invoice) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu gốc');
  if (invoice.approvalStatus !== 'APPROVED') {
    throw new ApiError(409, 'Hóa đơn nhiên liệu gốc không còn ở trạng thái đã duyệt');
  }
  if (fuelInvoiceVersion(invoice.updatedAt) !== sourceVersion) {
    throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu điều chỉnh không thể áp dụng');
  }

  const nextUpdatedAt = new Date(Math.max(Date.now(), invoice.updatedAt.getTime() + 1));
  const [advanced] = await tx.update(s.fuelInvoices)
    .set({ updatedAt: nextUpdatedAt })
    .where(and(
      eq(s.fuelInvoices.id, invoice.id),
      eq(s.fuelInvoices.approvalStatus, 'APPROVED'),
      eq(s.fuelInvoices.updatedAt, invoice.updatedAt),
    ))
    .returning({ id: s.fuelInvoices.id });
  if (!advanced) {
    throw new ApiError(409, 'Hóa đơn nhiên liệu đã được người khác xử lý. Vui lòng tải lại.');
  }

  const snapshot = action.afterSnapshot as FuelInvoiceEffectiveSnapshot;
  return {
    applicationResult: {
      fuelInvoiceId: invoice.id,
      correctionType: snapshot.correctionType,
      sourceVersion,
      effectiveVersion: fuelInvoiceVersion(nextUpdatedAt),
    },
  };
}
