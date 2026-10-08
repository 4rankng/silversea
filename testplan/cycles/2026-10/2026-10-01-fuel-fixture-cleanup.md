# QA-AUDIT-ENV-06 — fuel approval fixtures leave no price contamination

Run q61-fuel-approval, quotation-entity and surcharge-rounding in that order,
against an isolated seeded QA database. Snapshot fuel_price_periods and approval
rows before/after. Every existing pricing assertion remains strict; all suites
finish and the owned periods plus all approvals spawned from them are removed.
In particular a run on2026-10-01 cannot leave a31000 period at2026-09-01 that
breaks the29940 quotation fixtures. Cleanup failures must fail the gate rather
than silently leave state. Re-run the complete backend gate afterward.
