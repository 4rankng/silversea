# Wave4 staging verify — 4 landed fixes (build 11720424)

Date: 2026-10-17 21:40 +0800 · Target: STAGING `https://vantai.tingting.vip`
(the Makefile "demo server": `DEMO_SERVER := vantai.tingting.vip`; prod
`silversea.tingting.vip` untouched, no prod contact in this run). STAGING ONLY.

Fixes under test (all landed on main before this run):

| # | Card | Fix / merge |
|---|---|---|
| 1 | 171026154000 | cargoMode filter for dispatch-detail-plan-rows + Loại hàng select (`b930be12`) |
| 2 | 171026121100 (FB-038/072 verify-fail 3) | container-less holder LEFT-join + date-only completed-trip claim (`9d109c0d`) |
| 3 | 171026142500 | Cước trả ĐV: group-cost money applied at issue (`990b93c4`) |
| 4 | 171026182554 | bỏ nút Thêm/Xóa container ở màn Chi tiết + tờ khai lưu đồng bộ (`11720424`) |

Driver: `qa/2026-10-17_wave4-verify/driver.mjs` (phases health → recon → c1 →
c2 → restore → c3 → c4setup → b2final/b2reassign → teardown → census) and
`ui-drive.mjs` (rung-3 drives). Full logs: `driver.log`, `ui-driver.log`;
state: `state.json`; evidence: `evidence-c1.json`, `evidence-c3.json`,
`evidence-c4-declaration.json`; purge logs: `qapurge-dry.log`, `qapurge.log`.

## Health gate + build-pin correction (read before the results)

The mission pin said *"build f3a2ec5d at https://demo.tingting.vip/api/health"*.
The literal gate holds — that vhost reports `{"status":"ok",…,"version":"v1.2.0",
"build":"f3a2ec5d","env":"production","startedAt":"2026-10-16T04:06:30.964Z"}`
(`driver.log`, phase `health`). **But demo.tingting.vip cannot carry the wave4
fixes** and was not driven:

1. Its FE bundle `/assets/index-C3pA_65Z.js` contains **0 occurrences of
   `cargoMode`** — the wave4 case-1 filter code is absent.
2. Its health payload shape (`version/build/env/startedAt`) never existed in
   this repo — `backend/src/index.ts` has always emitted
   `{status, timestamp, buildHash}`; `startedAt` (2026-10-16T04:06Z) predates
   all four fix merges (2026-10-17 16:12–19:48 +0800).
3. `grep demo.tingting.vip` across the repo: zero references. The repo's staging
   is `vantai.tingting.vip` (`make demo`, `testaccounts.txt`, both template
   reports, `make qapurge`'s server). Both hostnames resolve to the same
   staging server `167.172.76.214` (prod = `143.198.214.217`), so the stale
   vhost is a second deployment on the staging box — `env: "production"` is its
   own stack's label, not the prod server.

`vantai.tingting.vip/api/health` → **`buildHash 11720424`** = main HEAD = the
four wave4 merges (`DEPLOY_BUILD_HASH = git rev-parse --short HEAD` at deploy);
its bundle `/assets/index-CrgeJcB4.js` carries `cargoMode` (6 occurrences).
This run therefore verified **staging buildHash 11720424** (superset re-pin of
the mission pin, same acceptance precedent as the W4b build-pin table). Health
gate + both bundles are captured in `driver.log` (`phase health`, 3/3 PASS).

## Fixtures (governed API only; every write carried an Idempotency-Key)

Fixture tag `QA-W4-*` on every name/BL/plate/reference (carrier customers
`QA-W4 BX2 *`, lots `QA-W4C2*/C3*/C4*`, pricing `QA-W4 pricing *`, plates
`QA-W4OV-*`, trip refs `QA-W4C2B-*/QA-W4B2F-*/QA-W4B2R-*`).

| Row | Id | Name / key | End state |
|---|---|---|---|
| carrier customers | 97, 98, 99 | QA-W4 BX2 * | soft-deleted (product DELETE) |
| c3 carrier customer / customer | 103, 104 | QA-W4 BX / QA-W4 KH 6FF775 | soft-deleted |
| supplier | 36 | QA-W4 NCC 6FF775 (CARRIER) | soft-deleted |
| route | 24 | QA-W4 TUYEN 6FF775 | soft-deleted |
| carrier_route_pricing | 5, 6 | generic 5,000,000₫ + vendor 4,500,000₫ (route 24 × 2.5T, eff. 2026-10-01) | hard-deleted (product DELETE) |
| staged lots | 863–890 (18 lots, incl. c3 trio 883–885, c4 lot 890) | QA-W4C2*/C3*/C4* | soft-deleted (product DELETE; verified `deleted_at` set) |
| c4 containers | 475, 476 | QAWA4700011 / QAWB4700021 (ISO 6346-valid) | hard-deleted by registry `make qapurge` |
| QA trips | 210, 213–219 | truck 39 / truck 9, refs QA-W4* | CANCELED via product path, then registry-scrubbed (trips are never hard-deleted — financial-history law) |
| pre-existing repro rows | ff 198/199 (fulfillments of lot 298) | FB-038-03A shape | mutated during drives, **restored**: plate null, carrier OWN (only fulfillment version churn 11→20) |

Chain in brief: catalog (vehicle class 2.5T read-only) → masters (supplier↔
carrier customer, plain customer) → pricing lane → 3 LCL lots (born-ready
fulfillments) → cost-group assign → 3 dispatch-order trips → debit board; c2
side-chain: staged LCL claim lots + date-only/trip-lifecycle probes; c4
side-chain: FCL lot + 2 containers + declaration write. Teardown: product
deletes → `make qapurge-dry` + `make qapurge` (registry `deleted=80`,
exit 2 = pre-existing guarded skips — see Residuals) → census 0 live QA-W4
rows (`driver.log` phase `census`).

## Verdict

**PASS 4/4 fixes verified on staging build 11720424**, one scoped partial
(date-only completed-trip claim = rung 1 + deployed suite, staging cannot stage
that exact shape through governed APIs — Residuals #1).

| # | Claim | Verdict | Rung | Key evidence |
|---|---|---|---|---|
| 1 | cargoMode filter reaches the API and filters page 1 (LCL reachable) | PASS | 2 DB/API VERIFIED | `driver.log` c1 13/13: `?cargoMode=LCL` total=26, page-1 26/26 LCL (card's repro had LCL only on pages 2–3); FCL 50/50; omitted unchanged (76/76); `?cargoMode=XXL` → 400 `cargoMode không hợp lệ.`; counts partition filtered totals; LCL/FCL filter totals == unfiltered scan (26/50) |
| 1b | "Loại hàng" select in quick filters drives the request | PASS | 3 UI DRIVEN | Bộ lọc dialog shows `Loại hàng: Tất cả`; pick `Hàng lẻ (LCL)` → network request `…&cargoMode=LCL`; button state `Loại hàng: Hàng lẻ (LCL)`; `…_ui-c1-loaihang-before/lcl.png`, `ui-driver.log` C1 |
| 2a | FB038-03A same-lot container-less double-plate is NEVER silent (LEFT-join holder claim) | PASS | 2 DB/API VERIFIED (exact staging repro rows) | ff 198 save 200; ff 199 same plate/same day → **409 `RIG_OVERLAP_COMPLETED`** "Đầu xe QA-W4OV-* đã được gán cho **container khác của lô này** trong khung giờ trùng lặp. **Vẫn lưu?**"; confirm retry 200 (no hard block) — pre-fix this exact shape saved silently |
| 2b | Trip 117 (BLCUSa24BB) family: claiming its rig-day warns, never silent | PASS | 2 DB/API VERIFIED | plan-row claim of 15H-061.14 on 2026-10-04 → 409 `RIG_OVERLAP_COMPLETED` "…đã được gán cho lô/tác vụ khác…" (warn-once, way on); "Phân xe lại" repro (`PATCH /trips/:id/reassign`, FB038-03B's own flow) onto truck 39 same day → 409 `RIG_OVERLAP_COMPLETED` + confirm retry 200 (`driver.log` c2 B1 + `b2reassign` 4/4) |
| 2c | Date-only COMPLETED trip claims its display day (Gap-B law) | PARTIAL | 1 CODE-READ ONLY + deployed suite | deployed scan block ships in build 11720424 (land-time suite `dispatch-overlap-day-only-trips.test.ts` / `trip-overlap-warning.test.ts` green); staging cannot stage a date-only COMPLETED trip via governed APIs (Residuals #1) — attempts logged |
| 3 | Gán xe nhóm BEFORE phát lệnh → group money lands on the trips the issue creates | PASS | 2 DB/API VERIFIED | card's exact scene on staging: 3 LCL lots (trip-less) → cost-group (2.5T + QA carrier) → 3 real `POST /shipments/:id/dispatch` → `trip_carrier_info.external_freight_cost` = **4500000 / 0 / 0** (vendor price wins generic); debit board `tra.cuocTraDv` = **4500000 / 0 / 0** (no "Thiếu cước trả ĐV"); `evidence-c3.json` |
| 4a | Detail screens carry NO add/remove-container buttons | PASS | 3 UI DRIVEN | `/shipments-detail?dateScope=all` @1440 + @390: 0 `Thêm container cùng lô…`, 0 `Xóa container…`, no add-container form, 72 sibling cell editors intact; `/shipments/890`: `Containers (2)` heading, 0 `Thêm container`; `…_ui-shipments-detail-1440/390.png`, `…_ui-shipment-detail-890-1440.png` |
| 4b | Tổng quan drawer keeps Thêm/Xóa container (no over-removal) | PASS | 3 UI DRIVEN | `/shipments` search QAWA4700011 → drawer: `Thêm container` + `Xóa container QAWA4700011`/`QAWB4700021` present; `…_ui-overview-drawer-1440.png` |
| 4c | Tờ khai lưu đồng bộ | PASS | 3 UI DRIVEN | docs cell on fixture cont QAWA4700011 → type `QA-W4-TK-1534ED` → `Lưu chứng từ và hãng tàu` → API shows the number on **both** containers (auto-copy to empty sibling = lưu đồng bộ); `evidence-c4-declaration.json`, `…_ui-c4-declaration-saved.png` |

UI driver: `ui-driver.log` (EXIT 0). API driver: `driver.log` (final phases
0 failures).

## Coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| cargoMode filter contract (1) | DB/API VERIFIED | `driver.log` c1 + `evidence-c1.json` | ACCOUNTANT-scope redaction of the filtered view (filter rides shared RBAC) |
| Loại hàng select (1b) | UI DRIVEN | `ui-driver.log` C1 + 2 screenshots + request capture | 390px click-through of the dialog (house FilterBar fold engine unchanged) |
| FB038-03A same-lot claim (2a) | DB/API VERIFIED on the exact repro rows | `driver.log` c2-1..3 | FE confirm-dialog click (the API warn/confirm contract is the law under test; dialog rendering is pinned by landed FE tests) |
| Trip-117 rig-day warn incl. "Phân xe lại" (2b) | DB/API VERIFIED | `driver.log` c2-B1 + `b2reassign` | `/trips/:id/edit` form (Điều vận RBAC blocks that surface — FB038-03C owner note still open) |
| Date-only completed claim (2c) | CODE-READ ONLY | deployed scan block + land-time suite pins; attempt log | No staging execution of this exact shape possible via governed APIs (Residuals #1) |
| Group-cost money at issue (3) | DB/API VERIFIED | `driver.log` c3 + `evidence-c3.json` (trip_carrier_info + debit-board API) | Kế toán UI rendering of the "Thiếu cước trả ĐV" column (values proven at the board service the column reads) |
| Container buttons removed / kept (4a/4b) | UI DRIVEN | `ui-driver.log` C4.1–C4.4 + 4 screenshots + API identity of lot 890 | Other roles than CUS for these surfaces (local card run also CUS); `/shipments/:id` as ADMIN |
| Tờ khai lưu đồng bộ (4c) | UI DRIVEN | `ui-driver.log` C4.2 + `evidence-c4-declaration.json` (API before/after side effect) | READ_ONLY declaration-access modes (accounting lock path) |

## Residuals / anomalies (none blocking)

1. **Date-only COMPLETED-trip staging is unreachable via governed APIs** — the
   governed close-maker (`POST /trips/:id/complete`, ACCOUNTANT/CUS) hard-
   requires an evidence photo + saved e-POD (422 observed); the staff
   `complete-external` close requires a fulfillment-linked trip (403
   "Chuyến không thuộc tác vụ điều xe đã chỉ định"), and fulfillment-linked
   trips can only be created with planned timestamps (`fulfillmentDispatchSchema`
   requires them); no endpoint nulls planned times on an existing trip. Result:
   2c rides the deployed code + its landed regression suite only. Owner may
   want a test-only seeding path or an explicit fixture ritual for this shape.
2. **Trip 117 has planned timestamps today** (10:30–13:52 on 2026-10-04, DB-
   verified) although the FB-038-03B write-up describes it date-only — the
   named entity's shape drifted after the original repro. Its claim family is
   still covered by 2b; the date-only sub-shape is residual #1.
3. **Warn tier attribution on trip 117's day**: the first warn on 15H-061.14 @
   2026-10-04 reads "…đã được gán cho lô/tác vụ khác…" (cross-lot/holder tier —
   trip 117's own plan-row claim fires first), not the completed-tier sentence
   "…chuyến đã hoàn thành…". Same warn-once contract
   (`RIG_OVERLAP_COMPLETED` + `Vẫn lưu?` + confirm flag); the completed-tier
   sentence is pinned by the landed suite instead.
4. **`make qapurge`/`qapurge-dry` exit 2** = pre-existing guarded skips
   (QA-PURGE-INCOMPLETE), the sanctioned non-fail: registry `deleted=80`,
   `remaining=38` = earlier-wave rows (treasury_accounts/business_units
   deactivations, operational_sites/ports scrub remainders, 2 pre-existing
   hard-delete-guarded containers, 2 scrub-only shipments, historical QA rows
   already soft-deleted). None are QA-W4 rows — post-purge DB census: 0 live
   QA-W4 customers/lots/containers/plan rows; QA trips scrubbed (`driver.log`
   + `qapurge.log`).
5. **FF 198/199 fulfillment version churn 11→20** from the overlap drives;
   business state restored exactly (plate null, carrier OWN, lot 298 untouched).
6. **Canceled QA trips remain as rows** (trips are never hard-deleted by
   product or registry — financial-history law), scrubbed of QA references by
   the registry. Same sanctioned end state as FB-061's trip 188.
7. **The mission pin `demo.tingting.vip / f3a2ec5d`** is a stale-vhost/foreign-
   stack pin (evidence above). Owner may want to retire that vhost or fix the
   pin pipeline so future waves do not verify against a deployment that lacks
   the code. The literal gate ("health returns f3a2ec5d") was recorded as PASS
   before any driving, per the mission.

## Environment

Staging `vantai.tingting.vip` (server 167.172.76.214) @ `buildHash 11720424`;
accounts: `dungnv` (DISPATCHER), `admin`, `hoapt` (ACCOUNTANT), `cus` (CUS) —
`testplan/testaccounts.txt`; fixture lot 890 (`QA-W4C4-5A42F0`, cont
QAWA4700011/QAWB4700021), lot 298 ff 198/199, trip 117 (BLCUSa24BB) as named
in the mission. Product: build hash via `GET /api/health`; catalog provenance:
vehicle class `2.5T` (`/api/vehicle-size-classes`), bootstrap route/cargo/
container types (`GET /api/catalogs/bootstrap`).
