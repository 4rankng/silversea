# uiux POLISH verdict — SIL-707 r2 (popover placement top, allocation carrier picker)

Mode: POLISH (small change to an existing surface). Domain file loaded: layout.md.
Scope reviewed: `DispatchAllocationDaySection.tsx` (popoverPlacement="top"),
`UuiSelectField.tsx` + `select.tsx` + `combobox.tsx` (placement passthrough),
`popover.tsx` (side-aware fit cap `fitAboveMaxHeight`).

## Verification (rendered, real surface)
- 1440×900, dialog 'Phân bổ nhà xe' (lot DNKM13336), 2 rows, picker row 1 open:
  overlay data-placement="top", computed max-height 320px, rect 174–494; row-2 combobox
  ('ĐĂNG QUÂN') rect 556–580 → no intersection; nothing past the dialog bottom edge;
  28 options, last option reachable + visible after scroll (measured via scrollIntoView).
- 390×844: placement top, 320px cap, pop 68–388; row 1 399–428; row 2 534–564 → no overlap,
  no escape. (Evidence: qa/2026-11-07-k10/sil731-733-707-708-drive.log + transcript screenshots.)
- Keyboard: react-aria combobox semantics unchanged; Escape closes picker then dialog
  (SIL-577 shell law) — exercised in the drive.

## Findings
None at HIGH/MEDIUM. Escalation triggers reviewed: no clipped/unreachable control (fit cap +
RAC flip floor 96px), no pointer-only path added, no motion-only state change.

## Verdict
**Approve** — SIL-707 r2 UI change lands.
