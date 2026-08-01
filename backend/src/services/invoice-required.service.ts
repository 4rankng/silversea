// Invoice-Required Validator — Wave 2 M3.7 + Wave 3 M4.6 enforcement.
//
// Checks whether a disbursement (expense) has the required invoice data based
// on its category/type's `requiresInvoice` flag. When the flag is true and the
// expense lacks an invoiceNumber/invoiceDate, the approval is blocked.
//
// M3.7 delivered the validators. M4.6 wires them into the approval flow via
// `assertInvoiceRequiredForExpense(expenseId, tx?)`, which is called by
// `transitionApproval` before flipping a trip_expense to APPROVED.

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';
import type { Tx } from './trip-shared';

export interface InvoiceCheckResult {
  requiresInvoice: boolean;
  hasInvoice: boolean;
  missingFields: string[];
}

/**
 * Check if a trip expense (forwarder expense) has the required invoice data.
 * Looks up the forwarderExpenseType's requiresInvoice flag.
 */
export async function checkTripExpenseInvoice(
  expenseTypeId: number,
  invoiceNumber: string | null,
  invoiceDate: string | null,
): Promise<InvoiceCheckResult> {
  const [expenseType] = await db.select({ requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
    .from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.id, expenseTypeId))
    .limit(1);

  const requires = expenseType?.requiresInvoice ?? false;
  return checkInvoiceFields(requires, invoiceNumber, invoiceDate);
}

/**
 * Check if a general expense has the required invoice data.
 * Looks up the expenseCategory's requiresInvoice flag.
 */
export async function checkExpenseInvoice(
  categoryId: number,
  invoiceNumber: string | null,
  invoiceDate: string | null,
): Promise<InvoiceCheckResult> {
  const [category] = await db.select({ requiresInvoice: s.expenseCategories.requiresInvoice })
    .from(s.expenseCategories)
    .where(eq(s.expenseCategories.id, categoryId))
    .limit(1);

  const requires = category?.requiresInvoice ?? false;
  return checkInvoiceFields(requires, invoiceNumber, invoiceDate);
}

function checkInvoiceFields(
  requiresInvoice: boolean,
  invoiceNumber: string | null,
  invoiceDate: string | null,
): InvoiceCheckResult {
  const missingFields: string[] = [];
  if (requiresInvoice) {
    if (!invoiceNumber || !invoiceNumber.trim()) missingFields.push('invoiceNumber');
    if (!invoiceDate) missingFields.push('invoiceDate');
  }
  return {
    requiresInvoice,
    hasInvoice: missingFields.length === 0,
    missingFields,
  };
}

/**
 * Assert that the expense has the required invoice data. Throws ApiError(400)
 * when the requiresInvoice flag is set and invoice fields are missing.
 */
export function assertInvoiceRequired(result: InvoiceCheckResult, label: string): void {
  if (result.requiresInvoice && !result.hasInvoice) {
    throw new ApiError(
      400,
      `${label} yêu cầu hóa đơn — thiếu: ${result.missingFields.join(', ')}`,
    );
  }
}

// ─── M4.6 enforcement wiring ────────────────────────────────────────────────

/**
 * Check a trip expense's invoice requirement by FORWARDER_EXPENSE_TYPE CODE
 * (tripExpenses.expenseType is a varchar FK to forwarderExpenseTypes.code,
 * NOT the id). Looks up the FET by code; returns requiresInvoice=false when
 * the code is unknown so legacy expense codes fail open (backward compat).
 */
export async function checkTripExpenseInvoiceByCode(
  expenseTypeCode: string,
  invoiceNumber: string | null,
  invoiceDate: string | null,
): Promise<InvoiceCheckResult> {
  const [fet] = await db.select({ requiresInvoice: s.forwarderExpenseTypes.requiresInvoice })
    .from(s.forwarderExpenseTypes)
    .where(eq(s.forwarderExpenseTypes.code, expenseTypeCode))
    .limit(1);
  // Fail open when the code is unknown — preserves backward compat for
  // expense rows whose code was renamed or pre-dates the FET registry.
  const requires = fet?.requiresInvoice ?? false;
  return checkInvoiceFields(requires, invoiceNumber, invoiceDate);
}

/**
 * M4.6 enforcement entrypoint. Loads the trip_expense by id, resolves its
 * expenseType code, checks the requiresInvoice flag, and throws ApiError(400)
 * with a Vietnamese field-specific message when the flag is set and either
 * invoiceNumber or invoiceDate is missing.
 *
 * Call BEFORE transitioning a trip_expense to APPROVED. Rejections bypass.
 *
 * `tx` is optional so the check can run inside the caller's transaction
 * (transitionApproval) or standalone.
 */
export async function assertInvoiceRequiredForExpense(
  expenseId: number,
  tx?: Tx,
): Promise<void> {
  const q = tx ?? db;
  const [expense] = await q.select({
    id: s.tripExpenses.id,
    expenseType: s.tripExpenses.expenseType,
    invoiceNumber: s.tripExpenses.invoiceNumber,
    invoiceDate: s.tripExpenses.invoiceDate,
  })
    .from(s.tripExpenses)
    .where(eq(s.tripExpenses.id, expenseId))
    .limit(1);

  // Missing expense → let the transition's own 404 fire.
  if (!expense) return;

  const result = await checkTripExpenseInvoiceByCode(
    expense.expenseType,
    expense.invoiceNumber,
    expense.invoiceDate,
  );
  assertInvoiceRequired(result, 'Chi phí đã chọn');
}
