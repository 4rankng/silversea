# Compact shipment date/time fields

Scope: latest customer screenshot, create shipment, CUS; local Chrome desktop, tablet and mobile. Keep the existing shared date/time picker and complete-datetime contract. Do not introduce a shipment-only picker or separate icon buttons.

## DT-COMPACT-001 — content-sized inputs
1. Open `/shipments/new` and inspect Ngày giờ đóng trả.
2. Enter `03:10` and `25/09/2026`; inspect at 1440, 820 and 390 CSS pixels wide.
3. Clear both inputs and inspect their placeholders.
Expected: time/date widths fit their five/ten-character values and placeholder with ordinary padding; no fractional expansion into unused table space, no clipped text or overlap. Preserve mobile tap height. The table column releases unnecessary width to the other data columns.

## DT-COMPACT-003 — no redundant field captions
1. Inspect empty and populated appointment controls on desktop, tablet and phone.
2. Click each input to open its existing selector.
Expected: no visible “Giờ” / “Ngày” captions above the inputs. The shared appointment heading and HH:mm / DD/MM/YYYY placeholders provide context. Distinct accessible input names remain available to screen readers; selectors and keyboard entry still work.

## DT-COMPACT-004 — table fits its responsive range
1. Open the container form at 1440px with navigation expanded, then at 820px and 390px.
Expected: the desktop table fits without a redundant horizontal scrollbar before the record breakpoint. Phone records have a single section boundary and compact gutters; input values remain fully visible and touch targets retain their height.

## DT-COMPACT-005 — weight and appointment share a phone row
1. Open a container record at 390px and 320px; enter 10000kg and 13:17 25/09/2026.
Expected: weight stays in a narrow left column; time and date stay beside each other in the right column on the same row. No clipped values, overlapping labels or horizontal page scroll.

## DT-COMPACT-002 — shared picker behavior
1. Click the time input (no separate icon button), choose a five-minute time and reopen.
2. Enter an exact minute such as `03:17`, confirm, then click the date input and select 25 September 2026.
3. Open the existing appointment editor's time selector and compare the interaction.
Expected: create, schedule and appointment editors reuse `TimePickerSurface` / `TimePanel`; desktop popup and mobile sheet retain the same selection and exact-minute behavior. Clicks, keyboard entry, partial-pair validation and focus restoration remain intact. No new picker implementation or dependency.

Evidence and results: `qa/2026-09-15_customer-video/VERIFICATION.md` and `compact-datetime-*` artifacts.
