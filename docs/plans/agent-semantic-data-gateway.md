# Agent Semantic Data Gateway — Consensus Plan (v2, re-baselined)

> **Status: `pending approval`** (ralplan output — NOT executed; no source edited, no commit/push)
> Owner: agent subsystem (`backend/src/services/agent/`)
> Date: 2026-06-27
> Iteration: v3 — re-baselined (Architect) then refined (Critic `ITERATE`). The gateway is **already
> ~70% built** as uncommitted work; v1 described work that is largely behind us. v3 incorporates the
> Critic's CRITICAL fix (report.run must delegate to existing `analyzers.ts` backing functions, not
> re-compute), the broadened audit criterion, the parity equality contract, the `data.meta` name pin,
> and acknowledged v1 limits.

---

## ⚠️ Top-line findings (read first)

1. **The gateway already exists, uncommitted.** `backend/src/services/agent/tools/data.ts` (6 tools:
   `data.meta/search/list/detail/aggregate/timeline`) + `semantic-data.service.ts` (663 lines,
   11 entities: trips, tires, trucks, trailers, drivers, customers, suppliers, expenses, ledger,
   penalties, debitNoteTemplates, auditLogs) are **on disk and wired** (`tool.registry.ts:21,28`).
   The orchestrator prompt (`orchestrator.ts:121-122`) **already** has the data-first rules the user
   asked for ("dùng data.search/… trước khi trả lời; ui.navigate chỉ mở trang, KHÔNG đọc dữ liệu").
   → This plan is therefore **harden + finish + retire**, not build-from-scratch.
2. **The "tire 136.31" failure mode is already fixed** by `data.search` + `data.detail`. The original
   motivation for the whole effort is addressed by code that is already written.
3. **Live correctness landmine, precisely scoped.** `semanticAggregate`
   (`semantic-data.service.ts:532`) is **not** free-form SQL — it enforces an explicit per-entity
   `aggregateMetrics` allow-list (line 535) and validates `groupBy`. The risk is *not* injection; it
   is that the allow-list is the correctness boundary and a naive `SUM(revenue|cost|profit)` ignores
   VAT asymmetry / service-margin double-count (real prior bugs). The correct money outlet —
   `report.run` — **does not exist yet**.
4. **Tool count went UP, not down.** The 6 gateway tools ship **alongside** the 45 narrow ones
   (51 advertised total). Coexistence is live. Retiring the narrow tools — gated on parity + finance
   safety — is the work that actually delivers the user's "12 tools, not 45" goal.
5. **The working tree is a moving target.** Files appeared/were deleted minute-by-minute during
   planning (`tire-query.service.ts` — an earlier prototype — was deleted and superseded by
   `semantic-data.service.ts` mid-session). There is parallel agent work in this tree. **Execution
   must reconcile with that work first** (see §0.1) before touching anything.

---

## 0.1 Reconciliation prerequisite (before ANY execution)
The tree carries heavy uncommitted parallel work (tour engine, MiniMax perf, this gateway). Before
the first execution step: (a) `git status` + confirm with the user which uncommitted pieces are
in-scope; (b) decide whether the gateway files are committed/stashed as their own unit; (c) never
`git add` foreign changes (project-memory rule). This plan assumes the gateway files are intended
work to be hardened in place. If they are throwaway, stop and re-plan.

---

## 1. RALPLAN-DR summary (revised)

### Principles
1. **Data before navigation.** ✓ Already encoded in the prompt (`orchestrator.ts:121`). Hold the
   line; don't regress.
2. **One semantic gateway, not one tool per page.** Gateway exists; the unfinished half is *retiring*
   the 45 narrow tools behind parity gates so the advertised surface actually shrinks to ~10.
3. **Determinism for money.** `data.aggregate`'s allow-list must **exclude** naive-`SUM`-unsafe money
   fields; all real money totals route through a new `report.run` that wraps **existing** deterministic
   services (VAT asymmetry, append-only ledger, service-margin — prior bugs).
4. **Harden before extending.** 663 lines + 6 tools shipped unreviewed. Review + finance-audit +
   parity-harness come *before* adding `report.run`/`kb.search` and *before* retiring tools.
5. **Registry is semantic, schema is structural.** Already true: `EntityDef.from` + `fields[].expr`
   are Drizzle SQL anchors; the registry hand-authors labels/search-fields/metrics. Keep it drift-proof
   (add an import-time validation that every `from`/field resolves against `db/schema.ts`).

### Decision drivers (top 3)
1. **Finance correctness** — the `aggregateMetrics` allow-list is one misconfigured entry away from a
   wrong P&L/debt figure. Highest-impact, lowest-effort fix.
2. **Deliver the "12 not 45" promise** — the gateway only pays off once the narrow tools retire; that
   needs a parity harness to do safely.
3. **Regression safety in a dirty, parallel-edited tree** — single-tenant prod, billing-blocked CI
   (manual deploys), demo-first is mandatory.

### Viable options (revised against reality)

| | **A — Harden + finish + retire (recommended)** | B — Approve the uncommitted gateway as-is | C — Rip out & rebuild per original v1 |
|---|---|---|---|
| What | Finance-audit `aggregateMetrics`; add `report.run`; code-review + parity harness; then retire narrow tools; defer `kb.search`/`ui.snapshot`/`action.*` | Merge the existing 6-tool gateway, leave the 45 narrow tools, ship | Discard the uncommitted gateway, rebuild from the plan |
| Pros | Closes the live finance risk; realizes the tool-count win; reuses existing services; honest about what exists | Zero new work | Clean ownership/authorship of the code |
| Cons | Must untangle parallel uncommitted work first | Leaves 51 tools; finance landmine ships; user's "12 tools" goal unmet | Throws away working, on-goal code; huge rework; slow |
| Risk | Medium (tree reconciliation) | **High** (silent finance bug in prod) | High (waste + delay) |

**Why A:** B ships a known finance risk and never delivers the consolidation the user asked for. C
discards 70%-correct, on-spec code. A is the only option that both closes the risk and meets the goal.

---

## 2. Current vs target (what exists, what's missing)

| Tool / piece | Status on disk | This plan's action |
|---|---|---|
| `data.search` / `data.detail` / `data.list` | ✅ built (`data.ts`, `semantic-data.service.ts`) | code-review; add parity tests |
| `data.aggregate` | ✅ built, **allow-listed but finance-unaudited** | **audit `aggregateMetrics` per entity; exclude naive-`SUM`-unsafe money fields; steer to `report.run`** |
| `data.timeline` / `data.meta` | ✅ built | code-review |
| `report.run` | ❌ **missing** | **build as a DELEGATING registry** — calls the *same* backing functions the `analyzers.ts` narrow tools already call (`getPnlReport`, `getReceivablesSummary`/`getCustomerAgingList`, `getFuelVarianceReport`, `listExpenses` — confirmed `analyzers.ts:7-10`). It is the generic money outlet that lets those analyzer tools **retire** in P3 — NOT a parallel money path. Drift-guard test asserts each entry invokes the same fn its analyzer tool did. |
| `kb.search` | ❌ missing | defer (Phase 3) |
| `ui.navigate` / `ui.focus` (+ highlight) | ✅ built | keep as-is |
| `ui.snapshot` | ❌ missing (needs frontend page-state contract) | defer (Phase 4) |
| `action.prepare` / `action.submit_confirmed` | ❌ missing | **defer** — mutations break v1 read-only; separate plan |
| 45 narrow read tools (`trips.ts`, `fleet.ts`, …) | ✅ still advertised (coexistence) | **retire** after each entity passes parity + finance gate |
| Data-first prompt rules | ✅ in `buildSystemPrompt` | keep; add `report.run` routing rule + a soft data-first net |

---

## 3. Phased plan (Option A)

### Phase 0 — Reconcile & review (no new features)
- Reconcile the uncommitted tree with the user (§0.1); confirm the gateway files are in-scope.
- **Pin the canonical tool name `data.meta`** (on disk) in the prompt + docs now — before P3 retirement
  touches the prompt (avoids `meta.schema` naming drift the Critic flagged).
- **Code-review** `data.ts` + `semantic-data.service.ts` (never reviewed; 663 lines): field projection,
  join correctness, **soft-delete handling** (most entities filter `deletedAt`; `ledger` + `auditLogs`
  are append-only and *intentionally exempt* — confirm each `EntityDef`'s soft-delete clause is right),
  role defense-in-depth (all 6 tools use `OFFICE_ROLES` + `defineReadTool`'s execute-time re-check at
  `tool.types.ts:78-104` — verified sufficient; no narrow tool restricts tighter, so no extra gate
  needed), SQL-injection safety of `buildWhere`/`buildFilter` (parameterized `escapeLike`).
- **Drift lint test (softened):** `EntityDef.from` values are hand-written SQL fragments
  (`trips t LEFT JOIN …`), not Drizzle table refs, so full `expr` resolution isn't cheaply testable.
  Instead assert every table name aliased in any `from` exists in `db/schema.ts`.
- **Acceptance:** review findings filed; drift lint passes; `tsc` clean (3 CI commands); backend `npm test` green.

### Phase 1 — Finance safety (the headline deliverable)
- **Audit `aggregateMetrics` per entity — broadened criterion (any metric where raw `SUM` lacks business meaning):**
  - naive-`SUM`-unsafe money: `revenue`, `cost`, `profit`, `debit`, `credit`, `margin`, `vat`, `salary`, `advance`;
  - **running balances** (SUM is meaningless): `ledger.balance` (verified `semantic-data.service.ts:364` lists `['credit','debit','balance']` — **remove `balance`**), any `*_balance`;
  - **caps/rates, not totals**: `customers.creditLimit` (a per-customer cap), `drivers.baseSalary` (a rate).
  Where such a field exists, its `aggregateMetrics` must omit it; `data.meta` should label it
  "dùng report.run cho số tiền/tổng".
- **Build `report.run` as a DELEGATING registry — single source of truth, do NOT re-compute.**
  `tools/reports.ts` + `reportRegistry.ts` map a stable report name to the **same backing function**
  the `analyzers.ts` narrow tools already call (confirmed `analyzers.ts:7-10,33-57,72,98`):
  `profit_and_loss`→`getPnlReport`, `receivables_aging`/`customer_debt`→`getReceivablesSummary`+
  `getCustomerAgingList`, `fuel_variance`→`getFuelVarianceReport`, `expense_anomalies`→`listExpenses`.
  report.run is the **generic money outlet that lets those analyzer tools retire in P3** — it calls
  those functions directly, never a parallel re-implementation. **Drift-guard test:** assert each
  report.run entry invokes the same function its matching analyzer tool invoked. Add entries only for
  services verified to exist (payables_aging / driver_salary / trip_profitability: confirm backing fns
  before listing; otherwise defer).
- Add the prompt rule: *"bất kỳ số tiền/tổng nghiệp vụ (doanh thu/lợi nhuận/công nợ/dầu) → report.run;
  KHÔNG bao giờ SUM tiền bằng data.aggregate."*
- **Acceptance:** `data.aggregate` on a forbidden metric returns a steer error, never a number (unit
  test per entity incl. `ledger.balance`, `customers.creditLimit`, `drivers.baseSalary`);
  `report.run('profit_and_loss', …)` ≡ `profit.breakdown` current-period output on the vantai seed DB
  (same backing fn → trivially equal); drift-guard test green.

### Phase 2 — Parity harness (enables retirement)
- New test with an **explicit equality contract** (so two implementers produce the same harness): for
  each retired narrow tool vs its gateway equivalent, assert **same id-set**, **same row count**, and
  **equal value for fields present in both** after normalization (dates → `YYYY-MM-DD`, numbers →
  coerced numeric, strings trimmed). Full field-set equality is explicitly NOT required — narrow
  `fleet.ts` and gateway `data.list entity:'trucks'` legitimately project different columns/order.
  Document the normalization inline.
- **Acceptance:** parity green (id-set + count + shared-field values) for trips/tires/fleet/drivers/
  customers/suppliers/expenses/ledger.

### Phase 3 — Retire narrow tools (deliver "12 not 45")
- Delete the narrow `*.ts` tools (and their registry imports) entity-by-entity as each clears Phase 2.
  Advertised count falls 51 → ~10.
- Keep `ui.*`, `tours.search`, the deterministic nets (`synthesizeNavigateFromProse`,
  `synthesizeStartTourFromResponse`).
- Optionally add `kb.search` (cheap substring + unaccent over `docs/flows/`, `docs/company-files/`;
  vector only if under-serves).
- **Acceptance:** advertised tools ≤ 10; no golden query regresses; telemetry invariants intact.

### Phase 4 (deferred, separate plans)
- `ui.snapshot` — new frontend page-state contract (drawer only sends `currentRouteKey` today).
- `action.prepare` / `action.submit_confirmed` — **mutations**; break v1 read-only. Own proposal with
  confirmation UI + audit + Casbin review. Not in read-only v1.

---

## 4. Acceptance criteria (testable, per phase)
- **P0:** review complete; drift-validation test passes (bad `from`/field fails the test); `tsc` (3
  cmds) + backend tests green.
- **P1:** forbidden money metric → steer error (unit test); `report.run` byte-parity with analyzer
  (integration test on seed DB); prompt contains the money-routing rule.
- **P2:** parity harness green for all covered entities.
- **P3:** advertised tool count ≤ 10; golden query set (incl. user's examples + finance ones) passes
  E2E via the socket `/agent` harness; no bare `/path` text for data-intent answers.
- **Global:** `agent_turn_metrics` still writes exactly one row per persisted turn; `reactIterations`,
  `toolCallCount`, latencies, abort/no-row rule intact.

## 5. Verification steps
1. Finance byte-parity: `report.run` ≡ analyzer on a fixed period, vantai seed DB.
2. Golden queries E2E via socket.io `/agent` (reuse the chatbot-perf-monitoring runtime harness).
3. Parity harness (§3 P2) for every retired narrow tool.
4. Static gates: `tsc` (3 cmds), backend tests, `routes.test.ts` + `AGENT_ROUTE_KEYS` sync assertion.
5. Telemetry row still written per turn; flags populate.
6. **Manual spot-check on `vantai.tingting.vip` (demo) before any prod touch** — never prod first.

## 6. Risks & mitigations
| Risk | Mitigation |
|---|---|
| `aggregateMetrics` lists a naive-`SUM`-unsafe money field → wrong finance number | Per-entity audit (P1); forbidden-metric unit test; byte-parity vs analyzer |
| Regression when retiring a narrow tool | Parity harness (P2) gates every deletion; demo-first |
| Parallel uncommitted work collides / gets accidentally committed | §0.1 reconciliation; never `git add` foreign files; isolate the gateway as its own commit unit |
| Registry drifts from Drizzle schema | Import-time drift-validation test (P0) |
| `report.run` lists a backing service that doesn't exist | Verify each before listing; add only extant ones |
| MiniMax-M3 ignores the money-routing rule (it ignored the navigate rule before) | Deterministic steer error in the tool + soft data-first net; same pattern that tames navigate/tour |
| `data.search` cost DoS | Loops all ~12 entities with an ILIKE+`unaccent` scan each; `MAX_SEARCH_PER_ENTITY=8` bounds ROWS not COST. **Acknowledged v1 limit** (single-tenant, office-only); revisit if exposed wider |
| `data.aggregate` groupBy cardinality | `groupBy:'customerId'` over years of trips is unbounded upstream of the `LIMIT 50`. Acceptable v1 single-tenant; acknowledged |
| Naming drift `data.meta` vs `meta.schema` | Canonical name pinned to `data.meta` in P0, before the prompt is touched in P3 |
| Soft-delete exemption mis-handled | `ledger`/`auditLogs` are append-only (no `deletedAt`) by design; P0 review confirms each `EntityDef`'s soft-delete clause is correct rather than blanket-applying one |

---

## 7. ADR
- **Decision:** Adopt Option A — **harden** the already-built semantic gateway (finance-audit
  `aggregateMetrics`, add `report.run`, review, drift-validation), then **retire** the 45 narrow tools
  behind a parity harness; keep v1 read-only; defer `kb.search`/`ui.snapshot`/`action.*`.
- **Drivers:** the gateway is 70% built but finance-unaudited and unreviewed; the user's "12 not 45"
  goal is only met by retiring narrow tools, which needs parity; single-tenant prod + billing-blocked CI
  means no big-bang and demo-first.
- **Alternatives:** B ship-as-is (rejected — ships a known finance risk, never consolidates); C rip &
  rebuild (rejected — discards on-spec working code).
- **Why chosen:** Closes the only live correctness risk, reuses existing services, and actually delivers
  the consolidation — without throwing away working code or betting prod on a big merge.
- **Consequences:** New `report.run` + registry + parity harness to maintain; transitional 51-tool
  surface until P3 retires; must reconcile a dirty parallel tree first.
- **Follow-ups:** `ui.snapshot` (frontend page-state contract); a separate "agent write" proposal for
  `action.*`; optional vector `kb.search`.

---

## 8. Open questions for the user (block execution, not planning)
1. Is the uncommitted gateway (`data.ts` + `semantic-data.service.ts`) intended work to harden in
   place, or throwaway? (Determines §0.1 reconciliation.)
2. ~~Which deterministic finance services exist to wrap behind `report.run`?~~ **Answered (verified
   on disk):** `getPnlReport`, `getReceivablesSummary` + `getCustomerAgingList`, `getFuelVarianceReport`,
   `listExpenses` — all already called by `analyzers.ts`. Remaining: confirm `payables_aging` /
   `driver_salary` / `trip_profitability` backing fns exist before adding those report.run entries
   (defer any unverified).
3. Should narrow-tool retirement (P3) happen in this workstream or a follow-up? (P0–P2 stand alone as
   "make the gateway correct + safe"; P3 is the disruptive part.)
