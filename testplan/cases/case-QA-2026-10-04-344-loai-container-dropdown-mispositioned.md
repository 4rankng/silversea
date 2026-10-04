# Case QA-2026-10-04-344 — Loại container dropdown mispositioned (card 20261004_344)

## Claim
On `/shipments/new` (and edit shipment surfaces), focusing or typing into "Loại container" (e.g. typing "20") opens the suggestion listbox directly underneath the active input cell.
1. The dropdown listbox renders immediately below the input field and follows the scroll position.
2. It does NOT float 165–215px above the input or anchor under "Thông tin hàng" header overlapping "Loại hàng".
3. Visual anchoring works identically whether focused via mouse click or via Tab hand-off from "Số container".

## Reproduce (pre-fix defect)
1. Log in to https://vantai.tingting.vip with `thanhdc` / `Abc123`.
2. Go to `/shipments/new`. Click into "Số container", press Tab to "Loại container", type "20".
3. Listbox opens, but appears ~165-215px above the input, fixed under header "Thông tin hàng", overlapping "Loại hàng".
4. If the page is scrolled so the header is out of view, the dropdown opens off-screen, giving the impression autocomplete is broken.

## Expected behavior
The dropdown listbox renders directly below the active "Loại container" input field.

## Root Cause
`ContainerTypeCellPicker.tsx` had `popoverPlacement="top"` hardcoded. This was originally introduced in commit `fd9ccce2` to avoid covering an old external "+ Thêm" button below the input. When "+ Thêm" was moved into the listbox in commit `d0ba0a22`, `popoverPlacement="top"` was unintentionally retained, causing the popover to open upward into headers and previous fields.

## Verification
- Unit test in `frontend/src/features/shipments/create/ContainerTypeCellPicker.test.tsx` verifying default bottom placement and positioning below the trigger.
