# CUS shipment creation: protect visible drafts

## CUS-DRAFT-001 — Cargo-mode switch protects incomplete appointments

1. On `/shipments/new`, enter only `14:` in a container time input (or only an incomplete date).
2. Switch to Hàng lẻ with mouse or keyboard.
3. Cancel the confirmation, then try again and confirm.

Expected: the first switch asks before discarding that visible draft. Cancel retains the same mode and text; confirming resets mode-specific cargo data. In LCL, incomplete date/time or additional-date text receives the same protection. A valid shared shipment schedule that remains in the model does not cause an unnecessary discard warning.

## CUS-DRAFT-002 — Every discarded LCL cargo value is guarded

1. Start with Hàng lẻ and enter only cargo weight, or select only a pickup warehouse.
2. Switch to Hàng nguyên container.

Expected: explicit confirmation before clearing the entered cargo value. Cancel preserves it. An entirely pristine mode switch remains direct.

## CUS-DRAFT-003 — Row deletion protects only that row's draft

1. Add a second empty container. Type an incomplete date/time into the first row.
2. Delete the first row; cancel, then confirm.
3. Repeat on a fresh form, but delete the second empty row instead.

Expected: deleting the edited row requires confirmation and Cancel preserves its text. Deleting a different empty row is direct and retains the first row's draft.

## CUS-DRAFT-004 — Notes are shipment data, not cargo-mode data

1. Enter distinct customer and driver notes.
2. Switch FCL → LCL → FCL, with and without cargo data requiring confirmation.

Expected: both notes and shipment identity survive mode switching. Only the data named by the cargo-mode discard confirmation resets.

Unit regressions: `ShipmentCreateWorkspace.mode-toggle.test.tsx`. Controller owns local browser execution; evidence under `qa/2026-09-16_prod-local/`.
