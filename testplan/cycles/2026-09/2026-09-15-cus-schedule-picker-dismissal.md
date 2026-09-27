# CUS schedule quick-edit: time-picker must not dismiss the dialog (card 20260915_6)

User-reported (screenshot 2026-09-15, staging /shipments): the "Chỉnh sửa Lịch trình"
dialog closed mid-edit while picking time then date; the selection could not be saved.
P1.

## Reproduction (pre-fix)

1. Login CUS (e.g. `thanhdc` / `Abc123`) → `/shipments`.
2. Click cell control "Sửa ô lịch trình lô hàng …" → dialog "Chỉnh sửa Lịch trình" opens.
3. Click the Giờ input → desktop TimePickerSurface panel opens (portaled to `document.body`).
4. Click any time pill — or the panel itself.
5. PRE-FIX: the dialog closed immediately (selection lost, nothing saved).

## Root cause

`useClickOutside(quickEditFormRef, closeQuickEdit)` on `ShipmentsPage` treated
pointerdown/mousedown inside the portaled picker panel as an outside click
(the panel is a `createPortal` child of `body`, outside the `<form>` ref), so
picking a time dismissed the draft. The DateInput "Ngày" is a native
`<input type="date">` (browser chrome, no DOM events) — the time panel was the killer.

Fix follows the established pattern (ShipmentContainerLedger editor
`72725707`, CusAppointmentPopover): extend the call-site `ignoreSelector`
with the TimePickerSurface surface classes
`.time-picker__popup / __overlay / __sheet / __inline`.

## Regression cases

| ID | Requirement | Expected proof |
|---|---|---|
| CUS-QE-01 | pointerdown/mousedown anywhere inside a TimePickerSurface surface (`.time-picker__popup` desktop, `__overlay`+`__sheet` mobile, `__inline`) while the schedule quick-edit dialog is open | Dialog stays open, Giờ draft remains editable. Automated: `frontend/src/pages/ShipmentsPage.test.tsx` → "keeps the schedule dialog open when the desktop time-picker panel is clicked (card 20260915_6)" |
| CUS-QE-02 | Full user flow: open dialog → pick time pill → pick date via native picker → "Lưu thay đổi" | Dialog closes only on save; saved schedule persists (API/DB shows the new time+date). Verified by direct Chrome drive; artifact under `qa/` |
| CUS-QE-03 | True outside click (modal backdrop / outside the dialog) still dismisses the draft; Escape still dismisses | Pre-existing dismissal contract unchanged (`.modal__content` stays in ignoreSelector; overlay owns backdrop) |

## Validation

Focused: `cd frontend && npx vitest run src/pages/ShipmentsPage.test.tsx -t "20260915_6"`.
Full gates + QA artifacts under `qa/2026-09-15_cus-schedule-dialog_*`.
Rung-3 (UI DRIVEN) evidence for CUS-QE-02: screenshot + DOM assertion + API/DB
side-effect proof + driver log, local dev first, staging after cut deploy.
