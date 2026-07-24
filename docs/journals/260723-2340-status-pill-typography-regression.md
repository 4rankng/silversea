# Status Pill Typography Regression

**Date**: 2026-07-23 23:40
**Severity**: Medium
**Component**: Shared status pills (`Pill.css`, token scale, UI contract)
**Status**: Resolved

## What Happened

The shared status pill text got visibly larger after commit `8ee592f0`. The default `.pill` size was changed from a dedicated `11px` value to `var(--fs-xs)`, and `pill--md` stayed at `var(--fs-xs)` too. That collapsed the intended hierarchy between the compact default pill and the medium header variant, so the two styles started reading like the same thing.

## The Brutal Truth

This was a dumb regression in a shared component. One token swap erased the only size distinction that made the status pills feel deliberate, and the blast radius was bigger than it looked because every page using `.pill` inherited the same flattened typography. It is frustrating in the usual way: a tiny CSS change, a broad UI effect, and then time spent proving that the breakage was real instead of imagining it.

## Technical Details

- Current contract: `frontend/src/components/Pill.css:11` uses `font-size: var(--fs-status-pill)`.
- Token source: `frontend/src/styles/tokens.css:233` keeps `--fs-status-pill: 11px`.
- The regression came from `8ee592f0`, where `Pill.css` changed `font-size: 11px` to `var(--fs-xs)`.
- `tokens.css` also defines `--fs-xs: 12px`, so the swap effectively promoted the default pill to the same size as `pill--md`.
- The regression guard now checks that `Pill.css` uses the compact status-pill token, `tokens.css` preserves the 11px value, and `pill--md` remains on the 12px `--fs-xs` tier.

## What We Tried

- Compared the pre- and post-change `Pill.css` diff to isolate the typography swap.
- Checked the token scale to confirm `--fs-xs` is 12px, which explained the hierarchy collapse.
- Verified the UI contract script includes an explicit pill typography assertion instead of relying on visual memory.

## Root Cause Analysis

The root cause was over-normalizing a component that depended on a smaller, special-case token. The change assumed the shared XS scale was close enough, but that erased the difference between default pills and `pill--md`. In practice, that meant the component lost its size ladder and the whole system looked slightly off.

## Lessons Learned

Shared primitives need explicit contract checks when their visual hierarchy matters. If two variants are only different because one uses a dedicated token, do not "simplify" that token away without checking every consumer. CSS consistency is not the same thing as CSS correctness.

## Next Steps

The code path is fixed and the regression guard is in place. The UI contract, 165 frontend tests, production build, focused lint, and diff check pass. Repo-wide lint remains blocked by unrelated existing QA-script and source errors. I did not do live browser verification here because localhost access was blocked in this session, so the remaining follow-up is to confirm the rendered pills in a normal browser smoke pass when that environment is available.
