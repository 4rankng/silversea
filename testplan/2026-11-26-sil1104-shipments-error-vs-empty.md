# SIL-1104 (id 1280) — lỗi tải dữ liệu ≠ trạng thái trống trên /shipments (K2.157) (regression case)

Case ID: TC-SIL1104-01
Feature: Tổng quan lô hàng (`/shipments`, `ShipmentsPage` + hook `useCusWorkspaceState`) — phân biệt lỗi tải với danh sách thật sự trống.

## Đặc tả (nguồn: thẻ SIL-1104, KB §2.6.2 / K2.157)
- Chặn `/api/shipments/cus-workspace` (lỗi mạng) → trang phải CHỈ hiện banner lỗi + nút "Thử lại".
- Trước fix (build d568cbae): banner lỗi đúng, NHƯNG dưới banner vẫn hiện empty-state "Chưa có lô hàng — Dữ liệu lô hàng sẽ xuất hiện tại đây." và tab đếm "Tất cả lô hàng 0" — trình bày một lần tải thất bại như thể dữ liệu thật sự trống.
- Trạng thái trống thật (bộ lọc vô nghĩa) giữ nguyên thông điệp riêng "Không có lô hàng phù hợp — Điều chỉnh hoặc xóa bộ lọc…".

## Fix (một chỗ, đúng phạm vi — đừng refactor tràn)
- `frontend/src/pages/ShipmentsPage.tsx`:
  1. Empty-state (cả hai biến thể: không filter / có filter) KHÔNG render khi `ws.error` có mặt — vùng danh sách chỉ còn banner lỗi + "Thử lại".
  2. Tab section "Tất cả lô hàng" chỉ mang số đếm khi `ws.data` đã có (`count: ws.data ? total : undefined`) — không hiện "0" khi tải lỗi hoặc đang tải lần đầu.
- Giữ nguyên: banner lỗi + nút "Thử lại" (đúng từ trước); stale data (page cũ + poll lỗi) vẫn render dưới banner — không phải empty-state.
- Rà same-pattern: hook `useCusWorkspaceState` chỉ có ShipmentsPage làm consumer — không trang nào khác dùng cùng hook/component cần sửa. Các list page tự cài (OpsOrdersPage…) là pattern khác, ngoài phạm vi thẻ.

## Automated pins
- `frontend/src/pages/ShipmentsPage.test.tsx` — "SIL-1104 (K2.157): a failed list load shows the error banner ONLY":
  - `apiGet` reject `TypeError('NetworkError…')` → role="alert" + nút "Thử lại" có mặt;
  - không có "Chưa có lô hàng", không có "Không có lô hàng phù hợp", không có bảng lô hàng;
  - tab "Tất cả lô hàng" KHÔNG kèm số đếm (textContent đúng bằng nhãn, không "0").
- Test cũ giữ nguyên: "offers a co-located reset action from the filtered no-results state" chứng minh empty-state thật (bộ lọc vô nghĩa, API trả `[]`) vẫn hoạt động.

## Not covered bởi hồ sơ này
- UI DRIVEN rung 3 chặn mạng thật trên trình duyệt (DevTools offline): lane này chạy vitest + tsc theo phân công orchestrator; repro mock `TypeError` đúng lớp lỗi mạng FE ánh xạ.
- Dịch thông điệp lỗi mạng sang tiếng Việt (K2.161): cố ý KHÔNG thuộc thẻ này (spec ghi rõ chỉ sửa lỗi/empty distinction).
- Các list page khác (OpsOrdersPage, điều xe, …) có empty-state riêng không qua hook này: nếu cần đồng bộ pattern, là thẻ riêng.
