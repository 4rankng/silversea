# Comprehensive local workflow and visual audit — 2026-10-01

## Scope and acceptance

Exercise the local application by modern role (ADMIN, MANAGER, ACCOUNTANT, CUS,
DISPATCHER, OPS, DRIVER, CUSTOMER), reachable list/detail/form/dialog routes and
phone/tablet/desktop widths. Record actual action coverage separately from page
navigation. Use canonical local accounts and local records; never touch production.
File each defect before fixing it, preserve approved domain rules, and deliver a
portable Git patch with recorded base and clean/reverse-apply evidence.

## Regression cases filed before implementation

### QA-AUDIT-WF-01 — completed trip cannot depart through ordinary dispatch

1. Complete a local trip through the approved completion workflow.
2. Record version, completion time and current accounting posting/ledger.
3. Attempt ordinary dispatch with a fresh key and current version as DISPATCHER.
Expected: conflict and unchanged terminal/accounting state. CREATED departure still
succeeds; governed reopen uses its existing validation and reversal workflow.

### QA-AUDIT-WF-02 — cancellation retry preserves actor and payload identity

1. Cancel a completed local trip A with an authorized actor, reason and key K.
2. Repeat the exact request; then repeat with changed reason/version, another actor,
   and another trip B using K.
Expected: exact request replays once. Changed requests conflict, B remains unchanged,
and accounting reversal entries are not duplicated.

### QA-AUDIT-WF-03 — external completion honors an expected version

1. Issue an external-carrier trip and record version V.
2. Change a legitimate field to advance its version.
3. Complete with stale V and a fresh key.
Expected: conflict without status, timestamp or posting changes. Matching and omitted
version requests retain their documented successful behavior; exact retry deduplicates.

### QA-AUDIT-WF-04 — external and mixed required work complete the shipment

1. Issue external-carrier work for a local FCL or LCL shipment and close every required
   trip using the existing staff completion action, without app-driver e-POD.
2. Repeat with a mixed shipment: one own driver-completed trip with saved e-POD and
   one external trip. Close only one leg first, then the remaining leg.
3. Check missing own e-POD, still-pending required work, canceled-not-required work,
   and canceled work with a pending replacement before closing the replacement.
Expected: shipment becomes COMPLETED only when each required fulfillment has exactly
one completed authoritative trip with the appropriate driver/staff closure evidence.
Pending/rejected own evidence and pending replacements keep the lot unfinished.
Strict accounting evidence, cost reconciliation and financial settlement stay separate.

### QA-AUDIT-ENV-01 — canonical local startup and E2E defaults

1. Start the documented `make dev` command using local infrastructure.
2. Observe migration result and query http://localhost:3002/api/health.
3. Resolve default E2E targets and explicit paired overrides.
Expected: API :3002, frontend :7175, explicit local migration target. Custom local ports
and explicit paired remote hosts resolve as requested; mixed hosts stay rejected.

### QA-AUDIT-ENV-02 — setup and purge dry-run have separate recipes

1. Inspect `make -n setup`; never execute database recreation during this audit.
2. Inspect `make -n qapurge-dry`; never contact the remote staging host.
Expected: setup includes local Docker, database recreation, explicit local migrations
and seed. The purge dry-run contains only its existing remote dry-run command and
does not recreate, migrate or seed any local database.

## Evidence and coverage

### QA-AUDIT-UI-01 — phone status tabs keep text inside their controls

1. Open shipment overview as ADMIN and CUS at 320/390px with populated counts.
2. Click each of the four status tabs and observe its selected state and URL lens.
3. Check every label/count rectangle against its button; repeat at 768/1024/1440px
   and on the other shared Tabs hosting screens.
Expected: labels/counts never overlap adjacent controls; every option is readable
and reachable, keyboard navigation and status semantics remain intact.

### QA-AUDIT-UI-02 — accounting and advances tabs inherit shared geometry

1. Log into local dev as ACCOUNTANT and open `/accounting` then `/advances`.
2. At 320/390/768px, click each of their three views and inspect the resulting
   selected tab, URL `view` value and visible view heading/content.
3. Compare label rectangles to each button, measure button heights and inspect
   the group for horizontal overflow. Repeat with ADMIN, a second authorized role.
4. Record pre/post read-only accounting API snapshots and assert that switching
   views emits no business write request.
Expected: labels/counts fit their controls, all views remain reachable, buttons
are at most 40px high, shared Tabs owns cell geometry, and navigation changes no
business data. Retain view URL semantics and keyboard navigation.

### QA-AUDIT-UI-04 — vehicle checkbox labels use the shared phone touch target

1. As ACCOUNTANT or ADMIN at 320/390/768px, open `/accounting/phoi-phieu` and
   expand the existing vehicle-assignment section.
2. Measure the enclosing label for a real unassigned vehicle, click its text,
   and confirm the checkbox plus selected count change. Click again to restore it.
3. Observe no assignment write request; compare the persisted assignment snapshot.
Expected: label is 40px high on phones/coarse pointers; compact desktop remains
at least 32px. Clicking the label selects/deselects without persisting assignment.

### QA-AUDIT-UI-05 — monthly accounting reports retain readable money columns

1. As ACCOUNTANT/ADMIN open `/accounting/phoi-phieu` with the existing monthly
   THU and TRA reports at390/768/1440px, and click the applicable report controls.
2. Read the grouped headings, party rows and grand totals; scroll each report
   horizontally to its final note column where content exceeds the viewport.
3. Measure header/amount rectangles against their owning cells and compare all
   displayed amounts to the real report API payload. Record no write requests.
Expected: the matrix scrolls inside its own wrapper; every column remains reachable,
headings wrap at word boundaries, amounts stay atomic and numeric columns never
paint into neighbors. Existing total/group structure and report functions persist.

Commands, exits and full outputs: `qa/2026-10-01_comprehensive-audit_*.log`.
Screenshots and action assertions: the same date/scope prefix under `qa/`.
Final report must distinguish UI DRIVEN mutations from navigation-only checks and
DB/API VERIFIED or CODE-READ ONLY findings; list unexercised states and roles.

### QA-AUDIT-ENV-03 — dispatch suite uses actual delivered workbook and current sizing

1. Run dispatch E2E with the repository's real September customer workbook.
2. Inspect the import analyze control and each role's actual primary control at its designated widths.
Expected: all unrelated dispatch/RBAC/role cases execute; no module-wide skip for a retired path. Touch controls obey the documented 40px band; compact desktop controls obey their house token (legacy30px, UUI32px). Real phone/tablet contexts set touch and mobile media features. Missing, disabled and undersized controls still fail.

QA-AUDIT-ENV-03 trip-list identity continuation (TC-0107): create the existing
suite's real owned trip, complete its unique server-search request, and require
the response to contain the exact created ID. Its `/trips/<created ID>` link must
display the persisted Bill/Booking, or `Chưa có số Bill/Booking` when absent, and
must not expose a `TRP-*` code in row text or accessible labels/tooltips. Click
that exact link and require the same detail URL and business reference; retain
search/detail screenshot, DOM assertions and API readback. Missing row/link,
missing creation/search identity, wrong business display or internal-code leakage
must fail, never skip. Re-run suite01 and the controller's complete E2E gate.

### QA-AUDIT-UI-03 — penalty configuration link uses the shared touch target

1. Open the penalty page as ADMIN at 320/390/768/1440px.
2. Scroll to and click “Sửa bảng phạt”.
Expected: the shared button link has a 40px touch target and opens penalty configuration; compact desktop styling follows the house button primitive.

### QA-AUDIT-UI-09 — operational phôi-phiếu board retains readable tracks

1. Open the actual local board as ACCOUNTANT and ADMIN at390/768/1440px.
2. Inspect real trip/bill/container/vehicle identifiers, each status and amount,
   and click both chi-hộ and tiền-đường detail controls, closing without saving.
3. Select/deselect a real eligible row if present; click a locked row and confirm
   it remains inert. Scroll to the final driver-note column.
4. Compare the chosen persisted trip/fee detail before and after; record zero
   business-write requests and verify label/amount rectangles remain in their cells.
Expected: the board uses intentional local scrolling with honest per-column
minimum widths at every width. Identifiers and amounts remain atomic; labels wrap
at words. Shared buttons satisfy40px phone and32px compact desktop targets.
Selection, locked state, voucher eligibility and detail-dialog semantics persist.

### QA-AUDIT-UI-12 — phôi-phiếu detail grids retain editable money on phones

1. At390/768/1440 as ACCOUNTANT and ADMIN open both actual expense detail dialogs.
2. Inspect grouped number inputs, displayed original amounts and total figures;
   scroll the existing matrix to its final action/approval column.
3. Type a different amount into a real existing editable row, observe the draft
   total, then restore the original value and close without saving.
4. Compare the same actual API detail payload before and after; require zero
   business-write requests and numeric/heading containment inside owning cells.
Expected: both grids inherit one shared matrix geometry, input text is fully
readable, monetary digits stay atomic and every column/action remains reachable.
Unsaved edits do not change persisted amounts, approval state or eligibility.

### QA-AUDIT-ID-02 — Bill/Booking remains the visible identity across core detail surfaces

1. As local MANAGER, open a legitimate dispatched trip whose customerReference is the originating shipment Bill/Booking; inspect its header, breadcrumb, list row and CSV identity.
2. Open that shipment's detail page, the master-plan container-detail drawer and its customer's recent-logistics drawer.
3. As OPS, open an existing owned trip with billNumber or bookingNumber; inspect its header and secondary identity.
4. Observe records with absent/blank Bill and Booking; ensure the explicit missing-reference text appears and no shipmentCode/tripCode substitutes. Compare API business references before/after navigation; no business writes are expected.
Expected: every named surface displays the real Bill/Booking (trimmed only), never the internal shipment/trip code. Customer history preserves status/date. Trip actions, URL IDs, sorting contracts, selection and finance remain unchanged. Save actual screenshots, post-click DOM, API identity proof and driver log separately per surface.

Same-class scope: repeat the identity check in the trip edit heading, penalty/payable trip selector, master-plan container opener accessible label, invoice-tracking lot picker and phôi-phiếu identity cell. Existing API lot Bill/Booking fields must survive frontend option mapping. No backend identity projection is added.

### QA-AUDIT-ID-03 — trip business-reference sorting retains legacy API compatibility

1. In an isolated existing real-DB trip-list fixture, create business references whose lexical order differs from tripCode order, with ties and blank/null references.
2. Call `GET /api/trips` using `sortBy=customerReference` in asc/desc; compare returned customerReference/ID order, including stable ties and missing references last.
3. Call the retained `sortBy=tripCode` and confirm it still sorts internal tripCode for existing API consumers. In the actual trip list click the Bill/Booking header, confirm customerReference sort query and resulting visible order.
Expected: the new explicit key sorts the trimmed business reference; empty/null references sort last in both directions, IDs break ties. Historical tripCode contract is preserved. No schema changes or weakening of authentication/filter validation.

### QA-AUDIT-ENV05 — demo contact seeding respects existing unique ownership

1. Run bootstrap against the current local DB whose CUSTOMER account owns a named demo staff account's proposed phone; retain the owner snapshot.
2. In an isolated real-DB regression, temporarily let a fixture-owned account hold the proposed staff email as well; run the unchanged full seed.
3. Confirm the existing phone/email owners and all nonblank operator contacts remain unchanged; the new/partial staff identity keeps nullable missing contacts instead of an invented phone/email or owner reassignment. Repeat seed and compare IDs/hash/contact snapshots.
4. Restore only the owned email fixture and original staff contact snapshot. Run the affected bootstrap and expense-catalog suites, which must retain their original assertions and fill-only behavior.
Expected: no unique-contact collision, no contact takeover, no overwriting a nonblank email when only phone is missing, and stable repeat runs. Save red and green logs, exact cleanup guards and the complete backend rerun separately.

### QA-AUDIT-UI-11 — settlement form keeps selected quarter and year readable

1. As ADMIN and MANAGER open `/profit` at320/390/768/1440px.
2. Scroll to quarterly settlement, open quarter and year selectors, choose another real option and restore each original value.
3. Check the selected label's scroll width and owning control rectangle; inspect the full form for page overflow and record no distribution write.
Expected: selected quarter/year text remains fully readable beside or below its accessible field label, all real options remain reachable, previews and distribution commands retain their existing behavior. Form fields use the existing stacked house Select mode, while toolbar adapters remain inline.

QA-AUDIT-UI-01 density continuation: boxed status groups keep one intrinsic scroll row when their content exceeds the available width. Repeat actual first/last status clicks and Home/End keyboard selection at320/390/768/1024/1440; assert selected label/count containment, local scroll reach, no page overflow and shipment header≤100px at390. Bordered section navigation retains wrapping. Never buy density by reducing40px touch targets or hiding `(trang)` scope meaning.

QA-AUDIT-COVERAGE-01 — active-route and action reconciliation

1. Enumerate App.tsx active pages separately from redirects/fallback; match stored
   actual DOM URLs, with static routes preceding parameter routes. Exclude login
   captures and API URLs from page counts. Reconcile current E2E case evidence.
2. For genuinely missing page patterns, resolve IDs from authenticated existing
   customer/truck/trailer/template/settlement APIs, use the admitted canonical role
   and drive local pages at 390/768/1440. Capture actual focus/text selection and
   available nonmutating section/open/Cancel controls. Record screenshot, DOM,
   exact before/after persisted API row parity, driver command/output and exit.
3. Billing creation may invoke its explicitly non-material read-only draft
   preview; log it separately and require stored documents to remain unchanged.
   No other material write belongs to the read-only route driver.
4. A missing data population must be named, never filled with guessed IDs or
   unrelated modern OPS settlements. A separately authorized legacy settlement
   mutation must use a real owned funded advance, balanced existing inputs and
   actual controls, with persisted record/ledger proof and subsequent detail.
5. Page-pattern coverage must never be reported as all actions/states: list every
   unexercised save/delete/validation/provider/error path in the final matrix.

### QA-AUDIT-DTL-01 — shipment detail preserves known container type labels

- Repro: open existing Bill QA-WF04-114144 shipment2366 as local MANAGER; compare its container type to actual dispatch container drawer20DC. Direct detail API currently has containerTypeId1 without name/code.
- Expected: canonical container read includes existing catalog name/code; detail renders the known label. Missing catalog references keep the container row and explicit absence, with original row order/IDs unchanged.
- Regression: real DB container helper/detail regression; actual detail screen after navigation, DOM assertion, screenshot, driver log and ORM/API record proof. Other roles, mobile, staging and deleted catalog boundary remain separate coverage.

### QA-AUDIT-DTL-02 — external carrier alias remains consistent across trip reads

- Repro: actual local MANAGER trip706 Bill QA-WF04-114144 shows external carrier absent in generic trip detail/edit; API has externalEntityId9 but omits established externalCarrierId, while shipment allocation shows Gaya Container Lines.
- Expected: detail forwards externalCarrierId9 from same sidecar field, preserves externalEntityId compatibility, and existing catalog lookup/form resolves the carrier. OWN/null-carrier reads keep null.
- Regression: real DB getTripById external/null cases, actual Sổ chuyến đi→Bill row and Chỉnh sửa controls, screenshots/DOM, unchanged trip version/owner DB proof. Other roles, mobile, staging and removed carrier are separate coverage.

DTL02 compatibility continuation before edits: supplier-backed legacy carriers retain SUPPLIER identity. Detail must resolve only its validated linkedCustomerId, never reuse raw supplier IDs in the customer catalog. Preserve original entity/type, historical supplier label when the link is absent, and omit an untouched unresolved supplier identity in edit submissions. Real DB collision fixtures cover CUSTOMER, linked SUPPLIER, missing/dangling link and OWN/null; existing list alias remains the established API compatibility contract.

### QA-AUDIT-FIN-01 — carrier-aware trip financial preview

1. Reproduce local MANAGER trip706 Bill QA-WF04-114144 EXTERNAL edit: blank hire and revenue must not incur own-fleet fuel/road/salary. Retain the red screenshot and DOM.
2. Drive actual OWN/EXTERNAL controls, enter/clear hire and revenue, switch VAT0/8%, commission and road override. For revenue10,800,000/hire5,400,000/VAT8% the canonical shared rule yields recorded revenue10,000,000 and profit4,600,000 before commission; cost stays inclusive VAT. Blank hire is0, not stale or own-fleet cost.
3. Meaningful pure regressions compare both preview consumers to shared computeTripTotals, including toggles, zero/blank, own actual fuel price and road override. Sweep detail/list profit overrides and server sorting for the same contract, preserving existing actual expenses and stored ledger behavior.
4. Capture actual form values/rows/profit after each control change; restore unsaved fields. Compare existing API canonical financial inputs/output and unchanged ORM record version. Other roles/mobile/staging/material save and locked financial correction remain separately reported.

FIN01 read/snapshot continuation: real-DB list/detail reads must expose the existing reconciled expense/toll/backhaul fields used by the server. Pure preview regression pins committed legacy OWN fuel cost/litres using the established freeze helper without live recosting; moving that helper to shared preserves all original backend assertions.

QA-AUDIT-ID-02 inbox continuation: use actual owned OPS Bill QA-ID02-OPS-130955 list→detail and available real DRIVER/ACCOUNTANT/MANAGER lanes; titles/aria/facts display Bill/Booking, never TRP/SHP/internal IDs. Real-DB lane fixtures pin Bill, Booking and explicit missing-reference labels; IDs/routes remain unchanged. Customer search uses its displayed business keys.

### QA-AUDIT-DTL-03 — external OPS vehicle read parity

- Repro: owned OPS trip2172 has externalPlateNumber15H-154.98, but OPS list/detail show missing vehicle because only the OWN truck join is projected.
- Expected: EXTERNAL reads use persisted external plate, OWN reads keep their truck plate, absent external plate remains null; inbox no longer declares an absent plate that exists.
- Regression: real-DB list/detail reads for EXTERNAL/OWN/null before code, red→green, actual OPS row/detail captures, unchanged entity/version proof and exact driver log.

### QA-AUDIT-UI-12 reopened — expense dialog context remains visible on phones

1. Reproduce the operator-rejected390px ChiHo draft screenshot retained under
   `qa/2026-10-01_comprehensive-audit_operational-board-final/03_admin-390-chi-ho-draft.png`.
   The prior numeric containment pass does not approve hidden left context or
   broad edited-row accent fills.
2. Open actual chi-hộ and tiền-đường controls for an existing populated Bill and
   an existing empty detail record at390/768/1440. Phones must expose every fee,
   invoice/date, person, original/editable amount, total and row action as labelled
   records without horizontal panning; wider screens retain readable grids.
3. Focus and edit a real amount, inspect live totals and quiet unsaved text,
   exercise supported input validation, restore the original, and click Cancel.
   Assert all labels/controls fit, money stays atomic, and focus/error indicators
   use the house tokens. Preserve confirmed correction/version/source behavior.
4. Save screenshots, post-click DOM assertions, exact persisted before/after API
   parity and full driver command/output/exit. Mutation paths not invoked remain
   explicit limitations. Obtain independent source review and root visual review
   before reporting this reopened operator case passed.

QA-AUDIT-ENV-03 auth-origin continuation: run the canonical real session's
coarse-pointer viewport reload while its initial URL is `about:blank`, retaining
the exact pageerror URL. The pre-navigation auth hook must touch only the
configured SPA origin; opaque documents produce no auth-storage error. Navigate
to the actual accounting page and require the injected token to match the
canonical session (record a boolean only), expected role/path and pageerrors0.
Never suppress a browser error to make the coverage report green.

### QA-AUDIT-WF-05 — existing template loading remains pure under StrictMode

1. As actual ADMIN open existing `/config/debit-note-templates/1` and compare
   the “Tên mẫu” field with authenticated `/debit-note-templates/1`.
   Repro shows the blank new-template default despite the populated API row.
2. In the existing governance suite, deliver its existing persisted template
   after a StrictMode render. Require the exact loaded name and clean Back
   navigation without discard confirmation. Refresh the same persisted object
   after an unsaved draft and require the draft to survive.
3. Drive real existing template sections/focus/select/Back at390/768/1440;
   retain screenshots, DOM/API parity and zero material requests. Preserve
   create/edit routes, dirty guard and all save/delete payload semantics.

QA-AUDIT-COVERAGE-01 legitimate legacy detail completion: as the actual owner,
select existing fully funded advance93 (3,500,000), leave expenses empty because
the real legacy unlinked-expense list is empty, enter full refund3,500,000 and
record through the actual create form once. Require zero balance and exactly
one allowed material request. Preserve the real created record; capture linked
advance allocation, recorded total/refund and matching ledger effect. Use its
actual returned id to drive both OPS `/my-settlements/:id` and ACCOUNTANT
`/settlements/:id` at390/768/1440, open/close print preview and retrieve Excel.
All subsequent page/export actions are read-only and preserve the record.
Native printing, populated legacy expense corrections and reversal remain
separate unexecuted states; do not invent or seed their data.

### QA-AUDIT-UI-19 — rounded house dialog chrome and complete form values

1. As ADMIN open actual `/config/ports` “Thêm mới” at 390. Reproduce the
   operator screenshot: white header ears past the rounded shell and truncated
   “— Không thuộc khu vực điều phối —” selected field value.
2. Sweep Ports plus two existing house config dialogs at 390/768/1440. Require
   header/footer corner radii to meet the shell radius, all selected field words
   to remain visible without widening the dialog, and no document overflow.
3. Click actual region select, open its portalled list, dismiss with Escape and
   assert the dialog survives; focus the field with Tab, then Cancel and assert
   focus returns. Compare exact catalog snapshots before/after, record zero
   material requests, and preserve shared compact filter geometry.

FIN01 final boundary: compare current rates for CREATED zero-snapshot OWN versus committed legacy stored fuel; retain partial nonzero snapshots, both-zero road fallback, changed route/trailer allowance, explicit override0 and persisted overrides arriving after detail load. Completed EXTERNAL rows retain revenue warnings but never request OWN fuel.

DTL03 final gate boundary: actual owned plate15H-154.98 with missing external driver keeps readiness pending and names the missing driver. Existing no-plate and fully assigned branches retain their exact readiness semantics.

FIN01 detail breakdown: actual EXTERNAL detail must show ex-VAT freight, commission, inclusive hire and existing actual extras consistent with canonical total/profit; it must not imply own-fleet fuel/road/salary is being charged. OWN breakdown remains available. Direct component tests include populated OWN amounts in an EXTERNAL payload and VAT8%/commission/extras.

FIN01 aggregate parity: register missing-fuel count equals applicable OWN running/completed row warnings, excluding OWN created/canceled and every EXTERNAL row. Pin real-DB summary total/status counts unchanged and null/zero fuel both counted; positive fuel omitted. Re-drive actual local manager full register after the query correction.

### QA-AUDIT-UI-22 — numeric identities stay whole across record renderers

1. As actual local DISPATCHER dieuvan click Khách hàng at1440. LONG MINH
   tax2300540419 and Biển Bạc phone02253555555 must each occupy one text line;
   retain red screenshot and Range rectangle evidence before the fix.
2. Pin the shared atomic value rule and exact customer/supplier/driver contact
   call sites without changing names, emails, missing labels, field values,
   sort/search or callbacks. Require no ellipsis, clipping or page-local skin.
3. Drive customer directory390/768/1440, actual phone search and native detail
   disclosure, then inspect supplier/driver rows with existing real data.
   Require complete single-line identity values, wrapping surrounding labels,
   no document overflow and unchanged authenticated API/DB snapshots. No Save,
   Delete, Create or account identity mutation is required for this visual claim.

### QA-AUDIT-UI-26 — factory and record-table row ordinals stay whole

- Repro: local ADMIN opens `/config/factories` at390; scroll to existing rows10–13. The ordinal splits digits vertically and bleeds into the Khách hàng fact.
- Expected: STT is a complete atomic number on one line at390/768/1440, separated from the name/customer facts. Prose and names continue wrapping; row order, API data and actions remain unchanged.
- Sweep: shared record-table STT cells in CrudTable, invoice tracking, reconciliation, audit log, deposit and expense-detail dialogs; inspect their dedicated ordinal rules without changing unrelated layouts.
- Evidence: preserve original red screenshot; unmocked semantic style regression red→green; actual navigation/lower-scroll screenshots and DOM range rectangles; read-only API value parity; exact driver command/exit under qa.

### QA-AUDIT-FIN-02 — monthly revenue chart agrees with recognized P&L

- Repro: local ADMIN `/finance` October2026, actual Day chart shows about10.8m/6.6m while authoritative P&L/KPIs show4.5m/2.85m; CREATED operational trip2172 has10.8m but is not recognized in the report.
- Accepted resolution B: retain the authoritative monthly report chart and remove unsupported daily view/control. Explain the year/month period clearly. Operational mutable freight/profit and unrelated unrecognized/canceled work cannot enter the chart. Negative expense-only months remain visible even with no completed trips, and all positive/negative SVG points stay inside the chart domain. Missing source is not invented data.
- Before repair: capture exact report and operational API payloads, confirm current posting/date contract. Add unmocked meaningful regressions using the retained real read fixture and pure data boundary transformations, preserve red→green.
- Re-QA: actual month picker T9→T10 at390/768/1440, visible selected period, accessible exact chart values and absence of unsupported Day control, screenshot+DOM, exact API/DB readback parity, driver exit and source review. No posting/ledger/policy/write changes.

### QA-AUDIT-UI-32 — negative Treasury money remains inside labelled records

- Repro: local ADMIN `/finance/treasury`390, first seed-fund book balance -14.490.000 ₫ crosses right record/viewport edge because a page-local outer numeric nowrap prevents label/value reflow.
- Expected: full money sign/digits/unit remain intact and within its cell/record; label can wrap separately. Shared labelled-record authority owns outer wrapping, no truncation or forced offscreen scroll.
- Sweep exact outer-nowrap numeric record class; add unmocked semantic style/render regression before edits. Actual Treasury sort control, screenshots/DOM ranges and account API parity at390/768/1440; no financial/data changes.

### QA-AUDIT-UI-33 — Profit source links never display internal trip codes

- Repro: local ADMIN `/profit`, source TRP-202606-0003 appears for a recorded trip with absent shipment Bill/Booking.
- Expected: persisted Bill, then Booking, then existing honest missing-reference copy; internal trip ID remains only the exact navigation/API key. No monetary, pagination, posting or policy change.
- Regression: existing real-DB pagination suite must cover real linked import Bill, export Booking, and absent business reference; assert IDs and totals preserved. Preserve red→green logs; actual source-link click, detail identity, API/DB readback and screenshot/DOM at390/768/1440.

### QA-AUDIT-UI-37 — expense source identities never substitute internal codes

- Repro: actual `/accounting/expenses` primary lot context shows #2440/#2441; reader sends internal shipment/trip codes despite joined Bill/Booking.
- Expected: current persisted Bill/Booking or explicit missing reference in register, detail, voucher and report contexts; persisted trip customer reference/lot business reference for trip context. Numeric IDs retain exact links/source keys, financial amounts/actions unchanged.
- Add existing real-DB transactional reader regression for import/export/missing; assert source IDs, amounts and context through list/detail. Actual read-only detail-trigger/Cancel and source-link navigation at390/768/1440; API/DB parity, screenshot/DOM, driver log and independent review before done.
- Recoverable continuation: actual cards show SHP/TRP source codes. Add joined Bill/Booking/customerReference display fields and explicit business-reference sort keys, retaining existing raw-code keys/meaning. Real-DB list/detail tests pin Bill/Booking/missing and new sort orders; actual cards/source action/screens/API at all three widths, no money/eligibility changes.

### QA-AUDIT-UI-29 — quotation create opens a working validated frame form

1. As ADMIN, click Tạo báo giá on the actual configuration screen at390/768/1440.
2. Submit empty required fields; require visible customer/name/date errors and
   focus on an invalid field, with no POST. Fill a real customer, valid date,
   template name and rounding choice, then Cancel; list/API must remain equal.
3. Create exactly one explicitly QA-labelled local quotation through valid UI
   submit for that real customer. Require the existing idempotent POST, exactly
   one new frame, version1 and auto-selected live detail using unchanged pricing.
4. Reopen/Cancel at all widths, retain screenshot, actual DOM, API/DB readback
   and driver command/exit. No internal card tooltip, inert enabled create link,
   page-local form skin, synthesized prices, routes, fees or financial engine.
Expected: real creation flow uses house Modal/Button/TextField/Select/date;
required/schema validation prevents writes, pending submit cannot duplicate or
close, error retains the draft, successful creation selects the persisted frame.

### QA-AUDIT-UI-34 — dispatcher resource records use the house white surface

1. As DISPATCHER, open actual /fleet/vehicles, /fleet/drivers and /fleet/external
   at390/768/1440. Inspect populated top/lower records and table header corners.
2. Require shared Panel white surface, hairline border and primitive radius;
   no page-owned transparent wash. Identifiers/status/actions remain contained,
   no document overflow, sticky desktop headers remain opaque/reachable.
3. Phone shows one visible screen name in the central topbar; accessible H1
   remains present and adopts the existing house phone-title rule.
4. Open current vehicle assignment, driver edit and external registration;
   inspect, focus real picker/field then Cancel. Compare real reads before/after,
   block every material request and retain screenshot/DOM/driver/API parity.
Expected: one shared catalog shell repair flows to vehicles/drivers/external and
supplier/linked catalog surfaces; no assignment/create/retirement logic changes.

### QA-AUDIT-UI-35 — populated quotation pricing facts remain readable

1. ADMIN selects actual persisted quotation45 for LONG MINH, future effective
   date2026-10-02, at390/768/1440; no financial edits or writes.
2. Phone displays all ten vehicle classes as labelled house records, coefficient
   controls plus liters/cost/surcharge/total visible without horizontal panning.
   Full signed money digits/unit stay together inside each fact/viewport.
3. Tablet/desktop retain canonical grouped matrix; inspect first and last class
   tracks through actual horizontal scroll. Headers remain complete; amounts never
   overlap neighbouring cells. Focus a coefficient without modifying it, retain
   unchanged draft/commit semantics and exact route/class association.
4. Capture upper/lower record and matrix endpoints, screenshot/DOM range
   rectangles, canonical real API reads before/after, driver command/exit and
   independent source/visual review. Current pricing, source fees, rounding,
   missing-price copy and version1 remain unchanged.

UI35 coefficient boundary continuation: focus and blur the real unchanged
coefficient must issue zero writes or new versions. Actual modified valid values
retain the existing route/class commit payload; malformed values must not create
an update with an unchanged fallback. No API/pricing contract modification.

### QA-AUDIT-UI-40 — shared long-option popovers remain inside the viewport

1. DISPATCHER /fleet/vehicles390 opens actual assignment60C-12345 and focuses
   driver picker; red documentWidth458 retained. Re-QA390/768/1440.
2. Popup outer box stays within viewport inset, long driver labels wrap fully
   inside option rather than min-content overriding max-width or hiding text.
   Plain Ports region/category lists share the same containment; selected value
   retains UI19 full label/hint and normal/compact control geometry.
3. Actual open/focus/Arrow/Escape/Cancel on real data, range rectangles and
   screenshots before/after plus API parity; no material writes. Shared source
   contract regression and existing search/style suites must remain green.

UI34 dialog continuation: external registration has a visible labelled house
plate field and full stacked carrier select at390/768/1440; empty and populated
existing carrier selection, keyboard focus, Cancel and exact API parity with zero
material writes. Preserve register validation/handlers and existing Drawer anatomy.

UI34 shared Panel continuation: a direct flush table under a headerless Panel
respects its top corners while retaining overflow-visible sticky header reach.
Panel with its own header keeps that existing anatomy; use one shared rule, no
catalog-local skin. Actual first/last corner/lower table at768/1440 and phone
records unchanged; unmocked source regression verifies shared authority.

UI35 frame-list continuation: effective date2026-10-02 remains a complete atomic
value, names/notes wrap at words without forced digit shattering. Shared record
table recipe owns narrow records, selected state and fact labels; real created
frame45 can still be physically selected at390/768/1440 and through Enter/Space.
Full original list and selected-grid screenshots/APIparity before declaring pass.

UI35 replace-all payload continuation: real quotation45 has30cells across three
routes; changing one route/class coefficient must preserve all30keys and every
untouched coefficient plus all current fees. Add unmocked real-fixture merge
regression; actual controlled UI change/readback then forward restore/readback,
exactly two idempotent PUTs, no other material requests, legitimate append-only
versions. Native Space/Enter frame selection and untouched focus/blur0writes remain.

### QA-AUDIT-UI-43 — customer inbox restores queue through async scope hydration

1. Local CUSTOMER samsung-cs opens `/portal/shipments?tab=1` before the customer
   scope has resolved. Current primary customer7 has actual WAITING records.
2. Require no unscoped inbox request while `scopeReady=false`; first ready scope
   preserves WAITING and restored page rather than resetting ACTION/page1.
3. Rerender with a later genuinely different customer/role: require ACTION/page1
   for the new scope. A retry that resolves the same identity preserves selection.
4. At390/768/1440 click actual Refresh, focus/Enter a real waiting record, return
   through its queue-context link, then reload. Require WAITING selected and the
   original record present. Save screenshots, DOM, exact driver exit and real
   scoped API before/after; no material writes or changed persisted sources.
5. The sole customer screen title remains visible under the brand-only shell;
   OPS keeps the shared phone title rule. No backend, response policy or RBAC edits.

UI37 missing-name continuation: actual OPS/source259 entry267 on shipment3937
renders customerName `#1568` in the register/detail. Missing customer/carrier/payer
and approver names must use honest missing-name copy while retaining original
IDs, group keys and exact source links. Canonical historical/inactive names and
nonblank raw customer names remain usable. Real-DB list/detail/report cases pin
missing vs existing customer/carrier names and all amounts/source IDs; actual
entry267 drawer and report at390/768/1440 with read parity and zero writes.
The existing expense drawer's historical payer option retains its numeric option
value, while its label uses the same honest missing-name treatment rather than
`Nhân viên <id>`. Pending submit, native validity and correction commands remain.

UI35 quotation identity regression: local ADMIN selects QA quotation45, enters an unsaved coefficient draft on existing route1, then physically selects existing quotation43 sharing route1. Intercept all material writes during this repro and retain attempted blur payloads. Expected:43 renders its own API coefficients, never45's draft; selecting45 again reads45's current values. Native Space/Enter selects the frame; untouched focus/blur emits no writes. Same-quotation background refresh preserves an active draft. Save screenshots, post-click DOM, two-object API parity and driver log at390/768/1440.

UI35 pending-blur continuation: actual first controlled PUT45 committed30cells/version2, but disabling the next focused coefficient during the pending mutation invoked another blur and emitted a duplicate PUT (intercepted and aborted). Before the forward restore, add an unmocked RouteBlock regression using retained real cell views: dirty coefficient plus saving=true blur must emit no callback; unchanged refresh must preserve draft until quote identity changes. Guard commit while saving. The helper must use resolved required heSo, never optional schema input/default inventions. Preserve original failure log and exactly two material updates.

UI34 placeholder-casing continuation (root full frontend gate red): ExternalFleetView registration uses abbreviated uppercase `VD: 29A-12.34`, which violates existing shared sentence-case placeholder law. Before source edit, add this regression: open actual external registration at390/768/1440; blank house plate field shows `Ví dụ: 29A-12.34`, existing entered plate remains unchanged; Cancel/read parity with no material writes. Re-run existing placeholder casing guard and resource shared contract tests; do not weaken the guard.

### QA-AUDIT-ENV06 — globally keyed fuel fixtures own their dates and cleanup

Run fuel-period-envelope and quotation-versions on a seeded isolated DB with
historical2026-10-01/02 already occupied. Preserve the red409/unique-key evidence.
Fixtures must allocate unused dates by actual ORM reads/unique insertion and
retain keyed201, keyless400, AGREED monotonic version releases and DECLINED no
release. Run both suites twice; their own fuel periods/approvals must be removed,
historical periods unchanged. Re-run test-inclusive types. No application,
schema, unique-key weakening or deletion of another suite's records.

UI37 carrier-group continuation: actual ADMIN OUT report has SilverSea group
SILVERSEA_INTERNAL,total535000,settled130000,outstanding405000 and existing
BillQA22-DISPATCH-220922-A source entries. The visible carrier display must not
show internal grouping keys. Click total drilldown and Close at390/768/1440;
keep names, exact Bill links/source IDs, every amount, truck plate and grouping
key in API unchanged. Register missing-name fallback must not expose the same
key. External CUSTOMER:id/SUPPLIER:id visual branches are not currently populated;
state this explicitly and do not create unrelated new expenses to manufacture
proof. Source/meaningful canonical-row regression covers that shared boundary.

UI35 user density regression/reopening: preserve rejected exact04_390-route-1-class-1.25T and10_390-route-1-class-CONT20.LIGHT originals. Click actual quotation45 frame, scroll to each of30 real class records over3routes; all five facts visible without disclosure/panning; coefficient40px, amount/zero/missing states atomic. Shared label/value density should reduce a five-fact card350→≤210px390 (≥40%). Re-drive approved390/768/1440, exact layout dimensions and original full-card screenshots; all shared UI31 consumers/selection/details/page20 and print matrices remain intact. Root independently approves current pixels. Blank draft: clear exact existing coefficient1 then Tab with every material request aborted; expectedno update, while explicitly typing0 remains a valid coefficient payload. Retain original red and API/version parity.

UI35 current owner control/matrix acceptance: short numeric96px shared TextField, no maxLength/new business validation; ordinary coefficient40px, decimals/explicit0 valid. At768/1440 physically pan every route matrix0/mid/end; sticky metric labels remain opaque, fully readable and aligned with values, including first numeric column (not accidentally left-aligned). Intrinsic money/class tracks preserve complete grouped headers. Phone all five facts use compact shared label/value rows without horizontal pan; record height budget alone cannot establish visual PASS. Save new original screenshots and obtain independent owner pixel approval. Plain Vietnamese rounding-policy text preserves existing fixed half-up behavior.

UI35 explicit-zero material continuation authorized by controller after actual blank red: on existing QA-owned45 atversion3, clearing1 then Tab must emit0attempts. Explicitly type0 and Tab: one guarded PUT must persist full30cells/three routes/currentfees, target coefficient0, version4. Independent read-only ORM captures before forward restore; type1 through the same control, one PUT persists full30/fees/target1 and version5. All other requests abort, idempotency required, screenshots/DOM/API/ORM/log per phase. Earlier versions1–3 remain; no byte-rollback claim.

UI35 blank display consistency continuation: blank, whitespace, invalid text or negative draft restores the stored coefficient on blur with0save callbacks/requests; totals and visible coefficient agree. Explicit0 remains valid. Same-quotation valid draft/pending guard/quotation identity regressions remain unchanged.

UI35 desktop transpose case: quotation45/three actual routes each render ten class rows and columns class plus Hệ số/Lít/Giá cos/Phụ phí/Tổng from the same shared LedgerMatrix cells as phone facts. Verify all30classrows/currentfivefacts, actual field96×40, aligned atomic money including20zero surcharges and6missing-price/total states. Native full scroll0/mid/end where matrix genuinely exceeds viewport; class identity and metric heading context remain visible. Root reviews stationary current original390/768/1440 before explicitzero material save.

UI35 current owner sizing override: ordinary mobile component ceiling40does not mandate a40floor for short coefficients. Shared TextField short-number uses72px width/30px canonical compact height at390/768/1440, including border-box/group/affix and visible focus. Default controls unchanged, valid decimals/zero/no maxLength preserved. Previous96×40pixels superseded. Save new settled actual all30five-fact originals with72×30 before root approval/any0save; blank restores1with0attempts.


### QA-AUDIT-ENV07 — design locks measure resolved local app content

Repro: current filtered shipment phone art lock captures an entirely white page and0/0 art while the same exact query renders1/1 at768. Before measuring a lock/probe, require an authenticated resolved main with non-loading text and the requested pathname under a30s bound. Preserve existing art min1 and every geometry tolerance; failure to load must remain a red gate. Use explicit installed Chrome override for current local browser execution. Save raw red original, exact driver command/output/exit and full re-run report; this runner gate does not imply every empty-state mutation/role or staging.

ENV03 customer navigation continuation: current complete E2E TC-1520 renders exact three customer labels and minimum40 but demands obsolete44. Before test-only correction, retain that red. At actual375px require the three visible, enabled bottom-navigation anchors to each satisfy39.5–40.5px, preserving labels/count, portal route headings, horizontal overflow and access isolation checks. Missing/hidden/disabled/undersized/oversized targets must remain failures. Capture the actual nav screenshot and full case output. Sweep44/48 mobile target minima across functional E2E (viewport dimensions/case IDs excluded); no product geometry/RBAC edits. Python compile and fresh complete19-suite E2E gate required.
### QA-AUDIT-UI-45 — shared single-line option ceiling

Repro before source edits: local DISPATCHER `/fleet/external` at390×900 → Thêm xe ngoài → focus Nhà xe. Stationary visible options have46px rectangles: inner obsolete44px minimum plus2px outer padding. Evidence: `qa/2026-10-01_comprehensive-audit_ui34-stationary-picker/02_phone-search-focus-stationary.png` and paired DOM; exit0, writes0, unchanged real resource reads. Earlier duplicated-focus04/closed-picker05 screenshots remain rejected history.

Expected: every visible single-line picker/menu option target is≤40px at390/768/1440 with wrapper padding included. Full genuinely multiline labels retain normal wrapping and intrinsic content height, without fixed-height clipping or viewport spill. Sweep installed SelectItem, shared/custom searchable/inline/time option owners and their actual callers; preserve selected/focus states and keyboard arrows/Enter/Escape plus parent Cancel. Use existing real carrier/driver/region/category values in unsaved drafts; no catalog/account/material write. Save actual screenshots/DOM, safe API/ORM parity, command/exit and source hashes. Independent reviewer and affected gates must pass; a source-only sweep does not upgrade an unclicked owner to UI DRIVEN.


Independent supported-branch continuation: md/lg avatar24px +16px vertical
padding +2px wrapper totals42px, despite the changed minimum. No current
avatarUrl page caller exists. Expected: shared md/lg padding fits that supported
avatar within40px without changing the global Avatar or clipping text; source
regression covers all size branches and remains CODE-READ ONLY for this unused
runtime branch. Initial actual-driver customer selector red remains harness
history and is corrected to the trigger's real id, never skipped.

Actual multi-selected continuation before fix: ADMIN `/shipments` Kế hoạch →
select real Mới tạo/Đang chạy/Chờ khóa → close picker. At390/768/1440 there
are3native buttons nested inside the native trigger; actual height30px, so no
growth is inferred. Red `ui45-multi-selected-red` screenshot/DOM/exit1 and
customer master parity/0writes retained. Expected: one compact count trigger,
full names in existing checked options, individual toggle deselect/clear-all,
required/disabled and hidden value preserved, keyboard selection/Escape/focus
return retained, no nested interactive descendant and height≤40px. Source tests
for chip removal must exercise real option deselection instead of deleting
callback coverage. The dormant native-lg38.2px budget remains unchanged.

Final active-owner sweep before edit: DatePickerSurface (used by date-only and
split date/time fields) still declares44px coarse calendar-day and nav/close
buttons. This is CODE-READ ONLY at discovery, not an actual measured claim.
Expected: replace that shared obsolete floor with the40px token, preserve
calendar range/adjacent-month selection/Escape and focus; add actual three-width
calendar opening and navigation to UI45 final proof. Existing calendar behavior
assertions remain, and the style owner regression covers this shared surface.

### QA-AUDIT-UI-49 — clear-all then Escape preserves parent

Actual local ADMIN /shipments390: open Bộ lọc → Kế hoạch → select Mới tạo/
Đang chạy/Chờ khóa → individual deselect/reselect → Bỏ chọn. Clear-all becomes
disabled and the browser moves focus to BODY. Immediate Escape closes both the
child picker and its parent FilterDropdown; the plan trigger unmounts instead
of regaining focus. Red5DOM/6PNG/driverexit1 are retained under
qa/2026-10-01_comprehensive-audit_ui45-multi-selected-green (historical red).

Root cause: shared useClickOutside registers the existing overlay token but its
Escape listener never checks topmost ownership. Target-only ignoreSelector
yields while focus is inside the child, but cannot identify ownership at BODY.
Use existing isTopOverlayToken, as the shared Modal already does. Do not force
focus or weaken the actual driver to avoid this clear-all state.

Expected: Escape dismisses only the topmost picker even at BODY; its existing
close callback restores the trigger inside the still-open parent. The next
Escape closes the parent. Preserve click-outside/ref-path behavior, token
cleanup, top-level dismissal and disabled/clear/hidden-value semantics. Sweep
all useClickOutside Escape consumers through the shared owner.

Regression first: controlled real shared-hook nested layers, clear disables
focused control and BODY Escape leaves parent; next Escape closes parent;
outside-pointer behavior remains. Actual selected/toggle/clear/keyboard/Escape
390/768/1440 plus direct read-only ORM before/after and driver artifacts.
Independent ui_actions review and final affected gates required.

Design: existing house overlay token stack and installed v8 Select/checked
menu primitives; UI45 paid catalog discovery already retained. No new layout.

UI49 independent caller continuation: a mounted, closed LocationAutocomplete
must not register an open overlay or block a later parent's Escape. Focus its
existing port suggestions after the parent opens: first Escape dismisses only
the child, retains parent and input focus; next Escape closes the parent. Reopen
the parent and child and repeat to require fresh token order and balanced
cleanup. Source discovery is CODE-READ ONLY; use the existing component/catalog
fixture for a red-to-green regression without new mocks. Audit all hook caller
activation contracts, then actual existing trip location fields and Multi
clear-all at390/768/1440 with screenshots/DOM/driver and direct ORM parity.


UI49 native same-event continuation filed before fix: the source-quiet actual
clear-all replay remained RED. A bounded native listener observer records the
same Escape eventId2: child document listener13 calls stopPropagation with
defaultPrevented=false; a browser microtask removes its token/listener before
parent listener16 handles that same document event. The parent is then topmost
and closes too. Same-target listeners are not stopped by stopPropagation.
Retain both raw failed drives and the native trace; no null-selector assertion
repair can establish acceptance.

Expected: the topmost shared owner consumes Escape once with preventDefault;
other shared owners respect defaultPrevented even if child cleanup has already
changed the stack. Do not stopImmediatePropagation or alter unrelated pointer
listeners. Before the hook fix, add a real native document regression where
child dismissal uses React flushSync to expose cleanup before the later parent
listener. It must fail with the current handler, then pass first-child/second-
parent dismissal and preserve unrelated listeners and pre-consumed events.
Re-run the actual selected/toggle/clear/native-keyboard/Escape sequence at
390/768/1440, plus actual Location activation/reopen/parent discard and Cancel.
Use the retained safe read-only147-table ORM baseline and capture a new AFTER
once all targeted browser lanes close. Source quiet/final gates are revoked
until the actual red closes; no self-approval. Existing house overlay tokens
and native event consumption are the chosen implementation, with no new UI.


### QA-AUDIT-UI-53 — prefix date border has one paint/geometry owner

Repro: root and ui_actions manually viewed the current UI48 date-pair contact
originals at390/768/1440 across every real host. White nested segment paint
interrupts the top/bottom outer prefix-field border. Existing geometry/glyph
PASS does not establish paint acceptance; retain those originals as visual RED.
Before changing source, capture actual wrapper/group/segment rectangles,
computed background/border/min-height and state in real local fields.

Expected: the prefix wrapper owns the sole opaque field fill/border; nested
segments stay transparent and fit within its border content box. Standalone
dates retain their own opaque border, disabled/read-only surfaces and focus/
error semantics. Preserve complete DD/MM/YYYY glyphs, native selection/clear/
min-max rejection, independent endpoints and40px ceiling. No blanket overflow
clipping, page-local paint override or calendar replacement. Sweep every
DateRangeFields host and shared prefix anatomy; source regressions must fail
before repair, and actual3width empty/full/focus/error paint plus safe API/ORM
parity requires new screenshots/DOM/log. Independent review, root build and
affected gates precede acceptance. Paid UUIv8 date catalog consulted; retain
the existing house BufferedUuiDateInput/DateRangeFields because the owner has
explicitly chosen two separate date fields.


QA-AUDIT-UI-53 continuation — invalid helper is outside the date control.
Actual local ADMIN /shipments390/768/1440 native invalid33/10/2026 plus blur
shows the helper paragraph as a flex-row child inside the30/40px prefix border;
it overlaps the date and shrinks the group115→30px. Retain the current15-state
geometry-green screenshots as visual RED. Before structural repair add a
rendered DateRangeFields native invalid-draft/blur regression. Expected: one
shared Buffered date inner boundary contains prefix and all three segments;
accessible label and helper remain in the outer column. Error is readable
below, never inside/over the date, and both controls stay top-aligned. Native
valid correction, standalone date states, picker/clear/minmax/handlers and
40px control ceiling remain. Actual fresh error/correction pixels, all-host
paint/read parity and independent review are required before acceptance.

### QA-AUDIT-UI-54 — legacy trip ordinary controls obey the shared ceiling

Repro: local ADMIN /trips/new at1440, actual Journey add-leg and focus, has
LocationAutocomplete “Chặng1: điểm đi” height45px. Retain
ui49-location-controls-visible-rerun/18_1440-location-focused.png and its DOM.
JourneyLegRow.css incorrectly owns a global .input--sm min-height45px.
Source class sweep also finds container single-line fields45, rail/mobile
actions45, reminder/route buttons45, capture45 and remove-photo icon44,
and collapsed one-line accountant-note action44. These are true controls;
checklist/read rows, multiline notes, disclosure and photo media are separate
content and must not be compressed by an indiscriminate max-height rule.

Expected: the shared legacy Input primitive owns small-field geometry; trip
field/action callers inherit house Input/Button tokens instead of raising
their min-height above40. Compact30/28 date/coefficient anatomy remains.
Ordinary labels, valid decimal/text values, focus/error/disabled states and
all actions retain their existing handlers. Media/body sizes remain intact.
Before repair add a source-owner regression that fails on the actual45
modifier and conflicting trip fields/actions. Afterwards drive actual
new/edit Journey, container identity, instructions/reminder and available
photo/note controls at390/768/1440 without saving, capture rects and full
originals, Cancel, safe API and direct ORM parity. Record unavailable material
photo states honestly. Sweep mounting controls for every remaining single-line
over40. Paid UUIv8 input catalog consulted; the existing house Input/Button
primitive fits these native legacy callers and preserves financial logic.

UI54 class continuation filed before additional owner edits: source confirms
ImagesNotes remove-photo icon44 (thumbnail72 stays); DriverContainer secondary
scanner action coarse44 and sheet action48; TripPod true action/submit and
file-download44. Retoken those ordinary actions to the current shared40
ceiling, retaining mounted handlers, POD tablet subgrid/content-sized header
assertions and original media/disclosure anatomy. FuelModeToggle radio labels
need their shared house typography/padding budget to fit complete one/two-line
labels without a fixed-height clipping cap. CheckboxCard with label plus
description, checklist/read rows and media upload zones are content cards,
not ordinary one-line controls. Actual proof must classify each mounted
owner separately; unmounted supported branches remain CODE-READ ONLY.

UI54 camera continuation filed before edits: supported shared ContainerScanner
close/flash/gallery use44px controls and shutter72px (decorative interior56);
DriverContainer native “Thêm ảnh” capture trigger fixes its real button at72px.
These are actions, not photo media exceptions. The current user's all-screen
40px ceiling supersedes the dated72px capture-tile geometry. Shared round
actions/shutter consume the40px token and fit their existing painted ring;
the container capture trigger uses compact horizontal icon/label anatomy
without hiding labels. Preserve camera/video, photo/preview dimensions and
existing capture/upload/focus/cleanup handlers. Add meaningful shared token
and mounted-control regression before repair; update only the obsolete72px
action expectation, retaining group row/density contracts. Fresh actual
open/error/close scanner and Thêm ảnh sheet at3widths are required; physical
camera-success/gallery/upload material effects remain explicitly uncovered.


### QA-AUDIT-UI-54 — tablet action visibility continuation

1. Local ADMIN, actual Bill QA-WF04-114144 / trip706, `/trips/706/edit` at390/768/1440; also inspect the641 and820 complementary-band edges. Click the existing reminder chip without saving. Baseline768 has neither visible Save nor Cancel because desktop actions hide at820 and mobile actions show only640. Retain exact current PNG/DOM/driver RED; no mutation.
2. After repair, exactly one current action group is visible and keyboard reachable at each width. All single-line action buttons remain<=40px. At768 the sticky footer must expose full Save/Cancel text and allow the last form content to clear it; no clipping, duplicate controls or new geometry recipe.
3. Click the actual existing Cancel, preserve current pending/dirty confirmation behavior, and return to `/trips/706`. Direct API and scoped Drizzle before/after must retain the existing trip/version/financial data with0material attempts. Native Save submission is not authorized by this read-only continuation. Sweep sibling legacy desktop/mobile action bands and retain any additional genuine gap as a new case before correction.


### QA-AUDIT-UI-53 — full-suite owner assertion continuation

The existing filter-grid rebuild cue/seam regression must assert shared `[data-date-boundary]` border and borderless nested segment group in BufferedUuiDateInput, while retaining both date cues, decorative arrow, independent endpoint/order/width contracts and helper outside the boundary. The old outer `[data-has-prefix]` border expectation is obsolete after the approved error anatomy; preserve full frontend RED and rerun this existing case with the real invalid helper component regressions. No assertion skip/deletion or glyph budget reduction.


### QA-AUDIT-UI-56 — filter feedback control-row alignment

1. Local ADMIN `/shipments`1440, native select existing01 day and type33, then blur. Retain the current invalid-date full original14/DOM from UI53 final-helper: helper is readable but adjacent search/select controls drop~37px. This is visual RED regardless of date glyph/border assertions passing.
2. Repair only shared FilterBar feedback state. All actual same-row control boundaries align consistently while helper remains below its field and reserves normal flow before the next row. Default visible labelled stacks retain bottom alignment; mixed visible-label+feedback rows require explicit source/unit and actual reachable-host evidence. Intrinsic widths/two measured control rows and existing folded phone/tablet dialog placement must remain.
3. Repeat empty/focus/nativeTab/complete/invalid/correction390/768/1440 with complete glyphs, no clipped helper or overlapping next row, and<=40px actual controls. Preserve source/runtime/API/direct scopedORM parity and0material attempts. Separate current whole-row pixel approval from earlier scoped-field acceptance and independent code review.


### QA-AUDIT-UI-56 — mixed external-label continuation

Repro: ADMIN local `/accounting/expenses?view=fund-book`,1440 fine pointer.
Observe “Nguồn quỹ” above the select and both valid date/select tracks at
Y216.6875. Native Home+Shift+End replaces selected valid day01 with33; blur
the date and preserve actual invalid feedback. Current date track moves to
Y194.1875 while the labelled select staysY216.6875. Retain two original
screenshots/DOM and exit1 in ui56-mixed-labels-red-current before source.

Expected: shared filter-context select anatomy retains its visible label and
selected value on the control row using the existing house inline recipe.
At390/768/1440, native valid→invalid→corrected keeps date/select control tracks
aligned when they share a flex row, full glyphs/feedback and ≤40px ordinary
controls. Actual select opening/keyboard selection updates the real filter
and forward restores its original selection with no material request.
Outside the bar, ordinary form and naturally folded portalled criteria keep
stacked visible labels, full selected values and existing option/callback
semantics. No page-specific offset/variant, label clipping, fixed helper
height, grid declaration or second financial logic. Require complete current
originals, source guard, native driver, relevant API before/after and targeted
safe Drizzle147-table AFTER; staging and material submission remain uncovered.

### QA-AUDIT-UI-54 — driver ceiling continuation

- Local DRIVER/`laixe` `/my-trips/1951` (real owned Bill BLQA20-289316/fulfillment3114),390/768 coarse and1440 fine. Capture native border-box rectangles for Back and `Xem chứng từ giao hàng`, then click the actual POD link and actual Back. Expected ordinary single-line control height≤40px at all widths, complete labels/focus, correct concrete POD route,0material attempts and exact owned API/direct ORM parity.
- Sweep the existing Driver accept/completion/fuel/back and POD conflict-reload CSS owner budgets. Media, read/fact rows and multiline disclosure content retain their dimensions. Native source regression rejects obsolete44/48/52 control floors while retaining pointer/disabled/action CSS and callbacks. Unmounted accept/fuel/conflict/material completion states are explicitly source-only until legitimately reachable.

UI54 driver native rectangle continuation: retain twelve-state red with POD48/allwidths, Back44/desktop and single-line section toggles47/coarse. Current coarse toggle padding must no longer inflate its header beyond40px; click actual collapsed/expanded header and keep full body facts/readability. Sweep real journey category/day-view/card-footer controls in the existing CSS owner; static fact48px/decorative images stay outside control ceiling.

### QA-AUDIT-UI-56 — standalone labelled date continuation

- Real ADMIN `/config/quotations`390/768/1440, normal→native33 invalid + true field blur→native clear/corrected. Both standalone labelled dates and real adjacent customer Select maintain the same actual control track in a shared row; complete day/month/year glyphs, visible labels, error below, native focus and<=40px control height. Keep actual normal164.890625/invalid201.671875 desktop red as historical evidence.
- Reuse shared hosted date-field anatomy plus existing FilterBar error state; ordinary form dates, folded portalled fields and prefixed DateRangeFields remain outside that adaptation. Actual FundBook source selection COMPANY→TM→COMPANY and ordinary Ports Add→focus→picker Escape→Cancel still retain names/values/query callbacks and complete long selected label. No writes, exact scoped API/source parity and direct147-table ORM AFTER required before closure.


### QA-AUDIT-UI-56 — native selector validity / inline label ownership

Repro: ADMIN local `/config/quotations`,390/768/1440, type day33 then genuine field exit; intermediate shared repair leaves computed toolbar flex-end and moves later controls36.78125px. The source condition nests `:has` inside `:has`, invalid in browsers. The date glyphs fit168px; phone label centers are2px high. Expected: valid non-nested direct-child/sibling feedback selector switches the shared row to flex-start, existing aligned tracks remain aligned, inline labels center without inherited stacked margins, full glyph/border/helper/40px budgets remain. Drive native clear/correction and guard0writes/API/source hashes. Ordinary form and folded labels retain their anatomy. Preserve nine intermediate RED originals; no waiver from source-test greens.

### QA-AUDIT-UI-56 — mobile hosted Select margin continuation

Repro: ADMIN390 local `/accounting/expenses?view=fund-book`, replace day with33 and exit natively. Actual Source label centre is2px above its40px control because the inherited stacked-label margin remains. Preserve current eight-state red. Expected: contextual inline label has zero margins and shares the control centre at390/768/1440; date error helper remains below, corrected state restores original geometry, Source native keyboard selection/restore works. Naturally wrapped rows retain their grouping instead of a forced single-row assertion. Ordinary Ports form and folded filter labels remain stacked with full values. Driver0writes and exact resource/source plus direct147 ORM parity are required; no staging or material-save claim.

### QA-AUDIT-UI-56 — current native replay ownership continuation

Before updating the ignored mixed18 and ordinary/folded15 QA drivers, preserve their exact source/hash. The old unconditional cleanup success is insufficient. Each new replay requires a fresh output folder, explicit controller-reviewed ba80 source-tree nonce, complete frozen/live source path-set and SHA equality before/after, actual Chrome version/raw BackForwardCache configuration and owned PID. Save cleanup progress and actual child exit/connection state; use bounded graceful close followed only by owned-child SIGTERM/SIGKILL if necessary. Keep all native validation/correction/selection/Escape/Cancel, physical-row geometry, full selected values, strict HTTP/console/no-material and API equality assertions unchanged. Root reviews the exact ignored QA-only delta before launch. Full current originals and direct147 scoped AFTER are still required for UI DRIVEN closure; no browser execution or product acceptance is implied by this preparation.


## QA-AUDIT-UI-65 — full-width composite ledger facts

Repro: local CUS `cus`, `/shipments-debit?customer=1`, existing shipment273/Bill QA22-DISPATCH-220922-A. At390 click “Mở chi tiết lô” and native Chi tiết for Bảng2.1/Bảng2.2. Before: nested workspace is constrained to the value half of the outer “Quyết toán lô” fact; QAQU2209220 and “+ THÊM CHI PHÍ” break into narrow lines. Preserve actual red01/02 screenshots and successful policy220/no-write closure separately.

Expected: the explicit composite fact uses the full record-content width. Shared scalar facts retain compact paired dt/dd. Nested fee/editor/reconciliation values use the same opt-in model, preserve complete source names/amounts and original control callbacks, selection and draft boundaries. No automatic child-type guessing or page-local CSS override. LedgerMatrix forwards explicit metadata on phone, while768/1440 desktop tables preserve their existing columns/cells.

Regression: shared real component renders opted-in composite and ordinary paired facts, native action/selection/disclosure remain separate; existing ShipmentDebitPage phone expansion keeps the workspace inside the composite full-width fact without changing API calls or selected row; existing ChiHoTable/dedicated fees and unattached fee lists propagate opt-in and preserve read-only/editable payload identities. Existing accounting pending reconciliation remains full-width with its exact confirm/withdraw IDs and ordinary money facts remain unchanged.

Actual acceptance after source quiet:390/768/1440 CUS native open→details→close, all direct rows and persisted freight/chiho amounts match the API. Capture original screenshots, DOM geometry/full text, driver command/exit and safe scoped Drizzle BEFORE/AFTER equality. Phone workspace content must be full-width and every action/token readable; inspect originals rather than declaring numeric geometry alone a visual PASS. No monetary Save/export/lock or forbidden quotation-fee request. Other roles, physical Safari, staging and absent current customer1 ISSUED record remain explicit gaps.

## QA-AUDIT-UI-66 — PostgreSQL grouped truck counts remain numeric

Repro: local ADMIN/admin, `/dashboard`, October2026, at390 view Tình trạng đội xe. Actual original shows `0551 đầu kéo ·77 lái xe` whereas `/fleet` shows56 trucks and normalized fleetStatus has ACTIVE55+MAINTENANCE1. In-transit1 utilization rounds0 from concatenated denominator instead of2 from available55. Original current0781 dashboard DOM/screens and aborted rootcapture log are preserved.

Expected: API totalTrucks is numeric56 for that actual population; no string concatenation or leading zero. Sum matches an independent Drizzle count() of non-deleted trucks and normalized grouped counts. Same status filters, role gating and count policy. Existing frontend calculates utilization against the numeric total. Empty/populated groups and deleted truck boundaries follow existing contract.

Regression: strengthen existing real-DB Q20 official reporting test after its actual fixture-backed getDashboardStats call with numeric type, independent count() and grouped-total agreement. Do not replace the service with a mock or alter its monetary/date assertions. Retain RED before Number conversion and GREEN after; test-inclusive backend types/full backend suite, rootlint/build/API E2E.

Native acceptance: after source quiet/build, ADMIN390/768/1440 navigate via actual fleet-management button and back, record post-click screenshot/DOM count text and utilization alongside count-only API/Drizzle row output. No data write. New all-route snapshots after the repaired source freeze; prior partial0781 screenshots remain rejected for this bug. Other roles, physical Safari, staging and monetary/failure paths remain explicit gaps.

## QA-AUDIT-UI-67 — billing builder foreground keyboard ownership

Repro: local dev, canonical ADMIN, real customer1. Open /debt/1/billing/new and /customers/1/billing/new at390,768,1440. Drive native Tab for more than one full enabled-control cycle, then native Shift-down/Tab/Shift-up and Escape. Open/close a real nested date/template picker in a separate continuation. Capture DOM activeElement ownership and original screenshots after actions; record the selected Drizzle database parity and actual driver exit.

Expected: focus enters the visible topmost billing dialog and remains there throughout forward/reverse cycling. Background page/navigation/disclosures do not receive focus. A nested picker owns its own dismiss; closing it returns to its opener inside the builder. Escape closes the builder to the correct parent route and restores useful focus. Builder content, clipping, control ceiling and existing read-only generate behavior remain unchanged. An empty real month must be reported as an actual empty state, not populated with fabricated rows.

Initial evidence: native partial390 debt-route probe recorded nine background focus targets while the opaque builder stayed open. Its QA-only Shift+Tab API failure is preserved; fresh full matrix and repaired native evidence are pending. Case created before implementation; not DONE.

## QA-AUDIT-UI-68 — tire dialog focus and nested dismissal

Repro: local canonical ADMIN, a real existing truck/trailer and existing mounted/stock tire where available. Open Edit, Unmount, Install, Transfer and PositionsManager through their actual controls at390,768,1440. Native Tab/Shift-down/Tab/Shift-up for more than a full enabled-control cycle must stay inside the active dialog. Open a real PositionPicker; the first Escape dismisses the picker, retains the tire dialog and returns to its opener; a subsequent Escape closes the parent and returns to the original trigger. Try busy dismissal only through a supported real local flow and preserve existing refusal. Cancel unsaved edits, use original screenshots/DOM and Drizzle parity/driver log.

Expected: central modal focus/stack/scroll/opener ownership, one active accessible dialog, complete token-styled corners/content/labels, ordinary controls at most40px. No financial/data callback changes. Existing empty or unavailable tire populations remain explicit gaps without invented rows. Initial source census proves missing shared mechanics; native reproduction/repaired proof pending. Case before code, not DONE.

Native continuation (2026-10-02): ADMIN truck1/60C-12345 has tires0 and positions0; normalized missing-label census0 before every Manager open permits a read-only handoff without autosync. At390 an actual Enter-generated click on focused “Sửa / xóa vị trí” did nothing. Actual owned touch pointerdown mounted Manager before gesture completion, then pointerup/click hit its scrim and closed it. Retain the original13-state and bounded16-state EXIT1 traces. Before the repair, add real empty component cases that reject Manager mounting on pointerdown and require one activation through a completed click or Enter/Space-generated semantic click, connected-trigger restoration, unchanged draft and no writes. After shared onClick activation, drive actual native Enter, Space, touch/mouse, Close, Escape and reopening at390/768/1440; save DOM/original screenshots/logs/API equality and Drizzle tires/positions/trucks/trailers equality. Supplier complete API parity is separate from direct ORM; global147-table AFTER remains pending. Do not claim four absent populated tire-dialog paths from the empty host proof.

### QA-AUDIT-UI-68-P1 — natural-height floating picker placement

Repro: same real local ADMIN truck1, current Supplier Petrolimex; at390 open its filter and reopen after focus. Original22/24 input797.953125→837.953125 and42px menu509.953125→551.953125 expose246px detached gap. At768 the downward menu gap is8px. Read complete catalogues/missing-normalized-labels0 before every Manager open; do not create fake tires/positions/suppliers or Save.

Expected: shared upward menu bottom sits8px above its actual trigger, regardless of sparse/empty/many content; downward menu top sits8px below. Full menu width stays inside viewportpadding8, its maxHeight never exceeds actual available space, and overflowing content scrolls within its existing owner. Real captured-bound pure geometry cases must fail before the anchor/budget repair, including cramped viewport; unmocked actual component Escape/semantic activation/draft/opener tests remain. Fresh native390/768/1440 mouse/touch/Enter/Space, original PNG/DOM anchored bounds, strict requests/material0, exact API/four-table ORM and owned Chrome exit close this claim. Original10 repeated-paint rejection is retained separately; no alternate screenshot mode or image modification counts as this acceptance. Four populated dialogs/other roles/staging/global147 AFTER remain explicit gaps.

Structure continuation: retain the full frontend RED (tire-controls530>frozen527) and keep that ceiling unchanged. Extract the already-reviewed pure geometry helper without any behavior change into feature-owned tire-picker-placement.ts; controls and the existing geometry/component test import it. Assert actual structure gate, focused62 behavior cases, frontendtypes and scopedlint green before fresh source freeze/native replay.

## QA-AUDIT-UI-69 — all-disabled modal cold start

Repro: open the bare billing dialog while its real read-only generation is pending and every control is disabled. In the existing Modal behavior suite render disabled children, then rerender them enabled without closing the dialog. Expected: focus starts on the modal container, Tab/reverse Tab cannot enter the background, and after loading native Tab enters enabled children and cycles correctly. Nested picker focus/dismissal and opener restoration remain correct. Preserve a meaningful pre-fix RED and post-fix GREEN without new mocks or financial fixtures. Native local ADMIN debt/customer billing routes at390/768/1440 include delayed real response, original post-action screenshots, focus DOM, actual driver exit and Drizzle parity. Card/case created before shared source edits; not DONE.

## QA-AUDIT-UI-70 — driver photo action dialog

Repro: local DRIVER with an actual editable trip, click each available Thêm ảnh cont/seal/biên bản at390/768/1440. Native Tab/reverse Tab must cycle inside; Escape or Hủy must close and restore the exact trigger. Open again and click the backdrop; close restores focus. The shared bounded white dialog uses the contextual zone title and ordinary controls at most40px. Existing camera/gallery callbacks remain unchanged. Existing component behavior regression records focus/Escape RED then GREEN using the existing suite without new API mocks/domain fixtures. Native screenshots, DOM, actual driver closure and Drizzle equality are required; no camera/upload write is needed. Missing real editable-trip/camera/file-picker populations are explicit gaps, not fabricated. Card/case before code; not DONE.

## QA-AUDIT-UI-71 — fixed page actions clear the live sidebar width

Repro: local DRIVER1073 existing trip895/version2/IN_TRANSIT at1440×900. Open the actual biên-bản photo menu and Escape. The completion footer gradient covers the sidebar account identity in the original `ui70-photo-menu-settled-window/1440-note-escape-closed.png`. Source acceptance bar shares the same unconditional left0. The existing trip-create ActionBar uses248px despite the collapsed48px rail. Card precedes application/test edits; implementation is held until the controller quiet window.

Expected: a shared shell offset matches expanded248px, collapsed48px and overlay0. Both driver acceptance/completion footers and trip-create footer consume it. Their painted/pointer bounds do not cover sidebar identity/navigation; the main-canvas edge and footer edge agree within1px. Preserve phone/tablet full canvas, current bottom-nav clearance/safe-area ownership,≤40px actions, complete action labels, existing disabled/missing-doc facts and unchanged callbacks/payloads. No app-local duplicate breakpoint/offset answer.

Regression: use existing shell contracts to pin all three layout states and the shared consumer relationship; meaningful actual native bounds/hit testing at390/768/1440 before and after repairs is required, not a CSS-text-only visual claim. At desktop click actual sidebar collapse/reopen, record sidebar/main/footer rectangles and account-text point ownership. Inspect original pictures after these actions. Use existing actual editable DRIVER trip and unsaved ADMIN trip-create form; no Save/milestone/upload/setup write. Direct selected Drizzle BEFORE/AFTER, strict requests/source/owned Chrome closure and driver command/exit prove nonmutation. Missing actual acceptance-bar population, other roles/staging/physicalSafari and whole-page unrelated regions remain explicit gaps.


## QA-AUDIT-UI-72 — recognizable content-sized searchable selects

Repro: local ADMIN `/accounting/phoi-phieu`,390; open native “Phân công xe cho kế toán phơi phiếu”, inspect existing assigned-vehicle table and batch strip after scrolling into view. Fresh accepted originals scroll-0-21-x0 and scroll-0-22-x0 show each accountant picker as a thin line while Save remains40px. Source uses shared UuiSelectField `width="content"` and its automatic searchable branch.

Expected: at390/768/1440 the existing assigned and batch accountant control displays a real bounded field/value/placeholder with accessible name and native focus/open/select/Escape behavior; all option labels remain reachable without page overflow, single-line control height≤40px. Preserve finite content dropdowns and hosted form/filter branches. Read-only draft selection must not issue Save/Phân công; assignments/catalog API and direct scoped ORM pairs remain equal.

Evidence/status: actual root phone originals under `qa/2026-10-01_comprehensive-audit_screen-walk-accepted/`, personally viewed by coverage_inventory. Source diagnosis **CODE-READ ONLY**, computed native trace pending; OPEN, no application/test repair yet. Licensed pinned UUIv8 Select/select-shared consultation exit0 in `qa/2026-10-01_comprehensive-audit_compact-select-catalog.log`; retain the existing house adapter.

## QA-AUDIT-UI-73 — refund date action icon and text stay on one row

Repro: local ADMIN/admin, existing populated `/accounting/deposit-tracker`,390. Current original scroll-0-1-x0 shows CalendarClock on its own line above “Ngày CV / số tiền”. The source places this icon inside Btn children rather than its existing icon slot. Card/case precede runtime/test edits; source is held for the controller's coordinated batch.

Expected: reuse the existing leading-icon anatomy with complete text-only label, shared icon gap and ordinary control≤40px. Preserve the neighbouring refund action and all money/date/status callbacks. Sweep resolved Btn/UUI Button JSX direct icon children and preserve deliberate composite label/chip controls; no implicit arbitrary-child extraction or universal text flex change.

Regression: extend the existing DepositRefundTrackerPage component suite without new API mocks/fixtures. Its date button keeps the exact accessible name, its icon occupies the dedicated leading slot outside data-text, clicking opens the existing date/amount form, and Cancel issues neither date update nor refund. Retain all existing stale amount/error/payload assertions. Native390/768/1440 clicks the actual date action and Escape/Cancel on an existing tracker; capture complete aligned icon/text rectangles, original pixels/DOM, owned browser closure, exact reads and safe selected Drizzle BEFORE/AFTER equality. No Save, refund or data setup. Other roles, staging/physicalSafari and financial/error paths remain separate gaps.

## QA-AUDIT-UI-74 — OPS fund-book independent date-filter anatomy

Repro: local OPS/giaonhan `/ops/wallet`,390. Current root original closed screenshot shows naked inline Từ ngày / yyyy-mm-dd / Đến ngày / yyyy-mm-dd; recorded bare inputs are120×40. Source still owns two raw type=date inputs instead of the accepted shared independent DD/MM/YYYY pair. Card/case precede source/test repair; source is held.

Expected: the existing FilterBar and DateRangeFields own the date pair and clear action, with separate accessible endpoint names/calendars, complete valid ISO query values and refusal of impossible/out-of-order drafts. Empty endpoints still mean the full existing caller-scoped history. No merged picker, presets, Apply step, new page CSS or monetary recognition/balance change.

Regression: extend existing OpsFundBookSection component tests using their current provider/fixture, with no new API mocks/data. Blank→valid from/to→invalid or inverted draft must issue only valid expected hook scopes, clear must restore the all-history query, and running balance plus global/period totals retain their existing assertions. Native390/768/1440 actually opens/types/selects/corrects/clears independent fields with full glyphs/helper and ≤40px controls, preserving current rows/amounts. Save screenshots/DOM/native driver and exact before/after safe Drizzle parity after browser closure; no advance/refund/cost Save. Other roles, material/error paths, staging/physicalSafari and dynamic input-type callers remain explicit gaps.

UI74 page-consumer continuation (filed before test edit): in the existing OpsWalletPage chosen-window regression, type `22/09/2026` into the visible shared `Từ ngày` field and `30/09/2026` into `Đến ngày`. Assert exact server ISO `from=2026-09-22` and `to=2026-09-30`, retain the named server-period and whole-history figures, then clear all six segments and assert the unfiltered fund-book request and absent period summary. Preserve the original full-run RED; no new API mocks/fixtures or runtime changes.

### QA-AUDIT-ID-05 — accountant choices use real account identity, never numeric internal IDs

Repro (local ADMIN): open `/accounting/phoi-phieu` → actual `Phân công xe cho kế toán phơi phiếu` disclosure with the existing5 rows/49 accountants. Current40 missing fullNames cause row/batch values/options `Kế toán #<internal id>`. Current UI72 collapse also hides the painted input; post-native DOM proves the fallback independently. Use actual existing records and do not create replacement users.

Expected: exact existing producer projection supplies only required real display-name/username identity; both row and batch choices prefer available fullName then real username, or honest missing identity when neither exists. No numeric-ID display fallback, no fabricated label, no contact/credential projection; preserve IDs as keys, same null/version/request/callback semantics. At390/768/1440 after UI72 repair, native open/search/choose an existing missing-fullName account in unsaved state → full distinguishable real label → Escape/restore. Never Save or Phân công. Existing live account/assignment API + scoped direct ORM remain equal; screenshot/DOM/driver/raw-exit and independently reviewed exact source hashes required. Other roles, material assignment and staging remain explicit gaps.

## QA-HARNESS03 — shared control boundary tap measurement

Repro: preserve the canonical dff86 design-lock EXIT1/197of203 report and six38px-inner-input originals. Preserve UI72's real2px-boundary/zero-input native trace. On the fresh combined source checkpoint run all203 unchanged locks, plus native boundary/interior diagnostics on the six formerly failing route/width states and the actual repaired accountant picker. No Save or generated data.

Expected: presented installed InputBase/ComboBox boundaries are measured once, including boundary candidates with zero interiors. A40px boundary with a visible contained38px interior passes the same40px target minimum. Undersized or collapsed boundaries, absent/hidden/zero or escaping interiors fail rather than disappearing from the inventory. Standalone controls and independent nested buttons keep their original minimum check; date-segment exemption and all non-tap locks remain unchanged. Do not lower limits, inflate controls or insert geometry fixtures. Save original screenshots, owner/interior DOM bounds, exact driver command/exit and safe read-only DB before/after proof. Syntax/lint and separate full-diff review precede actual replay. Source-only reasoning is not current native acceptance; physical Safari, staging and unrelated material actions remain explicit gaps.

Unattended headed continuation: before the launch-option change, preserve648acbf0 evaluator/source gates. Exact `QA_HEADED=1` adds only `headless:false`; unset,0 or any other value keeps the default launch options. Fresh203 replay uses new OUT and actual Official Chrome no-headless launch evidence plus owned process closure. Preserve all six original REDs and prior raster rejects, no screenshot mode/GPU/inspector changes or graphics-cause waiver. The separate focused real six-host A/B current-versus-prior evaluator checks unchanged actual controls, without modifying their DOM geometry.

Native disclosure eligibility continuation: on the existing ADMIN Phoi board, capture account owners under the initially closed assignment details, click the real summary to open, then click it to close. The checker must exclude only descendants concealed by each closed details ancestor, retaining its first direct summary subtree, while measuring the revealed owners/interiors normally. A visible zero-size owner or interior still fails. Include the exact closed/open/closed DOM, summary action screenshots, prior/current checker results and no-assignment API/DB parity. No synthetic disclosure markup, forced geometry or saved assignment.

### QA-AUDIT-UI-72 / QA-AUDIT-ID-05 source-regression continuation

Preserve the intended backend null-name RED and frontend numeric-caption RED, and the subsequent assertion-setup/type failures with their fixes. The existing assignment-service fixture must prove trimmed fullName preference over a distinct username, missing-name username fallback in options and assignmentName, exact unchanged response keys, undeleted inactive membership and unchanged raw account data. The existing frontend board case uses its existing accountant/trucks/API spies: an honest missing-identity visible name still carries the exact original row/batch numeric keys and expectedVersion to the unchanged handlers. No new API mock or fixture population is added. Shared searchable content width acceptance remains native geometry/open/search/select/restore at390/768/1440, plus finite/ordinary/folded counterparts; no CSS-string mirror is substituted for that regression. The first backend RED log discloses local appDB use by the stale runner, so repeat material fixture execution only against the controller-designated isolated target.

### QA-AUDIT-ID-05 fixture-runner boundary

Before any further writing suite, the legacy ignored workflow runner without DATABASE_URL or with an app database must refuse before creating a gate artifact/subprocess. An explicit controller-designated local `silversea_qa_*` database plus Redis13/14 is required. Preserve original wrapper/test RED hashes and use fresh labels; no Redis flush or unrelated fixture removal. Application source/test lifecycle remains quiet during incident reconciliation.

### QA-AUDIT-ID-05 fixture incident exact forward cleanup

Use the preserved failed-run suffix `1790887329365-6ewy25`, original57-row residue proof and the independent current147-table snapshot. Compare both immutable historical147-table baselines: expect exactly50 added run-owned business/audit rows and zero removed/changed existing projected rows; separately inventory7 generated users with no credentials/contact projection. Inspect the prepared cleanup read-only first, including exact IDs, suffix/plates, states/amounts, times and all declared/application-level relation candidates. Before the separately controller-approved apply step, pin the helper and inspected preflight bytes. Under one serializable transaction lock/re-read all57 IDs, reject unexpected descendants/state/FKs, delete exact IDs child-before-parent and assert every returned ID/count. Expect the full147 safe row projection to equal both original6234-row baselines inside the transaction and the run-user prefix to return0. Independently repeat147 and safe user-prefix readback afterward. No sequence reset, Redis flush, broad deletion or silent retry. Preserve the original RED, any inspection/apply failure and every separate command/exit artifact; unrelated fields/auth tables remain outside147 coverage.


QA-AUDIT-ID-05 inspection-key continuation (before QA-helper correction): preserve f949 read-only INSPECT failure on debitSettlementRoundLots, whose actual primary key is roundId+shipmentId. The next inspection must query its shipmentId only for exact owned5059–5061 and require zero rows. Apply the same zero-result rule to every non-delete-target reference table, including alternate/string/composite keys, while the14 owned target tables keep numeric-id/exact-owned-row validation. Do not omit any reference candidate or delete extra rows. Fresh output, strict static type gate and separate root/peer review precede INSPECT; separately pinned APPLY remains held.


QA-AUDIT-UI-72 / QA-AUDIT-ID-05 complete menu extent continuation (before native QA driver addition): preserve all real option/key/name mappings and current source/identity/DB guards. With the actual unfiltered list open, use native mouse-wheel over its real scroll owner to capture overlapping viewport segments from native top through actual bottom; each real option must be fully within a captured painted menu viewport at least once. Require positive native scrollTop progression, complete maximum extent, exact all-key coverage and unchanged options/selection. Restore native menu top before the original Escape/query/select sequence. No JavaScript scroll/focus/style/image change, arbitrary top/middle/bottom subset or all-option pixel claim from offscreen DOM counts. Save each original/DOM/menu bounds+keys, command/raw child closure and independent read-only parity.


## QA-AUDIT-UI-75 — honest monthly KPI direction and favorable tone

Repro: local canonical ADMIN, current Dashboard October2026. Compare actual current/previous P&L reads with the rendered gross/net/cost badges. The retained current original shows gross profit2.850.000 with red ▼2690.9% from a negative prior baseline, while costs1.650.000 show green ▲1400%. Card dashboard-monthly-delta.md and this case precede application/test changes; the current f334 native barrier remains active.

Expected: absolute prior magnitude for a nonzero baseline keeps percentage direction aligned with current−previous. Loss→profit and reduced loss point up; deeper loss points down. Zero→nonzero has an honest new-baseline label and true direction, never a fabricated finite percentage or 0%. Equal/unknown stay neutral. Revenue/gross/net up is favorable and down unfavorable; expenses up is unfavorable and down favorable. Numerical direction stays separate from badge tone. Current/prior money, periods, report contracts and permissions stay unchanged.

Regression first: extend existing pure dashboard helpers and real DeltaPill rendering cases without new API mocks/domain fixtures. Preserve positive-baseline/unknown/zero cases; add loss→profit, lossdeepens, negative→lessnegative, zero→loss, flat, cost↑/cost↓ and revenue/profit directions. Keep meaningful red before repair and focusedgreen/fullfrontend/type/lint/build evidence after. Active pinnedUUIv8 base badges reference confirms explicit success/error tone; retain the house badge owner rather than a new page skin.

Native acceptance: after source quiet/build, actual ADMIN390/768/1440 dashboard month/navigation actions, full original KPI screenshots/DOM arrow/text/color, exact current/previous read-only P&L scalar source and direct Drizzle side-effect equality/driverexit. Do not create financial rows to manufacture zero/loss periods. Unavailable runtimeedge populations remain component-only coverage; other roles/staging/physicalSafari/material mutation and unrelated chart correctness remain explicit gaps. No repaired UI/global acceptance claim before this native closure.


### UI75 comparison and negative-total continuation (before fixes)

Same-class source repro: Finance's `yoyPct` uses signed previous and `yoyClass` treats equal values as favorable; depreciation/fixed/operating/company costs default higher-is-favorable. Dashboard's missing prior report becomes zero in the derived data and page fallback. Keep null previous values unknown in badges, prior-value description and greeting; a genuine zero remains distinct. Preserve monthly chart source, report periods and every financial amount.

Retained actual f334 ADMIN390 originals `admin-trips-new-390-scroll-0-2-x0.png` and `admin-trips-id-390-scroll-0-1-x0.png` show −69.000 estimated profit and −50.000 gross profit with success color. Both summary stylesheets override their negative value class with a blanket accent total rule; detail `pl-total` has unconditional green value/background. Expected: existing total owners render positive favorable, negative danger and zero neutral, preserving exact signs/amounts/cost rows and all financial callbacks. Existing cost/credit displays are not globally recolored.

Extend regression-first coverage with Finance signed/zero/flat/null comparisons and explicit expense direction; preserve existing Finance breakdown/null tests. Add real FinancialCard negative/positive/zero amount-and-state cases and stylesheet cascade checks that catch the two existing total overrides; retain canonical financial calculation tests. No new API mocks, fabricated business rows or changed money policy. Component edge cases do not imply runtime data exists.

After controller releases source and fresh gates are green: drive Dashboard and Finance comparison pane at390/768/1440; drive the actual new-trip preview and existing canceled-trip detail totals with no Save/material writes. Capture full original pixels, exact displayed money/tone/arrow DOM, read-only report/object API equality and direct ORM side-effect equality. Missing previous report/error/zero edge populations not actually driven remain explicit gaps. Keep the f334 originals as red/history; carry unaffected broad routes only with complete unchanged dependency-byte evidence to the new freeze. All application/test changes are held while the current capture barrier runs.

## QA-AUDIT-UI-79 — bounded table row-action keyboard outline

Repro before fix: canonical local ADMIN390 `/config/factories`, native keyboard focus on `Sửa Bắc Sơn`. Current f334 original `admin-config-factories-390-keyboard.png` SHA7fe67ad5cccf2fc33d0ddf88d51308d2dce762b17e439653d33086884fc0ba6a shows the right focus ring cut flush to the x382 table edge while pencil content remains visible. Controller and author independently viewed it. Native loading/Save/edit behavior is not inferred from the pixel defect.

Expected: every focus edge remains visible inside the existing40px row action; native keyboard target and exact callback remain unchanged. The shared table owner handles factory/route absolute phone rails and other `.row-action` consumers once, retaining table corner/scroll containment and unrelated field/house Btn focus recipes. Pinned UUIv8 table/button-group search plus installed Button focus source and house bounded-control inset precedents are recorded in the card/catalog log.

Before implementation after controller release: inspect the existing owner/consumer tests and native clip-ancestor bounds, retain the red then add a meaningful shared focus-owner regression; no page-local padding copies, lowered ceiling/target, hidden outline or fake rows. Re-run affected frontend/source gates and peer review. Fresh ADMIN390/768/1440 actual Tab to factory/route actions, full originals plus DOM outline/bounds/ancestor clips, actual Edit then Cancel and API/direct ORM equality close the named claim. Disabled controls, other roles/staging, additional unmounted callers and physical accessibility tooling remain Not covered. Application/test source is HOLD until the f334 capture barrier closes.

## QA-AUDIT-UI-76 — dashboard chart uses recognized individual-month reports

Reproduce on local ADMIN dashboard October2026: adjacent P&L KPI revenue4,500,000/gross2,850,000 versus departure-date chart final11,200,000/5,400,000. Preserve the original current screenshot/DOM and exact safe P&L/trip read (qa/2026-10-02_workflow-audit_dashboard-chart-basis-read.json). The mismatch is not a guessed recognition policy: accepted FIN02 already chooses the report-backed monthly surface.

Expected: use actual monthly P&L reports with the existing canonical deriveMonthlyFinanceChart and signed RevenueTrendChart. Each visible month equals its individual report amount; October aligns to its KPI, without accumulating prior months, taking all active operational trips as recognized, or inferring departure-day recognition. Remove the unsupported day option and describe actual month/year/report period. Negative-only months remain visible inside the shared SVG/domain, zero and missing data remain truthful, and labels/currentIdx map the actual source months. Keep operational widgets, IDs/links, ledger/status/recognition, backend API and permissions unchanged.

Regression before source: reuse actual report fixtures/contracts and meaningful pure/shared chart coverage; do not add new fake API responses or source-string implementation assertions. Then fresh local ADMIN390/768/1440 native current chart/period/control captures, DOM amount/accessible chart description assertions, authoritative GET amount comparison and read-only ORM parity. Keep failed originals/raw requests, source hashes, exact command/exit and manually reviewed original hashes. No material financial writes. Other roles/periods/staging/physical Safari are explicit Not covered. Source fix HOLD until controller releases current capture window.


### QA-AUDIT-UI-72-HARNESS-02 — Native closed details may retain layout boxes

- Repro: local real ADMIN PHOI assignment details initially closed, use the existing headed/native 390/768/1440 replay, and record exact owner rectangles, first-direct-summary ancestor eligibility, center hit ownership, focused element and current tap-floor evaluator. Preserve actual initial failed zero-box assertion and original screenshot/log.
- Expected: all six assignment owner descendants are excluded by a genuinely closed non-summary ancestor even if Chrome retains layout rectangles; none owns a painted center or native focus. Actual summary open must reveal recognizable bounded ≤40px fields and add exactly their owner count; actual summary close must restore the original eligible count. Keep native option query/select/restore, complete overlapping menu extent, all material/request/HTTP/console guards unchanged.
- Boundary: no CSS or focus/scroll injection, no zero-geometry inference from closed details, no whole-page tap-floor PASS for unrelated compact controls. Unexpected auth/read cancellations stay fatal and require independent lifecycle diagnosis.

## QA-HARNESS04 — passive recovered auth bootstrap attribution

Reproduce the strict local headed cold load of actual DRIVER1073/trip895. Before correction preserve original three raw abort failures and CDP breakpoint diagnostic. The QA observer records actual request IDs/frame/loader/timestamps/initiators/loadingFailed.canceled, safe completed200 identity and same-loader authenticated DOM without changing app behavior. Classify only one canceled local GET /api/auth/me per loader if a bounded successor has the same identity/frame/loader and real DEV reconnect/double-invoke initiation; persist raw failure plus exact recovered-request evidence. Other canceled reads, 401/403, missing successful identity, ambiguous counts, mismatched actor/loader or unready DOM remain fatal. Execute native UI71/73/74 current three roles/three widths after separate full helper/delta reviews and controller slot/nonce GO; retain all original pixels/logs and direct scoped ORM before/after. No general auth- or net::ERR_ABORTED waiver. No debugger pause in acceptance.


## QA-AUDIT-UI-80 — canonical opaque surfaces and import Panels

Repro before fix: local ADMIN390 Master Data Import has a transparent gray upload section; source census16 runtime uses of undefined --surface-1 across8 owners, including12 invalid primary/color-mix operands and4 dead nested fallbacks beneath valid --surface. Card undefined-primary-surface.md and this case precede any application/test change. Preserve the current f334 original and source census; an empty graph means unindexed, not no callers.

Expected: canonical opaque --surface at actual surface owners, no new --surface-1 alias. Drop only invalid dead fallback where the legitimate primary remains unchanged. Master Data Import uses existing shared Panel for file form, classification summaries and grouped preview; retain all native file IDs/labels, legacy disclosure, pending/disabled states, analyze/apply/reject/cancel/report/sort behavior and complete responsive facts. Other owners keep their established layout/handlers; no broader private-style replacement. Active pinnedUUIv8 search plus deliberate house Panel provenance is recorded in the card/catalog log.

Regression first: existing surface-contract test rejects undefined runtime operands and pins canonical Panel white paint; existing real import component tests prove shared Panel ancestry for both file controls, legacy input, analyzed summary cards and grouped preview using the existing batch fixture. Retain every existing behavior assertion/no new providers or domain mocks. Focused red→green plus frontend types/lint/full affected gates and separate exact source review before native acceptance.

Native after controller source/build GO: ADMIN390/768/1440 actual import navigation, legacy disclosure, Tab/focus on existing file controls without selecting/importing data, full opaque Panel/control computed paint, complete border/corner/label originals and no overflow. Use real available shipment-create/debit/user consumers for representative class proof and capture exact API/direct Drizzle equality with0 material calls. Empty/inaccessible summary or locked/error branches remain source/component-only unless actually driven. Other roles, staging, physical filepicker, upload/analyze/apply/reject mutations and unavailable population are not covered.

## QA-AUDIT-UI-77 — fixed actions preserve focused form content

Repro: local ADMIN768 trip-create, actual native Tab to the collapsed estimate/progress summary, record its rectangle and center-hit owner, then native Space open/close and pointer click. Preserve the existing failed broad click where the summary center was covered by `.tc-action-bar`. Run the equivalent actual create/edit/Driver fixed-footer families at390/768/1440; do not infer acceptance for an absent Driver acceptance object.

Expected: active footer publishes its measured viewport obstruction to one shared shell scroll clearance, responsive resize updates it and unmount removes stale clearance. Automatic native focus and nearest scrolling keep the complete field/summary above the fixed action surface; opening and closing retain normal behavior. Footer controls and sidebar-offset geometry stay within their40px ceiling. Ordinary routes without a footer gain no unexplained blank area. Keep handlers, form readiness, upload/financial state, Save/accept/complete policies unchanged. Capture actual originals, DOM focus/hit/scroller geometry, API and direct ORM equality plus owned browser exit. Other roles, staging, absent acceptance population and physical Safari remain gaps.

## QA-AUDIT-UI-78 — atomic financial values in dense records

Repro: local ADMIN390 deposit tracker, OPS reconciliation report and trip-expense configuration; current orphan currency and split grouped values are preserved before source. Sweep shared Money plus named raw currency configuration consumers at390/768/1440.

Expected: sign, complete formatted number and unit retain one baseline and remain inside the available record/cell. Labels/prose may wrap around the atomic value; entire cells must not be forced to nowrap. Preserve supported decimal formatter semantics, reconciliation “+”/“−”/zero, current direction/color, amount, IDs, calculation and mutation payloads. Existing component seam asserts actual row sign/number/unit; native bounding rects and original pixels establish layout, not jsdom. No shortened numbers/type shrink or new mock populations. Save exact PNG/DOM/log/source/API and read-only ORM parity; other roles, staging, extreme unsupported payloads and material financial paths remain gaps.

## QA-AUDIT-UI-81 — recognized monthly Dashboard cost breakdown

Repro: local ADMIN /dashboard, October2026. Compare total-cost KPI1.650.000đ with cost breakdown69.000đ in the same page at390px; capture all scroll extents. Read the exact monthly report and trace breakdown sources. Repeat at768/1440 and switch to an existing prior month with recognized costs.
Expected: report-labelled breakdown and its category sum use the same selected-month recognition basis as the cost KPI. Exact amounts and signed contributions are retained; missing/incomplete sources are identified explicitly, without fabricating totals from departure-date trips. Other Dashboard report-labelled financial breakdowns are swept. Existing legitimate report fixtures cover this difference; native controls, source/API equality and direct ORM evidence accompany current screenshots. Whole unrelated route states are not silently promoted from this claim.

## QA-AUDIT-UI-82 — zero costs have neutral unsigned presentation

Repro: local ADMIN390 trip-create estimate, actual native summary open, zero toll/ticket and salary fields display red minus-zero beside a genuine minus69,000 loss. Preserve current original and source diagnosis. Sweep equivalent zeroable cost callers in create/edit summaries and the profit explanation.

Expected: exact zero costs display unsigned0 with neutral tone; nonzero costs retain their existing subtraction sign, complete precision and relevant cost tone. Profit sign/tone remains tied to actual profit. Money's explicit sign contract, arithmetic, calculation policies and mutation payloads remain unchanged. Meaningful component zero/nonzero cases precede runtime repair; real native390/768/1440 captures, DOM/source/API/direct ORM equality and actual driver exit accompany acceptance. Saved financial transitions, other roles and staging remain explicit gaps.

Continuation, recorded before the additive draft: local OPS `/my-settlements/new`, initially unselected sources and refund0, also shows minus-zero for `Tổng chi phí` and `Tiền hoàn lại`. Both exact-zero summary deductions must be unsigned and neutral. Change only the real refund draft to a positive supported amount and confirm its existing subtraction sign/tone and balance remain intact; restore0 and cancel without saving. Retain meaningful existing-page zero/refund regression, actual positive expense selection where existing eligible records permit it, full390/768/1440 originals and source/API/direct ORM equality. Do not create expenses or submit a settlement for this presentation proof.

Signed-balance continuation before candidate repair: with no selected source and a refund125,000 draft, `Chênh lệch` must display the genuine negative125,000 amount and negative tone; the current absolute-value rendering drops that sign. Restore refund0 and confirm unsigned neutral zero. Keep the existing signed arithmetic, selected IDs, submit guards and payload untouched; no material settlement is submitted.


Flat-comparison continuation, recorded before draft: actual local ADMIN RecoverableCosts768 zero differences render green in cards, and settlement PT26100001 exact-zero `Chênh lệch sau quyết toán` is green at768/1440. Desktop ledger, phone record and page-summary differences must be neutral at exactly0; negative/positive differences retain their signed amount and danger/success states. Settlement balance0 keeps its existing label/magnitude with neutral ink, while surplus/shortfall labels and nonzero colors are unchanged; refund-positive and settled-debt status are outside this condition. Meaningful existing render fixtures cover all three numerical states across the four render owners, without new API mocks or domain population. After activation, inspect native390/768/1440 full originals and actual computed ink for each available zero/nonzero branch with source/API/direct ORM equality and0 material calls. Staging, other roles, unavailable nonzero population and material reconciliation remain gaps.

## QA-AUDIT-UI-83 — actual monthly chart pointer tooltip

Repro: local ADMIN390 Dashboard, recognized monthly reports, actual Puppeteer native hover over the first month hit target; retain both original304 setup failure and subsequent twelve200 exact-body run with missing tooltip. Product versus setup cause is initially unresolved.

Expected: an actually painted chart target responds to a real pointer with one complete month/revenue/gross-profit tooltip matching its recognized report, including negative months. Observe trusted native pointer events, target and SVG rectangles, painted center ownership, viewport/scroller before/after and original screenshot. No forced application state/style/focus/DOM events. Correct only the evidenced cause, preserve all prior strict guards and sweep existing shared chart consumers if source changes. Re-run real390/768/1440 and report cache/touch/physical-device modes that were not driven.

## QA-AUDIT-UI-84 — compact segmented controls budget the outer shell

Repro: local ADMIN, existing debit-template editor at768 coarse pointer, inspect `Căn lề` native three-button alignment selector. Current outer padding4px and1px borders add10px to children promoted to40px by the global touch floor, producing about50px. Preserve current original; use actual computed group/child rectangles before and after repair. Sweep shared boxed Tabs standalone and inside FilterBar, including actual category/date scopes.

Expected: one shared compact group owner reserves its border/inset budget and keeps ordinary single-line outer controls≤40px at390/768/1440; no page override, fixed-height clipping or smaller glyphs. Actual click and Tab/Enter/Space selection preserve selected/unselected/disabled state, callbacks and complete focus rings. Wrapped descriptive content remains visible and explicitly classified. Restore the unsaved alignment draft/cancel without Save; capture exact originals/DOM/driver/source/API/direct read-only ORM parity and affected standard gates. Other roles/staging and material template persistence remain gaps.

Penalty-period continuation, recorded before draft: local ADMIN `/penalties`390/768/1440, inspect all `7 ngày`, `30 ngày`, `90 ngày`, `YTD` ranking choices. Preserve root768/1440 originals and compare actual group border-box/padding/child height. The same shared compact owner must budget vertical child padding as well as its30px floor; no page override. Actual native click/Tab/Enter/Space changes the real ranking window and retains complete labels/active/unselected focus; outer group≤40px at all3widths. Existing meaningful window-selection test remains. Distinguish the long descriptive FuelMode branch, and do not infer material penalty/driver persistence.

Rich DebtDetail continuation, recorded before ignored QA source: local ADMIN actual `/customers/1`, `CÔNG TY TNHH MỘT THÀNH VIÊN LONG MINH`. Assert GET `/ledger/customers/1/statement` returns actual ID1/name before visiting the registered route. At768/1440 click the real `Bảng kê` rich tab, press native Home/End and restore `Chi tiết công nợ`; at390 drive the actual finite Select responsive counterpart with option selection/Home/End and restoration. Capture the whole compact owner, every button, both label/metadata lines, selected/focus state and actual glyph rectangles before unchanged40px geometry assertions. No truncation, clipping, hidden metadata or lowered ceiling. A failure saves the actual PNG/DOM and fails the driver. This closes only the previously unvisited shared consumer coverage gap; application source stays quiet. Real customer/read population, current freeze, all strict requests, no payment/generation/Save, direct read-only147 parity and personal original review are required. Phone tablist keyboard semantics are intentionally absent; phone selector semantics, other roles/staging and material document/payment persistence are reported separately.

Finite-Select harness correction, recorded before the shared QA selector sweep: current0c7f ADMIN390 first rich-workspace attempt exited1 before its first capture because `[role=combobox]` did not exist. The actual source `Tabs` responsive recipe sets `searchable={false}`; installed Untitled Select renders an AriaButton with `data-uui-control="select"`, and installed React Aria3.51 Select/listbox trigger publishes `aria-haspopup="listbox"`. Use that exact button contract for all three finite category/workspace selectors in the QA additions, retaining every option, native keyboard, identity, geometry and strict resource predicate. A missing trigger saves current wrapper/control inventory plus PNG/DOM before the unchanged failure assertion. Preserve the failed driver/packet/log and actual owned25031 exit0. No product bug or successful native coverage is inferred from this QA selector correction.

## QA-AUDIT-UI-85 — settlement/warning text uses the house semantic triads

Repro: current local OPS settlement detail, positive refund/settled summary amount uses direct bright green `#16a34a` on white. Read its computed foreground/background and retain original; source contrast is about3.3:1. Sweep current settlement note, shipment zero-revenue warning, ForwarderSettlements incomplete label and Clerk field warning/link color owners.

Expected: existing positive amount text inherits `--success-text`; existing warning fill/text/graphic rail inherit warning-soft/text/fill respectively. Actual rendered text meets4.5:1 at390/768/1440; full messages, amount digits, refund/zero conditions, focus and native interactions remain unchanged. No financial arithmetic/payload/status/print-gray change. Save current original/DOM/computed-token/contrast/source/API/direct read-only ORM/gate artifacts, with unavailable branches/other roles/staging/material recording/reversal explicitly uncovered.

Positive-money/info continuation, recorded before draft: local ADMIN salary net5.000.000, positive salary adjustments when genuinely available, penalty empty savings/streak and expanded phone ranking; DRIVER actual canceled3114 e-POD informational notice and genuine draft status when available. Preserve exact40d7 originals/RGB evidence. Existing success-text and info-soft/info-text must meet4.5:1 for all small amount/state text at390/768/1440 without changing graphic accents, labels, calculations, sign/zero conditions, handlers or sizes. Read-only native actions/full originals/computed foreground-background and source/API/direct ORM parity are required. Current unavailable positive adjustment or draft badge is CODE-READ ONLY, never fabricated; payroll/penalty/POD material writes, other roles and staging remain gaps.

QA-HARNESS06 — DRIVER POD identity namespace, recorded before ignored QA candidates. Current safe147 source has user6 → driver1 → trip1951 CANCELED/undeleted → fulfillment3114 → shipment4017. The actual `/my-trips/3114/pod` route interprets3114 as fulfillmentId. Replace only the wrong QA `/driver/me/trips/3114` pre-read with strict200 `/driver/me/fulfillments/3114`, checking exact fulfillment3114/trip1951/shipment4017 and nested trip CANCELED identity. Preserve actual native POD route, informational banner/DRAFT absence, raw PNG/DOM before unchanged contrast assertions, all strict resource/material/source/owned cleanup predicates and direct read-only parity. No actor/fixture/POD setup or upload/submit. The original trip-ID read failure is retained as QA evidence, not an application defect; actual API/native contrast/other roles/staging remain unaccepted until execution.

## QA-AUDIT-UI-86 — shared work-inbox wrapped actions stay within40px

Repro: retained local OPS1440 `/my-orders` and `/my-forwarder-trips`, actual `QA-ID02-OPS-130955` action `Bắt đầu đổi lệnh`; full two-line emerald fill spans42px. Preserve exact originals/DOM/pixel receipt. Shared12px/1.2 text plus6px block padding and1px borders costs42.8px for two lines; live geometry remains pending.

Expected: existing shared action owner reserves its vertical budget, keeps the complete natural label without clipping/ellipsis/forced fixed height or smaller glyphs, and measures≤40px for every supported ordinary action at390/768/1440. Preserve horizontal inset, table/card anatomy, neighbor boundaries, disabled/hover/native keyboard focus and callbacks. Source-census refresh/retry, primary/normal/danger/link and longer terminal/customer actions; unavailable branches are explicit gaps. Measure actual line boxes/border-box dimensions before and after, personally inspect full originals, retain existing meaningful handler/row-navigation tests and standard gates. Read-only proof has no material start/complete/customer response; API/direct ORM/source equality and actual owned Chrome closure are required for visual acceptance.


## QA-AUDIT-UI-87 — debit expander column contains its real control

Repro before candidate: local CUS768 /shipments-debit, first existing BULK-IMP-0005 / CÔNG TY TNHH VẬN TẢI GAYA CONTAINER LINES. Original cus-shipments-debit-768-closed.png SHA4059db000167323f1fe948e9d2e1ebce6c4be4e6006c5636a1375e63838148ca shows the40px expander crossing the neighboring customer glyphs. Saved DOM confirms40×40; table/header CSS reserves32px and its weaker coarse56px override does not win.

Expected: reserve the actual control plus its cell inset in the existing leading column without reducing control geometry or identity/money/status budgets. Full business references/customer/factory/docs/money stay readable; no truncation, ellipsis, card-data omission or blanket table variant. Ordinary td remains table-cell. Existing row-selection and expander stopPropagation remain separate.

Regression-first: this card/case precedes ignored exact before/candidate/diffs. Retain currentCSS source-only tests and update stale existing geometry pins only; actual native geometry is the meaningful regression. After coordinated activation/gates/freeze, drive native open→close at390/768/1440 and fine/coarse where available, assert button box inside its own td and outside the next identity glyph region, actual hit owner/focus ring and full horizontal table extent. Compare all existing row facts/API/direct read-only ORM before/after; no Save/export/financial mutation. Phone record/print counterproof and unavailable locked-row/population/staging branches remain explicit gaps. Old rejected originals and all failed driver evidence stay immutable.


## QA-AUDIT-UI-88 — readable intrinsic text columns in the shared record table

Repro: local ADMIN1440 /accounting/deposit-tracker, existing LONG MINH / QA22-DISPATCH-DEPOSIT-EMPTY. All four original boards show CUSTOMER about57px and NOTE35px while Bill holds292px of atomic width. Full company words become8lines and ordinary notes about25. The page's Bill token nowrap and shared anywhere min-content cause the auto layout; no data or financial policy is missing.

Expected: explicit shared text/reference anatomy reserves readable customer/notes minima and wraps a truly long business reference completely. Existing dates/money/ordinal tokens stay atomic, all facts/actions stay visible, and any real desktop width excess scrolls inside the shared opt-in rather than overflowing the page. Preserve the existing1100px card band/labels/paired anatomy; no page skin, universal widths, clipping or ellipsis.

Card/case precede ignored exact before/candidate/diffs. Extend existing owner-adoption pin only, not a new CSS mirror or mock/row fixture; native geometry/content is the regression. After activation/current source gates, actual390/768/1440 complete row/name/note/ref/date/status/money checks, allX/Yextent and sticky header/actual focus boundaries; open existing date action and Cancel without Save/refund. Compare exact allrows/API/direct readonlyORM; unavailable long-note/no-amount/settled branches, otherroles/staging/material correction remain explicit. Source-only source budgets are never an actual pixel pass; retain all old FAIL originals.

## QA-AUDIT-UI-89 — customer status tabs keep honest population counts

Repro: retained local ADMIN /customers768/1440 shows Tất cả192 alongside Hoạt động10/Tạm khoá0; the table loads only10 rows. Read the actual paginated API contract and source before choosing a repair. No Customer directory status-count endpoint exists; no backend or policy expansion is approved.

Expected: keep the real server total on Tất cả and omit unsupported active/locked counts through the existing optional Tabs count. Labels, status/search/result/pagination/debt/selection callbacks remain unchanged. Existing two-loaded-row/12-total fixture must show total12, plain status labels, working active→locked→all filters, honest visible result counts and unchanged next-page request; no new API mock/business fixture or material request.

Card/case before ignored candidate test and runtime. After coordinated activation/gates/freeze, actual390/768/1440 default/status/pagination/real-name-search/clear must preserve complete controls and correct totals without invented directory status numbers. Capture all originals/DOM/driver/source/API/direct read-only ORM equality. Other roles/staging, unavailable locked population and material create/update/bulk/export remain uncovered; old UI62 and40d7 images cannot accept the new bytes.

QA-AUDIT-UI-82 gate regression: run root `pnpm lint` and the existing AllowanceSection render cases. Its plain fixture reader must use a non-Hook mock binding name, retaining the actual `useTripFormContext` export and all signed/zero financial assertions. Full lint failure is retained in `qa/2026-10-02_comprehensive-audit_final-ui89-root-lint.log`; no rule suppression is allowed.

QA-AUDIT-UI-81 source-contract regression: the dashboard introduction shows a dash for a missing recognized-report revenue, the actual reported number when present, and compares months only when both current and previous values exist. Retain the explicit zero-previous-month wording and existing wrapping/positive-negative comparisons. The full-suite stale source-pin failure is retained in `qa/2026-10-02_comprehensive-audit_final-ui89-frontend-full.log`.

## QA-AUDIT-UI-90 — controlled empty catalog selection closes the real menu

Repro: local ADMIN390 PHOI truck C8-26806444-T1/394, original accountantNULL/version3. Native-select actual accountant148, clear the full query, select the existing `— Chưa gán —` sentinel. Retained driver23 shows the cleared placeholder and both options deselected, but the list remains open until timeout. Preserve all old failures and distinguish this from macOS replacement-key setup.

Expected: a real empty-option commit closes a non-custom catalog menu, retains blank input/placeholder and input focus, and forwards exactly one native-shaped change. Both nonempty→empty and initially-empty→empty must close. Normal/same-key selection and Escape remain correct. A transient internal null, focused query clearing (including CscSearchableField's intentional controlled-null query reset), or custom-value typing must keep legitimate suggestions open; consumed selection markers cannot affect later typing. Plain-select behavior is unchanged.

Card/case before ignored test-first candidate. Extend existing real controlled component suites using their existing option fixtures/geometry setup, with no fake API/business population, skipped assertion or new mock. After controller activation/current gates/freeze, drive actual390/768/1440 row and batch distinct draft/empty restore/Cancel, all real option names/menu extent, strict native read/focus/40px/source guards, actual owned Chrome exit and identity/API/direct147 ORM equality. No Save/assignment persistence or material business call. Other roles/staging, unavailable errors and financial retry remain explicit gaps.

QA-AUDIT-UI-90 continuation before candidate: uncontrolled ComboBox (`selectedKey` omitted) ordinary catalog pick closes, then empty query retains open full suggestions. Controlled `USearchableField` query-empty intentionally clears value without selection closure; invoke current real adapter suite. No new domain fixtures/API seams.

QA-AUDIT-UI-90 test-only receiver correction: uncontrolled picked value must equal existing FACTORIES[0].label + space + supportingText, preserving original complete catalog textValue. No contains/regex weakening; all callback/query/open predicates unchanged. Original three-failure RED retained.

## QA-AUDIT-HARNESS05 — bounded adaptive capture of infinite vertical lists

Repro: retained local ADMIN AuditLog768/1440 originals contain the initial10 rows, while the final DOM has20. The real last-row IntersectionObserver fetches another page after the driver has fixed the initial contentHeight. This is a capture gap, not proof of a product defect.

Expected: preserve all native actions/strict guards and all old originals. The ignored scanner re-measures the same actual owner after each segment, waits for real network/paint settlement, and advances with100px overlap through the new extent. Require two bottom observations with unchanged actual dimensions and row count; record every before/after extent, actual top and stable completion. If the2000-segment bound is exhausted or the owner is replaced/disappears, retain partial raw evidence and fail—never silently skip rows or claim the complete history. The final loaded extent, its lower rows and every intermediate original require personal review. No application, data, response, CSS, screenshot-mode or image substitution.

After full non-author review/controller GO, drive the actual infinite AuditLog and finite/nested table counterproof at390/768/1440 under a fresh source nonce/read-only147 interval. Preserve actual API/raw failure/material/source/Chrome closure guards and classify any endless or changing list as an explicit gap. Other roles/staging/physical browsers and material log-generating actions remain uncovered.

## QA-AUDIT-UI-92 — complete assignment facts and ordinary edit control

Before any candidate: retained DISPATCHER `/dispatch-detail` 1440 Bill BLQA20-EB507B contains actual full plate QA22C-60376805/driver QA22-DO-60376805 Lái xe kiểm thử in DOM, but the original shows only prefixes in the fixed absolute/clamped assignment control. Pin current owner/source/original hashes and reproduce the same actual existing row at390/768/1440 under the controller-designated source and real period. No fabricated row or assignment write.

Expected: full carrier/plate/driver/issue status are visible without clipping or caps; plates remain intact where the owner can expand, text wraps naturally, and a separate ordinary house edit/reassign action fits40px and actual hit/focus geometry. Native open→Cancel returns focus; completed/disabled rows remain immutable. Preserve callbacks, source row IDs/version/payload/eligibility, mobile records and data scope. Sweep the same owner callers. Run existing component behavior/regression gates without new API mocks, and retain meaningful complete rendered fact/accessible action expectations before candidate implementation.

Native acceptance: every exact original plus DOM/range/control bounds, actual open/Cancel and no-write API/directDrizzle pair, source parity and actual owned Chrome closure. Current retained defect alone is not final UI DRIVEN acceptance. Other roles/staging/physical Safari, write/issue/complete/error branches and unavailable populations remain explicit gaps.


## QA-AUDIT-UI-94 — compact pair action remains in its classification cell

- Reproduce local DISPATCHER1440 September Bill QA22-DISPATCH-220922-A; retain complete original PNG/DOM and real fulfillment284/trip196/shipment273 identity from current DTO/safe147. Current full Ghép chuyến action must be diagnosed against its actual classification-cell and note-lane bounds, not inferred from source.
- Existing page fixture: the same eligible rows expose visible Ghép with full accessible name Ghép chuyến and full contextual container/Bill title. The original real-dialog pairing/callback/refresh assertions stay intact; no new API mock/domain population is added.
- Repaired native390/768/1440: concise full glyphs/action box lie inside their actual semantic cell, ordinary height<=40, no neighboring overlap, and the eligible actual row opens the existing Ghép chuyến dialog then Cancel restores opener. Full text and no-mutation/API/directORM/source/owned-close proof are required. Missing eligible population remains explicit, never fabricated.
- Preserve original eligible-row conditions, classification value, numeric IDs, callbacks/versions/pair meaning, no arbitrary columns or page-local skin, no ellipsis/clamp/hidden label or raised height ceiling. No material Save/complete/accept/refund is allowed in the read-only interval.

- Frozen-source continuation: retained final-ui94 full-suite RED says grid457>455. Before extraction, strengthen the same existing page no-trip receiver into no-trip/external/already-paired/canceled cases; preserve real-dialog pairing, full name/title, callback identity and refreshed plan. Extract one co-located row-action owner without changing the ceiling, whitespace/attribute squeezing, CSS or business eligibility. Structure/current focused/full gates plus new frozen native3width whole-glyph/dialog header Close/editor Hủy/source/API/no-write proof must close before acceptance.

## QA-AUDIT-UI-95 — responsive dispatch records use their available width

The second owner attachment `/var/folders/r3/c429k8v52g15d8fqfjrs49d00000gq/T/codex-clipboard-545e61cd-8916-41b2-8465-9111972a7557.png` shows the same BLCUSa4BBE record in the wider two-column band. Both attachments require compact phone and tablet/wide-card anatomy; the narrow desktop table remains its own natural vertical column. The first attachment is `/var/folders/r3/c429k8v52g15d8fqfjrs49d00000gq/T/codex-clipboard-235098f8-1c95-4c7e-94b7-9f48ec25d5a6.png`.

Before any candidate: retain the owner's rejected Bill BLCUSa4BBE/MSKU1234565/LONG MINH screenshot, with SilverSea29C-123.45, missing driver, `Đã điều xe`, `Sửa` and complete vehicle note. Current canonical205 local DISPATCHER density also fails:390 row403.1px vs380px and768 row256px vs240px. Tablet decision/notes same-row geometry already passes. No budget increase or clipping is permitted.

Expected: the existing900px/640px card owner compacts related carrier/plate facts, keeps a full natural driver row and pairs status with the existing Edit/reassign action. Existing narrow desktop assignment columns retain their natural stack. Notes label, manual/tag previews and issue/complete actions remain compact natural rows; meaningful newlines/full-note dialogs and action placement/eligibility remain unchanged. Ordinary controls<=40px, unchanged typography, no height cap/clamp/ellipsis, no page-local skin or fabricated fixture.

Regression: drive the actual current board at390/768/1440 and inspect every original. Assert unchanged canonical short-record380/240 budgets, complete full-driver/long-plate glyph containment, carrier/status/missing facts, notes and action boundaries; actual edit/reassign open→Cancel and note open→Close restore focus and exact row. Preserve every existing assignment/pair/issue/write handler and existing rendered multiline-note tests; no material issue/complete/Save/pair confirmation. Record exact API/source/direct read-only147 parity, driver command/exit/owned closure and all affected gates. Long/unavailable branch population, other roles/objects, staging/physical Safari and material/error/concurrency outcomes remain uncovered. Original density FAIL and UI92 preactivation FAIL are immutable; no new source acceptance from old pixels.

## QA-AUDIT-UI-96 — responsive classification header cannot overlap business identity

Before any candidate, retain current0a8 native31746 original390 and DOM: classification group x297.07/y201/73.93×54 ends255, while customer/Bill y222..266 shares that painted lane. Complete Đơn and Ghép do not overlap each other. Diagnose the shared absolute classification/header track, not the individual button or missing data. Preserve graceful69028 exit0 and raw driver failure.

Expected390/768/1440: natural header layout allocates full type/Ghép/date space; plain classification, complete Bill/customer, all facts and full glyphs remain disjoint and inside actual card/ancestors. Desktop nine-column layout stays unchanged; responsive lower-field order and existing assignment/notes/pair callbacks stay unchanged. Type/long date wrap naturally; no clipping, clamps, height caps, smaller typography, hidden text or raised380/240 short-record budgets.

Regression: existing rendered classification/row-action receiver and real-dialog pairing tests retain full name/title/callback identity. Fresh native actual September284 long-driver plus real October photographed/short-record chain at all3widths captures every original before assertions; require header/identity non-overlap, whole action/glyph containment/ordinary40, full date/Bill/classification, editor Hủy/pair header Close/notes Close and opener return, exact source/API/direct147/no-write/owned-close proof. Unavailable population remains explicit.

The fresh driver separately corrects the completed disabled-button checker: actual disabled+computed pointer-events:none+assignment parent center hit is required; enabled rows still require button-owned center. No generic hit/geometry waiver and no retrospective pass of failed31746. Current native/full gates/material/error/concurrency/other-role/staging/physical Safari remain pending or uncovered.
### QA-HARNESS11 — bounded CUS binding and fresh UI96 identity interval

Before candidates: preserve all historical actor6/23, OPS/DRIVER census and UI90 identity files, including the already existing UI90 AFTER. The CUS native wrapper requires an exact controller-selected ID; never infer it from another role or guess a username. Read only the four pinned canonical local CUS candidates in their existing parser/harness order. A private localhost5441/silversea read-only/repeatable-read Drizzle query returns only id/username/role/status/deletedAt, bounded to canonical count plus one; capture actual rows before eligibility assertions. Select only an actual undeleted ACTIVE CUS row. Record missing/ineligible candidates by canonical index, no credential/account-list serialization. This is eligibility evidence, not login proof; a later native run uses the existing exact-username override and asserts the selected stored ID and role, retaining every raw resource/material/source/closure guard.

Create a fresh UI96 accountant projection/output derivative of the original UI90 helper. Only basename/folder/command change: raw six-column accountant/owner rows, assignment predicates, truck joins, display normalization and BEFORE/AFTER equality remain byte-identical. Prepare a separately reviewed private run-db wrapper that adds these two exact basenames only. Root executes fresh BEFOREs, pins the resulting identity SHA into faee's existing environment contract, and closes the same fresh AFTER at interval end; existing UI90 AFTER is never overwritten or described as fresh. Author/reviewer candidates perform no imports, DB/API calls or browser execution. No actor setup, role unlock, password check, fixture, source-helper activation or material write.

### QA-HARNESS12 — unique existing enabled Bill target and fatal-state evidence

Before continuation: retain actual395f/root49542 RED after three390 originals and a200 q=BULK-EXP-0018 read; the exact-one native Bill wait timed out at15seconds. Actual selected fulfillment17/shipment37 has no trip. Retained147 has two related fulfillment identities, but missing query body/failure DOM means multiplicity is not yet an observed cause. No retrospective pass or product failure is inferred.

From the same actual September page1/limit50 API response, sort eligible OWN/non-completed/non-canceled existing rows with the prior unissued-first ordering. Deduplicate candidate Bill strings and make at most12 bounded exact-Bill queries. Save each actual status, page/limit/total, safe item identities and body hash before assertions. Select only a200 result with one total/one item, the exact Bill and matching positive fulfillment/shipment identity, plus unchanged trip identity when issued; bind versions/status to the existing147 baseline. No candidate within the bounded pool is an explicit gap, not evidence that the complete application population lacks a target.

Preserve unchanged native exact-one Bill wait/15seconds,390/768/1440 complete fact/glyph/control/header checks, actual edit/reassign open→Hủy, pair header Đóng, October short/photo/note actions and380/240 budgets. After actions re-read the same selected exact-query response, assert complete body equality and matching fulfillment/shipment/trip binding. Preserve raw HTTP/auth/resource/material/source/owned-window/exit guards. Before fatal cleanup, best-effort bounded DOM/PNG captures the actual failure without UI injection; the original fatal error remains fatal even when this capture fails. Only controller execution after full source review and GO; no author/reviewer API, DB, browser or app writes.

### QA-HARNESS13 — exact terminal geometric identity without paint mutation

Before candidates: retain shared926/c370 and root rich98371 raw failure. Actual five finite animations finished and opacity1 with computed identity `matrix(1, 0, 0, 1, 0, 0)` falsely failed the literal `none` predicate. No retrospective whole-collection visual/native pass or application fix is inferred; owned30075 closure was SIGKILL/disconnected.

Use only actual browser DOMMatrixReadOnly parsing of the raw computed transform. Exact isIdentity and all16 finite matrix components are required; `none` maps to the constructor's identity. Unavailable/invalid/nonfinite/translation/scale/skew/nonidentity returns a stable failure diagnostic, without epsilon, rounding or CSS/animation/focus/scroll/value mutation. Keep raw transform and identity/parse metadata. Retain finite finished&&!pending/end-time semantics, physical CSS/hidden/details eligibility, semantic-isolation metadata, opacity>=.999,5seconds and120ms exact stability. Individual CSS translate/rotate/scale were outside the prior predicate and remain outside this narrow observation claim.

Create a new helper and new twenty-row manifest, changing only the paint row; derive every effective consumer with exact import plus before/after path/hash pins, complete diffs and inverse byte proofs. Preserve unrelated six/billing selected bodies and original API/HTTP/auth/material/source/native actions/ordinary40/owned5 predicates. Parser/static fixture observations are source-only; never construct a fake DOMMatrix API or call the helper/driver in Node. Future actual identity/nonidentity/error and finite-transition browser acceptance remains pending, along with every fresh original grading and matching DB side-effect/parity proof.


### QA-HARNESS15 — exact October browser cached304 lineage, without status waiver

Before candidates: retain root15642/cde857 six states and original clearSearch failure; current original request sequence October200→304, September200, exactBill200, sameBill October200, unfiltered October304. Historical raw rows lack request IDs/conditional headers/bodies, so no retrospective cache proof or whole native acceptance. Owned95075 exited0/disconnected after raw5s close timeout.

Keep native selected-all/full-delete/empty input and unchanged15s/data/height/380-240/action/control/window/source/material/auth predicates. Observe only actual local unfiltered October page1/limit50 GETs passively: request IDs plus safe conditional/ETag/frame/loader/cache/wire-status/completed-body proof. A later304 can satisfy only clearSearch if it joins an earlier exactURL200 in the same owned browser/actor/frame, its actual If-None-Match equals the earlier+304 ETag, and browser-retained parsed JSON equals both earlier200 and the real independently read October before source. Save every raw body/error/lineage before assertions; current authenticated main DOM/path/October label/emptyquery and later actual first-row Bill/container/source join remain mandatory. Uncached and unrelated responses still require200. Never disable caching or alter headers/response/body/styles/data. Missing/changed/cross-actor/URL/nonfinite/parse/protocol lineage remains fatal. New source-only derivative/full inverses and independent review before controller native; no retrospective PASS or product defect inferred.


## QA-AUDIT-UI-97 — assignment editor has complete responsive grid tracks

Before candidate: retain actual DISPATCHER390 September BULK-IMP-0077/MAGU9998814 original05 and recorded168.765625px carrier/vehicle controls with date fields in a second implicit column. Phone named areas omit end although its actual DateTimeField keeps grid-area:end. Diagnose that same reusable editor owner; shared form/control/date/modal semantics stay unchanged.

Expected: existing explicit two-track form keeps carrier/vehicle spanning both, short classification and money relationships compact, and Giờ trả hàng spanning both tracks. No implicit area/extra column, clipped long values, forced smaller fonts, height cap or page-local control skin. Every current field/label/date segment/draft callback and scrollable full tag/manual-note composer remains usable; fixed footer and ordinary40 controls retain their owners.

Regression after reviewed activation/current freeze: actual390/768/1440 open editor, save PNG+DOM grid/area/field/control/glyph/ancestor facts before predicates, compare full-track carrier/vehicle/end and same-row money. Native scroll to final tag/manual note; reversible draft input then Hủy restores exact original row/opener. No Save/issue/complete/pair/material call. Existing component date completeness and draft/callback tests remain intact. Require source/API/controller147 parity and actual owned Chrome closure, with original image grading. Other actors/records, unavailable catalog/error branches, staging/physical Safari and all material/concurrency outcomes remain uncovered.

Native geometry continuation (before ignored QA authoring): preserve the reviewed241ea cached-lineage wrapper and add only the enabled existing editor cycle. At390/768/1440 save actual named grid tracks, each full control boundary (including money affix group), all labels/values/date segments and clipping ancestors before unchanged40/full-glyph guards. Carrier/vehicle span both phone tracks and their named single wide tracks; end spans both; revenue/cost share the actual row. Native wheel exposes every existing tag and the manual-note field inside the real modal body while footer remains hit-owned. Toggle only an existing draft tag and type reversible manual text, then the existing Hủy returns exact original row/opener; never create/rename/remove a tag or invoke Save/issue/complete. Empty/error/locked catalog branches remain explicit gaps. No injected DOM/styles/values or JS scroll/focus.

## QA-AUDIT-UI-98 — shared chart tooltip fits its real visible clip

Before any candidate, retain actual failed ADMIN92906 source8f original26 September tooltip: x217.28125+192=409.28125 in390 viewport, right ends of both financial values visibly cut. Original27 October is contained; originals17/18 do not show the chart and are not chart-pixel PASS. Card `chart-tooltip-visible-clip-budget.md` and detailed cycle `2026-10-02-ui98-chart-tooltip-visibility.md` precede source work.

Shared `RevenueTrendChart` owns both Dashboard and Finance placement. Measure natural tooltip/value glyphs and the true viewport/clipping-ancestor intersection; shift the whole readable popup rather than weaken card clipping, change formats/signs, shrink fonts or conceal content. Meaningful recorded-bound cases precede runtime candidates; actual native every-month hover at390/768/1440 on both consumers saves settled PNG+DOM+glyph/clip facts before containment predicates. Keep exact recognized report values/series/domain, native report navigation, strict API/auth/source/no-write/owned-window cleanup and controller147 parity. No injected data/hover/style/scroll or old-run promotion; unavailable extreme financial widths, other roles, staging/physical browsers and writes remain explicit gaps.
### QA-HARNESS17 — visible/accessibly associated editor label projection

Before ignored correction: actual UI97 original06/log retained; broad label selector picked the hidden React Aria native fallback instead of visible “Phân loại”. Resolve exactly the source-owned UUI `data-label="true"` element and its real finite-trigger accessible association, record raw candidates/association/geometry before assertions, then retain all existing exact text/full-glyph/clipping/track/max40/native draft/Cancel/source/API/auth/material/cleanup guards. Missing/ambiguous/unrelated labels stay fatal. At390/768/1440 capture real resulting originals; source-only preparation is not native acceptance. UI99's measured42px full money fields remain a separate genuine defect; other owners/staging/unavailable branch/material paths remain gaps.

### QA-AUDIT-UI-99 — full affix boundary respects the ordinary control ceiling

Actual UI97 original06 measured both money affix groups42px around40px interior children at390; retain exact PNG/DOM and failed run. Repair shared TextField affix interior ownership after source/cascade/class sweep and licensed source consultation, not page CSS, clipping, weaker height tolerance or input-only validation. Re-drive actual full money groups and available same-class normal40/compact30/short-number72×30 controls at390/768/1440; measure both borders, suffix/input/action interiors, full glyph containment and supported reversible focus/error/disabled states. Preserve amount/sign/state/callbacks and Cancel without Save/material changes. Original RED, current code, browser/source/API/final147 rungs are separate; unavailable roles/records/branches/staging/hardware remain explicit gaps.

UI99 native class-consumer continuation (ticket-first, ignored QA only): public Login username/password prefix and embedded Eye toggle using the existing harmless public-QA-draft; ADMIN actual retained expense editor root amount suffix; ACCOUNTANT actual retained PHOI ChiHo Thu/Trả and TienDuong body-modal suffix controls. Repeat390/768/1440 with focus/type/toggle/restoration then native Cancel/Back. Save raw PNG+DOM+full group/interior/label/value/suffix glyph and true clipping facts before ≤40.5 predicates, exact API body before/after and material0. No fake business rows or injected DOM/styles/values, no Submit/Save/voucher/confirmation. Real compact30/short72×30 caller optional only when source/population supports; unavailable branches explicitly NOT TESTED. Root controls source nonce/147 interval/native authorization.

### QA-HARNESS18 — nullable road-config defaults are real UI state

Before ignored candidate: preserve ADMIN96866/d89284 original states and exact actions216 assert.ok(road) failure before config navigation. SavedGET200/null agrees with retained147 d5d6 roadConfig0rows, backend nullable GET, typed RoadConfig|null client/hook and TripExpenseConfigPage defaults400000/200000/200000/55000/300000. This is a QA stored-singleton assumption, not a product missing-control/editability defect.

A fresh ADMIN-only action/row12 composed21 manifest/wrapper derivative accepts only null or a non-array object and keeps raw null/status200/hash unchanged. Compare all five actual native page hints against exact current source-key/default values at390/768/1440; keep unchanged atomic/full-glyph, HTTP/auth/material0/source/owned cleanup, full API-after equality and final147 interval. No seed/configSave/body injection/status waiver or old84 promotion. Missing hints/unrelated failures remain fatal. Detailed cycle2026-10-02-qa-harness18-null-road-config.md; other roles/staging/configured-value population, Save/governance/error/concurrency remain uncovered.

UI99 harness selection continuation (before ignored derivative): preserve fb643 initial addon/receiver/21 pins and its source-only packet. Installed actual Puppeteer core25.1 explicitly does not implement macOS Meta+A SelectAll implicitly. Use the native keyboard selectAll command, then read the same active input’s full selectionStart/selectionEnd against its exact current value before Backspace; read the empty value afterward before typing. No DOM value/focus injection, appended amount, widened assertion or action omission. All source/API/material/public-context/whole-boundary/owned-window/closure guards remain unchanged; fresh derivatives require complete diffs and independent source review.

### QA-HARNESS19 — source-owned chart pointer retained through original capture

Reproduce local ADMIN UI98 focused1440: chart initially below viewport, actual native hover reaches source-owned month rect/T3 and creates tooltip before capture, then trusted pointer departure removes it before original55/56 PNG. Preserve the complete FAILED56 collection and raw native trace; do not label this a SVG or product bug without evidence. Fresh ignored continuation scrolls the real SVG rect through the installed native API, computes its actual visible owned DOM point, moves the native pointer once, and records trusted event/geometry/tooltip state immediately before and after PNG. Require both observations retain the same actual target/month, every tooltip and currency glyph fits real clips, and every native/raw network/material/source/window/owned-exit guard remains. Dashboard/Finance available months ×390/768/1440, first/last point, native scroll and width-only resize must pass separately. No retry, synthesized pointer event, focus/style/tooltip mutation or blanket pixel approval. Current rung CODE-READ ONLY; root/native execution and formal147 closure pending.


## QA-AUDIT-UI-100 — editable manual notes retain an unfocused field affordance

Before candidate: preserve current8c paired-visible-label originals and independent46-frame ledger. Actual unfocused Ghi chú thêm has no visible field border at07/08/21/22/23/28/36/37/38/43; focused09/24/39 has an outline. Trace the raw notes textarea’s invalid length-token border colour against the existing house TextField.css boundary. Existing min56, resize, label/ID, manual draft whitespace/Enter/blur normalization, tag selection and driver-note preview stay intact; readonly preview is not an editable-field case. Record the conditional salary reopen reason’s same source misuse separately before disposition.

After full source review/controller activation and fresh freeze: actual390/768/1440 native editor open, wheel to manual note, unfocused→focus→local multiline draft→Tab/reblur→Hủy. Save PNG/DOM computed full border width/style/colour and opaque surface, associated label/current value/glyph/clip, modal scroll/footer and original row/opener before assertions. Unfocused and reblurred editable boundary remains visible and focused state uses the shared house field affordance. All current note parsing/composition/preview/normalization/callback and no-write/API/source/owned-close guards remain; no injected style/focus/value, Save or tag-pool write. Reuse existing component behavior tests without mirror tests. Disabled/error/salary governance branches only if genuinely available, other roles/objects/staging/physical mobile and material/error/concurrency plus matching147 AFTER remain uncovered.

UI100 same-class salary continuation (before candidate): keep existing CLOSED/canReopen/ADMIN-or-MANAGER eligibility and all reason/mutation handlers, min88/resize/padding. Use the same house field boundary and existing local error state. Retained147 currently has no CLOSED salary-period target, so no native error/reopen claim and no setup/write to manufacture it. If a naturally eligible target exists in a later controller read, capture only initial/focus/harmless unchanged-or-cancelled reason draft plus native return; never click the material reopen submission. Record actual error state only if safely reachable without a write.

UI99 public lifecycle continuation (before ignored receiver correction): preserve actual36494 six390 Login originals and strict EXIT1. First Target.disposeBrowserContext timed out5s; the finally duplicate attempt returned already pending, with the same public Login target still in the census. Launched90137 exited0/disconnected/windows[] afterward; this is not an app-field failure or native collection acceptance. Installed actual25.1 Page.close closes the owned target and waits for tab closure, while BrowserContext.close directly disposes the context. Future receiver closes the exact owned public page first within5s, records pageClosed and context-window absence before context disposal, then still requires disposed context closed/absent within5s. Reuse that exact context’s single in-flight disposal promise if finally resumes cleanup; never send a duplicate pending disposal. Every timeout/error stays fatal, no increased step timeout, no unowned window operation or retired guard. Public isolation, all three widths/actions, API/material/source/current whole boundary/owned browser exit remain unchanged.

## QA-AUDIT-UI-101 — length tokens never occupy colour operands

Before candidates: classify the full direct-colour class behind UI100's actual borderless textarea. `--border:1px` remains a legitimate length; direct border/background operands using it are invalid even with a fallback after that defined primary. Preserve the original CSS census, identify the four additional TSX operands, and distinguish valid primary `var(--line,var(--border))` references and legitimate length uses. Compose Dispatch CSS on UI100's shared-boundary candidate; never overwrite its textarea adoption or change the token globally.

Use existing `--line` for read-only borders/dividers/tracks and `--line-2` for interactive boundaries. After controller review/activation and fresh freeze, actual available390/768/1440 consumers save full PNG/DOM/computed colour, width/style/paint, glyph and control geometry before unchanged assertions. Reversible focus/hover/read navigation only; financial sums, state/handlers, typography, widths, input minimums, hover/focus and disabled behavior stay unchanged. No manufactured empty/closed populations, Save/reassignment/tag-pool/governance action, colour-token alias or low-impact implementation-mirror test. Source-only candidates do not prove repaired pixels; unavailable branches, other actors/objects, staging/physical browser/material/error/concurrency and formal147 AFTER remain uncovered.

UI101 hidden-branch continuation (before ignored native derivative): retain every QA20 notes action at390/768/1440. Using the actual authorized DISPATCHER and current GET /shipments/dispatch-task-tags body, hover Quản lý tag, open its list, rename one existing actual tag only as a local draft → row Hủy, delete confirmation → Hủy, manager close, + Thêm tag → harmless draft without Enter/Lưu, then original editor Hủy. Raw PNG/DOM/colour/side-border/glyph/whole-control/hit evidence precedes assertions; complete pool, task row and original notes remain unchanged. No pool create/rename/delete/Save request is permitted. Current source contains no canManageTagPool flag; require actual supported actor and route authorization instead of inventing one.

After actual GET /trips/2172 binds CREATED/version3/shipment4997, undeleted/no accounting lock and source display reference against retained147, navigate that same existing trip in the sequential dispatcher session. Overflow → Phân xe lại → capture current mode → other Xe nhà/Xe ngoài mode → restore → Hủy → native history back to the exact prior dispatch route. Capture full labels, line-2 border and complete ordinary control≤40.5 before validation. No replacement selection, reason entry, Xác nhận phân xe lại or material call; full trip body before/after must match. Preserve previous QA20 bytes/failed originals, current source/auth/material/owned5/actual cleanup and all notes guards. Actor/day-specific missing driver slots, other objects/roles/staging, pool/material/error paths and formal147 AFTER stay explicit gaps.

### QA-HARNESS20 — editable notes unfocused, focused and blurred boundary

Before ignored derivative: retain UI100's ten unfocused FAIL originals and current46-state native flow. Record raw computed four-side border width/style/colour, corner radii, opaque surface, physical visibility, disabled/readonly/focus, associated label/value/clip and source house tokens after the existing settled capture timing and before any boundary assertion. When fully exposed inside the actual body, the existing shared textarea class has four1px solid borders, normal control colour and house radius before focus; native click uses the shared focus colour, and native Tab after the reversible multiline draft restores the persistent unfocused boundary. Save current normalized value and focus owner before checking them. Existing scroll/tag/local draft/Hủy/source/API/auth/material0/owned5/actual closure guards and ordinary40 controls remain unchanged; multiline min56 is preserved.

No injected DOM/styles/focus/values, manufactured Salary CLOSED target, reopen/Save or old original promotion. Salary conditional/error/disabled branches, other records/actors, staging/physical browsers and final147 AFTER stay explicit gaps. A new reviewed ignored addon/receiving wrapper requires full diffs/pins/inverse review and controller GO before runtime; parser-only preparation is not a UI claim.


### QA-HARNESS22 — integer DOM-owned native chart point

Before ignored correction: retain composed ADMIN session79813 actual 17-state EXIT1, whole source/owned closure and original month 4 PNG/DOM. Requested 104.7142829895/478.0078125 becomes a trusted fractional pointermove followed by trusted integer mousemove 104/478; the observer keeps that latest delivery and strict 0.5 rejects it although actual painted rect/full tooltip stay owned before/after PNG. Source-read installed Puppeteer 25.1 Mouse.move forwards main-frame CSS coordinates unchanged; do not infer a Chrome or app defect.

Fresh shared QA derivative computes an integer point within the actual source-owned rect/ancestor/viewport intersection and records fractional midpoint plus integer bounds. Require a nonzero real rect, available integer interior, exact actual elementFromPoint ownership and one native move; every passive trusted event remains recorded. Keep 0.5 delivery tolerance, strict retained point/full tooltip/glyph clips before/after original PNG, all twelve actual report bodies, native widths/actions, raw/auth/material/source/147/window≤5 and actual owned closure predicates. No widened tolerance, retry, event/style/focus injection, observer skip or old-run promotion. Root+nonauthor full diffs/inverse/pins review precedes runtime; current original pixels, every width, other browsers/staging/material paths and matching 147 AFTER stay uncovered.

UI101 authorized-actor continuation (before ignored derivative): preserve actual DISPATCHER session55629 EXIT1 after 25 states and all 7 successful 390 tag states. App tripDetailOnly intentionally excludes DISPATCHER (user 2026-09-01); same-role /trips/2172 correctly redirects to /dispatch, so no route/RBAC relaxation or cross-role API leap. Derive a separate exact ADMIN 1/admin native packet because that existing actor is source-authorized for both /dispatch-detail and CREATED 2172 reassignment. Retain original QA20 editor/tag/native Cancel/history/full-trip+pool-body/geometry/auth/material/source/147/owned-close predicates and all 3 widths, with accurate ADMIN filenames/identity/metadata and immutable old bytes. No actual reassignment/tag write, invented actor/data, login substitution or screenshot acceptance until fresh complete runtime/pixels/AFTER.


## QA-AUDIT-UI-102 — readable warning body text preserves graphic semantics

Before ignored candidates: retain current QA20 originals32/49 and the complete52 ledger. Actual small missing-driver warning RGB208/135/0 on white is2.938:1. The shared IssueOrderFields warning span uses fg-warning-primary; light text-warning-primary currently resolves the same yellow600, so a token-name-only swap cannot repair contrast. Map the existing light text semantic to calibrated house warning-text and use it for that shared body-text owner; leave warning icon foregrounds, backgrounds/fills, dark mode, messages, values, calculations, handlers and ordinary geometry unchanged. Census the whole fg-warning-as-body-text class before candidate preparation, with catalog/house-owner provenance recorded.

Reproduce on genuine available local assignment editor and quick-issue missing-driver branch at390/768/1440 using read navigation/local focus and Cancel only. Save full untouched original PNG, DOM, actual ink/composited background/font/opacity, full message and glyph clip bounds before asserting4.5:1. Require full readable wraps with no font shrink/truncation, unchanged notes boundary/affix/ordinary40.5 controls/focus and strict raw-request/auth/material0/source/API/window≤5/actual-owned closure predicates. Existing native failure/originals remain immutable; no writes, fake driver, forced branch or weakened contrast guard. Missing real quick-issue counterparts, other roles/objects/staging/physical browsers, material/error paths and formal147 AFTER remain explicit gaps. Affected standard gates and non-author full source review precede any repaired UI claim.


### QA-AUDIT-UI-103 — notification count leaves the complete bell exposed

Preserve the six actual DRIVER6 count30 originals in `qa/2026-10-02_comprehensive-audit_pending-5f48-driver-current/`. At390/768/1440 the shared count chip covers the centred bell crown. Before an ignored candidate, inspect NotificationBell/Topbar, the shared badge/token/phone cascade and every icon-button badge consumer; consult active pinned UUIv8 utility-button/badge patterns and deliberately retain the existing house behavior.

Repair only the shared count geometry, using intrinsic full text and existing spacing/border tokens. Keep the40px button/coarse floor,20px centred bell, caption typography,4px corners, zero suppression,99+ formatting and every notification query/handler. Do not create notification records, truncate glyphs, shrink the icon, change authorization or add CSS-mirroring tests.

After controller activation, capture original PNG/DOM and raw button/SVG/badge/glyph/ancestor/viewport bounds before assertions on the real current count30. Require the full bell and count to remain exposed and the button to remain within the ordinary40px ceiling. Click the actual notification trigger, capture its panel, then close via the same trigger or Escape without marking read/opening an item/push actions. Preserve strict source/API/auth/material0/owned-window and final147 parity. Naturally available0/1/2digit/99+ populations follow the unchanged source contract; missing populations, other roles/objects/staging/hardware/error/write paths are explicit gaps. Rung until driven: CODE-READ ONLY.


### QA-HARNESS23 — same-column source label and CSS header projection

Before ignored addon: retain root43572 ACCOUNTANT3 EXIT1 after27 states, original0271440, native/API/source/owned closure and raw failure. Actual source/data-label is “Số tiền thu”, shared desktop thead text-transform uppercase renders “SỐ TIỀN THU”; source and rendered strings need distinct assertions. No app typography change is required.

Capture actual cellIndex plus each th source textContent, rendered innerText, computed text-transform, whole header/ancestor/viewport bounds and every glyph before assertions. Select the header on that same source column, require exact source label, supported none/uppercase transform, exact rendered projection and complete header/glyph visibility. Phone pseudo label remains exact and unchanged. Full field/affix40 or source30×72 geometry, native focus/type/restore/Tab/Hủy, full real API bodies, source/auth/raw/material0/owned5/actual closure and immutable147 BEFORE remain strict. No case-fold/truncation/clipping waiver, fake header, app CSS change or retired guard.

Fresh all3width native ADMIN/ACCOUNTANT after root+nonauthor full diff/inverse/pins review; PUBLIC lifecycle composes explicitly and separately. Old collection staysRED. Actual current original pixels, other roles/objects/staging/hardware, write/error paths and formal147 AFTER remain uncovered.


### QA-HARNESS24 — transitive October cache observer binds exact ADMIN

Preserve actual UI101 ADMIN7639 failure with0 UI states and the immutable0179 packet. The receiver requires ADMIN1/admin, but its transitive October observer required DISPATCHER before navigation. App's accepted tripDetailOnly permits ADMIN and deliberately excludes DISPATCHER; do not alter that policy or waive a route. Before an ignored derivative, inspect the entire observer/native receiving chain and the exact retained failure.

Prepare a distinct ADMIN-only observer requiring exact role ADMIN/id1/usernameadmin and retain all passive GET target/query, requestID/body/same-actor/current-frame-loader and conditional304 earlier200/ETag/body predicates. Keep the original DISPATCHER observer unchanged. A fresh receiving derivative changes only import/separate pin/truthful entrypoint metadata, preserving helper20, all original notes/tag/local-mode/Cancel/history/native geometry/focus actions, complete API before/after, source/auth/material0/window<=5 and actual owned closure. No cache override, actor wildcard, injected events/data, app/RBAC edits or skipped observer.

After full root/non-author source review, controller drives the genuine ADMIN1/admin at390/768/1440. Save raw cache observations before strict validation; reject unexpected identity, unmatched failures and any unproven304 lineage. Original0state failure remains failed. Until that actual run, rung CODE-READ ONLY; other actors/records/staging/hardware, financial/write/error branches, unavailable populations and final147 AFTER remain explicit gaps.


### QA-AUDIT-UI-104 — text uses calibrated ink instead of graphic accent

Ticket before ignored candidate: preserve all45 currentOPS originalPNG/DOM hashes and the15 scoped small-text contrast failures. Actual “Tổng kết” isRGB74/158/125 onRGB229/237/232=2.71849:1 at13px/600; desktop “Hoàn tất0” numeral is same ink onRGB237/241/238=2.84308:1 at11px/semibold. Existing law§2 says--accent is graphic-only; no global graphic-token darkening. Read full shared Tabs/countTone and fset header owners, actively consult paidUUIv8 tab/badge catalog, census every direct accent text declaration/inline semantic map and classify actual live text vs graphics/mixed/later override before source-only candidates. Use existing success-text/accent-ink according to meaning; exact conditional tones/zero/data/labels/calculations/handlers/fonts/layout remain.

After full root+nonauthor review and affected gates, drive actual localOPS draft summary and desktop real count labels plus available class counterparts at390/768/1440 using no-write navigation/focus/drafts/Cancel. Save complete untouched originalPNG, DOM, computed and composited ink/background/font/opacity and all glyph/ancestor/viewport bounds before4.5 guards. Preserve complete money/sign/neutral0, ordinary40.5/focus, strict raw/auth/material0/source/API/window≤5/owned closure/147 controls. No font shrink, truncation, synthetic state, fixture, skipped contrast or stylesheet-mirroring tests. Missing branches, unpainted counts (coarse finite Select), other roles/objects/staging/hardware/material/error paths and final147 AFTER remain explicit. Original45 mechanical0 does not waive pixelFAIL.


### QA-HARNESS25 — separate headless Chrome native pointer isolation

Preserve root57206 actual QA22 EXIT1 after16 states on5f and raw74-event trace. Real trusted integer73/478 reached the rect at4227ms; latest309/358 later belongs to wf-chart-actions, tooltip absent before PNG. No cause/actor/app/Chrome inference. Keep headed failed evidence unaccepted.

Prepare separate Official Chrome headless-new local harness/25pin-manifest/focused receiver. Explicit mode guard requires exact --headless=new and no --hide-scrollbars/--disable-gpu; only default hide-scrollbars is ignored so page scrollbar geometry remains exposed. Auth/object/route/data/source/147, passive raw/trusted delivery/current-point0.5/tooltip/allglyph/before-afterPNG/native scroll/width-only resize/material0/owned5/actual closure predicates are unchanged. Virtual CDP windows are identified accurately; no headed or physical pointer acceptance. No retry/event/style/focus/value injection, tolerance expansion or original promotion.

After full root+nonauthor source diff/inverse/pins review, actual every rendered Dashboard/Finance month at390/768/1440 plus first/last/native scroll/live width resize must complete with all original PNGs inspected and matching formal147 AFTER. Other roles/objects/staging/physical browsers, concurrently moved headed cursor and material/error paths remain uncovered.


## QA-AUDIT-UI-105 — shared neutral captions use readable house ink

Before candidates preserve root-viewed QA22 original015/016390 and failed collection. Monthly caption/core25pixels, ready label/core44pixels, fleet subtitle/core5pixels and utilization/core18pixels use RGB138/152/143 on white at3.013525:1. Both DashboardPage.css and FinancePage.css define the same .dash-wf private tertiary neutral alias; census every reference and source branch before choosing the existing calibrated house --ink-3. Preserve text, type sizes/wrapping, status meaning, charts/financial data, layout/ordinary40px budgets and all handlers. Neutral icon/dot/border consumers inherit the same house ink deliberately. No new layout, rawcolour, mirrored tests or fabricated empty/error branch.

After full non-author/root source review and explicit UI104-overlap composition, actual Dashboard/Finance390/768/1440 captures full original PNG/DOM/computedink/compositedbackground/font/opacity/allglyph clips before4.5 text assertions. Review full card/chart subtitles, fleet labels/utilization and available Finance/Audit captions, retaining native pointer/scroll/resize/currentmonth/fullAPI/auth/raw/material0/source/147/owned5/lifecycle. Old failed chart run is not accepted by this repair. Naturally unavailable states, other actors/objects/staging/hardware/material/error paths and formal147 AFTER remain uncovered.


### QA-AUDIT-UI-106 — Shared ordinary touch floor covers body portals

- Repro: LOCAL ADMIN, Bill QA-ID02-OPS-130955/trip2172 CREATED,390px coarse; open Phân xe lại through actual header control. Both Xe nhà/Xe ngoài measured32px while adjacent fields40px. Original evidence `qa/2026-10-02_comprehensive-audit_ui101-admin-cache-bound-native-current/27-ADMIN-390-ui101-reassignment-initial.png` and DOM retained; failed original collection stays red.
- Expected: existing shared pointer:coarse sizing band covers #root and BODY portals, ordinary mode buttons40px/ceiling40; full text/focus/state/borders remain visible. Fine-pointer compact sizing and protected short-number72×30 / affix38 / compact-group exceptions retain their existing geometry.
- Native regression: open actual modal, click both genuine modes, keyboard Tab/hover/focus, Hủy without submitting; repeat390/768/1440 and preserve API/147 parity. Explicitly report any unvisited coarse tablet/desktop or other portal populations.
- Gates: root lint, frontend typecheck/tests, build, UI contract, design drift and context. No app test execution or repaired native claim until activation and actual rerun.
