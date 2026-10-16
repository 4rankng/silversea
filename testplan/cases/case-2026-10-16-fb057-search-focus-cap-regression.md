# Case 2026-10-16-FB057-R1 — topbar search reverts to a hard cap while focused

Card `141026012000-fb057-verify-fail-search-cap-360px-persists` re-reported
FB-057: the global topbar search is still width-capped on wide viewports.
The 2026-10-14 fix (410bc5f7) had made the field grow fluidly from 1280px up.

## Repro

1. Open the desktop shell (admin/dispatcher) at a viewport ≥ 1280px.
2. Click into the global search in the topbar.
3. Measure the search field width while focused.

- Before: focusing snaps the field back to a hard 560px cap — it stops
  growing with the free topbar space. Blurring restores the fluid width.
- After: the field keeps its fluid width while focused; the cap only ever
  applies below 1280px, where the ruling still wants a rest clamp.

## Root cause

Two rules, two different selectors, and media queries add no specificity:

- `.topbar__search:focus-within { max-width: 560px }` — (0,2,0), `topbar.css:515`
- `@media (min-width: 1280px) { .topbar__search { max-width: none } }` — (0,1,0)

The focus clamp outranked the unbounded tier, so the "no fixed ceiling above
1280px" ruling only ever held in the rest state. The card was filed from a
focused field, which is exactly the state the ruling protects.

The existing pin (`expands the global search on focus while keeping the 360px
rest cap`) only asked that `.topbar__search` appear in the media block — true
before and after the defect — so it could not see the conflict.

## Expected

Above 1280px the field has no width ceiling in any state (rest or focus).
Below 1280px the rest/focus ladder (360px cap, 560px focus relax) is unchanged.

## Pin

`frontend/src/components/layout/Topbar.styles.test.ts` —
`keeps the search uncapped above 1280px while focused, not just at rest`.
Re-stating the focus selector inside the media tier is the fix; the pin
asserts the tier contains no `360px`/`560px` clamp at all.

Verified failing-before / passing-after: reverting only the CSS makes the new
pin fail while the six pre-existing pins still pass, which is the signature of
a defect the old suite could not detect.