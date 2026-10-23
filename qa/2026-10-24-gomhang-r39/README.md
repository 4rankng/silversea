# QA 2026-10-24 — Gộp hàng R39 residuals (FB-127/138/141/145)

Rung-3 driver: `qa/scripts/2026-10-24-gomhang-r39.mjs` (puppeteer, token
inject trước SPA navigation — `puppeteer-spa-auth` pattern).

- **BEFORE** = main checkout b52eb9a3 chưa sửa (FE :7176 → BE :3013).
- **AFTER** = nhánh fix-gomhang-r39 (FE :7185 → BE :3012).
- Cùng DB dev local (:5441). Phase điều khiển bằng `QA_PHASE=before|after`.
- Logs: `gomhang-r39_{before,after}_ui-driver.log` (lệnh, PASS/FAIL từng
  check, exit 0 cả hai phase).

## Evidence nổi bật

| Card | BEFORE (repro) | AFTER (fix) |
|---|---|---|
| FB-138 | `before_fb138_dropdown.png` — dropdown chỉ 4 options Cont (catalog wipe = prod-mirror staging) | `after_fb138_dropdown.png` — grouped "XE TẢI (TẤN)"/"CONTAINER", 11 options; `after_fb138_carrier_reset.png` — đổi sang xe tải bỏ chọn Đội xe nội bộ + warning; `after_fb138_carrier_external_only.png` — nhà xe chỉ xe ngoài |
| FB-127 | `before_fb127_identity.png` — Bill/Booking sau Hình thức XNK | `after_fb127_identity.png` — 2 cụm "Chứng tự & định danh" / "Phân loại nghiệp vụ", Bill/Booking trước |
| FB-141 | `before_fb141_after_save.png` — toast lỗi "BKS không được để trống", DB giữ giá trị cũ | `after_fb141_after_save.png` — toast thành công, DB `billing_truck_no = NULL` |
| FB-145 | `before_fb145_member_after_reload.png` — member còn "0"; `before_fb145_member_class_combobox.png` — còn "Cont 20 - Trọng tải < 20 tấn"; DB `rev_vehicle_class_id` giữ | `after_fb145_member_after_reload.png` — "Chưa xác định"; combobox trống; DB `rev_vehicle_class_id = NULL`; `after_fb145_after_tach_toast.png` — toast [Hoàn tác] |

## Ghi chú kỹ thuật

- FB-138 repro: wipe 7 lớp xe tải khỏi `vehicle_size_classes` (đúng trạng
  thái staging prod-mirror — lớp xe tải trước đó chỉ sống trong DEMO seeder);
  AFTER chạy lại body migration `20261024090000` (INSERT … ON CONFLICT DO
  NOTHING) để hội tụ catalog.
- Type-to-filter trong listbox CÓ SECTION trên React 19.2.6 **dev build** ném
  `childNodes is not supported` (diagnostics render-diff của React dev chạm
  getter của node nội bộ RAC — production build không chạy logging này nên
  staging không bị). Click-pick là đường đã verify rung-3; driver dùng click
  trực tiếp cho sub-flow constraint. Đã ghi testplan case FB-138.
- FB-145 driver dựng nhóm bằng API (`POST /shipments/lcl/rev-group`,
  Idempotency-Key) rồi tách bằng UI thật — đúng flow card.
