# FB-061 R2 (card 141026012010) — the board READ was never guarded; only the purge was

## Repro (admin, staging, `/accounting/phoi-phieu` → *Kiểm soát phơi phiếu*)

Factory `KHO-SEAM-1789702634486`, carrier `STG VERIFY NHA XE 09`, customer
`QA0915 QA-138 Credit Customer`, bills `BL-QAKE-<epoch>`, `E2E-*`, plates
`99T-99999` / `51K-PROBE*`, driver `Test Driver R15`. Verified FAIL on every
wave since round 16 (card `4f4a3b57e`).

## Root cause

Round 16 gated the demo SEEDERS and gave the class a purge registry
(`backend/src/seed/qa-fixture-registry.ts`, run by `make qapurge`). Both are
*write-side* controls. `listPhoiPhieuRows` — the production-facing read — had
no filter at all, so a fixture row written between purges rendered immediately
and stayed until someone remembered to purge again. The card re-verified as
FAIL for exactly that reason, wave after wave.

The two sides also drifted: `QA_TRIPS_SQL` still carried the pre-FB-061
shipment list, so `make qapurge` soft-deleted a `BL-QAKE-*` / `E2E-*` shipment
while leaving its trips behind.

## Fix

**One owner for the signatures** — `backend/src/services/qa-fixture-markers.ts`.
`listPhoiPhieuRows` filters on it; the purge registry GENERATES its predicates
from it instead of restating them. Shipment references (`QA%`, `BL-QAKE%`,
`E2E-%`, `CARD226-QA-%`, `BILL-QAC1%`), QA notes, factory/site names
(`QA%`, `KHO-SEAM%`), probe plates (`99T-99999`, `51K-PROBE%`), QA person names
(`Test Driver%`), the `STG VERIFY%` carrier family, and the run-scoped epoch
signature every QA lane's `<purpose>-<epoch>-<rand>` naming produces
(`-[0-9]{10,13}$`, `-[0-9]{13}-`).

Two properties the naive card text would have broken:

- **NULL never matches.** Each comparison reads `coalesce(col, '')`. A plain
  `NOT (col ILIKE …)` is NULL for an absent optional column and would silently
  drop every real row whose factory/driver/party is empty.
- **No bare `NHA XE`.** The live roster carries real carriers such as
  `CÔNG TY TNHH VẬN TẢI NHA XE BIEN BAC`; a bare phrase marker would hide live
  payable rows. The fixture family is `STG VERIFY%`.

Scope: the board only. `getPhoiPhieuReport` is an audit surface and keeps
reporting every row, deleted masters included (ruled by the soft-delete-leak
case).

## Test-fixture consequence (deliberate)

`phoi-phieu-control.test.ts` used `QA-A-…` / `QA172A-…` plates for its
grouping fixtures. `QA%` has been a declared fixture signature since the purge
registry landed (it soft-deletes `QA%` plates), so the board's own fixtures
were wearing a signature the board hides. Renamed to the neutral `C16…` / `C172…`
families; the properties under test (adjacency by plate, window SET invariance)
are unchanged.

## Pin

- `backend/src/tests/phoi-phieu-fixture-marker-filter.test.ts` — 5 cases: three
  negative (bill/booking families, probe plates/drivers, factory/carrier/QA
  customer), two positive controls (a clean lot stays listed; a REAL carrier
  named `… NHA XE BIEN BAC …` keeps its row).
  Verified failing-before: with the filter disabled the 3 negative cases fail
  and both positive controls still pass.
- `backend/src/tests/unit/qa-fixture-marker-sql.test.ts` — 5 pins on the
  signature owner, including the `QA_TRIPS_SQL` drift and the forbidden bare
  `NHA XE`.