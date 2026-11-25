-- SIL-1055 (KB §3.5.3, K3.69): CHỈ bốn loại phí được cân nhắc bằng chứng thay
-- thế — OTHER (Phí khác, không hóa đơn), INSPECTION_SVC (dịch vụ kiểm hóa),
-- ZONE_SURCHARGE (phụ phí vùng), ROAD_REPAIR (phí sửa chữa dọc đường). Live
-- rows drifted: rows inserted without the column (schema DEFAULT true — e.g.
-- the card-6 driver fee catalog migration) and QA hand-seeded staging rows
-- left 17 codes with substitute_evidence_allowed = TRUE, so Hàn cont, Đảo vỏ,
-- Cân lốp… could be settled on substitute evidence instead of an invoice.
--
-- Whitelist flip, not a blocklist: every non-KB row returns to false, so any
-- future drifted code is covered the same way. no_invoice_evidence_types is
-- cleared alongside — the config-edit path already keeps those empty whenever
-- the flag is false (config-helpers normalize). Soft-deleted rows are admin
-- data and stay untouched. Idempotent: flipped rows no longer match the guard.
UPDATE forwarder_expense_types
SET substitute_evidence_allowed = FALSE,
    no_invoice_evidence_types = '[]'::jsonb,
    updated_at = now()
WHERE substitute_evidence_allowed = TRUE
  AND code NOT IN ('OTHER', 'INSPECTION_SVC', 'ZONE_SURCHARGE', 'ROAD_REPAIR')
  AND deleted_at IS NULL;
