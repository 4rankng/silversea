# Case QA-2026-09-28-10 — "Bỏ xe công ty" on the customers screen (card 20260928_177)

- **Case ID:** TC-CUST-DEBT-177
- **Ticket:** 20260928_177 (customer debt summary — own-vehicle vs external carrier)
- **Owner (implement):** backend + frontend
- **Owner (verify):** qa
- **Reported:** 2026-09-28, PM spec (`20260928_chi-phi-PM-spec.txt`, "TỔNG HỢP CÔNG NỢ KHÁCH HÀNG"):
  company vehicles are tracked as a normal carrier code, and at month-end the accountant
  ticks "Bỏ xe công ty" so the reconciliation only covers real customers.
- **Status:** PREP — server + data layer landed, the toggle's `UI DRIVEN` rung is still open.

## Why this case exists

The card's blocking finding (verified at HEAD before the fix): `/customers` had **no
per-shipment own-vs-external dimension**, so a UI-only tick would have silently produced a
wrong number. The dimension now comes from the server, and the figures are recomputed
server-side, so the exported sheet matches the screen.

**Source of truth for ownership (verified, not assumed):** `trip_carrier_info.carrier_type`
∈ `('OWN','EXTERNAL')` — the same axis the Chọn Debit settlement (`carrierKey === 'OWN'`),
the accounting transport register (`ownership` filter → `eq(trip_carrier_info.carrier_type,
…)`) and the P&L (`ownTrips` / `extTrips`) already use. `'OWN'` is the accounting vocabulary
for "xe nhà"/company vehicle (`CARRIER_TYPE_LABELS`).

## Acceptance criteria

### TC-CUST-DEBT-177-A — the tick removes exactly the own-vehicle portion

- **Given** a signed-in `admin` (or `ACCOUNTANT`) on local `http://localhost:7175/customers`,
  with at least one customer whose shipments ran on both a company vehicle and an external
  carrier.
- **When** the API is called with and without `excludeOwnFleet=true`:
  `GET /api/customers/debt-summary?customerIds=<A>,<B>` and `…&excludeOwnFleet=true`.
- **Then** `totals.freightRevenue(ON) === totals.freightRevenue(OFF) − totals.ownFleetFreightRevenue(OFF)`
  for revenue, payable and trip count; each line carries `ownership` + `carrierKey`, and
  `carrierKey === 'OWN'` if and only if `ownership === 'OWN'`.
- **Assert:** `qa/scripts/customer-own-vehicle-probe-20260928.mjs` prints `CHECK ON == OFF -
  ownFleetPortion: true`.
- **Evidence:** probe log (`qa/2026-09-28_customer-own-vehicle_api-probe.log`), both JSON bodies.
- **Rung:** DB/API VERIFIED.

### TC-CUST-DEBT-177-B — unticking returns exactly the original number

- **When** the same call is made with `excludeOwnFleet` absent.
- **Then** the figures equal the pre-tick call byte-for-byte, and `filter.excludeOwnFleet` is
  `false` with the param absent from the URL (never `=false`).
- **Assert:** the probe prints both bodies; the OFF body is the reference for TC-A's subtraction.
- **Evidence:** same probe log.
- **Rung:** DB/API VERIFIED.

### TC-CUST-DEBT-177-C — a customer with no own-vehicle shipment is unchanged

- **Given** a customer whose shipments all ran on external carriers.
- **When** both calls above run.
- **Then** that customer's row (trip count, revenue, payable, own-vehicle sub-totals) is
  identical in both responses.
- **Assert:** the probe prints `CHECK customer B (no own-vehicle leg) unchanged: true`.
- **Evidence:** same probe log.
- **Rung:** DB/API VERIFIED.

### TC-CUST-DEBT-177-D — the tick is a real control that maps to the server filter (UI)

- **Given** `admin` on `/customers` (local or staging).
- **When** the `Bỏ xe công ty` chip in the filter strip is tapped (real pointer tap:
  move → down → up at hit-tested coordinates) with data on screen.
- **Then** the `Cước thu / trả` column changes to the server's filtered figures for every row
  (visible number change, not just a chip state), the network panel shows
  `excludeOwnFleet=true` on `GET /api/config/customers/debt-summary`, and tapping again
  restores the original numbers.
- **Assert:** post-tap screenshot + the request URL from the network log + the post-tap DOM text.
- **Evidence:** `qa/<date>_customer-own-vehicle_ui-<step>.png`, driver log, request log.
- **Rung:** UI DRIVEN — **not yet taken** (owned by the browser lane).

## Out of scope

- The VAT / kỳ theo dõi columns of the PM's summary table — those read from the debit table
  (card 20260928_175, QA_PASSED) and are the next card's business.
- The aging `DebtListPage`, the customer ledger AR (`buildCustomerDebtMap`), and the
  suppliers/as-carrier surfaces — untouched.
- Server-side list filtering of customer ROWS (the PM's "ngắn gọn hơn" list; today the tick
  changes each row's figures, it does not remove rows from the paginated list).

## Regression fences (in-repo)

- `backend/src/tests/customer-debt-summary.test.ts` — 4 cases: the pure arithmetic (ON = OFF −
  own portion, OFF restores, no-own-vehicle customer unchanged, key/ownership invariant) and a
  DB-backed case that reads a real own-fleet truck leg + a subcontracted leg + a shipment-level
  freeze off `trip_carrier_info` / `trips` / `freight_rate_snapshots`.
- `frontend/src/pages/customer-debt-projection.test.ts` — 5 cases: the tick maps to the server
  query param (`ON` present, `OFF` absent), and the rendered figures are the server's own
  numbers with no local subtraction.
- `frontend/src/pages/CustomersPage.sort|keyboard|mutation-errors.test.tsx` — the page still
  mounts and behaves with the new projection request in place.

## Gates

- FE: `npx vitest run src/pages/customer-debt-projection.test.ts` → 5/5;
  `CustomersPage.{sort,keyboard,mutation-errors}` → 10/10; `npx tsc -b` → 0.
- BE: `npx tsx --test --test-concurrency=1 src/tests/customer-debt-summary.test.ts` → 4/4;
  `npx tsc --noEmit` → 0.
