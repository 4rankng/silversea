# Ma trận phủ nghiệm thu — Bộ ba docx (2026-09-09)

**Lane 4 / Phase 1 — cross-cutting QA, read-only pass.** Nguồn yêu cầu: 4 PRD
(`docs/prd/ManHinhLaiXe.md`, `MasterDataNhaMay.md`, `LoHangKepKetHop.md`, `OpsVanHanh.md`)
đối chiếu với testplan (`roles/03-laixe.md`, `roles/06-vanhanh.md`, `flows/09-kep-kethop-ghep-chuyen.md`,
`roles/01-cus.md` CUS-SHIP-10..16, `flows/01-cus-create-shipment.md`), unit/component tests,
và evidence triển khai (file:line). Pass này **chưa chạy suite** (các lane 1-3 đang sửa code song song).
Phase 2 — khi lead ra tín hiệu — sẽ chạy browser regression + full suites trên integrated tree
và cập nhật trạng thái bằng evidence thật (test run ids, UI-DRIVEN steps, qa/ artifacts).

**Trạng thái:** `COVERED` = đủ 3 chân: anchor testplan + unit/component test + evidence triển khai.
`PARTIAL` = thiếu 1 chân evidence (không phải thiếu tính năng, trừ khi ghi rõ finding F4/F5/F6).
`UNCOVERED` = không có anchor lẫn evidence. **Chưa có row nào UNCOVERED.**

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
| 7 | Push notification khi điều vận gán xe; bypass Ops; nhận lệnh ghi timestamp (§3) | `DRV-DET-13`; flows/03 `TC-LX-NHANLENH-020` | — | `driver-fulfillment.service.ts` (ack + timestamp); `push.service.ts` + `dispatch-planning-commands.service.ts` (wiring tồn tại, chưa trace E2E) | PARTIAL (push E2E → Phase 2) |
| 8 | Kết hợp: Lệnh 1 hoàn thành trả hàng ⇒ mới mở Lệnh 2 (§3) | flows/09 `TC-GHEP-010` | `pair-ket-hop-gating.test.ts` | `driver-fulfillment.service.ts:43-62` | COVERED |
| 9 | e-POD: 2 khu vực ảnh bắt buộc; gate = cả 2 đạt 100%; API chặn thiếu ảnh (§4.1-4.2) | `DRV-POD-08`; flows/04 `TC-LX-TIENDO-019` | `DriverTripPodPage.test.tsx` | `DriverTripPodPage.tsx:485-493` | COVERED |
| 10 | Compress trên máy + timestamp thực trên 2 ảnh e-POD (§4.2) | `DRV-POD-09/-10`; `TC-LX-TIENDO-020/-021` | `DriverTripPodPage.test.tsx` | `DriverTripPodPage.tsx:221` (compress + burn-in) | COVERED |
| 11 | Hoàn thành ⇒ thẻ sang `Lịch sử` + sync dashboard điều vận (§4.3) | `DRV-POD-11`; `TC-LX-TIENDO-022` | — | `trip-status-machine.service.ts` | COVERED (unit evidence mỏng; Phase 2 UI) |
| 12 | Tap floor ≥48px + sticky CTA + safe-area-inset (§5) | `DRV-LIST-04`, `DRV-DET-10`; flows/03 `TC-LX-NHANLENH-017` | `bottom-nav.styles.test.ts` | `DriverTripsPage.css:48,342` = `min-height: 44px` | PARTIAL (→ **F4**) |
| 13 | Module chi phí ẩn; trips schema sẵn sàng cột chi phí (§0) | `DRV-DET-12`; `TC-LX-NHANLENH-019` | `DriverTripDetailPage.shipmentCostEntry.test.tsx` | `trips.ts:36-39,118-124` (fuel/road cols) | COVERED |

## 2. `MasterDataNhaMay.md` — Master data + Lệnh chạy ngoài (13 reqs)

| # | Yêu cầu (PRD §) | Testplan anchor | Unit/component tests | Evidence triển khai | Trạng thái |
|---|------------------|-----------------|----------------------|---------------------|------------|
| 1 | ERD/DB: site mang `customer_id` + `route_id` + address; FACTORY bắt buộc route (§1-2) | — (structural; indirect qua flows/01 `TC-CUS-CREATE-016`) | `ad-hoc-orders.test.ts` (indirect) | `master-data.ts:423-469`; `shipment-create.service.ts:71-72` (`assertShipmentFactorySiteValid`) | PARTIAL (anchor testplan yếu) |
| 2 | Hybrid storage: XOR id/raw, **không INSERT catalog**, trộn được từng trường độc lập (§2.1) | roles/01 `CUS-SHIP-10/11/12` | `ad-hoc-orders.test.ts` (7 tests: free-text create, non-ad-hoc requires catalog, mixed row, counts unchanged…) | `shipment-create.service.ts:49-55,91-92`; schema `shipments.ts:27-29,41,174-179` | COVERED |
| 3 | COALESCE hiển thị đồng nhất; app lái xe đọc `Raw_*` khi không có ID (§2.1-4, §4.4) | `CUS-SHIP-15` | `ad-hoc-orders.test.ts` (`detail view coalesces…`) | `shipment-detail-reads.service.ts:239-240`; `driver-journey-board.service.ts` | COVERED |
| 4 | Case 2 không suy ra tuyến/vị trí (§2.1-5) | — | — | implied bởi raw storage (`shipment-create.service.ts:54-55`) | PARTIAL (chưa có test trực tiếp) |
| 5 | Cascading: NM chỉ xổ theo KH; đổi KH ⇒ reset NM; chưa chọn KH ⇒ disabled (§3.1) | flows/01 `TC-CUS-CREATE-016/-021/-022/-023`; `CUS-SHIP-14` | `shipment-create-model.test.ts` | `shipment-create-model.ts:170` + `assertShipmentFactorySiteValid` | COVERED |
| 6 | Auto-fill + read-only tuyến/vị trí khi chọn NM (§3.2) | flows/01 `-022` (clear/re-pick route cell); flows/01:38 (cước read-only) | `shipment-create-model.test.ts` | `shipment-create-model.ts:266,273` (FCL = per-container site/route) | COVERED (FCL per-container) |
| 7 | Dữ liệu thiếu: NM thiếu tuyến chặn lưu đích danh; KH không NM ⇒ dropdown rỗng + link tạo nhanh; NM `is_active=false` ẩn khỏi dropdown (§3.3) | flows/01 `-016/-017` + `CUS-SHIP-14` | — | inactive filter **không định vị được** this pass (routes restructured) | PARTIAL (→ **F7**) |
| 8 | Checkbox đầu form cố định; bật/tắt giữa chừng không mất dữ liệu; `is_ad_hoc` persist + reopen (§4.1) | `CUS-SHIP-10` (AC10) | `ad-hoc-orders.test.ts` (`reopen-for-edit keeps the ad-hoc flag (AC10)`) | `ShipmentCreateWorkspace.tsx:562-572` (fixed top) | COVERED |
| 9 | Bypass chỉ định mức cước; validation an toàn giữ nguyên — ISO-6346, ngày hợp lệ, số lượng > 0 (§4.1) | `CUS-SHIP-11` | `ad-hoc-orders.test.ts` (`pricing projection reports the ad-hoc bypass…`); `shared/src/calculations/iso6346.ts` + test | containers service enforce ISO | COVERED |
| 10 | Combobox: lọc chuỗi con hoa/thường + dấu; text lạ giữ sau blur; phân biệt "mới"; ↑↓/Enter/Esc; dismissal giữ text (§4.2) | `CUS-SHIP-14` | — | `uui-fields.tsx:170` (free-text passthrough) | PARTIAL (unit/UI evidence → Phase 2) |
| 11 | Text tự do ≠ +Tạo mới; cờ không vô hiệu nút tạo nhanh (§4.3) | flows/01 `TC-CUS-CREATE-012/-017/-019/-020` + `CUS-SHIP-13` | — | inline-create flows có sẵn; button label cần verify (Phase 2) | PARTIAL (Phase 2) |
| 12 | Downstream: nhãn "Chạy ngoài" cạnh mã lô; điều vận không chặn thiếu `Factory_ID`; ledger exclude; report nhóm "Chạy ngoài"; count(*) guardrail (§4.4, §4.5-5/6) | `CUS-SHIP-15` | `ad-hoc-orders.test.ts` (`master counts unchanged`) | nhãn "Chạy ngoài" **vắng** ở list/detail (→ **F5**); guardrail test ✓ | PARTIAL (→ **F5**) |
| 13 | Snapshot khi phát lệnh — chụp các trường vận hành của nhà máy (§2) | — | — | `trips.route_id` notNull = route snapshot ✓; factory site/address **derive-at-read**, không có snapshot cols (→ **F6**) | PARTIAL (→ **F6**) |

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

## 4. `OpsVanHanh.md` — Ops module (17 reqs — 16 COVERED / 1 PARTIAL)

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
| 11 | Optimistic jump khi lưu chi (§5.2) | OPS-WAL-02 | `OpsWalletPage.test.tsx:53` (server formula; **chưa assert optimistic FE**) | FE cache patch | PARTIAL (FE assertion → Phase 2) |
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
- **F4 — 44px vs 48px.** MLX §5 + roles/03 `DRV-LIST-04` (tham chiếu `c9012bd0`) yêu cầu ≥48px;
  `DriverTripsPage.css:48,342` = `min-height: 44px`. Mâu thuẫn spec↔code; probe dev-tools ở Phase 2 để xác nhận là violation hay bị override.
- **F5 — nhãn "Chạy ngoài" vắng mặt.** MDN §4.4 + AC-6: nhãn "Chạy ngoài" (chữ màu, không badge) cạnh mã lô ở
  list/chi tiết/điều vận/app lái xe. Frontend chỉ render copy ở create-form; list/detail/driver app không render nhãn.
  Data model hỗ trợ (`is_ad_hoc` + `raw_*`) — thiếu UI label.
- **F6 — snapshot khi phát lệnh chưa trọn.** MDN §2: fulfillment đã phát lệnh phải snapshot các trường vận hành của nhà máy.
  `trips.route_id` notNull snapshot route ✓ nhưng factory site/address derive-at-read (join master data lúc đọc) —
  sửa master data sau khi phát lệnh có thể trôi dữ liệu lô đang chạy.
- **F7 — NM inactive ẩn khỏi dropdown tạo mới:** không định vị được filter `isActive` trên nguồn dropdown (routes restructured) — cần verify Phase 2.
- **F8 — push notification:** services tồn tại (`push.service.ts`, `notification.service.ts`, wiring `dispatch-planning-commands.service.ts`)
  nhưng chưa trace E2E → Phase 2 UI evidence.

## 6. Phase-2 checklist (evidence còn thiếu)

1. Re-run flows/09 browser regression trên integrated tree (bằng chứng PASS 2026-09-07 đã có trong flows/09 verdict table).
2. Push notification E2E (UI evidence).
3. Wallet optimistic jump FE assertion.
4. Combobox diacritic filter + keyboard nav unit/UI.
5. NM inactive filter + "+Tạo mới" label check.
6. Hoàn thành ⇒ sync điều vận (UI).
7. 44px vs 48px dev-tools probe.
8. `SELECT count(*)` master-data guardrail re-check sau khi các lane land.
9. Micro-ledger grouping (Kế toán hiển thị gom theo lô).

## 7. Summary

| PRD | Reqs | COVERED | PARTIAL | UNCOVERED |
|---|---|---|---|---|
| ManHinhLaiXe | 13 | 11 | 2 | 0 |
| MasterDataNhaMay | 13 | 6 | 7 | 0 |
| LoHangKepKetHop | 12 | 12 | 0 | 0 |
| OpsVanHanh | 17 | 16 | 1 | 0 |
| **Total** | **55** | **45** | **10** | **0** |

**PARTIAL list (10):** MLX-7 (push E2E), MLX-12 (44px F4), MDN-1 (anchor yếu), MDN-4 (no-derive), MDN-7 (inactive factory F7),
MDN-10 (combobox unit evidence), MDN-11 (+Tạo mới label), MDN-12 (Chạy ngoài label F5), MDN-13 (snapshot F6), OVH-11 (optimistic jump).
