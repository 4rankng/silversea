# Card 370 — Hồi quy: Thông báo Quỹ + cảnh báo nợ đến hạn/quá hạn, container chưa hoàn cược, quỹ âm

Ngày: 2026-10-05 · REQ-5.10-02 · Agent-MiMo

## Phạm vi hồi quy (trước khi làm)

| # | Khu vực | Rủi ro | Trường hợp kiểm |
|---|---|---|---|
| R1 | Khối "Tổng quát về tiền" (card 369) | 2 thẻ due-group + biểu đồ cược + tính đến/Tải lại bị phá | render nguyên vẹn sau khi thêm khối mới; test 369 giữ xanh |
| R2 | `dueGroups` / identity Tổng = Quá hạn + Trong hạn | aggregation mới không được đụng payload cũ | payload 369 nguyên vẹn |
| R3 | Quỹ TM / COMPANY từ treasury service | không tạo bảng số dư song song; không double-count tài khoản | số dư = tổng theo fundCode của fund-book hiện có |
| R4 | Cảnh báo container chưa hoàn cược | phải trùng bảng Theo dõi hoàn cược cùng thời điểm | count + sum(depositAmount) của status CHUA_HOAN_CUOC = bảng |
| R5 | Cảnh báo nợ quá hạn | phải trùng bảng Công nợ phải thu | count + amount khớp receivables overdue |
| R6 | Điều kiện quỹ âm | ĐIỂM DỄ LÀM SAI — chỉ hiện khi CẢ HAI < 0 | test 4 chiều: (+,+), (−,+), (+,−) = ẩn; (−,−) = hiện |
| R7 | Ngày đáo hạn nợ (4 nhóm) | nguồn due-date từ ledger snapshots, TZ | bucket tại TZ=UTC; ranh giới 5/10/30 ngày đúng |
| R8 | Lint / deps | 0 dependency biểu đồ mới | lint scoped 0 problems; lint đúng 0/100 khi tree sạch |

## Quyết định đã chốt (mục Cần chốt với khách hàng)

1. "Dự phòng về dòng tiền" = (Quỹ TM + Quỹ công ty) − tổng nợ phải trả đến hạn trong ≤ 5 ngày (công thức gợi ý trong thẻ, X = 5 khớp cửa sổ "sắp đến hạn").
2. Nhóm hạn theo ngày (theo ví dụ của chính khách hàng "11-30 và 31-60"): Sắp đến hạn ≤ 5 ngày tới; Quá hạn 1–10; Quá hạn 30 ngày = 11–30 ngày quá hạn; Quá hạn 60 ngày = trên 30 ngày quá hạn (gồm >60 — không giấu nợ).
3. Cảnh báo "chạy liên tục" = hiển thị trong ứng dụng trên màn Tổng quan (theo yêu cầu "phía góc phải"), KHÔNG gửi email/Zalo.
