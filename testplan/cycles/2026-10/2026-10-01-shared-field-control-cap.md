# QA-AUDIT-UI-13 — shared field control ceiling and flat surfaces

1. As ADMIN local dev, open master import at390/768/1440, upload the existing delivered Data form + User & Role workbooks and click Kiểm tra dữ liệu. Measure the default-MD rejection reason and the compact native file controls. Enter a reason without applying or rejecting. Expected: reason40px, compact files30 desktop/40 touch, values/files preserved; batch remains ANALYZED with0 applied rows.
2. Open actual port create/entity forms at all three widths. Measure shared field controls, type an existing port name in the unsaved form and close through actual controls. Expected: single-line boundaries ≤40px; flat surfaces; no write on cancel.
3. Open /expenses/new and enter a signed grouped amount in the actual currency field. Measure the input and affix group outer boundary and capture text. Expected: outer40px, grouping/sign remain intact, no saved expense on navigation/cancel.
4. Open /accounting/deposit-tracker actual create dialog and /config/fuel-price-periods actual create form. Enter grouped monetary value in default-MD NumberFields. Expected: default40px, field interaction unchanged, cancel without writes.
5. Focus a default field and inspect the brand focus ring; inspect existing shared CSS regression for error ring and compact variants. No max-height/height ceiling may clip multiline textarea content.

Pre-fix evidence: qa/2026-10-01_comprehensive-audit_ui10-reason_* and ui13-before_*; after-click geometry/DOM/screenshots/API readbacks and driver command/exit required. Other roles, staging, saving these unrelated catalogs and platform-native picker variants remain explicitly outside this claim.
