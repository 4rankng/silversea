# Regression case QA-2026-09-22-02 — Tuyến đường filter chrome: wasted bands + fat search bubble

- **Case ID:** QA-2026-09-22-02
- **Reported:** 2026-09-22, operator screenshot ("what the shit is this design")
- **Surface:** `/config/routes` (RoutesConfigPage + shared `FilterBar.css` chrome — card 20260922_38 adoption)
- **Status:** repro captured (before-fix screenshot 55), fix in progress

## Repro (first try, local http://localhost:7175)

1. Login `admin`.
2. Navigate to `Cấu hình → Tuyến đường` (`/config/routes`).
3. Type any non-matching query (e.g. `zzz-abc-9999`) in `Tìm tuyến đường…`.

## Expected

Flat, dense filter chrome directly above the table (nepocorp `ListFilterBar.css`: `border: 0`,
`gap: 12px 24px`, `margin: 0 0 16px`): one search control with small radius (`--r-sm` family, house
~8px), a single clean focus ring (`outline: 2px solid <focus>` + border-color change — NO double
ring/halo), immediately followed by the table header. No empty horizontal bands between the search
and the table. No-results renders the shared `<EmptyState variant="compact">` face
("Không có tuyến đường phù hợp.") — law §6: no-data / no-selection / no-results render the same way
everywhere.

## Actual (pre-fix)

The search renders as a large-radius (10px) bubble on `--surface-2` with a double focus treatment
(`border-color: var(--accent)` + `outline: 2px solid var(--accent-soft)` + 2px offset = halo); the
shared `.filter-bar` chrome adds `border-block` double rules + 12px padding + 20px bottom margin,
producing empty full-width bands between the search and the table header; the whole area reads as
unfinished scaffolding (screenshot 55).

## Root cause

`FilterBar.css` chrome drifted from the reference it was modeled on: banded `border-block` surface
instead of flat, 10px bubble radius + accent-soft outline halo instead of `--r-sm` + one ring,
generous margins. Plus `.filter-pill__count` still carries `border-radius: 999px` (ticket 20260922_48 —
fixed in the same pass).

## Fix contract (what makes this case pass)

- `.filter-bar`: flat (no `border-block`), `gap: 12px 24px`, `margin: 0 0 16px`, `padding: 0`.
- `.filter-bar__search`: radius ≤ 8px, `--control-border` border, `--control-bg` background, focus =
  ONE 2px ring + border-color change (no `--accent-soft` outline).
- `.filter-pill` / `.filter-tab`: radius 8px (§1: buttons are rectangles ~8px radius);
  `.filter-pill__count`: no 999px (ticket 20260922_48 closes with this).
- Verified visually at 1280/1440/1920/2560 on `/config/routes` with a no-results query (empty face
  renders, chrome flat) AND on every other `.filter-bar` host (component-surface sweep gate 6:
  CustomersConfigPage, FactoriesConfigPage, any legacy `.toolbar`/`.filter-tab` hosts).
