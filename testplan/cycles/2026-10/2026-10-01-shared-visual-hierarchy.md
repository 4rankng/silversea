# QA-AUDIT-UI-15 — shared surfaces and action hierarchy

1. As local ADMIN open the actual expense-create form and two ordinary dialogs
   at390/768/1440. Inspect whole screens after a real field/action click.
2. Check that enabled fields have solid white fill, field groups use the same
   house Panel, and headings/dividers create a clear reading order.
3. Compare primary/secondary/cancel/disabled controls on expense, catalog, import
   and accounting screens. Primary is consistent brand; disabled is neutral and
   readable, without fading all content. Modal header/footer remain white.
4. Focus with keyboard and mouse; exercise Cancel, required validation and a
   valid unsaved draft. Compare persisted API snapshots; no business writes are
   expected from this visual case. Confirm40px touch targets and zero overflow.

Expected: consistent token-driven surfaces, radii, spacing and action hierarchy;
no canvas-colored editable wireframes, heavy decorative row wash, cropped content
or tinted/washed primary variations. Actual screenshots must satisfy visual review
in addition to automated containment checks. Other roles/flows/staging require
separate evidence; UI14/UI12 cover their shared field/phone-record regressions.

Class continuation: OPS expense/advance/settlement, office legacy advance recovery,
shipment container actions, business units and billing history still used retired
single-dash classes. Exercise their actual dialogs/actions without saving: enabled
primary emerald, white secondary, neutral full-opacity disabled, 40px touch floor
and ceiling, visible keyboard focus. All use the shared Button recipe, with no
private OPS paint block or billing icon geometry. Preserve Cancel and API parity.
