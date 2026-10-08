# Card 369 — Hồi quy: Tổng quan tiền (công nợ theo hạn + biểu đồ cược)

Ngày: 2026-10-05 · REQ-5.10-01 · Agent-MiMo

## Phạm vi hồi quy (Regression profile — trước khi làm)

| # | Khu vực | Rủi ro hồi quy | Trường hợp kiểm |
|---|---|---|---|
| R1 | `getReceivablesSummary` payload | field mới `dueGroups` không được phá consumers cũ (buckets, totalOutstanding, overdueAmount) | ReceivablesSummary giữ nguyên shape cũ; thêm field; identity inTerm+overdue ≈ totalOutstanding (≤ 1 ₫ làm tròn) |
| R2 | `getPayablesSummary` payload | idem, consumers in-process (`mergePayablesSummaries`, `paginatePayablesSummary`) | shape cũ nguyên vẹn; dueGroups tính trên full set |
| R3 | Bucket filter `AgingBucketFilter` | giá trị mới `'overdue'` không được đổi hành vi 4 bucket cũ | current/d30/d60/over90 filter như cũ; overdue = có bất kỳ phần quá hạn nào |
| R4 | `/reports/payables-summary?bucket=` | search/pagination/totals cũ | headline full-set không đổi; items + totals thu theo bucket |
| R5 | `/debt?filter=` , `/payables?filter=` | URL filter cũ (?filter=current|d30|d60|over90 trên /debt) | deep-link cũ không đổi; thêm overdue + payables filter |
| R6 | `AccountingOverview` | 6 mục SummaryRail hiện tại phục vụ người dùng | không xoá mục nào; 2 thẻ mới + biểu đồ + tính đến/Tải lại |
| R7 | Deposit weekly aggregation | bucket tuần T2–CN, TZ | tuần rỗng = cột 0; refund bucket theo `refundPostedAt`; TZ=UTC khi test |
| R8 | Không dependency biểu đồ mới | `pnpm lint` đúng 0 errors / 100 warnings | lint diff = 0 warning mới |

## Quyết định đã chốt (khách hàng open questions)

1. Tuần = tuần lịch T2 → CN.
2. Tuần chưa có dữ liệu → hiển thị cột 0 (giữ trục so sánh ổn định).
3. "Số lượng" đếm theo thực thể (khách hàng / NCC) theo nhóm hạn, hiện diện (một khách có cả phần trong hạn lẫn quá hạn được đếm ở CẢ hai nhóm).
4. Biểu đồ cược: `depositAmount` + `count` bucket theo tuần `createdAt` (phát sinh nghĩa vụ cược); `refundedAmount` bucket theo tuần `refundPostedAt` (tiền về) — semantics sự kiện, phục vụ dự kiến nguồn tiền.
