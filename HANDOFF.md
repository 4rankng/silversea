# Wave 1 form contract — UI audit 2026-10-16 (2026-10-16)

- Controller: this session (Paseo agent). Branch `ui/wave1-form-contract`,
  commits 8dc83a08 (expenses) · acc3b65b (invoice modal) · 13567cac (tires)
  · 11eed7d6 (trip detail). NOT merged/pushed/deployed — Hermes reviews.
- Goal: implement Wave 1 of `docs/ui-audit-2026-10-16.md`. Status: DONE —
  implementation, gates, per-page commits. UI NOT driven in a browser (§9
  rung ≤2; user's pass bar was scoped green + tsc 0; see report).
- Decisions (details in `plans/2026-10-16-ui-wave1-form-contract/plan.md`):
  - Shared rose marker = `.ds-field__required` + TextField.css import at each
    rendering module (bundle-verified: rule lands in the global entry CSS).
  - Expense form: one shared panel, five uppercase-divider sections; h2
    "Thông tin chung" retired; receiptId→SỐ TIỀN, note→THÔNG TIN CHUNG;
    `.expense-input` skin deleted in favor of shared `.input`.
  - Invoice modal: UUI field family at size sm; ≤640 1-col band;
    `AccountingInvoiceTrackingPage.styles.test.ts` @media pin widened to a
    closed set of two byte-exact bands (flagged for Hermes).
  - Sibling sweep beyond the audit's named file: tire-dialogs.tsx ×3 labels
    + expense-entry-sections.tsx inline marker (flagged for Hermes).
- Gates: tsc 0 · scoped vitest 13 files/88 tests green · full vitest
  642 files/4886 tests green · vite build OK · design:drift FAILS
  PRE-EXISTING at clean HEAD (baseline `340f6463` predates recent merges;
  my delta = −1 untokenized transition, 0 elsewhere; baseline NOT updated —
  owner decision). Artifacts: `qa/2026-10-16_wave1-form-contract_*`.
- Incident: macOS TCC briefly denied access to the main repo's `.git` on
  /Volumes/LexarSSD (~10:47–10:58); recovered on its own; all four commits
  landed after recovery. cua-driver screen check was started but abandoned
  (needs a Screen Recording grant); its serve process timed out unused.
- Next for Hermes: review the 4 commits; decide the design:drift baseline
  question and the invoice-modal @media pin widening; optionally order a
  rung-3 browser drive of the 4 screens at 390/768/1440 before merge.
