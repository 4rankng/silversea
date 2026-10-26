# SIL-515 — Kế hoạch Chi tiết Xe: cấm truncate toàn bảng + sửa overlap cột THỜI GIAN & LỊCH TRÌNH

- Ticket: SIL-515 (board SIL, id 577, In Progress) — owner 26/10, ảnh `chitiet-xe-overlap.jpg`.
- Surface: `/dispatch-detail` bảng (≥640px), mọi role đọc bảng (ĐV/CUS/ADMIN/MANAGER).

## Yêu cầu owner

1. Cột THỜI GIAN & LỊCH TRÌNH: "Ngày giao 23/10/2026" đè lên cột bên cạnh
   (ảnh: datetime chạy thẳng vào tên khách "LOG COM").
2. CẤM truncate TOÀN BẢNG — bỏ ellipsis/nowrap mọi cell, wrap full,
   h-scroll thay vì cắt chữ ("NORIGHTFREIG…" bị cắt là defect mẫu).
3. Header 2 dòng không đè nhau (THỜI GIAN &/LỊCH TRÌNH; KHÁCH HÀNG &/LÔ TRÌNH).
4. Audit mọi cột.

## Case pin (expected sau thay đổi)

1. Mọi value line của bảng (`__line`, `ops-schedule__datetime`, các fact
   Điều phối, classification, LCL tag, combined note, note preview) computed
   `white-space: normal` — không nowrap, không ellipsis, không
   `-webkit-line-clamp`, không `overflow: hidden` cắt chữ.
2. Không line nào tràn ra ngoài `<td>` của nó (bounding box trong cell) —
   hết class "Ngày giao đè Trả hàng"; `overflow-wrap: anywhere` chỉ như
   van cho token không dấu cách dài hơn cột.
3. Header sort button `display: block` — label wrap đầy đủ, không clamp
   (header row cao theo label, không line nào bị ẩn).
4. Full text render: `innerText == textContent` trên mọi value line
   (không đuôi ẩn).

## Regression lock

- Styles pin: `DetailedPlanGrid.rowheights.styles.test.ts` (rewrite luật cũ
  23/10 → luật SIL-515), `DetailedPlanGrid.test.tsx` (header no-clamp),
  `DetailedPlanGrid.container-port-weight.test.tsx` (container wrap),
  `DispatchDriverNote.test.tsx` (compact không clamp),
  `src/styles/table-no-truncation.styles.test.ts` — case doctrine
  "detailed-plan grid cells wrap full (SIL-515)".
- UI drive: `qa/scripts/2026-10-26-sil515-no-truncate-ui-drive.mjs`
  (PHASE=before|after, @1440/@1280, audit computed-style + hình học
  + stress giá trị dài) → `qa/2026-10-26-sil515-no-truncate/`.

## Kết quả 26/10

- BEFORE (HEAD cũ): `scheduleOverlap.overlaps: true` (line 76..212 đè td
  68..202), 15+ line nowrap+ellipsis, 1 line tràn ngang — tái hiện đúng ảnh.
- AFTER: 0 violation mọi nhóm @1440/@1280 cả real lẫn stress; hiddenTail
  rỗng (mọi ký tự render); header không clip.
- Gates: scoped vitest 46 file 524/524 pass; tsgo --noEmit exit 0.

## Lịch sử

- 2026-10-26: tạo case khi implement SIL-515.
