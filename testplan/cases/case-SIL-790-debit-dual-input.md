# case-SIL-790 — Chốt giá bán: cặp ô Thực chi Ops / Thu khách hàng luôn hiện

## Repro (staging dc930964, 10/11, vai tiepvv)
Drawer Chốt giá bán trên /shipments-debit không có cặp ô "Thực chi Ops" (chỉ
xem) / "Thu khách hàng" (CUS điền) — C18.

## Root cause
Cặp ô REV2 VI.2 là THEO-DÒNG-PHÍ (đã land trong SIL-782); lô KHÔNG có dòng phí
khác nào (lô intake chưa có cont/trip — ví dụ BULK-EXP-0034 trên dev:
chiHoRows=0) → không có dòng nào để gắn cặp ô → mặt phí trống hoàn toàn.

## Fix
1. Lô có cont rows nhưng chưa có phí: seed MỘT dòng nháp "Phí không hóa đơn"
   (UI draft, không persist khi bỏ trống — buildDelta lọc dòng rỗng) kèm cặp ô
   [Thực chi Ops '—' | Thu khách hàng ✏]; Lưu tạo phí + sellAmount trong MỘT
   lần gọi (addOtherFees[] bán thêm sellAmount — schema strictObject mở khóa,
   BE validate không âm + insert dùng giá trị, bỏ hardcode '0').
2. Lô intake (0 chiHoRows): block trạng thái đặt tên "Phí Không HĐ — Thực chi
   Ops 0 ₫ (chỉ xem) · Thu khách hàng: …" thay vì khung trống (luật §6).

## Pins
- ShipmentDebitTables.test: draft row có cặp dual (Thực chi Ops '—' + Thu
  khách hàng input, giá seed); buildDelta gửi sellAmount, dòng trống không gửi.
- ShipmentDebitWorkspace.test: seed đúng khi 0 phí; không seed khi đã có phí;
  intake block hiển thị; Lưu gửi addOtherFees.sellAmount qua schema.
