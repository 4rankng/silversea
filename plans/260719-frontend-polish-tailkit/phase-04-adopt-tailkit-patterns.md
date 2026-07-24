---
phase: 4
title: "Adopt Tailkit patterns"
status: completed
priority: P1
effort: 6h
dependencies: [3]
---

# Phase 4: Adopt Tailkit patterns

## Overview

Land each surviving target as a **production-grade primitive** in the NEPO design system, retokenized, typed, re-exported from the barrel. This phase ships the *primitive layer* only — no page consumes them yet (that is Phase 5).

## Requirements

- **Functional:** each target lands as an exported component in `design-system/` or `components/shared/`, with TypeScript props, retokenized styling, and a demo render in a scratch route.
- **Non-functional:** zero new runtime dependencies. Zero hardcoded Tailwind palette classes. All styling uses NEPO `var(--*)` tokens or daisyUI `d-*` classes.

## Architecture

Two landing zones, decided per target:

- **`design-system/`** — data-display primitives (extended DataTable features, richer Skeleton patterns). Re-export from `design-system/index.ts`. These are "framework-grade" — typed columns, generic props, no domain logic.
- **`components/shared/`** — UI primitives (EmptyState variants, Alert variants, Toast upgrades). Re-export from `components/shared/index.ts`. These are "app-grade" — may carry NEPO-domain flavor (Vietnamese labels, money formatting).

Rule of thumb: if it takes generic `T` data → `design-system/`. If it takes NEPO-specific props (currency, status pills) → `components/shared/`.

## Related Code Files

- Extend: `frontend/src/components/shared/EmptyState.tsx` + `EmptyState.css`
- Extend: `frontend/src/components/shared/Skeleton.tsx` + `Skeleton.css` (if a target lands here)
- Extend: `frontend/src/components/shared/Toast.tsx` + `Toast.css` (if a target lands here)
- Extend: `frontend/src/components/shared/Alert.tsx` (if a target lands here)
- Extend: `frontend/src/design-system/DataTable.tsx` + `DataTable.css` (column visibility / density toggle, if picked)
- Extend: `frontend/src/design-system/forms/*.tsx` (affordances, if picked)
- Update barrels: `frontend/src/components/shared/index.ts`, `frontend/src/design-system/index.ts`
- Update: `frontend/src/index.css` (import any new `.css` files)
- Create: `frontend/src/pages/_designSystemPreview.tsx` (scratch route, dev-only — mounted behind a feature flag or env check; removed before merge or kept as a storybook substitute)

## Implementation Steps

1. **For each target, in priority order:**

   a. **Scaffold the component.** Create or extend the file. Copy the spike HTML structure, convert to JSX, type the props.

   b. **Retokenize in JSX/CSS.** Use the Phase 3 translation table. Inline styles → CSS module-style class names matching NEPO convention (`.empty-state--with-preview`, etc.). Add the CSS to the co-located `.css` file or to `tokens.css`-imported stylesheet.

   c. **Type the props.** Prefer `z.infer<typeof XxxSchema>` from shared where applicable. Otherwise plain TS interface. Vietnamese label props where user-visible.

   d. **Add to barrel.** Re-export from the appropriate `index.ts`.

   e. **Render in scratch preview page.** Add the primitive to `_designSystemPreview.tsx` showing all variants (default, loading, empty, error, mobile-width container).

2. **Lint pass.** Run `pnpm lint` (eslint is configured). Fix any `react-hooks` warnings — Tailkit snippets often inline handlers that violate rules-of-hooks.

3. **TypeScript pass.** Run `tsc -b` (via `pnpm build` dry-run). No `any` escapes; the repo has `__test_no_any.ts` as a guardrail.

4. **Self-review per component.** Check:
   - Does it work at 420 / 640 / 1023 / 1100 px?
   - Does it use only NEPO tokens / daisyUI `d-*` classes?
   - Is keyboard navigation working (focus rings, Escape, Enter)?
   - Are Vietnamese labels correct (no English leakage in user-facing strings)?

5. **Grep guardrail.** Run a project-wide grep for the forbidden classes inside `frontend/src/components/shared/` and `frontend/src/design-system/` only (existing pages may still have legacy ones; out of scope here):
   ```bash
   grep -rnE '(bg|text|border|ring)-(gray|slate|zinc|neutral|stone)-[0-9]' frontend/src/components/shared frontend/src/design-system
   grep -rn 'dark:' frontend/src/components/shared frontend/src/design-system
   ```
   Both must return zero lines for new/modified files.

## Success Criteria

- [ ] Every surviving target is a real exported component, re-exported from its barrel.
- [ ] `_designSystemPreview.tsx` renders all variants and is reachable in dev.
- [ ] `pnpm lint` passes on touched files.
- [ ] `tsc -b` passes (no new errors).
- [ ] Forbidden-class grep returns zero hits in the two landing zones.
- [ ] Each new component has at least one Vietnamese-label variant demonstrated.

## Risk Assessment

- **Risk:** extending an existing primitive (e.g. `EmptyState`) breaks its current callers. *Mitigation:* additive API only — new optional props, new exported variants, never rename/remove existing ones. Keep a smoke test of existing call sites.
- **Risk:** scratch preview page leaks into production bundle. *Mitigation:* tree-shake guard — wrap its route in `import.meta.env.DEV` or lazy-mount under `/__ds` only.
- **Risk:** retokenization drift between Phase 3 spikes and Phase 4 production code. *Mitigation:* reuse the same token-translation table verbatim; paste from spike, don't re-derive.
