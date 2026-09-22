# September22 document/CUS and dispatcher audit

Baseline: prod `43d6ed6b4f403052bdbfede65251880ee7f5970a`.
Local UI `http://localhost:7175`, API `http://localhost:3002`.
No production/staging writes. Only lane-owned local fixtures named `QA22-DISPATCH-*` may be mutated. Preserve failed attempts and distinguish navigation inventory from actual action evidence. Account `chungtu` mapping must be established from current local account data; do not infer it from its name.

| Case | Journey | Expected evidence |
|---|---|---|
| DSP22-INV-01 | Establish current document/CUS and dispatcher role mappings; list allowed routes, role navigation and visible actions at320/390/820/1024/1440. | Role/auth source, loaded-route and viewport matrix, control inventory, screenshots, API/console failures, honest gaps. Legacy redirects are recorded separately. |
| DSP22-CREATE-01 | Create an owned FCL shipment through actual UI: required validation, searchable customer/site/route/ports, multiple containers, complete/partial schedules, copy, cancellation/reopen, draft save and retry. Exercise LCL mode-switch and owned LCL create separately. | Post-click DOM/screenshots, network result, native Drizzle rows for created shipment/containers and retained values. No unrelated fixture writes. |
| DSP22-DOCS-01 | Shipment list/detail/container workboard: search, date/status filters, pagination, detail open, identity/documents/container/route/schedule/carrier/notes edits, invalid input and cancel, document/custody states, saved owned-fixture edit and retry. | Actual user actions across allowed state, UI/DB agreement, no permission-only actions offered. Upload/export limitations explicit. |
| DSP22-DISPATCH-01 | Locate owned shipment in master/detail plans; allocate carrier, assign owned truck/driver, validate shortages, cancel/reopen, save plan, issue dispatch order and read back. | Actual controls and messages plus native Drizzle fulfillment/trip assignment/status/versions; never dispatch existing unrelated shipments. |
| DSP22-CATALOG-01 | Both roles' permitted customer/route catalogs; dispatcher vehicle/driver/carrier lookup; CUS fuel-period and invoice-tracking reads. Search/filter/detail/form open/validate/cancel and role boundaries. | Role-specific visible actions, matching API permission, keyboard focus, viewport geometry. Saves only with owned fixtures and DB proof. |

Every demonstrated defect will receive a separate reproduction and expected-result case before its source fix. Root owns full gates and patch packaging; this lane owns focused regressions and `qa/2026-09-22-sisprod/dispatch/` evidence.

## DSP22-DATE-01 — shipment detail datetime consistency

Reproduced on the owned shipment273 direct detail at1440: creation time renders `14:06:39 22/9/2026`, while the current design contract is `HH:mm DD/MM/YYYY`. The page imports the older locale-shaped `formatDateTimeVN`; its container appointment, deadline, history and lock metadata use the same formatter. Evidence: `cus-owned-direct-detail-1440.json` and screenshot.

Expected: reuse the existing canonical `formatDateTimeShort` so instant values remain pinned to Vietnam time while date/month are padded and seconds are omitted. Verify a UTC timestamp crossing the Vietnam calendar boundary, lock metadata and missing timestamps in the page regression; run the whole page test file. Reopen the actual owned detail at390/1440 after the API restart, compare against native Drizzle values, and inspect rendering. No persistence or shared formatting behavior should change.

The first browser after-check found the nested `ShipmentCoordinationPanel` customer-visible event timestamp still using the old locale shape. Retained `date-fixed-owned-detail-390.json` is partial-fix evidence, not a pass. Extend this same case to that shipment-specific child component and its rendered event in the page regression before claiming all detail timestamps consistent.

## DSP22-DECL-01 — settlement summary must show saved declarations

CUS saved declaration `QA22DECL220922` with GREEN channel on owned shipment273. The shipment list/detail reflects it, but its settlement-summary row says `Chưa có`; the read model sets `customsNumber: null`. Before fix, retain browser and native declaration proof. Return current nonblank declaration numbers in stable order without duplicate labels; keep null for no declarations and keep distinct lots/customer boundaries. Add service regression for one/multiple/blank/duplicate declarations and unchanged financial totals. No financial arithmetic changes.

## DSP22-RBAC-01 — settlement route and actions match existing permissions

DISPATCHER can open `/shipments-debit` and select a customer, then summary GET403s. Reproduce MANAGER summary → expansion/export actions independently; summary is allowed but detail/edit/issue routes only allow ADMIN/ACCOUNTANT/CUS. Gate the dispatcher route and give managers a read-only summary with no unsupported expansion/selection/export. Test roles without expanding backend permissions; verify actual route/action behavior at390/1440.

## DSP22-RETRY-01 — ambiguous cost-save response must not duplicate fees

Suspected from `ShipmentDebitWorkspace` creating a fresh idempotency key for every click. Use a separate owned native-Drizzle setup lot/trip/container, then add a fee through the CUS browser. Forward the actual save to local API, suppress its committed success response with a simulated503, capture retained draft and actual DB rows, then retry unchanged. Expected: exactly one added fee and the same idempotency key across the unchanged attempt. Also verify a pre-write error retry, edited payload gets a fresh key, successful saves reset the key, and rapid/pending submission cannot issue a second write. Preserve all failed reproductions; no successful financial lock or debit issue required.

## DSP22-GENERIC-01 — named-location coupling audit

User requires generic production logic with configured locations. Read shipment-query and dispatch-query code: facets and truck suggestions already match port IDs/dispatchZone taxonomy, without location-name conditions; stale comments still describe only one named location. Remove that misleading internal wording without altering runtime/wire behavior. A separate concrete violation exists in MasterPlanFilters: two literal localized location labels drive hidden facets. Reported to root for a configuration-compatible fix; do not remove the intended hidden-facet behavior without preserving its configured policy. Test fixtures may contain descriptive location examples.

DSP22-GENERIC-01 implementation approved by root: add `dispatch_zones.show_port_facet` / `showPortFacet` default true, expose through existing admin CRUD and active taxonomy, and use this flag in desktop/mobile master-plan filters. Migrate existing rows matching the two previously hidden rendered labels (including decomposed Unicode and optional Cảng prefix) to false as a one-time data backfill; new or renamed zones follow the persisted flag regardless of label. Existing legacy wire fields remain unchanged. Verify custom hidden/visible/renamed zones, form payload defaults and edits, API role boundaries, native Drizzle rows, and migration on an isolated database clone before local main. Migration skill paths searched and unavailable; use current Drizzle generation/migrator patterns with root review.

## DSP22-INTEGRATION-FIXTURES-01 — repeated-run shipment identities

Full backend integration reported six failures in `shipment-routes.test.ts`. Before any fix, native Drizzle reads in the isolated integration database proved active earlier fixtures already owned `first`, `BL-Q17-MATRIX`, `BULK-BOOK-0/1`, `TK-9zX4`, `TK-001A` and `TK-Q17-UPDATED`. The optimistic-lock test did not assert its first write succeeded; the reference conflict left the original version current and the second write correctly succeeded. Preserve every business assertion, namespace all implicated references per run, and assert the first update's 200 and version increment before testing stale rejection. Run the entire test file twice on the populated isolated clone to establish repeatability; preserve original failed full-suite evidence. No production behavior or uniqueness rule changes.

## DSP22-INTEGRATION-FIXTURES-02 — companywide expense pagination

Two `expense-accounting-source.test.ts` assertions required a September 16 fixture to appear on page 1, limit 100. Native read-only evidence shows 143 visible rows, with all 100 first-page rows dated September 22. The source intentionally sorts newest expense date first. Keep companywide, unfiltered role and orphan-source assertions; walk all result pages when asserting global fixture presence/absence. Do not weaken the assertion to a narrower shipment filter. Run the entire file on the populated isolated clone.

## DSP22-INTEGRATION-FIXTURES-03 — threshold prerequisites independent of demo seeds

Three `surcharge-threshold-confirmation.test.ts` failures depend on the old demo 15T price. The September 20 NO-SEED ruling deliberately removed invented 15T prices, and native readback confirms none exists. Preserve UNSET→MANUAL, confirmed NONE→AUTO, and confirmed PCT→AUTO assertions by creating a complete, uniquely named test-only pricing chain (customer, route, vehicle class, base price, norm, fuel period and terms), with exact cleanup. Do not restore fabricated business seed rates or alter the pricing engine. Run the entire file twice alongside the repeatability check.

### Cleanup follow-up

The first focused run exposed the mechanism that accumulated stale shipment fixtures: cleanup deletes owned trips before their owned `billing_document_trip_claims`, whose live FK is `ON DELETE RESTRICT`. Native read-only evidence found 13 claims against that run's owned trips. Move claim cleanup before trip/posting cleanup, retain exact owned document IDs, and make a cleanup error fail the test process after resources close instead of returning exit zero. Verify two complete runs with zero cleanup warnings. This changes only fixture teardown, never application data constraints.
