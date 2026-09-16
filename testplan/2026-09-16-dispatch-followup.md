# Dispatch local regression follow-up — 16 September 2026

Scope: dispatcher master/detailed planning. Preserve existing allocations and editor drafts; do not create approval steps.

## DSP-FU-001 — Background refresh preserves master-plan note draft
1. Open `/dispatch`, edit an operational note, and type two unsaved lines.
2. Wait for the 30-second refresh or switch away and return to the browser.
3. Expect the editor, caret and draft to remain present while fresh rows load; cancel restores stored notes.
4. Repeat with the note-detail dialog. Explicit filter/page changes may show loading.

## DSP-FU-002 — Truck presence uses the Vietnam business day
1. Run the app with a machine timezone ahead of Vietnam near midnight (e.g. Singapore 00:30, Vietnam 23:30).
2. Open `/dispatch` and inspect the zone-presence date and `Hôm nay` filter.
3. Expect both to use the same Vietnam date, not the machine date.

## DSP-FU-003 — Atomic plan save respects assignment filter
1. Open `/dispatch-detail`, filter `Chưa gán biển số`, edit one row and select an internal vehicle; save.
2. Expect the newly assigned row to leave that filtered view and the total/page count to refresh.
3. Filter assigned rows; clear the selected vehicle and save. Expect the cleared row to leave this view.
4. Repeat without a status filter. Expect the row to stay, showing its new plate/driver.

## DSP-FU-004 — Note save failure retains the editable draft
1. Edit the operational note in `/dispatch`, type multiple lines, then force a request failure or stale-version conflict before saving.
2. Expect the draft/editor to stay visible with failure feedback; no silent revert/closure.
3. Retry a successful save and expect the editor to close once; repeated save clicks while pending must not duplicate the request.

Execution: focused regression cases and dispatch unit suite will be recorded under `qa/2026-09-16_prod-local/`; browser interaction belongs to the controller's local role pass. Unit results do not establish browser coverage.

## DSP-FU-005 — Fast facet searches keep the latest result
1. Open detailed-plan filters and a pickup/dropoff/delivery-point picker.
2. Type a broad search, then a narrower search before the first response finishes.
3. Deliver the narrower response first, followed by the older broad response (including a failed older request).
4. Expect the latest suggestions to remain available; closing/reopening the picker must not apply a response from its previous opening.

## DSP-FU-006 — A pre-save refresh cannot undo a successful dispatch edit
1. Open page 2 of `/dispatch-detail` without an assignment filter and start a background refresh; delay its response.
2. Save a changed plate, driver and operational note, receiving a newer row version.
3. Return the delayed refresh with the old row, or reject that old request.
4. Expect the saved values/version to remain, with no stale error or loading skeleton. A fresh background read must use the current page and filters and update counts normally.
5. Repeat on `/dispatch` after saving an operational note or allocation through `replaceItem`.

Unit regressions defer both old and post-save list responses, preserving page 2 while verifying the older success/error cannot replace the saved state.
