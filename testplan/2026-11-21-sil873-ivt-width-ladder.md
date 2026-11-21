# SIL-873 round 2 — bảng invoice-tracking lock 1440px + tràn ở 1440×900

## Case A — thừa ~124px trắng ở 1920+ (QA verdict 19:55 SGT, build 32e22c12, role hoapt)

- **Repro (QA verbatim):** /accounting/invoice-tracking ở viewport ~1920px —
  bảng đo x=356–1795 (~1440px), thừa dải trắng ~124px tới mép phải. Tham
  chiếu cùng build: /dispatch fill đúng (x=248–1903).
- **Root cause (chứng minh bằng CDP getMatchedStylesForNode trên local):**
  shell law `.app-main:not(.driver-mode) .app-body > :where(div, section) {
  width: min(100%, var(--content-max-w)); margin-inline: auto }` với
  `--content-max-w: 1440px` (tokens.css) — page không mang class opt-out
  `data-workspace` nên bị cap 1440px + căn giữa (margin 84.5px mỗi bên).
  /dispatch và các debit board mang `data-workspace` nên fill đúng.
- **Fix:** page root thêm `data-workspace` (opt-out chuẩn của shell) →
  1920+ fill 100% (đo local: wrap = 272→1881 = 1609px = full canvas).

## Case B — 1440×900 tràn/cắt (tự verify theo yêu cầu lane; Muse không resize được)

- **Repro (local measurement):** sau khi bỏ cap, bảng AUTO layout vẫn
  min-content 1292px > wrapper 1129px tại 1440×900 sidebar-open — bảng
  sơn tràn qua mép wrapper, bị `overflow-x: hidden` của app-body cắt
  (Tiến độ xử lý mất ~47px cuối).
- **Root cause:** min-content = các floor control/header thật: select pair
  25px · STT 41 · KH&Lô 320 (luật ticket 18/11 + SIL-863) · Cont&Chứng từ
  137 · Đầu vào 155 (SIL-816 pair budget) · Đối soát 183 (2 pair trên 1
  dòng) · Chênh lệch 98 · Ghi chú&ĐNTT 121 · Tiến độ 140 (select 128) =
  1220px > 1129px. Kèm `.ivt-stack__sub nowrap` đẩy min-content dòng dữ liệu
  lên 357px (một dòng 'LOGCOM · 2300975219').
- **Fix (family ladder — law 2bbf1664 / e6f00827 / 41902fb1):**
  1. `table-layout: fixed` + colgroup % share (floor ÷ base 1220) + px floor
     trên từng `<col>`; `--itv-min` = tổng floor rendered set là scroll
     floor của wrapper `record-table-wrap--scroll` (idiom chung: genuine
     width excess scrolls); `--itv-scale` re-base share cho bộ rendered
     (CUS 8 cột không có Chọn-dòng).
  2. `.ivt-stack__sub` nowrap → normal (đúng luật shared break-anywhere của
     td; floor là control/header, không phải data width).
  3. Reset floor trong band record-card ≤1100px.
- **Expected (đo local, hoapt, seed 5 dòng thật qua API):**
  - 1920×1080 sidebar-open: wrap = table = 1609px = full, 0 header bleed,
    0 cell bleed.
  - 1440×900 sidebar-open: không tràn qua mép (nội dung trong wrapper);
    thừa 91px floor > canvas → scroll ngang trong wrapper (idiom chung —
    không cắt, không sơn đè; trade sticky thead như 5 board --scroll hiện
    có: DepositTracker, CustomersConfig, CrudTable…).
  - 1440 sidebar-closed (canvas ~1321 ≥ 1220): khít, không scroll.
- **Regression pins:** `AccountingInvoiceTrackingPage.styles.test.ts`
  (ladder: fixed + 9 floors = 1220 + shares re-sum 100 + scale var +
  data-workspace + sub wrap + @container reset + các luật giữ nguyên:
  no nth-child, @media closed set, header nowrap FB-063, floor 320 KH&Lô).
- **Trade-off nêu rõ:** floors control (SIL-816/863 law) thật sự vượt canvas
  1129px ở 1440 sidebar-open → chấp nhận scroll ngang 91px trong wrapper
  thay vì cắt control hoặc phá floor luật.
