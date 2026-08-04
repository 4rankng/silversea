import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';

import { db, client } from '../db';
import * as s from '../db/schema';
import { ApiError } from '../errors';
import { createExpense, updateExpense } from '../services/expense.service';
import { lockApplicationOwnedUniqueness } from '../services/application-owned-uniqueness.service';

const categoryName = `QA supplier validation ${Date.now()}`;
let categoryId: number | undefined;
let supplierId: number | undefined;
let expenseId: number | undefined;
const extraSupplierIds: number[] = [];
const extraCategoryIds: number[] = [];
const truckIds: number[] = [];
const trailerIds: number[] = [];

after(async () => {
  if (expenseId !== undefined) {
    await db.delete(s.expenses).where(eq(s.expenses.id, expenseId));
  }
  if (supplierId !== undefined) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, supplierId));
  }
  for (const id of extraSupplierIds) {
    await db.delete(s.suppliers).where(eq(s.suppliers.id, id));
  }
  if (categoryId !== undefined) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, categoryId));
  }
  for (const id of extraCategoryIds) {
    await db.delete(s.expenseCategories).where(eq(s.expenseCategories.id, id));
  }
  for (const id of truckIds) {
    await db.delete(s.trucks).where(eq(s.trucks.id, id));
  }
  for (const id of trailerIds) {
    await db.delete(s.trailers).where(eq(s.trailers.id, id));
  }
  await client.end();
});

function validInput(overrides: Partial<Parameters<typeof createExpense>[1]> = {}) {
  return {
    expenseDate: '2026-07-26',
    supplierId: supplierId!,
    categoryId: categoryId!,
    amount: '100000',
    paymentStatus: 'PAID',
    ...overrides,
  };
}

async function expectInvalidReference(
  overrides: Partial<Parameters<typeof createExpense>[1]>,
  message: RegExp,
) {
  await assert.rejects(
    db.transaction((tx) => createExpense(tx, validInput(overrides), undefined, true)),
    (error: unknown) => (
      error instanceof ApiError
      && error.statusCode === 400
      && message.test(error.message)
    ),
  );
}

describe('expense service governance boundary', () => {
  test('rejects direct create calls before any database write', async () => {
    const [category] = await db.insert(s.expenseCategories)
      .values({ name: categoryName })
      .returning({ id: s.expenseCategories.id });
    categoryId = category.id;

    await assert.rejects(
      db.transaction((tx) => createExpense(tx, {
        expenseDate: '2026-07-26',
        supplierId: 2_147_483_647,
        categoryId: category.id,
        amount: '100000',
        paymentStatus: 'PAID',
      })),
      (error: unknown) => (
        error instanceof ApiError
        && error.statusCode === 403
        && /chỉ được ghi nhận sau khi hoàn tất phê duyệt/i.test(error.message)
      ),
    );
  });

  test('rejects a direct financially material update while allowing note-only edits', async () => {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `${categoryName} supplier` })
      .returning({ id: s.suppliers.id });
    supplierId = supplier.id;
    const created = await db.transaction((tx) => createExpense(tx, {
      expenseDate: '2026-07-26',
      supplierId: supplier.id,
      categoryId: categoryId!,
      amount: '100000',
      paymentStatus: 'PAID',
      note: 'Phiếu đã quyết toán',
    }, undefined, true));
    expenseId = created.id;

    await assert.rejects(
      db.transaction((tx) => updateExpense(
        tx,
        created.id,
        { amount: '120000' },
        created.updatedAt,
      )),
      (error: unknown) => (
        error instanceof ApiError
        && error.statusCode === 403
        && /chỉ được áp dụng sau phê duyệt/i.test(error.message)
      ),
    );

    const updated = await db.transaction((tx) => updateExpense(
      tx,
      created.id,
      { note: 'Bổ sung ghi chú không tài chính' },
      created.updatedAt,
    ));
    assert.equal(updated.note, 'Bổ sung ghi chú không tài chính');
    assert.equal(updated.amount, '100000');
  });

  test('rejects missing or inactive supplier and expense-category references', async () => {
    const [inactiveSupplier] = await db.insert(s.suppliers)
      .values({ name: `${categoryName} inactive supplier`, status: 'INACTIVE' })
      .returning({ id: s.suppliers.id });
    extraSupplierIds.push(inactiveSupplier.id);
    const [inactiveCategory] = await db.insert(s.expenseCategories)
      .values({ name: `${categoryName} inactive category`, status: 'INACTIVE' })
      .returning({ id: s.expenseCategories.id });
    extraCategoryIds.push(inactiveCategory.id);

    await expectInvalidReference(
      { supplierId: 2_147_483_647 },
      /Nhà cung cấp không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { supplierId: inactiveSupplier.id },
      /Nhà cung cấp không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { categoryId: 2_147_483_647 },
      /Danh mục chi phí không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { categoryId: inactiveCategory.id },
      /Danh mục chi phí không tồn tại hoặc đã ngưng dùng/,
    );
  });

  test('rejects missing or inactive polymorphic truck and trailer references', async () => {
    const suffix = Math.random().toString(36).slice(2, 10).toUpperCase();
    const [inactiveTruck] = await db.insert(s.trucks)
      .values({ licensePlate: `QA-T-${suffix}`, status: 'INACTIVE' })
      .returning({ id: s.trucks.id });
    truckIds.push(inactiveTruck.id);
    const [inactiveTrailer] = await db.insert(s.trailers)
      .values({ licensePlate: `QA-R-${suffix}`, type: '20FT', status: 'INACTIVE' })
      .returning({ id: s.trailers.id });
    trailerIds.push(inactiveTrailer.id);

    await expectInvalidReference(
      { truckId: 2_147_483_647, vehicleComponent: 'TRUCK' },
      /Xe đầu kéo không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { truckId: inactiveTruck.id, vehicleComponent: 'TRUCK' },
      /Xe đầu kéo không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { truckId: 2_147_483_647, vehicleComponent: 'TRAILER' },
      /Rơ-moóc không tồn tại hoặc đã ngưng dùng/,
    );
    await expectInvalidReference(
      { truckId: inactiveTrailer.id, vehicleComponent: 'TRAILER' },
      /Rơ-moóc không tồn tại hoặc đã ngưng dùng/,
    );
  });

  test('serializes supplier retirement against expense creation and leaves no orphan', async () => {
    const [supplier] = await db.insert(s.suppliers)
      .values({ name: `${categoryName} concurrent supplier` })
      .returning({ id: s.suppliers.id });
    extraSupplierIds.push(supplier.id);

    let releaseRetirement!: () => void;
    const retirementMayCommit = new Promise<void>((resolve) => {
      releaseRetirement = resolve;
    });
    let retirementLocked!: () => void;
    const retirementHasLock = new Promise<void>((resolve) => {
      retirementLocked = resolve;
    });
    const retirement = db.transaction(async (tx) => {
      await lockApplicationOwnedUniqueness(tx, 'relationship.supplier', [supplier.id]);
      await tx.update(s.suppliers)
        .set({ status: 'INACTIVE', updatedAt: new Date() })
        .where(eq(s.suppliers.id, supplier.id));
      retirementLocked();
      await retirementMayCommit;
    });
    await retirementHasLock;

    let creationSettled = false;
    const note = `${categoryName} concurrent orphan sentinel`;
    const creation = db.transaction((tx) => createExpense(tx, validInput({
      supplierId: supplier.id,
      note,
    }), undefined, true));
    void creation.then(
      () => { creationSettled = true; },
      () => { creationSettled = true; },
    );
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.equal(creationSettled, false, 'creation must wait for the relationship lock');

    releaseRetirement();
    await retirement;
    await assert.rejects(
      creation,
      (error: unknown) => (
        error instanceof ApiError
        && error.statusCode === 400
        && /Nhà cung cấp không tồn tại hoặc đã ngưng dùng/.test(error.message)
      ),
    );
    const persisted = await db.select({ id: s.expenses.id }).from(s.expenses)
      .where(eq(s.expenses.note, note));
    assert.equal(persisted.length, 0);
  });
});
