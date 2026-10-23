# QA Evidence — LCL-01 lan 2: overview/detail không đồng bộ (card 211026180528)

- **Date:** 2026-10-21 (QA round 18:05, build `9aab78d2` — confirmed live via `/api/health`)
- **Branch:** `fix-lcl01-lan2` (off main `9aab78d2`), worktree `1njkloyy/fix-lcl01-lan2`
- **Staging access:** READ-ONLY (GET + login only) — `https://vantai.tingting.vip/api`

## 1. Finding the QA lot (step 1 — staging diff probe)

`stg-probe.log` — for EVERY account (tiepvv, thanhdc, anhdtv, huyenntt, anhntn, admin) the
probe fetched ALL pages of both screens' actual list queries and diffed shipment ids:

- Tổng quan `/shipments/cus-workspace` (no default date scope): 125 lots (6 LCL, 1 nullMode)
- Chi tiết `/shipments/cus-workspace/containers?transportDateFrom=To=<vnToday>` (default lens): 6 rows
- Chi tiết bare (no dates): 187 rows / 125 shipments

Result: **exactly ONE lot on Tổng quan missing from Chi tiết's default lens — lot 133
(`SHP-2610-00069`)**. All 6 containerless LCL lots pass (lan-1 fix holds on staging).
Lot 133 enters detail-bare via its 2 container rows (rowSource passes) but is dropped by
the default day lens.

## 2. The lot's shape + why QA had it (step 2)

`stg-audit-window.log` (audit API, read-only) + `stg-lot-shp261000069.json`:

- **17:09+07** — `SHIPMENT_CREATED` by **Vũ Văn Tiệp** (tiepvv): `POST /api/shipments`
  body minimal `{customerId:1}` → cargo_mode **NULL**, status PENDING_DATE, no EDD,
  no Bill/Booking (2 earlier MUTATION_REJECTED attempts = form validation fight).
- **17:11+07** — `SHIPMENT_CONTAINERS_UPDATED` `/api/shipments/133/containers`:
  2×type-1 (20') containers, no appointment. (QA's `containerNo` key was stripped by
  the schema — the staging rows 199/200 ended up number-less; immaterial to the bug.)
- The lot is QA's DRI-03 kẹp fixture (owner addendum confirms); the 18:05 LCL-01 wedge
  is the same lot — the only overview/detail asymmetry on staging.
- **Card filed 18:05:28** (`211026180528`).

Shape vs the already-fixed lan-1 case:

| | lan-1 (fixed 454fab6b) | lan-2 (this card) |
|---|---|---|
| cargo_mode | LCL | **NULL** |
| containers | none (containerless) | **2×20' present** |
| appointment | — | **none** |
| lot EDD | any | **null** |
| triage day `coalesce(appt, EDD)` | (exempt arm by identity) | **NULL → no range can match** |

## 3. Root cause

`containerDayTriageCondition` (`cus-workspace-sql.service.ts`) exempted only
container-**less** LCL rows. A row WITH containers whose triage day
`coalesce(container.appointment, shipment.EDD)` is NULL (intake skeleton) matched no
date arm and was dropped from every day lens while Tổng quan (no default date scope)
listed it — same "no day it could match" defect class, one shape further.

## 4. Fix

`containerDayTriageCondition` gains a third OR arm: `isNull(containerTransportDateSql())`
— every row with NO triage day rides outside the day filter, whatever its cargo shape.
Containerless-LCL arm (lan-1) kept: a dated lot row's day = its EDD (non-null) and lot
rows are not day-gated. Dated container rows keep the full dateArms triage. Side effect:
the board's nulls-first sort arm (`case when day is null then 0 …`) is finally reachable —
unscheduled rows surface at the top, mirroring the overview's priority queue.

## 5. Local BEFORE/AFTER (step 4 — seed QA shape → 2 screens)

`testplan/qa/scripts/2026-10-21-lcl01-lan2-repro.mjs` on backend :3016 (worktree, dev
DB :5441). Seeds through the REAL APIs exactly how QA did: minimal `POST /shipments
{customerId}` + `PUT /:id/containers` (2×20', ISO numbers), plus the two lan-1 shapes
(containerless LCL undated/dated-2099) as regression controls.

- **BEFORE** (fix stashed, lan-1 code): `local-repro-BEFORE.log` — stamp 973827:
  skeleton on Tổng quan ✓, on Chi tiết bare ✓, **MISSING on Chi tiết default lens ✗**
  (FAIL R2 + FAIL INVARIANT, failures=2). Lan-1 shapes PASS (baseline intact).
- **AFTER** (fix applied): `local-repro-AFTER.log` — stamp 017205: **8/8 PASS,
  failures=0** — skeleton rides the default lens; lan-1 shapes unchanged.

## 6. Gates (verbatim logs in this dir)

| Gate | Result | Log |
|---|---|---|
| `cd backend && npx tsc --noEmit` | 0 errors | `gates-be-tsc.log` |
| Scoped query-service unit tests (4 files incl. triage) | 35/35 | `gates-be-scoped-tests.log` |
| `cd backend && pnpm test:unit` | 347/347 | `gates-be-unit-full.log` |
| `cd backend && pnpm test` | 335/335 | `gates-be-test-full.log` |
| `pnpm lint` (root) | 0 | `gates-root-lint.log` |

Unit pins (`backend/src/tests/unit/cus-container-day-triage.test.ts`, 6 tests): lan-1's
3 render pins unchanged + 3 new pins for the null-day arm (arm present, no range
conjunct on it, three-arm OR order lot-LCL → null-day → dateArms).

## 7. Verification coverage (§9)

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Card 211026180528: lot on Tổng quan missing on Chi tiết (staging, build 9aab78d2) | DB/API VERIFIED | `stg-probe.log` (only drop = lot 133, all 6 accounts); UI not driven | QA's actual browser session (we inferred the lot by exhaustive API diff) |
| QA lot identity = 133 / SHP-2610-00069, created 17:09 by Vũ Văn Tiệp | DB/API VERIFIED | `stg-audit-window.log` (SHIPMENT_CREATED 10:09:44Z + containers 10:11:30Z), `stg-lot-shp261000069.json` | card .docx text (GDrive unreadable, scope per brief) |
| Root cause: null-day container rows dropped by day triage | DB/API VERIFIED (BEFORE repro on local, same code path) | `local-repro-BEFORE.log` FAIL R2+INVARIANT | staging itself not re-driven pre-fix (read-only mandate) |
| Fix: null-day rows ride outside day triage (QA shape) | DB/API VERIFIED (AFTER repro) | `local-repro-AFTER.log` 8/8 PASS, failures=0 | FE click-through 390/768/1440 (query-level fix; brief gates API evidence); staging post-deploy re-verify (owner-controlled deploy) |
| Lan-1 shapes no regression (containerless LCL dated/undated) | DB/API VERIFIED + unit | AFTER log R3 PASS ×2; triage test 3 lan-1 pins | — |
| Addendum probe: SHP-2610-00069 shape on staging (read-only) | DB/API VERIFIED | `stg-lot-shp261000069.json` (containers 199/200, typeId 1, appointmentAt null ×2); `/shipments/SHP-2610-00069` by code → 400 (route takes numeric id only — used `/shipments/133`) | — |

## 8. Environment notes

- Staging probe mutated NOTHING (GET + login only); QA owns dispatching lot 133 (DRI-03).
- Local seeding left QA-tagged lots `LCL01L2-*` (ids 312411–312424) in dev DB :5441
  (lane precedent: lan-1 repro lots were also left; `pnpm db:sweep-fixtures` cleans QA tags).
- Backend :3016 was a spare-port instance of THIS worktree (main checkout's :3002 untouched);
  it has been shut down.
