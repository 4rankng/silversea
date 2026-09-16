# CUS visual and schedule regression cases

Environment: local dev, CUS test account. Exercise at 390px, 820px and 1440px; include 320px shipment entry. No automated application suites requested.

## CUS-VIS-001 — Schedule editor survives child picker selection
1. On /shipments open Chỉnh sửa Lịch trình for a non-FCL shipment.
2. Click the time field, choose an hour and minute separately, then choose a date.
3. Repeat with exact typed time, calendar month navigation and Escape inside the child picker.
Expected: only the child picker closes after selection; parent retains both drafts until explicit save/cancel. Child Escape never dismisses parent. Saving valid date/time closes after success; invalid partial date stays editable. Repeat the container schedule editor on /shipments/containers.

## CUS-VIS-002 — Aligned operational filters
Open overview and container list at all three widths, expand filters and select/clear values.
Expected: sibling compact inputs/selects/actions share the same height and baseline, no overflowing controls, mobile filter label stays readable, date ranges stay paired. Collapsed advanced criteria really hide, and active criteria remain discoverable.

## CUS-VIS-003 — Readable values and dialogs
Open identity, documents, cargo, classification, notes, route, vehicle and schedule editors and their selectors. Inspect customer/route create/edit dialogs and shipment creation with multiple containers.
Expected: consistent 12px values/11px labels, readable placeholders, no nested control borders, no clipped dialogs or obscured actions. Dates display DD/MM/YYYY and 24h times.

## CUS-FLOW-004 — Cancel distinguishes pristine intake from a partial date/time draft
1. Open /shipments/new without entering anything and press Huỷ. Return immediately without a discard confirmation.
2. Open a new blank intake, enter only a time or only a date in the container schedule, then press Huỷ. Show the discard confirmation and retain the visible draft when choosing Tiếp tục nhập.
3. Repeat with invalid date text. Clear the buffered field completely and press Huỷ: a genuinely empty intake leaves without confirmation.
Expected: blank boolean defaults do not mark the form dirty; incomplete and invalid visible date/time text does. Cancel cannot silently discard a partial schedule.
