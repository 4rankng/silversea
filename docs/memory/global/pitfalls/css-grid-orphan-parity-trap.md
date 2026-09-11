---
name: "css-grid-orphan-parity-trap"
description: "Contains the CSS nth-child/display:none orphan trap in filter grids and the cross-lane CSS coordination convention from the 2026-09-09 responsive audit"
folder: "global / pitfalls"
tags: []
updatedAt: "2026-09-09T16:00:14.441Z"
author: "Backend Developer"
---

# CSS grid orphan parity trap (responsive audit 2026-09-09)

## The trap
In a 2-col filter grid, `display:none` siblings still count for `:nth-child`, so "span the odd orphan" rules miss the real orphan. The expense filter bar's divider div sits between controls and is display:none at ≤1023px; the trailing date (visually last + alone) is `:nth-child(6)` = even, so `:last-child:nth-child(odd)` never fires. Conditional JSX elements (reset button) also change the count between renders.

## Fix pattern
Target by class/type, not position parity: `.expense-filter-bar > input[type='date']:last-of-type { grid-column: 1/-1 }` (landed 58cf20b1). Prefer class-based selectors for orphan-spanning in filter grids; verify with a live DOM probe at the target viewport (768) — screenshots of loading states lie (salary page's half-width empty panel was a transient loading artifact, not a layout bug).

## Coordination convention that worked
Cross-lane CSS files (WorkflowFinance.css, record-table.css, UuiSelectField) get a NOTES.md flag with the exact proposed lines + owner ack instead of direct edits; the owning lane lands them with its own style-contract extensions (see 49269def, a9d3427d). Style-grep contract tests exist per pattern — run them before/after editing any pinned stylesheet. Full-suite failures during the program were concurrent-run flakes (three lanes + QA sharing one tree): re-run isolated + once on a quiet tree before diagnosing.

## Addendum (same program, size-consistency pass)

- **Vite HMR poisons layout verification**: a CSS edit applies instantly to the open page, so measuring "current HEAD" behavior while holding uncommitted edits measures YOUR EDITS. Staging QA measurements of the pushed build are the ground truth; local re-verification must stash or account for dirty state.
- **UUI select trigger precedence**: `.ds-uui-select__control button` (component rule) outranks a plain single-class page selector on the trigger button. Page-level overrides must use the shape `.my-surface .ds-uui-select__control button.my-marker-class` (empirically verified via injected-style probes at each band). Always probe with a throwaway `<style>` + measure before committing page-CSS that targets shared component internals.
- **One control-height scale per toolbar** (program addendum 2026-09-09): siblings = same computed height; use `--filter-control-h` (30px desktop / 44px ≤767 via tokens.css) and add explicit ≤1023 band rules where a toolbar's component children have their own floor. Pattern landed in 989e1e0b (payables-fuel-invoices.css).
