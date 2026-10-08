-- ==============================================================================
-- ROLLBACK for onboard-cusonboard-2026-10-02.sql (run ONLY if needed).
-- Restores pre-onboarding state for every field that script touched.
-- Full-table fallback: qa/2026-10-02-onboarding-prod-backup.sql
-- ==============================================================================

BEGIN;

-- A. Staff phones -> back to NULL
UPDATE users SET phone=NULL, updated_at=NOW()
WHERE username IN ('phuongnt','namnv','tiepvv','hoapt','liennt','lydp','bacdk','anhdtv','huyenntt','hoangnh','hungld','duongtt','tuvn','dungnv','thanhdc','hoangnm','myvtt')
  AND deleted_at IS NULL;

-- B1. Driver Dũng phone -> office-Dũng number (pre-fix value)
UPDATE drivers SET phone='0362157612', updated_at=NOW()
WHERE code='NVDUNG' AND id_number='027083019159' AND deleted_at IS NULL;

-- B2. Remove the two created drivers + their logins (no trips reference them yet)
UPDATE drivers SET deleted_at=NOW(), updated_at=NOW() WHERE code IN ('BNGLONG','LQHAO') AND deleted_at IS NULL;
UPDATE users SET deleted_at=NOW(), updated_at=NOW() WHERE username IN ('bnlong','lqhao') AND deleted_at IS NULL;

-- C. Route distance back to 120
UPDATE routes SET distance_km=120, updated_at=NOW() WHERE code='KCN Đồng Văn' AND deleted_at IS NULL;

-- D. Fleet enrichment -> back to NULL
UPDATE trucks SET tow_capacity_tons=NULL, preferred_route=NULL, note=NULL, updated_at=NOW()
WHERE deleted_at IS NULL AND tow_capacity_tons IN (33,22,29) AND note LIKE 'Nhóm %';
UPDATE trailers SET max_payload_tons=NULL, updated_at=NOW()
WHERE deleted_at IS NULL AND max_payload_tons IN (25,15);

-- E. ASKEY 4h rule append -> strip the appended block
UPDATE operational_sites SET strict_rules = regexp_replace(strict_rules, E'\n- QUY ĐỊNH THỜI GIAN VẬN CHUYỂN TỐI ĐA 4 GIỜ[^€]*', '', ''), updated_at=NOW()
WHERE code IN ('ASKEY-1','ASKEY-2') AND deleted_at IS NULL AND strict_rules LIKE '%4 GIỜ%';

-- F. Pricing engine rows created 2026-10-02
UPDATE freight_rate_terms SET deleted_at=NOW(), updated_at=NOW() WHERE customer_id=1 AND effective_date=DATE '2026-10-02' AND deleted_at IS NULL;
UPDATE pricing_tables SET deleted_at=NOW(), updated_at=NOW() WHERE customer_id=1 AND effective_date=DATE '2026-10-02' AND deleted_at IS NULL;
UPDATE fuel_consumption_norms SET deleted_at=NOW(), updated_at=NOW() WHERE effective_date=DATE '2026-10-02' AND note LIKE 'cusonboard%';
UPDATE fuel_price_periods SET deleted_at=NOW(), updated_at=NOW() WHERE effective_from=DATE '2026-10-02' AND source_note LIKE 'cusonboard%';

-- G. Debit template issuer -> back to empty, terms_text suffix removed
UPDATE debit_note_templates SET
  issuer_name=NULL, issuer_address=NULL, issuer_tax_code=NULL, issuer_representative=NULL,
  terms_text = regexp_replace(terms_text, E'\nThanh toán chuyển khoản: STK 0031000391518[^€]*', '', ''),
  updated_at=NOW()
WHERE id=1 AND deleted_at IS NULL;

COMMIT;
