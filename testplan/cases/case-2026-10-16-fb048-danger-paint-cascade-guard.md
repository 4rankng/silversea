# Case 2026-10-16-FB048-R1 — FB-048 re-report: no defect found, cascade verified

Card `141026003600-fb048-verify-fail-red-border-regression-persists` re-reported
FB-048: an invalid select shows a neutral border at rest; the red boundary
appears only on focus/open.

## Finding: the defect is NOT present in current source

The 2026-10-14 fix (73617a2f) is present and genuinely holds. Traced by hand,
because the existing pins are source-text only and cannot see the cascade:

1. **The attribute is on the boundary element that owns the visible border.**
   `select.tsx:41-44` — `<AriaButton data-uui-control="select"
   aria-invalid={isInvalid || undefined}>`; `combobox.tsx:98-103` — the same on
   the `AriaGroup`. Not a hidden inner node.
2. **`border-error` is emitted unconditionally in the invalid branch** — no
   longer gated on `isFocused || isOpen`.
3. **The rule that actually paints is in `base.css`, not `Input.css`.** The
   UUI trigger has no `.input` class, so `.input[aria-invalid="true"]`
   (`Input.css:48-50`) can never match it. The painter is
   `base.css:139-156`, which names `[data-uui-control='select']
   [aria-invalid='true']` and `[data-uui-control='combobox']
   [aria-invalid='true']`, painting `var(--danger)` (`#A0444E`).
4. **The neutral rule cannot repaint over it.** `base.css:131-137` is the only
   higher-specificity competitor and its trailing `:not()` excludes
   `[aria-invalid='true']`, `.border-error` and `:has([aria-invalid='true'])`.
5. **Error still wins over focus** — the two branches are mutually exclusive
   ternaries, so `border-brand` and `border-error` never co-render.

Call sites were checked too: every invalid-capable select goes through
`UuiSelectField`, which passes `isInvalid={invalid ?? Boolean(error)}`
(`UuiSelectField.tsx:141`, `:177`). The direct `<UUISelect>` usages are
validation-free filters (Đội xe, Loại rơ-moóc, Tuyến đường, Khu vực) that have
no invalid state, so no border is owed.

## Why this card still gets a commit

The gap was in the guard, not the paint. Every pre-existing pin asserts the
COMPONENT emits `border-error` + `aria-invalid`; none asserts that the danger
rule still reaches the border. Deleting `[data-uui-control='select']
[aria-invalid='true']` from `base.css` restores the reported defect exactly —
neutral border at rest — with all 14 pre-existing pins still green.

So the two new pins guard the half that actually paints, and fail on precisely
that regression (verified: 1 failed / 14 passed).

## Coverage limit

This is a source-and-cascade verification, not a driven UI check. No live
invalid-select surface was exercised in a browser, so the claim is CODE-READ +
CSS-cascade-traced, not UI DRIVEN. If the re-report was seen on a specific
screen, that screen's repro would be needed to confirm which surface — the
underlying paint is correct on every invalid-capable surface found.

## Pin

`frontend/src/components/untitled-ui/base/form-control-boundaries.test.ts` —
`the house danger paint covers the select and combobox boundaries` and
`the neutral border rule never overpaints an invalid control`.