// Invoice-Required Validator — Wave 2 M3.7.
//
// Checks whether a disbursement (expense) has the required invoice data based
// on its category/type's `requiresInvoice` flag. When the flag is true and the
// expense lacks an invoiceNumber/invoiceDate, the approval is blocked.
//
// Used by the expense-approval flow to enforce M3.7 §2's rule: "which
// disbursement types mandatorily require an invoice?"

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from '../errors';

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
