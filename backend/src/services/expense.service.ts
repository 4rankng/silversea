import { db } from '../db';
import * as s from '../db/schema';
import { eq, and, sql, desc, isNull, gte, lte } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

export interface ExpenseCreateInput {
  expenseDate: string;
  supplierId: number;
  categoryId: number;
  truckId?: number | null;
  vehicleComponent?: 'TRUCK' | 'TRAILER' | null;
  amount: string;
  paymentStatus: string;
  validFrom?: string | null;
  validTo?: string | null;
  receiptId?: string | null;
  note?: string | null;
}

export interface ExpenseUpdateInput {
  expenseDate?: string;
  supplierId?: number;
  categoryId?: number;
  truckId?: number | null;
  vehicleComponent?: 'TRUCK' | 'TRAILER' | null;
  amount?: string;
  paymentStatus?: string;
  validFrom?: string | null;
  validTo?: string | null;
  receiptId?: string | null;
  note?: string | null;
}

export interface ExpenseListFilters {
  truckId?: number;
  supplierId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
}

export async function createExpense(tx: Tx, data: ExpenseCreateInput, userId?: number) {
  const [category] = await tx.select()
    .from(s.expenseCategories)
    .where(eq(s.expenseCategories.id, data.categoryId))
    .limit(1);

  if (!category) {
    throw new ApiError(400, 'Danh mục chi phí không tồn tại');
  }

  if (category.isRenewable && !data.validTo) {
    throw new ApiError(400, 'Chi phí có thời hạn cần ngày hết hạn (validTo)');
  }

  // Per PRODUCT-SPECS §4.15 + feedback202606 A10.2: expense_date <= today().
  // Back-dating in the past is allowed (NCC reports late); future is rejected.
  if (data.expenseDate) {
    const inputDate = new Date(data.expenseDate);
    if (!isNaN(inputDate.getTime())) {
      const today = new Date();
      today.setHours(23, 59, 59, 999);  // allow entire today
      if (inputDate.getTime() > today.getTime()) {
        throw new ApiError(400, 'Ngày phát sinh chi phí không được trong tương lai');
      }
    }
  }

  // The expenses table only has truck_id (no trailer_id column yet) —
  // we discriminate truck vs rơ-moóc via the vehicleComponent enum. The
  // ID column holds either trucks.id or trailers.id depending on
  // vehicleComponent. (FK constraint nominally points at trucks; in
  // practice trailer IDs land here too and the join-by-component logic
  // in the list query handles the lookup.)
  const [expense] = await tx.insert(s.expenses).values({
    expenseDate: data.expenseDate,
    supplierId: data.supplierId,
    categoryId: data.categoryId,
    truckId: data.truckId ?? null,
    vehicleComponent: data.truckId ? (data.vehicleComponent ?? 'TRUCK') : null,
    amount: data.amount,
    paymentStatus: data.paymentStatus,
    validFrom: data.validFrom ? new Date(data.validFrom) : null,
    validTo: data.validTo ? new Date(data.validTo) : null,
    receiptId: data.receiptId ?? null,
    note: data.note ?? null,
    createdBy: userId ?? null,
  }).returning();

  if (data.paymentStatus === 'UNPAID') {
    await LedgerService.postEntry(tx, {
      txnType: TxnType.VENDOR_EXPENSE,
      txnId: expense.id,
      entityType: 'VENDOR',
      entityId: data.supplierId,
      debit: 0,
      credit: Number(data.amount),
      note: `Chi phí ${category.name}`,
    });
  }

  return expense;
}

export async function updateExpense(tx: Tx, id: number, data: ExpenseUpdateInput, _userId?: number) {
  const [existing] = await tx.select()
    .from(s.expenses)
    .where(and(eq(s.expenses.id, id), isNull(s.expenses.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }

  const originalAmount = Number(existing.amount);
  const wasUnpaid = existing.paymentStatus === 'UNPAID';
  const newAmount = Number(data.amount ?? existing.amount);
  const newSupplierId = data.supplierId ?? existing.supplierId;
  const financialFieldsChanged = wasUnpaid && (
    (data.amount !== undefined && Number(data.amount) !== originalAmount) ||
    (data.supplierId !== undefined && data.supplierId !== existing.supplierId)
  );

  // Only post ledger reversal+re-entry when financial fields actually changed.
  // Non-financial edits (note, dates, photos) should not create ledger entries.
  if (financialFieldsChanged) {
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'VENDOR',
      entityId: existing.supplierId,
      debit: originalAmount,
      credit: 0,
      note: 'Điều chỉnh chi phí (sửa/xóa khoản chưa thanh toán)',
    });
  }

  if (data.categoryId) {
    const [category] = await tx.select()
      .from(s.expenseCategories)
      .where(eq(s.expenseCategories.id, data.categoryId))
      .limit(1);

    if (!category) {
      throw new ApiError(400, 'Danh mục chi phí không tồn tại');
    }

    if (category.isRenewable && !data.validTo && !existing.validTo) {
      throw new ApiError(400, 'Chi phí có thời hạn cần ngày hết hạn (validTo)');
    }
  }

  const newPaymentStatus = data.paymentStatus ?? existing.paymentStatus;

  if (financialFieldsChanged && newPaymentStatus === 'UNPAID') {
    await LedgerService.postEntry(tx, {
      txnType: TxnType.VENDOR_EXPENSE,
      txnId: id,
      entityType: 'VENDOR',
      entityId: newSupplierId,
      debit: 0,
      credit: newAmount,
      note: 'Ghi lại chi phí sau điều chỉnh',
    });
  }

  const updateValues: Record<string, unknown> = { updatedAt: new Date() };
  if (data.expenseDate !== undefined) updateValues.expenseDate = data.expenseDate;
  if (data.supplierId !== undefined) updateValues.supplierId = data.supplierId;
  if (data.categoryId !== undefined) updateValues.categoryId = data.categoryId;
  if (data.truckId !== undefined) {
    updateValues.truckId = data.truckId;
    updateValues.vehicleComponent = data.truckId ? (data.vehicleComponent ?? 'TRUCK') : null;
  } else if (data.vehicleComponent !== undefined) {
    // Enforce the same invariant as createExpense: vehicleComponent must be
    // null when no truck is linked. Without this guard, a caller could set
    // vehicleComponent='TRAILER' on a company-level expense (truckId=null).
    updateValues.vehicleComponent = updateValues.truckId === null ? null : data.vehicleComponent;
  }
  if (data.amount !== undefined) updateValues.amount = data.amount;
  if (data.paymentStatus !== undefined) updateValues.paymentStatus = data.paymentStatus;
  if (data.validFrom !== undefined) updateValues.validFrom = data.validFrom ? new Date(data.validFrom) : null;
  if (data.validTo !== undefined) updateValues.validTo = data.validTo ? new Date(data.validTo) : null;
  if (data.receiptId !== undefined) updateValues.receiptId = data.receiptId;
  if (data.note !== undefined) updateValues.note = data.note;

  const [updated] = await tx.update(s.expenses)
    .set(updateValues)
    .where(eq(s.expenses.id, id))
    .returning();

  return updated;
}

export async function deleteExpense(tx: Tx, id: number, _userId?: number) {
  const [existing] = await tx.select()
    .from(s.expenses)
    .where(and(eq(s.expenses.id, id), isNull(s.expenses.deletedAt)))
    .limit(1);

  if (!existing) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }

  if (existing.paymentStatus === 'UNPAID') {
    await LedgerService.postEntry(tx, {
      txnType: TxnType.ADJUSTMENT,
      txnId: id,
      entityType: 'VENDOR',
      entityId: existing.supplierId,
      debit: Number(existing.amount),
      credit: 0,
      note: 'Hủy chi phí chưa thanh toán',
    });
  }

  await tx.update(s.expenses)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(eq(s.expenses.id, id));
}

export async function listExpenses(dbOrTx: typeof db | Tx, filters: ExpenseListFilters) {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(100, filters.pageSize ?? 20);
  const conditions = [isNull(s.expenses.deletedAt)];

  if (filters.truckId !== undefined) {
    conditions.push(eq(s.expenses.truckId, filters.truckId));
  }
  if (filters.supplierId !== undefined) {
    conditions.push(eq(s.expenses.supplierId, filters.supplierId));
  }
  if (filters.categoryId !== undefined) {
    conditions.push(eq(s.expenses.categoryId, filters.categoryId));
  }
  if (filters.fromDate) {
    conditions.push(gte(s.expenses.expenseDate, filters.fromDate));
  }
  if (filters.toDate) {
    conditions.push(lte(s.expenses.expenseDate, filters.toDate));
  }

  const where = and(...conditions);

  const [items, [countRow]] = await Promise.all([
    dbOrTx.select({
      id: s.expenses.id,
      expenseDate: s.expenses.expenseDate,
      supplierId: s.expenses.supplierId,
      categoryId: s.expenses.categoryId,
      truckId: s.expenses.truckId,
      vehicleComponent: s.expenses.vehicleComponent,
      amount: s.expenses.amount,
      paymentStatus: s.expenses.paymentStatus,
      validFrom: s.expenses.validFrom,
      validTo: s.expenses.validTo,
      receiptId: s.expenses.receiptId,
      note: s.expenses.note,
      createdBy: s.expenses.createdBy,
      createdAt: s.expenses.createdAt,
      updatedAt: s.expenses.updatedAt,
      deletedAt: s.expenses.deletedAt,
      supplier: {
        id: s.suppliers.id,
        name: s.suppliers.name,
        contactPerson: s.suppliers.contactPerson,
        phone: s.suppliers.phone,
        taxCode: s.suppliers.taxCode,
        note: s.suppliers.note,
        status: s.suppliers.status,
        createdAt: s.suppliers.createdAt,
        updatedAt: s.suppliers.updatedAt,
        deletedAt: s.suppliers.deletedAt,
      },
      category: {
        id: s.expenseCategories.id,
        name: s.expenseCategories.name,
        isRenewable: s.expenseCategories.isRenewable,
        reminderLeadDays: s.expenseCategories.reminderLeadDays,
        status: s.expenseCategories.status,
        createdAt: s.expenseCategories.createdAt,
        updatedAt: s.expenseCategories.updatedAt,
        deletedAt: s.expenseCategories.deletedAt,
      },
      truck: {
        id: s.trucks.id,
        licensePlate: s.trucks.licensePlate,
      },
      // Join trailer on the same id column, gated by vehicleComponent so we
      // only get a hit when the expense is actually for a rơ-moóc. The
      // expenses table doesn't have a separate trailer_id column yet, so
      // the truck_id field stores trailer.id when vehicleComponent='TRAILER'
      // — that's the source of Pete's bug ("xe column shows đầu kéo plate
      // even on rơ-moóc expenses"). With this conditional join, the list
      // can pick the right plate.
      trailer: {
        id: s.trailers.id,
        licensePlate: s.trailers.licensePlate,
        type: s.trailers.type,
      },
    }).from(s.expenses)
      .leftJoin(s.suppliers, eq(s.expenses.supplierId, s.suppliers.id))
      .leftJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
      .leftJoin(s.trucks, and(eq(s.expenses.truckId, s.trucks.id), eq(s.expenses.vehicleComponent, 'TRUCK')))
      .leftJoin(s.trailers, and(eq(s.expenses.truckId, s.trailers.id), eq(s.expenses.vehicleComponent, 'TRAILER')))
      .where(where)
      .orderBy(desc(s.expenses.expenseDate), desc(s.expenses.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    dbOrTx.select({ count: sql<number>`count(*)` })
      .from(s.expenses)
      .where(where),
  ]);

  return { items, total: Number(countRow?.count ?? 0), page, pageSize };
}

/**
 * Fetch a single expense (with supplier / category / truck joins) by id.
 * Used by the edit page to pre-populate the form. Returns `null` when the
 * row doesn't exist or is soft-deleted — callers should map that to 404.
 */
export async function getExpense(dbOrTx: typeof db | Tx, id: number) {
  const [row] = await dbOrTx.select({
    id: s.expenses.id,
    expenseDate: s.expenses.expenseDate,
    supplierId: s.expenses.supplierId,
    categoryId: s.expenses.categoryId,
    truckId: s.expenses.truckId,
    vehicleComponent: s.expenses.vehicleComponent,
    amount: s.expenses.amount,
    paymentStatus: s.expenses.paymentStatus,
    validFrom: s.expenses.validFrom,
    validTo: s.expenses.validTo,
    receiptId: s.expenses.receiptId,
    note: s.expenses.note,
    createdBy: s.expenses.createdBy,
    createdAt: s.expenses.createdAt,
    updatedAt: s.expenses.updatedAt,
    deletedAt: s.expenses.deletedAt,
    supplier: {
      id: s.suppliers.id,
      name: s.suppliers.name,
    },
    category: {
      id: s.expenseCategories.id,
      name: s.expenseCategories.name,
      isRenewable: s.expenseCategories.isRenewable,
      reminderLeadDays: s.expenseCategories.reminderLeadDays,
    },
    truck: {
      id: s.trucks.id,
      licensePlate: s.trucks.licensePlate,
    },
    trailer: {
      id: s.trailers.id,
      licensePlate: s.trailers.licensePlate,
      type: s.trailers.type,
    },
  }).from(s.expenses)
    .leftJoin(s.suppliers, eq(s.expenses.supplierId, s.suppliers.id))
    .leftJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
    .leftJoin(s.trucks, and(eq(s.expenses.truckId, s.trucks.id), eq(s.expenses.vehicleComponent, 'TRUCK')))
    .leftJoin(s.trailers, and(eq(s.expenses.truckId, s.trailers.id), eq(s.expenses.vehicleComponent, 'TRAILER')))
    .where(and(eq(s.expenses.id, id), isNull(s.expenses.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getRenewalReminders(dbOrTx: typeof db | Tx) {
  const rows = await dbOrTx.select({
    expenseId: s.expenses.id,
    categoryId: s.expenseCategories.id,
    categoryName: s.expenseCategories.name,
    truckId: s.expenses.truckId,
    truckPlate: s.trucks.licensePlate,
    validTo: s.expenses.validTo,
    reminderLeadDays: s.expenseCategories.reminderLeadDays,
  }).from(s.expenses)
    .innerJoin(s.expenseCategories, eq(s.expenses.categoryId, s.expenseCategories.id))
    .leftJoin(s.trucks, eq(s.expenses.truckId, s.trucks.id))
    .where(and(
      isNull(s.expenses.deletedAt),
      eq(s.expenseCategories.isRenewable, true),
      sql`${s.expenses.validTo} IS NOT NULL`,
    ))
    .orderBy(s.expenses.truckId, s.expenses.categoryId, desc(s.expenses.validTo));

  const latestByGroup = new Map<string, typeof rows[0]>();
  for (const row of rows) {
    const key = `${row.truckId ?? 'company'}-${row.categoryId}`;
    if (!latestByGroup.has(key)) {
      latestByGroup.set(key, row);
    }
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const reminders: Array<{
    id: number;
    expenseId: number;
    categoryId: number;
    categoryName: string;
    truckId: number | null;
    truckPlate: string | null;
    validTo: string;
    reminderLeadDays: number;
    daysRemaining: number;
  }> = [];

  let idCounter = 1;
  const entries = Array.from(latestByGroup.values());
  for (const row of entries) {
    const validToDate = new Date(row.validTo!);
    validToDate.setHours(0, 0, 0, 0);
    const diffMs = validToDate.getTime() - today.getTime();
    const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysRemaining <= (row.reminderLeadDays ?? 30)) {
      reminders.push({
        id: idCounter++,
        expenseId: row.expenseId,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        truckId: row.truckId,
        truckPlate: row.truckPlate ?? null,
        validTo: row.validTo instanceof Date ? row.validTo.toISOString().slice(0, 10) : row.validTo ? String(row.validTo) : '',
        reminderLeadDays: row.reminderLeadDays ?? 30,
        daysRemaining,
      });
    }
  }

  return reminders;
}
