# 2026-09-28 — Human QA local run (testplan/ full sweep)

**Ticket:** — (QA run, no code change)
**Owner (verify):** qa
**Status (this doc):** DONE — run complete, findings triaged
**Cycle:** local dev, 2026-09-27 evening (evidence timestamps) / filed 2026-09-28

## Goal

Execute the whole `testplan/` QA surface against the **local** dev stack and
report which results are real product defects, which are stale test assets, and
which are simply unrunnable locally. No code was changed in this run.

## Environment as actually run

| Slot | Value |
|---|---|
| Local UI | `http://localhost:7175` (started with `VITE_API_PROXY_TARGET=http://localhost:3002 npx vite --port 7175`) |
| Local API | `http://localhost:3002/api` (already running) |
| Postgres / Redis | `:5441` / `:6379` (docker, already running) |
| Browser | system Google Chrome via puppeteer 25.1.0 (harness) and `@playwright/test` chromium (20260927 drivers) |
| HEAD | `e778edcc` |

> Note for the next run: a bare `pnpm dev` in `frontend/` starts vite on
> **7174** (`frontend/vite.config.ts:46`) and the Makefile's `dev` target
> overrides it to **7175**. The harness default (`lib/env.mjs:37`) is 7175.
> Running the frontend on 7174 without the proxy override silently points the
> API at 3001. Always start it the way the Makefile does.

## Headline verdict

**The suite is NOT green, but almost none of the red is the product.**

- **7 real findings** — 2 P0 gate failures, 1 UI defect needing a product
  ruling, 1 test-suite integrity hole, 1 silently-broken evidence driver,
  1 broken documented gate, 1 testplan coverage gap.
- **None of the 14 non-PASS case verdicts from the harness is a product bug.**
  11 are test-asset defects (stale selectors, a stale message string, bad
  assertions); the rest are fixture assumptions the local DB does not satisfy.
- **Three of the prescribed QA gates are red on HEAD**: backend unit (F-1),
  frontend unit (F-7), and lint (F-5 — `pnpm lint` cannot even start).
  Both typecheck gates are green.
- **What is actually verified working:** 7/7 role logins, the harness's own
  PASS/FAIL/BLOCKED reporting contract (10/10), 10 PASSing regression cases,
  6/6 driver-chrome assertions, 123 of 125 filter bars clean, and AUTH-03
  route guarding across 22 role×route probes.

---

## Findings

### F-1 (P0, gate) — `pnpm test:unit` is red: the drizzle journal index gap fix was reverted

- **Evidence:** `backend` unit suite → `227 pass / 1 fail` of 228.
  `o2c-rev1.migration-safety.test.ts` →
  `AssertionError: entry 127 has idx 128 — journal indices must be contiguous from 0`
- **Root cause:** `backend/drizzle/meta/_journal.json` holds **132 entries whose
  `idx` values run 0–126, 128–132 — `127` is missing.** Confirmed by script:
  5 idx/position mismatches starting at array position 127. No `.sql` file is
  orphaned and no journal tag lacks a file (132 files ↔ 132 entries), and the
  `when` sequence is monotonic, so **no migration is actually lost** — the
  application order is correct. The defect is the hole in the index counter,
  which the repo's own tripwire (`helpers/journal-invariants.ts:51`) forbids.
- **History:** commit `19a7762` replaced the `idx: 127` entry
  (`20260924021509_high_valkyrie`) in place, so the slot vanished.
  `a43676c`/`17907a5` re-added the file; `5bd7d0b8`
  ("fix(db): repair the drizzle journal index gap (idx 127 was missing)",
  19:39) renumbered the five tail entries to be contiguous.
  **`c1075f25` reverted it 12 minutes later (19:51) with no stated reason.**
- **Impact:** `roles/README.md` §6 and `qa/_TEMPLATE.md` both make
  `cd backend && pnpm test` a mandatory pre-push gate. HEAD fails it. The
  repair commit is still in history and is a clean re-apply candidate.
- **Needed:** a decision on why `c1075f25` was made, then either re-apply
  `5bd7d0b8` or change the invariant. Silently red is the worst of the three.

### F-2 (UI, needs a product ruling) — `/dispatch-detail` "Bộ lọc" panel covers the trigger it was opened from

- **Evidence:** `testplan/qa/evidence/20260928_humanqa_filter-audit/report.json`
  → 2 flagged bars, both `dispatch-detail`, at **1024 and 1440**:
  `overlaps: true`, `gapBelow: -137`, `gapAbove: -769`, panel 876px tall
  opening at `top: 12` while the trigger sits at `top: 119`.
- **Confirmed visually**, not just by measurement —
  `dispatch-detail-1440-panel-open.png` shows the "Bộ lọc nhanh" sheet spanning
  the trigger's own box. At 390 it is a proper mobile bottom sheet and is fine.
- **Why it matters:** this is precisely the failure the audit was written to
  hunt (`ui-filter-audit-20260927.mjs` header, L4: "the panel never covers the
  control that opened it — the operator's *'why the dropdown jump around not
  right below where I clicked'*").
- **Needed:** `/dispatch-detail` uses a full multi-section **filter sheet**, not
  a dropdown. Either (a) it should be anchored below the trigger, or (b) the
  audit should exempt sheet-style panels. Right now the audit is red on a
  surface whose design may legitimately differ. **This is a ruling, not a
  bug-fix I should pick unilaterally.**
- Everything else the audit measured is clean: **125 bars measured, 2 flagged,
  0 overflow, 0 page overflow, 0 outside-bar items.**

### F-3 (test-suite integrity) — 3 of 9 cases in `dispatch-sweep-2026-09-09` are never executed

- `testplan/qa/cases/dispatch-sweep-2026-09-09/` holds **9** case files;
  its `index.mjs` registers **6**. The three orphans never run in `run-all.mjs`:
  | Unregistered case | Verdict when run by hand |
  |---|---|
  | `TC-DV-DISPATCH-051.mjs` | **PASS** (9.5s) |
  | `TC-DISPATCH-REASSIGN-001.mjs` | BLOCKED — "Không tìm thấy ô điều phối nào có trạng thái Phân xe lại trước khi chuyến xuất phát" |
  | `TC-ROAD-ALLOWANCE-001.mjs` | BLOCKED — no route with a rate for exactly one trailer type |
- `TC-DV-DISPATCH-051` passes and would catch a real regression, yet the topic
  reports "6 cases" and exits on a green-looking 4·pass·1·fail line. A green
  topic is currently able to hide a passing-but-unrun test.
- **Fix:** register all three in `index.mjs` (or move the two that need
  staging-only fixtures to a documented BLOCKED-by-design slot).

### F-4 (silent failure) — `ui-create-flow-pixel-20260927.mjs` produces garbage evidence and exits 0

- `shot-meta.json` from the run records, for width **1440**, *every single pick*
  as `no-trigger` / `no-input`, and for width 390 all but 3 as misses:
  ```
  customer=no-trigger  direction=no-option  containerType=no-option  factory=no-option
  weight=no-input      number=MSCU7654329
  ```
- The shots confirm it: `shot-1440-with-data.png` is a **"Đang tải..."** blank
  page. Nothing was captured, and the script still printed a success line and
  exited 0.
- **Root cause — stale selectors.** The create form's real hooks are:
  - customer: a React-Aria `role="combobox"` input with **no** `aria-label`
    (not `input[aria-label="Khách hàng"]`);
  - trade direction: a `<button class="csc-uui-field">` reading
    "— Chọn hình thức —" (not `input[placeholder="Chọn Nhập hoặc Xuất"]`);
  - "Loại container" / "Nhà máy" / "Cảng nâng" / "Cảng hạ" comboboxes carry
    `aria-label` but only exist **after** a container is added;
  - "Số container" / "Trọng lượng (kg)" likewise only exist inside the
    add-container form.
- Separately, the "successful" picks it *did* report (`route`,
  `pickup=Cảng Hải Phòng`, `dropoff=Cảng Hải Phòng`) are suspect: the option
  selector `[role="option"], [role="listbox"] li, .searchable-select__option,
  [data-option]` is unscoped, and route + pickup + dropoff all returning the
  *same* value is not what those three fields should do.
- The page itself is **fine** — a direct probe of `/shipments/new` settles in
  <2s with headings *Tạo lô hàng / Nhận diện lô / Thông tin hàng / Lịch & ghi
  chú* and 23 inputs, no failed requests.
- **Fix:** the driver needs the real hooks *and* must assert it actually
  captured something (a run where every pick is `no-trigger` must exit nonzero).

### F-5 (broken documented gate) — the root `pnpm lint` cannot run

- `pnpm lint` at the repo root (documented in `CLAUDE.md` **Commands** and
  `roles/README.md` §6) fails instantly:
  `ESLint couldn't find an eslint.config.(js|mjs|cjs) file.` (exit 2).
- Only `frontend/eslint.config.js` exists. **`backend/` has no eslint config at
  all**, so no backend file is linted by any documented command.
- The one invocation that does work, `cd frontend && npx eslint .`, is also
  **red**: `✖ 21 problems (4 errors, 17 warnings)`. All 4 errors are
  `no-useless-escape` in test files:
  - `features/dispatch/master-plan/MasterPlanGrid.date-pair.verify.styles.test.ts:36`
  - `features/dispatch/master-plan/MasterPlanGrid.test.tsx:665, 685`

### F-6 (testplan gap) — the CUSTOMER role walkthrough is unexecutable

- `testplan/roles/07-khachhang.md` exists and `shared` defines a `CUSTOMER`
  role, but `testplan/testaccounts.txt` has **no `CUSTOMER:` key** in either the
  `local:` or `staging:` users block (keys are ADMIN, MANAGER, ACCOUNTANT, CUS,
  DISPATCHER, OPS, DRIVER). The two customer accounts
  (`samsung-cs`, `canon-cs`) live only in the prose `demoUsers:` list.
- So `env.candidatesFor('CUSTOMER')` returns `[]`, `smoke.mjs` never probes the
  role, and any case tagged CUSTOMER cannot log in. Confirmed at runtime:
  `login failed: no username for role CUSTOMER in env local`.
- **Fix:** add a `CUSTOMER:` role line to both env blocks in
  `testaccounts.txt` (local: `samsung-cs, canon-cs`) and add `'CUSTOMER'` to
  the `roles` array in `smoke.mjs:16`.

### F-7 (P0, gate) — the frontend unit suite is red, and the failure set is not stable

- **Run 1:** `Test Files 8 failed | 476 passed (484)` · `Tests 14 failed | 3204 passed (3218)` · 596s.
- **Run 2** (identical command, run alone): a **larger and different** failure
  set — ~26 named tests across ~11 files, dominated by
  `@testing-library/dom` `getElementByLabelText` / `waitFor` **timeouts**
  (e.g. `ClerkShipmentCreatePage.test.tsx:1006` — "Test timed out in 15000ms").
  Two runs of the same tree disagreeing means the suite is **flaky under load**,
  not that one regression moved. A clean serial re-run is needed to pin the
  true set before anyone starts "fixing" individual tests.
- **At least one confirmed stale structure test, same family as F-4.**
  `ClerkShipmentCreatePage.styles.test.ts:224` asserts the page source contains
  `className="csc-route-picker"`. That class now lives in
  `features/shipments/create/ShipmentCreateLclRouteSection.tsx` (and
  `ShipmentCreateContainerRow.tsx`) after the create form was split into
  section components. The 7 failing cases in that one file are all
  source-text assertions against a page whose JSX moved.
- **Other failing areas:** `ShipmentsPage.test.tsx` (5 — the CUS closeout
  workspace / card 20260923_1 drawer-and-cell group), `TripListPage.test.tsx` (2,
  incl. the card 20260927_152 shared-filter-bar check),
  `RecoverableCostsPage.test.tsx` (2), `ExpenseCashDrawer` ,
  `OpsExpenseCatalogRecovery`, `ShipmentCreateWorkspace.mode-toggle`,
  `master-data-name-forms`, and the two contract suites
  `control-density.styles` and `operational-color-contract.styles`.
- **Gate impact:** `roles/README.md` §6 makes `cd frontend && pnpm test`
  mandatory pre-push. It is red on HEAD, and its red is not yet actionable
  because it is not reproducible.

---

## Triage of the 14 non-PASS case verdicts — 11 are test defects

Every FAIL and BLOCKED below was investigated against the app source and, where
the DOM mattered, against the run's own screenshots. **None is a product bug.**

| Case | Verdict | Why it is not a product defect |
|---|---|---|
| `TC-CUS-API-ERRCONTRACT-001` | FAIL | **Stale expectation.** The case demands the top-level message contain `Trọng lượng phải là số không âm hợp lệ (cargoWeightKg)`. The API returns `Trọng lượng phải là số không âm hợp lệ` **and** `details: [{code, message, path:["cargoWeightKg"]}]` — i.e. the structured array the case is pinning is *present and correct*. `backend/src/tests/validation-error-contract.test.ts:37-38` asserts the shipped string and explicitly asserts it must **not** contain `cargoWeightKg`. The case contradicts the shipped contract. |
| `TC-SHIP-SEARCH-001` | FAIL | **Stale selector.** Looks for `input[placeholder*="Bill/Book"]`; the real `/shipments` search is `placeholder: 'Bill, Book, Cont, Tờ khai...'` + `ariaLabel: 'Tìm lô hàng'` (`ShipmentsPage.tsx:490-491`). It also hardcodes a staging fixture ref `SHELL-BILL-001`. |
| `TC-SHIP-QUICKEDIT-001` | FAIL (2 errors) | **Bad assertion + wrong row.** (a) Its FCL detector is `td[data-label='Lịch trình & điều xe'] div.cus-inline-trigger--readonly` — a *locked* cell, not an FCL marker — so it picked an LCL lot and rightly got a modal instead of a navigation; the screenshot shows it clicked `CF khách 1790257311484-ax74i5`. (b) `fields === 0 ⇒ FAIL` is wrong: `CusQuickEdit.tsx:30,51-53` renders Bill/Booking inputs only for IMPORT/EXPORT and otherwise shows "Chọn Nhập hoặc Xuất trong mục Phân loại trước khi cập nhật Bill/Booking." The screenshot shows that modal rendering **exactly** as designed. |
| `TC-SHIP-DRAWER-001` | FAIL | **Test-ordering.** It opens the *first* row of `/shipments`. The three chungtu-regression PASS cases in the same wave each create a shipment, and those landed at the top of the list (ids 11192–11197, customer `CF khách <random>`). Those have 0 containers, so `CusContainerLedger` renders `<p class="cus-detail-empty">` and no table at all. Every other drawer assertion in the case passed. **Cross-topic pollution — topics are not isolated.** |
| `TC-SHIPMENTS-DETAIL-001` | FAIL | **Fixture-dependent.** It types `QA0920-BL-RE` (staging-only fixture) into `/shipments-detail`, filters to 0 rows, and has no BLOCKED branch for "the filter emptied the list" → `totalRows: 0` ⇒ FAIL. |
| `FACTORY-DISPLAY-REGRESSION-2026-09-07` | BLOCKED | No shipment matching the regression shape locally. |
| `TC-CUS-CREATE-026` | BLOCKED | No shipments to test duplicate-BL against. |
| `TC-CUS-CREATE-028` | BLOCKED | No BL-bearing shipment with a container appointment. |
| `TC-CUS-APPOINTMENT-001` | BLOCKED | `.cus-appointment-trigger` not in the drawer — same first-row/empty-container cause as `TC-SHIP-DRAWER-001`. |
| `TC-ROAD-ALLOWANCE-001` | BLOCKED | No route priced for exactly one trailer type. |
| `TC-DISPATCH-REASSIGN-001` | BLOCKED | No "Phân xe lại trước khi chuyến xuất phát" cell state locally. (Also unregistered — see F-3.) |

Two things to change in the harness, both worth doing:

1. **Topics are not isolated.** A PASSing case in one topic mutates the
   `/shipments` list that the next topic's row-finders depend on. Either
   each topic resets, or row-finders select by a stable property (has
   containers / has an appointment) instead of "first row".
2. **Every one of these BLOCKED cases prints "…on staging"** even when the
   harness is pointed at local (`smoke.mjs`/cases hardcode the word). The
   messages read as staging claims on a local run. Use `ctx.env.env`.

---

## What passed

| Check | Result |
|---|---|
| Backend `/api/health` | 200, `buildHash: dev` |
| Frontend root `:7175` | 200 |
| `smoke.mjs` role logins | **7/7** — ADMIN, MANAGER, ACCOUNTANT, CUS, DISPATCHER, DRIVER, OPS all authenticate |
| `node --test testplan/qa/lib/*.test.mjs` | **10/10** (the PASS/FAIL/BLOCKED reporting contract holds) |
| `chungtu-regression` | 4 PASS, 3 BLOCKED, 1 FAIL (test defect) |
| `dispatch-sweep-2026-09-09` | 4 PASS, 1 BLOCKED, 1 FAIL (fixture-dependent) + 3 unregistered (F-3) |
| `shipments-qa` | 2 PASS, 3 FAIL (all test defects) |
| `ui-driver-chrome-20260927.mjs` | **6/6 assertions PASS** at 390 and 768 |
| `ui-filter-audit-20260927.mjs` | 125 bars measured, **2 flagged** (both F-2, same surface), 23 skipped, 0 overflow |
| `cd backend && npx tsc --noEmit` | **0 errors** |
| `cd frontend && npx tsc -b` | **0 errors** |
| `cd backend && npx tsx --test 'src/tests/unit/*.test.ts'` | 227/228 — **1 fail (F-1)** |
| `cd frontend && npx vitest run` | **476/484 files, 3204/3218 tests — 14 failed and unstable across runs (F-7)** |
| `pnpm lint` (root) | **cannot run (F-5)** |
| `cd frontend && npx eslint .` | **4 errors, 17 warnings (F-5)** |
| AUTH-03 role route guarding (22 probes, CUS/DRIVER/OPS × 7 routes) | **holds** — every forbidden route bounced to the role's own home, no error toast, no console error, no protected content rendered |

## What is NOT covered (be honest)

- **Nothing was run against staging.** `testaccounts.txt` staging is a
  prod-mirror, and `roles/README.md` §4 says a local-only run is a smoke test
  and cannot be reported as acceptance. Every fixture-dependent BLOCKED above is
  probably a PASS on staging; that was not verified.
- **The 20260918 driver batch was not run** (`ui-carrier-suggestions`,
  `ui-copy-icon-create`, `ui-copy-icon-ledger`, `ui-drawer-container-number`,
  `ui-error-leak`, `ui-page-size`, `ui-copy-demo-staging`, plus
  `journey-o2c`, `haha-regression-driver`, `haha-rollback-probe`). Roughly a
  dozen more defect drivers are unexercised.
- **No mobile-device pass.** Widths 390/768 were covered only by the two
  drivers above; the 7 role walkthroughs were not walked end to end.
- **The 12 `flows/*.md` specs were not executed** — only the case library that
  partially overlaps them.
- **CUSTOMER portal not tested at all** (F-6).
- **`cd e2e && ./run_all.sh` not run** (needs staging per its own note).
- **The 23 audit skips** are unverified surfaces, not passes: `debt@1187`,
  `expense-accounting@1024` render no shared `.filter-bar`; the rest were
  skipped because the probe role was bounced off the route
  (`portal-statement`, `trips`, `dispatch-detail@768`, `fleet-*@768`,
  `ops-orders`, `admin-advance-settlements`).
- **DB fixture hygiene:** this run added ~6 throwaway shipments
  (`CF khách <random>`, ids 11192–11197) to the local DB. They are now the
  top rows of `/shipments` and will keep poisoning first-row finders until
  `pnpm db:reset && pnpm db:seed`.

## Kanban cards

Mọi phát hiện trong báo cáo này đã được tách thành card trên board
(`Kanban-PROD/TODO`), sinh bằng `scripts/kanban-cards-20260928-qa-sweep.py`:

| Card | Vấn đề | Mức |
|---|---|---|
| `20260928_152-drizzle-journal-idx-127-reverted` | F-1 | P0 gate |
| `20260928_153-frontend-vitest-red-and-flaky` | F-7 | P0 gate |
| `20260928_154-pnpm-lint-broken-at-root-no-backend-config` | F-5 | gate hỏng |
| `20260928_155-three-orphan-cases-never-registered` | F-3 | test-suite |
| `20260928_156-create-flow-pixel-driver-captures-nothing` | F-4 | evidence |
| `20260928_157-customer-role-untestable-by-harness` | F-6 | testplan gap |
| `20260928_158-dispatch-detail-filter-panel-covers-its-trigger` | F-2 | UI, cần lệnh sản phẩm |
| `20260928_159-qa-cases-stale-selectors-and-assertions` | 11 case hỏng | test asset |
| `20260928_182-root-lint-parse-noise-frontend-scratch` | 29 Parsing-error rác chặn gate lint | config |
| `20260928_183-backend-no-console-policy-decision` | 225 cảnh báo no-console ở backend | policy |
| `20260928_184-frontend-css-contract-tests-9-retired-tokens` | 9 test CSS ghim token cũ | test asset (ĐÃ SỬA xong) |
| `20260928_185-frontend-suite-load-flake-waitfor-timeouts` | suite flaky theo tải máy | test infra |
| `20260928_186-boot-redis-timeout-handle-never-cleared` | handle setTimeout không clear | code chất lượng |
| `20260928_187-legacy-gate-sweep-syntax-error-unparseable` | script _legacy không parse | testplan |
| `20260928_188-commit-cites-validation-script-never-existed` | commit cite script chưa từng tồn tại | quy trình |
| `20260928_189-two-blocked-cases-missing-env-tag` | 2 case BLOCKED thiếu env | test asset |
| `20260928_190-filter-audit-23-skips-unverified-not-pass` | 23 surface skip, chưa phủ | coverage |
| `20260928_191-local-db-throwaway-shipments-pollute-row-finders` | lô hàng rác đầu /shipments | vệ sinh dữ liệu |
| `20260928_192-frontend-dev-port-7174-vs-7175-footgun` | port lệch 7174/7175, proxy sai | quy trình dev |

## Trạng thái sửa (vòng 1 — 2026-09-28)

| Card | Việc đã làm | Bằng chứng |
|---|---|---|
| 152 | Đánh số lại 5 entry cuối của `backend/drizzle/meta/_journal.json` cho liên tục `0..131` (chỉ metadata, **không file `.sql` nào đổi**). Re-apply đúng thay đổi của commit `5bd7d0b8` đã bị revert. | `pnpm test:unit` → **228/228 xanh** (trước: 227/228). Đếm chéo: 132 entry ↔ 132 file `.sql`, 0 mồ côi, 0 lệch idx, `when` đơn điệu. |
| 152 | Phát hiện thêm: `scripts/check-migration-trio.mjs` — script mà commit `5bd7d0b8` tự nhận đã dùng để validate — **chưa bao giờ được commit** (`git log --all --diff-filter=A` rỗng). Message của commit đó khai một bằng chứng không tồn tại. | `ls scripts/check-migration-trio.mjs` → No such file. |
| 154 | Thêm `eslint.config.mjs` ở gốc: dùng lại nguyên config frontend (re-base qua `basePath`), thêm khối **backend** + **shared** + **testplan/qa**/**scripts** (backend trước đây **không có** lint nào). Dùng `createRequire` từ `frontend/package.json` — đúng pattern sẵn có trong repo, không nhân bản dependency. | `pnpm lint` trước: exit 2 *"couldn't find an eslint.config"* → nay chạy thật. |
| 154 | Dọn dead code thật phát hiện khi bật lint: 158 → còn 55 lỗi `no-unused-vars` ở `backend/src` (tsc không bắt vì `noUnusedLocals` tắt). Đã xoá 103 chỗ. | `npx tsc --noEmit` exit **0** sau khi xoá. |
| 154 | Bỏ 5 dead bindings ở harness: `loadEnv` (harness.mjs), `fs` (run-case.mjs), `podVersion`, `IDK`, `pendingLots`. Thêm `caughtErrorsIgnorePattern: '^_'` để `catch (_)` — idiom sẵn có — không bị flag. | `npx eslint shared testplan` → **exit 0**. |
| 155 | Đăng ký 3 case mồ côi vào `dispatch-sweep-2026-09-09/index.mjs`, **kèm tripwire mới** `lib/case-registration.test.mjs` (3 assertion/topic: file chưa đăng ký, đăng ký file không tồn tại, id trùng). | `node --test testplan/qa/lib/*.test.mjs` → **20/20** (trước 10/10). |
| 157 | Thêm khoá `CUSTOMER:` vào `testaccounts.txt` (local: `samsung-cs, canon-cs`) + thêm `'CUSTOMER'` vào `smoke.mjs`. Đồng thời sửa `smoke.mjs` **in ra `FAIL` nhưng vẫn exit 0** — nay role đăng nhập hỏng sẽ làm gate đỏ thật (role local-only thì vẫn được dung thứ). | `node testplan/qa/scripts/smoke.mjs` → **8/8 vai trò OK**, exit 0. |
| 156 | Viết lại `ui-create-flow-pixel-20260927.mjs`: chờ tín hiệu render thật (`#shipment-trade-direction`) thay vì ngủ cứng 2500ms; selector thật đo từ DOM; option picking **scoped vào listbox đang mở** và **lọc placeholder**; **exit ≠ 0 khi không chụp được gì**. | Chạy thật → **exit 1** + liệt kê đúng 3 bước không chụp được, thay vì in dòng thành công rỗng. Trước: toàn `no-trigger` ở 1440 nhưng exit 0. |
| 153 | Sửa 2 assertion CSS **brittle** (nhạy khoảng trắng): `RecoverableCostsPage` (`overflow-wrap:anywhere` không khoảng trắng → có khoảng trắng) và `csc-customer-popover` (`var(--surface, #fff)` → `var(--surface)`). Cả hai rule **vẫn đúng**, chỉ là test ghim quá chặt vào byte. | Cả 2 file xanh. |
| 153 | `ShipmentsPage.test.tsx`: **5 assertion CSS cũ** — CSS đã đổi **có chủ đích** (mỗi thay đổi đều kèm comment giải thích) còn test thì chưa cập nhật. Đã ghim lại **ý định** thay vì literal đã chết. VD `border-radius: 7px` → `8px` (commit `cd862de4` đưa app về 8px chuẩn; 7px giờ chỉ còn trong `styles/utilities.css`). | `npx vitest run --no-file-parallelism src/pages/ShipmentsPage.test.tsx` → **118/118 xanh**; `tsc -b` 0; `eslint` 0. **CSS không bị sửa.** |

### Đã xong thêm (vòng 2 — 2026-09-28)

| Card | Kết quả |
|---|---|
| 154 dead code | 55 → **0** `no-unused-vars` ở `backend/src`. Giữ nguyên side-effect, 2 rest-destruct được restructure đúng cách, **không test nào mất assertion**. `npx tsc --noEmit` exit 0. |
| 153 (9 test CSS) | 9 test/6 file đỏ cuối cùng đã sửa xong. **Toàn suite: 484 file / 3218 test / 0 fail**; `tsc -b` 0; `eslint src` 0 lỗi. Token mới được **kiểm chứng thật** (tính tỉ lệ WCAG) chứ không chỉ thay literal. **Không sửa file `.css`/`.tsx` nào.** |
| 159 (6 case) | Cả 6 case PASS/BLOCKED-đúng. Topic: chungtu 5P/3B, dispatch 6P/3B (chạy 9 case), shipments 4P/1B — **0 FAIL** (trước 5 FAIL). |

### Còn mở trên board (không sửa ở đợt này)

- **Card 182:** root lint còn 29 "Parsing error" rác ở script one-off `frontend/` → **gate lint vẫn đỏ**. Cần quyết định scope.
- **Card 185:** phần flaky theo tải máy (596s→98s, timeout 15s) — chưa có quyết định ngưỡng/concurrency.
- **Card 186:** `boot-redis` giữ handle `setTimeout` không clear (giữ event loop thêm mỗi boot).
- **Card 187:** script `_legacy/2026-09-10_gate-sweep.mjs` không parse (thiếu ngoặc) — hiện lint-ignore, cần sửa hoặc xoá có chủ đích.
- **Card 188:** commit `5bd7d0b8` cite `check-migration-trio.mjs` chưa từng tồn tại — vấn đề quy trình, không sửa được bằng code.
- **Card 189:** 2 case BLOCKED (REASSIGN, ROAD-ALLOWANCE) chưa gắn env.
- **Card 190:** 23 surface filter-audit bị skip (chưa phủ, không phải đã đạt).
- **Card 191:** DB local còn lô hàng rác đầu `/shipments` (id 11192–11197).
- **Card 192:** footgun port 7174 vs 7175.
- **Card 158:** đã được commit đồng thời `f31a47d6` sửa; **cần chạy verify filter-audit** để đóng.
- **Card 183:** 225 cảnh báo `no-console` — chờ quyết định policy.

## Linked artifacts
