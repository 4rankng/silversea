# SIL-520 — dialog "Chỉnh sửa điều phối" dùng khoảng trống ngang, hết cuộn dọc

- Ticket: SIL-520 (board SIL, id 582, Todo) — owner 26/10, ảnh đính kèm ticket
  (dialog ~560px giữa màn 1440, hai bên trống lớn, "Phát lệnh cho tài xế" cắt
  dưới fold, phải cuộn để tới footer).
- Surface: `/dispatch-detail` — dialog "Chỉnh sửa điều phối" của grid chi tiết
  (cả mount ẩn trong card mobile dùng cùng dialog qua shared Modal).

## Yêu cầu owner

1. Dialog cố định hẹp trong khi màn hình còn nhiều khoảng trống hai bên.
2. Expected: dialog dùng được bề rộng màn hình (responsive, rộng hơn) để form
   hiển thị ĐỦ không cần cuộn dọc — gồm cả section "Phát lệnh cho tài xế" và
   footer "Hủy / Lưu thay đổi / Phát lệnh".

## Case pin (expected sau thay đổi)

1. `maxWidth` của Modal chuyển `560` → `min(1000px, calc(100vw - 96px))` —
   @1440 dialog ≥900px, dùng khoảng trống hai bên, vẫn cap ở viewport.
2. @media ≥900px: grid fields ghép "Giờ điều vận" + "Giờ trả hàng" chung một
   hàng (`run end`) — mỗi segmented datetime ≥370px, an toàn (luật full-width
   row cũ chỉ cần ở dialog hẹp ~560px).
3. Modal body KHÔNG cuộn dọc ở viewport desktop (scrollHeight ≤ clientHeight)
   khi có fieldset "Phát lệnh cho tài xế"; footer luôn visible.
4. Không đổi hành vi lưu/phát lệnh — chỉ hình học dialog.

## Regression lock

- Driver MODE=T4: width ≥900 @1440 + body không cuộn + fieldset trên footer.

## Gates

- Scoped vitest + tsgo + rung-3 driver MODE=T4 @1440.
