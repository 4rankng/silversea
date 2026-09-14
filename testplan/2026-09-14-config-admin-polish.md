# Configuration and administration responsive polish

This pass changes presentation and focus visibility only. Keep permissions, field validation, API payloads, calculations and immediate-save behavior unchanged. The app remains online-only and does not introduce an approval flow.

## CFG-POLISH-001 — Narrow configuration forms

Open customer, factory/warehouse and forwarder expense type add/edit forms at 360px, 390px, 768px and desktop width. Use long Vietnamese names, addresses and labels. Inspect the deletion, cancel and save controls while editing.

Expected: form columns shrink safely and become a single column on phones; full-width factory fields span the available column count. No horizontal document overflow or cropped controls. The forwarder policy is a flat section, and its three footer actions can wrap without collision.

Open edit forms in the other catalogs that use the shared configuration action bar, including trucks, trailers, ports, fuel norms and cargo types. Expected: Delete, Cancel and Update remain reachable at 360px without forcing a horizontal scrollbar.

## CFG-POLISH-003 — Links inside editable catalog rows

In the truck catalog, focus **Đối tác sở hữu** and press Enter; repeat by clicking it. Open a port's external portal link. Then focus an ordinary catalog row and activate it with Enter or Space.

Expected: child links retain native keyboard/click behavior without opening the edit modal or canceling navigation; row activation still opens the edit form when the row itself owns the interaction. Truck ownership navigation stays inside the SPA.

## ADMIN-POLISH-001 — Flat, readable health and user administration

Inspect health items with long names, source names and action labels at phone, tablet and desktop widths, including failure and loading states. Open user add/edit panels and Business Units.

Expected: health items and business units use separated rows/sections rather than cards inside cards. Fields and long source text fit their available width. User form sections stay compact across all widths. Coarse-pointer controls remain at least 44px high without enlarging desktop controls.

## AUDIT-POLISH-001 — Variable header and short-screen detail

Open an audit detail at 390×844, 844×390, 768×1024 and 1440×900. Enlarge text to 200%, then scroll the full detail. Close with the close button and Escape.

Expected: the header stays visible, body consumes the actual remaining height, and the last detail remains reachable. No fixed subtraction assumes a header height. Safe-area edges are respected; no motion-dependent or hover-only detail affordance on touch devices.

## CFG-POLISH-002 — Salary period keyboard and motion

Tab to both salary-period radio choices; move between them with arrow keys. Repeat with reduced motion enabled and at 360px width.

Expected: keyboard focus is visible independently of selection. The choice group and period preview are compact, flat sections. Save feedback wraps and honors reduced motion; existing period calculations are unchanged.

In application settings, focus the financial policy tab and press Right/Left/Home/End. Expected: selection and focus follow the shared tab behavior, with a named active panel and no change to entered field state or save rules.

## CFG-POLISH-004 — Penalty actions and template editor gutters

Open penalty reasons on touch/tablet and navigate each record's Edit/Delete buttons by keyboard. Expected: actions are visible without hover, stay in normal layout, have focus rings and touch-sized targets; reduced motion disables card lift/stagger.

Open a debit-note template editor at phone, tablet and desktop widths, then the issuer details section. Expected: page edges follow the shell padding rather than stale negative margins; the issuer fields form a compact flat grid. The document preview may scroll horizontally because it represents a printed document, but the surrounding application must not overflow.

## CFG-POLISH-005 — Configuration index and import labels

Open the configuration index at 360px with a long salary-period status. Expected: status sits beneath its title instead of squeezing the title between status and action columns; the whole row remains one clear navigation target. Load an import result with a long unbroken filename. Expected: the filename wraps within the available width, and the legacy file disclosure has a usable touch target.

## Evidence

Focused automated checks are recorded in `qa/2026-09-14_config-admin-polish_tests.log`. Source inspection inventory is recorded in `plans/260914-responsive-polish/reports/config-admin-inventory.md`. Browser evidence is collected separately by the parent task; source inspection or a style contract alone does not prove every live flow.

## CFG-POLISH-006 — Complete tablet catalog records and reachable pagination

At 768px, inspect the customer catalog through the payment-term columns and row actions. The current 13-column catalog must switch to labelled records when its container is at most 1100px: three fact columns when at least 640px fits, two on phones. The narrower routes catalog may retain its tabular layout in the 680–1100px band. Verify every fact and action stays visible without page-level horizontal overflow. Compare 390px, 768px and 1440px.

At 768px and 1440px, scroll Users to the footer. The paginator must own the available row width, show one range summary, and keep its previous/next/page or jump controls reachable. Select another page and confirm the custom account range updates once. At phone widths, retain the compact jump control and 44px targets.

Evidence prompting this regression check: completion captures show the customer table extends 244px beyond its clipped wrapper; parent Chrome inspection shows the Users paginator has a 4px content width and vertically fragmented summary.

## ADMIN-POLISH-002 — Tablet user row layout

Inspect Users at 640px, 768px, 820px and just above the shared mobile/desktop visibility boundary. When compact user rows are visible, avatar, identity and action menu must share one header row; metadata wraps below rather than pushing the menu into a third vertical block. Card styling is intrinsic to this component and must not depend on the narrower phone-only form breakpoint. Preserve all identity and contact data, keyboard targets, and the existing phone form layout.

## TYPE-001 — Shared typography hierarchy on every viewport

Compare dashboard, Users, salary-period settings, customer/forms, audit detail, account sheet, and health workspace at 390px, 768px and 1440px. Equivalent roles must use the final PM scale: page title 18px, section 14px, dialog 16px, metric 20px, body/data/control/action text 12px and label/caption text 11px. Compact, ordinary and touch field values, placeholders and dropdown options all use 12px. This replaces the earlier 13px compact / 14px default / 16px touch proposal. Heading and metric size must not drift by breakpoint or text length; wrap content instead. Preserve the compact gutters and distinguish printed debit-document typography from surrounding editor controls.

Check long Vietnamese labels, money values and multi-line helper text. Verify equivalent roles use the same token, 11px labels remain distinct from 12px values, and no fractional or page-specific text overrides survive. Weights come from the shared regular/medium/semibold/bold hierarchy. Preserve browser pinch zoom and check native focus behavior on physical mobile devices; do not introduce a private 16px field exception.

## CFG-POLISH-007 — Compact customer summary and tablet records

Open `/config/customers` at 768px with at least two customers, then compare 390px and 1440px. The four summary metrics share one flat strip with four columns on tablet/desktop and two on phones; figures use 20px and captions 11px. Phone/tablet summaries omit decorative watermarks and do not retain the previous 112px card height. Every metric, label and supporting description remains visible.

When the customer record canvas is 640–1100px, facts use three shrinkable columns; narrower canvases retain two columns. The identity and action rows span the record width. Compact cell padding, sentence-case labels and record dividers replace padded cards; all 12 customer fields and Edit/Delete actions remain accessible, with long names, addresses and email addresses wrapping. With ordinary staging records, aim to show about two customers in a tablet viewport; long real content may grow without truncation or fixed heights. Check the row menu, sorting and search still operate, empty results stay full width, and other configuration pages retain their current layouts.

Evidence prompting this case: coordinating Chrome inspection at 768px found a roughly 240px two-row summary and a 465px customer record. Focused structure/style checks are supplemental; the coordinator owns fresh built-preview geometry and screenshots.
