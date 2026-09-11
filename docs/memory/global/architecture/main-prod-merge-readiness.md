---
name: "main-prod-merge-readiness"
description: "Contains the main→prod merge readiness verdict (2026-09-10 scout): the drizzle migration renumber/hash-skip trap, the 4 additive migrations prod will receive, the gate order (merge prod into main first — deploy-advance is ff-only), and the behavior-change watchlist"
folder: "global / architecture"
tags: []
updatedAt: "2026-09-09T18:58:44.457Z"
author: "BackEnd (backend)"
---

# main→prod merge readiness (scout 2026-09-10)

## Verdict
**GO with gates** (ticket cdb2f819, report `plans/reports/backend-260910-0130-main-wave-ship-readiness.md`). Divergence at `55810264`: prod = responsive wave (`4146f000`, 19 commits, frontend CSS/tests only); main = ops portal + driver-app + pairing + ad-hoc + pricing (`c959e7bb`, 94 commits). `git merge-tree` clean: 0 conflicts, 2 overlap files with complementary hunks; structure-guard pins (76 ts/tsx) intersect none of prod's 18 changed files.

## The migration renumber trap (key pitfall)
main renumbered prod's applied `0058_tidy_sleeper` / `0059_add-missing-dispatch-task-tags` / `0060_unique-bl-declaration-indexes` → `0061`/`0062`/`0063`, inserting `0058_gorgeous_tinkerer`, `0059_brief_firestar`, `0060_broken_la_nuit` before them (+ `0064_cynical_eddie_brock` after). The renumbered trio is **byte-identical** to prod's files (journal `when` preserved, only `idx` moved) → drizzle's content-hash matching treats them as already applied, and prod's DB runs only the 4 genuinely-new migrations, in journal order. **Any future content drift in a renumbered file would make drizzle re-apply it** — the staging rehearsal must show exactly 4 new `__drizzle_migrations` rows and zero re-runs of 0061–0063, else STOP.

## What the merge ships
4 additive migrations: ops wallet/expense tables + `truck_ops_assignments` + `user_shipment_pins`; `trip_pairs.pair_kind` (default `KET_HOP`) + `second_salary_stash`; shipments `raw_*` + `is_ad_hoc` buffered fields; 6 pricing tables. Sole constraint change: `shipments.customer_id` **DROP NOT NULL** (only future ad-hoc/`lệnh chạy ngoài` rows can be NULL; main's schema.ts already models it). Zero new required env vars (optional `SETTINGS_ENCRYPTION_KEY` AES master key falls back to sha256(JWT_SECRET)); zero new backfills (`backfill-supplier-carriers.ts` extended on main — run the merged-tree version if re-run); pricing engine dormant until rate data (`freight_rate_terms` / `fuel_price_periods` / `vehicle_size_classes`) is entered. No DDL outside `backend/drizzle`; no dependency/compose/Makefile changes.

## Gate order (deploy-advance is ff-only)
`make deploy-advance` = `git fetch . origin/main:prod` (ff-only) — impossible while prod carries the responsive wave. Sequence: (1) merge origin/prod INTO main on a main-line checkout (the repo's own 10-merge pattern), (2) gate the merged tree (tsc, structure guard, full backend+frontend suites, `make db-drift-check`), (3) staging rehearsal via `make demo` — staging DB mirrors prod's migration lineage and proves the renumber-skip on a real DB, (4) `make deploy-advance` then `make deploy` (auto-runs `drizzle-kit migrate` on the server after DB backup + rollback capture; health checks built in).

## Watchlist (silent behavior changes)
duplicate-reference 409s on shipment writes (dup Bill/Booking/declaration); `/ops/*` portal + pair-salary routes exposure (photo allowlist hardening already in); driver-app UI changes; `DetailedPlanGrid.css` composition (prod card-grid × main pair-tag styles — live DOM probes at 901–1512 + 390/768, see [[css-grid-orphan-parity-trap]]); auth/session untouched. Related: [[supplier-carrier-link]], [[testing-and-deploy-environments]].

## RETRACTED sequence (user ruling 2026-09-10, binding)
The gate order above — merge origin/prod INTO main, ff-advance, deploy — is **overruled**: the user retracted any merge instruction and ruled that **prod advances ONLY via direct commits on prod** (explicit pathspecs, logical chunks) + push; **no git merge targeting prod, no ff-advance from any branch, and no operations touching main**, unless the user personally re-opens it. The analysis sections (renumber/hash-skip trap, additive-migration inventory, behavior watchlist) remain valid for any future user-ordered integration of main's ops/driver/pricing wave — prod's divergence from main simply grows until then, and the renumbered-migration byte-identity must be RE-VERIFIED at that future date (content drift would make drizzle re-apply). In the interim, schema-affecting work ships as direct prod commits; keep new migrations sequential after 0060 (prod numbering) to avoid widening the renumber gap.
