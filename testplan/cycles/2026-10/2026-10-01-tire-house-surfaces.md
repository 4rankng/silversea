# QA-AUDIT-UI-27 — tire workbench house styling

1. ADMIN opens existing truck and trailer tire screens at390/768/1440.
2. Inspect all form and mounted/spare/disposed sections through actual scrolling.
3. Focus serial and open the position selector and position-manager dialog.
4. Enter an unsaved serial, close/cancel and navigate back. Snapshot tires and
   position catalog before/after; no writes expected from this visual case.

Expected: panels and editable controls are opaque white; no private gradient,
raised shadow, green focus halo or protruding selector corners. House focus,
button geometry and neutral disabled styling remain usable; headings stay
semantic and vehicle plate stays visible. Retain screenshots/DOM/API parity.
Lifecycle create/install/dispose/transfer require separate persisted evidence.
