# Shared date/time regression follow-up — 16 September 2026

Scope: shared date/time controls used by CUS and điều vận. Preserve the existing explicit **Xong** time-picker completion and date-picker behavior. No commits or deployment.

## SHARED-FOLLOWUP-001 — Enter belongs to the open time picker

1. Open CUS `/shipments`, edit a row's schedule, and click its time input.
2. Type an exact valid time in the outer time field and press Enter while its picker is open.
3. Repeat with an incomplete or invalid time.
4. Repeat the first step inside the container schedule editor and the dispatch time filters.

Expected: Enter dismisses the open picker, preserving the typed value, and does not submit or dismiss the surrounding editor. Invalid input gets its field feedback and stays invalid. An explicit parent Save is still required. When the picker is already closed, a valid field retains the existing parent keyboard behavior. A caller-provided Enter handler can still take control. List selections remain open until Xong.

Unit coverage: `frontend/src/design-system/forms/TimeInput.test.tsx`.

Execution evidence is stored under `qa/2026-09-16_prod-local/`. Browser execution is assigned to the controller; unit results are not an end-to-end UI claim.

## SHARED-FOLLOWUP-002 — Current compact control contracts

- Required split datetime fields expose native required/invalid semantics on both date and time inputs.
- Input, date, time, select and button geometry comes from the shared `data-uui-control` boundary. Compact and coarse-pointer sizes remain separate tokens.
- The stylesheet guard rejects actual page-level UUI size overrides, while accepting native-input selectors that explicitly exclude UUI children with `:not(...)`.
- Driver payslip amounts use the shared font without a tabular-numeral feature unsupported by the bundled font.

## SHARED-FOLLOWUP-003 — CUS workboard date editing and state

- Enter `DD/MM/YYYY` through date filters and container schedule fields, and assert ISO dates/timestamps in requests.
- Date shortcuts announce selection with `aria-pressed`; all remain actionable so repeated activation can clear local invalid text.
- Missing-information disclosure expands to the complete actionable list; the compact vehicle state uses actionable row editing without repeated explanatory prose.

These cases replace obsolete native-date/single-datetime and utility-class assumptions in existing unit tests; they retain API payload, permissions, actionable disclosure and validation assertions.

## SHARED-FOLLOWUP-004 — Responsive layout contracts follow the shared controls

1. Check the CUS detail toolbar at desktop, tablet and phone widths. Advanced filters collapse behind their disclosure below 1000px; opening it exposes every field without an extra card or compounded outer gutter.
2. Check phone records: related values share two columns, long identity/route/notes/status content spans the row, and an opened editor uses the full width.
3. Check shared input/select/combobox boundaries: the outer control owns height, inner native inputs do not add a second height floor, and touch action targets remain usable.
4. Focus a field near the viewport edge: the authenticated document/root remain clipped while the app body remains the scroll owner. Login keeps its normal document flow.
5. Check date placeholders retain the meaningful `DD/MM/YYYY` format hint. Uppercase placeholder prose such as `MST` and `MÃ` remains rejected by the casing contract.

Expected: contracts protect the current compact responsive design and shared geometry instead of restoring obsolete hardcoded heights, repeated mobile labels/gutters, or programmatically scrollable viewport layers. Browser verification remains assigned to the controller.
