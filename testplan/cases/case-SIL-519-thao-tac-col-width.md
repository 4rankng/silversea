# SIL-519 — cột THAO TÁC đủ rộng: nút không đè/cắt nhãn kề

- Ticket: SIL-519 (board SIL, id 581, Todo) — owner 26/10, ảnh đính kèm ticket
  (nút giấy xanh đè lên text cột Ghi chú "Xe: H… / LÊN C…", pill "Hoàn thành"
  bị ép sát nút ⋯).
- Surface: `/dispatch-detail` bảng (≥640px), cột THAO TÁC sticky phải.

## Yêu cầu owner

1. Cột THAO TÁC quá hẹp → nút hành động đè lên và cắt nhãn.
2. Expected: mỗi nút (icon Phát lệnh, pill "Hoàn thành", nút ⋯) nằm gọn trong
   cell của nó, label hiển thị ĐỦ, không chồng lên cột kề, không cắt chữ.

## Case pin (expected sau thay đổi)

1. `.detailed-plan-grid__col--actions` ≥ 132px ở sàn 1340px (pill "Hoàn thành"
   ~87px + gap 6 + trigger ⋯ 30px + padding 16 = ≥139px cần cột) — kiểm tra
   floor mới ≥132 trong styles test.
2. `.detailed-plan-grid__row-actions` thêm `flex-wrap: wrap` — van an toàn:
   nếu font rộng hơn dự tính thìwrap xuống dòng trong cell, KHÔNG tràn ra
   cell kề (SIL-515: không overlap).
3. Giữ nguyên các floor owner 23/10 đã pin: Khách hàng ≥180px, Điều phối
   ≥200px, Ghi chú ≥160px, Nâng/Trả ≥110px, tổng shares = 100.
4. Mọi nút giữ nguyên hành vi/menu — chỉ đổi hình học cột.

## Regression lock

- `DetailedPlanGrid.rowheights.styles.test.ts`: floor actions ≥132px +
  row-actions có flex-wrap: wrap.

## Gates

- Scoped vitest + tsgo + rung-3 driver MODE=T3 @1440 (assert mọi button nằm
  trong bounding box cell Thao tác của nó, không đè Ghi chú).
