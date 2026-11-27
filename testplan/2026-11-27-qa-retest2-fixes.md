# Regression Cases — QA Retest 2 (2026-11-27)

Source: `QA-Retest2-Silversea-2026-11-27.docx` (+ residual UI-15 from `Silversea_Staging_QA_Retest2_Report_2026-11-27.docx`).

## Cases

### SIL-1123 — `/accounting/chot-debit` missing "Bỏ xe công ty" checkbox
- **Repro:** Open `/accounting/chot-debit` as ACCOUNTANT (`hoapt` / `ngocntm`). Inspect filter bar.
- **Expected:** Checkbox `"Bỏ xe công ty"` is visible in the filter bar (matching `/debt`), toggling it excludes own-fleet lots (`Đội xe nội bộ SilverSea`) from the board and updates visible counts/rows cleanly.

### SIL-1124 — Duplicate Debit Settlement Round error exposes internal `SHP-` code
- **Repro:** Select a lot already belonging to a settlement round (e.g., Bill `R3P-677-R`) and submit `[Chốt đợt]` (`POST /api/accounting/debit-settlement-rounds`).
- **Expected:** Error message identifies the lot by Số Bill / Số Booking (`Lô R3P-677-R (Lần 2 · 2027-04)`), never internal `SHP-*` or `#id`. All sibling lot-validation errors in `createDebitSettlementRound` use Bill/Booking too.

### SIL-1125 — Deposit refund tracker stale `expectedRefundDate` when CV date changes
- **Repro:** Update `cvSubmittedDate` on a deposit tracker row (e.g., `K5K5346365` with `cvSubmittedDate = 2026-10-27`) without passing an explicit override for `expectedRefundDate`.
- **Expected:** `expectedRefundDate` recalculates to `cvSubmittedDate + 14 days` (`2026-11-10`), never retaining a stale prior `expectedRefundDate` (`2026-11-20`). Manual explicit overrides are still respected.

### SIL-835 — `/accounting/chot-debit` rightmost column clipping at 1440px
- **Repro:** Open `/accounting/chot-debit` at 1440×900 with sidebar open.
- **Expected:** Rightmost column `"GHI CHÚ & ĐỐI SOÁT"` has sufficient width so status labels (`• Chưa gửi`, `• Chờ xác nhận`, `• Đã đối soát`) and notes fit cleanly with zero horizontal overflow or right-edge clipping.

### SIL-874 — `/phoi-phieu-control` "Lô chưa thanh toán" drawer clips "GHI CHÚ" on open at 1440px
- **Repro:** Open `/phoi-phieu-control` as ACCOUNTANT at 1440×900, click `"Lô chưa thanh toán"` on a customer/party row.
- **Expected:** All table columns including `"GHI CHÚ"` fit cleanly inside the 66vw drawer width on initial open at 1440×900 without clipping `"GHI CHÚ"` off the right edge.

### SIL-708 — Unassign planned vehicle/carrier when no live trip exists
- **Repro:** On `/dispatch-detail`, open the edit dialog for a planned-but-unissued row (assigned carrier/vehicle, no live trip), click `"Bỏ chọn"` on Nhà xe, and click `"Lưu thay đổi"`; or open the row `⋯` menu and click `"Hủy phân xe"`. Also `PATCH /api/shipments/dispatch-detail-plan-rows/:fulfillmentId/plan` with `carrierType: null`.
- **Expected:** Backend accepts `carrierType: null` (clearing `plannedCarrierType`, `plannedExternalCarrierId`, `plannedExternalCarrierVehicleId`, `plannedVehiclePlateNumber`, and `actualTruckNo` when applicable); UI allows saving the cleared carrier and offers `"Hủy phân xe"` in the `⋯` menu for planned rows too.

### UI-15 — Driver `/my-trips` ("Lịch sử") 2-column card stretch & header wrap
- **Repro:** Open `/my-trips` as DRIVER (`nhvuong`) at desktop width (≥1024px) on `"Lịch sử"` tab.
- **Expected:** `.driver-journey__list` uses `align-items: start` so shorter cards do not stretch to match taller paired cards beside them, and `.driver-journey-card__header` keeps tight gap so `LẺ` badge + `Giờ chạy` stay compact.
