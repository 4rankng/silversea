# Production polish — navigation, public and configuration

Scope: local frontend only; preserve prior uncommitted work. Use real Chrome at390×844,834×1112,1440×900. Existing12px data/controls,11px labels, Be Vietnam Pro and8–12px mobile gutters remain. No financial/operational behavior or permission changes.

| Case | Steps | Expected |
|---|---|---|
| PNAV-001 | Login empty/invalid submission, password visibility, viewport resize, keyboard tab | Clear labels/errors, password state announced,44px primary action, compact mobile layout, no clipped content |
| PNAV-002 | Open/close side navigation, expand/collapse groups, navigate via keyboard, use browser Back | Current destination visible, no inert trap, focused action understandable, route titles accurate, mobile content uses space |
| PNAV-003 | Open profile/password/account controls and notifications at three widths | Consistent compact type/spacing, visible full titles and controls, cancel/Escape/focus return, no nested card decoration |
| PNAV-004 | Open configuration hub and every assigned master-data/config route; search no-match and clear, select row, open create/edit, cancel | Flat compact data layouts, consistent controls, clear empty/error/loading state and recovery; all data remains accessible |
| PNAV-005 | Unknown URL, unauthorized destination, expired/unavailable data | Useful Vietnamese state and safe route home/back; original error recovery remains actionable |
| PNAV-006 | Theme/reduced motion and keyboard focus in sidebar/topbar/config controls | Predictable focus and readable contrast, no unnecessary motion or layout shift |

Each concrete defect adds its repro and scoped regression before implementation. Report distinguishes source inspection, executed regressions and actual UI interaction. Physical Safari/iOS keyboard, every role/error permutation and production/staging deployment are not implied by local evidence.

## Concrete defects and regression expectations

- PNAV-007: `/config/company-info`, most other config routes and `/ops/wallet` display generic “Cấu hình” or “TransTing” in the topbar/document announcement. Resolve registered destination names; preserve detail-route precedence and legacy aliases.
- PNAV-008: At390px `/config` has no search control because global search is hidden; a search-empty state provides no clear action. Add a local labelled search and one-click reset, independent of global navigation search.
- PNAV-009: Failed company/fuel/salary-summary reads display “Chưa cấu hình”. Show unavailable state and an inline retry without hiding working destinations or presenting absence as a fact.
- PNAV-010: Incorrect login leaves both inputs invalid after correction; all failures including rate limits/service failures claim wrong credentials. Clear credential markers on edit, preserve useful transient-error message, prevent duplicate submits, keep label/value semantics.
- PNAV-011: Unknown authenticated URL silently redirects home. Render a compact explicit page-not-found state with safe home navigation.
## Additional verified catalogue cases

- PNAV-012: With 40 truck records, filter the configuration catalogue by its visible plate or translated status, clear a no-match search, open an edit result and cancel. Filtering must not change the full collection passed to financial/configuration calculations or editors.
- PNAV-013: A pending catalogue read shows loading; a failed read shows retry, never an empty-data invitation. A background failure retains already loaded rows and offers retry.
- PNAV-014: Configuration Field labels focus their native inputs through the shared FormGroup association. Multiple Field instances have distinct IDs and preserve explicit IDs.
- PNAV-015: After logout and a different-role login, the authenticated `/login` route replaces itself with that role's home. Genuine unknown URLs still show 404 instead of hiding broken links.
- PNAV-016: Mobile profile fields must not accumulate both per-field bottom margins and parent grid gaps. Verify the four-field sheet remains compact at 390px and the two-column layout aligns at tablet/desktop widths.
- PNAV-017: A failed notifications read shows an unavailable message and retry, without claiming there are no notifications. Retain prior notification items on background failure.
- PNAV-018: A catalogue with more than 100 records loads every page before local search/aggregates are ready. Find a record on page two. Any missing/failed page must show retry, not a silently incomplete catalogue.
