import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import { round2dp } from '@tingting/shared';

import { db } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';

function amountsMatch(left: number, right: number): boolean {
  return round2dp(left) === round2dp(right);
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
  const trips = tripIds.length > 0
    ? await tx.select({
      id: s.trips.id,
      truckId: s.trips.truckId,
      deletedAt: s.trips.deletedAt,
    }).from(s.trips).where(inArray(s.trips.id, tripIds))
    : [];
  const tripById = new Map(trips.map((trip) => [trip.id, trip]));

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
