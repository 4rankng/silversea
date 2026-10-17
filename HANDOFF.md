# HANDOFF — 2026-10-17 consolidated (3 lanes)

## Lane 1: filter-lane (Khách hàng dropdown vào filter lane) — DONE, merged

# fix-shipments-debit-customer-in-filter-lane — Khách hàng dropdown vào filter lane — DONE (chưa merge)

Controller: this session (Paseo agent), worktree
`fix-shipments-debit-customer-in-filter-lane` (branch-off main @ 9fd0553c).
Updated: 2026-10-17 (tối).

## Mục tiêu + trạng thái

Owner yêu cầu 2026-10-17: dropdown "Tất cả khách hàng" trên `/shipments-debit`
chuyển TỪ bar riêng (`shipment-debit-customer-bar`, trên filter strip) VÀO
filter control lane — control ĐẦU TIÊN của `ShipmentDebitRibbon`'s FilterBar,
trước `DateRangeFields`. **REVERSES card _202** (ghi trong commit message).
DONE: layout/DOM move only, không đổi filter logic.

## Thay đổi (5 file code + 1 testplan, +96/−85)

- `ShipmentDebitRibbon.tsx`: props mới `customerValue` / `customerOptions` /
  `onCustomerChange`; `SearchableSelect` render là bar CHILD đầu tiên (bar
  children never fold → luôn hiện); doc comment nêu reversal.
- `ShipmentDebitPage.tsx`: xóa block customer-bar + hint "Đang xem…";
  `selectedCustomerLabel` + import chết xóa sạch; handler chuyển NGUYÊN VẸN
  (`setSelectedIds(new Set())` + `updateParam('customer', …)`).
- `ShipmentDebitPage.css`: family `.shipment-debit-customer-bar*` xóa hết;
  thay bằng `.shipment-debit-ribbon__customer { min-width:200px;
  max-width:320px }` (sizing-only — band owns layout); phone full-width
  override XÓA (band packing law: `ListFilterBar.css` `.list-filter-bar >
  *:not(.ds-tabs) { min-width: 0 }` @≤640 — floor chỉ hiệu lực ≥641px, đã
  đo confirmed).
- Tests: pins đảo chiều _202 (picker TRONG ribbon, control đầu, precedes
  range, DOM order ribbon→header); hint asserted gone; direct-mount test
  thêm 3 props bắt buộc.

## Quyết định đáng chú ý

- Hint "Đang xem…" BỎ (không vừa gọn trong control lane; trùng lặp giá trị
  trigger). Owner chỉ yêu cầu move dropdown — brief cho phép bỏ.
- `hasFilters`/`Xóa lọc` KHÔNG tính customer (hard rule: không đổi logic).
  → review note cho owner sau này: user lọc chỉ theo customer sẽ thấy
  `Xóa lọc` disabled dù lane đang giữ giá trị — cần owner ruling riêng nếu
  muốn đổi (logic-change task riêng).
- Provenance: house primitives (`FilterBar` + `SearchableSelect`), không
  consult catalog — không component/layout mới.

## Lane 2: hãng tàu server-side catalog (FB-114/122150+185348) — DONE, merged

# fix-171026122150+171026185348 — FB-114 verify-fail: hãng tàu lưu vào danh mục chung (server) — DONE (unmerged, chờ owner)

Controller: this session (Paseo agent), worktree `fix-fb114-hangtau-catalog-1`
renamed branch `fix-171026122150-185348-hang-tau-luu-danh-muc-chung`,
branch-off from main @ e36c4a06. Không merge trunk (chỉ thị ticket).
Updated: 2026-10-17 (tối).

## Goal + status

Verify-fail 171026185348 của FB-114: fix trước (e11cd255/330169fc/…) chỉ đổi
label + lưu local form — hãng tàu mất khỏi dropdown sau reload với mọi user.
Yêu cầu thật: tạo record server-side (danh mục chung), dropdown sau refresh
phải liệt kê, giữ nguyên UX (Pencil, "Đặt tên hãng tàu cho lô này",
form.shippingLineName cho lô).

ĐÃ IMPLEMENT:
- BE `POST /api/shipments/shipping-lines` (core.routes.ts +
  shipment-intake.service.ts `createShippingLineForIntake`): trim/non-empty/
  ≤255 (zod), dedupe theo display name (`shortName || name` ci — đúng
  derivation config.service.ts), tạo supplier types ['SHIPPING_LINE'], bust
  `catalogs:bootstrap`. 201 create / 200 idempotent (default hoặc hãng tàu
  ACTIVE sẵn có, echo canonical casing) / 409 tên thuộc NCC khác loại hoặc
  INACTIVE / 400 validate. requireRoles(SHIPMENT_INTAKE_MUTATION_ROLES) +
  casbin('shipments') mount; audit ENTITY_CREATED; declareNonMaterialWrite.
- FE `applyShippingLine`: API TRƯỚC → rồi update form.shippingLineName +
  mergeShippingLine (catalogMerger.ts) + đóng dialog; fail → dialog giữ mở +
  lỗi server (role=alert). Hint field sửa: "… lưu cùng lô hàng và được thêm
  vào danh mục chung." Modal/ShipmentCreateModals onApply async + pending
  disable.

## Decisions / sources

- RBAC: đặt endpoint dưới mount `shipments` (casbin shipments:write) +
  requireRoles SHIPMENT_INTAKE_MUTATION_ROLES — đúng precedent
  `/operational-sites` (master-data tạo từ intake form). CUS/DISPATCHER
  (2 role xài /shipments/new) đều qua; ACCOUNTANT/OPS/DRIVER 403. KHÔNG nới
  POST /api/suppliers (config write) cho CUS.
- Migration unique index: KHÔNG tạo (dedupe app-level đủ cho human form;
  index display-name cần clean data trước). Ghi chú trong CHANGELOG nếu owner
  muốn siết race window.
- Không đụng `syncSupplier*Hook`: insert đã set types/primaryType/
  isFuelSupplier canonical (normalizeSupplierTypeSelection); partnerId null
  (không taxCode) — parity với POST /suppliers cho row không taxCode.

## Files owned

backend/src/services/shipment-intake.service.ts, backend/src/routes/shipments/
core.routes.ts, backend/src/routes/shipments/index.ts,
backend/src/tests/shipping-line-intake-catalog.test.ts (new),
frontend/src/api/shipmentClient.ts, frontend/src/features/shipments/create/
{ShipmentCreateWorkspace.tsx,ShippingLineAddDialog.tsx,ShipmentCreateIdentitySection.tsx,
ShipmentCreateModals.tsx,catalogMerger.ts,ShipmentCreateWorkspace.shipping-line-persist.test.tsx (new),
ShipmentCreateAppendAction.test.tsx,ShipmentCreateWorkspace.deposit.test.tsx},
frontend/src/pages/clerk/ClerkShipmentCreatePage.test.tsx,
testplan/2026-10-17-card-fb114-hang-tau-plus.md (case
2026-10-17-card-fb114-shipping-line-server-persist), CHANGELOG.md,
qa/2026-10-17_fb114-persist_*, qa/drivers/2026-10-17-fb114-persist-ui-drive.mjs.

## QA artifacts + results

- 5 file frontend trên + `testplan/2026-10-17-owner-customer-in-filter-lane.md`
- `qa/2026-10-17_customer-in-filter-lane_*` (ignored) + 2 driver
  `qa/drivers/2026-10-17-customer-in-filter-lane-*.mjs`

## QA artifacts + gates

- fe `tsc -b` exit 0; `vitest run src/pages/ShipmentDebitPage*` 48/48 (2
  lần chạy + final sau comment fix — đều exit 0).
- Full fe suite: 5056 pass; 3 fail = 2 numeric-identity (cần dist — pass sau
  `make build`, rerun 54/54 exit 0) + `dev-port-contract` PRE-EXISTING trên
  HEAD (card khác, documented trong handoff trước).
- Root lint exit 0 (5 warning pre-existing ở `backend/src/tests/
  scratch-census-probe.ts`, ngoài diff). `make build` exit 0.
- Rung 3 UI drive (CUS, vite :7275 từ worktree — :7175 thuộc worktree task
  khác, không đụng; đã tắt sau QA): 1440 — picker 200×30 cùng dòng y=154 với
  range 340×30 trong strip, FIRST control, legacy bar gone; CLICK chọn
  "card11 cust…" → URL `?customer=6442`, API `debit-summary?customerId=6442`,
  trigger hiển thị tên; 390 — picker trong strip, precedes range, doc
  overflow 0. DB before/after: shipments 4606 / customers 4774 (read-only).
- Independent review (code-reviewer): DONE, không blocking; 1 comment stale
  đã sửa.

## Unrelated / preserved

- Vite :7175 + backend :3002 của main/checkout khác giữ nguyên.
- Pre-existing fails như trên không thuộc ticket này.

## Next step

- Commit trên branch này (message có "reverses card _202 per owner
  2026-10-17"), KHÔNG merge — report hash cho owner.

## Lane 2 QA artifacts + results

- `qa/2026-10-17_fb114-persist_backend-tsc.log` exit 0;
  `_frontend-tsc.log` exit 0; `_root-lint.log` exit 0 (5 warnings pre-existing
  trong backend/src/tests/scratch-census-probe.ts — file khác, không diff);
  `_build.log` (`make build`) exit 0.
- `qa/2026-10-17_fb114-persist_backend-tests.log` — full `pnpm test` attempt:
  interrupted bởi runner ở ~49' (0 fail trước interrupt, file đang chạy dở
  debit-note-trip-claim-governance.test.ts) — KHÔNG phải fail; chạy lại set
  ảnh hưởng bên dưới làm bằng chứng chính.
- `qa/2026-10-17_fb114-persist_backend-affected-tests.log` — 12 file ảnh
  hưởng (authz-grant-registry, master-data-import, master-data-short-names,
  material-write-registry-exhaustive, operational-site-admin-crud,
  shipment-audit, shipment-intake-adhoc-warehouse, shipment-intake-submit,
  shipment-routes, shipping-line-intake-catalog, supplier-carrier-link,
  unit/shipment-intake-lcl-cargo): 239 pass, 1 fail RED-AT-BASE đã chứng minh
  bằng git stash (material-write-registry-exhaustive: route
  `lcl/unmerge-group` của commit 8e0b22c8 thiếu durable-boundary — không thuộc
  diff).
- `qa/2026-10-17_fb114-persist_frontend-tests.log` — full suite 5065/5066
  pass; 1 fail red-at-base KHÔNG thuộc diff: dev-port-contract.test.ts —
  script `testplan/qa/scripts/qa-20261017-qa1-007-chip-rung.mjs` của card
  QA1-007, commit f9b36180 upstream, hardcode 7176/3003 (contract đòi
  7175/3002). Không đụng (unrelated card). numeric-identity.styles.test.ts
  pass sau khi có dist/assets (`pnpm build`/`make build`).
- New tests: BE 7/7 green qua mount thật (create→201+bootstrap liệt kê+row typed
  SHIPPING_LINE; dup/case/default→200; empty/>255→400; va chạm NCC khác
  loại→409; role matrix 403/401); FE persist test 3/3 xanh (persist trước
  close + dropdown mirror, canonical echo created:false, fail → dialog mở +
  lỗi).
- UI rung 3 (server phụ :3092/:7176 của worktree này — stack chính
  :3002/:7175 của main checkout giữ nguyên):
  `qa/2026-10-17_fb114-persist_ui-driver.log` 5/5 exit 0 (dialog → field →
  RELOAD → dropdown liệt kê tên → bootstrap shippingLines carry → suppliers
  row), screenshots `_ui-01..03.png`, DB rows `_db-row.log` (5 row QA drive/
  probe, đã soft-delete cleanup cuối log). Driver:
  `qa/drivers/2026-10-17-fb114-persist-ui-drive.mjs`.

## Unrelated / preserved

- Container ss-prod-db :5441 / ss-prod-redis :6391 dùng chung — không reset.
- main checkout không đụng. Dev stack chỉ bật khi UI drive (make dev).

## Next step / còn lại

- DONE: implement + review (code-reviewer, 0 blocker; S1–S5/N1–N5 đã sửa hoặc
  ghi lý do từ chối — dialog body giữ nguyên theo hard rule của ticket) +
  gates + UI rung 3 + commit trên nhánh `fix-171026122150-185348-hang-tau-luu-danh-muc-chung`
  (KHÔNG merge main theo chỉ thị).
- Owner còn lại: deploy staging khi sẵn sàng; quyết định có siết unique index
  display-name (migration) cho race window triệt để; 2 red-at-base unrelated
  (material-write-registry-exhaustive @ lcl/unmerge-group 8e0b22c8;
  dev-port-contract @ qa1-007 script f9b36180) cần chủ card xử lý.
## Lane 3: FB-020 bãi hạ trống + map nhầm Địa chỉ giao hàng (portless import regression) — DONE, full BE gate pending

# fix-171026205400 — FB-020 Bãi hạ trống + map nhầm Địa chỉ giao hàng (REGRESSION, rb1→rb2) — DONE (pending full BE suite)

Controller: this session (Paseo agent), worktree
`fix-171026205400-bai-ha-regression-rb2` (cherry-pick 20ac6dca từ rb1, base
9fd0553c → rb2 HEAD).
Updated: 2026-10-18. Không merge — report hash.

## Root cause (đã chứng minh bằng data staging + git)

Trip E2EROLE001/staging trip 135 (IMPORT FCL, container 256): KHÔNG có bất kỳ
nguồn cảng hạ nào — dropoff_port_id/raw name null, shipments.delivery_location
null, trips.canonical_destination null. Chuỗi `resolveDeliveryStage`
(ruling 2026-09-18 port-first) chỉ đọc port → free-text rồi trả null →
"Cảng hạ: Chưa có cảng hạ" cạnh "Địa chỉ giao hàng: <nhà máy>". Điểm hạ thật
của tác vụ nằm trong siteSnapshot.deliverySite ("LM Võ Cường" — ghi tại
decompose từ operational site của container) mà chuỗi không bao giờ đọc.

Căn cứ sửa: PRD ManHinhLaiXe §2.3 (restated 1a1a227e) "khi hai điểm là cùng
một nơi thì hai hàng cùng tên" + directive 2026-10-17 (liftDropPoints.ts,
IMPORT: Hạ = Nhà máy) + ticket FB-020. KHÔNG mâu thuẫn ruling 2026-09-18:
snapshot chỉ ĐÓNG chuỗi khi không có port/free-text, không thay thế; EXPORT
không đổi (1f1133ae).

## Thay đổi (4 file code + 1 case + 1 rung script)

- `backend/src/services/delivery-stage.ts` — IMPORT/unknown: chuỗi stage-1
  thêm bước 3 `|| snapshotSiteName` (tên điểm trả của fulfillment snapshot).
  Callers không đổi (đã truyền snapshot name). EXPORT branch nguyên vẹn.
- `backend/src/tests/unit/delivery-stage.test.ts` — repin 2 assertion cũ
  (portless+snapshot → giờ là tên site), thêm test FB-020 (trim/blank).
- `backend/src/tests/driver-journey-board-fields.test.ts` — 2 test mới:
  FB-020 portless IMPORT (card+detail = 'LM Võ Cường'), EXPORT portless
  giữ null; comment describe sửa đúng thứ tự chuỗi.
- `frontend/src/pages/driver/DriverTaskInfoSections.test.tsx` — test render
  FB-020: 2 hàng ĐÚNG RIÊNG, không cross-fallback. FE code KHÔNG đổi
  (dropPortName giờ mang giá trị từ wire).
- `testplan/2026-10-17-fb020-cang-ha-portless-import.md` — case TC-FB020-001/2/3.
- `testplan/qa/scripts/2026-10-17-fb020-cang-ha-rung.mjs` — UI rung script.

## QA (qa/2026-10-17_fb020_*)

- UI DRIVEN (rung 3, phone 390px, dvthuc, frontend :7276 → backend :3093 từ
  worktree này, CWD process đã verify): trip 67894 (fixture tạo qua API thật:
  shipment 123269 /
  container 54995 / fulfillment 53877 portless) — "Cảng hạ: LM Võ Cường" +
  "Địa chỉ giao hàng: Nhà máy Long Minh - Võ Cường, Khu 2, …"; control trip
  44277 (có port 8578): "Bãi JJ LOGISTICS FB082" ≠ "CÔNG TY NEWEB… FB082" —
  ĐÚNG RIÊNG. Ảnh: ui-1-cang-ha.png, ui-2-full.png, ui-3-control-port.png;
  log ui-driver.log; DB fixture db-fixture.txt. Wire proof: trước fix
  deliveryLocation null (backend nhầm worktree khác), sau fix
  'LM Võ Cường' cả detail + journey card.
- Gates: lint 0 lỗi (5 warning pre-existing từ scratch-census-probe.ts của
  ai đó, gitignored, không phải file này); be-tsc 0; fe-tsc 0; make build 0;
  BE node:test scoped: unit 5/5, journey-board 17/17, siblings 162/162; FE
  vitest scoped 146/146; FE vitest FULL 5059/5060 — fail duy nhất
  `dev-port-contract` là offender PRE-EXISTING `qa-20261017-qa1-007-chip-rung.mjs`
  (commit f9b36180, card khác, fail trên HEAD trước ticket này; đã fail y hệt
  ở task 171026182554). Full BE suite: xem qa/2026-10-17_fb020_gates.txt.

## Fixture dọn?

Trip 67894/shipment 123269 là dữ liệu QA trên LOCAL DB 5441 (không đụng
staging/prod). Giữ lại làm evidence; cần dọn thì hủy trip+shipment.

## Stack cục bộ + collision port

Rung chạy trên backend :3093 + frontend :7276 (của worktree này, background
shell, CWD đã verify). LƯU Ý: worktree đồng thời
`fix-171026215600-salary-mode-dialog` cũng chiếm :3092 làm alt-port — đừng
dùng 3092 nữa. Process :3002/:7175 của checkout chính không đụng. Rung script
đọc QA_FRONTEND/QA_API env (default 7175/3002 theo dev-port contract).
