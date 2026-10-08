# QA-AUDIT-UI50 — empty segmented date/time clears its parent value

UI48 continuation, local7175/API3002, existing data read-only. Retained red unit `qa/2026-10-01_comprehensive-audit_ui48-focused.log` shows native clear leaves parent unnotified because shared segment owner emits '//'.

1. In real segmented date/time fields clear the day/month/year or hour/minute individually. While any segment remains, preserve its existing separator draft and do not emit an invalid/partial complete date. When all are empty emit exactly empty, not '//' or ':'.
2. DateRangeFields native complete date, min/max rejection, partial draft correction and all-empty endpoint clearing remain meaningful component assertions. Shared time/native datetime form regressions cover complete/partial/empty; no API mocked error or test skip.
3. Actual dispatch date endpoint clear through keyboard SelectAll/Backspace on real segments must produce expected query/filter state and displayed empty placeholders, with zero business writes. Correct/restore valid2026 endpoints, retain native keyboard/calendar behavior, screenshot/postclick DOM/request parameter proof. Same bounded independent field geometry as UI48.
4. Before/after same API shipment5 and guarded Drizzle rows unchanged, exact command/exits saved. Rung stated per claim; non-driven conditional form hosts remain CODE-READ ONLY.

Not covered: required-form submit after empty values, every shared time/date consumer, other roles/engines/staging and successful business mutations.
