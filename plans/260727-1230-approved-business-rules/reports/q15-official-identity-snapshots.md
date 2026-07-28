# Q15 official identity snapshots

## Scope

- Backend-only immutable official-identity capture for issued billing documents.
- Owned surface:
  - `shared/src/types/index.ts`
  - `shared/src/index.ts`
  - `backend/src/db/schema.ts`
  - `backend/drizzle/0156_q15_legacy_official_identity_backfill.sql`
  - `backend/src/services/billingDocument.service.ts`
  - `backend/src/services/debit-note-lifecycle.service.ts`
  - `backend/src/services/debit-note-pdf.service.ts`
  - `backend/src/tests/debitNoteTemplates.service.test.ts`
  - `backend/src/tests/q15-official-identity-snapshots.test.ts`

## Problem

- Issued debit-note and payment-statement exports were still reading live company and counterparty identity at render time.
- Existing `debit_note_template_snapshot` only froze template presentation fields; it did not preserve company bank/profile or customer/supplier identity.
- Re-exporting an already issued document after later company/customer edits could therefore drift from the issue-time legal/business identity.

## Implemented

- Added the dedicated `billing_documents.official_identity_snapshot` JSONB
  authority while retaining the nested template copy for compatible renderers.
- Captured the full issue-time issuer/counterparty/signature snapshot during debit-note transition `DRAFT -> SENT` in `debit-note-lifecycle.service.ts`.
- The issuance transaction now takes shared row locks on the company-setting and
  counterparty source rows while it captures the snapshot, preventing a
  concurrent master-data edit from splitting the legal identity.
- Migration `0156_q15_legacy_official_identity_backfill.sql` freezes the best
  authority available for older issued documents from their stored template
  plus the current company/customer/supplier master. Those records are
  explicitly labeled `LEGACY_CURRENT_MASTER_BACKFILL`; the application never
  silently presents that approximation as issue-time history.
- Added resolver/helpers in `billingDocument.service.ts` to:
  - load and preserve the nested snapshot;
  - capture live issuer + counterparty identity at issue time;
  - prioritize the dedicated frozen identity for every later render;
  - use deterministic live identity only for draft documents that have not been issued.
- Updated XLSX templated rendering so issued debit-note and payment-statement exports use frozen:
  - issuer name/address/tax code/representative;
  - counterparty name/address/tax code/representative;
  - bank account / bank name;
  - signature labels and names.
- Updated debit-note HTML/PDF rendering to use the same frozen identity source instead of live company/customer fields.

## Behavior proof

- A July debit note issued with the old company/customer identity keeps exporting the old legal identity even after those live records are edited later.
- A newly issued August debit note captures and exports the new company/customer identity.
- New issued records carry `ISSUED_AT_TRANSITION` capture metadata; legacy
  migrated records carry `LEGACY_CURRENT_MASTER_BACKFILL`.
- Payment-statement templated export now prefers persisted official identity when present instead of drifting to live app settings or live customer data.

## Boundary

- I did not invent immutable history for supplier statement export at `/ledger/suppliers/:id/statement/export`.
- That route does not currently export from a persisted issued-document object with an issue-time snapshot, so this slice only makes existing issued billing documents historically stable.

## QA

- `qa/2026-07-28_q15-official-identity-snapshots_typecheck-backend.log` — initial artifact wrapper failure (`zsh` read-only `status` variable).
- `qa/2026-07-28_q15-official-identity-snapshots_typecheck-backend.rerun.log` — pass.
- `qa/2026-07-28_q15-official-identity-snapshots_typecheck-backend.rerun2.log` — failed after later edits; missing test import surfaced.
- `qa/2026-07-28_q15-official-identity-snapshots_typecheck-backend.rerun3.log` — pass.
- `qa/2026-07-28_q15-official-identity-snapshots_backend-test.log` — initial focused renderer test failure.
- `qa/2026-07-28_q15-official-identity-snapshots_backend-test.rerun.log` — second focused renderer failure; payment-statement signatures still used live template fields.
- `qa/2026-07-28_q15-official-identity-snapshots_backend-test.rerun2.log` — focused renderer tests pass.
- `qa/2026-07-28_q15-official-identity-snapshots_backend-test.db.log` — focused DB-backed history test pass.
- `qa/2026-07-28_q15-official-identity-snapshots_lint.log` — `pnpm lint` green on errors; warnings remain pre-existing and outside this slice.

## Notes

- Exact historic issuer/counterparty data did not exist for pre-migration
  documents. The approved TingTing fallback therefore freezes current
  authoritative master data once, labels its provenance, and prevents any
  further drift.
- The controller covers migration execution, focused rerun, full backend,
  build, E2E, deployment, and visual verification.
