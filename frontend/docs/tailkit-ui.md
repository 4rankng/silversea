# Tailkit UI — pattern reference

Tailkit is a **paid design reference** for this repo. It is not a component library we install.

Look things up here, take the *layout idea*, and rebuild it in house tokens. Tailkit's class names
never reach the repository.

This is the standing ruling in the design law book: `docs/design-guidelines.md` §9 — "d-* (daisyUI 5)
primitives are sanctioned house primitives … tailkit + untitledui catalogs remain the design
REFERENCE and the source for new primitive patterns". The component *source* is Untitled UI PRO —
see [`untitled-ui.md`](./untitled-ui.md). Both are mandatory to consult for a UI/UX problem; this
file is the Tailkit half.

## How to look things up

**1. Get a real id first.** Tailkit ids are **plural** and cannot be guessed — `a-c-tables-13`, not
`a-c-table-01`. Guessed ids return "No components found".

```
mcp__tailkit__browse_catalog(level="packages")
mcp__tailkit__browse_catalog(level="categories", package="application-ui")   // layouts | components | pages
mcp__tailkit__browse_catalog(level="subcategories", package="application-ui", category="components")
mcp__tailkit__browse_catalog(level="components", package="application-ui", category="components", subcategory="tables")
```

`mcp__tailkit__search_components` also works when you can describe the pattern ("sidebar with
grouped nav items and a footer account block").

**2. Pull the code for the idea.**

```
mcp__tailkit__get_component_code(identifier="a-c-navigation-01", tech="react")
```

**3. Retokenize** using the checklist below.

## Why it is not paste-compatible

Measured against this repo on 2026-09-28 by sampling eight components: `a-c-alerts-01`,
`a-c-form-elements-01`, `a-c-tables-01`, `a-c-modals-01`, `a-c-navigation-01`, `a-c-cards-01`,
`m-s-hero-01`, `m-s-pricing-01`.

| Tailkit depends on | This repo | Result if pasted |
|---|---|---|
| `bg-secondary-50`, `text-secondary-700`, `border-secondary-200` … a full `secondary-{50..900}` ramp | **absent** — no `--color-secondary-*` exists; `bg-secondary-50` matches nothing in the built CSS | Component renders **colourless**. Silent, not an error. |
| bare `bg-secondary` / `text-secondary` | **collides** — daisyUI `nepo` defines `--color-secondary: #4D5852` (`frontend/src/styles/tokens.css`) | Tailkit's intent silently becomes a desaturated grey-green. |
| `@headlessui/react` (modals, popovers) | not installed | Build break. |
| `hi-micro` / `hi-solid` / `hi-outline` (Heroicons CSS classes) | not installed | Inline SVG still draws; the size/stroke classes are inert no-ops. |
| `dark:*` variants | app is light-only; `.dark-mode` is never set | Compiles to dead CSS. |
| `font-['Caveat']` and other font stacks | Caveat not loaded | Falls back silently. |
| `rounded-*`, `shadow-xs`, `bg-white`, `font-sans` | resolve — radius values match Tailwind defaults, and `font-sans` resolves to Be Vietnam Pro | ✅ fine |
| `bg-linear-to-tr`, `py-1.75`, `h-200`, `ring-3` | Tailwind v4 idioms; we run 4.3.0 | ✅ fine |

The first two rows are why there is no `--color-secondary-*` bridge in our theme on purpose. Adding
one would be easy, but `bg-secondary` already resolves to daisyUI's `nepo` secondary — so the
numbered bridge would sit one step away from a silent colour collision, in a codebase whose entire
colour surface is ratcheted for exactly that class of bug.

## Port checklist

Work down it before the code leaves your editor.

1. **Colours.** Replace every `secondary-*` with house tokens: `--surface` / `--surface-2` /
   `--surface-3` for fills, `--line` / `--line-2` for borders, `--ink` / `--ink-2` / `--ink-3` for
   text. Accent actions use `--brand` / `--brand-hover`, signals use `--success-*` / `--warning-*` /
   `--error-*` / `--info-*`.
2. **Delete every `dark:*` variant.** This product is light-only.
3. **Icons.** Map `hi-*` Heroicons to `@untitledui/icons` (exact PascalCase names from
   `mcp__untitledui__search_icons`) or `lucide-react`.
4. **Behaviour.** Replace `@headlessui/react` with React Aria, or better, compose the existing shared
   primitive in `frontend/src/design-system/` — the house pattern is one implementation per
   concept, not a new library.
5. **Re-check the house laws** in `docs/design-guidelines.md`:
   - §1 — no pill radii; buttons and badges are small-radius rectangles, never `rounded-full`.
   - §3 — **flat surfaces**: no `box-shadow` elevation on cards or panels. Tailkit leans on
     `shadow-xs`; the house law forbids it.
   - §5 — control sizes. The ceiling is **40px** (`--control-max-h` → `--control-touch-h`), pinned by
     `frontend/src/components/control-density.styles.test.ts`. Note this **supersedes** the 44px
     figure in the `tailkit-ui` skill overlay, which predates the 2026-09-27 operator ruling.
   - §11 — the anti-pattern table, checked row by row.
6. **Vietnamese copy, real data.** Tailkit ships English lorem; the product is Vietnamese
   (`"lang": "vi"` in `public/manifest.json`).
7. **Guardrails.** New files stay ≤ 400 LOC or take a reviewed entry in
   `frontend/src/tests/structure.guard.test.ts`. Raw hex, off-ladder radii, raw shadows and new
   `@media` widths are ratcheted by `pnpm --dir frontend design:drift` — the baseline may fall,
   never rise.

## Worked examples in this repo

The pattern is already established. These took a Tailkit layout and retokenized it — read one before
porting anything new:

| File | Tailkit origin | What it became |
|---|---|---|
| `frontend/src/components/shared/Banner.tsx` | `a-c-banners-01` | Persistent page-top banner, retokenized. |
| `frontend/src/components/shared/CommandPalette.tsx` | `a-c-command-palettes-07` | Cmd/Ctrl+K palette. |
| `frontend/src/design-system/Tabs.tsx` | MCP audit (T5) | daisyUI-native segmented group — explicitly *not* a Tailkit snippet; the API rationale is recorded in the file header. |
| `frontend/src/design-system/Sparkline.tsx` | `a-c-statistics-11` | Hand-rolled SVG, no chart dependency. |
| `frontend/src/design-system/EmptyState.tsx` | MCP audit (T1) | Shared empty-state resolver. |
| `frontend/src/components/UI.tsx` | `a-c-statistics-11` pattern | Stat tile, hand-rolled SVG. |

### A port that was measured and refused

`/shipments` phone control plane (card `20260928_161`, commits `bff253ce` · `8c85ec9b` · `3344e5e4`)
consulted `a-c-page-headings-03` and `a-c-tabs-01` alongside Untitled UI PRO `filter-bar`. Both
suggested fixes for the operator's "component too oversize compared to text" complaint were then
measured and **rejected**, and the rejections are recorded in `ShipmentsPage.css` so the next
session does not re-attempt them:

- Shrinking the actions to 36px fails — 40px is the touch floor (`--control-max-h` →
  `--control-touch-h`) and the `tapFloor` design-lock measures against it.
- Enlarging the heading to Tailkit's `text-2xl` rhythm fails the same way round: at 14px the
  heading is 127px and the heading + action cluster + gap is 359px inside a 372px row; at 16px it
  is 145px and 377px, so the cluster wraps and the control plane went 96px → 125.2px. Tailkit's
  own heading block only works because its buttons do not share the line at that width.

A catalog is a reference, not an oracle. The measured number won both times, and the losing
option is written down next to the code so the next port starts from the measurement.

## Reporting

Say which component you looked at, by id, in the handoff — e.g. "modelled on `a-c-navigation-01`,
retokenized to `--surface-2` / `--line`". A UI decision with no catalog consultation and no stated
reason is incomplete; see the design-provenance rule in `AGENTS.md`.
