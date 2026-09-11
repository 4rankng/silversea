import { db } from '../db';
import { runInTx } from '../lib/tx';
import * as s from '../db/schema';
import { eq, and, sql, desc, isNull, gte, lte, count, sum, type SQL } from 'drizzle-orm';
import { TxnType } from '@tingting/shared';
import { LedgerService } from './ledger.service';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';
import { assertCanMakeGovernanceAction } from './governance-policy';
import { buildGovernanceAction } from './governance-action-core.service';
import type { GovernanceApplyResult, GovernanceActionRow } from './governance-action-core.service';
import { lockApplicationOwnedUniquenessSet } from './application-owned-uniqueness.service';

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

/** Sortable columns of the expense ledger (URL-facing sortBy vocabulary). */
export const EXPENSE_LIST_SORT_KEYS = [
  'expenseDate',
  'supplierName',
  'categoryName',
  'vehiclePlate',
  'vehicleComponent',
  'amount',
  'paymentStatus',
] as const;
export type ExpenseListSortKey = typeof EXPENSE_LIST_SORT_KEYS[number];

export interface ExpenseListFilters {
  truckId?: number;
  supplierId?: number;
  categoryId?: number;
  fromDate?: string;
  toDate?: string;
  page?: number;
  pageSize?: number;
  sortBy?: ExpenseListSortKey;
  sortDir?: 'asc' | 'desc';
}

async function lockAndValidateExpenseReferences(tx: Tx, data: Pick<
  ExpenseCreateInput,
  'supplierId' | 'categoryId' | 'truckId' | 'vehicleComponent'
>) {
  const vehicleComponent = data.truckId == null ? null : (data.vehicleComponent ?? 'TRUCK');
  await lockApplicationOwnedUniquenessSet(tx, [
    { scope: 'relationship.supplier', parts: [data.supplierId] },
    { scope: 'relationship.expense-category', parts: [data.categoryId] },
    ...(data.truckId == null || vehicleComponent == null ? [] : [{
      scope: vehicleComponent === 'TRAILER' ? 'relationship.trailer' : 'relationship.truck',
      parts: [data.truckId],
    }]),
  ]);

  const [supplier] = await tx.select({ id: s.suppliers.id })
    .from(s.suppliers)
    .where(and(
      eq(s.suppliers.id, data.supplierId),
      eq(s.suppliers.status, 'ACTIVE'),
      isNull(s.suppliers.deletedAt),
    ))
    .limit(1)
    .for('share');
  if (!supplier) {
    throw new ApiError(400, 'Nhà cung cấp không tồn tại hoặc đã ngưng dùng');
  }

  const [category] = await tx.select()
    .from(s.expenseCategories)
    .where(and(
      eq(s.expenseCategories.id, data.categoryId),
      eq(s.expenseCategories.status, 'ACTIVE'),
      isNull(s.expenseCategories.deletedAt),
    ))
    .limit(1)
    .for('share');

  if (!category) {
    throw new ApiError(400, 'Danh mục chi phí không tồn tại hoặc đã ngưng dùng');
  }

  if (data.truckId != null) {
    const vehicle = vehicleComponent === 'TRAILER'
      ? await tx.select({ id: s.trailers.id }).from(s.trailers).where(and(
        eq(s.trailers.id, data.truckId),
        eq(s.trailers.status, 'ACTIVE'),
        isNull(s.trailers.deletedAt),
      )).limit(1).for('share')
      : await tx.select({ id: s.trucks.id }).from(s.trucks).where(and(
        eq(s.trucks.id, data.truckId),
        eq(s.trucks.status, 'ACTIVE'),
        isNull(s.trucks.deletedAt),
      )).limit(1).for('share');
    if (!vehicle[0]) {
      throw new ApiError(
        400,
        vehicleComponent === 'TRAILER'
          ? 'Rơ-moóc không tồn tại hoặc đã ngưng dùng'
          : 'Xe đầu kéo không tồn tại hoặc đã ngưng dùng',
      );
    }
  }

  return category;
}

async function validateExpenseInput(tx: Tx, data: ExpenseCreateInput) {
  const category = await lockAndValidateExpenseReferences(tx, data);

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
  return category;
}

export async function createExpense(
  tx: Tx,
  data: ExpenseCreateInput,
  userId?: number,
  governanceApproved = false,
) {
  if (!governanceApproved) {
    throw new ApiError(403, 'Chi phí công ty chỉ được ghi nhận sau khi hoàn tất phê duyệt');
  }
  const category = await validateExpenseInput(tx, data);

  // The expenses table only has truck_id (no trailer_id column yet) —
  // we discriminate truck vs rơ-moóc via the vehicleComponent enum. The
  // ID column holds either trucks.id or trailers.id depending on
  // vehicleComponent. Application-owned relationship validation above
  // resolves the ID against the selected parent table before persistence.
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

export function isGovernedCompanyExpenseMutation(
  existing: typeof s.expenses.$inferSelect,
  data: ExpenseUpdateInput,
): boolean {
  return (
    (data.amount !== undefined && Number(data.amount) !== Number(existing.amount))
    || (data.supplierId !== undefined && data.supplierId !== existing.supplierId)
    || (data.categoryId !== undefined && data.categoryId !== existing.categoryId)
    || (data.expenseDate !== undefined && data.expenseDate !== existing.expenseDate)
    || (data.truckId !== undefined && data.truckId !== existing.truckId)
    || (
      data.vehicleComponent !== undefined
      && data.vehicleComponent !== existing.vehicleComponent
    )
    || (
      data.paymentStatus !== undefined
      && data.paymentStatus !== existing.paymentStatus
    )
  );
}

async function loadExpenseForGovernance(tx: Tx, expenseId: number) {
  const [expense] = await tx.select()
    .from(s.expenses)
    .where(and(eq(s.expenses.id, expenseId), isNull(s.expenses.deletedAt)))
    .limit(1)
    .for('update');
  if (!expense) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }
  return expense;
}

function normalizeExpenseSnapshot(expense: typeof s.expenses.$inferSelect) {
  return {
    expenseDate: expense.expenseDate,
    supplierId: expense.supplierId,
    categoryId: expense.categoryId,
    truckId: expense.truckId,
    vehicleComponent: expense.vehicleComponent,
    amount: expense.amount,
    paymentStatus: expense.paymentStatus,
    validFrom: expense.validFrom?.toISOString() ?? null,
    validTo: expense.validTo?.toISOString() ?? null,
    receiptId: expense.receiptId,
    note: expense.note,
    updatedAt: expense.updatedAt.toISOString(),
  };
}

export async function requestCompanyExpenseGovernance(input: {
  expenseId?: number;
  expectedUpdatedAt?: Date;
  reason: string;
  makerId: number;
  makerRole: string;
  mutation: 'CREATE' | 'UPDATE' | 'DELETE';
  createInput?: ExpenseCreateInput;
  patch?: ExpenseUpdateInput;
  commandKey?: string;
  transaction?: Tx;
}): Promise<GovernanceActionRow> {
  assertCanMakeGovernanceAction('COMPANY_EXPENSE', input.makerRole);
  const reason = input.reason.trim();
  if (!reason) {
    throw new ApiError(400, 'Lý do là bắt buộc');
  }

  const execute = async (tx: Tx) => {
    if (input.mutation === 'CREATE') {
      if (!input.createInput || !input.commandKey) {
        throw new ApiError(400, 'Yêu cầu tạo chi phí thiếu dữ liệu nguồn');
      }
      await validateExpenseInput(tx, input.createInput);
      return buildGovernanceAction({
        subjectType: 'COMPANY_EXPENSE',
        subjectId: null,
        subjectKey: `company-expense:create:${input.commandKey}`,
        actionKind: 'COMPANY_EXPENSE',
        reason,
        originalVersion: 0,
        beforeSnapshot: { exists: false },
        afterSnapshot: { ...input.createInput },
        deltaSnapshot: { mutation: 'CREATE' },
        makerId: input.makerId,
        makerRole: input.makerRole,
      });
    }
    if (input.expenseId == null || input.expectedUpdatedAt == null) {
      throw new ApiError(400, 'Yêu cầu thay đổi chi phí thiếu phiên bản nguồn');
    }
    const existing = await loadExpenseForGovernance(tx, input.expenseId);
    assertExpectedUpdatedAt(existing.updatedAt, input.expectedUpdatedAt);
    const beforeSnapshot = normalizeExpenseSnapshot(existing);
    const afterSnapshot = input.mutation === 'DELETE'
      ? { deletedAt: true }
      : {
        ...beforeSnapshot,
        ...input.patch,
        ...(input.patch?.validFrom !== undefined
          ? { validFrom: input.patch.validFrom ? new Date(input.patch.validFrom).toISOString() : null }
          : {}),
        ...(input.patch?.validTo !== undefined
          ? { validTo: input.patch.validTo ? new Date(input.patch.validTo).toISOString() : null }
          : {}),
      };

    return buildGovernanceAction({
      subjectType: 'COMPANY_EXPENSE',
      subjectId: existing.id,
      subjectKey: `company-expense:${existing.id}:${input.mutation.toLowerCase()}`,
      actionKind: 'COMPANY_EXPENSE',
      reason,
      originalVersion: 1,
      beforeSnapshot,
      afterSnapshot,
      deltaSnapshot: {
        mutation: input.mutation,
        expectedUpdatedAt: input.expectedUpdatedAt.toISOString(),
        applicationMode: input.mutation === 'UPDATE' && existing.paymentStatus !== 'UNPAID'
          ? 'FINALIZED_REPLACEMENT'
          : 'IN_PLACE_ADJUSTMENT',
      },
      makerId: input.makerId,
      makerRole: input.makerRole,
    });
  };

  return runInTx(input.transaction, execute);
}

function assertExpectedUpdatedAt(actual: Date, expected: Date): void {
  if (actual.getTime() !== expected.getTime()) {
    throw new ApiError(
      409,
      'Khoản chi đã được người khác cập nhật. Vui lòng tải lại trước khi lưu.',
    );
  }
}

export async function updateExpense(
  tx: Tx,
  id: number,
  data: ExpenseUpdateInput,
  expectedUpdatedAt: Date,
  _userId?: number,
  governanceApproved = false,
) {
  const [existing] = await tx.select()
    .from(s.expenses)
    .where(and(eq(s.expenses.id, id), isNull(s.expenses.deletedAt)))
    .limit(1)
    .for('update');

  if (!existing) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);
  if (isGovernedCompanyExpenseMutation(existing, data) && !governanceApproved) {
    throw new ApiError(
      403,
      'Thay đổi tài chính của chi phí công ty chỉ được áp dụng sau phê duyệt',
    );
  }

  const relationshipChanged = data.supplierId !== undefined
    || data.categoryId !== undefined
    || data.truckId !== undefined
    || data.vehicleComponent !== undefined;
  const validatedCategory = relationshipChanged
    ? await lockAndValidateExpenseReferences(tx, {
      supplierId: data.supplierId ?? existing.supplierId,
      categoryId: data.categoryId ?? existing.categoryId,
      truckId: data.truckId !== undefined ? data.truckId : existing.truckId,
      vehicleComponent: data.vehicleComponent !== undefined
        ? data.vehicleComponent
        : existing.vehicleComponent,
    })
    : null;

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

  if (validatedCategory) {
    if (validatedCategory.isRenewable && !data.validTo && !existing.validTo) {
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

  const updateValues: Record<string, unknown> = {
    updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
  };
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

export async function deleteExpense(
  tx: Tx,
  id: number,
  expectedUpdatedAt: Date,
  _userId?: number,
  governanceApproved = false,
) {
  if (!governanceApproved) {
    throw new ApiError(403, 'Chi phí công ty chỉ được xóa sau khi hoàn tất phê duyệt');
  }
  const [existing] = await tx.select()
    .from(s.expenses)
    .where(and(eq(s.expenses.id, id), isNull(s.expenses.deletedAt)))
    .limit(1)
    .for('update');

  if (!existing) {
    throw new ApiError(404, 'Không tìm thấy chi phí');
  }
  assertExpectedUpdatedAt(existing.updatedAt, expectedUpdatedAt);

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
    .set({
      deletedAt: new Date(),
      updatedAt: new Date(Math.max(Date.now(), existing.updatedAt.getTime() + 1)),
    })
    .where(eq(s.expenses.id, id));
}

export async function applyCompanyExpenseGovernanceAction(
  tx: Tx,
  action: GovernanceActionRow,
): Promise<GovernanceApplyResult> {
  if (action.actionKind !== 'COMPANY_EXPENSE'
    || action.subjectType !== 'COMPANY_EXPENSE') {
    throw new ApiError(409, 'Loại yêu cầu không thuộc điều chỉnh chi phí công ty');
  }

  const beforeSnapshot = (action.beforeSnapshot ?? {}) as Record<string, unknown>;
  const deltaSnapshot = (action.deltaSnapshot ?? {}) as Record<string, unknown>;
  const mutation = deltaSnapshot.mutation;
  if (mutation === 'CREATE') {
    if (action.subjectId != null || action.approverId == null) {
      throw new ApiError(409, 'Yêu cầu tạo chi phí không hợp lệ');
    }
    const snapshot = (action.afterSnapshot ?? {}) as Record<string, unknown>;
    const created = await createExpense(tx, {
      expenseDate: String(snapshot.expenseDate),
      supplierId: Number(snapshot.supplierId),
      categoryId: Number(snapshot.categoryId),
      truckId: snapshot.truckId == null ? null : Number(snapshot.truckId),
      vehicleComponent: snapshot.vehicleComponent == null
        ? null
        : snapshot.vehicleComponent as ExpenseCreateInput['vehicleComponent'],
      amount: String(snapshot.amount),
      paymentStatus: String(snapshot.paymentStatus),
      validFrom: snapshot.validFrom == null ? null : String(snapshot.validFrom),
      validTo: snapshot.validTo == null ? null : String(snapshot.validTo),
      receiptId: snapshot.receiptId == null ? null : String(snapshot.receiptId),
      note: snapshot.note == null ? null : String(snapshot.note),
    }, action.makerId, true);
    return {
      applicationResult: {
        subjectType: 'COMPANY_EXPENSE',
        subjectId: created.id,
        mutation: 'CREATE',
        paymentStatus: created.paymentStatus,
      },
    };
  }
  if (action.subjectId == null) {
    throw new ApiError(409, 'Yêu cầu thay đổi chi phí thiếu đối tượng nguồn');
  }
  const expectedUpdatedAtRaw = typeof deltaSnapshot.expectedUpdatedAt === 'string'
    ? deltaSnapshot.expectedUpdatedAt
    : typeof beforeSnapshot.updatedAt === 'string'
      ? beforeSnapshot.updatedAt
      : null;
  if (!expectedUpdatedAtRaw) {
    throw new ApiError(409, 'Yêu cầu điều chỉnh chi phí thiếu phiên bản nguồn');
  }
  const expectedUpdatedAt = new Date(expectedUpdatedAtRaw);
  if (Number.isNaN(expectedUpdatedAt.getTime())) {
    throw new ApiError(409, 'Phiên bản nguồn của yêu cầu điều chỉnh không hợp lệ');
  }

  if (mutation === 'DELETE') {
    await deleteExpense(tx, action.subjectId, expectedUpdatedAt, action.approverId ?? undefined, true);
    return {
      applicationResult: {
        subjectType: 'COMPANY_EXPENSE',
        subjectId: action.subjectId,
        mutation: 'DELETE',
      },
    };
  }

  const afterSnapshot = (action.afterSnapshot ?? {}) as Record<string, unknown>;
  const patch: ExpenseUpdateInput = {};
  if (afterSnapshot.expenseDate !== undefined) patch.expenseDate = String(afterSnapshot.expenseDate);
  if (afterSnapshot.supplierId !== undefined) patch.supplierId = Number(afterSnapshot.supplierId);
  if (afterSnapshot.categoryId !== undefined) patch.categoryId = Number(afterSnapshot.categoryId);
  if (afterSnapshot.truckId !== undefined) patch.truckId = afterSnapshot.truckId == null ? null : Number(afterSnapshot.truckId);
  if (afterSnapshot.vehicleComponent !== undefined) {
    patch.vehicleComponent = afterSnapshot.vehicleComponent as ExpenseUpdateInput['vehicleComponent'];
  }
  if (afterSnapshot.amount !== undefined) patch.amount = String(afterSnapshot.amount);
  if (afterSnapshot.paymentStatus !== undefined) patch.paymentStatus = String(afterSnapshot.paymentStatus);
  if (afterSnapshot.validFrom !== undefined) patch.validFrom = afterSnapshot.validFrom == null ? null : String(afterSnapshot.validFrom);
  if (afterSnapshot.validTo !== undefined) patch.validTo = afterSnapshot.validTo == null ? null : String(afterSnapshot.validTo);
  if (afterSnapshot.receiptId !== undefined) patch.receiptId = afterSnapshot.receiptId == null ? null : String(afterSnapshot.receiptId);
  if (afterSnapshot.note !== undefined) patch.note = afterSnapshot.note == null ? null : String(afterSnapshot.note);

  if (deltaSnapshot.applicationMode === 'FINALIZED_REPLACEMENT') {
    const original = await loadExpenseForGovernance(tx, action.subjectId);
    assertExpectedUpdatedAt(original.updatedAt, expectedUpdatedAt);
    if (original.paymentStatus === 'UNPAID') {
      throw new ApiError(409, 'Chi phí nguồn không còn ở trạng thái đã quyết toán');
    }
    const replacement = await createExpense(tx, {
      expenseDate: String(afterSnapshot.expenseDate),
      supplierId: Number(afterSnapshot.supplierId),
      categoryId: Number(afterSnapshot.categoryId),
      truckId: afterSnapshot.truckId == null ? null : Number(afterSnapshot.truckId),
      vehicleComponent: afterSnapshot.vehicleComponent == null
        ? null
        : afterSnapshot.vehicleComponent as ExpenseCreateInput['vehicleComponent'],
      amount: String(afterSnapshot.amount),
      paymentStatus: String(afterSnapshot.paymentStatus),
      validFrom: afterSnapshot.validFrom == null ? null : String(afterSnapshot.validFrom),
      validTo: afterSnapshot.validTo == null ? null : String(afterSnapshot.validTo),
      receiptId: afterSnapshot.receiptId == null ? null : String(afterSnapshot.receiptId),
      note: afterSnapshot.note == null ? null : String(afterSnapshot.note),
    }, action.makerId, true);
    await deleteExpense(
      tx,
      original.id,
      expectedUpdatedAt,
      action.approverId ?? undefined,
      true,
    );
    return {
      applicationResult: {
        subjectType: 'COMPANY_EXPENSE',
        subjectId: original.id,
        mutation: 'UPDATE',
        applicationMode: 'FINALIZED_REPLACEMENT',
        replacementSubjectId: replacement.id,
        originalPreserved: true,
        sourceEvidenceRetained: true,
      },
    };
  }

  const updated = await updateExpense(
    tx,
    action.subjectId,
    patch,
    expectedUpdatedAt,
    action.approverId ?? undefined,
    true,
  );
  return {
    applicationResult: {
      subjectType: 'COMPANY_EXPENSE',
      subjectId: updated.id,
      mutation: 'UPDATE',
      updatedAt: updated.updatedAt.toISOString(),
    },
  };
}

/** Photos attached to a company expense (list view: id, key, uploadedAt). */
export async function getExpensePhotoList(expenseId: number) {
  return db.select({
    id: s.expensePhotos.id,
    storageKey: s.expensePhotos.storageKey,
    uploadedAt: s.expensePhotos.uploadedAt,
  }).from(s.expensePhotos)
    .where(eq(s.expensePhotos.expenseId, expenseId))
    .orderBy(s.expensePhotos.uploadedAt);
}

// Column-sort whitelist for the expense ledger. Every join in the page query
// is 1:1 on a foreign key (suppliers/categories) or mutually exclusive by
// vehicleComponent (trucks/trailers), so sorting by joined columns cannot
// multiply rows. Payment status ranks attention-first (UNPAID before PAID)
// instead of by the enum's alphabetical order.
const EXPENSE_LIST_SORT_SQL: Record<ExpenseListSortKey, SQL> = {
  expenseDate: sql`${s.expenses.expenseDate}`,
  supplierName: sql`${s.suppliers.name}`,
  categoryName: sql`${s.expenseCategories.name}`,
  vehiclePlate: sql`coalesce(${s.trucks.licensePlate}, ${s.trailers.licensePlate})`,
  vehicleComponent: sql`${s.expenses.vehicleComponent}`,
  amount: sql`${s.expenses.amount}`,
  paymentStatus: sql`case when ${s.expenses.paymentStatus} = 'PAID' then 1 else 0 end`,
};

function expenseListOrderBy(filters: ExpenseListFilters): SQL[] {
  if (!filters.sortBy) {
    return [desc(s.expenses.expenseDate), desc(s.expenses.id)];
  }
  return [
    sql`${EXPENSE_LIST_SORT_SQL[filters.sortBy]} ${filters.sortDir === 'desc' ? sql`desc` : sql`asc`} nulls last`,
    desc(s.expenses.id),
  ];
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

  const [items, [countRow], statusRows] = await Promise.all([
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
      .orderBy(...expenseListOrderBy(filters))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    dbOrTx.select({ count: sql<number>`count(*)` })
      .from(s.expenses)
      .where(where),
    // Full-set (page-independent) payment-status aggregates over the SAME
    // filters, so the list page's KPI strip no longer derives headline
    // numbers from whichever page is loaded. Mirrors the payables list
    // precedent (aging.service paginatePayablesSummary) and the advances
    // statusCounts/statusAmounts convention.
    dbOrTx.select({
      paymentStatus: s.expenses.paymentStatus,
      itemCount: count(),
      amount: sum(s.expenses.amount),
    }).from(s.expenses)
      .where(where)
      .groupBy(s.expenses.paymentStatus),
  ]);

  const summary = { totalAmount: 0, paidAmount: 0, unpaidAmount: 0, paidCount: 0, unpaidCount: 0 };
  for (const row of statusRows) {
    const amount = Number(row.amount ?? 0);
    summary.totalAmount += amount;
    if (row.paymentStatus === 'PAID') {
      summary.paidAmount += amount;
      summary.paidCount += Number(row.itemCount ?? 0);
    } else {
      summary.unpaidAmount += amount;
      summary.unpaidCount += Number(row.itemCount ?? 0);
    }
  }

  return { items, total: Number(countRow?.count ?? 0), page, pageSize, summary };
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
