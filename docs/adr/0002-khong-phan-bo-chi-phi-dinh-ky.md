# Không phân bổ (no amortization) chi phí định kỳ — ghi toàn bộ vào tháng thanh toán

**Status:** accepted · 2026-05-31

Các chi phí định kỳ (bảo hiểm, đăng kiểm, phí đường bộ) thường là khoản trả một lần cho 6–12 tháng. Theo chuẩn kế toán dồn tích, lẽ ra phải **trải đều (amortize)** chi phí qua các tháng được bao phủ.

**Quyết định:** **Không phân bổ.** Ghi **toàn bộ số tiền vào tháng thanh toán**. Việc theo dõi hạn (nhắc gia hạn) và việc phân bổ chi phí là **hai vấn đề độc lập** — hệ thống chỉ làm nhắc gia hạn (qua `valid_from`/`valid_to` + `reminder_lead_days`), không trải đều chi phí vào P&L.

## Considered Options

- **Phân bổ theo tháng (accrual):** đúng chuẩn kế toán dồn tích, P&L mượt hơn — nhưng cần một "công cụ dồn tích" sinh ra các dòng tháng không ứng với giao dịch thực, đi ngược nguyên tắc "Sổ cái = bản ghi bất biến của giao dịch có thật" của hệ thống.

## Consequences

- Đơn giản: P&L là phép cộng chi phí thực phát sinh trong tháng.
- Đánh đổi: tháng trả bảo hiểm năm sẽ làm Lợi nhuận gộp của xe đó "xấu" đột biến, 11 tháng còn lại "đẹp" hơn thực tế. Ở quy mô hiện tại, đây là sự thật về dòng tiền hơn là sai sót.
- Đã ghi sẵn cột `valid_from`/`valid_to` trên `expenses`, nên nếu sau này cần báo cáo phân bổ thì làm được mà **không cần migration**.
- Người bảo trì code: **đừng tự thêm logic accrual** tưởng là sửa lỗi — đây là quyết định có chủ đích cho MVP.
