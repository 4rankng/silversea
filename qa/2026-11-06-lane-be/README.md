# qa/2026-11-06-lane-be — evidence for SIL-682 + SIL-683 (branch fix/sil-be-682-683)

Environment: local dev stack (`make dev` contract) — backend base build dcaa8295 on :3002
(serves the `dispatch` worktree at the exact base commit → valid BEFORE evidence), fixed build on
:3102 from this worktree, Postgres ss-prod-db :5441/silversea, account `ketoan` (ACCOUNTANT,
testplan/testaccounts.txt), fixture trip 1337 / shipment 1809 (dev-only).

## SIL-682 — "Tích duyệt" chi phí lái xe 404 (dialog sends expense_accounting_sources.id)

| Step | File | Result |
|---|---|---|
| Fixture (alias PK 5000 → native cost, trip 1337) | `fixture-sil682.sql` (+`cleanup-sil682.sql`) | applied, then reverted |
| BEFORE (base dcaa8295, :3002): POST /expense-accounting/confirm `{DRIVER, 5000}` | `driver-sil682-before.log` | **HTTP 404** `{"error":"Không tìm thấy chi phí thuộc lô."}` — ticket defect reproduced |
| AFTER (fixed build): same call | `driver-sil682-after.log`, `driver-sil682-after2.log` (final build) | **HTTP 200**, sources row `confirmedAt` set, tien-duong `confirmed:true`, totals `confirmed:150000` |
| Update path (dialog "Lưu") BEFORE review fix | `driver-sil682-update-before.log` | HTTP 200 but **native amount unchanged** (review blocker 1 reproduced) |
| Update path AFTER | `driver-sil682-update-after2.log` | HTTP 200, native row `amount=120000`, tien-duong reads it — "native row changed — update path honors the alias id" |

Drivers: `driver-sil682.mjs`, `driver-sil682-update.mjs` (exit statuses inside the logs; both AFTER runs exit 0).

## SIL-683 — completionDate −1 ngày (single `at time zone 'Asia/Ho_Chi_Minh'` on UTC-wall naive stamps)

| Step | File | Result |
|---|---|---|
| Trip 1337 `completed_at='2026-11-06 02:59:44'` (= 09:59 VN 11-06, ticket trip 347's instant), register API BEFORE | `driver-sil683-before.log` | window 11-06: **total=0** (trip missing); window 11-05: `completionDate=2026-11-05` — −1 day reproduced |
| Register API AFTER | `driver-sil683-after.log` | window 11-06: total=1, `completionDate=2026-11-06`; window 11-05: total=0 |
| SQL boundary proof on real Postgres, old vs new chain, session TZ UTC **and** Asia/Ho_Chi_Minh | `driver-sil683-boundary.sql` → `driver-sil683-boundary.out` | 23:xx biên đêm (23:30 VN 11-05): both 11-05 ✔; 00:xx biên sáng (00:30 VN 11-06): old 11-05 ✘ → new **11-06** ✔; ticket instant: old 11-05 ✘ → new **11-06** ✔; new chain identical under both session TZs, old chain flips (session-dependent) |

Trip `completed_at` reverted after the runs (see cleanup commands in the session log; final state `2026-11-04 15:11:02.555`).

## Gates (final code, post review fixes)

| Gate | File | Result |
|---|---|---|
| `cd backend && npx tsc --noEmit` | `2026-11-06_lane-be_be-tsc.log` | exit 0 |
| `cd backend && npx tsx --test 'src/tests/unit/*.test.ts'` (+ `pnpm test` full run earlier) | `2026-11-06_lane-be_be-unit.log` | 942 pass / 0 fail, exit 0 (full `pnpm test` incl. integration bucket: 342 pass / 0 fail) |
| `pnpm lint` (root) | `2026-11-06_lane-be_root-lint.log` | 0 errors (4 pre-existing warnings, untouched frontend files) |
| `make build` | `2026-11-06_lane-be_make-build.log` | see file |

## Coverage table (AGENTS §9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-682: dialog "Tích duyệt" succeeds with the dialog's id space | DB/API VERIFIED (2) | `driver-sil682-before.log`, `driver-sil682-after2.log`, `driver-sil682-update-after2.log` | UI DRIVEN click-through on the real dialog — FE untouched by this lane (BE-only constraint); the FE call shape was mirrored byte-for-byte by the driver |
| SIL-682: update/correct honor the alias id | DB/API VERIFIED (2) | `driver-sil682-update-after2.log` + unit branch tests | correct path not API-driven (same shared resolution law; unit-scanned) |
| SIL-683: register completionDate = VN business day | DB/API VERIFIED (2) | `driver-sil683-before.log`, `driver-sil683-after.log`, `driver-sil683-boundary.out` | debit-note draft page UI (same shared law, SQL boundary table covers the ::date form) |
