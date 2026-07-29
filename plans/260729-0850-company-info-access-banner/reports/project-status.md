# Project Status

## Summary

- Scope: allow `giamdoc` and `ketoan` to access/save company-info config, and
  show a dashboard warning while company info is incomplete.
- Implementation + focused review: complete.
- Repository-wide closeout: not clean yet because of unrelated concurrent
  ShipmentsPage test drift and a latest E2E backend startup refusal.

## Progress

| Item | Status | Evidence |
| --- | --- | --- |
| Office-role company-info route coverage | Done | `frontend/src/App.company-info-route.test.tsx`, `frontend/src/App.tsx` |
| Dashboard missing-company-info banner | Done | `frontend/src/features/dashboard/components/CompanyInfoSetupBanner.tsx`, `frontend/src/pages/DashboardPage.tsx` |
| Schema-backed readiness / save eligibility | Done | `shared/src/company-info.ts`, `frontend/src/pages/config/CompanyInfoConfigPage.tsx` |
| Focused review | Done | `qa/2026-07-29_company-info-banner_review.rerun.md` |
| Manual desktop/mobile verification | Done | `qa/2026-07-29_company-info-banner_manual.md` |
| Broad QA closeout | Open | latest frontend rerun + E2E rerun still red for non-scoped reasons |
| Handoff sync | Open | controller still needs final handoff update |

## Verified Green

- MANAGER and ACCOUNTANT can open `/config/company-info`.
- Dashboard shows a non-dismissible setup banner when company info is incomplete.
- Optional phone/email remain optional for save eligibility.
- Seeded blank `company.*` rows with timestamps still count as incomplete.
- Manual QA passed at 320, 390, 768, and 1440 widths.
- Focused code review rerun passed.

## Blockers

1. Unrelated concurrent `ShipmentsPage.test.tsx` regression in the latest full
   frontend rerun.
2. Latest E2E rerun hit backend connection refused during startup, so it is not
   a clean pass artifact.

## Next Actions

1. Controller to stabilize or re-run the broad frontend suite after the
   concurrent shipment edit settles.
2. Re-run E2E once backend startup is stable, then sync handoff.

## Unresolved Questions

- None.

