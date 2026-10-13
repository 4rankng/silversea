# HANDOFF — card 261013200312 (CUS tờ khai per-cont + copy)

- Controller/session: opencode session on worktree
  `/Users/dev/.paseo/worktrees/1njkloyy/feat-cus-tokhai-inline-add-edit-propagate`,
  branch `feat/cus-tokhai-inline-add-edit-propagate`. Last updated 2026-10-13.
- Goal: DONE (implementation + gates + review fixes + rung-3 drive). Branch left
  unmerged per instruction; nothing pushed, nothing deployed.

## Critical branch fact for the next agent
The worktree was created from `origin/main` (a71bf718), which was 175 commits
BEHIND the real trunk (local main `ef5ab8d0`, which contains FB-005). Before any
work, the branch was re-pointed forward to `ef5ab8d0` via `git reset --keep`
(zero own commits existed; nothing rewritten). If another paseo worktree is cut
for this repo, resolve "main" to the LOCAL main, not origin/main.

## What shipped (5 commits, ed6b77dd..04ecd74f)
Dev-lead ruling applied: số tờ khai = per-container entry. Storage is
`shipment_containers.declaration_number` (migrations 20261013210105/06 +
snapshot; backfill = lot's first entity number onto every container). Writes
ride the container-line command (gated CUS/ADMIN/MANAGER, advisory-locked
cross-lot uniqueness) plus a `copy-declaration` endpoint (fills empty siblings
only). Reads: flat row = own number; workboard cell/search/missing-bit = union
DISTINCT. FE: documents editor of `/shipments-detail` gained the field + copy
button (gated on the persisted value); saveDocuments is a dual write.
The shipment_declarations ENTITY table is deliberately unchanged.

## Explicitly out of scope / follow-ups
- Workboard quick-edit dialog still manages ENTITY rows (label-less for
  per-cont rows) — needs a product decision on its fate.
- Finance exports (debit/forwarder/worksheet) still read entity numbers only.
- Full backend `pnpm test` not run (task excluded the shared-DB suite).
- The `qa/2026-10-13_cus-tokhai-per-cont_*` artifacts are force-tracked.

## Concurrent work preserved
User's live stack (main checkout backend :3002 + ss-prod-db :5441) untouched;
all QA ran on a throwaway pgvector container (removed). In-flight branch
fix/lcl-delivery-date-label-cbm-optional files untouched (verified by review).
