# Pre-existing gate failures on clean main (NOT introduced by SIL-479)

Verified 2026-10-25 by stashing the SIL-479 diff and re-running on the clean
tree (branch fix-container-fullrow @ 8cea1a6b = main HEAD):

1. `cd frontend && pnpm design:drift` → exit 1, `radiusOffLadder: 1 → 2`
   (identical failure with and without the SIL-479 diff; baseline
   `design-drift.baseline.json` last regenerated at db0a7a03, main has since
   landed an off-ladder radius elsewhere). The SIL-479 diff adds no raw value:
   no border-radius, no hex, no new media-width value (1024 already exists in
   the global set, e.g. app-shell.css:38 sidebar gate).
2. `cd frontend && pnpm size-check` → exit 1 "No test files found" — the
   script still spawns vitest with filter `src/tests/structure.guard.test.ts`
   which was retired at e54504bf (card 20261003_308 follow-through). Broken
   identically on clean main.

Required gates for this task (scoped vitest + tsgo + screenshots) are green;
see gates-*.log in this directory.
