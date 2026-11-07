# Case SIL-707 r2 — popup chọn nhà xe vẫn đè dòng 2 dù đã cuộn được

- **Case ID:** SIL-707 r2 (board id 827); QA verdict Muse 07/11 build b293f3cf, lô R4B-P4-FCL1, dialog 'Phân bổ nhà xe' (/dispatch).
- **Surface:** FE `DispatchAllocationDaySection` — combobox 'Nhà xe dòng N' (UuiSelectField ≥5 options → ComboBox popover, portalled body).

## Reproduction
1. dungnv → /dispatch → mở 'Phân bổ nhà xe' của lô FCL → '+ Thêm nhà xe' (2 dòng).
2. Mở picker 'Nhà xe dòng 1'.
3. Trước fix r2: popup cuộn được (fix r1 OK) nhưng vẫn CHE field nhà xe dòng 2 và tràn dưới mép dialog (placement bottom mặc định).

## Expected
- Popup mở **PHÍA TRÊN** trigger (`popoverPlacement="top"`): dòng dưới (kể cả combobox dòng 2) luôn hiển thị đầy đủ; popup không tràn dưới mép dialog; vẫn cuộn được, đủ 27 lựa chọn.
- react-aria vẫn tự flip khi phía trên không đủ chỗ (sàn khả dụng 96px — cùng luật fitBelowMaxHeight).

## Fix
`popoverPlacement` xuyên UuiSelectField → UUI Select/ComboBox → Popover; Popover đo đúng phía mở cho cap `--popover-fit` (`fitAboveMaxHeight`); pin: `DispatchAllocationCarrierPopover.sil707.styles.test.ts` + `popover.fit.test.ts`.
