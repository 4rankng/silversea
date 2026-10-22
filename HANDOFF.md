# HANDOFF — fix-lcl-kho-chung (card 261022093245)

- Owner/controller: this session (OpenCode, worktree
  /Users/dev/.paseo/worktrees/1njkloyy/fix-lcl-kho-chung).
- Last updated: 2026-10-22 ~10:45.
- Goal: LCL "Kho lấy hàng (CFS/Cảng)" list từ danh mục chung, không lọc theo
  khách. STATUS: DONE — commit 57f692d5 pushed to origin/fix-lcl-kho-chung.
- Scope: BE `GET /operational-sites?scope=shared` + drop customer-scope guards
  on the warehouse point (fulfillment snapshot + intake dispatch validate;
  factory keeps customer-scope). FE create form reads shared catalog; payload
  labels resolve via union; hint reword; "+ Thêm kho" kept.
- Non-goals: FCL port pickers, cus-workspace, ports-catalog merge into the kho
  dropdown (id spaces differ — deliberately not mixed).
- Files owned: shipment-intake.service.ts, shipment-fulfillment.service.ts,
  core.routes.ts (operational-sites GET), shipmentClient.ts,
  ShipmentCreateWorkspace.tsx, ShipmentCreateLclRouteSection.tsx + tests.
- Preserved: user's trunk backend on :3002 untouched; worktree QA stack
  (3003/7177) stopped after evidence; docker network pool full — worktree
  `make dev` fails on network create, run backend/frontend directly instead.
- QA artifacts: qa/2026-10-22-lcl-kho-chung/ (before/after API, UI driver
  before/after + screenshots, gates.log). Regression case:
  testplan/cases/case-QA-2026-10-22-lcl-kho-chung.md (all R1–R6 verified;
  R1/R2 UI DRIVEN rung 3, shipment 312533 SHP-2610-19366 on shared kho 442).
- Gates: lint 0, BE tsc 0, BE tests pass (unit 4/4 new + integration 338/338),
  FE tsc -b 0, FE full suite green (numeric-identity needs dist — built),
  make build OK. All on final code state.
- Blockers/next: none. Possible follow-up: UI hiển thị owner-khách của từng
  kho trong dropdown (hiện chỉ tên kho) nếu owner muốn.
