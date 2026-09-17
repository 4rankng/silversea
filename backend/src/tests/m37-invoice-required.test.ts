/** Invoice-category rules remain validation rules after approval removal. */
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, client } from '../db';
import * as s from '../db/schema';
import type { Tx } from '../services/trip-shared';
import { buildNoInvoicePolicySnapshotForExpenseInput } from '../services/no-invoice-disbursement.service';

async function isolated(run: (tx: Tx) => Promise<void>) {
  const rollback = new Error('rollback invoice policy fixture');
  try {
    await db.transaction(async tx => { await run(tx); throw rollback; });
  } catch (error) { if (error !== rollback) throw error; }
}
async function category(tx: Tx, requiresInvoice: boolean, substituteEvidenceAllowed = true) {
  const [row] = await tx.insert(s.forwarderExpenseTypes).values({
    code: `M37-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Invoice category regression', requiresInvoice, substituteEvidenceAllowed,
    noInvoiceEvidenceTypes: ['RECEIPT'],
  }).returning();
  return row;
}

for (const invoiceNumber of [null, '', '   ']) {
  test(`invoice-required category rejects missing number ${JSON.stringify(invoiceNumber)} at the live input boundary`, () => isolated(async tx => {
    const type = await category(tx, true);
    await assert.rejects(
      buildNoInvoicePolicySnapshotForExpenseInput(tx, { expenseType: type.code, invoiceNumber }),
      (error: Error & { statusCode?: number }) => error.statusCode === 400 && /bắt buộc phải có hóa đơn/.test(error.message),
    );
  }));
}

test('invoice number uses the ordinary invoiced path without an approval policy', () => isolated(async tx => {
  const type = await category(tx, true);
  assert.equal(await buildNoInvoicePolicySnapshotForExpenseInput(tx, { expenseType: type.code, invoiceNumber: 'INV-123' }), null);
}));

test('optional invoice category retains configured substitute evidence', () => isolated(async tx => {
  const type = await category(tx, false);
  const result = await buildNoInvoicePolicySnapshotForExpenseInput(tx, { expenseType: type.code });
  assert.equal(result?.expenseTypeCode, type.code);
  assert.deepEqual(result?.allowedEvidenceTypes, ['RECEIPT']);
  assert.equal(result?.requiredScope, 'TRIP_OR_SHIPMENT');
}));

test('removing approvals does not allow unconfigured or forbidden no-invoice categories', () => isolated(async tx => {
  const type = await category(tx, false, false);
  await assert.rejects(buildNoInvoicePolicySnapshotForExpenseInput(tx, { expenseType: type.code }), /không cho phép/);
  await assert.rejects(buildNoInvoicePolicySnapshotForExpenseInput(tx, { expenseType: `unknown-${type.code}` }), /chưa được cấu hình/);
}));

after(async () => { await client.end(); });
