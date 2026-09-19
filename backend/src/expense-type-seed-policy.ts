// Invoice policy the seed stamps on forwarder expense types (fill-only —
// admin edits on live rows always win over these defaults). Invoice-bearing
// ops work (nâng, hạ, cân hàng, cơ sở hạ tầng, kiểm hóa) demands a real
// invoice on the approval/settlement path — no substitute evidence. Only
// the true no-invoice class keeps substitute evidence. requiresInvoice
// gates the approval path; it says nothing about debit-screen editability
// (that lock follows each expense row's invoiceNumber).
export const INVOICE_REQUIRED_EXPENSE_TYPE_CODES = new Set([
  'LIFTING',
  'LOWERING',
  'WEIGHING',
  'INFRASTRUCTURE',
  'INSPECTION',
]);

export const NO_INVOICE_EXPENSE_TYPE_CODES = new Set([
  'INSPECTION_SVC',
  'OTHER',
]);

export function expenseTypeSeedPolicy(code: string): { requiresInvoice: boolean; substituteEvidenceAllowed: boolean } {
  return {
    requiresInvoice: INVOICE_REQUIRED_EXPENSE_TYPE_CODES.has(code),
    substituteEvidenceAllowed: NO_INVOICE_EXPENSE_TYPE_CODES.has(code),
  };
}
