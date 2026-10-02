# Compact CUS and dispatcher schedule display

User requirement: show the time and date together on the first line of a schedule cell, with `trả hàng` or `đóng hàng` below. Keep dense operational typography and the existing schedule editing behavior.

| Case | Reproduction | Expected |
| --- | --- | --- |
| SCHEDULE-LAYOUT-01 | Open CUS Chi tiết lô hàng with an import appointment15:00 15/09/2026; repeat for export. | One unbroken primary line contains time and date; the secondary line contains only the matching `trả hàng`/`đóng hàng` operation. |
| SCHEDULE-LAYOUT-02 | Open an undated CUS container. | Keep `Chưa có lịch hẹn` and its guidance; do not fabricate a time/date or hide a missing-transport-date warning. |
| SCHEDULE-LAYOUT-03 | Open dispatcher Kế hoạch chi tiết with an exact runAt, including a Vietnam timezone day boundary. | The primary line uses the exact Vietnam time and date; the matching operation sits below without repeating the date. |
| SCHEDULE-LAYOUT-04 | Open dispatcher legacy rows with only a run hour, only a date, or neither. | Keep hour-only precision (`8H`), show the available date alongside it, and retain `—` for unknown time. Never invent minutes or dates. |
| SCHEDULE-LAYOUT-05 | Open a dispatcher historical row whose explicit transport date differs from its appointment date. | Keep the appointment time/date together and retain the different transport date as supporting information below. |
| SCHEDULE-LAYOUT-06 | Recheck CUS overview appointment groups and the upstream LCL lot-level fallback; inspect detail/dispatcher at desktop, tablet and mobile widths. | Existing group/factory/count and lot-level schedule semantics remain unchanged. The compact schedule pair stays legible without clipping or increased type size. |
| SCHEDULE-LAYOUT-07 | At390px wide, open the CUS detail row with lift `VID Cảng nâng 73835905` and drop `VID Cảng hạ 73835905`. | Nâng and Hạ each own an equal, top-aligned column; long names wrap inside those columns. No obsolete arrow column squeezes the lift into a narrow strip. Desktop/tablet and route editing remain unchanged. |
| SCHEDULE-LAYOUT-08 | At390px wide, open dispatcher Kế hoạch chi tiết with customer, factory, Bill, route, direction and container fields. | Each field label owns a line above its value. Stacked factory/Bill/route/direction lines have no leading dot or standalone separator. Nhập/Xuất aligns at the start below the route. Container type and weight may share a compact supporting line; allocation controls and classification pill remain unchanged. |
| SCHEDULE-LAYOUT-09 | Compare dispatcher mobile records with no notes/action, a real driver note, and a release/completion action. | Only the computed empty notes cell collapses. Any note or available action remains visible and usable; no blank Ghi chú tail remains. |

Automated scope: CUS container-ledger and dispatcher grid rendering regressions plus existing overview and structure guards. Controller owns actual Chrome clicks/screenshots; no source-analysis claim substitutes for browser coverage.
