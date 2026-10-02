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
  // Card 20260928_181: CUSTOMS sat in NEITHER set, so
  // expenseTypeSeedPolicy returned requiresInvoice:false AND
  // substituteEvidenceAllowed:false — a contradictory state where the approval
  // gate and the evidence gate disagree, and nothing said so. It is a real
  // service with real documentation, not a computed rate: forwarder.service.ts
  // requires a `declarationNumber` for it ("Số tờ khai là bắt buộc cho phí hải
  // quan"), which is the same class as nâng/hạ/cân hàng above.
  'CUSTOMS',
  // Card 20260921_4 — the customer's chi-hộ fee list: all invoice-bearing.
  'LIFT_EMPTY',
  'LIFT_CARGO',
  'YARD_STORAGE_LIFT',
  'LOWER_EMPTY',
  'LOWER_CARGO',
  'YARD_STORAGE',
  'CONTAINER_DEMURRAGE',
  'FEE_EXTENSION',
  'FEE_CLEANING',
  'FEE_SCANNING',
  'FEE_STEVEDORING',
  'FEE_LABOR',
  'FEE_WAREHOUSE',
]);

export const NO_INVOICE_EXPENSE_TYPE_CODES = new Set([
  'INSPECTION_SVC',
  'OTHER',
  // Card 20260928_181: the other half of the pair CUSTOMS/ZONE_SURCHARGE that
  // was in neither set. Classified the OPPOSITE way on purpose — the two are
  // not alike. A zone surcharge is a rate, not a vendor bill:
  // zone-surcharge.service.ts reads it from portZoneSurcharges config, or an
  // ops override, or a driver incidental cost. There is no supplier document
  // to attach, so demanding one would block a legitimate entry.
  'ZONE_SURCHARGE',
  // Card 20260928_165: the road-repair fee ("phí sửa chữa dọc đường") is the
  // hand-written-receipt class — no VAT invoice exists, the driver's receipt is
  // the document the accountant files and settles against (see
  // ROAD_REPAIR_EVIDENCE_TYPE). Leaving it out of BOTH sets would recreate the
  // CUSTOMS/ZONE_SURCHARGE contradiction: requiresInvoice:false AND
  // substituteEvidenceAllowed:false, i.e. the approval gate and the evidence
  // gate disagreeing silently.
  'ROAD_REPAIR',
]);

export function expenseTypeSeedPolicy(code: string): { requiresInvoice: boolean; substituteEvidenceAllowed: boolean } {
  return {
    requiresInvoice: INVOICE_REQUIRED_EXPENSE_TYPE_CODES.has(code),
    substituteEvidenceAllowed: NO_INVOICE_EXPENSE_TYPE_CODES.has(code),
  };
}
