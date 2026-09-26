# Case QA-2026-09-26-03 — Mobile touch/text floor sweep (all device sizes)

Source: user request "polish UI UX of this app for all mobile device sizes",
2026-09-26. Executed with the full route×width sweep harness
`frontend/mobile-ux-sweep.mjs` (3 roles × 9 widths 360/390/414/430/600/768/820/1024
+ 1440 desktop control × ~64 routes).

## Scope

Frontend-only. No API/schema/RBAC/financial change. Baseline audit artifact:
`qa/2026-09-26_mobile-ux-sweep/findings-baseline.json`; post-fix artifact:
`qa/2026-09-26_mobile-ux-sweep/findings.json`.

## Law basis

- `docs/design-guidelines.md` §5: **44px touch targets on mobile** (card
  20260922_26, 2026-09-22) + 11px label floor; supersedes ticket 6770b9cb
  (2026-09-10, "30-32px phone scale") — later law wins.
- `frontend/docs/design-system.md` control-density contract: **height is owned
  by the shared primitive, never page CSS**; narrow-screen minimum 44px.

## Bugs covered (all measured in-browser before/after)

| # | Defect (baseline measurement) | Fix |
|---|---|---|
| 1 | Hamburger `.topbar__toggle` **32×44** on 52 routes at ≤600 — the primary nav control under the floor | `responsive.css` phone block → `44×44` (`var(--control-touch-h)`) |
| 2 | Header/page action buttons **30px** (`responsive.css` `.page-actions .btn…` out-specifying `Button.css`'s phone floor — /users showed `132×30`) and **40px** (`ExpenseListPage.css` page rule) | Rule raised to `var(--control-touch-h)`; page rule's `min-height` removed |
| 3 | `/profit` buttons **30×… at every width** — `.workflow-profitability__controls .btn` (0-2-0) owned height, beating every shared floor | Page rule reduced to `padding-block: 0`; systemic `#root .btn` ID-scoped guard added in phone + `pointer: coarse` + tablet bands (min-height AND min-width) |
| 4 | Every UUI combobox input a **16–34px strip** centred in the 44px field: tapping above/below the strip **opened the list WITHOUT focusing the input — next keystrokes went nowhere** (probe: `active=MAIN`, `inputVal=""`) | `combobox.css`: wrapper `align-self: stretch`, input `height: 100%`, root `padding-block: 0` on touch → strip **42/44**, tap top/mid/bottom all focus+type |
| 5 | `.expense-add-btn` ("Thêm mới", /expenses/new) **88×32** at phone | Phone/coarse override → 44px (desktop keeps 32px compact) |
| 6 | `/recoverable-costs` 73× unstyled `<small>` at **9.6px** + 2× dates at **8.8px** (UA `small{font-size:smaller}` — below the 11px label floor) | `.recoverable-costs-page small{font-size:var(--text-caption-size)}` |
| 7 | `/finance` y-axis unit `tr₫` `fontSize="9"` | → `fontSize="11"` (house 11px floor) |
| 8 | Collapsed sidebar icon rail @1024: `.sidebar-item` **39×44** on 61 routes (4px gutters inside the 48px rail; iPad-landscape default is `sidebar-closed`) | Coarse-pointer only: nav/footer `padding-inline: 0` → items **47×44**; fine-pointer desktop unchanged |

## Regression pins

- `frontend/src/styles/mobile-touch-floor.styles.test.ts` (8 cases) — pins
  every fix above (hamburger, three `#root .btn` guards, action-button floor,
  expense page/add buttons, combobox stretch + height + padding, recoverable
  small, chart tspan).
- Updated existing contracts honestly:
  - `operational-density.styles.test.ts` — dropped the stale `height: auto`
    fragment (it pinned the 16px strip); `min-height: 0` + `padding-block: 0`
    one-boundary contract kept, now asserts `height: 100%`.
  - `overlay-surface.styles.test.ts` — registry followed the popover
    extraction (`AccountingDebitClosePage` → `DebitFilterDropdown`, caae1031);
    the surface fill lives in the extracted module.

## Repro steps

1. `cd frontend && node mobile-ux-sweep.mjs` (needs local dev stack) →
   compare `qa/2026-09-26_mobile-ux-sweep/findings.json` against
   `findings-baseline.json`. **Final (run C) result:** baseline
   `clipped=1174 small=3424 tiny=253` → **`small=95`, clipped=0, tiny=0,
   hscroll=0, offscreen=0, pageerrors=0** — and all 95 remaining `small`
   samples classify as the two documented residual classes below (68 inline
   table links, 22 fleet-tire links; OTHER=0).
2. 360px, /my-penalties: tap the combobox field at top-3/bottom-3/mid —
   input must focus, list expand, and a keystroke must land in the input.
3. 360px, /dashboard: hamburger measures 44×44.
4. 360px, /users + /expenses: header action buttons ≥44px tall;
   /profit buttons ≥44px; /expenses/new "Thêm mới" ≥44px at phone.
5. 360px, /finance: no `tspan` under 11px. /recoverable-costs: no `small`
   under 11px (`n=79 under11=0`).
6. 1024px + touch, /dashboard: `.sidebar-item` ≥44px wide.

## Expected

Every interactive target on phone/tablet widths meets the 44px floor (or the
bordered-field equivalent), every rendered text ≥11px, no horizontal scroll,
no clipped text — with desktop density (30–34px compact) untouched.

## Known residuals (deliberate, documented)

- Date-segment inputs `20.5×44` — **not a defect**: `.date-seg-group` owns a
  group-level click-opens-picker handler over the full 44px field (segment
  padding polish already landed as card 20260924_10); geometry detector
  now exempts bordered field shells.
- Inline text links inside dense tables (`/accounting`, `/config/trucks`)
  render `~84×15` — flagged by the sweep; fixing requires padding that
  inflates data rows (density law §5 conflict). **Needs operator ruling**
  before touching.
- `.fleet-tire-link--empty` `94×42` (2px under) — same density call.
