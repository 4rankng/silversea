# SIL-580 (ticket 658) — Hồi quy: fifoAging đếm tuổi nợ từ NGÀY GHI NHẬN khoản

Ngày: 2026-10-30 · Ticket SIL-580 (board id 658) · Ruling chủ dự án 29/10

## Bối cảnh

Commit cb9e7242 (card 061026221213) đổi semantics aging buckets từ "tuổi nợ"
sang "số ngày quá hạn hợp đồng" (days past dueDate), khiến fifoAging.test.ts
đỏ 10/288. SIL-580 repin test theo due-status (7a203617) để xanh lại. Ruling
29/10 của chủ dự án chốt ngược lại cho aging buckets: **aging tính từ NGÀY GHI
NHẬN khoản (ngày phát sinh phải thu/trả trên chứng từ = entry timestamp), đến
hôm nay** — không tính từ dueDate, không tính từ ngày vào kỳ đối soát.

## Phạm vi hồi quy (Regression profile)

| # | Khu vực | Rủi ro hồi quy | Trường hợp kiểm |
|---|---|---|---|
| R1 | `computeFifoAging` bucket cuts | biên 30/60/90 dịch bậc sai | ≤30 → current; 31 → d30 (30–60); 60 → d30; 61 → d60; 90 → d60; 91 → over90 |
| R2 | dueDate không còn kéo bucket | kỳ hạn hợp đồng vẫn làm lệch band | nợ ghi nhận 45 ngày, dueDate tương lai 75 ngày → vẫn d30; 95 ngày tuổi + dueDate tương lai → over90 |
| R3 | KPI "Quá hạn" hợp đồng | `overdueDays`/`maxOverdueDays` bị đổi theo bucket | overdueDays vẫn đếm ngày quá hạn hợp đồng (due-at-issue fallback, cut tại >0); dueDate tương lai → overdueDays = 0 dù bucket theo tuổi |
| R4 | FIFO credits / carry-forward | logic trừ nợ FIFO bị đụng tới | credit áp vào debit cũ nhất; credit dư carry-forward áp vào debit sau |
| R5 | Legacy row không dueDate, không timestamp | bucket rơi vãi | null timestamp → current (age 0); sum-of-buckets khớp tổng còn nợ |
| R6 | Consumers backend | aging.service / customer-receivable-authority / statement-supplier dùng `aging` buckets kế thừa — tự theo semantics mới | BE suite 338/338 xanh; aging-overdue-due-date.test.ts repin band block theo ruling, giữ nguyên overdueDays assertions |

## Trường hợp biên bắt buộc (ruling)

- Khoản ghi nhận **31 ngày trước** → bucket **30–60 (d30)** — test
  "a debt recorded 31 days ago ages into the 30–60 bucket".

## Bằng chứng (evidence)

- `qa/2026-10-30_sil580-fifo-aging_shared-test.log` — shared 306/306, exit 0
- `qa/2026-10-30_sil580-fifo-aging_be-test.log` — backend suite, exit 0
- `qa/2026-10-30_sil580-fifo-aging_be-tsc.log` / `_fe-tsc.log` — exit 0
- `qa/2026-10-30_sil580-fifo-aging_root-lint.log` — 0 errors, exit 0
- `make build` — exit 0 (frontend dist built 30.8s)

## Ngoại phạm vi rõ ràng

- `ap-aging.service.ts` và các surface AP/frontend (PayableListPage,
  DebtListPage nhãn "CHƯA ĐẾN HẠN/QUÁ HẠN…") KHÔNG tiêu thụ bucket của
  `computeFifoAging` — nếu muốn re-anchor sang ngày ghi nhận cần ticket riêng.
- Nhãn bucket trên UI (AGI_RANGES) là quyết định product, không thuộc ticket
  TECH-DEBT này.
