import type { OpsExpenseFinancialDraft } from './OpsExpenseFinancialFields';

/**
 * The client mirror of the server's `receivableForCost`
 * (`backend/src/services/ops-expenses.service.ts`), the one place that answers
 * "does this Ops cost line charge the customer?":
 *
 *  - an invoice-bearing group charges the amount, clamped at 0 — the amount is
 *    signed, so a negative line charges nothing;
 *  - a no-invoice group takes the operator's "Thực thu (thu khách)" override
 *    and defaults to 0 when blank.
 *
 * Kept as ONE exported rule so the declaration form's "Ghi chú bắt buộc" gate
 * cannot drift from the server's 400, which `createOpsExpense` raises after
 * computing this exact number ("Dòng chi không thu khách hàng thì bắt buộc nhập
 * ghi chú"). Ported, not shared: `backend/` is a separate package, and the
 * server stays the authority — this only stops the operator meeting a red
 * toast for something the form already knew.
 */
export function opsCustomerCharge(draft: OpsExpenseFinancialDraft, amount: number): number {
  if (draft.costGroup.startsWith('INVOICED_')) return Math.max(0, Number.isFinite(amount) ? amount : 0);
  const override = draft.customerChargeAmount.trim();
  if (override === '') return 0;
  const parsed = Number(override);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
