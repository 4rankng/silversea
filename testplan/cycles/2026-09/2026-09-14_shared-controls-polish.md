# Shared controls: responsive usability regression cases

Scope: shared tables, pagination, tabs, dialogs and drawers. Preserve existing branding, business actions, compact information density, authorization and online-only behavior. No approvals or offline queues are added.

| Case | Reproduction | Expected behavior |
|---|---|---|
| SC-RESP-01 | Render a populated DataTable without a mobile renderer at 390px, 768px and 1440px. | Rows remain reachable at every width; wide columns scroll inside the table instead of widening the page. |
| SC-RESP-02 | Use a DataTable row containing an action button/link/input. Click that control, then click a normal cell and activate the focused row with Enter/Space. Repeat in mobile rows. | The inner control performs only its own action; the normal row click and keyboard action open the row once. |
| SC-RESP-03 | Open pagination for 7 and 100 pages at 320px, 390px, 768px and 1440px. Navigate forward/back and jump directly to a page. | Controls fit the available width, expose current/total pages, permit direct jumps, retain boundary/loading states and preserve touch targets. |
| SC-RESP-04 | Mount two tab groups with identical item IDs. Tab into a group with a disabled/unavailable selection; use arrows, Home and End. | IDs are unique per group, one available tab remains in the keyboard tab order, and navigation skips disabled tabs. |
| SC-RESP-05 | Open a shared modal with a long title and long form on a phone in portrait/landscape and a tablet. Scroll to the final field, operate footer actions, close, repeat with reduced motion. | Title and close control do not overlap; actions wrap without clipping; body owns scrolling and fits the dynamic viewport; focus remains visible; reduced-motion preference suppresses decorative animation. |
| SC-RESP-06 | Open a long shared drawer at 390px, 768px and 1440px. Reach last field and footer, then close with keyboard. | Compact gutters use screen space, no empty 100px trailing body area, footer remains visible, long identifiers wrap and close focus is visible. |
| SC-RESP-07 | Use the shipment-container ledger pagination at phone width. | The page does not hide the shared direct-page entry control; prior/next and the current/total page remain available. |

## Evidence

Automated component and stylesheet checks are captured under `qa/2026-09-14_shared-controls_*`. Browser interactions and responsive screenshots are recorded by the coordinating UI workstream; automated checks alone do not establish browser coverage.

The existing portal consumer suite also requires the same query provider as the application shell. Its isolated test render now supplies a fresh provider per render; this corrects a pre-existing harness failure without changing customer-facing behavior.
