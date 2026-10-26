# Regression plan — CUS display fixes, five cards (191026181942)

Branch `fix-cus-display`. Five QA cards against the CUS surfaces:
Tổng quan lô hàng (`/shipments`, `CusShipmentRow` + `cusUtils`), Chi tiết lô
(`/shipments-detail`, `ShipmentContainerLedger`), Kế hoạch grids
(MasterPlanGrid / DetailedPlanGrid).

| Case ID | Card | Surface | Reproduction | Expected behavior |
|---|---|---|---|---|
| R1 | 191026181942-cus-chitiet-lichtrinh-lcl | Chi tiết lô, lot-level LCL row | LCL lot with `expectedDeliveryDate` set (no per-lot `customerAppointmentAt` — the backend never sets one on a lot row, `buildLotFlatRow`). Open `/shipments-detail`. | Lịch trình cell renders the lot's ngày vận chuyển (object-existence truth wins). "Chưa có lịch hẹn" only when neither the container appointment nor the lot schedule exists. |
| R2 | 191026181942-cus-chitiet-phanxe | Chi tiết lô, lot-level LCL row | LCL lot with NO allocation (carrierName/plateNumber/actualTruckNo all null). | Phân xe cell renders ONE muted "Chưa phân xe" label — no "Chưa phân nhà xe - BKS Thực: —" composite, no "BKS Báo khách (Ảo): — sửa" line. Allocated lots keep the two-line composite; a missing name slot inside an allocated composite reads "—" (en dash). |
| R3 | 191026181942-cus-tongquan-hangle-wording | Tổng quan, cargo cell | LCL lot + an active date filter whose day has no cargo. | Copy parameterized by cargoMode. LCL: SUPERSEDED by SIL-504 owner ruling 26/10 → short one-line "Chưa chọn hàng lẻ" (testplan/2026-10-26-sil504-lcl-badge-cargo-text.md). FCL keeps "Không có cont chạy ngày đã chọn". |
| R4a | 191026181942-cus-tongquan-an-cbm | Tổng quan, cargo cell | LCL lot with weight but no `volumeCbm`. | Metrics line shows weight only; no "— CBM" placeholder. With volumeCbm set, "X CBM" joins. |
| R4b | 191026181942-cus-tongquan-an-cbm | Tổng quan signal + drawer signals | Containerless LCL lot, no lot-level carrier (`vehicleReadiness = WAITING_CARRIER`, `missingCarrierContainers = 0`). | Signal reads muted (info tone) "Chưa phân xe" — never "Thiếu nhà xe 0 cont" warning. Same truth rule guards the plate zero-count branch. |
| R5 | 191026181942-hien-thi-ten-ngan | Tổng quan, Chi tiết, Kế hoạch grids | Long customer/route/carrier names (shortName unset → full name). | Names never clip: they wrap (design law §4 no-truncation; `text-overflow: ellipsis` on data cells is banned and enforced by `table-no-truncation.styles.test.ts` — the card's "max-w + truncate" pattern is implemented as the law-conformant wrap + tooltip). Full name stays reachable: native `title` hint, `aria-label`, and focusable reveal on long names. One shared primitive (`NameCell`) behind all sites. |

## Superseded pins (deliberate spec change, not a weakened gate)

- `ShipmentContainerLedger.test.tsx` AC5 pinned `Chưa phân nhà xe - BKS Thực: —`
  + `BKS Báo khách (Ảo): — sửa` for the unallocated lot — exactly the thừa-display
  card R2 removes. Rewritten to pin the muted chip.

## Gates

Root `tsgo -b`, frontend `tsc -b`, scoped vitest, `pnpm lint`, plus browser
evidence per card into `qa/2026-10-19_cus-display-five-cards/`.
