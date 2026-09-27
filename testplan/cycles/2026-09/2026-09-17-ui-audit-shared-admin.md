# Shared components, Admin and Manager interaction audit

Scope: local current prod plus uncommitted fixes; no production mutations, external deliveries, approvals, offline replay or heartbeat. Roles CUS/dispatcher, accountant/OPS and driver/customer have separate audit records. Browser evidence and fixture identities live under `qa/2026-09-17-ui-audit/` and are excluded from delivery.

## Acceptance criteria before fixes

| ID | Interaction | Expected result |
|---|---|---|
| UI-AUD-S01 | Open each visible role destination and its available tabs/forms at 360/390/820/1440px | Meaningful loaded or explicit empty/error state; no page overflow, clipped controls or mobile vertical scrollbar; record unavailable paths separately. |
| UI-AUD-S02 | Type full/partial text, Vietnamese accents or unaccented text, code, spaces, no-match; clear and type again in catalogue selectors | Real matching options appear, keyboard and pointer choose the same record, no-match is visible and recovers; selected value remains readable after close/reopen. |
| UI-AUD-S03 | Clear a selected combobox with mouse, keyboard, or touch | Exactly one clear action; selection and search clear together; no stale selected ID, duplicate side effect or unrelated dialog dismissal. |
| UI-AUD-S04 | Open nested dropdown/calendar/time selector in a form; choose, Escape, click outside, reopen | Only the intended surface closes, parent draft survives, focus returns to its trigger, Enter does not accidentally submit the parent form. |
| UI-AUD-S05 | Edit/clear/replace date and time, including invalid and partial input | Shared picker remains usable and correctly labels validation; no silent reset, disappearing parent or clipped picker. |
| UI-AUD-S06 | Submit invalid/empty forms, correct fields and resubmit; cancel/reopen | Field feedback identifies the actionable error, draft survives failure and appropriate state resets after explicit cancel. |
| UI-AUD-S07 | Filter, search, paginate, switch tabs and return | Consistent control height and alignment; no clipped values, stale selection, hidden matching rows, lost keyboard focus or surprise page scrolling. |
| UI-AUD-S08 | Use available admin/manager configuration forms and long values | Dialog content scrolls within screen while actions remain reachable; fields and nested selectors fit mobile/tablet/desktop. |

## Evidence rule

Record each executed role/route/control combination with actual browser assertions and screenshots. Automated component tests supplement browser evidence, not replace it. Distinguish PASS, FAIL, BLOCKED and NOT TESTED. Document exact regressions before implementing fixes. Physical-device, OS picker and external integration behavior must not be inferred from local Chromium emulation.

## Reproduced regressions

- **UI-AUD-S09 — Nested combobox Escape preserves form.** Admin → `/config/fuel-norms` → Thêm mới → Tuyến đường → type a query → Escape. Observed the entire parent form disappearing. Expected only the options to close; all entered form values remain. A second Escape with the options closed may close the form.
- **UI-AUD-S10 — Search survives equivalent catalogue refresh.** Focus a searchable UuiSelectField, type an uncommitted query, then receive an equivalent options array from its parent. Expected input and matching options remain; external committed value/label changes still synchronize. Include no-match → matching and disabled option selection.
- **UI-AUD-S11 — Full clear gesture has one callback.** A mouse press/release/click on ComboBox clear invokes the clear callback once, as does touch/keyboard activation; preserve focus and prevent parent click handlers from opening the popup unintentionally.
- **UI-AUD-S12 — Click and type into empty/selected fields.** Accountant → `/expenses/new` → click Nhà cung cấp or Hạng mục → type a matching term without manually deleting the placeholder. Expected results match the query; placeholder is not prepended. After selecting an option and returning to the field, typing replaces the selected label rather than appending to it. Verify mobile tap too.
- **UI-AUD-S13 — Consistent touch controls and form spacing.** Open config fuel-price/trailer/port forms on a phone and touch tablet. Observed 32px text/date/action controls mixed with 44px shared controls, plus a field bottom margin added to each flex-row gap. Expected shared 44px touch targets, compact unchanged desktop variants, one owned row gap, all content/actions reachable and no horizontal overflow.

## S14 — Required configuration fields explain failed submission

Reproduced locally as ADMIN on cargo types, trucks, trailers, expense categories, tire positions, capital contributions, business calendar and ports: empty Add keeps the dialog with no field validity error, no focus and no request. Existing save handlers already require these values. Mark those same required inputs, reject whitespace-only names, and let shared FormActions focus/report the first invalid control. Verify empty and whitespace drafts do not call save; a valid draft can save and retain the API error on failure. Test mobile dialog geometry and keyboard focus.

## S15 — Consistent mobile action targets

Actual390px Admin/Manager dashboard actions measured30–32px while chart toggles45px. Root-scoped legacy compact CSS overrode page touch sizing. Consolidate these existing mobile rules onto shared44px touch token, including navigation and row actions, with compact typography/padding retained. Recheck dashboard/filter/action geometry at360/390/820px.

## S16 — Factory management search and empty results

Browser: Nhà máy finds9 of26 records; `nha may` and padded uppercase return0 despite matching data. Normalise Vietnamese accents, case and whitespace with the existing format utility. No-match must state no matching results, not that the catalogue is empty; clearing restores26 records. Verify names, codes, customer/address terms and customer filter together.

## S17 — Accountant transport filters use the available phone width

Reproduced at360px in /accounting?view=transport: dates unnecessarily stack, four inline filters have cramped two-line labels and inconsistent value widths. Keep two equal date columns, shared labels above each select, a full-width search row and two equal filter columns on phones; desktop filters wrap with aligned bottoms. Use shared control borders/heights, retain filters and ordinary scrolling. Exercise typing, selection, date picker dismissal and reset at360/390/820/1440.

## S18 — Transport record actions remain inset and touchable

At820px the responsive transport record puts “Công nợ” flush against the rounded edge with a30px target, unlike44px filters. Keep a compact horizontal inset and44px touch target in responsive cards; reset financial facts to left alignment in card mode so labels/values follow the other facts. On desktop retain numeric-column alignment. Verify every debt link is fully inside the record, receives the pointer and navigates to that customer; selection remains unchanged by link activation.

## S19 — Opening a selected combobox never drops the first typed character

Focus a committed searchable value, immediately type `que vo`, and let popup focus events settle. Keep the complete new query, show matching options and allow Escape to close only the list. Select the old text only when it still equals the committed label, never after replacement typing has started. Repeat at360/390/820/1440px and protect with a focus-event regression.

## Scope update

The user narrowed remaining browser work to ACCOUNTANT, OPS, DISPATCHER, CUS and DRIVER. Earlier Admin/Manager checks and fixes remain recorded; no additional coverage of those roles is implied.

## UI-CB-01 — Escape preserves an accepted free-text value

CUS `/shipments/new`: type a non-catalog Hãng tàu, reopen its options, then press Escape. The input and form value must remain unchanged and the list must close, without closing an outer dialog or triggering save. Apply the same contract to other custom-value combobox callers. Catalog-only selectors still discard the uncommitted search and restore their selected label. Cover custom and catalog cases with unit tests and an actual CUS browser check.

## UI-CB-02 — Supporting search metadata is not the committed display label

A catalog item may expose a short label plus full name/address for search. Focus its committed input and type a replacement: select the visible label, not the metadata string, so typing replaces rather than prepends/appends. Escape restores only the original display label, never address/search metadata; keep the selected catalog ID. An in-progress query must not be reselected by a subsequent focus event. Verify factory options with supporting text in component tests and the real CUS form.

## S20 — Summary amounts do not split digits on tablet

Accountant → /finance at820px:25.580.000đ and63.2% wrap inside the number because labels compete for the same summary-cell row. On constrained tablet canvases keep each label above its value and preserve the compact ruled strip. Check all four real totals at360/390/820/1440, including longer monetary values, without horizontal overflow or loss of digits. Desktop numeric typography stays unchanged.

## S21 — Disabled inline-save remains legible

CUS /shipments-detail → open unchanged factory editor: disabled Save has pale text and a white primary icon on nearly white background. Keep disabled state and direct-edit rules, but use the shared muted ink token for both text and icon with a neutral background. Verify actual browser computed colors/disabled property and that changing the factory enables the primary action normally.

## S22 — Executable test-plan results cannot silently pass

The topic runner exits successfully when a case throws (ERROR), is BLOCKED, SKIP or INCONCLUSIVE, because it counts only FAIL. Require every planned result to be PASS for a successful exit; an empty run is not verified. Preserve each attempt in a unique evidence directory. Unit-test the verdict calculation, then run the local CUS topic; report unavailable fixtures and stale selectors as blocked coverage, never as product PASS.

## S23 — Pricing expectations follow current PRD

Reconcile flow12 with the three pricing PRDs: use transport date, preserve unknown15T/lag/threshold values, do not turn sample thresholds into policy, and retain historical evidence as historical. Run available engine/snapshot/override regressions; workbook parity and unresolved customer terms remain separately identified gaps. Do not add tables, approval or guessed tariff values to satisfy obsolete test prose.

## S24 — Missing pricing terms are not silently agreed zero values

Accountant → /config/freight-rate-terms → Add: lag must start blank, threshold radios must require an explicit choice. Empty/cleared lag is invalid; explicitly entered0 is valid. Preserve existing saved values when editing and omitted fields in a partial API update. Create API rejects missing, null, blank or boolean lag rather than coercing to0. This validation does not change old snapshots, migrate historical agreement data or invent unresolved threshold policy.

## S25 — Threshold amounts are visible and usable

Actual390px pricing form shows threshold amounts as borderless16.5px inputs, effectively invisible beside their radio choices. Use the existing input appearance/height, align the amount beside its choice, label units, and make each radio label a full touch-height target. Keep all three choices and both amounts within the dialog at360/390/820/1440px; switching modes disables only the inactive amount and never drops the entered draft.

## S26 — Freight terms expose and preserve the effective date

Accountant → `/config/freight-rate-terms`: the existing list shows each term's effective date, but the create/edit form offers no date control. PRDs `CuocPhiThietKeDB.md` §4 and `PhuongAnTinhCuocTuDong.md` §3/4 require an explicit date, including future terms. Reuse the existing shared DateInput from fuel-price periods. New terms initially show today's Vietnam business date; existing terms show their stored date unchanged. A required blank, partial or impossible date prevents save with field feedback, without changing another draft field. Selecting or typing a future date sends the selected ISO effectiveDate in the existing create/update command. Opening the calendar and pressing Escape closes only the picker; Cancel closes the form with no write. Verify default/edit/payload/invalid behavior in focused form tests and actual browser controls, future-date selection, edit retention and no-write cancellation at360/390/820/1440px. No new schema, approval, pricing recalculation or alteration of historical snapshots.

## Execution record —17September2026

| Cases | Result | Evidence scope |
|---|---|---|
| S17/S18 | PASS | Actual Accountant filters/date/search/reset/debt navigation at360/390/820/1440; no page overflow, consistent touch targets. |
| S19; UI-CB01/02 | PASS | Shared component regressions plus real CUS replacement typing/custom value/nested Escape; exact variants in lane reports. |
| S20/S21 | PASS | Actual money line geometry at4widths and unchanged factory editor disabled text/icon colors at390. |
| S22 | PASS | Eight runner-result regressions. Legacy CUS executable topic has7verified cases after targeted pagination correction; factory-display case BLOCKED by unavailable matching fixture, not countedPASS. |
| S23 | PARTIAL | Current PRD contradictions corrected; engine/snapshot suites were in the2362-pass backend run. Workbook parity needs the missing source workbook and unresolved threshold terms are not inferred. |
| S24/S25 | PASS | Actual Accountant4widths, no writes: blanklag/unselectedthreshold, validation focus, explicit0,2.25%/125đ mode switching, retained draft, visible44px touch/34px desktop fields. Shared/API input tests are recorded in finance lane. |

Other S01–S16 cases are covered only to the exact surfaces/variants in `plans/260917-ui-audit/reports/shared-root.md` and lane reports. No blanket assertion that every possible control, dataset, device or action ordering is verified.

S26 execution17/09: six new form regressions failed before the control existed; after the fix, FreightRateTerms + FuelPricePeriods suites17/17PASS. Actual Accountant Chrome checks at390/820/1440PASS (360 final cancellation rerun recorded separately): default17/09/2026, select20/10/2026 via calendar, invalid/empty validation, first Escape closes only calendar, existing09/09/2026 survives cancel/reopen, and zero API writes during browser inspection. Date boundary heights44px touch/34px desktop; no document overflow. Unit tests separately verify the ISO effectiveDate payload and Vietnam midnight rollover. Browser evidence `qa/2026-09-17-ui-audit/cus-dispatch/pricing-effective-date-browser-final.log` and `pricing-effective-date-results.json`; no real contractual term was changed to prove UI behavior.

S26 visual follow-up: at360px, the label “Giá gốc dầu F (đ/lít, 4 số lẻ)” wraps and places its input16.5px below the adjacent kilometre field. Use concise labels “Giá dầu mốc (đ/lít)” and “Km một chiều”, retaining the four-decimal input step and stored values. Recheck equal input tops/heights on360px; no change to price precision or formulas.

S26 final360 rerun: PASS, process exit0, `pricing-effective-date-360-final-results.json`. This completes the date-control checks across all four widths together with the390/820/1440 results above. The earlier360 harness clicked Cancel beneath an open calendar; explicit blur before Cancel verifies the intended control. After concise labels, kilometre and fuel inputs both have top431px/height44px. Modal screenshot was captured after its entrance animation. Final two-suite regression rerun17/17PASS (`pricing-effective-date-label-tests.log`); no production data write.

## S27 — Driver mobile navigation matches the four-tab requirement

PRD `ManHinhLaiXe.md` §2 requires Hành trình, Thu nhập, Kỷ luật and Tài khoản as the four primary mobile tabs. At360/390/820px, render exactly those four tabs; move the redundant bottom-nav Thông báo entry into the existing account sheet, while retaining the top-bar bell and desktop sidebar entry. The sheet's Thông báo action must use the existing guarded navigation to `/notifications`, close the account sheet after navigation, remove its page inert state and keep all four tabs available. Opening and dismissing the account sheet must preserve existing focus and logout behavior. At1440px the existing sidebar Thông báo still navigates to the same notification page. Add a rendered Layout regression for tab labels/count and notification navigation/dismissal, then verify the real driver account at all four widths without creating a notification or changing a trip.

S27 execution17/09: PASS. The new Layout regression failed against the five-tab implementation, then passed after the bounded correction; Layout/mobile-account-sheet/Sidebar suites49/49PASS and scoped ESLintPASS. Actual DRIVER Chrome at360/390/820px shows exactly Hành trình, Thu nhập, Kỷ luật, Tài khoản; all three page tabs navigate and expose the correct current-page state. Account → Thông báo reaches `/notifications`, closes the sheet and removes page inert state. Each tab is52.3px high, widths90/97.5/180px respectively, with no document overflow. At1440px the sidebar Thông báo still opens `/notifications` and bottom navigation stays hidden. Browser process exit0, four PASS results and no API/runtime errors in `qa/2026-09-17-ui-audit/cus-dispatch/driver-nav-results.json`; screenshots `driver-four-tabs-*`, `driver-notifications-sheet-*` and `driver-notifications-desktop-1440.png`. No trip or notification content was edited. This verifies emulated Chrome viewports, not physical-device Safari.
