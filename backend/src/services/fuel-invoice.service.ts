import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { round2dp } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';

function amountsMatch(left: number, right: number): boolean {
  return round2dp(left) === round2dp(right);
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

function assertLinkedFuelExpenseAuthority(params: {
  allocationLabel: string;
  tripId: number;
  tripExpenseId: number;
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
    tripExpenseId,
    invoiceSupplierId,
    voucherReference,
    voucherDate,
    computedAmount,
    expense,
    photoCount,
  } = params;

  if (!expense) {
    throw new ApiError(400, `Không tìm thấy chi phí nhiên liệu #${tripExpenseId} cho ${allocationLabel}`);
  }
  if (expense.tripId !== tripId) {
    throw new ApiError(400, `Chi phí nhiên liệu #${tripExpenseId} không thuộc chuyến #${tripId}`);
  }
  if (!isFuelExpenseType(expense.expenseType)) {
    throw new ApiError(400, `Chi phí #${tripExpenseId} không phải chi phí nhiên liệu thực tế`);
  }
  if (expense.supplierId !== invoiceSupplierId) {
    throw new ApiError(400, `Chi phí nhiên liệu #${tripExpenseId} không khớp nhà cung cấp trên hóa đơn`);
  }
  if (expense.approvalStatus !== 'APPROVED') {
    throw new ApiError(400, `Chi phí nhiên liệu #${tripExpenseId} chưa ở trạng thái APPROVED`);
  }
  if (!expense.expenseDate) {
    throw new ApiError(400, `Chi phí nhiên liệu #${tripExpenseId} chưa có ngày chi thực tế để đối chiếu`);
  }
  if (expense.expenseDate !== voucherDate) {
    throw new ApiError(400, `${allocationLabel} phải trùng ngày chi ${expense.expenseDate} của chi phí nhiên liệu #${tripExpenseId}`);
  }
  const approvedAmount = Number(expense.buyAmount);
  if (!amountsMatch(computedAmount, approvedAmount)) {
    throw new ApiError(
      400,
      `${allocationLabel} không khớp chi phí nhiên liệu đã duyệt #${tripExpenseId}: ${computedAmount} != ${approvedAmount}`,
    );
  }

  const authoritativeReferences = buildAuthoritativeReferences(expense);
  const normalizedVoucherReference = normalizeReference(voucherReference);
  if (authoritativeReferences.length > 0) {
    if (!normalizedVoucherReference || !authoritativeReferences.includes(normalizedVoucherReference)) {
      throw new ApiError(
        400,
        `${allocationLabel} phải khớp chứng từ đã duyệt của chi phí nhiên liệu #${tripExpenseId}: ${authoritativeReferences.join(' / ')}`,
      );
    }
    return;
  }

  if (photoCount <= 0) {
    throw new ApiError(
      400,
      `Chi phí nhiên liệu #${tripExpenseId} chưa có số hóa đơn/tờ khai và cũng chưa có ảnh phiếu bơm hoặc chứng từ`,
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
  executor: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
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
      throw new ApiError(400, `Không tìm thấy chuyến #${allocation.tripId} cho dòng phân bổ`);
    }
    if (!allocation.voucherReference) {
      throw new ApiError(400, 'Mỗi dòng phân bổ phải có số phiếu hoặc nhật ký đổ nhiên liệu');
    }
    if (!Number.isFinite(allocation.liters) || allocation.liters <= 0) {
      throw new ApiError(400, 'Số lít trên mỗi dòng phân bổ phải lớn hơn 0');
    }
    if (allocation.tripExpenseId != null) {
      assertLinkedFuelExpenseAuthority({
        allocationLabel: `Dòng phân bổ chuyến #${allocation.tripId}`,
        tripId: allocation.tripId,
        tripExpenseId: allocation.tripExpenseId,
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
      throw new ApiError(400, `Chuyến #${allocation.tripId} chưa có xe để phân bổ nhiên liệu`);
    }
    if (allocation.truckId != null && trip.truckId != null && allocation.truckId !== trip.truckId) {
      throw new ApiError(400, `Xe phân bổ không khớp xe của chuyến #${allocation.tripId}`);
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
) {
  const input = normalizeFuelInvoiceInput(rawInput);
  return db.transaction(async (tx) => {
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
      ...invoice,
      allocations: rows,
      allocatedLiters: rows.reduce((sum, row) => sum + Number(row.liters), 0),
    };
  });
}

export async function updateFuelInvoice(
  invoiceId: number,
  rawInput: FuelInvoiceInput,
) {
  const input = normalizeFuelInvoiceInput(rawInput);
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, invoiceId))
      .limit(1)
      .for('update');
    if (!existing) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    if (existing.approvalStatus !== 'PENDING') {
      throw new ApiError(409, 'Chỉ được sửa hóa đơn nhiên liệu đang chờ duyệt');
    }
    await assertFuelSupplier(tx, input.supplierId);
    const rows = await buildAllocationRows(tx, invoiceId, input);
    await tx.delete(s.fuelInvoiceAllocations)
      .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceId));
    if (rows.length > 0) await tx.insert(s.fuelInvoiceAllocations).values(rows);
    const [updated] = await tx.update(s.fuelInvoices).set({
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      invoiceDate: input.invoiceDate,
      totalLiters: String(input.totalLiters),
      unitPrice: String(input.unitPrice),
      totalAmount: String(round2dp(input.totalLiters * input.unitPrice)),
      note: input.note ?? null,
      updatedAt: new Date(),
    }).where(eq(s.fuelInvoices.id, invoiceId)).returning();
    return { ...updated, allocations: rows };
  });
}

export async function getFuelInvoice(invoiceId: number) {
  const [invoice] = await db.select().from(s.fuelInvoices)
    .where(eq(s.fuelInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
  const allocations = await db.select().from(s.fuelInvoiceAllocations)
    .where(eq(s.fuelInvoiceAllocations.fuelInvoiceId, invoiceId))
    .orderBy(s.fuelInvoiceAllocations.id);
  return { ...invoice, allocations };
}

export async function listFuelInvoices(filters: {
  supplierId?: number;
  status?: string;
} = {}) {
  const conditions = [
    filters.supplierId != null ? eq(s.fuelInvoices.supplierId, filters.supplierId) : undefined,
    filters.status != null ? eq(s.fuelInvoices.approvalStatus, filters.status) : undefined,
  ].filter((condition): condition is NonNullable<typeof condition> => condition != null);
  return db.select().from(s.fuelInvoices)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(s.fuelInvoices.invoiceDate), desc(s.fuelInvoices.id));
}

export async function approveFuelInvoice(
  invoiceId: number,
  actorId: number,
  actorRole: string,
) {
  if (!['ADMIN', 'MANAGER'].includes(actorRole)) {
    throw new ApiError(403, 'Bạn không có quyền duyệt hóa đơn nhiên liệu');
  }

  return db.transaction(async (tx) => {
    const [invoice] = await tx.select()
      .from(s.fuelInvoices)
      .where(eq(s.fuelInvoices.id, invoiceId))
      .limit(1)
      .for('update');

    if (!invoice) {
      throw new ApiError(404, 'Không tìm thấy hóa đơn nhiên liệu');
    }
    if (invoice.approvalStatus !== 'PENDING') {
      throw new ApiError(409, `Không thể duyệt hóa đơn đang ở ${invoice.approvalStatus}`);
    }
    if (invoice.createdBy != null && invoice.createdBy === actorId) {
      throw new ApiError(403, 'Không thể duyệt hóa đơn nhiên liệu do chính mình tạo');
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
        tripExpenseId: allocation.tripExpenseId,
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

    const [approved] = await tx.update(s.fuelInvoices)
      .set({
        approvalStatus: 'APPROVED',
        approvedBy: actorId,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(s.fuelInvoices.id, invoiceId),
        eq(s.fuelInvoices.approvalStatus, 'PENDING'),
      ))
      .returning();

    if (!approved) {
      throw new ApiError(409, 'Hóa đơn đã được người khác xử lý. Vui lòng tải lại.');
    }

    return approved;
  });
}
