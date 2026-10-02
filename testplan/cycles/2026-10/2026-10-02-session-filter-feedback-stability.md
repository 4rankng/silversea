# QA-SESSION-FILTER-01 — stable filter toolbar validation

Status: TODO before implementation. Source: owner screenshot and explicit requirement that validation must not change filter panel height.

Reproduce: local ADMIN /shipments and /config/quotations at390/1440. Record toolbar/field bounds, replace Từ day with33, press Tab.
Expected: invalid value stays visible, committed date/results stay unchanged, accessible error appears in anchored feedback outside layout; toolbar and sibling controls retain identical bounds. Correct to01: feedback disappears. Ordinary form helpers remain in normal flow. Dialog dates retain full values and no overlap.

Check search-error class similarly; no new row or control reflow, message remains readable. Capture screenshot/DOM after native edit plus API before/after and driver log. Other roles/staging/physical mobile/error-server paths are separate coverage.
