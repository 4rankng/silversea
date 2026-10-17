# Manual verification — "Hướng dẫn sử dụng: Hàng lẻ (LCL) và Chi phí" (17/10/2026)

Source doc: `/Users/dev/Downloads/171026221500-huong-dan-su-dung-hang-le-chi-phi.docx`
(manual §A.1–A.6 LCL, §B.1–B.6 Chi phí; it claims "kiểm tra thực tế ngày 17/10/2026").

Run: staging `vantai.tingting.vip`, build `11720424` (= main HEAD at wave start, per
`2026-10-17-devcompleted-qa-wave.md`), 2026-10-17 14:05–14:55 UTC. Accounts per
`testplan/testaccounts.txt` (password `Abc123`). Every write carried `Idempotency-Key`.

Harness: the `fullguide-*` drivers (`testplan/qa/scripts/`, one per manual section, shared
`fullguide-lib.mjs`) — re-cut for HEAD in this pass, see "Harness repair" below. Run them with
`EXPECT_BUILD=11720424 node testplan/qa/scripts/fullguide-<x>.mjs`; logs land in
`qa/2026-10-16_fullguide_<scope>.log` + the `qa/run-final*.out` captures of this run, screenshots
`qa/2026-10-16_fullguide_*.png`.

## Verdicts — every claim in the manual holds

| Manual | Claim in the doc | Result on 11720424 | Evidence (driver → verdict) |
|---|---|---|---|
| A.1 | "Dùng được: tạo lô hàng lẻ, lưu và mở lại" | **PASS** | `fullguide-a` → A.1: the real form created LCL lots in both directions (e.g. lot 924 `EXPORT`, `pickup_location=ASKEY-1`, `delivery_location=ASKEY - XƯỞNG 1`, `packageCount=5`, `1900.00 kg`, `4.000 cbm`), detail shows "Hàng lẻ" + "Chưa có container nào" |
| A.1 bullet | "Nhãn ô chưa tự đổi theo Nhập khẩu/Xuất khẩu" | **STALE — fixed** | A.1.labels: Nhập → `Nhà máy (Điểm trả hàng) *` / `Kho lấy hàng (CFS/Cảng) *`; Xuất → `Nhà máy (Điểm lấy hàng) *` / `Kho trả hàng (CFS/Cảng) *`; no-direction keeps `Nhà máy` / `Kho lấy hàng`; both `*` marks present |
| A.1 bullet | "Ô Nhà máy và ô Kho chưa có nút + để thêm nhanh" | **STALE — fixed** | A.1.plus-buttons: with the customer picked, Nhà máy carries `Thêm nhà máy` and Kho carries `Thêm kho` (the Kho catalog is customer-scoped, so the button only exists after the customer pick) |
| A.1 bullet | "ô ngày/giờ gõ đủ 2 số không tự nhảy sang ô tiếp theo" | **STALE — fixed** | A.1.date-advance: typing `20` in DD moves focus to `Tháng — Ngày giao hàng` |
| A.2 | "Dùng được: xem danh sách lô lẻ trên bảng kế hoạch" | **PASS** | `fullguide-a` → A.2: master-plan row found, TỔNG QUAN HÀNG HÓA = `5 Pallet 1.900 kg · 4 CBM` |
| A.2 bullet | "tên Kho/Nhà máy chưa đồng bộ vào cột Cảng nâng/Cảng hạ" | **STALE — fixed** | A.2: CẢNG NÂNG = `ASKEY-1` (Nhà máy), CẢNG HẠ = `ASKEY - XƯỞNG 1` (Kho) for a Xuất lot — direction-correct, no bare "—". (Nhập is the mirror image; the same law is pinned by the FB-105 rungs.) |
| A.3 | "Dùng được: gán xe nhóm, tiền trả nhà xe tự chia (Lô 1 100%, còn lại 0đ)" | **PASS** | `fullguide-a` → A.3: 2 LCL rows ticked → "Đang chọn 2 lô" bar → dialog "Gán xe nhóm" with `Loại xe tính cước trả ĐV*`, `Nhà xe*`, `BKS thực (xe chạy chuyến)*`, `BKS báo khách (ảo)`, `Cước trả ĐV Lô 1 (đ)` + banner "2 lô lẻ · Lô 1 giữ 100% cước trả ĐV, các lô còn lại 0₫". The money split itself is driven end-to-end by `2026-10-17-qa-lcl-group-drive.mjs` (Lô 1 4.500.000, member 0). |
| A.4 | "Dùng được: ghép nhóm (Lô 1 = 100% tiền, Lô 2 = 0đ); tách nhóm lô còn lại nhận đủ tiền" | **PASS** | `fullguide-a` → A.4: merge toast "Đã ghép cước thu khách cho 2 lô — Lô 1 … giữ 100% cước vận tải"; board Lô 1 = `1.600.000` (its live freight snapshot), Lô 2 = `0` + "Ghép cước cùng Bill …"; DB `freight_rate_snapshots` 1.600.000 / 0. Unmerge: wave rev-merge cluster (FB-095/105447), same build |
| A.5 | "Dùng được: chốt đợt đối soát, file Debit Note đúng biển số báo khách, loại xe, số tiền" | **PASS (dialog)** / file bytes suite-level | `fullguide-b` → A.5: dialog "Chọn Debit — chốt đợt đối soát" opened from `Chọn Debit (1 dòng)` with Từ/Đến ngày, kỳ, chiều đối soát, VAT, ghi chú. Exported-file content: wave export chain (100/100 cell-read suites — no reachable issued debit document on staging to click) |
| A.6 | "Dùng được: thêm giá theo loại xe; xóa rồi thêm lại y hệt không còn báo trùng" | **PASS** | `fullguide-c` → A.6 (class list 1,25/2,5/3,5/5/8/10/15 tấn + 20'/40' present; class-linked add persists with `rateKey` denormalized and the picked `vehicleSizeClassId`; DELETE → re-POST the same trio has no duplicate error) + A.6.carrier-price ("Bảng giá tiền trả nhà xe", tuyến × loại xe × Giá chung, 201 + read-back + tombstone) |
| B.1 | "Dùng được: xem chi phí chuyến" | **PASS** | `fullguide-d` → B.1: trip detail section "Chi phí lô hàng & tiền đường" with both tables |
| B.2 | "Dùng được" (OPS khai chi phí lô hàng) | **PASS** | `fullguide-e` → B.2: modal opens on `/ops/orders` with no permission refusal; Loại phí + Thực chi 15.000 + Ngày chi → Lưu → toast "Đã ghi nhận khoản chi.", row persisted on the lot (`ops_expense_entries`, YARD_STORAGE 15.000₫), then soft-voided |
| B.3 | "Dùng được: thêm dòng theo dõi" | **PASS** | `fullguide-h` → B.3: dialog "Thêm dòng theo dõi hoàn cược", required-gated "Lưu dòng", row persisted |
| B.3 bullet | "ô Tra cứu Bill gõ 4 số cuối không gợi ý Bill nào" | **STALE — fixed** | `fullguide-h` → B.3: typing `1975` renders the suggestion `YMJAE492321975YML CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH` |
| B.4 | "Dùng được" (thêm khoản chi) | **PASS** | `fullguide-f` → B.4: drawer with Nhóm chi phí / Loại chi phí / Thực chi / Thực thu / Tên khoản chi / Ngày chi / Bên thực chi / Loại chứng từ, two consecutive saves persisted, both voided at cleanup |
| B.5 | "Dùng được" (filters + 4 buttons + PHẢI THU/PHẢI TRẢ) | **PASS** | `fullguide-b` → B.5: search, Từ/Đến ngày cells (written through and re-queried), khách hàng + nhà xe filters, buttons Xác nhận đối soát / Chọn Debit / Đối soát / Hoàn tác, both column groups |
| B.6 | "Dùng được: xem yêu cầu, phiếu hoàn ứng, báo cáo; nút phê duyệt chưa kiểm tra được" | **PASS (incl. approval)** | `fullguide-g` → B.6a (Phê duyệt tạm ứng clicked, row stamped), B.6b (mandatory hoàn ứng tick present, submit gated → unlocked → submitted), B.6c (báo cáo with the negative remaining + "Đề nghị thu tiền ứng" warning) |

**All six "chưa dùng được" bullets in the manual are already fixed on this build** (A.1 label
dynamics, A.1 "+" buttons, A.1 date auto-advance, A.2 Nâng/Hạ sync, B.3 4-digit Bill lookup) plus the
B.6 "nút phê duyệt chưa kiểm tra được" gap, which now passes with the approval click. The doc's
defect list must not ship to users as-is.

## Harness repair (tech debt paid in this pass)

The 16/10 `fullguide-*` drivers FAILed on HEAD for harness reasons, not product ones. Fixed:

| Driver | Was wrong | Now |
|---|---|---|
| `fullguide-lib` | — | new shared helpers: `pickField` (address SearchableFields by `data-field-id`), `customerSites` + `siteOfType` (the form's own `/shipments/operational-sites` endpoint), `deleteLot` (DELETE needs the optimistic-lock `version`, read from the DB), `readPlanRows` (the master plan is a div grid), `clickByText` (React Aria dialogs need trusted clicks), `vnDate` |
| A | label-based pickers missed FB-105's required Nhà máy + relabelled Kho, so the UI create never submitted; A.2 asserted an em-dash layout; A.3 clicked synthetically; A.4 expected its own fixture amount; A.6-style QA price row collided with the live lane; no cleanup | pickers by field id, create asserted on the served lot + DB points, A.2 asserts the direction law on aligned cells, A.3 opens the dialog with a trusted click, A.4 asserts the merged snapshot, deadline fixtures no longer created, all four lots deleted at the end |
| B | B.5 looked for `input[type=date]` (the bar is a segmented DD/MM/YYYY pair) and B.5's date writer targeted a container that does not exist | segmented date write + read, filter presence asserted (search, 4 date cells, khách hàng, nhà xe) |
| C | class pick used the code `5T` (also matches `1.25T`) and a lane already priced today, so the create 409'd; read-back filtered a `note` column `pricing_tables` does not have | class picked by name and asserted by `vehicleSizeClassId`, clean future lane date, row existence proven by id read-back, `A.6.carrier-price` added |
| E | container option matched `order.containerNumbers[0]`, which `/ops/orders` does not carry; the Loại phí pick took a group header; the amount landed in the combobox; the wallet row was filtered by the ops-order id (not the lot id) | lot-level default kept, first real type picked, amount assigned by label→`htmlFor`, wallet matched by note, void unchanged |
| H | cleanup called a delete route the deposit tracker does not have | reports the row as registry-covered residue (`make qapurge` owns `deposit_refund_trackers`) instead of claiming a cleanup |
| G | header claimed B.6b was "expected FAIL" | header records the retest |

## Backend hardening (silent-drop class)

`POST /api/shipments` and `POST /api/shipments/quick` used to let zod **strip unknown keys**, so a
caller posting the create form's own field ids (`quantity`/`weightKg`/`volumeCbm` — the exact mistake
the old drivers made) got a 201 whose lot carried no cargo facts. The ad-hoc `containers`-only guard
is now a general one:

- `shared/src/schemas/index.ts` exports `CREATE_SHIPMENT_KEYS` / `QUICK_CREATE_SHIPMENT_KEYS`
  (derived from the schemas, so the list cannot drift).
- `backend/src/routes/shipments/shipment-shared.ts` adds `assertKnownShipmentKeys(body, allowed, scope)`:
  400 naming every unknown key; unknown keys holding an **empty array** stay accepted (the
  create-workspace's `containers: []` path); non-object bodies are left to zod.
- Both create routes call it; the `containers` message still points at
  `PUT /api/shipments/{id}/containers`.
- Tests: `backend/src/tests/unit/shipment-create-key-guard.test.ts` (6) and two new cases in
  `backend/src/tests/shipment-routes.test.ts` (unknown key rejected by name, empty-array tolerated).
  Verified: unit tier green, `shipment-routes.test.ts` 141/141, the 13 create-path integration files
  246/246.

## Corrected findings (the earlier draft of this record was wrong)

Three items listed as defects in this file's first draft were **probe artefacts**, not product gaps —
recorded here so nobody re-files them:

1. `GET /api/shipments/:id` **does** expose the optimistic-lock `version` (nested at
   `json.shipment.version`; the list carries it too). The probe read the top level.
2. There is no `GET /api/shipments/:id/expenses` route for the lot's cost list; the probe invented
   it (403 for OPS is the casbin "wrong path" behaviour documented in `testaccounts.txt`). Lot costs
   are read through `/ops/wallet/expenses`, `/ops/admin/expenses` and the accountant drawer.
3. `pricing_tables` **has no `note` column** and the config page has no note field; the probe (and
   the old driver) invented that field. `carrier_route_pricing` does carry one.

## Open / not covered

- A.5's exported Debit Note **file bytes** (biển số báo khách / loại xe / số tiền) are still proven
  by the cell-read suites + `billing-document-draft.service.ts`, not by a staging export click — no
  issued debit note is reachable on staging.
- The deposit tracker (and the advance tables) have **no delete route**; QA rows there are cleaned by
  the sanctioned registry purge, not by the API. Whether accountants should be able to delete a
  tracker row is a product call, not a bug — nothing was invented here.
- Real-device safe-area / inset behaviour is out of scope (owner device).

## Fixture hygiene

`fullguide-a` now deletes its own lots (`deleteLot`); `fullguide-c` tombstones both price rows
(`pricing_tables` row + `carrier_route_pricing` row, `liveQaRows=0`); `fullguide-e`/`fullguide-f`
soft-void every ops expense they write. Anything left by an interrupted run is swept by
`EXPECT_BUILD=<hash> node testplan/qa/scripts/2026-10-17-manual-residue-cleanup.mjs`
(governed delete for `QA-FG16-%` / `QA-MAN-A1-%` lots, then reports the registry-only residue).

End state of this pass: `stillLots=0`, `qaOpsExpenses=0` live (the voided rows are the app's own
delete semantics), and the four rows that no API can delete (2 `deposit_refund_trackers`, 2
`advance_requests`) were removed with the sanctioned sweep — `make qapurge` reported
`advance_requests deleted=2`, `deposit_refund_trackers deleted=2` (`deleted=88` across all registry
surfaces, `remaining=38` guarded skips that belong to other lanes).

Earlier evidence from this session's first pass (the throwaway probe drivers, since deleted) is kept
unmodified at `qa/run-probe*.out` and `qa/2026-10-17_manual_*.png`.
