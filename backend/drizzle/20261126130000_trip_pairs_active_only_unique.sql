-- SIL-1021 round 27 (KB Ch.3 §3.5 K3.50): hủy ghép xong phải ghép lại được
-- cùng 2 lệnh — "thử lại không nhân đôi" cũng có nghĩa broken pair không
-- được chiếm vĩnh viễn khóa duy nhất. Index cũ trip_pairs_trip_order_uniq_idx
-- là FULL unique trên (first_trip_id, second_trip_id): row BROKEN (hủy ghép,
-- hủy lệnh, hoàn thành muộn) vẫn giữ khóa, và POST /trips/pairs cho đúng cặp
-- lệnh đó nổ 23505 → 409 'first_trip_id, second_trip_id đã tồn tại' vĩnh viễn
-- (QA round 27: unpair pair 50 xong, ghép lại trips 597+598 fail 2 lần).
--
-- Đổi thành PARTIAL unique chỉ trên hàng ACTIVE: một cặp lệnh chỉ được ĐÚNG
-- MỘT quan hệ ghép sống; mọi row break (breakReason, brokenAt, brokenBy) giữ
-- nguyên làm lịch sử audit. Luật ứng dụng đã chặn 2 pair ACTIVE cùng tuple
-- (assertPairableTrips qua trips.activeTripPairId) nên không thể có duplicate
-- ACTIVE trong data hiện hành — index mới tạo thẳng, không cần dedupe.
DROP INDEX IF EXISTS "trip_pairs_trip_order_uniq_idx";
CREATE UNIQUE INDEX "trip_pairs_trip_order_uniq_idx"
  ON "trip_pairs" ("first_trip_id", "second_trip_id")
  WHERE "status" = 'ACTIVE';
