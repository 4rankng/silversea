# Lane 2026-11-06 — SIL-696 + SIL-697 evidence (branch fix/sil-cost)

Lane stack: worktree `w13-cost`, backend `tsx src/index.ts` on **:3004**, FE vite on **:7180**
(proxy → :3004), shared dev DB `silversea` @ :5441 (docker `ss-prod-db`), Redis :6391.

> ⚠️ Environment note (root cause of the wasted mid-lane runs): a **stale tsx compile
> cache** (`node_modules/.cache/tsx-501`) served pre-fix compiled modules to freshly
> booted dev servers, so confirm→refresh initially ran the OLD filter. Standalone tsx
> processes (unit tests, probes) always ran the fixed code, which produced the
> contradictory evidence. Cache deleted; final verification below ran on a clean
> compile. Separately, port 3003 was held by a sibling lane's backend (`w13b-urgent`
> pid 1183) — the lane stack moved to :3004.

## SIL-696 — phí nâng đã duyệt không vào chi phí trực tiếp chuyến

- **Fix (backend/src/services/expense-trip-cost.service.ts):** `reconciledDriverCosts().extra`
  no longer drops confirmed driver claims whose `customerChargeAmount > 0` (the old
  `costGroup DRIVER_ROAD || charge 0` clause silently discarded approved LIFT_FEE /
  DROP_FEE rows from `totalCost`). TOLL keeps its reconciled branch; ROAD_ALLOWANCE
  stays out (system salary law); signed/negative-row law unchanged.
- **Before (base 3efeffb9), unit-level repro:** `reconciledDriverCosts([{LIFT_FEE 175000
  charge 175000},{TOLL 135000}])` → `{"toll":135000,"extra":0}` — the lift vanished.
  After: `{"toll":135000,"extra":175000}`.
- **API E2E (fresh-compile backend :3004), trip 24 / TRP-202610-0001 (ntvu, OWN,
  IN_TRANSIT, unpaired):** driver records lift 175.000₫ (thu khách 175.000₫) + toll
  135.000₫ → kế toán completes classification (`entries/DRIVER/:src/update`) →
  `POST /api/expense-accounting/confirm` 200 → trip:
  `totalCost=310000, tollCost=135000, reconciledExtraCost=175000, grossProfit=-310000`.
  Probe log: `sil-696_api-dry-reread.log` (state re-read) — original apply runs:
  trip 40 (`AFTER totalCost= 310000 … SIL-696 API VERIFIED`) and trip 759
  (`totalCost= 330000` = lift 175k + toll 135k + parking 20k, `reconciledExtraCost=195000`).
- **UI (rung 3):** `/trips/24` — trip page financial card shows **"Tổng chi phí
  310.000 ₫"** (acceptance number, khớp màn duyệt 175k+135k).
  Screenshot `sil-696_ui-trip-cost-310k.png`; DOM text
  `sil-696_ui-driver.json` (`snippet: "Tổng chi phí310.000 ₫ …"`). Driver: puppeteer-core
  script `qa/scripts/lane-696-ui-drive.mjs` (admin, token injected pre-load).
- **Persistence:** confirmed lift stays in `totalCost` after trip completion too —
  trip 40 (COMPLETED by the SIL-697 UI run) keeps `reconciledExtraCost=175000,
  reconciledTollCost=135000` inside its completion-materialized `totalCost`.
- **Unit:** `backend/src/tests/unit/expense-trip-cost.test.ts` — 4/4 pass, pins the new
  law (charged lift counts; drop/warehouse/parking count; negative rows behave absent;
  missing tolls keep `toll: null`).

## SIL-697 — e-POD: nút Hoàn thành nộp nháp thiếu file rồi fail

- **BE gate** (`backend/src/services/trip-pod.service.ts` `submitPod`): a DRAFT missing
  either required type refuses to move to SUBMITTED — 409
  `Chưa đủ chứng từ giao hàng. Còn thiếu: Phiếu hạ bãi / trả hàng, Biên bản giao nhận đã ký. …`
  Supersedes card 261022213755a's submit-anything rule per owner decision (Frank, 06/11, comment trên ticket).
- **FE gates** (`DriverTripPodPage`, `DriverTripDetailPage` — shared
  `lib/podReadiness.missingPodFilesMessage`): the Hoàn thành action checks BOTH types
  BEFORE submitting the draft; missing → warning toast naming the missing types, no
  submit, no complete. Copy flips from "tùy chọn" to required; ready-indicator now
  requires both types.
- **UI drive (rung 3), trip 40 / fulfillment 171 (dvthuc):**
  1. DRAFT with yard receipt only → tap HOÀN THÀNH CHUYẾN → toast
     `Chưa đủ chứng từ giao hàng. Còn thiếu: Biên bản giao nhận có ký nhận…`,
     **0 submit + 0 complete requests** left the page (network log:
     `sil-697_ui-driver-requests.json`), submission stayed DRAFT.
  2. Upload Biên bản via the UI slot → tap again → submit (1 request) + complete (1
     request) → toast `Hoàn tất chuyến hàng thành công!`.
  - Screenshots: `sil-697_ui-1-initial-yard-only.png`, `sil-697_ui-2-yard-only-draft.png`,
    `sil-697_ui-3-blocked-toast.png`, `sil-697_ui-4-completed.png`.
  - **DB side effects:** `trips` id 40 → `COMPLETED` (completed_at set);
    `trip_pod_submissions` id 37 → `SUBMITTED` with exactly
    `YARD_OR_DROP_RECEIPT,SIGNED_DELIVERY_NOTE`.
  - Driver script: `qa/scripts/lane-697-pod-ui-drive.mjs` (puppeteer-core, driver
    dvthuc/Abc123, localStorage token injected pre-load; the run's 4 failed checks were
    verification-shape bugs in the script itself — superseded by the DB proof above;
    script fixed for reruns).
- **BE gate probe:** `qa/scripts/lane-697-be-gate-verify.mjs` on trip 754 (dtthinh) —
  empty DRAFT submit → **409** naming both missing types. Log: `sil-697_be-gate.log`.

## Gates (final clean run)

| Gate | Command | Result |
|---|---|---|
| Root lint | `pnpm lint` | 0 errors (4 pre-existing warnings) |
| Backend typecheck | `cd backend && npx tsc --noEmit` | 0 errors |
| Backend tests | `cd backend && pnpm test` | 342/342 pass |
| Frontend typecheck | `cd frontend && npx tsc -b` | 0 errors |
| Frontend tests | `cd frontend && pnpm test` | 532/532 pass (42 files, incl. rewritten pod suites) |
| Build | `make build` | succeeds (BUILD_EXIT=0, vite built in 51.34s) |

## §9 coverage table

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| SIL-696: approved lift+toll both enter trip direct cost, total matches approval screen | API VERIFIED + UI DRIVEN (trip page cost card) | `sil-696_api-dry-reread.log`, `sil-696_ui-trip-cost-310k.png`, `sil-696_ui-driver.json`, unit test | Profitability report panel screenshot not captured (same totalCost source); EXTERNAL-carrier trips not exercised (driver costs are xe-nhà only by guard) |
| SIL-697: thiếu file → không nộp nháp, thông báo rõ | UI DRIVEN | `sil-697_ui-3-blocked-toast.png`, network log 0 requests, DB: submission stayed DRAFT | iOS/native webview not driven (same SPA) |
| SIL-697: đủ file → nộp + hoàn thành thành công | UI DRIVEN | `sil-697_ui-4-completed.png`, DB: submission 37 SUBMITTED (2 types), trip 40 COMPLETED | Reviewer accept/reject path of POD not exercised |
| BE submit gate refuses incomplete draft | API VERIFIED | `sil-697_be-gate.log` (409, both types named) | — |

## Not touched (lane scope guards)

- Debit-note lines builder (SIL-693 lane), settlement pair logic, dispatch close
  (sibling lanes), shipments form — untouched.
- `trip_financial_state` rows of QA trips 575/576/40/24/759 carry lane test data
  (QA-696 fee names) on the shared dev DB — dev-seed only, no staging/prod contact.
