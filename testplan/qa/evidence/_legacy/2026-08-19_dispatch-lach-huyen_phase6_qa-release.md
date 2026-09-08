# QA — Dispatch Lạch Huyện Phase 6: Closed-loop QA and release readiness

- Date: 2026-08-19
- Scope: `qa/2026-08-19_dispatch-lach-huyen_phase6_qa-release`
- Gate: full-suite verification + independent review + review-fix re-verification

## Migration safety (Phase 6 step 2)

- `drizzle.__drizzle_migrations`: **23 applied = 23 journal entries**; last two are
  `0021_add-dispatch-zone-classification`, `0022_backfill-dispatch-zone-classification`
- Backfill state: LH-zoned ports **4**; LCL-classified fulfillments re-verified; **rerun is
  safe and deterministic** — a rerun classified 429 newer LCL rows created post-first-run by
  concurrent-session fixtures (exactly the forward-fix semantics; FCL rows untouched: 475
  active fulfillments remain NULL = legacy unclassified, correct)
- `npx drizzle-kit check`: fails on a **pre-existing** EISDIR config quirk (unrelated to these
  migrations; the journal/snapshot chain + applied-state parity was verified manually instead)

## Full gates (Phase 6 step 3)

| Gate | Result |
|------|--------|
| `pnpm lint` | 0 errors (90 pre-existing warnings) |
| `cd backend && npx tsc --noEmit` | 0 errors |
| `cd backend && pnpm test` | **2102/2102** (36 dispatch-detail-plan incl. review-fix regressions) |
| `cd frontend && npx tsc -b` | 0 errors |
| `cd frontend && pnpm test` | **954/954** |
| `make build` | ✓ (5.26s; pre-existing chunk-size warnings only) |
| `cd e2e && ./run_all.sh` | **401/436 pass, 4 fail, 31 skip** — all 4 failures are TC-1604-CLERK (clerk dashboard button 137×40 < 44px minimum). **Pre-existing**: my diff touches no clerk/dashboard file (verified `git status` ∅ for clerk/dashboard paths); failure mode is a button styled elsewhere |

## Multi-viewport role walkthrough (Phase 6 step 5)

Artifact: `qa/2026-08-19_dispatch-lach-huyen_phase6_walkthrough.md` (+ reusable script `.py`)
— **56/56 checks pass** as dieuvan (DISPATCHER) at 1280/768/390/320 and ADMIN at 1280:
- Both workspaces load; **zero horizontal overflow at all four widths**; zero console errors
- Facet controls "Cảng Lạch Huyện" / "Nhà xe" visible at every width; live data confirmed
  ("Sản lượng: 38 cont (20': 23 · 40': 15)" summary strip on real rows)
- Detail columns `ĐIỀU PHỐI → PHÂN LOẠI → GHI CHÚ` order verified; editor opens with
  Nhà xe / Phân loại / Cước fields; Escape closes + restores
- DISPATCHER is **redirected away** from /config/ports by the adminOnly guard at every width
- ADMIN /config/ports lists ports, mentions Lạch Huyện zone, no console errors

## Independent review (Phase 6 step 6)

Fresh adversarial reviewer over the committed wave (`09b5c45` + working fixes). Verified clean:
lock order (shipment→fulfillment, matches issuance), tx purity (no `db.` inside tx), replay
idempotency (no notification/push re-fire), isCombined version flattening, suggestion
authorization-first + reasons-only payload, schema cross-field rules, payload hygiene for
carrier switches.

Findings & dispositions:
- **P1-1 FIXED** — carrier switch with no vehicle block silently retained the previous
  carrier's plate/vehicle columns → carrier switch now implies clear (mirrors legacy carrier
  endpoint); regression test added (36-test suite)
- **P1-2 FIXED** — "Bỏ gán biển số" was a no-op (`vehicleBody('')` returned `{}`) → returns
  `{clearVehicle: true}`; regression test added
- **P2 FIXED** — evidence query LIMIT 500 without a date predicate was a biased sample at
  scale → `workDate in (D-1, D+1)` pushed into SQL WHERE before the limit
- **P3 FIXED** — soft-deleted LH ports still generated suggestions → `ports.deletedAt is
  null` added to the join (facet parity)
- **P3 accepted** — same-port pickup+dropoff D+1 edge (single-row OR join): documented,
  no production container in the dataset has identical pickup/dropoff ports; revisit with a
  two-row lateral if it appears
- **P3 deferred** — `trucks.normalized_plate` column for sargable joins: EXPLAIN shows
  harmless at current volume (58 trucks, cost 57.3, all other joins indexed); noted for the
  10k-fulfillment horizon
- Reviewer verdict NOT-READY → both P1s + P2 fixed and re-verified → gates re-run green
  (backend 2102/2102, frontend 83/83 dispatch + 954/954 full)

## Commit / deploy

- Wave committed by the concurrent session as `09b5c45` (verified: contains phases 2-5);
  review fixes + this QA set committed separately on `main` (repo convention: trunk-only)
- Deploy: `make demo` (vantai.tingting.vip — this repo's only deploy target; no production
  target exists). Migrations 0021/0022 deploy-pending → applied via the demo deploy flow's
  migrate step (`make demo-deploy` runs migrations; `make demo` includes it)
