# Docs Manager Report

## Assessment

The advance workspace consolidation does require project documentation updates. The current regression-testing docs still described the pre-consolidation split, where `/advances` was treated as a settlement-only page and `/admin/advance-settlements` was the primary review route.

The implementation source confirms the new canonical shape:

- `/advances` is the combined office workspace.
- `view=requests|settlements` switches between request and settlement views.
- `/admin/advance-settlements` is now legacy compatibility and redirects to the canonical settlement view.
- `/governance-actions` remains separate as `Trung tâm phê duyệt`.

## Changes Made

- Updated `docs/regression-testing/11-module-11-finance-pnl.md` to describe `/advances` as the canonical combined workspace and to treat `/admin/advance-settlements` as a redirecting legacy URL.
- Updated the M11 regression cases to use `?view=requests` and `?view=settlements` where the canonical workspace behavior is being described.
- Updated `docs/regression-testing/04-module-04-disbursement-recovery.md` to reference the canonical settlement view instead of presenting the legacy route as primary.
- Updated `docs/regression-testing/09-module-09-field-app.md` where office-side cross-checks pointed at the old settlement route.
- Added `docs/codebase-summary.md` as the repository summary generated from the repomix snapshot.

## Why These Updates Were Needed

The consolidation changed user-facing navigation and the canonical workspace URL, so the docs needed to match the current route contract. Leaving the old route labels in place would mislead maintainers and regression testers about where request review and settlement review now live.

## Verification

- Searched the docs tree for advance-workspace route mentions before and after the update.
- Confirmed the frontend source exposes `/advances`, the `view` query contract, the legacy redirect, and the separate governance queue.
- Ran `repomix` successfully and used the resulting snapshot to draft `docs/codebase-summary.md`.
- Attempted to run `node .claude/scripts/validate-docs.cjs docs/`, but the repository does not contain that script at `.claude/scripts/validate-docs.cjs`, so automated docs validation could not be completed from this checkout.

## Recommendations

1. If the docs validator is expected to exist, restore or relocate it and update the repo instructions to the correct path.
2. Keep the regression-testing pages aligned with the canonical `/advances` workspace if additional advance-related UI changes land later.

Status: DONE_WITH_CONCERNS
Summary: Updated the stale advance-workspace docs to match the canonical `/advances` workspace, the legacy redirect, and the separate governance queue.
Concerns/Blockers: The repo-referenced docs validation script is missing, so automated docs validation could not be completed here.
