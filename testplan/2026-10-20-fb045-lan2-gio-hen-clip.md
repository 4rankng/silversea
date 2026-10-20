# FB-045 lần 2 — dialog "Chi tiết container" clip cột GIỜ HẸN (card 201026140000)

Case ID: TC-201026140000-L2
Feature: dialog/drawer "Chi tiết container" — cột GIỜ HẸN ĐÓNG/TRẢ không bị cắt
Surface: BOTH dialogs that own a GIỜ HẸN ĐÓNG/TRẢ column:
  1. `/dispatch` master-plan quick-view → `DispatchContainerDetailDrawer`
     (title "Chi tiết container", table `dispatch-container-detail__table`)
  2. `/shipments` workboard "Chi tiết" → drawer `CusContainerLedger`
     (section "Chi tiết container", table `cus-container-table`)

## Tại sao fix lần 1 (bb394516) không đủ

bb394516 floored the GIỜ HẸN column at 150px and pinned the one-line header
law in `DispatchContainerDetailDrawer` — the header shear is gone. QA R27 still
FAILS because TWO clip channels survived:

1. **/dispatch drawer — neighbor overflow covers the GIỜ HẸN value (mọi
   viewport).** The Nâng/Hạ port `<select>`s (`.dispatch-container-detail__port-select`,
   `min-width: 140px`) sit in fixed-layout auto columns of only 114px (w1024)
   / 127px (drawer caps at 1120px, so 1280/1440/1920 are identical). The
   selects overflow their cells and paint OVER the GIỜ HẸN value: the value
   "08:00 24/09/2037" renders as "0 24/09/2037" (w1024) or "…:00 24/09/2037"
   (w1280+) — reproduced in `qa/2026-10-20-fb045-lan2/before-dispatch-drawer-w{1024,1280}.png`.
   The lan-1 verification missed it: it measured only the giờ hẹn cell's own
   text metrics, never a neighbor control's overflow.
2. **/shipments drawer — add-row GIỜ HẸN input crushed + overlapped.** The
   "Thêm container" add row's segmented datetime input (min-width: max-content
   ≈ 150px) sits in a 15% column (150–171px, minus padding ≈ 138px) and the
   "Thêm"/"Hủy" pair from the 4% (~46px) Thao tác cell spills LEFT on top of
   the date segments ("DD/MM/YYYY" covered by "Thêm") —
   `qa/2026-10-20-fb045-lan2/probe4-shipments-drawer-w1280.png`. At ≤1039px
   viewport the drawer caps at 620px (`@media (max-width: 1039px)`) and the
   ledger flips to card mode; the input renders as two crushed pills.

## Repro (local HEAD 106a25e3, dieuvan + cus, 2026-10-20)

1. `/dispatch` (dieuvan) → row "Chi tiết container" trigger → drawer opens.
   Observe the GIỜ HẸN ĐÓNG/TRẢ value: its first characters are painted over
   by the "Chọn cảng hạ" select. Driver:
   `node testplan/qa/scripts/2026-10-20-fb045-lan2-probe.mjs` (QA_ENTRY=dispatch-drawer),
   screenshots `before-dispatch-drawer-w{1024,1280,1440,1920}.png`.
2. `/shipments` (cus) → row "Chi tiết" → drawer "Chi tiết container" →
   "+ Thêm container". The GIỜ HẸN ĐÓNG/TRẢ segmented input is squeezed and
   "Thêm" covers its date segments. Driver same script (QA_ENTRY=shipments-drawer),
   screenshots `probe4-shipments-drawer-w{1024,1280,1440,1920}.png`.

## Expected (FB-045 + FB-063/R17 law, card 181026021137)

- Cột GIỜ HẸN ĐÓNG/TRẢ: header LUÔN 1 dòng, giá trị datetime ("HH:mm
  DD/MM/YYYY") 1 dòng, không chữ nào bị che/cắt ở bất kỳ viewport nào.
- Không control hàng xóm (port select, nút Thêm/Hủy) được tràn đè lên cột giờ.
- Khi dialog hẹp hơn tổng bề rộng cột tối thiểu: band scroll-x của dialog
  cuộn ngang ("scroll-x hợp lý"), KHÔNG chật cứng cột.

## Fix (durable, viewport-independent)

- `DispatchContainerDetailDrawer`: cột Nâng/Hạ own width 150px (khớp select
  132px + padding), table min-width 900→960, giờ hẹn 150px giữ nguyên + value
  nowrap pin. Select min-width 140→132px (vừa cột, không tràn).
- `CusContainerLedger` (ShipmentsPage.css): thay doctrine "percentage sum
  100%, no scroll" (bị brief lần 2 supersede) bằng cột floor px: giờ hẹn
  164px (segmented input max-content + padding), Thao tác 116px (Thêm+Hủy
  1 hàng), các cột còn lại floor theo label/content; table min-width 1110px;
  `.cus-container-table-scroll` giữ overflow-x:auto. Value trigger giờ hẹn
  nowrap + ellipsis guard. Review M1: `.cus-container-ledger__add-actions`
  thêm `flex-wrap: wrap` — transient `adding` ("Đang thêm…" rộng hơn "Thêm")
  wrap trong ô thay vì tràn trái đè cột giờ (structural guarantee, pin trong
  density test; state này không submit live vì QA không ghi data).
- Styles pins: `DispatchContainerDetailDrawer.styles.test.ts` cập nhật min-width
  + port floor; `ShipmentsPage.density.test.ts` cập nhật contract (min-width
  BẮT BUỘC thay vì bị cấm, col floors px, add-actions wrap).

## Review resolution (independent code-reviewer, 2026-10-20)

REQUEST CHANGES → resolved trước commit:
- M1 add-row `adding` spill → `flex-wrap: wrap` + pin (trên).
- M2 probe spill selector `select.dispatch-container-detail__port-select`
  không bao giờ match (port editor là SearchableSelect div+button) → sửa thành
  `.dispatch-container-detail__port-select` (root div rect = control); rerun
  after-matrix đo THẬT 14 controls/entry, 0 spill. Probe cũng fail loud khi
  surface table không render (verdict không vacuous).
- M3 full FE suite red do race `dist/assets` → build xong rerun green, log
  `gates-fe-vitest-full.log`.
- L4 header comment styles test → lan-2 math. L5 QA case doc criterion 6 +
  pin list → SUPERSEDED annotation. L6 (placeholder "Trọng lượng (" trunc —
  standard input truncation, ngoài channel) → noted, không đổi.

## Verdict (2026-10-20, end of run)

FIXED — UI DRIVEN trên local HEAD. Staging (build `106a25e3`, code TRƯỚC fix) đã
tái hiện đúng clip channel QA R27 thấy: add-row nút "Thêm" (51px) tràn khỏi ô
Thao tác 46px đè lên cột GIỜ HẸN ở 1280/1440/1920 (`stg-before-driver.log`
`neighbor control spills its cell … "btn btn--primary btn--sm" w=51 cell=46`).
Sau fix, local 8/8 surface-viewport của FB-045 PASS:

- `/dispatch` drawer × {1024, 1280, 1440, 1920}: PASS — port selects (SearchableSelect
  ×2, đo được portSelects=2) nằm gọn cột Nâng/Hạ 150px, giá trị
  "08:00 24/09/2037" 1 dòng, 0 control tràn ô (spillControls=4 đo thật, 0
  spilled); ảnh `after-dispatch-drawer-w1024.png` đối chiếu
  `before-dispatch-drawer-w1024.png` nơi giá trị thành "0 24/09/2037".
- `/shipments` drawer × 4 viewports: PASS — lot 161588 (1 cont, hẹn
  "15:00 21/08/2026") giá trị 1 dòng trong trigger 155px/ô 168px; add-row
  segmented input "15:00 | 21/08/2026"đầy đủ, Thêm/Hủy nằm gọn cột Thao tác
  119px, 0 control tràn ô (`after-local-driver.log`, ảnh
  `after-shipments-drawer-w1280.png`).

Driver: `node testplan/qa/scripts/2026-10-20-fb045-lan2-probe.mjs` (matrix
{dispatch-drawer, shipments-drawer, shipments-detail, dispatch-detail} ×
{1024, 1280, 1440, 1920}; QA_ENTRY/QA_TAG/QA_BASE/QA_USER_A/QA_USER_B env).
Logs + PNG trong `qa/2026-10-20-fb045-lan2/`.

## Verification coverage (AGENTS.md §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| FB-045-L2a /dispatch drawer: port selects đè GIỜ HẸN value | UI DRIVEN | `before-dispatch-drawer-w{1024,1280}.png` (before: "0 24/09/2037") → `after-dispatch-drawer-w{1024,1280,1440,1920}.png` (after: "08:00 24/09/2037" 1 dòng, selects trong cột) + `after-local-driver.log` (th 150/150/150px, lines=1, 0 spill) + unit pins `DispatchContainerDetailDrawer.styles.test.ts` | staging after-deploy (cần deploy ≥ fix); lot staging có port DIRECT (4 lot đầu grid staging port READ_ONLY — channel chỉ render khi fieldAccess DIRECT, data-gated); viewport <1024 (card mode ≤760 container, mode khác) |
| FB-045-L2b /shipments drawer add-row GIỜ HẸN bị Thêm/Hủy đè + input bóp | UI DRIVEN | `probe4-shipments-drawer-w1280.png` (before: Thêm đè "DD/MM/YYYY") → `after-shipments-drawer-w{1024,1280,1440,1920}.png` (after: segmented inputđầy đủ, Thêm/Hủy trong cột 119px) + `after-local-driver.log` (0 spillControls, value `15:00 21/08/2026` 1 dòng) + `stg-before-driver.log` (staging pre-fix FAIL đúng channel) + unit pins `ShipmentsPage.density.test.ts` px-floor contract | staging after-deploy; role khác ngoài cus/thanhdc (layout role-independent); lot không hẹn (placeholder path — coi như input, judged bởi spill check) |
| Sibling quan sát (ngoài card): header shear `/shipments-detail` ("Khách hàng & lộ trình", "Thông số container", …) và `/dispatch-detail` w1024 ("Thời gian & lịch trình" …) | UI DRIVEN (measure) | `before/after-*-driver.log`, `stg-before-driver.log` | KHÔNG fix trong card này — không có cột GIỜ HẸN ở 2 surface này; cần card riêng theo defect-class discipline |
