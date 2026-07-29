# Project Status

## Summary

- Scope: allow `giamdoc` and `ketoan` to access/save company-info config, and
  show a dashboard warning while company info is incomplete.
- Implementation + focused review: complete.
- Repository-wide closeout: frontend is now clean; E2E remains blocked by
  unrelated existing test-data and system-admin KPI assertions.

## Progress

| Item | Status | Evidence |
| --- | --- | --- |
| Office-role company-info route coverage | Done | `frontend/src/App.company-info-route.test.tsx`, `frontend/src/App.tsx` |
| Dashboard missing-company-info banner | Done | `frontend/src/features/dashboard/components/CompanyInfoSetupBanner.tsx`, `frontend/src/pages/DashboardPage.tsx` |
| Schema-backed readiness / save eligibility | Done | `shared/src/company-info.ts`, `frontend/src/pages/config/CompanyInfoConfigPage.tsx` |
| Focused review | Done | `qa/2026-07-29_company-info-banner_review.rerun.md` |
| Manual desktop/mobile verification | Done | `qa/2026-07-29_company-info-banner_manual.md` |
| Broad QA closeout | Open | frontend final rerun passed; E2E rerun remains red/incomplete for non-scoped reasons |
| Handoff sync | Done | `HANDOFF.md` updated by the controller |

## Verified Green

- MANAGER and ACCOUNTANT can open `/config/company-info`.
- Dashboard shows a non-dismissible setup banner when company info is incomplete.
- Optional phone/email remain optional for save eligibility.
- Seeded blank `company.*` rows with timestamps still count as incomplete.
- Manual QA passed at 320, 390, 768, and 1440 widths.
- Focused code review rerun passed.
- Full frontend suite passed: 90 files / 432 tests.

## Blockers

1. E2E `TC-0604` encounters an existing duplicate penalty-subject conflict.
2. E2E `TC-1002` cannot find the current API user total in the system-admin KPI
   text. These surfaces are unrelated to company-info access or the dashboard
   banner.

## Next Actions

1. Resolve the unrelated E2E baseline failures in their owning task before
   declaring the whole repository suite green.

## Unresolved Questions

- None.
