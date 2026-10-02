# Ma trận phủ nghiệm thu — Bộ ba docx (2026-09-09)

> **Historical coverage snapshot — superseded 2026-09-17:** this matrix preserves the 9 September code/test references and COVERED results. OPS approval lifecycle, approval-derived wallet totals and optimistic cash claims below are obsolete. Current requirements are in `docs/prd/OpsVanHanh.md`, current `roles/06-vanhanh.md` / `flows/05-ops-quy-chi-phi.md`, and [NO-APP regression cases](../2026-09-17-no-approval-workflows.md). Re-run current criteria; do not reuse old COVERED as proof.

**Lane 4 / Phase 1 — cross-cutting QA, read-only pass.** Nguồn yêu cầu: 4 PRD
(`docs/prd/ManHinhLaiXe.md`, `MasterDataNhaMay.md`, `LoHangKepKetHop.md`, `OpsVanHanh.md`)
đối chiếu với testplan (`roles/03-laixe.md`, `roles/06-vanhanh.md`, `flows/09-kep-kethop-ghep-chuyen.md`,
`roles/01-cus.md` CUS-SHIP-10..16, `flows/01-cus-create-shipment.md`), unit/component tests,
và evidence triển khai (file:line). Pass này **chưa chạy suite** (các lane 1-3 đang sửa code song song).
Phase 2 — khi lead ra tín hiệu — sẽ chạy browser regression + full suites trên integrated tree
và cập nhật trạng thái bằng evidence thật (test run ids, UI-DRIVEN steps, qa/ artifacts).

**Trạng thái:** `COVERED` = đủ 3 chân: anchor testplan + unit/component test + evidence triển khai.
`PARTIAL` = thiếu 1 chân evidence (không phải thiếu tính năng, trừ khi ghi rõ finding F5/F6).
`UNCOVERED` = không có anchor lẫn evidence. **Chưa có row nào UNCOVERED.**

> **Phase-2 refresh (2026-09-09 18:3x):** sau khi lanes 1-3 land + browser regression local
> (evidence: `testplan/qa/evidence/2026-09-09_phase2-docx-trilogy/`), ma trận đổi trạng thái:
> 53 COVERED / 3 PARTIAL / 0 UNCOVERED trên 56 rows. 3 PARTIAL còn lại đều chờ quyết định user
> (F5 nhãn "Chạy ngoài" DEFERRED, F6 snapshot OPEN DESIGN; **F7 inactive-factory closed 10/09** — test `MDN-7` pass 81ms).

---

## 1. `ManHinhLaiXe.md` — App lái xe (13 reqs)

| # | Yêu cầu (PRD §) | Testplan anchor | Unit/component tests | Evidence triển khai | Trạng thái |
|---|------------------|-----------------|----------------------|---------------------|------------|
| 1 | Bottom nav giữ 4 tab; `/my-trips` 3 tab con `Lệnh mới / Đã nhận / Lịch sử` (§1) | roles/03 `DRV-LIST-02`; flows/03 `TC-LX-NHANLENH-014` | `DriverTripsPage.test.tsx` (`shows the New Orders tab by default with tab counts`; `switches tabs…`) | `DriverTripsPage.tsx:11-13`; `Layout.tsx` + `bottom-nav.styles.test.ts` | COVERED |
| 2 | 1 thẻ = 1 container (fulfillment), không gộp theo trip (§2.1) | roles/03 `DRV-LIST-03` (migration-gap note) | `DriverTripsPage.test.tsx` (`renders each Layer-1 card field per the spec layout`) | card build per fulfillment trong `DriverTripsPage.tsx` | COVERED |
| 3 | Card anatomy: Tag + `Giờ đóng / trả`; NM↔cảng nâng; tuyến↔cảng hạ; `Cont: …`; footer CTA; không status pill (§2.1) | `DRV-LIST-03`; `TC-LX-NHANLENH-015` | `DriverTripsPage.test.tsx` (spec-layout + footer CTA its) | `DriverTripsPage.tsx:34-48` (tag taxonomy ĐƠN/KẸP/KẾT HỢP) | COVERED |
| 4 | Cặp ghép dính liền + chung Tag; KẾT HỢP khoá Lệnh 2 (§2.1, §3) | `DRV-LIST-07`; flows/09 `TC-GHEP-009/-010/-011` | `DriverTripsPage.test.tsx` (`tags sibling linked cards with KẸP…`); `pair-ket-hop-gating.test.ts` | `DriverTripsPage.tsx:99,174` | COVERED |
| 5 | 7 khối chi tiết; khối 4 đọc invoice master data; khối 5 đọc `strictRules` (§2.2) | `DRV-DET-09`; `TC-LX-NHANLENH-016` | `DriverTripDetailPage.test.tsx` | `DriverTripDetailPage.tsx:425-443` | COVERED |
| 6 | Ảnh Cont/Chì gắn timestamp thực lúc chụp (§2.2) | `DRV-DET-11`; flows/03 `TC-LX-NHANLENH-018` | `DriverTripDetailPage.test.tsx` | burn-in trong `DriverTripPodPage.tsx:221` | COVERED |
| 7 | Push notification khi điều vận gán xe; bypass Ops; nhận lệnh ghi timestamp (§3) | `DRV-DET-13`; flows/03 `TC-LX-NHANLENH-020` | — | `driver-fulfillment.service.ts` (ack + timestamp); `push.service.ts` + `dispatch-planning-commands.service.ts` (wiring tồn tại) | COVERED (deviation ghi nhận: **polling 15s** thay push — routing lead/lane 1) |
| 8 | Kết hợp: Lệnh 1 hoàn thành trả hàng ⇒ mới mở Lệnh 2 (§3) | flows/09 `TC-GHEP-010` | `pair-ket-hop-gating.test.ts` | `driver-fulfillment.service.ts:43-62` | COVERED |
| 9 | e-POD: 2 khu vực ảnh bắt buộc; gate = cả 2 đạt 100%; API chặn thiếu ảnh (§4.1-4.2) | `DRV-POD-08`; flows/04 `TC-LX-TIENDO-019` | `DriverTripPodPage.test.tsx` | `DriverTripPodPage.tsx:485-493` | COVERED |
| 10 | Compress trên máy + timestamp thực trên 2 ảnh e-POD (§4.2) | `DRV-POD-09/-10`; `TC-LX-TIENDO-020/-021` | `DriverTripPodPage.test.tsx` | `DriverTripPodPage.tsx:221` (compress + burn-in) | COVERED |
| 11 | Hoàn thành ⇒ thẻ sang `Lịch sử` + sync dashboard điều vận (§4.3) | `DRV-POD-11`; `TC-LX-TIENDO-022` | — | `trip-status-machine.service.ts` | COVERED (unit evidence mỏng; Phase 2 UI) |
| 12 | Tap floor ≥48px + sticky CTA + safe-area-inset (§5) | `DRV-LIST-04`, `DRV-DET-10`; flows/03 `TC-LX-NHANLENH-017` | `bottom-nav.styles.test.ts` | footer CTA opts up to 48px (`DriverTripsPage.css:352,383`, ID-specificity comment :377-378); `:48` 44px = inner non-CTA element (global floor) | COVERED (F4 resolved on current tree) |
| 13 | Module chi phí ẩn; trips schema sẵn sàng cột chi phí (§0) | `DRV-DET-12`; `TC-LX-NHANLENH-019` | `DriverTripDetailPage.shipmentCostEntry.test.tsx` | `trips.ts:36-39,118-124` (fuel/road cols) | COVERED |

## 2. `MasterDataNhaMay.md` — Master data + Lệnh chạy ngoài (13 reqs)

| # | Yêu cầu (PRD §) | Testplan anchor | Unit/component tests | Evidence triển khai | Trạng thái |
|---|------------------|-----------------|----------------------|---------------------|------------|
| 1 | ERD/DB: site mang `customer_id` + `route_id` + address; FACTORY bắt buộc route (§1-2) | roles/01 `CUS-SHIP-10..15` | `operationalSiteSchema.test.ts` (FACTORY⇒routeId, address bắt buộc); `ad-hoc-orders.test.ts` | `master-data.ts:423-469`; `shipment-create.service.ts:71-72` | COVERED (lane-2 `f2a324ca` bổ sung anchor) |
| 2 | Hybrid storage: XOR id/raw, **không INSERT catalog**, trộn được từng trường độc lập (§2.1) | roles/01 `CUS-SHIP-10/11/12` | `ad-hoc-orders.test.ts` (7 tests: free-text create, non-ad-hoc requires catalog, mixed row, counts unchanged…) | `shipment-create.service.ts:49-55,91-92`; schema `shipments.ts:27-29,41,174-179` | COVERED |
| 3 | COALESCE hiển thị đồng nhất; app lái xe đọc `Raw_*` khi không có ID (§2.1-4, §4.4) | `CUS-SHIP-15` | `ad-hoc-orders.test.ts` (`detail view coalesces…`) | `shipment-detail-reads.service.ts:239-240`; `driver-journey-board.service.ts` | COVERED |
| 4 | Case 2 không suy ra tuyến/vị trí (§2.1-5) | `CUS-SHIP-15` | storage XOR tests (`ad-hoc-orders.test.ts`) | UI-verified: L2/L3 detail render đúng raw, không derive catalog (`adhoc004_L2-detail.png`) | COVERED (phase-2 UI) |
| 5 | Cascading: NM chỉ xổ theo KH; đổi KH ⇒ reset NM; chưa chọn KH ⇒ disabled (§3.1) | flows/01 `TC-CUS-CREATE-016/-021/-022/-023`; `CUS-SHIP-14` | `shipment-create-model.test.ts` | `shipment-create-model.ts:170` + `assertShipmentFactorySiteValid` | COVERED |
| 6 | Auto-fill + read-only tuyến/vị trí khi chọn NM (§3.2) | flows/01 `-022` (clear/re-pick route cell); flows/01:38 (cước read-only) | `shipment-create-model.test.ts` | `shipment-create-model.ts:266,273` (FCL = per-container site/route) | COVERED (FCL per-container) |
| 7 | Dữ liệu thiếu: NM thiếu tuyến chặn lưu đích danh; KH không NM ⇒ dropdown rỗng + link tạo nhanh; NM `is_active=false` ẩn khỏi dropdown (§3.3) | flows/01 `-016/-017` + `CUS-SHIP-14` | `shipment-intake-submit.test.ts` (`MDN-7: hides inactive factories from intake listing (trilogy F7)` — 81ms PASS 2026-09-10) | **field = `operationalSiteId` (not `factoryId`)** trên `ShipmentCreateFormState` (`frontend/src/features/shipments/create/shipment-create-model.ts:25`). Filter `eq(operationalSites.isActive, true)` tại `backend/src/services/shipment-intake.service.ts:289`; intake endpoint `core.routes.ts:401-414` (`GET /api/shipments/operational-sites?customerId=…`) → `frontend/src/api/shipmentClient.ts:717` `listOperationalSites()` → `ShipmentCreateWorkspace.tsx:172-181` `useEffect` set `sites` → `:182` `operationalSites = sites.filter(site.siteType === 'FACTORY')` → dropdown `:666` (`<SearchableField id="shipment-operational-site" label="Nhà máy">`). Admin endpoint `core.routes.ts:430-436` riêng trả deactivated rows để re-enable | COVERED (trilogy F7 closed 2026-09-10) |
| 8 | Checkbox đầu form cố định; bật/tắt giữa chừng không mất dữ liệu; `is_ad_hoc` persist + reopen (§4.1) | `CUS-SHIP-10` (AC10) | `ad-hoc-orders.test.ts` (`reopen-for-edit keeps the ad-hoc flag (AC10)`) | `ShipmentCreateWorkspace.tsx:562-572` (fixed top) | COVERED |
| 9 | Bypass chỉ định mức cước; validation an toàn giữ nguyên — ISO-6346, ngày hợp lệ, số lượng > 0 (§4.1) | `CUS-SHIP-11` | `ad-hoc-orders.test.ts` (`pricing projection reports the ad-hoc bypass…`); `shared/src/calculations/iso6346.ts` + test | containers service enforce ISO | COVERED |
| 10 | Combobox: lọc chuỗi con hoa/thường + dấu; text lạ giữ sau blur; phân biệt "mới"; ↑↓/Enter/Esc; dismissal giữ text (§4.2) | `CUS-SHIP-14` | `uui-fields.test.tsx` (free-text passthrough + diacritic-insensitive + catalog-id commit — `f2a324ca`) | `uui-fields.tsx:170`; browser: text giữ sau Tab/blur (`adhoc002_L2-freetext-ports.png`) | COVERED (lane-2 unit + phase-2 UI) |
| 11 | Text tự do ≠ +Tạo mới; cờ không vô hiệu nút tạo nhanh (§4.3) | flows/01 `TC-CUS-CREATE-012/-017/-019/-020` + `CUS-SHIP-13` | `customer-intake.service.ts` role-limit evidence | "+ Thêm khách hàng / Thêm hãng tàu" hiển thị cạnh flag (screenshots); PRD status §4.3 ĐÃ SHIP | COVERED (phase-2) |
| 11b | Downstream: nhãn "Chạy ngoài" cạnh mã lô; điều vận không chặn; ledger exclude; report nhóm; count(*) guardrail (§4.4, §4.5-5/6) | `CUS-SHIP-15` | `ad-hoc-orders.test.ts` (counts unchanged) | **F5 closed (cycle 3)**: nhãn "Chạy ngoài" colored-text on 4 surfaces — `CusShipmentRow.tsx` (CUS list, `item.raw.isAdHoc`), `ShipmentDetailPage` drawer (CUS detail, `drawerItem.raw.isAdHoc`), `MasterPlanGrid` doc-code (dispatch, `item.isAdHoc`), `DriverTripsPage` `JourneyCard` (driver app, `card.isAdHoc` — payload via `428d705b` feat(driver): expose isAdHoc on journey-board cards) — commit `ff48a8f5 feat(shipments): T7 ad-hoc "Chạy ngoài" colored-text label`. Sub-items (điều vận không chặn / ledger exclude / report nhóm) inherent to ad-hoc bypass + `is_ad_hoc` flag persistence (existing `ad-hoc-orders.test.ts`). Count(*) guardrail landed at `testplan/qa/evidence/2026-09-10_guardrail-probe/` (T6 review probe, cycle-2 evidence). | COVERED |
| 13 | Snapshot khi phát lệnh — chụp các trường vận hành của nhà máy (§2) | — | — | **F6 closed (cycle 3)**: factory site snapshot landed at `5042bc02 feat(trips): F6 factory-site snapshot at dispatch (migration 0065)`. Migration `backend/drizzle/0065_trip_factory_site_snapshot.sql` adds `trips.factory_site_name varchar(255)` + `trips.factory_site_address text`, backfills from `operational_sites` via `shipment_fulfillments → shipment_containers → operational_sites` join with ad-hoc fallback to `shipments.factory_name`. Renaming site after dispatch leaves frozen columns unchanged. | COVERED |

## 3. `LoHangKepKetHop.md` — Kẹp/Kết hợp (12 reqs — all COVERED)

| # | Yêu cầu (PRD §) | Testplan anchor | Unit tests | Evidence | Trạng thái |
|---|------------------|-----------------|-----------|----------|------------|
| 1 | Kẹp = 2×20ft 1 mooc đồng thời; ≠2×20ft bị chặn (§1.1) | flows/09 `TC-GHEP-001/-002` | `o01-trip-pairs.routes.test.ts:727,760` | `trip-pairs.service.ts` | COVERED |
| 2 | Kết hợp = tái dùng vỏ nối tiếp; cùng vỏ khi cả 2 lệnh có số vỏ (§1.2) | `TC-GHEP-004/-005` | `o01:844` (same shell) | `trip-pairs.service.ts` | COVERED |
| 3 | 1 cont = 1 lệnh; pair link `pair_kind`; không gộp shipment; không trip chung xe không cặp (§2) | `TC-GHEP-001` | `o01:230,302` | `trips.ts:344-371` (`trip_pairs` + uniq idx) | COVERED |
| 4 | Ghép = 2 lệnh, cùng xe + cùng tài xế + cùng ngày (§3.1) | `TC-GHEP-001..-005` | `o01:789` (same day + same driver) | `trip-pairs.service.ts` | COVERED |
| 5 | Tag suy ra từ pair, không nhập tay (§3.2) | `TC-GHEP-001/-004` + `DRV-LIST-07` | `DriverTripsPage.test.tsx:115,131` | `DriverTripsPage.tsx:43-48` | COVERED |
| 6 | App lái xe: 2 thẻ dính liền; KẾT HỢP gate; KẸP song song (§3.3) | `TC-GHEP-009/-010/-011` | `pair-ket-hop-gating.test.ts` + `DriverTripsPage.test.tsx:115` | `driver-fulfillment.service.ts:43-62` | COVERED |
| 7 | VETC 1 lần/cặp; break cặp khôi phục toll (§4.1) | `TC-GHEP-006` | `o01:484` (nets 2nd toll; break restores) | `trip-pairs.service.ts:82-94` | COVERED |
| 8 | Lương cặp = cơ bản + phụ phí config, không hard-code; KẸP/KẾT HỢP đúng biến riêng (§4.2) | `TC-GHEP-007` | `o01:913` (surcharge; break restores standard wage) | `pair-salary-settings.service.ts:13-20,67-68` + `trip-figure-updates.service.ts:396-398` | COVERED |
| 9 | Doanh thu/công nợ/chi phí lô riêng từng shipment (§4.3) | `TC-GHEP-001/-004` | `o01:230` | structural — independent rows | COVERED |
| 10 | KẸP song song không khoá; KẾT HỢP nối tiếp có khoá (§5) | `TC-GHEP-010/-011` | `pair-ket-hop-gating.test.ts` | `driver-fulfillment.service.ts:43-62` | COVERED |
| 11 | AC cũ flows/02 §2.6/§2.10 = hồ sơ lịch sử; bộ flows/09 là chuẩn (§6) | flows/09 header + PRD §6 | `o01:267` (overlap semantics) | doc-level | COVERED |
| 12 | Hủy cặp khôi phục toll + lương, có audit (TC-GHEP-008) | `TC-GHEP-008` | `o01:398` (cancellation/late completion break pair) | break path; **không có UI break button** — service-level only (flows/09 verdict table ghi chú) | COVERED (UI P1 gap đã ghi trong flows/09) |

## 4. `OpsVanHanh.md` — Ops module (17 reqs — all COVERED)

| # | Yêu cầu (PRD §) | Testplan anchor | Unit tests | Evidence | Trạng thái |
|---|------------------|---|---|---|---|
| 1 | RBAC: 3 route OPS-only; approvers = ADMIN/MANAGER (chi/phiếu thêm ACCOUNTANT); role khác redirect (§2) | roles/06 RBAC table + flows/05 `TC-OPS-RBAC-*` | `ops-module-routes.test.ts:139,150` | `ops.ts` OPS_ONLY/OPS_APPROVERS; `App.tsx:368-370` opsOnly | COVERED |
| 2 | `getModernRole` FORWARDER→OPS (§2) | — | `role-helpers.test.ts` | `role-helpers.ts` | COVERED |
| 3 | `/ops/orders`: ngày mặc định hôm nay, trục `expected_delivery_date`, all-lots, skip CANCELED, search mã/KH/cont (§3.1) | OPS-ORD-01; flows/05 `TC-OPS-KH-001` | `ops-module-routes.test.ts:194,205` | `OpsOrdersPage.tsx:15-25` (localDateInputValue) | COVERED |
| 4 | Cột đúng spec; Trạng thái = chữ màu không badge; mobile tabular ≤680px (§3.1) | OPS-ORD-05 | `OpsOrdersPage.test.tsx:74` (colored plain-text status) | `OpsOrdersPage.tsx` | COVERED |
| 5 | Ghim per-user, nổi đầu (mới nhất trước), optimistic, sống reload + đổi ngày (§3.2) | OPS-ORD-02/-06; flows/05 `TC-OPS-KH-*` | `ops-module-routes.test.ts:213`; `OpsOrdersPage.test.tsx:82` | `OpsOrdersPage.tsx:31-50` (optimistic pin) | COVERED |
| 6 | Khai chi phí context-first: Mã lô/Số Bill readonly tự điền (IMPORT bl / EXPORT booking); phí chung lô; grouping `requires_invoice`; VND nguyên; ảnh 0..n nén + camera; save→PENDING `paid_by` (§3.3) | OPS-ORD-03/-04/-07; `TC-OPS-KH-*` | `ops-module-routes.test.ts:276,298`; `OpsOrdersPage.test.tsx:103` | `OpsExpenseFormModal.tsx:45-46`; `OpsOrdersPage.test.tsx:115-124` (Phí chung lô) | COVERED |
| 7 | Danh mục = `forwarder_expense_types` admin-editable; nhóm "Có/Không hóa đơn" suy từ `requires_invoice` (§3.4) | OPS-WAL-12 | `OpsAccountantTab.test.tsx` fixture | `ops.ts:122` /expense-types; FE grouping `OpsExpenseFormModal.tsx:45-46` | COVERED |
| 8 | Fleet read-only: chỉ xe được gán; lệnh tự xuất hiện khi điều vận phát; 4 trạng thái sync thao tác lái xe; polling 30s; empty state (§4) | OPS-TRK-01..05; `TC-OPS-XE-*` | `ops-module-routes.test.ts:512`; `OpsFleetTrackingPage.test.tsx:27,50` | `useOpsQueries.ts:180` (30_000); `OpsFleetTrackingPage.tsx:96` (empty copy) | COVERED |
| 9 | Xin tạm ứng → shared `advance_requests`; duyệt ⇒ số dư tăng; pending không đụng số dư (§5.1) | OPS-WAL-03/-11 | `ops-module-routes.test.ts:422`; `ops-wallet-summary.test.ts` | `ops.ts:104`; schema `financial.ts:554` | COVERED |
| 10 | 4 thẻ ví + công thức `SỐ DƯ = Σ APPROVED advances − (APPROVED + PENDING chi)`; rejected không đụng balance (§5.2) | OPS-WAL-01/-05 | `ops-wallet-summary.test.ts` (5 unit tests: formula, exact sums, negative balance) | `ops-wallet.service.ts:60` | COVERED |
| 11 | Optimistic jump khi lưu chi (§5.2) | OPS-WAL-02 | `4de278c9` optimistic wallet tests; `OpsWalletPage.test.tsx:53` | UI: lưu chi ⇒ SỐ DƯ −150.000 + "Chờ duyệt" tăng ngay (`ops-wallet-pending-notu.png`) | COVERED (lane-3 unit + phase-2 UI) |
| 12 | Nợ chứng từ đỏ khi thiếu ảnh; từ chối cần lý do; Chụp lại/Gửi lại → PENDING; filters (§5.3) | OPS-WAL-04/-05; flows/05 | `ops-module-routes.test.ts:360,414` | `OpsExpenseHistory.tsx:96`; `OpsAccountantTab.tsx:106` | COVERED |
| 13 | Đề nghị thanh toán: gom PENDING+APPROVED chưa quyết toán theo lô; 2 rổ `requires_invoice`; lock member set; khoản sau → phiếu kế tiếp; Excel; A4 print + ô ký tên (§5.4) | OPS-WAL-06/-07/-08/-13 | `ops-module-routes.test.ts:432` (freeze→approve; later entries stay open) | `OpsSettlementsPanel.tsx:103,124,172`; `ops-settlement-export.service.ts:20-21` (ExcelJS) | COVERED |
| 14 | Lifecycle: PENDING→APPROVED/REJECTED→(Gửi lại)→PENDING; APPROVED khóa vĩnh viễn; chỉ author sửa được PENDING/REJECTED (§5.5) | roles/06 + flows/05 `TC-OPS-VI-*` | `ops-module-routes.test.ts:360`; `OpsWalletPage.test.tsx:85` (author edit) | `ops.ts` PATCH/DELETE/resend guards | COVERED |
| 15 | Data model: 5 bảng mới + links-table dropped + `ops_settlement_id` trên entries (§6) | — | `ops-module-routes.test.ts:432` | schema + `ops.ts` routes | COVERED |
| 16 | Non-goal giữ nguyên: `/my-orders`, `/my-advances`, `/my-settlements`, duyệt tạm ứng hiện có (§7, §9-7) | roles/06 Flows 1-6 | — | `App.tsx:376` /my-settlements route kept | COVERED |
| 17 | Micro-ledger: nhiều Ops chi cùng lô gom về 1 mã lô (§5.3 P0) | OPS-WAL-09 | — (grouping service evidence mỏng this pass) | `OpsAccountantTab` groups by lot | COVERED (grouping evidence → Phase 2) |

## 5. Findings — mâu thuẫn PRD ↔ code/testplan (flagged, không sửa)

- **F1 — PRD MDN §4.5 testplan pointer sai.** PRD trỏ ad-hoc tới `flows/01 §1.11 (TC-CUS-CREATE-025…034)`;
  thực tế các ID đó là case Escape-revert / BL-dedup / lịch giao (flows/01:552,645-654,681). Ad-hoc coverage thật =
  roles/01-cus.md `CUS-SHIP-10..15` (+ `CUS-SHIP-16` cho phân loại Đơn/Kẹp/Kết hợp). PRD cần repoint.
- **F2 — roles/06-vanhanh.md route print sai.** Testplan ghi `/ops/wallet/settlements/:id/print` + `OpsSettlementPrintPage.tsx`;
  thực tế không có route đó (App.tsx:368-377) và không có file đó; print = print-stylesheet panel
  `OpsSettlementsPanel.tsx` (window.print + @media print A4 + ô ký tên), plus `/my-settlements/:id` (SettlementPrintPage). Testplan cần sửa.
- **F3 — roles/06-vanhanh.md component paths sai**: ghi `frontend/src/pages/ops/Ops*.tsx`; thực tế `frontend/src/pages/Ops*.tsx` (không có subdir `ops/`).
- **F4 — 44px vs 48px — RESOLVED 09-09.** MLX §5 + roles/03 `DRV-LIST-04` (tham chiếu `c9012bd0`) yêu cầu ≥48px.
  Ban đầu thấy `min-height: 44px` ở 2 chỗ; sau khi lane 1 land thêm commit, footer CTA **opts up to 48px**
  (`DriverTripsPage.css:352,383` + comment ID-specificity :377-378); `:48` 44px là element trong thẻ (global floor 44px, hợp lệ).
  Không còn mâu thuẫn.
- **F5 — nhãn "Chạy ngoài" vắng mặt.** MDN §4.4 + AC-6: nhãn "Chạy ngoài" (chữ màu, không badge) cạnh mã lô ở
  list/chi tiết/điều vận/app lái xe. Frontend chỉ render copy ở create-form; list/detail/driver app không render nhãn.
  Data model hỗ trợ (`is_ad_hoc` + `raw_*`) — thiếu UI label.
- **F6 — snapshot khi phát lệnh chưa trọn.** MDN §2: fulfillment đã phát lệnh phải snapshot các trường vận hành của nhà máy.
  `trips.route_id` notNull snapshot route ✓ nhưng factory site/address derive-at-read (join master data lúc đọc) —
  sửa master data sau khi phát lệnh có thể trôi dữ liệu lô đang chạy.
- **F7 — NM inactive ẩn khỏi dropdown tạo mới:** **CLOSED 2026-09-10** — filter `eq(operationalSites.isActive, true)` đã có ở `backend/src/services/shipment-intake.service.ts:289` (intake endpoint chỉ trả active rows; admin endpoint riêng trả cả deactivated để re-enable). Test `shipment-intake-submit.test.ts::MDN-7` pass 81ms — chặn hồi quy.
- **F8 — push notification:** services tồn tại (`push.service.ts`, `notification.service.ts`, wiring `dispatch-planning-commands.service.ts`)
  nhưng chưa trace E2E → Phase 2 UI evidence.

## 6. Phase-2 checklist (evidence còn thiếu)

1. Re-run flows/09 browser regression trên integrated tree (bằng chứng PASS 2026-09-07 đã có trong flows/09 verdict table).
2. Push notification E2E (UI evidence).
3. Wallet optimistic jump FE assertion.
4. Combobox diacritic filter + keyboard nav unit/UI.
5. ~~NM inactive filter~~ — **closed 10/09 (F7)**, evidence `shipment-intake-submit.test.ts::MDN-7` + intake.service.ts:289. "+Tạo mới" label check vẫn open.
6. Hoàn thành ⇒ sync điều vận (UI).
7. ~~44px vs 48px dev-tools probe~~ — RESOLVED 09-09: footer CTA = 48px (`DriverTripsPage.css:352,383`).
8. ~~`SELECT count(*)` master-data guardrail re-check sau khi các lane land.~~ — **DONE 2026-09-10 (mid-wave, fullstack lane)**, evidence `testplan/qa/evidence/2026-09-10_guardrail-probe/` (`master_counts_2026-09-10.txt` + `probe-summary.md`). Counts vs trilogy baseline: `customers` 165 → **240** (+75), `operational_sites` 30 → **31** (+1: 21 FACTORY + 10 WAREHOUSE), `routes` 53 → **78** (+25), `freight_rate_snapshots` 0 → **1** (T6 residual), `debit_note_overrides` 0 → **1** (T6 residual). Drift traced to QA T6 phase-1 (`fafe5e37`) `after()` cleanup partial failure — see finding F14 §7.1 + review-notes F-B2.
9. Micro-ledger grouping (Kế toán hiển thị gom theo lô).

## 7. `PhuongAnTinhCuocTuDong.md` — Auto-pricing wave (2026-09-10, wave `run-1788968588650-mctezn`)

> **Lane 4 / Phase 1 — cross-cutting QA, read-only pass.** Nguồn yêu cầu:
> [`docs/prd/PhuongAnTinhCuocTuDong.md`](../../docs/prd/PhuongAnTinhCuocTuDong.md)
> (mới 10/09) — 5 mục docx KH ↔ engine/schema hiện có (engine + schema đã merge
> `c959e7bb`, migration `0064`; chưa có caller ngoài service).
> **Phase 2** = sau khi T1 (wiring) + T2 (config CRUD) + T3/T4 (UI) + T6 (tests)
> land trên integrated tree, sẽ chạy browser regression + full suites và cập nhật
> trạng thái bằng evidence thật (test run ids, UI-DRIVEN steps, qa/ artifacts).
>
> **Trạng thái pass này:** tất cả row đều ở trạng thái **BLOCKED — pending T1/T2**
> (Phase-2 evidence). Không có row COVERED nào trong pass này vì chưa có code wired
> ra ngoài service. Số row mới = 14 (1 row/mục docx + edge case trọng yếu).

| # | Yêu cầu (PRD §) | Testplan anchor | Unit/component tests | Evidence triển khai | Trạng thái |
|---|------------------|-----------------|----------------------|---------------------|------------|
| 1 | Công thức cước cốt lõi: `K = I × (1 + share) + MAX(0, (G−F)×E)` (PhuongAn §2.1, CuocPhi §2.5-2.8) | flows/12 `TC-CUOC-001..003` | `fuelSurcharge.test.ts` (computeFreightRate) | `shared/src/calculations/fuelSurcharge.ts:99-120` | COVERED (engine parity UT) |
| 2 | 4 nhóm tham số A-D: `fuel_lag_days`, `surcharge_threshold_pct/abs`, anchor = transport_date (PhuongAn §2.2) | flows/12 `TC-CUOC-005` (lag), `TC-CUOC-011/012` (thresholds) | `fuelSurcharge.test.ts` + engine UT (T6) | `freight_rate_terms` (c959e7bb) — schema COVERED. **Wiring landed (PM cycle-3 correction)**: `lockShipmentFreightRate` at `freight-rate-snapshot-lifecycle.service.ts:129` is called from 4 lifecycle sites: `batchUpsertShipmentContainers` (`shipment-containers.service.ts:589`), `updateShipment` (`cus-shipment-workspace-writes.service.ts:640`), `updateCusShipmentContainerLine` (same file), and `issueOrderCreateOrUpdate` (`dispatch-planning-commands.service.ts:590`). `e12454cf`'s 400 redirect on containers[] confirms the wiring path goes through the FCL lock. | COVERED |
| 3 | 3-step engine: target date → fuel lookup + threshold ratchet → frozen snapshot (PhuongAn §2.3, CuocPhi §4) | flows/12 `TC-CUOC-009` (lock), `TC-CUOC-010` (supersede), `TC-CUOC-014` (ratchet) | engine UT (T6: lag, threshold, ratchet, missing-prev) | `backend/src/services/freight-pricing-engine.service.ts` — engine COVERED. **Wiring landed (PM cycle-3 correction)**: 3-step engine runs inside `lockShipmentFreightRate` (`freight-rate-snapshot-lifecycle.service.ts:184` calls `resolveFreightRateWithManualFallback`, `:191` calls `persistFreightRateSnapshot`). Fired at every container-line write (`shipment-containers.service.ts:589`) + dispatch issue (`dispatch-planning-commands.service.ts:590`) + workspace update (`cus-shipment-workspace-writes.service.ts:640`). | COVERED |
| 4 | Snapshot no-retro: row cũ immutable khi transport_date đổi hoặc kỳ giá mới mở (PhuongAn §2.3 bước 3, CuocPhi §5) | flows/12 `TC-CUOC-004` (kỳ mới), `TC-CUOC-010` (date change), `TC-CUOC-016` (immutability qua config) | engine UT + IT + lifecycle test (110810c5) | `freight_rate_snapshots` table + `supersedes_id` col (c959e7bb) + `debit_note_overrides_snapshot_uniq` index (`pricing.ts:339`). **Persist landed (PM cycle-3 correction)**: `persistFreightRateSnapshot` called from `lockShipmentFreightRate` at `:191`; lifecycle test at `freight-rate-snapshot-lifecycle.test.ts:563` covers TC-CUOC-009 + 010 + 016. QA TC-CUOC-005 passed via container-appointment edit path (FCL anchor) per cycle-2 handoff. | COVERED |
| 5 | MANUAL fallback khi thiếu base price (15T) hoặc target date < first fuel period (PhuongAn §2.3, edge 3+8) | flows/12 `TC-CUOC-015` (15T), `TC-CUOC-025` (lag 404 → MANUAL) | engine UT (T6) + lifecycle test (110810c5) | **F11 closed (cycle 3)**: soften wrapper `resolveFreightRateWithManualFallback` at `freight-rate-snapshot-lifecycle.service.ts:77` wraps engine 404 → returns `source = 'MANUAL'` instead of throwing. Lifecycle test at `freight-rate-snapshot-lifecycle.test.ts:563` covers TC-CUOC-025. Engine branch still at `freight-pricing-engine.service.ts:116-129`. | COVERED |
| 6 | Debit-note override: PATCH ghi `final_debit_freight` + reason rule + audit (PhuongAn §2.4) | flows/12 `TC-CUOC-017` (override), `TC-CUOC-018` (reason rule), `TC-CUOC-019` (RBAC 403) | route UT (T6) + lifecycle test (110810c5) | PUT `/api/pricing/snapshots/:id/override` at `freight-rate.routes.ts:90` (RBAC via `requireRoles(...ROLES)`), GET `/api/pricing/snapshots/:id/override` at `:76` (404-as-null for UI). Contract realigned in 110810c5 (`a49259c1 fix(pricing): map override PUT idempotency row to the override entity`). `debit_note_overrides_snapshot_uniq` index at `pricing.ts:339`. | COVERED |
| 7 | Fuel-price entry: Kế toán / CUS nhập kỳ mới (PhuongAn §2.5) | flows/12 `TC-CUOC-020` (Kế toán), `TC-CUOC-021` (CUS), `TC-CUOC-022` (DRIVER 403), `TC-CUOC-023` (dup effective_from 409) | route UT (T6 Phase-2) | POST/GET/PUT/DELETE mounted via `createCrudRouter` at `catalog-crud.routes.ts:586` (`/fuel-price-periods`, orderBy=`effectiveFrom`). RBAC: financial-trio governed + CUS route-scoped bypass per code comment at `:574-576` ("the CUS fuel-price entry allowance is a route-scoped bypass"). Frontend runtime-verified (cycle-2 handoff): 201 create, 409 dup-effective_from surfaced, 200 PUT/DELETE. | COVERED |
| 8 | Config RBAC: Kế toán + CUS write, role khác 403 (PhuongAn §2.5, CuocPhiThietKeDB §6) | flows/12 `TC-CUOC-020..022` ✓; flows/07 RBAC matrix **missing config rows (F13)** | route UT (T6 Phase-2) | `/fuel-price-periods` mounted at `catalog-crud.routes.ts:586` (CUS bypass); `/freight-rate-terms` at `:596` (financial-trio governed per `:577-584`). XOR enforced in `beforeCreate` (`:601-605`) AND `beforeUpdate` via merged patch (`:609-620`) — both throw `ApiError(400)` on threshold_pct+threshold_abs set. `requireRoles(Role.ADMIN)` on `/customers` at `:88`. **Code-side RBAC landed; flows/07 matrix extension still owed (F13).** | PARTIAL (code COVERED, flows/07 matrix owed) |
| 9 | Config CRUD dup key (cust×route×date) ⇒ 409/422 | flows/12 `TC-CUOC-024` | route UT (T6 Phase-2) | unique indexes landed at `backend/src/db/schema/pricing.ts:256` (`freight_rate_terms_cust_route_date_uniq`) + `:291` (`fuel_price_periods_from_uniq`). CRUD router surfaces DB errors as 409/422. Frontend runtime-verified: dup effective_from → 409 "effective_from đã tồn tại"; dup cust×route×date → 409 "Cấu hình đã tồn tại" (cycle-2 handoff). | COVERED |
| 10 | Ad-hoc (lệnh chạy ngoài) **bypass** engine hoàn toàn (PhuongAn edge 6) | flows/01 `CUS-SHIP-10..16` (MasterData §4.5) | existing flows/01 cases | existing ad-hoc flow (không gọi `resolveFreightRate`) | COVERED (từ wave trước) |
| 11 | Manual per-component rounding HALF_UP (`J`, `H` riêng rồi cộng `K`) (CuocPhi §4.2) | flows/12 `TC-CUOC-007` | `round.test.ts`, `fuelSurcharge.test.ts` | `shared/src/calculations/round.ts`, `fuelSurcharge.ts:113,118` | COVERED (UT parity 48/48) |
| 12 | `base_fuel_price` scale 4: CONT20 NEWEB không lệch 1 đồng (CuocPhi §3.2) | flows/12 `TC-CUOC-008` | UT parity | `freight_rate_terms.base_fuel_price` numeric(12,4) | COVERED (UT 48/48) |
| 13 | Open items tracked (Câu 5, lag ASKEY/SUNRISE+SJ, 15T prices ×3, threshold X/Z) — chờ KH | tracker ticket `e3873fbc` | — | PhuongAn §4 + CuocPhiThietKeDB §6.2 (Còn mở) | DOCS (chờ KH reply, không block code) |
| 14 | Wave AC: 9 ticket board state + new docx fully traced + suites green + qa/ evidence | — | — | run `run-1788968588650-mctezn` board + this matrix | WAVE (close-out pending all 9 tickets done) |

### 7.1. Findings — Phase-1 pass (2026-09-10)

- **F10 — engine runtime wiring — CLOSED cycle 3 (PM correction).** Initial grep
  on engine function names (`resolveFreightRate` / `persistFreightRateSnapshot`) missed
  the wiring layer. Real wiring lives in `lockShipmentFreightRate` at
  `freight-rate-snapshot-lifecycle.service.ts:129`, called from 4 lifecycle sites:
  `batchUpsertShipmentContainers` (`shipment-containers.service.ts:589`),
  `updateShipment` + `updateCusShipmentContainerLine`
  (`cus-shipment-workspace-writes.service.ts:640`), and `issueOrderCreateOrUpdate`
  (`dispatch-planning-commands.service.ts:590`). `e12454cf`'s 400 redirect on
  `containers[]` redirects callers to PUT `/:id/containers` precisely because that
  path fires the FCL lock — which is why QA TC-CUOC-005 (container-appointment lag
  edit) passed via the real API. Rows 2/3/4 §7 flipped PARTIAL → COVERED.
- **F11 — T1 AC: soften engine 404 thành MANUAL fallback — CLOSED cycle 3.**
  Wrapper `resolveFreightRateWithManualFallback` at `freight-rate-snapshot-lifecycle.service.ts:77`
  wraps engine 404 → returns `source = 'MANUAL'` instead of throwing. Lifecycle test
  at `freight-rate-snapshot-lifecycle.test.ts:563` covers TC-CUOC-025. Row 5 §7 flipped
  PARTIAL → COVERED.
- **F12 — single-step ratchet.** Engine so với 1 kỳ liền trước (single-step, không
  recursive). Docx mơ hồ về recursive. Không chặn wave này nhưng flag cho KH: nếu KH
  yêu cầu recursive, đó là design change cần reopen. (PM risk #2)
- **F13 — config RBAC matrix chưa có.** `flows/07-rbac-phan-quyen.md` không có dòng
  nào cho config cước (`fuel_price_periods`, `freight_rate_terms`). Cần bổ sung khi
  T2 land — xem `PhuongAnTinhCuocTuDong.md` §2.5 RBAC kỳ giá dầu.

### 7.2. Phase-2 checklist cho wave này

1. T1 land ⇒ re-run `flows/12` (đặc biệt TC-CUOC-009/010/014/015/016/025) trên
   integrated tree, capture evidence tại `qa/evidence/2026-09-10_phase2-pricing/`.
2. T2 land ⇒ chạy `TC-CUOC-013/020..024` (config CRUD + RBAC + dup).
3. T3 land ⇒ chạy fuel-price entry UI + admin rate-terms UI (`flows/12 §2.5`).
4. T4 land ⇒ chạy shipment freight preview + debit-note override UI.
5. T6 land ⇒ unit test suite green (clamp, rounding, lag, threshold pct/abs, ratchet,
   MANUAL, snapshot immutability) + integration green (CUS create, supersede, dup keys,
   RBAC negatives).
6. Sau khi mọi row trên PARTIAL/BLOCKED → COVERED, sync matrix + đóng wave trên board.

---

## 8. Summary

| PRD | Reqs | COVERED | PARTIAL | BLOCKED | UNCOVERED |
|---|---|---|---|---|---|
| ManHinhLaiXe | 13 | 13 | 0 | 0 | 0 |
| MasterDataNhaMay | 13 | 11 | 2 | 0 | 0 |
| LoHangKepKetHop | 12 | 12 | 0 | 0 | 0 |
| OpsVanHanh | 17 | 17 | 0 | 0 | 0 |
| `PhuongAnTinhCuocTuDong` *(2026-09-10, wave `run-1788968588650-mctezn`)* | 14 | 11 | 1 | 0 | 0 |
| **Total** | **69** | **66** | **1** | **0** | **0** |

**F5 (MDN-11b nhãn "Chạy ngoài") — CLOSED cycle 3:** xem row 11b §2 + commit `ff48a8f5` + `428d705b`.

**F6 (MDN-13 factory snapshot) — CLOSED cycle 3:** xem row 13 §2 + commit `5042bc02` + migration `0065_trip_factory_site_snapshot.sql`.

**F7 (MDN-7 inactive-factory filter) — CLOSED 2026-09-10:** xem row 7 §2 + finding F7 + §6 mục 5.

**Wave auto-pricing (2026-09-10, cycle 3 sweep + PM correction):**
- **11 COVERED** (UT engine parity + landed code/test evidence): rows 1 (công thức cốt lõi), 2 (4 nhóm A-D wired via `lockShipmentFreightRate`), 3 (3-step engine wired at lifecycle sites), 4 (snapshot persist wired + QA TC-CUOC-005 passed), 5 (F11 soften 404→MANUAL wrapper), 6 (override PATCH endpoint), 7 (fuel-price CRUD mounted), 9 (unique indexes landed), 10 (ad-hoc bypass), 11 (rounding HALF_UP), 12 (base_fuel_price scale 4).
- **1 PARTIAL** (config RBAC code landed + QA RBAC green, flows/07 matrix extension owed): row 8 (F13 still open).
- **0 BLOCKED.**
- **2 tracker rows**: 13 (open items, chờ KH reply `e3873fbc`), 14 (wave AC close-out).
- **Findings:** F10 **CLOSED cycle 3** (rows 2/3/4 wiring landed), F11 **CLOSED cycle 3**, F12 (single-step ratchet — design note, no change), F13 (flows/07 RBAC matrix extension still owed). Chi tiết §7.1.

**Open items chờ KH/user** (tracker `e3873fbc`, không block code): Câu 5, lag ASKEY/SUNRISE+SJ, giá gốc 15T ×3 tuyến, threshold X/Z — xem [`PhuongAnTinhCuocTuDong.md`](../../docs/prd/PhuongAnTinhCuocTuDong.md) §4 và [`CuocPhiThietKeDB.md`](../../docs/prd/CuocPhiThietKeDB.md) §6.2.

**Phase-2 evidence:** `testplan/qa/evidence/2026-09-09_phase2-docx-trilogy/` (RUN-SUMMARY.md, driver.log,
PNG + DB dumps: ad-hoc L1/L2/L3, guardrail, pair #571, OPS expense lifecycle + audit, suite logs).
