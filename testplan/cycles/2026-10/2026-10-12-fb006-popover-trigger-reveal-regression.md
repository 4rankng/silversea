# Regression spec — FB-006 round 16: popover trigger trips the menu-open reveal

**Ticket:** FB-006 (round 16 verify-fail) — card 121026185510; prior card 101026163000
**Owner (implement):** frontend
**Owner (verify):** qa
**Status (this doc):** covered by styles pin + local rung probes
**Cycle:** 2026-10 round 16

## Goal

The prior fix (171b9a75) scoped the *focus-within* reveal away from picker
cells, but the *menu-open* reveal stayed keyed on any `[aria-expanded='true']`
inside the cell. The factory cell's magnifier ("Xem chi tiết nhà máy") is an
in-cell `button` with `aria-haspopup="dialog"` and
`aria-expanded={factoryDetailOpen}` — opening the detail popover made
`:has([aria-expanded='true'])` treat the dialog as an open picker menu: the
picked name hid and the full combobox + Xoá chrome replaced it. The owner's
retest flow (pick → tap magnifier) therefore still showed the exact FB-006
symptom on a build that carried the prior fix.

Fix: scope the three reveal/fade rules to the actual picker-menu trigger —
`[role='combobox'][aria-expanded='true']` (verified live: all five create-grid
pickers are `role=combobox` inputs without `aria-haspopup`; the detail peek is
a plain button).

## Acceptance criteria

### TC-FB006R16-001 — Pick (mouse or Enter) collapses the cell

- **Given** the create-grid factory cell with a committed pick
- **Then** display opacity 1 (name), editor chrome opacity 0, magnifier live.

### TC-FB006R16-002 — Detail popover keeps the name visible (the regression)

- **Given** a picked factory, the magnifier tapped, popover open
- **Then** display stays opacity 1, editor stays opacity 0 — the dialog
  trigger must never reveal the editor chrome.

### TC-FB006R16-003 — Real menus still reveal the editor

- **Given** any picker cell (factory, Loại container, Tuyến, Cảng nâng/hạ)
- **When** its listbox menu opens
- **Then** the editor chrome shows (input role=combobox aria-expanded=true).

### TC-FB006R16-004 — Phone widths follow R14-01

- **Given** ≤620px stacked layout
- **Then** text cells keep inline editors; the factory picker stays collapsed
  to name + magnifier (case 2026-10-11-R14-01 ruling).

### TC-FB006R16-005 — Class sweep

- All 9 picker cells (create ×5, CUS ledger ×4) still collapse after a pick;
  text cells and the Nhà xe free-text cell keep their focus reveal.

## Out of scope

- Any TSX change; UUI internals; the Nhà xe switch cell; staging deploys.
