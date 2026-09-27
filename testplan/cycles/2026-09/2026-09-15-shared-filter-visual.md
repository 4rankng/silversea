# Shared controls and filter geometry — 15 September 2026

Scope: shared input, select, combobox, toolbar-search and compact-filter controls. Browser execution belongs to the controller; no automated suites are requested for this delivery.

## SHARED-VIS-001 — A filter row has one control baseline and height

1. Sign in as CUS and open shipment overview and shipment detail list; as Điều vận open detailed planning.
2. At 1440px and 1024px, inspect adjacent search, date and select controls in each filter row.
3. Open a short enum select and a searchable catalog select, choose a long option, then close.

Expected: all controls using the same compact size have the same outer height, including their borders. Labels align above those boundaries. Changing from an enum select to a combobox, or selecting a long value, does not enlarge the row. Long selected values truncate in the trigger and remain readable in the options.

## SHARED-VIS-002 — Phone and tablet controls keep coherent sizing

1. Repeat SHARED-VIS-001 at 390px and 320px; repeat at 820px with a coarse pointer.
2. Focus and type in search/date inputs; open and close the selected-value picker.
3. Inspect control boundaries and dropdown alignment before and after selection.

Expected: no input is taller than its enclosing boundary; no stacked height floors or double padding. Touch devices retain the touch-size floor. Focus does not shift neighboring controls. No horizontal page overflow.

## SHARED-VIS-003 — Shared toolbar search fits its row

1. As CUS open customer catalog and route catalog at desktop, tablet and phone widths.
2. Type a long query, clear it, and focus the search box again.

Expected: search has a visible field boundary, consistent compact height and no 2px extra height from the nested input. Search and toolbar controls wrap in DOM order; search must not jump below unrelated actions merely because it contains an input. Spacers do not create an empty phone row.

## SHARED-VIS-004 — Long select values stay compact and legible

1. Open a single-select catalog containing a long company or route name.
2. Select the long value and inspect a narrow filter cell.
3. Reopen the selector and navigate options with the keyboard.

Expected: trigger is a single line with ellipsis, arrow remains visible, and the option list shows the full label. Multi-select chip content is not cropped by single-select rules.

## Execution status

CODE-READ ONLY in the shared-controls subtask. The controller records browser observations and screenshots under `qa/2026-09-15_full-visual/`.

## SHARED-VIS-005 — Vietnamese date format and a real calendar selector

1. On CUS shipment filters and Điều vận plan date filters, click the date input.
2. Pick a day, reopen the calendar, navigate months, then dismiss with Escape.
3. Type `25/09/2026`, then an incomplete draft and impossible `31/02/2026`.
4. Set a range and try selecting a start after its end (and vice versa).
5. Repeat in a modal and on phone; tab into the field and use Alt+ArrowDown.

Expected: every date field displays DD/MM/YYYY regardless of browser language. The existing calendar opens directly from the field. Incomplete/invalid drafts remain visible and block submission rather than silently preserving a prior date; complete valid entries emit YYYY-MM-DD. Out-of-range days are disabled, input reports the bound, Escape dismisses only the calendar, and focus returns to the field. Selecting a date does not close the containing editor. Clear filters resets both the draft and selection.

## SHARED-VIS-006 — Date picker follows focus and placeholders remain readable

1. Click a date filter to open its calendar, then press Tab to the next filter.
2. Reopen the date calendar and click its month navigation and a day.
3. Inspect empty search/date/select fields on white backgrounds in CUS overview and dispatch filters.

Expected: tabbing outside the date field/calendar closes only that calendar. Moving focus into its calendar does not dismiss it before the click. Placeholder text uses the readable supporting-text color, with no added opacity, rather than the disabled/decorative gray.

## SHARED-VIS-007 — CUS filter rows use the available width coherently

1. Open CUS overview and container detail at 1440px with the sidebar expanded; repeat with sidebar collapsed.
2. Compare the left/right edges of the page header, filters, summary and ledger.
3. At tablet and 390/320px widths, toggle Bộ lọc, change dates/selects, then collapse it.
4. Inspect the expanded date pair, customer/direction/status fields and date shortcuts. Type and clear a search.

Expected: desktop filters use one aligned field row where the available width permits it, followed by the action row. The page adds no second horizontal inset. A compact disclosure opens all secondary filters together; date and short select fields form two columns at narrow widths. The customer field can use the full narrow row. Collapsed filters are not keyboard-focusable; field boundaries and clear/toggle controls use the same compact/touch heights. There is no horizontal overflow or stranded empty row. Relates to controller CUS-VIS-002.

## SHARED-VIS-008 — One date picker across styled and plain date adapters

1. Compare CUS filter dates, shipment-create additional delivery dates, driver fuel-report dates, and a plain DateInput in an expense or catalog form.
2. Click each field, select a date, type an exact DD/MM/YYYY date, then blur an incomplete/invalid draft.
3. Check required and min/max constraints, Escape, Alt+ArrowDown, Tab exit and reset.
4. Repeat at phone/coarse-pointer width, including any modal containing the date field.

Expected: all use the same calendar surface and day target sizes, with no extra calendar trigger button. Visible values use DD/MM/YYYY and application callbacks still receive ISO dates. Invalid drafts remain visible and block submission. Selecting a calendar day does not dismiss its containing form. Existing label associations, disabled/required states, caller CSS and ref focus access remain intact. Expense/salary/config screens that previously used a raw native date input also use this calendar.

## SHARED-VIS-009 — Tablet detail uses a denser filter and record layout

1. Open CUS container detail at 820px and expand Bộ lọc.
2. Inspect records containing a long customer/document name and multiline notes.
3. Open and close a record editor; repeat at 700px and at 390px.

Expected: at least 700px of workspace permits the five secondary fields in one row. Tablet record labels sit above their values rather than consuming a third of each narrow block. Notes span the record and status forms a compact footer. Editors keep their full-row expansion. Phone uses the separate compact layout and does not inherit tablet-only columns.

## SHARED-VIS-010 — Dispatch master phone controls and record grouping

1. Open dispatch master planning at 390px and 320px, including a nonzero advanced-filter count.
2. Inspect the search, direction selector, filter action and create action.
3. Inspect a record with both ports, cargo/allocation and multiline notes; tap its actions and scroll past it.

Expected: full-width search is followed by one compact row containing direction, filters and create. Records pair schedule/customer, give the route its own row, pair lift/drop ports and cargo/allocation, then show notes across the record. No unrelated port/cargo pairs or narrow trailing notes column. Tapping or scrolling does not leave an entire record green; keyboard focus and an actively pressed control remain visible.

## SHARED-VIS-011 — Date shortcuts reset invalid drafts and actions validate visible dates

1. In the CUS schedule editor, start with today's date, type an impossible date, then click Hôm nay. Repeat with the already-active date shortcuts in CUS container detail and dispatch detail filters.
2. In CUS overview and both detail filter surfaces, type an invalid date into a previously empty field, then use the clear/all-dates action.
3. On CUS overview, set a date range and try an inverted range. Type an invalid replacement and click Tìm kiếm or Tải XLSX, including after collapsing Bộ lọc.
4. As an office role permitted to edit ancillary fees, type an invalid replacement invoice date and attempt to save with both the footer and keyboard action.

Expected: presets and reset clear the visible draft even if the applied ISO date is unchanged. Date ranges reject inverted bounds. Search/export reveals and focuses an invalid date instead of acting on the hidden previous value. Ancillary-fee save stays open and identifies the invalid date. Blank shipment appointments remain allowed; incomplete appointments still fail validation. No API payload is sent from a blocked save/export action.

## SHARED-VIS-012 — Compact master summary, details and drawer dates

1. At 390px and 320px, inspect dispatch master summary with 20ft, 40ft, other and LCL counts.
2. Open a record with long operational/factory notes and multiple cargo types. Activate both detail actions.
3. Inspect the container-detail drawer, then repeat at desktop width. Compare its appointment with the same container in planning.

Expected: every summary label stays with its number and punctuation never occupies its own row. Secondary detail links sit beside the relevant content when space permits, retain a 44px touch target, and do not add a separate framed-button row. The drawer uses Vietnam-local HH:mm DD/MM/YYYY. On narrow drawers the ordinal sits beside the container name; STT does not consume a separate row. Desktop preserves its ordinal column.

Additional regression check for changed shared date adapters: in office-only trip create and penalty create, replace a valid date with an invalid draft and attempt custom save/confirm. The save must identify the visible invalid field and remain open.

## SHARED-FLOW-013 — Driver notification resolves the trip, not the fulfillment ID

1. As the assigned driver, open notifications containing a legacy dispatch notification with a shipment_fulfillments reference. Open that notification and compare its trip code with the accepted-journey list.
2. Confirm the destination uses the trip ID even when it differs from the fulfillment ID. Local reported example: TRP-202609-0006, fulfillment5698, trip4258.
3. Dispatch another valid shipment-backed trip and inspect/open its new notification and push destination.
4. Check a legacy notification whose fulfillment is no longer associated with a trip assigned to the recipient, and a cached unnormalized legacy notification.

Expected: existing owned legacy notifications resolve to the authorized trip without rewriting stored history. Newly emitted trip notifications use the trip entity and trip ID. A missing/reassigned legacy target falls back to the driver's journey list, never an unrelated same-number trip or office route. Other roles retain their existing destinations. Driver APIs continue enforcing current ownership.

## SHARED-FLOW-014 — rapid CUS criteria changes retain all values

1. At `/shipments`, clear criteria, enter 25/09/2026 in Từ ngày giao, immediately enter 20/09/2026 in Đến ngày giao, then immediately press Tìm kiếm. The reversed date remains visible and invalid; the search must not erase the first date or apply the reversed range.
2. Correct the end to 30/09/2026 and immediately search. Both date query parameters persist together; export uses that same range. Repeat date selection plus direction, status and sorting in quick succession.
3. Enter incomplete date text and immediately search/export: block, retain text, focus the visible invalid field. Clear resets all drafts and query values.
4. At `/shipments/containers`, quickly combine date presets, a customer/direction choice and a reference search. Preserve independent parameters; browser back/forward and external links restore their own URL state.

Source changes only by this agent; controller owns visual verification. No automated tests/build.

## SHARED-FLOW-015 — calendar remains above its appointment owner

1. In `/shipments`, open QA-VISUAL-0915-2248 detail, then Cont 1's Chọn ngày giờ. Click the date input and select 26 Tháng 9. Keep the appointment editor open with the selected draft; only its explicit save/Enter persists and exits.
2. Repeat time selection, keyboard selection, calendar close, Escape and outside click on desktop and phone. The picker owns only its own interaction; the appointment and outer detail retain their separate close/save behavior.
3. Compare stacking with ordinary CUS/dispatch schedule pickers and a modal: controls must remain above the owning popover/backdrop, while toasts stay readable.
4. On both CUS boards, rapidly click the same sort header twice: retain both asc/desc transitions and existing filter criteria.

## SHARED-FLOW-016 — fleet invalid date cannot save through custom actions

1. In Điều vận → Xe nội bộ, edit QA-TEST (or add a new draft), enter 31/02/2026 in Hạn đăng kiểm and click save. Keep the modal open, focus the invalid date and show its error; do not send a create/update or close the modal. Repeat with Enter and Hạn bảo hiểm.
2. Correct the date, retain fractional capacity/fuel values (for example 20.5 tonnes and 27.5 L/100km), and save successfully. Clear an optional date intentionally and save it as empty.
3. Repeat impossible-date and valid-date paths for rơ-moóc inspection and lái xe licence expiry. Empty required plate/name remains a native invalid field.
4. In CUS create, enter an impossible date-only expected delivery date and click the create footer action: retain and focus the invalid text before any mutation.
5. Verify shared TextField required semantics both with and without prefix/suffix. Driver fuel and incidental-expense native forms continue blocking invalid dates.
## SHARED-FLOW-017 — Route distance validation and explicit clearing

Role: CUS or dispatcher; route catalog edit/create.

1. Open a route, enter `-1` in Khoảng cách, and click Cập nhật. Repeat via Enter.
2. The dialog must remain open with a distance error and no success/mutation.
3. Enter a supported valid distance and save; reopen to confirm it is retained exactly, not silently discarded.
4. Clear an existing distance deliberately; save and reopen. The field must be empty rather than silently retain the previous value.
5. Enter zero or `12.5`: reject before save with whole-kilometre guidance. Correct to `12` and persist exactly. Direct API distance validation likewise rejects zero, fractions, negatives and values outside the PostgreSQL integer range; null is an intentional clear and omission preserves the previous value.

Controller performs browser confirmation; this subagent does not run automated tests/build.

## SHARED-VIS-018 — Appointment and note typography consistency

1. In the CUS shipment detail drawer, select 16:37 on 28 September 2026. The appointment trigger and read-only equivalent display `16:37 28/09/2026`; the accessible name uses the same complete date.
2. Reopen the editor on a device whose timezone differs from Vietnam. Keep 16:37 unchanged in the local draft and persisted readback.
3. In the overview, inspect populated operational notes containing `KIỂM HÓA` and multiline instructions. Text uses upright styling, retains existing line breaks and clamps, and does not change empty-note affordances.

Controller owns visual confirmation; no automated tests/build by this subagent.

## SHARED-FLOW-019 — Portaled picker Escape cannot revert the owning cell

1. At `/shipments/new`, select time `14:22` and date `30/09/2026` in an initially blank container schedule. Reopen the desktop time picker and focus its exact-time textbox.
2. Press Escape once. Only the time popup closes; both selected time/date remain intact. Repeat on the mobile time sheet.
3. Reopen the popup, type an exact time and press Enter. The child applies the time without the table cell blurring it first or submitting the shipment.
4. Cancel the create page and choose Tiếp tục nhập. The selected timestamp remains. Ordinary non-picker text-cell Escape still restores that cell's starting value.

Regression root cause: the table cell's React capture handler received events from a DOM-external portal before the picker bubble handler could stop them. Controller owns actual browser retest; no automated tests/build.

## SHARED-FLOW-020 — Notification read identity validation

1. Open a valid owned notification and mark it read: preserve the normal row response and read state. A nonexistent or non-owned positive ID remains 404.
2. Malformed route IDs such as `12junk`, `12.7`, zero, negatives or integers above `2147483647` must return the existing 400 invalid-ID error before touching notification state.
3. The driver's older fulfillment-linked notifications still navigate to the owned trip, while duplicate dispatch detection recognizes both old fulfillment and new trip references.

Added during latest-prod source merge; not an executed automated test. Controller owns final UI retest.
