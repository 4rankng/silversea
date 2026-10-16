# FB-061 staging verify — soft-deleted masters leak fix (build 9aedd95a)

Date: 2026-10-16 · Target: STAGING https://vantai.tingting.vip (production untouched)
Fix under test: `af357f33` / merge `9aedd95a` — soft-delete predicates on every
customers/suppliers join in `phoi-phieu-control.service.ts` (board rows, money
report THU/TR A, deposit lookup).
Driver: `qa/2026-10-16_fb061-verify/driver.mjs` (phases: setup → live → delcust →
readcust → flip → delsup → cleanup → census). Full check log:
`qa/2026-10-16_fb061-verify/driver.log`; purge log:
`qa/2026-10-16_fb061-verify/qapurge.log`; state: `state.json`.

Health gate: `GET /api/health` → `buildHash 9aedd95a` (expected 9aedd95a) ✓.

## Fixtures (all created via governed API, every write with Idempotency-Key)

| Row | Id | Name / key | End state |
|---|---|---|---|
| customer | 95 | QA FB061 KH FE48B9 | soft-deleted 2026-10-16 11:14:57 (product DELETE) |
| supplier | 35 | QA FB061 NCC FE48B9 | soft-deleted 2026-10-16 11:17:01 (product DELETE) |
| shipment | 618 (SHP-2610-00249) | bl QA-FB061-FE48B9 | soft-deleted 11:17:20 (registry `make qapurge`) |
| ops expense | 45 (source OPS-45) | fee QA FB061 EXP FE48B9, 50,000₫ | hard-deleted by registry (entry + source) |
| trip | 188 (TRP-202610-0089) | EXTERNAL carrier, plate QA-FE48B9-FB061 | CANCELED (product path; trips are never hard-deleted by product or registry) |
| trip_carrier_info | trip 188 | EXTERNAL/CUSTOMER→95, flipped to SUPPLIER→35 mid-test | row hard-deleted by registry (QA% plate) |
| deposit pointer | trip 188 | bill QA-FB061-CTY-97CBEE | nulled via product PUT after cancel |

## Per-case results

| Case | Verdict | Evidence |
|---|---|---|
| TC-1 Board EXTERNAL/CUSTOMER (LEAK-1) | PASS | pre: carrierName/customerName = "QA FB061 KH FE48B9"; post-delete: carrierName = "Đơn vị vận chuyển không còn trong danh mục", customerName null, plate `QA-FE48B9-FB061` + driver kept (driver.mjs delcust/readcust) |
| TC-2 Board EXTERNAL/SUPPLIER (LEAK-2) | PASS | guarded DB flip on own sidecar (UPDATE 1, guard trip_id+type+id+plate): live supplier name resolved; after product DELETE of supplier 35 → fallback text; plate/driver kept |
| TC-3 Money THU (LEAK-3) | PASS | live: bucket "QA FB061 KH FE48B9" = 50,000 soLuong 1; post-delete: QA name absent, "Chưa xác định" Δ = +50,000 (570,000→620,000), soLuong 3→4 — money kept reporting, never dropped |
| TC-4 Money TRA | PASS | live: bucket by name (CUSTOMER branch then SUPPLIER branch, both 50,000); post-delete: QA names absent, fallback-text bucket "Đơn vị vận chuyển không còn trong danh mục" = 50,000 (Δ+50,000 vs pre-fixture 0) |
| TC-5 Deposit dialog (đã nhận phơi) | PASS | PUT deposit (bet = lot 618) → GET: depositCustomerName "QA FB061 KH FE48B9"; after delete → null (dialog empty state), bet leg + bill intact |
| TC-6 Positive control (over-filter) | PASS | every live-master state resolved by name on all four surfaces (board, THU, TRA customer+supplier branches, deposit); pre-existing staging rows untouched (THU/TR A "Chưa xác định" baseline 570,000/3 stable) |
| TC-7 Cleanup census | PASS | board search QA-FB061 → 0 items; THU/TR A → no QA names, "Chưa xác định" back to 570,000/3 exactly; customers/suppliers catalog search → no hits; DB row states per table above |

Overall: **PASS — 7/7 cases, 60+ individual assertions green** (final pass per
phase; earlier log FAILs are the superseded 428 attempt and two driver-side
assertion bugs fixed mid-run — none product-side).

## Coverage (§9)

| Claim | Rung | Evidence | Not covered |
|---|---|---|---|
| Board fallback renders for deleted carrier masters (EXTERNAL/CUSTOMER + SUPPLIER) | DB/API VERIFIED | `GET /phoi-phieu/rows` row JSON (the API the board renders), trip 188 | Board UI pixel rendering not driven (no browser pass) |
| THU/TR A deleted-name exclusion + re-bucketing | DB/API VERIFIED | `GET /phoi-phieu/report` diffs above | PDF/export rendering not driven |
| Deposit dialog fallback | DB/API VERIFIED | `GET/PUT /phoi-phieu/188/deposit` | Dialog UI not driven |
| LEAK-2 supplier-typed sidecar | DB/API VERIFIED | sidecar flip is a guarded DB UPDATE on the fixture row only — no staff API writes EXTERNAL/SUPPLIER (all trip-create/dispatch paths hardcode 'CUSTOMER'); code-level coverage also pinned by regression `phoi-phieu-soft-delete-leak.test.ts` LEAK-2 | API-reachable supplier attachment does not exist to drive |

## Anomalies (none blocking)

1. Catalog DELETE requires `If-Unmodified-Since` (428 VERSION_TOKEN_REQUIRED
   otherwise) — the FE transport self-heals this by design (crud-factory
   comment); driver fetches updatedAt and retries. Not a defect.
2. `make qapurge` exits 2 (QA-PURGE-INCOMPLETE) on **pre-existing** guarded
   skips from earlier waves (11 ops entries held by live sources, 2 shipment
   containers, users/business units pinned by links, scrub-only surfaces).
   None are FB-061-verify fixtures; all rows created this session were purged
   and verified by id.

## Fixtures left behind: EMPTY

Every created row is in its sanctioned end state (see fixtures table):
3 hard-deleted (sidecar, expense entry, source), 3 soft-deleted (customer 95,
supplier 35, shipment 618), 1 canceled + fully scrubbed trip 188 (no sidecar,
no expenses, no deposit pointer; trips are never hard-deleted by any product
or registry path — financial-history law). Residual canceled-trip row is
invisible on board, both reports, and deposit surfaces (census-verified).
