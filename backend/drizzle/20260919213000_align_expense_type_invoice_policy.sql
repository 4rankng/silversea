-- Alignment: the five invoice-bearing ops types must demand invoices on
-- live rows too. The drift is seed-heritage, not admin intent, so only
-- rows still carrying the exact untouched seed signature flip; any row an
-- admin customized keeps its shape, soft-deleted rows are admin data and
-- stay as they are, and out-of-scope codes are never touched. Idempotent:
-- flipped rows no longer match the guard, and fresh databases hold no
-- drifted rows at all.
UPDATE forwarder_expense_types
SET requires_invoice = TRUE,
    substitute_evidence_allowed = FALSE,
    no_invoice_evidence_types = '[]'::jsonb,
    updated_at = now()
WHERE code IN ('LIFTING', 'LOWERING', 'WEIGHING', 'INFRASTRUCTURE', 'INSPECTION')
  AND requires_invoice = FALSE
  AND substitute_evidence_allowed = TRUE
  AND deleted_at IS NULL;
