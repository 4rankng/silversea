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
import {
  buildGovernanceAction,
  type GovernanceActionRow,
  type GovernanceApplyResult,
} from './governance-action-core.service';

type FuelInvoiceRow = typeof s.fuelInvoices.$inferSelect;

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

/**
 * 2026-09-11 (maker-checker removal): corrections/reversals MATERIALIZED onto
 * the fuel invoice row at apply time — corrected values replace the stored
 * values and a reversal flips approval_status to REVERSED (allocations are
 * removed). The row itself is therefore the effective view; no overlay.
 */
function toEffectiveFuelInvoiceView(
  invoice: FuelInvoiceRow,
  allocationRows: Array<typeof s.fuelInvoiceAllocations.$inferSelect>,
) {
  return {
    ...toFuelInvoiceView(invoice),
    allocations: allocationRowsToInput(allocationRows),
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
  if (['REJECTED', 'VOIDED', 'RETURN_FOR_EVIDENCE'].includes(expense.approvalStatus)) throw new ApiError(400, 'Chi phí nhiên liệu đã hủy hoặc thiếu chứng từ, chưa thể phân bổ.');
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
      `${allocationLabel} không khớp chi phí nhiên liệu đã ghi nhận: ${computedAmount} != ${approvedAmount}`,
    );
  }

  const authoritativeReferences = buildAuthoritativeReferences(expense);
  const normalizedVoucherReference = normalizeReference(voucherReference);
  if (authoritativeReferences.length > 0) {
    if (!normalizedVoucherReference || !authoritativeReferences.includes(normalizedVoucherReference)) {
      throw new ApiError(
        400,
        `${allocationLabel} phải khớp chứng từ đã lưu của chi phí nhiên liệu: ${authoritativeReferences.join(' / ')}`,
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
    if (allocation.tripExpenseId == null) throw new ApiError(400, 'Mỗi dòng phân bổ phải liên kết chi phí nhiên liệu đã ghi nhận.');
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
  if (!amountsMatch(allocatedLiters, input.totalLiters)) {
    throw new ApiError(
      400,
      `Tổng số lít phân bổ ${allocatedLiters} phải khớp số lít hóa đơn ${input.totalLiters}`,
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
      approvalStatus: 'RECORDED',
    }).returning();
    const rows = await buildAllocationRows(tx, invoice.id, input);
    if (rows.length > 0) await tx.insert(s.fuelInvoiceAllocations).values(rows);
    const periodLinks = await resolveFinalFuelLateApprovalLinks(tx, rows.map((row) => row.voucherDate), currentApprovalDate());
    if (periodLinks.length) await tx.insert(s.fuelPeriodAdjustments).values(periodLinks.map((link) => ({ fuelInvoiceId: invoice.id, sourcePeriodLockId: link.sourcePeriodLockId, sourcePeriod: link.sourcePeriod, targetPeriod: link.targetPeriod })));

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
    if (['REVERSED', 'VOIDED', 'REJECTED'].includes(existing.approvalStatus)) throw new ApiError(409, 'Hóa đơn đã hủy hoặc hoàn tác chỉ được xem trong lịch sử.');
    // KP-152 (approval removal): invoices are APPROVED at creation, so a
    // PENDING-only edit gate would make every correction impossible. The
    // version guard above + the idempotency envelope already protect
    // concurrency; correcting an APPROVED invoice is an ordinary edit.
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
      approvalStatus: 'RECORDED',
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
  return toEffectiveFuelInvoiceView(invoice, allocations);
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
  const allocationRows = await db.select().from(s.fuelInvoiceAllocations)
    .where(inArray(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceIds))
    .orderBy(s.fuelInvoiceAllocations.fuelInvoiceId, s.fuelInvoiceAllocations.id);
  const allocationsByInvoice = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    const current = allocationsByInvoice.get(allocation.fuelInvoiceId) ?? [];
    current.push(allocation);
    allocationsByInvoice.set(allocation.fuelInvoiceId, current);
  }
  return Promise.all(rows.map((invoice) =>
    toEffectiveFuelInvoiceView(
      invoice,
      allocationsByInvoice.get(invoice.id) ?? [],
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
      if (filters.status == null || effectiveRow.approvalStatus === filters.status || (filters.status === 'RECORDED' && effectiveRow.approvalStatus === 'APPROVED')) {
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

// KP-152: approveFuelInvoice removed — fuel invoices are APPROVED at creation.

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
    if (!['RECORDED', 'APPROVED'].includes(invoice.approvalStatus)) {
      throw new ApiError(409, 'Chỉ hóa đơn nhiên liệu đã ghi nhận mới được lập điều chỉnh hoặc hoàn tác');
    }
    if (fuelInvoiceVersion(invoice.updatedAt) !== input.expectedVersion) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được cập nhật. Vui lòng tải lại trước khi điều chỉnh');
    }

    const allocationRows = await tx.select().from(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoice.id))
      .orderBy(s.fuelInvoiceAllocations.id);
    // Corrections used to chain from the latest APPROVED correction snapshot;
    // with the row storage gone, corrected values are materialized onto the
    // invoice itself, so the current row IS the correction chain state. The
    // approvalStatus === 'APPROVED' guard above also rejects corrected rows
    // that were later reversed (reversal materializes REVERSED on the row).
    const beforeSnapshot = toFuelInvoiceSnapshot(invoice, allocationRowsToInput(allocationRows));

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

    return buildGovernanceAction({
      subjectType: 'FUEL_INVOICE',
      subjectId: invoice.id,
      subjectKey: `fuel-invoice:${invoice.id}`,
      actionKind: 'FUEL_INVOICE_CORRECTION',
      reason,
      // The exact millisecond source value is retained in deltaSnapshot.
      // originalVersion stays within the 32-bit original_version range.
      originalVersion: Math.max(1, Math.floor(input.expectedVersion / 1000)),
      beforeSnapshot: beforeSnapshot as unknown as Record<string, unknown>,
      afterSnapshot: afterSnapshot as unknown as Record<string, unknown>,
      deltaSnapshot: {
        correctionType: input.correctionType,
        sourceVersion: input.expectedVersion,
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };
  return runInTx(input.transaction, execute);
}

export async function applyFuelInvoiceGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
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
  if (!['RECORDED', 'APPROVED'].includes(invoice.approvalStatus)) {
    throw new ApiError(409, 'Hóa đơn nhiên liệu gốc không còn ở trạng thái đã ghi nhận');
  }
  if (fuelInvoiceVersion(invoice.updatedAt) !== sourceVersion) {
    throw new ApiError(409, 'Dữ liệu gốc đã thay đổi; yêu cầu điều chỉnh không thể áp dụng');
  }

  const nextUpdatedAt = new Date(Math.max(Date.now(), invoice.updatedAt.getTime() + 1));
  const snapshot = action.afterSnapshot as FuelInvoiceEffectiveSnapshot;

  if (snapshot.correctionType === 'REVERSAL') {
    // Version exclusivity: the FOR UPDATE row lock plus the numeric version
    // pre-check above enforce "no one else touched this". A timestamp
    // equality predicate in the UPDATE below would never match rows whose
    // stored updated_at carries PG microsecond precision (defaultNow()),
    // so it 409'd every correction with 'already handled by someone else'.
    // Materialized reversal: the row flips to REVERSED and its allocations
    // are removed, so every reader (list filter, fuel-AP recon via the
    // effective 'APPROVED' filter) sees the reversal without the dropped
    // governance overlay.
    const [reversed] = await tx.update(s.fuelInvoices)
      .set({
        approvalStatus: 'REVERSED',
        updatedAt: nextUpdatedAt,
      })
      .where(and(
        eq(s.fuelInvoices.id, invoice.id),
        inArray(s.fuelInvoices.approvalStatus, ['RECORDED', 'APPROVED']),
      ))
      .returning({ id: s.fuelInvoices.id });
    if (!reversed) {
      throw new ApiError(409, 'Hóa đơn nhiên liệu đã được người khác xử lý. Vui lòng tải lại.');
    }
    await tx.delete(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoice.id));
    return {
      applicationResult: {
        fuelInvoiceId: invoice.id,
        correctionType: 'REVERSAL',
        sourceVersion,
        effectiveVersion: fuelInvoiceVersion(nextUpdatedAt),
      },
    };
  }

  if (!snapshot.invoice) {
    throw new ApiError(409, 'Bản điều chỉnh hóa đơn nhiên liệu thiếu dữ liệu hiệu lực');
  }
  // Materialized adjustment: corrected header values replace the stored ones
  // and allocation lines are rewritten to match, so the row itself is the
  // effective invoice.
  const [advanced] = await tx.update(s.fuelInvoices)
    .set({
      supplierId: snapshot.invoice.supplierId,
      invoiceNumber: snapshot.invoice.invoiceNumber,
      invoiceDate: snapshot.invoice.invoiceDate,
      totalLiters: String(snapshot.invoice.totalLiters),
      unitPrice: String(snapshot.invoice.unitPrice),
      totalAmount: String(round2dp(snapshot.invoice.totalLiters * snapshot.invoice.unitPrice)),
      note: snapshot.invoice.note,
      updatedAt: nextUpdatedAt,
    })
    .where(and(
      eq(s.fuelInvoices.id, invoice.id),
      inArray(s.fuelInvoices.approvalStatus, ['RECORDED', 'APPROVED']),
    ))
    .returning({ id: s.fuelInvoices.id });
  if (!advanced) {
    throw new ApiError(409, 'Hóa đơn nhiên liệu đã được người khác xử lý. Vui lòng tải lại.');
  }
  const correctedRows = snapshot.allocations.map((allocation) => ({
    fuelInvoiceId: invoice.id,
    tripId: allocation.tripId,
    truckId: allocation.truckId ?? null,
    tripExpenseId: allocation.tripExpenseId ?? null,
    voucherReference: allocation.voucherReference,
    voucherDate: allocation.voucherDate,
    liters: String(allocation.liters),
    amount: allocation.amount,
    note: allocation.note ?? null,
  }));
  await tx.delete(s.fuelInvoiceAllocations)
    .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoice.id));
  if (correctedRows.length > 0) {
    await tx.insert(s.fuelInvoiceAllocations).values(correctedRows);
  }
  return {
    applicationResult: {
      fuelInvoiceId: invoice.id,
      correctionType: 'ADJUSTMENT',
      sourceVersion,
      effectiveVersion: fuelInvoiceVersion(nextUpdatedAt),
    },
  };
}
