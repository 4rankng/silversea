# QA-AUDIT-UI-41 — shared inbox records remain distinct from the canvas

1. Sign into local dev as OPS. Open populated `/my-orders` and
   `/my-forwarder-trips` at 390, 768 and 1440 pixels.
2. Click Làm mới, then activate an actual record using its link/keyboard.
   Capture the inbox and destination, and compare the unchanged persisted
   work-inbox/trip sources before and after the read-only actions.
3. At phone/tablet width, every record has an opaque white surface, the house
   border/radius, complete Bill/Booking identity and readable facts/actions.
   Primary actions remain emerald; secondary controls are white. There is
   no page overflow, gray record fill, clipped facts or card flattening.
   The phone screen title appears once: OPS in the shell, CUSTOMER in the
   page because its brand header does not display a screen title.
4. Open the same mounted shared inbox as CUSTOMER, refresh and capture the
   inherited surfaces. DRIVER currently has a separate trips screen; its
   unmounted inbox variant is source coverage only. Mobile controls use the
   canonical 40px touch token; desktop density remains compact.

Save actual screenshots, DOM assertions, API parity and driver exit status.
Staging, every material transition and every customer dispute outcome are
separate coverage and must not be implied by this visual regression.
# Shared heading regression

QA-AUDIT-UI-41-TITLE: the inbox mounts the existing PageHeader with its supplied title and refresh action. The shared PageHeader CSS owns the title font at every breakpoint; RoleWorkInbox must not redeclare a private h1 scale. Phone office shell paints one context title; CUSTOMER paints its sole visible page heading because its brand header has no screen title. Check actual refresh and keyboard row navigation at390/768/1440 with unchanged source reads.
