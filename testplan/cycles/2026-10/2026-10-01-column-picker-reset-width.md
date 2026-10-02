# QA-AUDIT-UI46 — shared ColumnPicker intrinsic reset width

Environment: local7175/API3002, ADMIN admin, existing shipment list and CUS ledger objects. User authorizes local testing. Never change business records for this display preference.

Repro: at390px open shipment “Bộ lọc”; its shared ColumnPicker presents checkbox options beside “Mặc định”. Before the repair, option content shrinks the reset button and its second word wraps beyond the fixed border. Baseline original: `qa/2026-10-01_comprehensive-audit_ui45-multi-selected-red/01_390-three-real-plan-selections.png`.

1. Inspect folded filter and standalone popover placements at390/768/1440. Reset remains one line inside its border, options wrap within the panel, no document/panel horizontal overflow and control height≤40px.
2. On existing data, toggle a hideable column using the actual checkbox. Pinned identity columns stay unavailable. “Mặc định” becomes enabled and the existing local-storage hidden-column key records the choice. Close/reload/reopen retains that choice.
3. Activate reset using the actual button. Stored choice is removed, default checkboxes return and reset is disabled. Toggle/reset callbacks are unchanged in both placements; Escape/outside dismissal and focus remain existing behavior.
4. Preserve complete selected shipment API bodies before/after and persisted readback. No POST/PATCH/PUT/DELETE business request is allowed by this driver. Keep screenshot-after-click, DOM/computed rectangle assertions, exact command/exit and readback proof.
5. Focused ColumnPicker/useHiddenColumns/column-visibility/FilterDropdown regressions plus CSS owner guard, types/lint/UI checks. Full affected gates belong to controller after combined source quiet.

Not covered: business mutation, every ColumnPicker host/long label dataset, other roles/staging; route screenshot coverage is a separate final manual acceptance.
