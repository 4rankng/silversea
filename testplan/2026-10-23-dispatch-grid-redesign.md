# Regression case — Redesign grid Điều vận Chi tiết (owner screenshots 23/10)

Case ID: `QA-2026-10-23-DISPATCH-GRID-REDESIGN`
Source: owner screenshots 23/10/2026 (mobile + 2 desktop-wide) — "UI shitty",
chấp nhận làm lại từ gốc. Spec consult Gemini
(`/tmp/silversea-army2/consult-dispatch-grid.md`) + brief spec A/B/C.

## Reproduction (trước fix)

1. `/dispatch-detail` (dieuvan, local dev data), 390×844:
   - bảng ép viewport hẹp; cột KHÁCH HÀNG cắt còn "...ẢN";
   - SĐT wrap từng ký tự dọc ("0984/9634/84" 3 dòng);
   - chip "Kẹp/Ghép" wrap; mỗi row 4 nút inline (⋯ xanh, Xóa lô ĐỎ, Sửa,
     Ghép) tràn lan che text; chiều cao row lộn xộn.
2. 1440×900 desktop-wide: cột THỜI GIAN + KHÁCH HÀNG chiếm diện tích khổng
   lồ (row ~230px, ~70% trống) trong khi Nâng/Trả cắt cụt ("Cả…", "Bãi…")
   và SĐT wrap ký tự.

## Expected behavior (sau fix)

- R1 Mobile <640px container: bảng → DANH SÁCH THẺ. Card header = KHÁCH
  HÀNG (semibold) + Bill/Booking phụ + badge Loại (Kẹp/Ghép/Đơn) + chip
  trạng thái; body = container + trọng lượng · tuyến đi/trả 2 dòng · SĐT 1
  dòng (không bao giờ wrap ký tự) · ghi chú truncate 1 dòng; action DUY
  NHẤT menu ⋯ 44px góc phải (Đổi nhà xe/BKS · Sửa · Ghép · Xóa lô CUỐI
  menu, confirm riêng) + nút chính Phát lệnh nếu sẵn sàng.
- R2 ≥640px: bảng giữ nguyên thông tin nhưng: min-width mỗi cột (Khách hàng
  ≥180 · Điều phối ≥200 · SĐT 1 dòng nowrap · Ghi chú ≥160) → horizontal
  scroll TRONG container + sticky header; actions = 1 cột pin phải sticky
  chỉ chứa ⋯ menu (+ nút chính compact) — hết nút đỏ inline.
- R3 Desktop: không còn row ~230px trống — row theo nội dung compact
  (~64-88px); cột phình (Thời gian/Khách hàng) thu lại vừa nội dung; cột
  chật (Nâng/Trả/Điều phối) đủ 1 dòng; header wrap tối đa 2 dòng
  (line-clamp-2), không cắt cụt.
- R4 Toàn bộ hành vi现 có giữ nguyên: menu Đổi nhà xe/BKS mở edit pre-filled;
  Phân xe lại mở dialog reassign; Ghép mở PairTripsDialog; Tách nhóm confirm;
  Xóa lô theo role-law CUS/ADMIN; Phát lệnh/Hoàn thành; LCL selection;
  badge nhóm Xem nhóm/Hủy ghép; ghi chú mở dialog.

## Verification matrix

- Playwright 390×844 + 768×1024 + 1440×900 TRƯỚC/SAU (ảnh + DOM assert +
  driver log) → `qa/2026-10-23-dispatch-grid-redesign/`.
- vitest scoped detailed-plan + tsgo/tsc + lint + FULL FE + make build.
