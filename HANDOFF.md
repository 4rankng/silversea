# fix-141026230710 — Ops bị chặn khỏi luồng khai chi phí (P1) — DONE (pending final gates sign-off)

Controller: this session (Paseo agent), worktree branch
`fix-141026230710-ops-expense-access` (base `773c73b1` off origin/main).
Updated: 2026-10-17.

## Goal & status

Ticket 141026230710 (P1, chỉ thị 2026-10-17, spec T3 — mọi Ops khai chi phí
mọi lô, không chia theo cá nhân/xe): gỡ 2 chặn của luồng khai chi phí.

- Chặn 1 `/shipments`: **ĐÃ GỠ** — thêm `p, OPS, shipments, read`
  (backend/src/casbin/policy.csv) + `Role.OPS` vào `canReadShipmentRoutes`
  (frontend/src/lib/role-access.ts).
- Chặn 2 dialog "Lô này không thuộc xe bạn phụ trách.": **đã mở từ trước trong
  base** (batch open-scope "plan step 5"/20261005, qua `2a64156f`); grant
  per-person + endpoint `write-scope` không còn trong nguồn. Xác minh + pin
  bằng test mới; không code change.

## Scope & non-goals

- Sửa: policy rule + FE guard + comments (policy.csv, enforcer.ts,
  routes/shipments/index.ts, authz-grants.ts reason) + pins đổi theo quyết
  định mới (shipment-rbac, shipment-routes, role-access, App.shipment-operations-route).
- KHÔNG sửa: nav sidebar OPS (không thêm entry /shipments — ngoài chỉ thị),
  write/delete quyền shipments (vẫn đóng), FB-033 dialog-OPS-only + nhãn nút
  (giữ), tickets khác.

## Decisions & sources

- Chỉ thị người dùng 2026-10-17 (ticket) > FB-033 note trong recheck 16/10
  ("/shipments 403 là status quo") — note đó bị supersede cho riêng chặn 1.
- Quyết định mới ghi tại:
  `testplan/2026-10-17-card141026230710-ops-shipments-view-open.md`.
- Casbin rule cite: `p, OPS, shipments, read` (policy.csv, Wave 0 block).
- Trip predicate cite: `assertExpenseOwnerWriteScope`
  (backend/src/services/expense-owner-scope.service.ts) — chỉ scope DRIVER
  qua `trips.driverId ↔ drivers.userId`; OPS exempt.

## Files owned by this task

- backend/src/casbin/policy.csv, backend/src/casbin/enforcer.ts (comment)
- backend/src/routes/shipments/index.ts (comment),
  backend/src/middleware/authz-grants.ts (reason prose)
- frontend/src/lib/role-access.ts
- backend/src/tests/ops-expense-access.test.ts (NEW — 1 test qua cả 2 chặn)
- pins: backend/src/tests/unit/shipment-rbac.test.ts,
  backend/src/tests/shipment-routes.test.ts, frontend/src/lib/role-access.test.ts,
  frontend/src/App.shipment-operations-route.test.tsx
- testplan/2026-10-17-card141026230710-ops-shipments-view-open.md, CHANGELOG.md

## Unrelated / concurrent changes preserved

- Pre-existing failure NOT touched (out of scope — ticket khác):
  `QA-AUDIT-PHOI-11 ×3` in `backend/src/tests/expense-source-remediation.test.ts`
  — commit `ad2b8777` đổi `sourceId` của tiền-đường row sang
  `expense_accounting_sources.id` nhưng test vẫn expect cost-table ids
  (actual [3528, 14166] vs expected [3528, 3529]). Reproduce standalone
  (không dính rows của test mới). Bằng chứng:
  `qa/2026-10-17_141026230710_remediation-standalone.log`.
- Handoff cũ (task QA1016, completed) archive tại
  `plans/qa-full-guide-closed-loop-1016/handoff-archived-2026-10-17.md`.

## QA artifacts

- `qa/2026-10-17_141026230710_backend-tsc.log` — exit 0
- `qa/2026-10-17_141026230710_backend-tests.log` — 5 files; new test + pins
  green; chỉ QA-AUDIT-PHOI-11 ×3 fail (pre-existing, cite ở trên)
- `qa/2026-10-17_141026230710_remediation-standalone.log` — standalone repro
- `qa/2026-10-17_141026230710_write-pins.log` — o01-trip-pairs +
  shipment-quick-create (POST-denial pins) exit 0 vs policy mới
- `qa/2026-10-17_141026230710_frontend-tsc.log` — exit 0
- `qa/2026-10-17_141026230710_frontend-tests.log` — full FE suite
  4975/4977; 2 fail chỉ vì `dist/` chưa build (chính message của test:
  "dist/assets missing — run build first")
- `qa/2026-10-17_141026230710_build.log` — `make build` exit 0 (repair)
- `qa/2026-10-17_141026230710_frontend-tests-rerun.log` — rerun file fail:
  6/6 pass sau build
- `qa/2026-10-17_141026230710_root-lint.log` — red TẠI BASE cho
  `testplan/qa/2026-10-16_w1-*` (12 unused-vars, commit `2e6acf92`, không
  nằm trong diff này); scoped eslint trên các file của fix: exit 0
- `qa/2026-10-17_141026230710_context-check.log` — manifest valid

## Next step

Independent code review → commit `fix(141026230710): …` on this branch.
No push / merge / deploy (chỉ thị: do NOT push, deploy, merge).
