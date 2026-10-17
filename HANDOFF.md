# HANDOFF — 2026-10-18 — fix-171026123000-roster-inactive-units

Controller: this session (Paseo agent), worktree
`fix-171026123000-roster-inactive-units` (branch-off main @ 1105d184).
Updated: 2026-10-18.

## Goal + status

Ticket 171026123000-unaccented-seed-verifyfail: /hr/roster vẫn hiện unit
INACTIVE ("QA Audit Unit 0914") sau khi staging deactivate 5/5 — dropdown
"Lọc theo bộ phận" liệt kê unit INACTIVE, cột BỘ PHẬN render tên unit INACTIVE.
Owner decision 2026-10-17 (hướng b): ẩn unit INACTIVE khỏi roster, không đụng
data, KHÔNG sửa purge tool (hướng a bị loại).
STATUS: DONE (chưa merge theo chỉ thị).

## Changes (4 files code/test + 1 testplan)

- `backend/src/services/user.service.ts` — `listHrRoster()`: link nạp qua
  `loadUsersBusinessUnitIdsMap` (join business_units.status ACTIVE) thay cho
  query verbatim; `businessUnits` trả ACTIVE-only. `listBusinessUnits()` +
  `GET /auth/business-units` + BusinessUnitsManager giữ nguyên (INACTIVE visible
  ở /users management).
- `frontend/src/pages/HrRosterPage.tsx` — guard render: name map +
  dropdown options chỉ unit ACTIVE; id không resolve → không liệt kê (fallback
  `#id` xóa — đó là đường rò tên unit INACTIVE); driver chỉ link INACTIVE hiện
  '—', không crash. Doc comment ghi divergence chủ đích vs /users.
- Tests: BE `hr-roster-read.test.ts` describe mới (unit INACTIVE không trong
  `businessUnits`, link INACTIVE không trong `businessUnitIds`, driver chỉ link
  INACTIVE vẫn có dòng + mảng rỗng); FE `HrRosterPage.test.tsx` (dropdown options
  đúng ACTIVE-only, cột '—', mixed-link chỉ hiện tên ACTIVE, pick option vẫn
  lọc được).
- `testplan/2026-10-18-card-171026123000-roster-inactive-units.md` (case
  2026-10-18-card-171026123000-roster-inactive-units-hidden).

## Decisions / sources

- Filter ở cả 2 lớp: BE projection (data authority — endpoint không serve unit
  INACTIVE) + FE render guard (display invariant — payload rò rỉ cũng không
  hiện). FE test ghim đúng ngôn ngữ ticket ở UI layer.
- `qa-fixture-registry.ts` / purge tool KHÔNG đụng (hard rule) — comment
  "listHrRoster() returns businessUnitIds verbatim" trong registry giờ là lịch
  sử; purge vẫn hard-delete links (belt) + deactivate (braces).
- Review (code-reviewer subagent): 0 blocking; 1 Medium (stale doc comment) ĐÃ
  sửa. Low còn lại không chặn: (a) department filter state trống nếu unit bị
  deactivate giữa session (recoverable, không crash); (b) test hygiene
  disconnectRedis trong after của describe 1 (pre-existing, vô hại);
  (c) OUT-OF-SCOPE pre-existing: `syncUserBusinessUnitLinks` delete-all+reinsert
  có thể drop link INACTIVE khi save user ở /users (vi phạm spirit "Lịch sử…
  được giữ nguyên") — cần owner card riêng, KHÔNG thuộc diff này.

## Files owned

backend/src/services/user.service.ts, backend/src/tests/hr-roster-read.test.ts,
frontend/src/pages/HrRosterPage.tsx, frontend/src/pages/HrRosterPage.test.tsx,
testplan/2026-10-18-card-171026123000-roster-inactive-units.md.
Driver + evidence: qa/drivers/2026-10-18-roster-inactive-units-ui-drive.mjs,
qa/2026-10-18_roster-inactive-units_* (ignored, local evidence).

## QA artifacts + results

- Red-at-base (repro trước fix): `*_backend-tests-red.log` (unit INACTIVE vẫn
  trong roster.businessUnits), `*_frontend-tests-red.log` (cột hiện
  "Đội xe, QA Audit Unit 0914") — đúng symptom ticket.
- Green: be-tsc 0; BE scoped (hr-roster-read + qa-fixture-purge) 22/22 exit 0;
  fe-tsc 0; FE HrRosterPage 4/4 (re-run sau comment fix) exit 0; root lint 0;
  `make build` exit 0. Full BE/FE suites KHÔNG chạy (owner-scoped gates; scoped
  suites phủ mọi test file đụng module đổi).
- UI rung 3 (admin, worktree parallel stack vite:7178→api:3094, shared dev DB
  :5441 — main checkout 7175/3002 KHÔNG đụng): `*_ui-driver.log` 11/11 exit 0 —
  Bộ phận '—', dropdown ["Tất cả bộ phận"] (không tên INACTIVE), API
  /auth/users/roster identity sạch, DB fixture giữ nguyên khi UI ẩn (read-only),
  768/390 ok; screenshots `_ui-01-row.png`, `_ui-02-dropdown.png`,
  `_ui-w768.png`, `_ui-w390.png`; fixtures QA-named + cleanup DELETE 1 ×3.
  Design provenance: house primitives (FilterBar/UuiSelectField/record-table),
  không component mới → không consult catalog.

## Unrelated / preserved

- Stack chính :3002/:7175 + containers ss-prod-db/ss-prod-redis giữ nguyên.
- qa/ artifacts là evidence cục bộ (git-ignored); commit chỉ chứa source +
  testplan (ticket hard rule "stage ONLY files đã sửa").

## Next step

- Commit trên branch `fix-171026123000-roster-inactive-units`, KHÔNG merge.
- Owner: deploy staging khi sẵn sàng; orchestrator chạy lại purge nếu cần;
  cân nhắc card riêng cho (c) syncUserBusinessUnitLinks drop-link-INACTIVE.
