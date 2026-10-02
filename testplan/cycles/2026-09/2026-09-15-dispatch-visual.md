# Dispatcher visual regression cases

Scope: local `/dispatch`, `/dispatch-detail`, `/fleet/vehicles`, `/fleet/drivers`, and dispatcher `/suppliers`. Check at 390px phone, 820px tablet, and 1440px desktop; include 320px for narrow layout bounds. Automated suites are intentionally not run in this visual-only pass.

## DV-VIS-001 — Aligned master-plan filters

1. Sign in as dispatcher and open `/dispatch`.
2. Compare search, direction, allocation, carrier, date controls, date shortcuts, and creation action.
3. Resize through desktop and tablet widths; open the advanced filter drawer.

Expected: controls use the same shared small-control height and aligned label baseline. Date shortcuts stay with their date range; tablet filters do not form arbitrary orphan rows. No horizontal overflow. Drawer filters retain selected values and can be reset.

## DV-VIS-002 — Compact detail-plan filter rows

1. Open `/dispatch-detail` on desktop, tablet, and phone.
2. Toggle Hôm nay, Hôm sau, and Tất cả, then open Bộ lọc and reset.
3. Use the same page with a coarse pointer viewport.

Expected: input and action heights are consistent. Date shortcuts have no overflowing inner pill or clipped focus ring. On phone the search and filter action share one row; the date input and clear action share the next; shortcuts form one equal-width row. No standalone full-width filter button or unused half-row gap.

## DV-VIS-003 — Independent note actions

1. Open a master-plan record with a long operational note.
2. Activate Xem chi tiết with mouse, Enter, and Space.
3. Close the note dialog; separately activate the note preview to edit it.

Expected: view action opens only the detail dialog. Editing and viewing are separate keyboard targets, with no button nested in another interactive target.

## DV-VIS-004 — Dense catalog records and detail drawers

1. Open each fleet catalog and dispatcher suppliers at 390px and 820px.
2. Read long names, plates, phone numbers, and record actions; open a container detail drawer from `/dispatch`.

Expected: one clear row boundary per record, no nested record boxes consuming mobile width. Long data wraps inside its field, action groups stay legible, and the drawer uses compact safe outer insets.

## DV-VIS-005 — Assignment notes and action consistency

1. Open an assignment editor from `/dispatch-detail`.
2. Select and deselect task tags, add a custom tag, and type multiline notes.
3. Resize to phone and inspect the note composer, assignment fields, and footer.

Expected: selected tags use restrained selection styling, fields remain inside the modal, and the note composer and footer actions remain readable and touchable.

## Coverage

This file defines manual cases before implementation. Agent source review is CODE-READ ONLY; the controller records individual browser results and screenshots in `qa/2026-09-15_full-visual/`.

## DV-VIS-006 — Catalog toolbar and summary hierarchy

1. Open `/fleet/vehicles`, `/fleet/drivers`, and `/suppliers` as dispatcher.
2. On vehicles, change the carrier filter and search text; inspect the other catalogs at 820px and 390px.

Expected: carrier filter is alongside search in one toolbar, not an orphan row. Counts use the same compact summary treatment across catalogs. Driver license-expiry dates use DD/MM/YYYY. Nine-column driver data switches to labeled records before squeezing into a tablet table.

## DV-VIS-007 — Catalog keyboard actions remain independent

1. Tab to a vehicle, driver, or supplier identity and activate it with Enter.
2. Close the editor and Tab to vehicle assignment or supplier deletion.
3. Activate the secondary action and cancel its dialog.

Expected: only the chosen action opens. Record rows keep table semantics, with native edit buttons in their identity cells; no nested button roles and no supplier delete key event opening the edit dialog.

## DV-VIS-008 — Reuse the 24-hour time picker in detail filters

1. Open Bộ lọc on `/dispatch-detail` and activate Giờ từ / Giờ đến.
2. Choose a shortcut time and type an exact non-five-minute time such as 13:17.
3. Try an invalid value, clear the field, and dismiss the picker with Escape or outside click.

Expected: the existing shared time selector opens, with desktop popup and mobile sheet. Inputs consistently show HH:mm without AM/PM. Only valid or empty values reach the filter; incomplete typing stays visible with feedback, and clearing removes that time bound.

4. Apply 08:00, replace it with 25:90, and press Xem kết quả. Repeat from an initially blank bound, then use Đặt lại.

Expected: Xem kết quả keeps the drawer open and focuses the invalid bound instead of hiding the invalid draft while silently keeping 08:00. Đặt lại clears invalid drafts even when the applied bound was already empty.

## DV-VIS-009 — One shared time-input style across roles

1. Open the CUS quick schedule editor, a shipment container schedule editor, and dispatcher time-bound filters at desktop and mobile widths.
2. Click the time input, type 13:17, select a shortcut, and dismiss with Escape or Tab.
3. Check invalid text, disabled/saving state, and dispatcher reset from an invalid draft.

Expected: all three use the same compact input geometry and existing shared picker. Shipment forms still receive draft text for their save validation; dispatcher filters apply only valid or empty bounds. Invalid drafts retain feedback and native validity; focus returns to the owning input after selection without closing the editor.

## DV-FLOW-010 — Persisted KẸP companions may run together

1. Create a valid ACTIVE KEP trip pair through the existing dispatcher pairing flow and accept one order as its assigned driver.
2. Accept its linked companion, then try starting an unrelated third order on the same truck.
3. Repeat with two orders carrying only the DOUBLE classification but no persisted pair, and with a KET_HOP pair whose first leg is unfinished.

Expected: only the verified ACTIVE KEP companion may share the running truck. Unrelated orders, unlinked DOUBLE labels, and unfinished sequential pairs retain the busy/order guards. Local sample4257/4258 has no persisted pair and must remain blocked until properly paired.

## CUS-FLOW-011 — Number-only edits do not invent lift/drop ports

1. Create a shipment container with a factory and blank lift/drop ports; fill only its missing container number.
2. Refresh CUS detail, summary, and missing-field filters.

Expected: ports remain missing; factory delivery snapshot stays available for factory information but never appears as a port. A real catalog port or legacy snapshot explicitly marked PORT still resolves correctly.

## CUS-VIS-012 — Compact customer catalog and honest summaries

1. Open `/config/customers` at phone, tablet, and desktop sizes; search and change status filters.
2. Inspect sparse records, expand their information, and open the existing edit action.
3. Inspect all customer form values and placeholders; review revenue summary with no monthly data.

Expected: narrow records show name, short name, MST, and available contact information without twelve empty field rows. Disclosure preserves every field. Filters form one aligned row on narrow widths; values are regular weight while labels remain distinct. Missing revenue is shown as unavailable, not a zero-percent concentration; status counts do not claim usage frequency or a debt cause.

## DV-VIS-013 — Sparse fleet records stay compact

1. Open the driver, vehicle, and supplier catalogs at 390px, 820px, and desktop widths.
2. Compare a sparse record with a fully populated record, then open their existing edit action.

Expected: a driver's name appears once as the narrow record identity; a name is never labeled as a driver code. Empty optional fields do not render dash rows on narrow screens, while all available values stay visible and omitted fields remain editable. Vehicle assignment absence remains explicit. Identity and action groups have no redundant eyebrow labels; desktop columns retain their labels and empty-value markers.

## CUS-VIS-014 — Customer searches retain results during loading

1. Open `/config/customers` and type a matching customer name while observing summaries and records between requests.
2. Repeat with a search that has no matches, then clear it.

Expected: pending searches retain the last result with a visible updating status, never flash fabricated zero counts or an empty-state message. Initial load uses unavailable counts and loading status. A genuine empty state appears only after the current search completes; export is unavailable while results are still updating.

## CUS-VIS-015 — Compact customer editor with persistent actions

1. Open add/edit customer at 390px and desktop widths; focus a field with the mobile keyboard open.
2. Scroll through the contact, payment, and address fields, then inspect the final template selector and actions.

Expected: contact/phone, accountant/phone, and short numeric fields stay paired on phones; long name and address remain full width. Only the field body scrolls. Cancel/save remain visible below it without covering a field, including the last selector. Existing required-name and numeric validation remain unchanged.
