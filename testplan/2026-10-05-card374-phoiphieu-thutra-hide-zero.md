# Card 2026-10-05_374 — Phơi phiếu: bảng con tổng hợp thu/trả, mặc định ẩn dòng còn 0 (regression case)

Case ID: TC-374-01
Feature: hai bảng báo cáo "Báo cáo Phải thu (theo khách hàng)" / "Báo cáo Phải trả (theo nhà xe)" dưới bảng kiểm soát phơi phiếu (màn `/accounting/phoi-phieu` → `PhoiPhieuControlPage`).

## Quyết định sản phẩm (đặc tả 5.10, khách hàng gửi 05/10/2026)
Bảng tổng hợp thu/trả phơi là **bảng con** nằm dưới bảng tổng hợp phơi phiếu, dùng chung khoảng thời gian đang tìm kiếm, và **mặc định chỉ hiện những khách hàng / nhà xe còn công nợ** — dòng có số còn phải thu/trả = 0 bị ẩn; người dùng vẫn mở được các dòng đã ẩn. Thẻ cũng chốt "không dựng lại bảng nếu hiện trạng đã đúng" — hiện trạng đã có đúng hai bảng con này, chỉ thiếu hành vi ẩn/mở.

## Hiện trạng đã đối chiếu mã nguồn (05/10/2026, HEAD e3f28d70)
- Điểm (a) vị trí: hai bảng con nằm dưới bảng kiểm soát — **đã đúng sẵn** (`PhoiPhieuControlPage.tsx`, khối "Báo cáo tháng").
- Điểm (b) bộ lọc ngày dùng chung: bảng nhận `filters.dateFrom/dateTo` của trang và backend lọc theo `trips.departureDate` — **đã đúng sẵn**.
- Điểm (c) ẩn dòng còn 0: báo cáo trả về cả bên đã thu/trả đủ (`conLai = 0`) — **thiếu, sửa**.
- Điểm (d) mở lại dòng đã ẩn: chưa có — **thiếu, sửa**.

## Repro (trước khi sửa)
1. Đăng nhập kế toán → `/accounting/phoi-phieu` ("Kiểm soát phơi phiếu").
2. Cuộn xuống "Báo cáo tháng": bảng "Báo cáo Phải thu (theo khách hàng)" và "Báo cáo Phải trả (theo nhà xe)".
3. Tìm một khách hàng/nhà xe đã được thu/trả đủ trong kỳ (Còn phải thu/trả = 0): dòng vẫn hiện giữa những bên còn công nợ.
4. Tìm trên bảng một nút/bộ lọc để xem lại dòng đã ẩn: không có.

## Expected (sau khi sửa)
- Dòng có **Còn phải thu = 0** (bảng THU) resp. **Còn phải trả = 0** (bảng TRA) **mặc định bị ẩn**; so sánh số qua `round2dp()` của shared để số lẻ float không quyết định ẩn/hiện.
- Dòng **âm** (trả trước / thu vượt — biểu ghi chú overpay) **không bao giờ bị ẩn** — chỉ ẩn đúng số 0.
- Nút bật/tắt có nhãn đếm số dòng đang ẩn ("Hiện dòng đã ẩn (N)"), bấm ra hiện lại các dòng còn 0; bấm lần nữa ẩn lại. Nút là `<button>` thật (bàn phím hoạt động), có `aria-pressed`, và **disable khi không có dòng nào bị ẩn**.
- **TỔNG CỘNG giữ nguyên số cộng trên TOÀN BỘ dòng (kể cả dòng đang ẩn)** — tổng do server trả; ẩn chỉ là hiển thị, không đổi số. Nhờ vậy bảng vẫn đối chiếu được với công nợ cùng thời điểm.
- STT đánh lại liên tục trên các dòng đang hiện.
- Hai bảng (THU/TRA) có nút ẩn/mở độc lập nhau.

## Automated pins
- `frontend/src/pages/accounting/PhoiPhieuControlPage.reports.test.tsx` —
  (1) dòng còn 0 mặc định biến mất, dòng dương và dòng âm còn hiện, TỔNG CỘNG vẫn tính trên tất cả;
  (2) nút mở ra hiện lại dòng còn 0, bấm lần nữa ẩn lại, `aria-pressed` đổi theo;
  (3) dòng âm (trả trước) không bao giờ ẩn, nút disable khi không còn gì để mở;
  (4) đổi `dateFrom/dateTo` gọi lại báo cáo với kỳ mới (dùng chung bộ lọc của trang).

## Not covered bởi hồ sơ này
- Bằng chứng UI DRIVEN (rung 3, AGENTS §9): chụp màn hình thật + bấm nút thật do lane chính Agent-ZAI thực hiện sau khi deploy staging.
- Cột "đã thu / đã trả trong kỳ" nằm cạnh "còn phải thu" theo hình đặc tả: bảng hiện có **đã** có cột "Đã thu/Đã trả" — mục "Cần chốt với khách hàng" của thẻ chỉ hỏi thêm vị trí cột; không đổi bố cột trong thẻ này.
- Tách hai bảng hay gộp một bảng (mục "Cần chốt"): hiện trạng đã là hai bảng riêng THU/TRA — giữ nguyên, ghi nhận chờ chốt.
