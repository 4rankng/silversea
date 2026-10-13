# Local audit handoff

- Controller/session: opencode session on worktree
  `/Users/dev/.paseo/worktrees/1njkloyy/feat-cus-tokhai-inline-add-edit-propagate`,
  branch `feat/cus-tokhai-inline-add-edit-propagate`. Last updated 2026-10-13.
- Goal: DONE (implementation + gates + review fixes + rung-3 drive). Branch left
  unmerged per instruction; nothing pushed, nothing deployed.

**Round-16 fix wave (12/10 18:44–21:16, controller session, owner directives "fix them all" + "commit, push, deploy to staging and prod"):** 4 lanes (dispatch-driver / shipments / trip-forms / accounting) drained a 13-card intake — 5 new round-16 TODO cards + 8 old-ticket verify-fails carded by controller (FB-006/007/033/038+072/048/055/057/061). Landed: fb018 `ac13e8b4` (P1: dangling customers.linked_supplier_id → 500 inside postTripCompletion rolled back every external-staff close; shared-owner null-degrade + FE error surfacing; red-first BE + UI-driven dungnv), fb082 `b377a937` (driverDeliveryDestination owns the delivery row; redundant chip removed), fb005 `c05c8b4c` ('+ Thêm tờ khai' + per-row delete never existed in-repo — implemented as new capability, role-gated, lock-disabled), fb006 `a92b986b` (magnifier's own aria-expanded tripped the menu-open reveal — selector scoped to [role=combobox][aria-expanded='true']; ClerkShipmentCreatePage styles pin realigned `ef5ab8d0` after full-FE caught the stale pin), fb007 `425a9638` (picker option phone via opt-in supportingText; blank phone renders no line), fb069 `180eafe2`+`b22ee06b` (stripDecimalTrailingZeros hydration incl. 4th post-save site; also fixed 100× money display), fb061 `b2acff8b` (fuel-invoice QA class registered children-first; staging leak itself already removed by owner's R16 cleanup — fresh-build dry-run matched=0, no purge needed; ACB 6/7 under standing KEEP ruling). NO-CHANGE verdicts with evidence: fb048 (fix 2532cfbc landed 12/10 08:56 pre-wave), fb038/072 (guards complete at HEAD incl. 35a0145b 10:05), fb057 (91374da7 contract intact, machine-verified 2 roles), fb055 (58px at HEAD 375–1440; 180px not reproducible; QA re-verify procedure in card; 320px=74px is a prior owner ruling). Independent review: 6-dimension adversarial workflow, 1 MAJOR confirmed (fb005 dialog bare input off-idiom → fixed `85ba0406`: .input class + left hint) + 4 minors fixed (fb069 4th hydration site, purge-order assertion, fb007 name-only pin, fb066 rung script landed `8a3872ff`); 1 MAJOR refuted (money 10× premise false — numeric(14,2)). Gates: root lint 0, BE tsc 0, FE tsc 0, FE full 4727/4728 → stale pin fixed → scoped 33/33; BE shared-DB `pnpm test` HANGS at debit-note-trip-claim-governance (round-13 documented open-handles) with 6 integration fails; isolated throwaway-clone rerun: 5 of those 6 PASS (interference), pre-existing isolated fails = card197 phôi (round-13 documented), expense-source-remediation PHOI-11 (id drift), expense-type-seed-policy FUEL (10/10 fuel seed vs old pin) — files untouched by wave. `make build` NOT run locally: scout-block hook string-blocked 'build'; owner directed deploy three times without opting to create .ckignore; server-side builds in make demo + make deploy both succeeded as the effective build check. Deploys: staging `make demo` first attempt failed on transient ghcr.io oauth timeout (build OK, push failed) → retry green; staging AND prod both health 200 buildHash `ef5ab8d0` = HEAD; prod safety: rollback snapshot pre-cutover-20261012T131510Z.env, DB backup db-20261012T131521Z.dump (2.34MB), migrations no-op, asset+illustration guards OK both envs. Zero prod logins. Controller local pass: fb069 committed rung RUNG PASS (trip 194), fb005 UI-driven add→API-persist→delete→pristine + input-idiom verify, fb007 phoneless live capture (qa/2026-10-12_round16-controller_*). Cards: 12 DEV_COMPLETED (fb061 closing via lane on controller evidence), FB-033 (121026185500) + FB-066 (121026141040) await owner rulings — options written in both cards; TODO otherwise empty. Vite/browser stopped; foreign backend :3002 (qa2-005 lane) untouched.


**Create-page layout wave (11/10 19:46–21:0x, controller session, card 111026195000):** owner images 5/6/7 + mock ~/Downloads/"Tạo lô hàng.html" + "use untitled PRO" + "ensure UI UX looks good in all device size". (1) Container-table record-transform threshold 1037px→620px (both @container blocks incl. the picker-reveal carve-out): mid widths (768/1000 measured: 40px table-row, header, internal h-scroll) keep the dense spreadsheet row per the owner's idea; phones keep the record card (390: grid, no header); seam invariant documented. (2) Fixed bottom action bar (mock .bar; UUI modal-foot idiom): status left + Huỷ/Tạo lô hàng right; left rides var(--app-sidebar-offset) (1440 measured: bar left = 248 = rail, never under it); inline pads follow the cutout law (bar added to mobile-edge-inset-contract cutout suite); env bottom counted once inside its opaque box; height published via useFixedActionClearance → --csc-action-bar-h (measured 59px; scroller scroll-padding 67px wired); page clearance calc(var(--csc-action-bar-h,84px)+16px) at every tier (lockstep 84px literals removed). (3) Data-flag chips (supersedes 20260922_31 plain-box ruling; ONE treatment, :has(input:checked) brand-soft). (4) Declaration list scrolls inside its panel (max-height 372px). Bar status carries count/ready only (submitError stays in the flow danger block, announced once — review F4). Consultation: UUI PRO searches (modals/banner/filter-bar families) + Tailkit a-c-tables-13/04 fetched; ids recorded in code comments + testplan case. Independent review (headless): verdict do-not-land-as-is with 1 BLOCKER (sidebar rail) + 2 MAJOR (cutout law, clearance mechanism) + 3 MINOR — ALL fixed + re-rung (rail 1440, landscape 844 bottom=0). Gates: lint 0/0, tsc 0, FE full 619/4661 ALL PASS, build OK. Rung PASS (tier + bar + rail + landscape; qa/2026-10-11_card111026195000_*). Proposed follow-ups from the mock (NOT in this wave): label-line "+ Thêm" actions, segmented Nhập/Xuất control, declarations bulk-paste.


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
