# SIL-540 — /shipments cột LỊCH TRÌNH & ĐIỀU XE "bị cắt dòng đầu"

- Ticket: SIL-540 (board SIL, id 606) — QA Glint 27/10 23:15, screenshot
  `qa27w3_532_q1177.png` + `qa27w3_532_lichtrinh_crop.png` (máy báo cáo,
  `~/workspace/qa-r30/shots/` — không còn trên máy khác).
- Surface: `/shipments` bảng desktop (≥1000px), ô LỊCH TRÌNH & ĐIỀU XE —
  hàng Q1-177 (shipment id 196, FCL, 2 cont hẹn 08:00 25/10/2026 · ASKEY).

## Báo cáo

"Quan sát 2 dòng text. Actual: dòng đầu '08:00 25/10/2026 · ASKEY-XƯỞNG…'
chỉ hiện nửa dưới ký tự, chạm/chồng dòng thứ hai 'Toàn bộ chờ phân xe'.
Expected: cả hai dòng hiện đủ, không chồng lấn." Ticket tự ghi chú chưa rõ
provenance: "Chưa rõ là regression từ thay đổi layout dòng của SIL-532 hay
đã có trước."

## Kết quả điều tra 28/10 (HEAD b27df702)

**NOT REPRODUCED.** Harness `qa/2026-10-28_sil540-schedule-cell/` (scripts
`qa/scripts/2026-10-28-sil540-*.mjs`):

- 80 hàng thật × 4 view bucket (`/shipments`, unassigned, plated, accounting)
  @1440 dungnv — 0 cell lỗi (allsweep.json).
- Q1-177 × 8 bề rộng (1440/1366/1280/1180/1024/999/768/390) — 0 lỗi
  (sweep.json).
- DPR 1/2 × zoom cấu trúc × 3 font stack (Be Vietnam Pro mặc định, Helvetica
  fallback, system-ui) — ink ≤ box trong mọi trường hợp (fontprobe: box
  14.84px, ink 13px, slack ≈0.9px mỗi bên).
- Synthetic stress: tên nhà máy dài, 2–3 nhóm hẹn — không clip, không chồng.
- Sticky-thead occlusion probe — filtered view không scroll được; trạng thái
  che nửa dòng không tái được từ layout.

Geometry tại HEAD: box dòng 14.85px (1.35 × 11px) ≥ ink 13px (≈1.21em của
Be Vietnam Pro) — `overflow: hidden` của FB-043 không thể cào nửa ký tự; gap
3px giữa hai dòng grid giữ khoảng cách. Cơ chế "nửa dưới ký tự" không tồn
tại trong CSS hiện hành.

## Case tái lập (khi có máy báo cáo)

1. `cd frontend && node ../qa/scripts/2026-10-28-sil540-schedule-cell-ui-drive.mjs`
   (QA_EXPECT=before|after) trên chính môi trường chụp qa27w3_532 — EXIT=0
   nghĩa là hai dòng hiện đủ, không clip, không chồng.
2. Nếu EXIT=1: đính kèm `before-cell.png` + `assertions-before.json` vào
   ticket và mở lại điều tra với đúng viewport/DPR/font của máy đó.

## Regression lock

- `ShipmentsTableRowHeight.test.tsx` — pin "SIL-540: line box ≥ glyph ink":
  `.cus-inline-trigger` giữ `line-height` factor ≥ 1.35 (ink ≈1.21em → luôn
  còn half-leading dương mỗi bên, FB-043 `overflow: hidden` không bao giờ
  cào đỉnh ký tự dù device-pixel rounding hay font fallback) và giữ
  `display: grid` + `gap: 3px` (hai dòng không thể fuse thành một run chồng
  lên nhau). Phá một trong hai bất biến này = mở lại defect class của ticket.

## Rung

- Điều tra + pin: **CODE-READ + driver đo đạc** — defect KHÔNG tái lập tại
  HEAD, không có code change hành vi; claim "đã hết" chỉ có thể đến từ máy
  báo cáo chạy lại driver (rung 3) — hiện đang để QA xác thực lại.
