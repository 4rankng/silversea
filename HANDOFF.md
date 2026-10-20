# HANDOFF — 2026-10-20 — regressions 1020b: FB-063 header wrap + FB-066 quick-add verify + party summary short-name

Controller: omp agent, worktree `/Users/dev/.paseo/worktrees/1njkloyy/fix-regressions-1020b`,
branch `fix-regressions-1020b` (off `main` = `00bc24ed`). Updated 2026-10-20.

**Status**: DONE — committed + pushed to origin.

- **FB-063 (201026101500)** FIXED: `.csc-container-table thead th` carried
  `white-space: normal` (b6e49f27) with 104/96px cột hẹp hơn nhãn đo được
  (122/141px) → "Loại container"/"Trọng lượng (kg)" wrap 2 dòng mọi width.
  Fix: nowrap law + type 124px + weight 144px + min-width 1038→1108px; styles
  test pin law 1 dòng. Rung-3 before/after 3 widths (qa/2026-10-20-regressions/).
- **FB-066 (201026101600)** NOT REPRODUCED at HEAD: 8bfa2ac7 (staging build QA
  khai) là ancestor của HEAD; 3/3 surfaces (Gán xe nhóm = R23 surface,
  dispatch-detail editor, /trips/new as admin) rung-3 PASS với nút hiện + dialog
  mở. Nút theo thiết kế chỉ hiện khi nhà xe đã chọn. Không fabricate fix
  (precedent 63a3dfc4). Evidence: qa/2026-10-20-regressions-fb066-master/ + logs.
- **Party summary (201026095604b)** FIXED theo đúng join-analysis: BE
  `getPhoiPhieuReport` row +partyShortName/partyId/partyKind (grouping + số
  tiền giữ nguyên byte); FE ID-first join (aging customerId / payables
  supplier.id scoped theo kind) + name fallback + canonical entity merge;
  display shortName ?? name, tooltip tên đầy đủ. Unit 14/14 (5 case mới);
  rung-3 before/after bằng fixture SQL isolate 2026-08-20 (đã dọn sạch).

**Gates**: BE tsc 0 · FE tsgo -b 0 · lint 0 · BE 326/326 · FE scoped 221/221 ·
FE full 5265/5265 (dist-pin tests cần `make build` — đã build, 6/6) · build OK.
`qa/2026-10-20-regressions/gates.log`.

**Stack note**: dev stack chạy bằng paseo terminals `ss-backend` (tsx watch
:3002) + `ss-frontend` (vite :7175) từ worktree này; DB/Redis dùng containers
ss-prod-db :5441 / ss-prod-redis :6391 đã có từ trước. backend/.env copy từ
main checkout. Dừng khi cần bằng kill terminal tương ứng — KHÔNG đụng container.

**Files owned by task**: backend/src/services/phoi-phieu-control.service.ts,
frontend/src/api/phoiPhieuClient.ts,
frontend/src/features/accounting/PartyMonthlyProductionSummary.{tsx,test.tsx},
frontend/src/pages/clerk/ClerkShipmentCreatePage.{css,styles.test.ts},
PhoiPhieuControlPage.* fixtures, testplan/2026-10-20-regressions-*.md +
qa/scripts 2026-10-20-regressions-*.mjs, qa/2026-10-20-regressions*/ (force-
tracked).

**Not covered**: staging re-drive (cards QA báo trên staging build 8bfa2ac7 —
cần re-verify trên staging mới nhất khi deploy); aging/payables bảng chính vẫn
hiển thị tên đầy đủ (ngoài scope card — party summary giờ join theo ID nên
không phụ thuộc display name nữa); mobile 390 sweep cho party summary.
