# Expense source remediation — 17 September 2026

Base prod 0df231ab. Local frontend7175/backend3001; no production/real money.

| Case | Reproduction | Expected |
|---|---|---|
| FIX17-S01 | OPS assignment absent/revoked; create/edit/delete/attach/remove from stale screen and API | Every write denies; same current assignment policy as receipt reads; finance proxy remains allowed. |
| FIX17-S02 | Add receipt B then remove A via OPS; reopen accountant | One attachment authority, B loads and A disappears. Confirmed photos append only; no money movement. |
| FIX17-S03 | OPS money edit without/with reason; confirmed source | Empty reason rejects, actual reason audited; confirmed entry evidence-only with correction guidance. |
| FIX17-S04 | Legacy trip expense PUT/delete native billing mirror or confirmed canonical source | Reject bypass and retain canonical amounts. |
| FIX17-S05 | Driver saved expense add later receipt; then reassigned trip | Same source supplemented, no new fee; stale driver denied with file retained. |
| FIX17-S06 | Accountant correct confirmed OPS and DRIVER toll | Immutable original retained, linked replacement and ledger reverse/re-entry atomically; recompute toll once preserving allowances. |
| FIX17-S07 | Retry/stale correction, active allocations/reconciliation/billing claim | Idempotent replacement, stale rejection; explicit dependency release required, no money fabricated or allocations silently moved. |
| FIX17-S08 | Correction/evidence360/390/820/1440 | No page overflow, compact controls, retained draft after failed API. |
| FIX17-S09 | CUS/dispatcher customer add/edit form at360/390/820/1440, touch and desktop pointer; type long names, select status, scroll to actions | Text/number inputs and select triggers share height and label spacing; touch controls44px, desktop controls compact30px; no overflow, labels remain legible and actions reachable. |
| FIX17-S10 / TC-1111 | Existing driver with trips; open History, select a future month with no history through the visible month picker; restore original month and New tab | Exact empty-period message, zero history cards, no error/loading placeholder, zero horizontal overflow at390px; original month and default tab restored, no trips deleted or changed. Must PASS/FAIL rather than skip because existing trips exist. |
