-- SIL-864 (CR-009.2) — overrides trên bảng Kiểm soát lô hàng tách theo
-- container: bảng render một dòng tiền độc lập mỗi container (FCL ≥2 cont),
-- nên lượt sửa trên một dòng ghi (shipment_id, shipment_container_id) của
-- ĐÚNG dòng đó; các dòng anh em giữ baseline cấp lô. shipment_container_id
-- NULL = dòng baseline cấp lô (dữ liệu cũ + lô 1 cont / LCL — dòng duy nhất
-- CHÍNH LÀ lô). UNIQUE NULLS NOT DISTINCT (PG15+) giữ luật at-most-one-row
-- cũ ở tầng DB: một dòng baseline mỗi lô, một dòng override mỗi container.
-- Backfill không cần: dòng hiện hữu giữ NULL = baseline, ngữ nghĩa cũ giữ
-- nguyên cho mọi consumer cấp lô (Chọn Debit, Debit note preview).
ALTER TABLE "shipment_debit_rate_overrides" ADD COLUMN "shipment_container_id" integer;
ALTER TABLE "shipment_debit_rate_overrides" DROP CONSTRAINT "shipment_debit_rate_overrides_pkey";
ALTER TABLE "shipment_debit_rate_overrides" ADD CONSTRAINT "shipment_debit_rate_overrides_pair_unq" UNIQUE NULLS NOT DISTINCT ("shipment_id", "shipment_container_id");
