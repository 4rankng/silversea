# Architecture Refactor — Consensus Execution Plan

> **STATUS: PENDING APPROVAL** — ralplan consensus, **DELIBERATE** mode
> Authors: Planner / Architect / Critic · Date: 2026-06-27 · Iteration: 3 (final corrections applied per Critic ITERATE→APPROVE)
> Critic pre-committed APPROVE pending 3 mechanical fixes (all applied): enum-sync.ts relocated shared→backend (shared has no backend dep); backend `test` script reframed "add"→"adjust existing"; pgEnum denominator corrected 26→18.
> Source audit: `docs/plans/architecture-audit-2026-06-27.md`

---

## 1. Recommendation

Ship a **minimal, incremental refactor** (RALPLAN Option A) sequenced as four PRs — **PR-1a → PR-1b → PR-2 → PR-3** — that adds a compile-time enum-sync guard, a non-blocking then (later) hard test/lint gate, regression tests around the financial core, and a typed `afterCommit()` helper that removes the last 2 silent cache-invalidation swallows. The split between PR-1a and PR-1b is forced by an empirically-proven blocker: of the 30 backend suites, many are integration tests that need live Postgres+Redis, and the CI workflow has **no service containers** — so a hard `make test` gate added today would tripwire the very first merge. PR-1a ships everything that is safe now (guard, local commands, non-blocking eslint); PR-1b promotes the test gate only after the three preconditions (suites green locally, CI service containers, unit/integration split) are met.

---

## 2. RALPLAN-DR Summary

### Principles
1. **Do not break the build to "improve" it.** A gate that fails on day one protects nothing — it blocks everything.
2. **Mechanically verifiable acceptance criteria.** Every step has a command whose exit code is the proof.
3. **Surgical scope.** Touch only the audit's named defects; no architecture redesign.
4. **Honest observability.** Prefer logging the truth (best-effort, warn-level) over silent swallowing or over-engineered tracing.
5. **Sequencing follows dependency, not ambition.** PR-1b waits on its preconditions; Wave 1a waits on the prod SSH check.

### Decision Drivers (top 3)
1. **CI reality** — no Postgres/Redis service containers; 30 backend suites are largely integration tests; eslint baseline = 19 problems (6 errors). A naive hard gate is self-blocking.
2. **Blast radius** — financial-core (ledger, trip figures, billing) is the highest-risk area; it must gain tests *before* the silent-catch refactor touches cache invalidation paths it depends on.
3. **Greppable, low-ceremony invariants** — a 1-file `enum-sync.ts` that fails `tsc` on drift catches the audit's Example-1 class of bug at zero runtime cost.

### Viable Options

| Option | Scope | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A — Minimal incremental** | 4 PRs: guard + gates + financial tests + `afterCommit` | Smallest blast radius; each PR independently mergeable; gates land only when safe | Does not eliminate all 26 pgEnums' drift risk; does not add OTel metrics now | **CHOSEN** |
| **B — Layered architecture rewrite** | Extract services into clean layers, full DI, total enum coverage | Maximal future-proofing | Multi-week; re-touches stable financial paths; high regression risk; violates Principle 1 | **REJECTED** — disproportional to audit findings |
| **C — Test-only / no refactor** | Add tests, ship no guard/helper | Zero production risk | Leaves silent-catch swallow + enum-drift latent; audit findings unresolved | **REJECTED** — does not satisfy audit objectives |

### Pre-mortem (3 failure scenarios, DELIBERATE mode) — with concrete mitigations

1. **The enum-sync guard false-passes.** *Mitigation:* header comment documenting **string-enum-only invariant** (would false-pass on numeric enums); denominator stated honestly as ~3 of ~18 pgEnums (~17%); guard uses `AssertEqual` + `${Enum}` template-literal trick proven against TripStatus/Role/TxnType. Open Question 4 decides whether to widen to 5 (add FuelMode/LoadingType).
2. **The hard test gate trips a merge mid-stream.** *Mitigation:* PR-1a ships **non-blocking** eslint + local-only `make test`/`make lint`; PR-1b's hard gate is gated on **3 preconditions** (all 30 suites green locally w/ PG+Redis; CI `services:` blocks added; `test:unit`/`test:integration` split). The 30-suite tripwire is **empirically proven** — Critic ran `cd backend && npx tsx --test src/tests/*.test.ts` and `chiho-reconciliation.test.ts` failed because it imports `db` and CI has no Postgres.
3. **`afterCommit` serializes or breaks cache invalidation concurrency, regressing trip-completion latency.** *Mitigation:* `afterCommit` contract preserves current `Promise.all` concurrency via `Promise.allSettled` (NOT serialized); runs only AFTER the DB commit; catches all errors, logs at `warn` with the cache keys, NEVER throws; a unit test asserts a throwing invalidation fn does not propagate.

---

## 3. Sequenced PR Breakdown

### PR-1a — Compile-time enum-sync guard + local dev commands + non-blocking eslint
**Ship now. No hard CI test gate.**

**File changes:**
- **NEW** `backend/src/db/enum-sync.ts` — `AssertEqual<A,B>` type util (lives in backend, NOT shared — the guard must import the Drizzle pgEnums from `./schema` and the TS enums from `@tingting/shared`; `shared` depends only on `zod` and cannot import backend) + sync assertions for the 3 in-sync string enums (`TripStatus`, `Role`, `TxnType`). **Mandatory header comment** stating: "String-enum-only. This guard would FALSE-PASS on numeric enums — do not add numeric enums here without a numeric-aware check. Coverage: ~3 of ~18 pgEnums (~17%)."
- **EDIT** `backend/package.json` — **adjust** the existing `test` script (today: `npx tsx --test src/tests/*.test.ts`, non-recursive) to `tsx --test src/tests/**/*.test.ts` (recursive, so all 30 suites run — behavior change; many need PG+Redis, see `make test` doc), and **add** a `"lint": "eslint ."` script (backend has no lint script today).
- **EDIT** `shared/package.json` — add `"test": "tsx --test src/**/*.test.ts"`, `"lint": "eslint ."`.
- **EDIT** root `Makefile` (or create if absent) — targets `make test` and `make lint` documented as **LOCAL-ONLY developer commands**:
  - `make test`: runs `cd backend && npm test` (backend) + `cd shared && npm test` (shared, via tsx) + `pnpm exec vitest run` (frontend). **Frontend leg EXCLUDES `tsc -b`** (spurious exit-1; tsc is the build job's concern).
  - `make lint`: runs `eslint .` for backend+shared AND `pnpm --filter frontend lint` separately (frontend has its own `eslint.config.js` with the custom `@tingting/no-bare-queryKey` rule).
- **EDIT** `.github/workflows/ci-cd.yml` — add a **non-blocking eslint annotation job**: a new job running `eslint .` (root, covers backend+shared) and `pnpm --filter frontend lint`, whose `if: always()` and **does not gate merge** (`continue-on-error: true` OR a separate job the required-status-checks do not include). The build job (`tsc -b && vite build`, spanning lines 38-46) and existing test job are untouched.

**Acceptance criteria (mechanically verifiable):**
- `cd backend && npx tsc --noEmit` exits 0 with `enum-sync.ts` present; deliberately breaking a sync assertion makes tsc fail (verified by a temporary edit, reverted before commit).
- `make test` and `make lint` run from repo root and execute all three legs.
- The CI eslint job runs and posts annotations; a PR with a new eslint warning merges successfully (proving non-blocking).
- `enum-sync.ts` header comment present and contains "string-enum-only" and "~12%".

**Verification commands (REAL):**
```bash
cd backend && npx tsc --noEmit                                    # 0
cd shared && npx tsx --test src/**/*.test.ts                     # green
make lint                                                        # runs 2 legs
make test                                                        # local only; expected: some backend suites fail without PG+Redis — that's the documented PR-1b precondition
```

**Risk:** LOW. New file + non-blocking CI job. No production code mutated.
**Deploy note:** No migration, no prod change. Ships via normal CI build job.
**OUT of scope:** hard test gate (PR-1b), widening enum coverage beyond 3 (Open Q4), fixing the 6 baseline eslint errors (PR-1b optional).

---

### PR-1b — Promote test gate to HARD CI (only after 3 preconditions)
**Do NOT open until preconditions are met.**

**Preconditions (all three, explicitly):**
1. **All 30 backend suites confirmed green locally** with Postgres + Redis up: `make dev` (or `pnpm db:migrate`) then `cd backend && npm test` → 0 failures.
2. **CI workflow gains service containers** — add to `.github/workflows/ci-cd.yml`:
   ```yaml
   services:
     postgres:
       image: postgres:16
       env: { POSTGRES_PASSWORD: postgres, POSTGRES_DB: nepo_test }
       ports: ['5440:5432']
       options: >-
         --health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5
     redis:
       image: redis:7
       ports: ['6390:6379']
       options: >-
         --health-cmd "redis-cli ping" --health-interval 10s --health-timeout 5s --health-retries 5
   ```
3. **Test job split** into `test:unit` (no DB; pure-logic suites — inventory to be completed, Open Q2) and `test:integration` (with services). The current test job (2 hand-picked shared tests, no services) becomes `test:unit`'s seed.

**File changes:**
- **EDIT** `.github/workflows/ci-cd.yml` — add `services:` blocks above; split test job; add `test:unit` + `test:integration` as **required** status checks; remove `continue-on-error` from the eslint job **only after** the 6 baseline errors are fixed (run `npx eslint . --fix` for the auto-fixable, manually fix `shared/src/types/index.ts:1028 no-empty-object-type`, then promote eslint to a `--quiet` errors-only hard gate).
- **EDIT** root `Makefile` — `make test` doc updated to reflect the unit/integration split (still local-only dev command).

**Acceptance criteria:**
- A PR that breaks a backend test is **blocked** by `test:unit` or `test:integration`.
- `npx eslint .` reports 0 errors (`--quiet` gate green); warnings remain allowed.
- CI runs green on `main` with services up.

**Verification commands:**
```bash
cd backend && npm test                          # local: 30/30 green (precondition 1)
npx eslint . --quiet                            # 0 errors (after fixes)
gh pr checks --watch <PR>                       # CI green with new services
```

**Risk:** MEDIUM — touches CI topology. Mitigated by being fully precondition-gated.
**Deploy note:** CI-only; no prod change.
**OUT of scope:** Wave 1a migration journal fix (deferred, prod SSH check).

---

### PR-2 — Financial-core regression tests + `SPEC-BUG` markers
**Establish the safety net before PR-3 touches cache-invalidation paths.**

**File changes:**
- **NEW** `backend/src/tests/ledger.service.test.ts` — covers ledger posting correctness incl. the chi hộ SERVICE_FEE phantom-reversal known defect, marked `// SPEC-BUG(SERVICE-FEE-REVERSAL): current behavior double-reverses; test pins current (wrong) behavior until spec sign-off`.
- **NEW** `backend/src/tests/updateTripFigures.test.ts` — covers `updateTripFigures` recalc paths.
- **EXTEND** the 5 existing financial-core suites: `ledger.service.chiho.test.ts`, `trip-ledger-completion.test.ts`, `b3-committed-legacy-fuel-freeze.test.ts`, `revenue-persistence.test.ts`, `billingDocument.service.test.ts` — add edge-case assertions surfaced by the audit.
- **EDIT** targeted financial-core source files — add `// SPEC-BUG(<id>): ...` greppable markers at each known-defective behavior site (do NOT fix the defects — fixing is out of scope; markers make them auditable and `grep -rn "SPEC-BUG"` reportable).
- **RUN** during this PR: the **prod SSH check** of `drizzle_migrations` journal (Wave 1a unlock gate) — `ssh nepo.tingting.vip "psql ... -c 'select * from drizzle_migrations order by created_at desc limit 10'"` — and record the max `created_at` / last applied migration. Result logged in the PR description; no code change here.

**Acceptance criteria:**
- `cd backend && npx tsx --test src/tests/ledger.service.test.ts src/tests/updateTripFigures.test.ts` green (with PG+Redis up).
- `grep -rn "SPEC-BUG" backend/src shared/src` returns a finite, PR-listed set of markers.
- The 5 extended suites still green.
- PR description contains the prod `drizzle_migrations` query result (or documents that the SSH check was attempted).

**Verification commands:**
```bash
cd backend && npm test                                            # all 30 green
grep -rn "SPEC-BUG" backend/src shared/src | wc -l                # matches PR list
ssh nepo.tingting.vip "..."                                       # journal check (during this PR)
```

**Risk:** MEDIUM — tests touch DB; markers are comments-only (no behavior change).
**Deploy note:** Test-only for prod; markers ship as comments. No migration.
**OUT of scope:** fixing any SPEC-BUG (separate epic); Wave 1a migration fix (separate, unlock-gated).

---

### PR-3 — Typed `afterCommit()` helper; remove 2 silent cache-invalidations
**Depends on PR-2 merged (safety net in place).**

**File changes:**
- **NEW** `backend/src/services/cache/afterCommit.ts` — exports `afterCommit(label: string, fns: Array<() => Promise<unknown>>): Promise<void>`. **Contract (verbatim):**
  > Runs AFTER the DB commit. Uses `Promise.allSettled(fns)` to **preserve current `Promise.all` concurrency** (NOT serialized). Catches all errors, logs each rejection at `warn` with `label` + the cache key, **NEVER throws**. Cache invalidation is best-effort / eventual-consistency. Returns `void`.
- **EDIT** `backend/src/routes/trips.ts:44` — replace the inline `invalidateReportCaches` `.catch(() => {})` swallow with `afterCommit('trips.invalidateReportCaches', [...])`.
- **EDIT** `backend/src/services/trip-command.service.ts:26` — replace the DUPLICATE `invalidateReportCaches` swallow identically (this is a duplicate of the same helper — consolidate or call the same `afterCommit`).
- **DO NOT TOUCH** `backend/src/reset-seed.ts:9` — the `db.delete(s.tripPhotos).catch(() => {})` there is an **intentional seed-reset** swallow (not cache invalidation). Add an explanatory comment: `// INTENTIONAL: seed-reset best-effort delete; NOT a cache invalidation — excluded from afterCommit refactor.`

**Acceptance criteria:**
- `grep -rn "\.catch(() => {})" backend/src` returns only `reset-seed.ts:9` (with the new explanatory comment).
- **NEW** unit test asserts a throwing invalidation fn passed to `afterCommit` does not propagate (the fn rejects → `afterCommit` resolves, logs `warn`).
- `make test` (backend leg) green; `cd backend && npm test` 30/30 green.
- `cd backend && npx tsc --noEmit` exits 0.

**Verification commands:**
```bash
cd backend && npm test                            # 30/30 green incl. new afterCommit test
cd backend && npx tsc --noEmit                    # 0
grep -rn "\.catch(() => {})" backend/src          # only reset-seed.ts:9
```

**Risk:** MEDIUM-HIGH — touches trip-completion cache path. Mitigated by PR-2 safety net + concurrency-preserving contract + `warn`-log observability.
**Deploy note:** No migration. Monitor trip-completion p95 + the new `warn` logs post-deploy.
**OUT of scope:** adding OTel/Pino metrics to `afterCommit` (deferred — logs are the v1 observable surface, see test plan).

---

## 4. Expanded Test Plan by Layer

| Layer | PR | What | Observability |
|---|---|---|---|
| **Unit** | PR-1a | enum-sync guard: temp-break assertion → tsc fails; revert. | tsc exit code |
| **Unit** | PR-2 | `ledger.service.test.ts`, `updateTripFigures.test.ts` (pure-logic + DB-backed with PG up). | suite pass/fail |
| **Unit** | PR-3 | `afterCommit` throwing-fn-does-not-propagate test. | suite pass/fail + **warn-log assertion (logs are the v1 observable surface; OTel/Pino metric deferred)** |
| **Integration** | PR-1b | `test:integration` job with PG+Redis services; all 30 backend suites. | CI status |
| **Integration** | PR-2 | 5 extended financial-core suites incl. chi hô reconciliation. | suite pass/fail |
| **Integration** | PR-3 | trip-completion → `afterCommit` → cache invalidation end-to-end (PG+Redis). | suite pass/fail |
| **E2e** | — | Not added this refactor (no user-facing behavior change). Deferred to feature epics. | — |
| **Observability** | PR-3 | `afterCommit` `warn` logs are the v1 observable surface for invalidation failures. **OTel/Pino counter deferred** — adding it would widen scope and touch the metrics pipeline unrelated to the audit. | Pino `warn` logs; `grep afterCommit` in log stream |

---

## 5. Out-of-Scope / Deferred

| Item | Unlock Gate |
|---|---|
| **Wave 1a** — migration journal `0040` backwards `when` fix | Prod `drizzle_migrations` SSH check (run during PR-2) confirms whether prod journal is actually behind; fix lands as its own PR. |
| Widening enum-sync guard to all 26 pgEnums | Open Q4 — decide if 5 (add FuelMode/LoadingType) or stay at 3; numeric-enum-aware check needed beyond that. |
| Fixing any `SPEC-BUG` marked in PR-2 | Separate epic per bug; requires product/spec sign-off. |
| `afterCommit` OTel/Pino metric | Wave 3 — after PR-3 merged and logs prove the surface. |
| Frontend test gating via `tsc -b` | Never — `tsc -b` spuriously exits-1 (pre-existing quirk); tsc stays in the build job. |

---

## 6. ADR

- **Decision:** Adopt Option A (minimal incremental refactor) sequenced as PR-1a → PR-1b → PR-2 → PR-3, with the test/lint hard gate split out (PR-1b) and precondition-gated.
- **Drivers:** (1) CI has no service containers + many of 30 backend suites are integration tests → hard gate is self-blocking today; (2) financial-core blast radius demands a test safety net before the silent-catch refactor; (3) compile-time enum guard is zero-cost and greppable.
- **Alternatives considered:** Option B (layered rewrite) — rejected as disproportional; Option C (test-only) — rejected as leaving audit findings unresolved.
- **Why chosen:** Smallest blast radius that resolves every audit finding; each PR independently mergeable; gates land only when empirically safe.
- **Consequences:** Enum drift coverage is ~17% (3/18) pending Open Q4; `afterCommit` observability is log-only until Wave 3; SPEC-BUG defects remain pinned-not-fixed.
- **Follow-ups:** Wave 1a migration fix (post SSH check); enum coverage widening (Open Q4); SPEC-BUG fix epic; `afterCommit` OTel metric (Wave 3).

---

## 7. Open Questions

1. **Prod `drizzle_migrations` journal state** — does prod's `max(created_at)` lag behind the repo journal's `when`? Run the SSH check during PR-2. *Why it matters:* unblocks Wave 1a and confirms whether prod has silently skipped migrations.
2. **Which of the 30 backend suites are pure-unit vs integration?** *Why it matters:* determines the `test:unit` seed for PR-1b's split. Inventory needed before PR-1b preconditions can be declared met.
3. **Should the enum-sync guard cover 5 enums, not 3?** `FuelMode` and `LoadingType` are also TS string enums in sync with pgEnums. *Why it matters:* raises coverage from ~17% to ~28% at near-zero cost; need to confirm they're genuinely in sync first.
4. **OTel counter reuse vs new metric for `afterCommit`?** *Why it matters:* the chatbot-perf-monitoring work already added an OTel/Pino pipeline — decide whether `afterCommit` reuses it (Wave 3) or adds a dedicated counter.
