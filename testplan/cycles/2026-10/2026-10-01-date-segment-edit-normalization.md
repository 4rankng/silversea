# QA-AUDIT-UI55 — existing segmented dates retain native edits until complete

Environment: local7175/API3002, actual existing dates; no business write or new fixture. UI48/UI50/UI53 shared date continuation.

1. Start from01/10/2026 with a real controlled parent. Native Home + Shift + End in the day segment then type33. After first3 keep the visible draft3 and do not emit an ISO endpoint. After second3 keep33, reject it natively, and show the existing date helper after leaving the whole field. Do not silently show03 or change the parent endpoint.
2. Replace the day through the same real key sequence with31 then26. Emit2026-10-31/2026-10-26 only after each two-digit endpoint is complete. Edit month12 and year2027 one key at a time without parent formatting cutting off remaining keys. Preserve independent min/max rejection.
3. Enter a valid shorthand single-digit day/month; moving only between date segments does not commit. Leaving the whole field (or the existing Enter commit path) emits the valid ISO once and normalizes DD/MM/YYYY. Invalid drafts remain visible and cannot silently reuse a prior valid date.
4. Clear every date segment: preserve partial separators while any segment remains, then emit exactly empty. External parent reset displays its new complete date, and actual calendar selection emits the selected date with normal focus restoration.
5. Run meaningful real-component regressions without new mocks, then actual native keyboard correction/clear at390/768/1440, calendar interaction, screenshot/post-click DOM/customValidity, expected parent filter query/state, zero material attempts and unchanged direct Drizzle147-table proof. Preserve failed runs and exact driver command/exits. Catalog/source provenance and separate review hashes accompany the report.

Not covered: staging, all roles/hosts until current full date replay, required business-form Save and successful date persistence. Unit/source assertions do not imply UI DRIVEN.

## QA-AUDIT-UI55-C — both caller commit and calendar cancellation boundaries

1. Render the real controlled DateInput with an existing01/10/2026 parent, a named hidden ISO field and an existing native onBlur callback. Enter3/10/2026: retain the shorthand and old parent while typing; whole-field blur or Enter emits2026-10-03 once, normalizes03/10/2026 and updates the hidden value. The forwarded native blur runs once.
2. Enter33/10/2026 or a date outside min/max. Blur/Enter retains the exact invalid draft/helper and old hidden ISO; no callback is emitted. Complete valid day/month/year, empty clear, external reset and actual calendar selection keep their existing canonical behavior.
3. In each hook caller, open the actual calendar with a valid shorthand draft. Genuine outside pointer or calendar focus exit commits it once. Input Escape, panel Escape, document/BODY Escape and the calendar close button cancel the calendar without committing that draft. A selected calendar date emits only its selected endpoint once. Existing default hook callers still use their original dismiss callback and the topmost/defaultPrevented checks consume only the same Escape.
4. Preserve the pre-fix red run, exact source/test hashes, focused green/type/lint logs, independent review and the actual local native date controls at390/768/1440. All browser actions are draft-only with zero material attempts and the immutable147-table before/after read proof; staging and business-form Save remain uncovered.
