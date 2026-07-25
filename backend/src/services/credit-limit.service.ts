// Credit-Limit + Threshold Service — Wave 3 M5.3.
//
// Checks a customer's outstanding AR against their credit limit + warning
// threshold. When outstanding exceeds the credit limit, new charges are
// blocked unless an approver overrides. When outstanding exceeds the warning
// threshold (e.g. 80% of limit), a warning is returned but the charge
// proceeds.
//
// Uses the existing customers.creditLimit + customers.creditWarningThreshold
// columns (added in the Wave 3 schema slice) and the getCustomerArSummary
// function from the M5.1 AR status service.

import { db } from '../db';
import * as s from '../db/schema';
import { eq } from 'drizzle-orm';
import { getCustomerArSummary } from './ar-status.service';

export interface CreditCheckResult {
  customerId: number;
  creditLimit: number | null;
  outstanding: number;
  /** Utilization ratio = outstanding / creditLimit. null when no limit. */
  utilization: number | null;
  warningThreshold: number | null;
  /** True when outstanding >= creditLimit (blocked). */
  exceedsLimit: boolean;
  /** True when outstanding >= creditLimit * warningThreshold (warning). */
  exceedsWarning: boolean;
  /** True when an approver override was provided and the charge should proceed. */
  overridden: boolean;
}

/**
 * Check a customer's credit status. Does NOT block — returns the status so
 * the caller (route handler) can decide whether to allow, warn, or reject.
 *
 * @param approverOverride When true, the caller asserts they have approver
 *   authority and the charge should proceed even if exceedsLimit.
 */
export async function checkCreditLimit(
  customerId: number,
  approverOverride: boolean = false,
): Promise<CreditCheckResult> {
  const [customer] = await db.select({
    creditLimit: s.customers.creditLimit,
    creditWarningThreshold: s.customers.creditWarningThreshold,
  })
    .from(s.customers)
    .where(eq(s.customers.id, customerId))
    .limit(1);

  const creditLimit = customer?.creditLimit ? Number(customer.creditLimit) : null;
  const warningThreshold = customer?.creditWarningThreshold ? Number(customer.creditWarningThreshold) : null;

  const { outstanding } = await getCustomerArSummary(customerId);

  const utilization = creditLimit && creditLimit > 0 ? outstanding / creditLimit : null;
  const exceedsLimit = creditLimit != null && outstanding >= creditLimit;
  const warningRatio = warningThreshold ?? 0.8; // default 80% per PRD M5.3 §1
  const exceedsWarning = creditLimit != null && utilization != null && utilization >= warningRatio;

  return {
    customerId,
    creditLimit,
    outstanding,
    utilization,
    warningThreshold,
    exceedsLimit,
    exceedsWarning,
    overridden: approverOverride && exceedsLimit,
  };
}

/**
 * Assert that a charge is allowed. Throws 403 when the credit limit is
 * exceeded and no approver override was provided.
 */
export async function assertCreditLimit(
  customerId: number,
  approverOverride: boolean = false,
): Promise<CreditCheckResult> {
  const result = await checkCreditLimit(customerId, approverOverride);

  if (result.exceedsLimit && !result.overridden) {
    const limit = result.creditLimit?.toLocaleString('vi-VN') ?? '—';
    const outstanding = result.outstanding.toLocaleString('vi-VN');
    throw new Error(
      `Khách hàng đã vượt hạn mức tín dụng (hạn mức: ${limit} ₫, công nợ: ${outstanding} ₫). ` +
      `Cần phê duyệt để tiếp tục.`,
    );
  }

  return result;
}
