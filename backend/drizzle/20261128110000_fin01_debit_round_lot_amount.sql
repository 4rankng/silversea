-- FIN-01 (QA 28/11, đợt Lần 12 · 2026-11: khóa 3.998.800 ₫ vs chốt 4.638.000 ₫,
-- chênh lệch 639.200 ₫ không lộ dòng nào) — đợt chốt debit hiện chỉ ghi TỔNG
-- (debit_settlement_rounds.amount); số từng lô đóng góp vào tổng chỉ tồn tại
-- ở bảng điều động tại thời điểm chốt. Cột nullable này đóng băng con số đó
-- per lô (THU: Tổng thu; TRA: Tổng 1 — Phí RU excluded) để bảng đối chiếu
-- chênh lệch đọc được "đã chốt bao nhiêu cho LÔ NÀY" cả sau khi bảng đổi tiền.
-- Các đợt cũ (cột chưa tồn tại thời điểm chốt) giữ NULL — đường đọc variance
-- rơi về thang bảng hiện hành cho những dòng đó, có nhãn fallback, không bịa 0₫.
ALTER TABLE "debit_settlement_round_lots" ADD COLUMN "amount" numeric(15, 0);
