# Fuel Per-Trip Actual Unit Price (Issue 1) + Unit-Price Drift Diagnosis (Issue 2)

**Status:** ⏸️ PENDING APPROVAL — ralplan consensus reached (Planner → Architect → Critic APPROVE, iteration 2). No source changes made. Await user sign-off before execution.

**Owner:** planned 2026-06-24 · **Complexity:** LOW–MEDIUM · **Scope:** shared schema + backend service + frontend create-payload + fuel-voucher display

---

## 1. Problem

User (Vietnamese) reported two issues in the Fuel (Nhiên liệu) section:

1. **Feature — config overrides actual price.** The fuel unit price always shows/uses the global config value **27,650** even when the user enters a real per-trip pump price. Request: use the **actual per-trip** price.
2. **Bug — entered value drifts.** User enters **23,530**; on re-check it has become **23,528**. Cause unknown.

## 2. Root Cause (evidence-verified)

### Data model (both columns already exist — no DDL needed)
- `trips.fuelPriceApplied` `numeric(10,0)` — integer VND **config snapshot** ("Giá áp dụng" on the fuel voucher). Written once at CREATE = `fuel_config.unitPrice` (27,650).
- `trips.fuelActualUnitPrice` `numeric(10,0)` — integer VND **per-trip actual** price (nullable).
- `fuel_config.unitPrice` = single live row = 27,650. `fuel_price_history` exists but is **write-only** (never read for trip pricing) → date-based substitution ruled out.
- Cost calc: `effectiveFuelPrice = fuelActualUnitPrice ?? fuelUnitPrice` (`shared/src/calculations/tripTotals.ts:114`); `fuelPriceVariance` uses **both** columns (`:117-119`) → the two-column model is intentional.

### Issue 1 — it is a DISPLAY + CREATE-persistence gap, NOT a data bug
- **CREATE** (`backend/src/services/trip-mutations.service.ts:184,219,271`): snapshots `fuelPriceApplied = config` and writes the snapshot trio; the `createTrip` input type (`:140-159`) and the INSERT **lack `fuelActualUnitPrice`**, so a pump price entered at creation is **dropped**.
- **UPDATE** (`:557,626`): already persists `fuelActualUnitPrice` to its own column and feeds it to `computeTripTotals` — works. `fuelPriceApplied` is **never** written on update.
- **Voucher** (`backend/src/services/fuel-voucher.service.ts`): the footer "Giá áp dụng" (`:315` HTML / `:505` XLSX) reads the raw config snapshot, and the line-item "Đơn giá" (`:302` / `:447`) reads raw `fuelActualUnitPrice` with a `?? 0` fallback (`:60`) — so a trip with no actual shows **0** in the line item and **27,650** in the footer. The user's "27,650 instead of 23,530" complaint = the voucher reads the wrong source.
- **Frontend create payload** (`frontend/src/hooks/useTripFormDispatch.ts:835-841`) does **not** send `fuelActualUnitPrice`; `TripCreatePage.tsx:78` does render the fuel card, so the field exists but isn't wired into create.

### Issue 2 — NOT statically reproducible; the save path is provably lossless
- Zod `positiveNumeric = z.union([number,string]).transform(Number)` (`shared/src/schemas/index.ts:27-34`) — pure `Number()`, no rounding. Write is `String(...)` (`:626`); column is integer `numeric(10,0)`. Form sends `Number(digitString)`; `InputWithPrefix` money strips non-digits. **No layer can turn 23,530 into 23,528.**
- Therefore the drift must come from a **non-obvious runtime path** (prime suspect: stale-payload / optimistic-lock overwrite — active 409/version-conflict bugs are logged). → **Diagnose before fixing.**

## 3. Decision (ADR)

- **Keep `fuelPriceApplied` as a pure config snapshot — never mutate it.** This preserves the audit trail ("config at birth"), the `fuelPriceVariance` contract, and the `applyCommittedLegacyFuelFreeze` three-way-zero sentinel (`trip-mutations.service.ts:62-64`).
- **Persist `fuelActualUnitPrice` on CREATE** (additive) so a manager can enter the real pump price at trip creation.
- **Display `effectiveFuelPrice = fuelActualUnitPrice ?? fuelPriceApplied`** wherever the "applied price" is shown.
- **No pre-fill** of the field (pre-fill was rejected: it corrupts `fuelPriceVariance` and makes "27,650" ambiguous — confirmed vs not-touched).
- **No removal** of the `!isCommittedTrip` backfill branch (`:430-439`) — it correctly serves legacy DRAFT trips and never writes the DB.
- **Issue 2:** diagnosis-first; no transform patch without a reproducing cause.

**Alternatives rejected:** (A) Mutate `fuelPriceApplied = actual ?? config` — rejected: destroys snapshot semantics, risks the freeze sentinel, broader blast radius. (B) Pre-fill the field — rejected: variance corruption. (C) Remove the update-path backfill — rejected: regresses DRAFT trips (branch is DRAFT-gated, not committed-gated).

## 4. Implementation Steps

### Issue 1
1. **CREATE persistence (additive)** — `shared/src/schemas/index.ts`: add `fuelActualUnitPrice: positiveNumeric.nullable().optional()` to `createTripSchema`. It flows through `createTripCommand` (spreads `…data`, `trip-command.service.ts:43`) to the `createTrip` input type. In `trip-mutations.service.ts` INSERT (near `:271`): add `fuelActualUnitPrice: data.fuelActualUnitPrice != null ? String(data.fuelActualUnitPrice) : null`. **Do not touch `fuelPriceApplied`.** (EXTERNAL trips: fuel is ignored by `computeTripTotals:172-179`, so persisting it is a harmless no-op — no special-case.)
2. **Voucher display — both cells → effective price** — `fuel-voucher.service.ts`: compute `effectiveFuelPrice = Number(row.fuelActualUnitPrice) || Number(row.fuelPriceApplied)` (note: use `??` semantics — null actual falls back to snapshot) once in `buildFuelVoucherData`, then feed it to **all four** sites: HTML line-item `:302`, HTML footer `:315`, XLSX line-item `:447`, XLSX footer `:505`. This also fixes the line-item-shows-0-when-null bug.
3. **Frontend create-payload wiring** — `useTripFormDispatch.ts:835-841`: add `fuelActualUnitPrice: s.fuelActualUnitPrice !== '' ? Number(s.fuelActualUnitPrice) : null` to the create payload (mirror the update payload at `:847`). **No pre-fill** — field stays blank with the existing placeholder "Để trống = dùng giá cấu hình".
4. **UPDATE path — NO change.** The backfill branch (`:430-439`) and `fuelActualUnitPrice` persistence (`:626`) stay as-is.

### Issue 2 (diagnose first)
5. **Reproduce on one non-COMMITTED trip:** enter **23,530**, save. Capture at every layer: request payload, response body, `SELECT fuel_actual_unit_price, fuel_price_applied, version FROM trips WHERE id=?`, reload value, voucher value. Note any time gap / second save.
6. **Discriminate hypotheses:**
   - **H1 (prime) stale-payload overwrite** — CONFIRMED iff DB = 23530 immediately after save but a *later* save-without-reload or the returned/voucher value = 23528. (Ties to logged version-conflict/409 bugs.)
   - H2 locale/`Number()` edge path; H3 derived-display re-copy (no such display exists — low); H4 mis-key/different trip.
7. **Decision gate:** fix only after pinpoint. If H1, ensure the actual-price field isn't silently overwritten by a stale full-form PUT (verify backend treating `null` as "cleared" at `:626` is consistent with the frontend always-sends-null-at-`:847` semantics — it is; that's the intended "blank = use config"). **No transform patch without repro.**

## 5. Acceptance Criteria
- **A1** create w/ actual=23530 → `fuel_actual_unit_price='23530'`, `fuel_price_applied='27650'` (snapshot unchanged), voucher shows 23530.
- **A2** create blank → `fuel_actual_unit_price=NULL`, `fuel_price_applied='27650'`, voucher shows 27650 (line-item no longer 0).
- **A3** update actual=23530 → `fuel_actual_unit_price='23530'`, `fuel_price_applied` UNCHANGED, `version` increments.
- **A4** COMMITTED legacy trip (zero trio) edited → freeze still fires, totals frozen.
- **A5** CREATED/DRAFT legacy trip (zero trio) edited w/o actual → still computes fuel vs live config (backfill branch preserved).
- **A6** trip with null actual → `fuelPriceVariance` = 0 (no pre-fill pollution).
- **A7** voucher line-item == footer for both null-actual and set-actual trips.
- **A8** (Issue 2, post-diagnosis) regression test per the confirmed hypothesis.

## 6. Verification
```bash
cd backend && npx tsc --noEmit
cd backend && npm test            # integration: needs Postgres+Redis + fresh pnpm db:migrate
cd shared && npm test             # shared tests are tsx-run (excluded from tsc — do NOT force tsc on them)
cd frontend && npx tsc --noEmit && npm run build
```
Manual (frontend 7173 / backend 3090): create trip with actual=23530 → reload → voucher "Giá áp dụng"=23530; create blank → 27650; edit a trip's actual to 23530, save, reload, edit a *different* field, save → still 23530 (Issue 2 repro/H1 check); open voucher for both → applied price matches; spot-check a pre-existing LOCKED trip's `fuel_price_applied` before/after deploy → unchanged.

## 7. Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Retroactive P&L shift | Snapshot never mutated; no backfill migration; display-only change applies safely to all existing trips. |
| Freeze-trio sentinel (`:62-64`) | Snapshot column untouched → sentinel integrity preserved. A4 regression test. |
| Optimistic-lock / stale overwrite (Issue 2) | Diagnosis-first; A8 regression test once cause pinned. |
| Voucher dual-field inconsistency | Both cells read the single computed `effectiveFuelPrice` (A7). |
| Variance corruption | No pre-fill; A6 guard. |

## 8. Open Decisions (flagged, non-blocking — confirm at execution)
- **D1 (accountant/Pete):** voucher footer "Giá áp dụng" — show effective price only (default, cells agree) OR additionally surface the config baseline as an audit reference? Default chosen: effective only. Reversible, display-only.
- **D2:** the display fix immediately corrects ALL existing trips (display-only, no migration) — stated as a strength.

## 9. Files Touched (planned)
- `shared/src/schemas/index.ts` — add field to `createTripSchema`
- `backend/src/services/trip-mutations.service.ts` — INSERT `fuel_actual_unit_price` (CREATE only)
- `backend/src/services/fuel-voucher.service.ts` — both price cells → `effectiveFuelPrice` (HTML + XLSX)
- `frontend/src/hooks/useTripFormDispatch.ts` — create payload wiring
- `backend/src/tests/*` — new test(s) for A1–A7
- (Issue 2) TBD after diagnosis

---
*Consensus trail: Planner (Option A) → Architect (SOUND-WITH-CONDITIONS → synthesis: keep snapshot pure + fix display) → Critic iter-1 (ITERATE: M1 variance/pre-fill, M2 voucher dual-cell, M3 backfill-gating) → orchestrator revision (drop pre-fill, both cells→effective, keep backfill) → Critic iter-2 (APPROVE, all claims source-verified).*
