# SIL-897 r10 — Debit grid: filter-while-scrolled ẩn nhóm CƯỚC PHẢI THU sau dock

| | |
|---|---|
| Case ID | SIL-897-r10-filter-while-scrolled |
| Ticket | SIL-897 (plan.tingting.vip/tingtingsoft/SIL #1056), QA Round 10 fail trên build 2530c955 |
| Màn hình | /accounting/ghep-bo-debit (Kế toán) và /shipments-debit (CUS, team mode) — lưới dùng chung `DebitMergeGrid` |
| Ưu tiên | P0 (Blocker) — UAT CR-010.1 24/11 |
| Tình trạng | Đã sửa — commit `fix(SIL-897)` (worktree fix-sil-897-filter-scrolled), CHƯA deploy |

## Lỗi (Round 10, first-hand staging hoapt, tháng 11/2026, 557 rows)

Đang cuộn ngang (`scrollLeft > 0`) rồi đổi từ khóa tìm kiếm
(MATS7539769000 → '9000' + Enter): cả nhóm CƯỚC PHẢI THU (CƯỚC, LẠCH HUYỆN,
PHỤ PHÍ, PHÁT SINH, TỔNG) biến mất khỏi view; giá trị (20.910.000₫) vẫn còn
trong DOM nhưng invisible; header row-1 'CƯỚC PHẢI THU' / 'PHÍ CHI HỘ (CÓ HÓA
ĐƠN)' và subgroup 'PHÍ CSHT' / 'PHÍ NÂNG-CONT' cũng biến mất (chỉ còn PHÍ
KHÁC). Cuộn về hết trái thì các cột quay lại.

## Root cause (đo thật, Playwright chromium 1600×900, local 11/2026)

Bảng là content-sized (`table-layout: auto`): bộ lọc mới làm reflow TOÀN BỘ
độ rộng cột, nhưng pane vẫn giữ `scrollLeft = 700`. Kết quả đo (snapshot
S3 trong `qa/2026-11-24_sil897-filter-scrolled-fix_ui-driver.log`):

- Bảng mới rộng 2980px; nhóm CƯỚC nằm ở content x∈[763, 1313] → khi cuộn 700
  rơi vào viewport x∈[335.9, 885.9].
- Dock sticky (THÔNG TIN LÔ HÀNG 570.1px + CONTAINER 192.7px, nền đặc,
  z-index 6/5/4) phủ viewport x∈[273, 1035.8] → che TRỌN nhóm CƯỚC.
- Không có cơ chế nào reset `scrollLeft` hay re-anchor khi `rows` đổi →
  "cột biến mất" (thực chất nằm sau dock), cuộn về 0 hết che.

## Sửa

`frontend/src/features/accounting/DebitMergeGrid.tsx` — layout effect
identity-keyed trên `rows`, chạy TRƯỚC effect `measure()` trong cùng commit:
`rows` đổi array (search keystroke, facet, tháng, refresh board) →
`pane.scrollLeft = 0` (AC CR-010.1: "đổi bộ lọc thì tính lại vị trí sticky
(và/hoặc reset scrollLeft = 0)"). Cùng array (chuyển trang, re-render
toolbar) không snap — luật safePage SIL-852 giữ nguyên vị trí xem trang 2.
Không đổi gì hành vi scroll của e6e583b0 (pins đo thật, sweep nhãn).

## Reproduction

1. hoapt → /accounting/ghep-bo-debit, kỳ 11/2026 (557 dòng).
2. Tìm `MATS7539769000` → Enter; cuộn ngang bảng sang phải (~700px).
3. Đổi từ khóa (`9000`) + Enter → trước sửa: nhóm CƯỚC PHẢI THU biến mất sau
   dock; sau sửa: pane tự về `scrollLeft = 0`, cả 6 nhóm hiện đủ.

## Expected behavior (AC)

- Đổi từ khóa khi đang cuộn ngang: không mất cột, không nhảy cột; nhóm
  CƯỚC PHẢI THU không co về 0/ bị dock che.
- Hành vi scroll đã fix ở e6e583b0 (sticky 3 tầng đồng bộ mọi scrollLeft)
  giữ nguyên.

## Verification (local, driver exit 0)

- Trước sửa: S3 `scrollLeft=700`, CƯỚC [335.9, 885.9] nằm trọn trong dock
  [273, 1035.8] — invisible.
- Sau sửa: S3 `scrollLeft=0` — CƯỚC hiện đủ từ mép dock; S2 (cuộn 700, chưa
  lọc) giữ nguyên dock đồng bộ.
- Vitest scoped: `DebitMergeGrid.test.tsx` 28/28 (thêm case r10 reset);
  accounting features+pages 55 files 519/519; `tsc -b` 0 lỗi.
