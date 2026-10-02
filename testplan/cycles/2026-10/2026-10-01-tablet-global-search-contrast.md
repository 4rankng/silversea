# QA-AUDIT-UI-23 — readable global navigation search

In local dev as ADMIN open Users at768 and1024px with touch enabled. The global
search must show its icon and placeholder on an opaque white field. Focus with
keyboard, enter "nhà máy", then click the actual Nhà máy / Kho result. The typed
query and focus remain visible and navigation reaches /config/factories. Repeat at1440px;
at390px use the existing phone navigation because global search is intentionally
hidden. Compare the factories API before/after: navigation causes no material write.
Retain screenshots after entry and after result click, DOM colour/focus assertions,
API snapshots and driver output. Error and disabled control styles remain intact.
