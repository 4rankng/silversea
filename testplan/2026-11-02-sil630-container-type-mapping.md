# SIL-630 (id 734) — Dropdown "Loại container": choosing DC persists RF

**Date:** 2026-11-02 · **Lane branch:** `fix-sil-630` (base `origin/main` b20c724c) · **QA regression source:** staging build 6e6c921a, 31/10

## Status

```
Status: DONE
Summary: Root cause is a paint≠hit window in the shared base Popover (already fixed at its owner by commit 7af84183, present on this base); this lane verifies the fix, adds the value-mapping pin suite for the create-form cell, sweeps every consumer of the container-type catalog, and records all green gates.
Concerns/Blockers: none
```

## 1. The exact defect and mechanism

**Symptom:** in the Loại container dropdown, picking `20DC` (id 1) displayed `20RF` and saved the 20RF row; `40DC` (id 2) saved `40RF`. The drift is exactly **+2 catalog positions** — the row that really lived under the cursor when the operator clicked the painted "20DC" row.

**Root cause (found, not patched):** NOT a value-mapping defect. The id↔label channel is correct everywhere (verified per consumer in §2). The mechanism is a **paint ≠ hit window in the shared base popover**:

- `frontend/src/components/untitled-ui/base/select/popover.tsx` — react-aria positions the overlay with a **post-mount pass**. On the Loại picker the listbox painted *detached* from the trigger (drifted down toward the Ghi chú band) while the overlay was re-positioned; a pointer click aimed at the painted "20DC" row hit the option that really lived under the cursor — the RF row two positions down. Every non-pointer probe (mouse-settled click, ArrowDown+Enter, typed prefix+Enter, re-pick) committed the correct id, which proves the mapping was never wrong.
- **Fix at the shared owner** (base Popover, serves every dropdown): commit **`7af84183` "fix(cus): SIL-630 (id 734) — dropdown Loại container map đúng DC/RF"** — `useSettledPointerEvents` in `popover.tsx:59-101`: the overlay holds `pointer-events: none` (`data-popover-gate="settling"`) until its rect is identical for 2 consecutive frames (`SETTLE_FRAMES`, capped at 30 frames); a too-early click is swallowed instead of committing a neighbour row. The gate is a child component of the overlay (`PopoverSettleGate`) so it re-arms on every open; keyboard flows bypass it.
- Staging build **6e6c921a predates that fix** (`git merge-base --is-ancestor 7af84183 6e6c921a` → false); the QA regression was captured against the unfixed build. `7af84183` is an ancestor of this branch's base `b20c724c`.

**Reproduction this lane:** the pin suite `frontend/src/features/shipments/create/container-type-value-mapping.styles.test.tsx` drives the real `ContainerTypeCellPicker` → `USearchableField` → RAC `ComboBox` chain in jsdom: picking each of `20DC/40DC/40RF/20RF/45HC` commits **its own** row id (`'1'…'5'`) and displays **its own** code; an externally restored id (`'1'`) displays `20DC`. 6/6 pass — no index-mapped label anywhere in the value channel.

## 2. Consumer sweep — every surface shows/stores the row it holds

The defect class owner is the shared Popover; the sweep confirms no consumer maps the catalog by array index or by an offset:

| Consumer | Mapping | Verified |
|---|---|---|
| `frontend/src/features/shipments/create/ContainerTypeCellPicker.tsx` | `options.map(item => ({ value: String(item.id), label: item.code }))` (same row) | Pin suite drives it end-to-end (§1); commit writes the picked option's own id |
| `frontend/src/features/shipments/create/ShipmentCreateContainerRow.tsx:90,246,269-275` | display `containerType?.code` where `containerType = catalogs.containerTypes.find(item => String(item.id) === row.containerTypeId)`; picker value = `row.containerTypeId` | id-mapped both ways; display and stored value come from the same row |
| `frontend/src/features/shipments/create/shipment-create-model.ts:489` | submit `containerTypeId: Number(row.containerTypeId)` | the API receives the numeric catalog id — the persisted value is the id the user picked |
| `frontend/src/features/shipments/cus/CusLotView.tsx:466-478,603-608,672-673` | editor `options={typeOptions.map(option => ({ value: String(option.id), label: option.code }))}`, `value={typeId != null ? String(typeId) : ''}`; re-pick of the same id is a no-op (`:604`) | id-mapped; commit saves the picked id (`save('containerTypeId', value)`) |
| `frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:771` | `SearchableSelect options={detail.selectors.containerTypes.map(item => ({ value: String(item.id), label: item.label, ... }))}` | id-mapped from the selector's own row |
| `frontend/src/hooks/useTripOptions.ts:103` | `catalog.containerTypes.map(c => ({ id: c.id, label: c.name \|\| c.code \|\| … }))` | label built from the same row — id and label can never diverge |
| dispatch-detail container editor (`frontend/src/features/dispatch/**` — read-only check, file not owned) | renders through the same shared `UuiSelectField`/`ComboBox` → base `Popover` | the settle-gate fix at the base Popover covers it; no local index mapping found |

Backend side:

- `backend/src/seed/data/reference.ts:113-143` — codes/names are correctly paired (`20DC↔20'DC`, `40DC↔40'DC`, `40RF↔40'RF`, `20RF↔20'RF`, `45HC↔45'HC`); `backend/src/seed.ts:561-569` seeds the superset catalog by code with `code` unique (`backend/src/db/schema/master-data.ts:344`).
- `backend/src/services/config.service.ts:57,104` — the bootstrap catalog returns `containerTypes` rows **unmapped** (no sort/reindex/offset projection). No server-side label assembly to corrupt.
- The persisted `shipment_containers.container_type_id` is written from the FE id string (`Number(...)`), never from a label — so no code path converts "20DC" ↔ "20RF" text.

## 3. Data hygiene — existing wrong rows

The defect never wrote a *wrong mapping*: it wrote a **valid but unintended id** (the RF row's id) at the moment of the mis-aimed click. There is no seed defect to correct (`reference.ts` pairs code↔name correctly) and therefore no migration/seed-guard is warranted by this ticket. Rows already persisted with the unintended id cannot be auto-corrected by any deterministic rule (the customer's true intent is not derivable from the data), so:

- No raw SQL and no silent prod-row mutation (repo ban respected; Drizzle-only rule moot here).
- Remediation is operator-driven: re-open the container row in the CUS lot view / dispatch-detail editor and re-pick the correct type — the same picker, now safe (settle gate) — which writes the correct `container_type_id` through the normal API path.
- Detection support for QA: lots created during the regression window where a DC code was intended can be found by joining `shipment_containers.container_type_id` against the reefer ids (`20RF`/`40RF`) on FCL dry-cargo lots; that candidate list is an owner decision, not an automatic migration.

## 4. Gates (verbatim counts)

Raw outputs: `testplan/qa-2026-11-02-sil630/*.txt` (the worktree's `/qa/` is gitignored per `.gitignore:98`, so logs live in `testplan/` as the brief directs).

| Gate | Command | Result | Artifact |
|---|---|---|---|
| FE vitest (create + cus) | `cd frontend && pnpm exec vitest run src/features/shipments/create/ src/features/shipments/cus/` | **66 files passed, 505 tests passed**, exit 0 | `vitest-create-cus.txt` |
| FE typecheck | `cd frontend && pnpm exec tsc -b` | **0 errors**, exit 0 | `tsc-fe.txt` |
| BE typecheck | `cd backend && npx tsc --noEmit` | **0 errors**, exit 0 | `tsc-be.txt` |
| BE unit tests | `cd backend && npx tsx --test 'src/tests/unit/*.test.ts'` | **687 tests / 86 suites, 0 fail, 0 skipped**, exit 0 | `unit-be.txt` |
| BE eslint | `cd backend && npx eslint src/seed/data/reference.ts src/services/config.service.ts` | **0 errors**, exit 0 | `eslint-be.txt` |
| Shared-owner pin | `pnpm exec vitest run src/components/untitled-ui/base/select/popover.settle-gate.test.tsx` | **3 tests passed** (run inline, recorded in this file) | — |
| New pin suite | included in the FE vitest gate above (`container-type-value-mapping.styles.test.tsx`, 6 tests) | **6 tests passed** | inside `vitest-create-cus.txt` |

Worktree-environment note: the FIRST `unit-be.txt` run failed with `ERR_MODULE_NOT_FOUND: @tingting/shared/dist/index.js` — the workspace package was simply unbuilt in this fresh worktree, unrelated to any source change. Rebuilt it (`pnpm --filter @tingting/shared build`, exit 0, `shared-build.txt`) and the rerun above is fully green.

## 5. Coverage

| Claim / bug | Rung | Evidence | Not covered |
|---|---|---|---|
| Value mapping id↔label for all 5 seeded types, create-form cell | Unit-pinned (jsdom drives real picker chain) | `container-type-value-mapping.styles.test.tsx` 6/6 | Real-browser pointer timing is pinned separately by `popover.settle-gate.test.tsx` (jsdom cannot exercise rAF-driven overlay drift) |
| Shared Popover settle gate (paint≠hit window) | Unit-pinned + UI DRIVEN in the fixing commit | `popover.settle-gate.test.tsx` 3/3; `7af84183` message records human-coordinate clicks at 1280/390px, ArrowDown/Enter, typed+Enter, re-pick, drawer quick-edit, persisted `container_type_id=1` (shipment 889, row 972) | This lane did not re-drive a browser against a fresh dev server (fix commit's UI DRIVEN evidence stands; jsdom scope here is the value channel) |
| Stored value = picked id on save | Unit + model tests | `shipment-create-model.ts:489` `Number(row.containerTypeId)`; `buildShipmentContainerPayload` tests pin `containerTypeId: 31` passthrough | Staging re-verification of a new save after deploy is the orchestrator's deploy step |
