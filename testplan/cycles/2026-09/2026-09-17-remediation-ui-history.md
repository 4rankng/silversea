# Expense audit remediation — UI and history

Base: prod0df231ab. Reproduce saved 17 September failures, then rerun with code fixes. No commits, deployment, approvals, offline replay or speculative cash records.

| Case | Actions | Expected |
|---|---|---|
| FIX17-UI-01 | Report OUT and historical cutoff, history/back/reload | URL preserves selections |
| FIX17-UI-02 | Direct report URL360/390px | Active tab completely visible; no page vertical jump |
| FIX17-UI-03 | OPS required plain/searchable selects and amount input at360/390/820/1440px | Left label, inline required marker, one boundary and44px touch control; shared field styles are not overridden by legacy form rules |
| FIX17-UI-04 | Dispatcher mobile filter drawers | Location buttons match44px inputs |
| FIX17-UI-05 | Freeze16Sep16:30UTC on Singapore device; quick dates/time | Vietnam16/17/18Sep, shared CUS logic; parent remains open |
| FIX17-UI-06 | Select fund then immediately tap next field during exit | Closing menu cannot select a different fund |
| FIX17-HIST-01 | OPS own reconciliation list/detail; foreignID andcashwrite | Own sources visible; foreign404; write403 |
| FIX17-HIST-02 | Filter date/name, open reconciliation sources, export | Display andexportmatch; no guessed legacy allocations |
| FIX17-HIST-03 | Recorded/reversedvoucher details | Actual allocations and reversal date/reference/reason withoutnewcash |
| FIX17-HIST-04 | Finance opens reconciliation, releases with reason, repeats request; OPS opens same history | Release is finance-only, requires reason and reversed cash first; old snapshot remains visible, no pay action on released batch, sources may be corrected and reconciled again without reusing consumed advances |
| FIX17-DSP-01 | OPS recoveryNote then dispatcher master/detail | Note retained/readable separately fromcustomer/drivernotes |

Evidence: screenshots, actual interaction logs, API and persistedreadback at360/390/820/1440. State PASS/FAIL/BLOCKED per variant; browser emulation is not physical-device certification.
| FIX17-AUTH-01 | Cold-load an authenticated route while /auth/me returns500; restore backend and click retry | Retain token and intended URL; show retryable connection error rather than login; no heartbeat, automatic retry or mutation replay |
| FIX17-QA-01 | Run full backend gate and Q01/Q02/Q07/Q08 test cleanup, then repeat | Restore settings and delete test fixtures before ending DB pool; tax-code fixture is unique per run while preserving whitespace/case normalization assertions; process exits cleanly without weakening assertions |
