---
name: "supplier-carrier-link"
description: "Contains the supplier→carrier customer link contract (Bug A 2026-09-09): ensure logic, backfill script usage, pinned tests, tax-code normalization pitfall, deploy/backfill runbook"
folder: "features"
tags: []
updatedAt: "2026-09-09T14:24:07.834Z"
author: "Project Manager"
---

# Supplier → carrier customer link ("Chọn nhà xe" visibility)

## Architecture
- Every carrier dropdown (master-plan bootstrap `externalCarriers`, detail-plan `GET /shipments/dispatch-fleet?resource=EXTERNAL_CARRIER`) reads `customers.isCarrier=true AND status='ACTIVE' AND deletedAt IS NULL`.
- `syncSupplierRelationsHook` (backend/src/routes/config/config-helpers.ts) runs on every supplier write: explicit `linkedCustomerId` → sets `isCarrier` + back-link without touching business fields; otherwise `ensureLinkedCarrierCustomer` picks the link target: adopt back-linked customer → adopt unique same-named live customer → adopt unique tax-code holder → mint ACTIVE isCarrier customer (mirroring name; name/status mirror on the auto path, tax code never clobbered on adopted rows).
- `ensureSupplierCarrierLink` = ensure + write `suppliers.linkedCustomerId`.
- Backfill: `backend/src/scripts/backfill-supplier-carriers.ts` (`npx tsx src/scripts/backfill-supplier-carriers.ts [--dry-run]`), or on the server the compiled `node dist/scripts/backfill-supplier-carriers.js` inside the backend container (tsx is dev-only). Idempotent: targets = non-deleted ACTIVE suppliers whose link is NULL / dangling / customer lost isCarrier; ends with `cacheInvalidate('catalogs:bootstrap')` in main().
- Pinned by `backend/src/tests/supplier-carrier-link.test.ts` (4 hook paths + backfill: unlinked/dangling/tax-code fixtures, dual-source visibility, x2 no-op).

## Decisions
- 2026-09-09: every supplier must own a linked ACTIVE isCarrier customer (customer report: supplier created on Suppliers page invisible in all carrier dropdowns). Soft-deleted customers never adopted. Tax-code adoption uses normalized comparison (see Pitfalls). Grid-PATCH :609 + intake :756 guards stay LOCKED (relaxed reassign flow covers live-trip rows); 409 on a no-live-trip row would be new evidence → escalate, don't relax.
- Deploy: staging-first via `make demo` (vantai.tingting.vip), prod via `make deploy` (silversea.tingting.vip, requires prod branch + clean tree), backfill run on prod DB after deploy with DB backup first; prod is read-only verification only (staging for all testing).

## Pitfalls
- **Tax-code identity is `normalizeTaxCode`** (strip ALL whitespace + lowercase), NOT `btrim`. SQL: `lower(regexp_replace(btrim(col), '\s+', '', 'g'))`. The DB partial unique index `lower(btrim(tax_code))` is WEAKER than the API guard — btrim-only comparisons can mint guard-level duplicate customers (symptom: `Mã số thuế đã tồn tại ở khách hàng "..."` 409 on the next customer write; Q08 partner-convergence test catches it).
- Adopted (business-owned) customers still get name-mirrored on later supplier writes via the back-link scan — provenance of minted-vs-adopted is not tracked. Flagged exposure; escalate before relying on renames for linked suppliers.
- node:test graceful shutdown hangs on Node 25 + postgres-js → test files must `process.exit(0)` after cleanup (see supplier-carrier-link.test.ts after()).
- `getBootstrapData()` is wrapped in a 60s versioned cache (`catalogs:bootstrap`); direct DB writes in tests must `cacheInvalidate('catalogs:bootstrap')` before reading bootstrap.
- Interrupted test runs leak fixture rows that poison later runs via unique-index collisions — purge leaked fixtures before diagnosing a new failure (backup first).

## State
- 2026-09-09: fix + backfill shipped in b77599f5, normalization fix in b6988392, test pins in 55810264 (chain: 3212077b → b6988392 → 55810264, all pushed to origin/prod). Staging deployed 21:31 SGT. Prod deploy + prod backfill pending full-suite green (fullstack owns the chain).

## State (2026-09-09 22:25 SGT — DEPLOYED & VERIFIED)
- Prod silversea.tingting.vip deployed at **55810264** (22:19:41), staging vantai at same sha. Pre-backfill prod backup: /opt/silversea/.db-backups/db-20260909T141542Z.dump.
- Prod backfill outcome: 24 ACTIVE isCarrier customers (was 17); 0 suppliers without valid carrier link (was 9, incl. QUANG PHÚ = customer 35); dual ĐĂNG QUÂN each own distinct carrier customer (sup 10→cus 11, sup 11→cus 12). Fullstack's fresh run proved idempotent no-op on prod (24 checked / 0 ensured / 0 errors).
- Timeline note: a peer session (outside the team run) had already run the backfill script against prod at 21:26:41 — 7 mints + 2 same-name adoptions (D&S, 2nd ĐĂNG QUÂN), ~300ms apart; verified row-by-row afterwards, outcome correct. The staging-first gate postdates that run.
- All 8 acceptance criteria verified: tests 5/5 + 1827/1827 backend + 1605/1605 frontend; double-run no-op on staging AND prod; Bug B UI ALL PASS on staging (assign/change/reassign-routing/COMPLETED-freeze); commits→push→staging→prod.
