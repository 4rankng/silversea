# SIL-1167 — /shipments @360px: "Chưa chốt lịch" mất 1px cột chữ cuối ở mép phải thẻ

Case ID: SIL-1167-R1..R2 (QA report 27/11, r43b — build 2881141d, vai tiepvv,
khung 360px; 390px OK. Đo: `.cus-schedule-missing` rectRight = 353px, width
87px, `white-space: nowrap`; mép clip `.cus-dashboard-viewport` = 352px →
vượt 1px; lặp 16 vị trí trên các thẻ; document scrollWidth = 360, không có
cuộn ngang).

**Ticket:** SIL-1167. Màn Tổng quan lô hàng `/shipments`, khung 360px: ô
LỊCH TRÌNH giá trị "Chưa chốt lịch" chạy sát mép phải thẻ, mất 1px cột cuối
chữ "h" của "lịch".
**Owner (implement):** frontend `pages/ShipmentsPage.css` (phone card band).
**Owner (verify):** qa
**Status (this doc):** READY — regression recorded prior to implementation per AGENTS.md §6
**KB:** §10.8.2 (words wrap whole — dòng thân bọc nguyên, không cắt chữ),
no-truncation doctrine (docs/design-guidelines.md §4: cấm clip giá trị ô).

---

## Root cause (verified in source)

Trên phone card band (≤999px), label eyebrow (`LỊCH TRÌNH`, ::before của
`.cus-inline-trigger`) và giá trị đầu tiên đi CHUNG MỘT DÒNG (rule
`.cus-inline-trigger > *:first-child { display: inline }` — SIL-993).
"Chưa chốt lịch" giữ `white-space: nowrap` (SIL-993: đọc nguyên cụm, không
tách "Chưa chốt"/"lịch"). @360px text room của half-cell nhỏ hơn label+cụm →
cụm nowrap tràn khỏi cell, `overflow-x: clip` của `.cus-dashboard-viewport`
cắt cột pixel cuối.

## Case SIL-1167-R1 — @360px (và dải content-fit ≤374px) giá trị hiển thị trọn vẹn, có đệm phải

- **Given** lô chưa chốt lịch trên /shipments (pairing lịch trình cột phải),
  khung 360px.
- **When** render thẻ card band.
- **Then** "Chưa chốt lịch" hiện TRỌN VẸN (đầy đủ chữ "h" cuối), cụm không
  bị tách giữa ("Chưa chốt"/"lịch" bị cấm bởi SIL-993); rectRight của
  `.cus-schedule-missing` ≤ mép clip viewport, đệm phải ≥ 8px. Line label và
  line giá trị tách nhau (cụm có dòng riêng — cùng shape `.cus-schedule-group`).
- **WebKit note (sweep 27/11, playwright webkit):** WebKit KHÔNG có cơ hội
  soft-wrap giữa ::before label và cụm — cụm bám line label ở mọi width
  365–389px — nên break phải ép ở cấp layout (`display: block`), không dựa
  vào line-break của engine. Band ≤374px = content-fit boundary (label run
  ~71–75px + cụm 87px cần half-track mà thẻ dưới 375px không cho được).

## Case SIL-1167-R2 — @390px không regression (và 375px giữ layout expanded như cũ)

- **Given** khung 390px (đang đúng trước fix); 375px content đủ chỗ (WebKit
  sweep: cụm còn ~2.5px đệm, không clip).
- **When** render thẻ.
- **Then** label + giá trị vẫn đi chung một dòng như cũ; các giá trị khác
  trong lưới 2 cột không đổi; fix chỉ nằm trong band `@media (max-width:
  374px)`.
