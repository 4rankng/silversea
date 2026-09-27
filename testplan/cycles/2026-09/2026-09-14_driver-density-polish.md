# Driver journey and responsive density regression

Scope: local frontend preview with the staging API; changes remain uncommitted.

| Case | Steps | Expected result |
|---|---|---|
| POLISH-DRV-01 | Open Hành trình at 320, 390, 768, 1024 and 1440 pixels; switch among all three states. | Compact neutral selection, visible counts, no clipped identity/date or page overflow. |
| POLISH-DRV-02 | Focus a journey tab; press Right, Left, Home and End. | Focus and selected state move together; one tab stop; panel is labelled by its selected tab. |
| POLISH-DRV-03 | Open a paired journey. | Relationship is clear through a single enclosing group and separators; no decorative cards inside another card. |
| POLISH-DRV-04 | Open driver detail at phone and tablet widths; expand/collapse details and scroll to the final action. | Reduced edge/section padding without truncation; actions remain reachable above bottom navigation. |
| POLISH-DENSITY-01 | Open an operational list and a form at phone/tablet widths. | Phone outer padding is 8px, tablet 12px; form gaps and dialog padding stay compact without shrinking touch targets. |
| POLISH-DENSITY-02 | Enable reduced motion and switch pages/tabs, open/close overlays. | No unnecessary entrance motion; status feedback and content remain visible. |

Browser evidence and limitations are recorded in the delivery report under qa/.

## Office form and detail follow-up

- FORM-POLISH-01: At 390/768/1440px, expense create/edit uses the shell's outer gutter once. The content panel has compact headings and a single field boundary; each shared input/combobox keeps its own standard density without doubled padding. Read-only dates use plain metadata styling. Supplier/category quick-create remains reachable. No form field or save behavior is removed.
- FORM-POLISH-02: Trip create/edit presents flat sections with compact interior spacing. At phone width the form aligns to the shell edge; the action bar fits without horizontally clipping action labels. Long field content wraps within its column.
- FORM-POLISH-03: Shipment detail uses available phone width with one outer gutter, preserves every field, and allows long labels/status text to wrap. Tablet/desktop retain comparison columns.
- MOTION-POLISH-01: Trip create/edit honors reduced-motion preference without staggered hidden content or translated hover states.

Browser proof will be collected from the locally built frontend using staging records; these checks do not assert any financial write or trip state transition.
- FIN-POLISH-01: Debt/payable aging summaries use one compact divided rail, preserve all four bucket totals and their filter behavior, and wrap large currency values. The records below are not enclosed in a second decorative card. Verify at 390/768/1440px with keyboard focus and reduced motion.
- OVERLAY-POLISH-01: CUS appointment popover has an explicit confirmation button sharing the Enter commit path. Save failure stays open with a retryable error, rapid activation submits once, and closing restores focus. The popover fits short phone landscape viewports and honors reduced motion.
- OVERLAY-POLISH-02: Dispatch allocation retains readable supplier/count fields on 320–680px screens; the carrier field occupies its own row instead of being compressed between fixed count columns. Existing allocation values and save logic remain unchanged.

- OVERLAY-POLISH-03: Dismiss the appointment editor while a save is pending and reopen it. The earlier response must not dismiss, lock, or overwrite feedback in the newly opened session. Inputs and presets stay disabled during a save in their own session.
