# FB-057 (card 141026012000) — topbar search measured ~364px at 1920px: stale build, fix already landed

**Card:** `FB-057 verify-fail: topbar search vẫn bị cap ~360px (regression
persists)` — staging build `5ef12393`, admin, measured ~364px at a 1920px
viewport.

## Finding: the report predates the fix

| Commit | Date | What |
|---|---|---|
| `5ef12393` | 2026-10-13 22:10 +08 | the build QA measured (verified ancestor of the fix) |
| `4597219b` | 2026-10-16 12:20 +08 | `fix(design): the topbar search stays fluid while focused above 1280px` |

`git merge-base --is-ancestor 5ef12393 4597219b` → true: the fix landed two
days after the measured build, and is already on `origin/main`. The ~364px
figure is the pre-fix behaviour (the base `max-width: 360px` at
`topbar.css:512`). This is the known stale-build pattern for this ticket —
`docs/qa-batch-triage-2026-10-14.md` (FB-057 row) says exactly this: *if
re-reported as "still 360px", check whether QA tested a pre-ruling build*.

## Cascade at HEAD

- `.topbar__search` — `flex: 1 1 0; min-width: 360px; max-width: 360px`
  (`topbar.css:498-514`); `:focus-within` relaxes to 560px (`:515-517`).
- `@media (min-width: 1280px)` re-states **both** selectors with
  `max-width: none` (`:527-532`) — so at ≥1280px the field is uncapped at rest
  *and* focused.
- ≤1023px keeps its 120px mobile floor (`responsive.css:95-97`); ≤640px hides
  the field.

## What this wave adds

`max-width: none` is only half the contract the card measures. With no growth
the flex item falls back to its basis and renders at exactly the **360px floor**
— the number QA read off the screenshot. The growth half (`flex: 1 1 0`) was
correct in the CSS but unpinned, so a future edit could have produced the same
~364px again with every existing pin still green.

New pin (`topbar.styles.test.ts`): the field grows (`flex: 1 1 0`), keeps the
360px floor, the actions block resolves on `margin-left: auto` (which flexbox
applies after free-space distribution, so it cannot starve the field), and the
bar carries no `max-width` of its own.

## Verification

- `npx vitest run src/components/layout` → 12 files / 97 tests pass.
- `npx tsc --noEmit` → 0 errors.
- Not re-measured in a live browser (rung 1): no staging or local session was
  used in this wave, so the ~1070px expected width at 1920px remains
  unmeasured here. The prior UI-driven run recorded in
  `testplan/cycles/2026-10/2026-10-14-ui-regression-batch-fb009-043-048-057-061-066.md`
  (1280→562px, 1440→522px, computed `max-width: none`) is the live evidence.