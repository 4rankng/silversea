# Supplied TODO-folder regression follow-up

## QA-AUDIT-ID-04 — honest missing OPS settlement creator

Source reproduction: a settlement with nullable opsUserName currently renders
its numeric opsUserId in the Người lập cell. Expected: existing house text
`Chưa rõ người lập`; nonnull stored names stay verbatim. Reuse the existing
settlement fixture and its IDs/money, vary only the nullable name. The rendered
row must retain its business code and amount, omit the standalone internal
user ID, and native Xem must read the exact existing settlement ID without a
POST. Existing loading/error/retry/receipt cases remain. No backend/DTO/grouping
or money change. Fresh focused module/types/lint and controller full gates are
required. Do not create a historical orphan merely for UI evidence: if all
current creators have names, disclose the missing-name population boundary.

## QA-AUDIT-PHOI-01 — business and recorded expense search

Reproduce ACCOUNTANT board search by existing Bill QA-ID02-OPS-130955 and
invoice QA22-OPS-INV (trip196). Before fix both return no result although the
internal-code query and expense detail find the records. Expected: Bill/Booking,
recorded OPS and DRIVER fee/invoice matches return the exact owning trip(s),
without duplicated rows or changed totals. Voided sources do not match.
Backend real-DB fixtures cover these branches and retain date/status/window.
Browser390/768/1440 opens existing matching Bill row and detail, captures DOM,
screenshots and no-write API/Drizzle parity. No fabricated accounting record.

## QA-AUDIT-PHOI-02 — carrier-type plate projection

Trip2172/Bill QA-ID02-OPS-130955 persisted EXTERNAL plate15H-154.98 is missing
on the board. Expected: external persisted plate is shown; OWN reads joined
truck, and absent external plate is honest missing data. Real-DB regression
pins all three states and both sort modes' identical membership; browser all
three widths finds existing2172 after PHOI01 and observes the actual plate.
Group same plate without changing financial aggregates or trip state.

## QA-AUDIT-PHOI-03 — no hidden payment selection

Choose a current confirmable board row; change search/status/date so it leaves
the results. Before fix the issuing control remains enabled despite visible
selected count0. Expected: no selected row remains across membership filters,
voucher is disabled and cannot send a request; returning to the old filter
does not resurrect selection. While new results are pending/error, stale row
IDs cannot submit. A refreshed nonconfirmable row cannot submit either. Sort,
fund and direction changes alone retain a visible selection. Existing native
row and nested-action tests remain. Actual three-width select/filter/return/
reselect captures must block material writes, save DOM/screens and direct
Drizzle/API before/after; do not use a real payout merely to prove this guard.

## QA-AUDIT-PHOI-04 — Vietnam appointment date parity

Real-DB fixture has departure2026-09-30, appointment2026-09-30T18:30Z (Vietnam
2026-10-01) and a different shipment expected date. Expected board transportDate
and exact-day bounds use2026-10-01, not departure/UTC day. A2026-10-01T17:00Z
appointment belongs to Vietnam2026-10-02. Missing appointment inherits the
existing shipment expected date; missing both stays null and does not match an
active date bound. Preserve legacy departureDate data and recognized report
dates/money. Actual retained196 appointment2026-09-22T03:30Z shows22/09/2026
at390/768/1440; draft exact-day filters/search are zero material writes.

## QA-AUDIT-ATT-01 — attendance business reference

An attendance TRIP_DAY cell currently shows its internal TRP code in text,
title and aria-label. Expected: persisted Bill/Booking via billBookingTitle,
with explicit missing-reference copy when absent; numeric trip ID and route
remain unchanged for navigation/enrichment. Isolated real-DB cases cover legal
IMPORT Bill and EXPORT Booking, whitespace trimming, null references and a
legacy trip without a shipment; absent and empty ID inputs return no rows.
No salary amount, work-day status, endpoint shape or write policy changes.
Drive the existing populated local attendance calendar at390/768/1440 after
source quiet, capture accessible text/screenshot and safe API/Drizzle parity;
do not create attendance/salary records merely to provide a screenshot.

## QA-AUDIT-PHOI-05 — confirmation-scoped Chi hộ

Use one owning trip with two recorded OPS sources: confirmed100k payable/60k
charge and unconfirmed200k payable/120k charge. Expected ALL300k/180k, confirmed
100k/60k and unconfirmed200k/120k in both board and detail; detail source IDs and
status match the chosen scope. Only the confirmed scope is payment-selectable.
No matching source means no board row. Voided rows never count or match.
The existing Tiền đường total remains identical across confirmation scopes.
Default/invalid API query handling and query-cache identity must be retained;
changing scope clears selected IDs. Actual existing populated row at all three
widths switches scopes, opens/cancels Chi hộ and compares API/Drizzle facts,
with all material requests blocked and no successful payout claim.

## QA-AUDIT-PHOI-06 — distinct factory display

Real-DB reader fixture has a customer different from all factory/route names.
Expected precedence: frozen trip factory; otherwise container operational site,
shipment operational site, shipment free-text factory; missing remains null.
Existing route/customer values remain unchanged and no customer-name fallback
appears. Current phone/desktop board shows distinct labelled Khách hàng, Nhà máy
and Tuyến facts. Actual retained object proof uses existing data only at
390/768/1440, with missing-copy proof when no factory exists, API/Drizzle parity
and no catalog mutations. Keep source/filter/finance identity unchanged.

## QA-AUDIT-PHOI-07 — signed expense display parity

For Chi hộ positive payable50k plus negative payable-80k, expected payable
footer50k (not-30k), while both source rows remain visible and the nonnegative
receivable figures still sum. Editing the positive payable to-1 yields0;
restoring50k restores50k without any request. For Tiền đường, positive approved
75k, negative approved-10k and negative unapproved-20k yield gross75k and
approved75k; editing/restoring the positive line yields0/75k. Preserve every
source row/version and no-write draft behavior. All-negative rows yield0.
Use exact shared sumExcludingNegative; this does not approve negative trip
quantities/rates or expand payment/recognition policy. Actual existing-source
three-width evidence is required for any UI DRIVEN label; absent legacy negative
records remain an explicit coverage gap rather than newly fabricated masters.

PHOI07 linked-negative continuation: enable equality, edit positive payable and
observe equal unsigned receivable. Enter-1 payable: equality releases, previous
receivable stays unchanged and explanation is visible; payable total excludes
the negative. Enabling equality again while any payable is negative stays off
with explanation. Saving a valid draft sends negative amount and preserved
nonnegative customerChargeAmount with the same native entry/source version.
No AR signed policy expansion or new fake response; local browser draft/Cancel
proof uses existing rows, while material save remains separately scoped.

PHOI04 window continuation:303 owned real-DB trips contain two known schedule
dates and301 missing schedules with newer IDs. Expected bounded300 includes
both dated trips first in descending schedule order, then latest298 undated
IDs; grouped/date modes share exactly this set. All null transportDate remains
null despite nonnull departure. PHOI06 address-only snapshot: existing live
factory linkage plus frozen address/null name yields null factoryName, preserving
frozen snapshot ownership instead of silently substituting the live name.

## QA-AUDIT-PHOI-08 — metadata explicit Save/Cancel

Open existing Chi hộ with date/status. Change complete segmented date and status,
blur, then Cancel: no metadata or financial mutation. Reopen unchanged values,
restore edited draft and Save: no metadata PUT. Explicit Save of changed values
sends only changed ngayLayPhoi/trangThaiLay; supported clearing sends null,
never empty date text. A rejected metadata request shows the existing error
area, retains drafts and leaves the dialog open for retry. Retain all native
entry/source/version/correction assertions. Actual three-width draft/Cancel
needs screenshot/DOM/direct ORM before-after with zero material requests;
material save/forward restore only after the parent authorizes that phase.

Actual material continuation: local ACCOUNTANT, retained trip196/Bill
QA22-DISPATCH-220922-A. Capture original metadata and direct Drizzle source/
financial rows; status-only native edit→Lưu permits exactly one200 PUT with
only trangThaiLay. Reopen shows that status, then native edit→Lưu restores the
original status (null when originally missing) with exactly one further200 PUT.
Date, source IDs/amounts, trip status and all financial totals remain unchanged;
audit/idempotency rows may append. No other material request is permitted.

Separately guarded partial-save continuation: current retained OPS23/source3
is confirmed at version6. Native payable+1 Save uses its exact confirmed
correction route and current expectedVersion; only then put
the browser offline for the later metadata write. Preserve error and drafts,
keep Save blocked during failed authoritative read, then go online and click
Tải lại khoản chi. Retry sends remaining metadata only, never repeats the first
successful amount update. Actual forward Save restores original payable and
metadata; compare original net amounts/totals, unchanged sibling identities and
retained original heads plus appended replacement/version history. Derive active
replacement IDs/versions from the real correction response and authoritative
read; the original native ID becomes VOIDED. No same-ID/version assumption or
allocation/reconciliation/settlement unlock is allowed.
No fake response/provider/body or new business fixture. This material phase is
held until controller approval of the exact guards and control147 AFTER.

## QA-AUDIT-ID-03 continuation — remaining visible reader aliases

Real-DB fixtures use existing masters and own IMPORT Bill, EXPORT Booking,
trimmed/empty references and legacy unlinked trip. Fuel evidence and penalty
read aliases must match house billBookingTitle; transport JSON shape and all
financial amounts/readiness/posting identities remain exact. Business searches
find corresponding rows/counts; raw internal-code search remains compatible.
Visible trip-column asc/desc sort follows business values, missing refs last.
No reads mutate trip/posting/snapshot/penalty/evidence rows. Frontend null payload
renders honest missing-reference text and keeps numeric link target. Penalty
export header is Bill/Booking with the same rows/amounts and no internal fallback.
Actual local existing transport196/706/757 at390/768/1440 needs screenshots/DOM,
GET/body and direct ORM parity. Current fuel0 and penalties5unlinked are explicit
populated-UI gaps; any legitimate setup/write requires its own authorized phase.

## QA-AUDIT-PHOI-09 — distinct carrier and carrier-specific driver facts

Real-DB existing masters: OWN retains joined driver and Xe nhà even with stale
external driver; EXTERNAL retains persisted driver over stale OWN driver;
missing external name stays null. Typed CUSTOMER carrier uses operational name.
SUPPLIER same-number customer collision resolves only its explicit validated
linked carrier first, then supplier name; null ID/unknown type is honest missing.
Keep row IDs, financial amounts and grouped/date membership unchanged. Phone
house facts and desktop vehicle cell label Nhà vận tải independently. Actual
existing2172 BillQA-ID02-OPS-130955 at390/768/1440 shows persisted Gaya Container
Lines with API/direct ORM parity and zero material requests. No live external
driver name is invented; populated boundary remains controlled regression only.

PHOI08 retry continuation: update first row succeeds/version advances; second
row or metadata fails. Original error/drafts remain visible, authoritative
detail refetches. Retry skips the already-matching first row and sends only
remaining changed row/meta with its current version. Refetch failure disables
Save until successful explicit reload; no duplicate stale-version money call.
Existing row correction/native IDs and cancellation tests stay intact.

PHOI09 report/error continuation: real seeded supplier/customer same-number
collision uses the supplier's validated linked carrier, never unrelated customer.
OWN with stale external identity stays company party; EXTERNAL with null carrier
and stale OWN truck stays unknown. CUSTOMER follows persisted typed carrier.
THU customer grouping, TRA category/paid/remaining/count and grand amounts remain
unchanged; repeated reads do not modify carrier/financial/source rows. Existing
voucher409 no-source/no-customer paths show real trimmed Bill or Booking, or
honest missing-reference copy, retaining internal numeric lookup IDs and no writes.

PHOI09 trip-less period: when an exact report date contains no noncanceled live
trips, a RECORDED OPS source with tripId null and paidAt in that date still
appears under the established unknown party with its unchanged amount/count.
Out-of-date, VOIDED and canceled-trip sources do not contribute. THU/TRA totals
and repeated-read row parity preserve current financial recognition semantics.

ID03 fuel-photo metadata-only component fixture: original protected photo URL
has no actual blob body in this component boundary. Assert honest unavailable
photo with Bill/Booking accessibility, owner/OCR anomaly/uncertainty visible,
no empty img and no confirmation/rejection action. Do not replace the fixture
with an invented blob URL or fake image body to bypass authentication.

PHOI08 DRIVER-source retry class: change existing approved and unapproved
Tiền đường amounts. First source succeeds/version advances; later source fails.
The original error and both drafts remain, a scoped authoritative read occurs,
and next explicit Save sends only the remaining source with its current version.
If that read or an explicit reload fails, Save is disabled and no amount request
is repeated. Successful explicit reload preserves drafts and allows remaining
Save. Existing sourceKind/sourceId/expectedVersion, confirmation, signed totals,
add-panel and Cancel behavior remain covered by the current regression suite.

## QA-AUDIT-PHOI-10 — compact selection-action text

Preserve the actual390 no-selection red: bulk42.375px and voucher43.59375px,
both wrapping redundant labels in the current shared FilterBar. At390/768/1440
after the copy repair, no-selection voucher button has the exact short direction
label `Lập phiếu chi` or `Lập phiếu thu`, remains disabled and retains its approval
title. Phone bulk action retains the full count in `Chọn tất cả (N)`; existing
hint still explains result-wide phone selection versus current-page desktop
selection. Selected count and enabled/disabled transitions, clear-filter
selection release, IN/OUT payload and loading guard remain unchanged. Actual
native selection/Cancel with all material requests blocked must preserve scoped
Drizzle records. Every inspected visible toolbar button is at most40.5px and
all label text fits; do not enforce the ceiling by clipping or ellipsis.

## QA-AUDIT-PHOI-11 — preserve original driver facts across correction

Use existing real isolated Drizzle transaction fixtures with a confirmed DRIVER
source: catalog-selected, norm-selected and legacy-null originals. Correct its
payable, then forward-correct the replacement back to the original payable.
Both new native heads retain the exact original `driverEnteredAmount` (including
zero and null), `expenseTypeCode`, `feeNormCode`, cost type, driver/trip and receipt.
Neither correction substitutes payable for original entered amount. Original
native rows/receipts remain, old source heads become VOIDED, replacement IDs and
current expectedVersion are distinct, and only the active payable contributes
to the unchanged net ledger obligation. Existing settled/reconciled/cash guards
and OPS replacement evidence remain intact. No migration, raw SQL, fake API
response or fabricated image body is permitted. Before any actual local DRIVER
correction, assert these same safe ORM facts and confirm eligible source, then
native Save/reload/retry and forward restore under the reviewed finite writer.

PHOI11 active-read subcase: after first and forward immutable DRIVER correction,
Tiền đường includes only the active replacement, never the retained native
whose canonical source is VOIDED. Original entered figure and current confirmed
amount remain distinct; total/confirmed totals count the active amount once.
A genuine native with no accounting source stays visible, unconfirmed/version1
and contributes once. All original native/source/evidence history remains in
Drizzle. The same real transaction fixture uses the canonical optional Executor
read seam; no app policy, schema or fake API response is introduced.

## PHOI08 current eligible DRIVER material continuation (held)

Before driver preparation, the exact local census/API/ORM shows Bill
QA22-DISPATCH-220922-A/trip196: confirmed DRIVER1/source1/version4 payable110000,
original driverEnteredAmount10000110000, no settlement/claim/reconciliation/cash
allocation or lot lock. DRIVER2/source2/version1 is unconfirmed payable220000.
The existing OPS23/source3 is reconciled/cash-allocated/native settled and MUST
NOT be unlocked. Its planned successful OPS correction is superseded.

After global147 controls AFTER and controller writer GO only: native Tiền đường
draft DRIVER1 +1 and DRIVER2 +1, allow exactly the current first correction POST;
put browser genuinely offline when its subsequent DRIVER2 PUT is intercepted
after that real200. Preserve failed PUT/refetch/error/drafts/disabled Save.
Go online, native Reload, assert active replacement-only identity and original
driverEnteredAmount unchanged, then explicit Save sends DRIVER2 PUT only. Reopen
and forward restore native DRIVER2 via one current-version PUT plus active
confirmed replacement via one current-version correction POST. Exactly five
attempts (four200 plus one real offline failure), no metadata or other writes.
Original heads/audits/evidence persist, current amounts/totals/net obligations
return to before, DRIVER2 remains unconfirmed, original entered amounts and
fee/norm codes remain exact. No fake response or invented eligible source.

A separate native Chi hộ +1 Save on settled OPS23 permits only its exact
correction POST and must return409 with the current reconciliation refusal.
Preserve the real visible error/authoritative refresh; native Cancel and direct
ORM show no financial/source/native/settlement/allocation change. This is a
refusal execution, never a successful amount correction. Metadata-only original
status Save/reopen/restore remains the separately declared two PUT workflow.
