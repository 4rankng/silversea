# Case 2026-10-16-FB043-R1 — dispatch assignment-cell band was dead code

Card `141026001010-fb043-bang-dong-khong-deu-regression` re-reported FB-043:
`/dispatch-detail` rows render uneven.

## Repro

1. Open `/dispatch-detail` at a desktop width (container ≥ 901px).
2. Starve the Điều phối (assignment) column — a long carrier name, plate, or
   driver name.
3. Read the cell.

- Before: the carrier / plate / driver lines wrap onto a second line and are
  hard-clipped, and the plate·driver pair stacks instead of riding one line.
  The row height itself stays uniform, so the defect reads as a ragged,
  unreadable cell rather than a tall row.
- After: each value line is one ellipsized line (full text on `title`) and the
  plate·driver pair stays on one line, matching every other column.

## Root cause

`DispatchPlanEditorCell.css:21` opens `@container (min-width: 901px)` and
declares the one-line ellipsis law on **bare class names** —
(0,1,0):

```css
.dispatch-assignment-cell__carrier,
.dispatch-assignment-cell__plate,
.dispatch-assignment-cell__driver,
.dispatch-assignment-cell__estimate {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  overflow-wrap: normal;
}
```

Two base rules later in the same file carry the *same* (0,1,0) specificity and
therefore win on source order:

```css
/* :84-91 */ .dispatch-assignment-cell__plate { … overflow-wrap: anywhere; white-space: normal; }
/* :39-40 */ .dispatch-assignment-cell__vehicle-group { flex-wrap: wrap; }
```

So the band was dead code. The row HEIGHT still held — `.dispatch-assignment-cell`
keeps its fixed height plus `overflow: hidden` — which is precisely why every
pre-existing pin stayed green while the regression survived: they assert the
declarations are *present*, not that they *win*.

## Expected

In the table band, each value line is one ellipsized line and the plate·driver
pair stays inline; the ≤900px card bands keep their own wrapping shape.

## Fix

Scope the band selectors under `.dispatch-assignment-cell` to lift them to
(0,2,0) so they outrank the base rules regardless of source order. Dropping
them back to bare class names is the defect.

## Pin

`frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.rowheights.styles.test.ts` —
`scopes the assignment-cell band above the base rules it must beat`. It fails
if a bare-name selector returns to the band.

Verified failing-before / passing-after: reverting only the CSS fails the new
pin while all 10 pre-existing pins still pass.