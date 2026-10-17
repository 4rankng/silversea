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
