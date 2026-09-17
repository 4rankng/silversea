# CUS and dispatcher local component audit

Scope: current local `prod` checkout, CUS and DISPATCHER. Existing uncommitted changes are retained. Each reproduced defect receives a focused case below before implementation. Browser evidence is stored in `qa/2026-09-17-ui-audit/cus-dispatch/`; evidence is local and is not a delivery artifact.

## Component and route acceptance matrix

| Case | Routes and controls | Procedure | Expected |
|---|---|---|---|
| UI-CD-01 | `/shipments`, `/shipments-detail`: filters, pagination, schedule edit | Open filters, type/clear searches, select options, change page, open schedule dialog; type and select date/time, Escape then reopen. | Consistent control heights, no clipped labels, no unexpected dialog close, values persist only on explicit save; cancel retains saved data. |
| UI-CD-02 | `/shipments/new`: FCL/LCL, customer/factory/route/ports, time/date | Type accents, code/address, unmatched query and recovery; keyboard selection; switch customer/cargo, add/remove rows, open nested create drawer and Escape. | Correct scoped selection and row identity; no duplicate/no-result contradiction; nested picker dismisses before parent; no page overflow. |
| UI-CD-03 | Shipment detail: tabs, evidence, container edit | Follow actual list detail link, open every available tab/modal and close; invalid/empty edits remain usable. | All allowed controls load, errors are local/actionable, drafts do not leak to another record. |
| UI-CD-04 | `/dispatch`, `/dispatch-detail`: filters, allocation, assignment, tags | Search/clear, switch planning views, open assignment and container detail, select/unselect tags, inspect driver identity and direct commands. | No approval step; complete notes/driver information; calendar/time overlays remain operable and compact. |
| UI-CD-05 | `/fleet/vehicles`, `/fleet/drivers`, `/suppliers` | Search name/code/plate, unmatched search and recovery, expand records, paginate and keyboard navigation. | Accurate read-only resource catalog, no inaccessible actions, empty/loading/error states distinct. |
| UI-CD-06 | `/config/customers`, `/config/routes`, CUS `/config/fuel-price-periods` | Search/filter and open create/edit allowed by role; empty submit, long values, cancellation. | Permission-correct controls, validation keeps input, consistent compact layout. |
| UI-CD-07 | All audited screens | Repeat representative controls at360/390/820/1440px, inspect screenshots and geometry. | No page overflow, visible primary actions, no mobile vertical scrollbar, readable long values; hidden scrollbar does not disable scroll. |

## Reproduced defects (before fixes)

| Case | Reproduction / evidence | Expected and regression |
|---|---|---|
| UI-CD-08 | DISPATCHER `/fleet/drivers`: `Đinh Thanh Thịnh` finds the driver; `dinh thanh thinh` and `  dinh  thanh  thinh  ` return none. `/fleet/vehicles` uses the same raw lowercase comparison. Browser `search-_fleet_drivers-0..4` and `search-before.log`. | Driver and vehicle catalog searches normalize Vietnamese accents including đ, mixed case and repeated whitespace. Names plus code/phone/plate remain searchable. Plain plate/phone input without punctuation matches the formatted identifier. Unmatched input gives an empty state; clearing restores rows. Component regressions must exercise each rendered search field and preserve carrier filtering. |
| UI-CD-09 | CUS `/config/routes`: `que vo` finds9 rows but `  que  vo  ` returns0; `/config/customers`: `dong van` finds1 but `  dong  van  ` returns0. `search-_config_routes-0..4` and `search-_config_customers-0..4`. | Collapse query whitespace and trim before cache identity/API request, while keeping the exact typed input. Equivalent whitespace edits reuse the same results; clearing returns all records. Component regressions assert the request and unchanged draft value. |
| UI-CD-10 | DISPATCHER `/dispatch-detail`, open “Chỉnh sửa điều phối” on390px/coarse pointer. Task chips measure24.8px; manage icon22px. `DISPATCHER-dispatch-assign-390.json/png`. | Interactive task chips, add-tag fields/actions and tag manager receive44px touch targets on coarse pointers; compact desktop layout remains unchanged. Selected states, note text and row wrapping remain readable without page overflow. |
| UI-CD-11 | DISPATCHER `/suppliers`, at390 and1440px: `gara thanh dong` finds1 but `  gara  thanh dong  ` returns0. `suppliers.log` and `suppliers-results.json` record the real search response. | Normalize whitespace before the catalog query/cache identity while retaining typed input. The same supplier appears for accented, unaccented and padded queries; no-match and clear recover correctly. Component regression asserts the hook parameter and exact input draft, including whitespace-only clear. |
| UI-CD-12 | CUS `/shipments`, isolated FCL shipment15731/container9240: identity displays factory site857, editor starts blank, saving `QA CD FACTORY EDIT` returns200 but visible factory remains the previous site. The same parent-field editor is used in `/shipments-detail`. | The factory editor must edit the effective factory source: FCL factory belongs to a container/site, not a hidden parent text field. Overview must explain per-container editing; detail initializes the selected site, restricts it to the customer, updates the real container source with version/permission safeguards, and immediately shows the persisted choice after reload. Preserve LCL identity and prohibit silent changes to siblings. |
| UI-CD-13 | Shared shipment searchable fields supplied both a visible label and the same `aria-label`; accessibility tree announces “Nhà máy Nhà máy”. | Each field has one exact accessible name. Visible-label and hidden-label variants both expose “Nhà máy”, preserve labels/required feedback, and remain keyboard searchable. Regression asserts the exact role/name for both variants. |

| UI-CD-14 | Final factory editor screenshot at1440px shows two borders and an oversized nested input. The inline-editor CSS excludes only direct control children, while the shared ComboBox input is nested. | Feature input styling must skip every descendant input owned by a shared control, retaining native field styling. At360/390/820/1440px factory selector has one boundary/focus ring, no inner border or inflated height; adjacent native and shared controls have equal height (shared34px default token on desktop,44px coarse pointer including tablet), and label/value remain readable. Regression tests the actual selector against native, direct shared and nested shared inputs. |

## Execution notes — 17 September 2026

- UI-CD-08/09: browser PASS for the reproduced search cases, no-match and clear; focused API/field regression tests PASS. `search-after.log`.
- UI-CD-10: browser PASS for tag selection and nested Escape at390/820/1440px; measured44px touch targets on390/820px, desktop density unchanged. `deep-dispatch-final.log`.
- UI-CD-11: browser PASS at390/1440px, all three equivalent queries return1 result; no-match0 and clear17. Two supplier test files7PASS. `suppliers-after.log`.
- UI-CD-13: exact-name unit PASS for visible and hidden labels; together with factory editor2 files33PASS.
- Date/time actions: browser PASS at360/390/820/1440px. Actual hour/minute selection, mobile Xong, calendar day selection, exact typing13:17, and adding a second container retained first-row date/time. `selector-actions-final.log`. Initial mobile harness attempt omitted Xong; corrected before PASS.
- Factory nested create: empty validation retained draft, completed fields/catalog route then POST201 created isolated QA site1319; the create form selected that site. `create-factory-final.log`.
- Factory correction: focused overview/model2 files108PASS; combined integration correction5 files105PASS; TypeScript and scoped ESLint PASS. Actual source-save/readback PASS at360/390/820/1440px: one200 container command per save, canonical site persists on reload, parent text unchanged. Shared supporting-text reset/reopen was also fixed; final4width rerun PASS for save/readback plus first Escape closing the list only and second Escape closing the editor.
- UI-CD-14: actual selector regression failed for nested shared inputs before the fix; after token-aligned sizing,3 files51tests PASS. Four-width browser geometry PASS: nested input border0/transparent; native/shared boundary heights both44px at360/390/820px coarse and both34px at1440px; document width equals viewport.
- Larger scoped run under simultaneous full-suite load:238PASS,1 test hit5000ms timeout; the same file previously passed. This run is not reported as wholly green; parent rerun with bounded workers owns final suite proof.
- Route/control coverage and precise NOT TESTED gaps: `plans/260917-ui-audit/reports/cus-dispatch.md`. Inventory at390/1440px is not a claim that every state is verified.

## Existing E2E role matrix harness verification

- TC-1920/1930..1933 must keep the authenticated UI session, wait for the clerk landing screen before a second navigation, and tolerate a temporarily absent dialog node while waiting for its entrance transform. Keep role access, disabled-action reasons, focus restoration, no-runtime-error and overflow assertions unchanged. Do not suppress application exceptions or retry failed saves. This corrects test synchronization/session setup, not application behavior.


## Existing-plan execution against current PRDs — 17 September 2026

- Suite19 role/accessibility browser matrix:54/54PASS after the setup synchronization corrections above; `e2e19-final.log`.
- CUS-DRAFT-001: partial FCL time/date and Cancel retention PASS at390/1440. LCL additional-date/valid-shared-schedule variants NOT TESTED in this pass.
- CUS-DRAFT-002: weight-only guard and pristine switch PASS at390/1440; warehouse-only browser variant NOT TESTED.
- CUS-DRAFT-003: edited-row confirm/cancel/delete and empty-other-row direct delete PASS at390/1440.
- CUS-DRAFT-004: both multiline notes retained across pristine and confirmed cargo-mode switches PASS at390/1440; identity fields not separately reasserted.
- DSP-DRIVER-01: isolated internal assignment Save/reload PASS at1440/390; driver Lương Văn Long, vehicle15C-167.31, notes and revenue retained, exactly one write each. Other driver/issued-trip variants NOT TESTED here.
- DSP-DRAFT-01: individual note/revenue/cost dirty guards and revert-to-saved state PASS at1440/390, no writes. Issuing the saved plan is NOT TESTED by this check.
- Current PRD alignment corrected existing case IDs in CUS/dispatcher role/flow plans where pairing definitions, dispatcher-create rights or global CUS access contradicted current requirements. No case is marked PASS merely because its wording was corrected.
- Detailed requirement-to-evidence map and explicit gaps: `plans/260917-ui-audit/reports/cus-dispatch.md`.
