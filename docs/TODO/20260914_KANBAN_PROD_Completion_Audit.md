# Kanban-PROD completion audit

[Implementation plan](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md>) · [Technical design](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Technical_Design.md>) · [Completion audit](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Completion_Audit.md>)

Reviewed source: `161a2e7098dfab3466a88b0224cb6b8e427d5b37`. Audit date: **14 September 2026**. Scope: **191 source documents**: 6 IN_PROGRESS, 57 TODO, 128 QA_PASSED. Source code and ticket statuses were not changed.

The current staging health request reported backend build `161a2e70`; this matches the source prefix only. It does not establish frontend build identity, migrations, or full product completion.

## What was read and what was verified

All **191 files** were opened and their recovered text, including appended development/QA claims, read. Extraction recovered 613,094 text characters and inventoried 399 embedded images. **31 selected images were visually inspected**, including the image-driven dispatcher and driver requirements; the other embedded images were inventoried, not all individually visually reviewed. Historical screenshots are requirements/evidence context, not current staging proof.

Two documents have packaging defects: KP-078 is plain UTF text with a .docx suffix; KP-093 contains malformed OOXML closing tags. Their text was recovered and included. These file-format problems do not prove a product bug. Full filename + SHA-256 + KP record identity prevents collisions between reused QA IDs, including QA-143.

The audit reads connected production source and relevant tests, but does not treat test definitions as successful execution. Installed dependency directories were absent; no dependency install, full application suite or schema migration was performed. No business mutation was performed in the current narrow browser pass. The codebase stayed clean at the reviewed HEAD.

### Independent verification performed

- Ran current production helper logic for dispatch note composition: character-by-character “gọi lái xe” became “gọiláixe”. This reproduces the whitespace-loss helper defect (KP-014/KP-137), not an end-to-end browser flow.
- Ran current computeTripTotals with automatic allowance 500,000: null and explicit zero both produced allowance/cost 500,000 and profit 500,000 on revenue 1,000,000. Explicit zero is incorrectly ignored (KP-157).
- Ran the repository context check: it failed because the referenced roadmap plan and qa/README.md are missing (KP-190). This is an actual check result.
- Used Chrome on current staging /config: duplicate configuration entries and the 26→25 description versus 1→month-end payroll rule were visible (KP-166/KP-167). Screenshots are linked below.
- Opened current staging /trips/19; it had no adjustment rows. Therefore historical NaN display was not freshly reproduced there; KP-145 rests on current DTO/renderer mismatch and needs an adjustment fixture.
- GET /api/health returned status ok and backend build 161a2e70 at 2026-09-14T12:05:36.823Z. Frontend and migration identities were not independently established.
- Common cited qa/ and testplan/qa/evidence roots are absent; the /Volumes/LexarSSD/projects/silversea-prod checkout is not mounted. Those closure artifacts cannot be used as current proof here.

### Audit classifications

| Classification | All records | QA_PASSED subset | Meaning |
|---|---:|---:|---|
| IMPLEMENTATION_PRESENT_UNVERIFIED | 92 | 87 | Implementation is connected in current source; current end-to-end completion is not independently established. Start with verification, not a rewrite. |
| PARTIAL | 43 | 32 | Some implementation exists, but code, scope, contract or verification coverage has a specific remaining gap. Complete only the identified gap and its acceptance cases. |
| NOT_IMPLEMENTED | 28 | 0 | The required fix/removal is absent or the current connected path still contradicts it. This does not mean the whole feature is missing. |
| OPEN_RETEST_REQUIRED | 19 | 0 | An open historical UI finding has a current entry point, but its exact rendered geometry was not freshly measured. Reproduce first; fix if still present or close with current evidence. |
| SUPERSEDED | 5 | 5 | The earlier target is superseded by the latest user decision or later requirement. Preserve applicable acceptance facts; do not implement the obsolete behavior. |
| DUPLICATE | 4 | 4 | Overlapping work is owned by the named canonical record(s); retain this source identity and verify its original scope without a duplicate implementation. |

**COMPLETION_SUPPORTED: 0 granted by this audit.** This means no record received complete fresh acceptance evidence in this planning pass; it is not an estimate of how many features work. In particular, 87 of the claimed-complete records have implementation present and should begin with verification, not reimplementation.

### Current evidence and requirement illustrations

[Executed helper probe results](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/current-source-probes.json>) · [Verification notes and limits](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/verification-notes.json>) · [Full normalized audit ledger](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/completion-ledger.json>) · [All source identities](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-inventory.json>)

![Current staging configuration duplicates and payroll rule mismatch](/Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/browser/config-duplicates.png)

*Current Chrome observation at the normal desktop viewport. This supports KP-166/KP-167 only, not a mobile/tablet or all-role pass.*

![Original dispatcher grid requirement](/Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-140-image1.png)

*Historical requirement image for KP-140: dispatcher Detailed Vehicle Plan. It is not a new staging screenshot.*

[Driver detail requirement image 1](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-191-image1.png>) · [image 2](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-191-image2.png>) · [image 3](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-191-image3.png>) · [image 4](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-191-image4.png>) · [image 5](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/selected-source-images/KP-191-image5.png>)

### Important rejected completion shortcuts

A different route is not evidence for the requested route (KP-001 truck evidence versus business units; KP-086 detailed-plan versus /ops/orders). Seeding an already allocated LCL record does not exercise real allocation (KP-032). A screenshot cannot establish ledger correctness or transactional authorization. Raising a shrink-only file-size ceiling does not complete decomposition (KP-018/KP-022). A health hash alone does not establish frontend assets or migration state. Approval-specific historical criteria must be replaced by the current direct-operation requirement.

## Source index

Every row below links to a full audit entry and its implementation work. Source statuses are reported verbatim and have not been changed.

| Record | Source status | Assessment | Package | Source file |
|---|---|---|---|---|
| [KP-001](#kp-001) | IN_PROGRESS | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_17-distinct-409-unit-update-errors.docx |
| [KP-002](#kp-002) | IN_PROGRESS | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P0_QA-143_bug-cus-delivery-date-picker-missing.docx |
| [KP-003](#kp-003) | IN_PROGRESS | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P2_QA-050_bug-keep-automatic-tire-lifecycle-dates-consistent-with-the-business-date.docx |
| [KP-004](#kp-004) | IN_PROGRESS | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260914_P2_QA-060_bug-validate-container-identifiers-before-adding-them-to-a-trip.docx |
| [KP-005](#kp-005) | IN_PROGRESS | PARTIAL | [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>) | 20260914_P2_QA-084_bug-make-the-base-salary-edit-link-open-a-usable-driver-salary-editor.docx |
| [KP-006](#kp-006) | IN_PROGRESS | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_P2_QA-085_bug-allow-unit-edits-and-deactivation-after-a-fresh-reload.docx |
| [KP-007](#kp-007) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260911_1-bug1-reassign-before-driver-accept.docx |
| [KP-008](#kp-008) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260911_1-bug2-data-as-table-hide-sidebar.docx |
| [KP-009](#kp-009) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>) | 20260911_1-bug3-dispatch-note-column.docx |
| [KP-010](#kp-010) | QA_PASSED | PARTIAL | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260911_2.docx |
| [KP-011](#kp-011) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260911_3-bug1-carrier-dropdown-missing.docx |
| [KP-012](#kp-012) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260911_3-bug2-detail-plan-show-all-containers.docx |
| [KP-013](#kp-013) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260911_3-bug3-auto-approve-shipment-edits.docx |
| [KP-014](#kp-014) | QA_PASSED | PARTIAL | [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>) | 20260911_3-bug4-task-tags-into-driver-note.docx |
| [KP-015](#kp-015) | QA_PASSED | SUPERSEDED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260911_3-bug5-driver-ui-factory-abbrev.docx |
| [KP-016](#kp-016) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260912_2-shipment-detail-unassigned-carrier.docx |
| [KP-017](#kp-017) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260912_3-trucks-carriers-link.docx |
| [KP-018](#kp-018) | QA_PASSED | PARTIAL | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260912_4-tech-followups-tracker.docx |
| [KP-019](#kp-019) | QA_PASSED | PARTIAL | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260912_5-fleet-vehicles-500-watch.docx |
| [KP-020](#kp-020) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260912_6.docx |
| [KP-021](#kp-021) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_1-dependabot-default-branch-vulnerabilities.docx |
| [KP-022](#kp-022) | QA_PASSED | PARTIAL | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_13-vitest-debt-carrier-tests-loc-ceiling.docx |
| [KP-023](#kp-023) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_2-detail-plan-tests-accumulation-trap.docx |
| [KP-024](#kp-024) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_3-missing-fk-shipment-children.docx |
| [KP-025](#kp-025) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260913_4-stale-chunk-reload.docx |
| [KP-026](#kp-026) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_5-main-prod-migration-renumber.docx |
| [KP-027](#kp-027) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_6-driver-card-view-layout.docx |
| [KP-028](#kp-028) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_7-driver-detail-add-factory-info.docx |
| [KP-029](#kp-029) | QA_PASSED | DUPLICATE | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_8-driver-card-container-type-column.docx |
| [KP-030](#kp-030) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P1_QA-004_bug-reconcile-drop-off-destinations-across-driver-trip-views.docx |
| [KP-031](#kp-031) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260913_P1_QA-010_bug-reconcile-carrier-assignment-between-customer-service-and-dispatch.docx |
| [KP-032](#kp-032) | QA_PASSED | PARTIAL | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P1_QA-019_bug-show-the-saved-lcl-delivery-date-and-provide-a-usable-dispatch-path.docx |
| [KP-033](#kp-033) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P2_QA-001_bug-preserve-appointment-minutes-in-the-detailed-dispatch-plan.docx |
| [KP-034](#kp-034) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards-staging-verified-20260914.docx |
| [KP-035](#kp-035) | QA_PASSED | DUPLICATE | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards.docx |
| [KP-036](#kp-036) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-003_bug-unify-driver-attachment-sections-and-their-visual-hierarchy.docx |
| [KP-037](#kp-037) | QA_PASSED | PARTIAL | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P2_QA-005_bug-clarify-and-align-the-driver-appointment-time.docx |
| [KP-038](#kp-038) | QA_PASSED | DUPLICATE | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-006_bug-keep-factory-identity-prominent-and-label-its-address-in-driver-details.docx |
| [KP-039](#kp-039) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260913_P2_QA-007_enhancement-improve-readability-of-secondary-dispatch-information.docx |
| [KP-040](#kp-040) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260913_P2_QA-011_enhancement-compact-dispatcher-phone-cards-and-keep-container-codes-readable.docx |
| [KP-041](#kp-041) | QA_PASSED | PARTIAL | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260913_P2_QA-012_tech-debt-complete-staging-evidence-for-remaining-frontend-regressions.docx |
| [KP-042](#kp-042) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260913_P2_QA-013_bug-allow-container-number-updates-without-triggering-the-trip-schedule-guard.docx |
| [KP-043](#kp-043) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260913_P2_QA-014_bug-refresh-reassignment-defaults-after-saving-a-new-driver-and-vehicle.docx |
| [KP-044](#kp-044) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260913_P2_QA-015_enhancement-keep-customer-service-rows-compact-with-concise-missing-data-summaries.docx |
| [KP-045](#kp-045) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260913_P2_QA-016_enhancement-show-driver-acceptance-before-offering-reassignment.docx |
| [KP-046](#kp-046) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-018_enhancement-open-driver-attachments-in-a-readable-full-image-viewer.docx |
| [KP-047](#kp-047) | QA_PASSED | PARTIAL | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260913_P2_QA-020_bug-resolve-the-linked-carrier-consistently-when-selecting-or-typing-a-plate.docx |
| [KP-048](#kp-048) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P2_QA-021_bug-use-24-hour-formatting-in-the-cus-shipment-drawer.docx |
| [KP-049](#kp-049) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P2_QA-022_bug-align-the-cus-schedule-preview-with-the-selected-time.docx |
| [KP-050](#kp-050) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-023_bug-show-the-transport-route-beneath-the-factory-on-driver-trip-cards.docx |
| [KP-051](#kp-051) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-024_bug-keep-the-container-type-visible-when-its-number-is-not-assigned.docx |
| [KP-052](#kp-052) | QA_PASSED | PARTIAL | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P2_QA-025_requirement-gap-provide-factory-invoice-information-in-driver-trip-details.docx |
| [KP-053](#kp-053) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260913_P2_QA-026_bug-save-cleared-container-appointments-in-the-cus-drawer.docx |
| [KP-054](#kp-054) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P3_QA-008_enhancement-display-container-type-once-in-the-driver-container-summary.docx |
| [KP-055](#kp-055) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260913_P3_QA-009_bug-correct-the-vietnamese-towing-capacity-label-in-truck-editing.docx |
| [KP-056](#kp-056) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260913_P3_QA-017_enhancement-use-concise-driver-instructions-when-accepting-an-order.docx |
| [KP-057](#kp-057) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260914_1-duplicate-react-key-dispatch-plan-screens.docx |
| [KP-058](#kp-058) | QA_PASSED | PARTIAL | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260914_10-driver-container-route-wiring-test.docx |
| [KP-059](#kp-059) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_11-ops-orders-route-fallback.docx |
| [KP-060](#kp-060) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_12-user-add-panel-email-validation-parity.docx |
| [KP-061](#kp-061) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260914_13-fleet-import-trailer-double-claim-guard.docx |
| [KP-062](#kp-062) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260914_14-dispatch-edit-container-count.docx |
| [KP-063](#kp-063) | QA_PASSED | PARTIAL | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260914_143_bug-hide-redundant-empty-container-return-when-equal-to-unloading-port.docx |
| [KP-064](#kp-064) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260914_15-adjustments-test-rerun-409-isolation.docx |
| [KP-065](#kp-065) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260914_16-refreeze-structure-guard-ceilings.docx |
| [KP-066](#kp-066) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_2-ledger-transport-date-edit-affordance.docx |
| [KP-067](#kp-067) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260914_3-shipments-page-test-red-on-head-popover-contract.docx |
| [KP-068](#kp-068) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260914_4-driver-detail-mobile-layout-tweaks.docx |
| [KP-069](#kp-069) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_6-ops-plan-route-fulfillment-less-fallback.docx |
| [KP-070](#kp-070) | QA_PASSED | SUPERSEDED | [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>) | 20260914_7-expense-review-buttons-stop-propagation.docx |
| [KP-071](#kp-071) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260914_8-drop-point-fallback-hardening.docx |
| [KP-072](#kp-072) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20260914_9-driver-add-path-container-validation.docx |
| [KP-073](#kp-073) | QA_PASSED | PARTIAL | [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>) | 20260914_P1_QA-030_bug-prevent-duplicate-trips-when-creation-fails.docx |
| [KP-074](#kp-074) | QA_PASSED | SUPERSEDED | [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>) | 20260914_P1_QA-086_bug-keep-expense-and-supplier-debt-pending-until-the-promised-review-is-complete.docx |
| [KP-075](#kp-075) | QA_PASSED | PARTIAL | [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>) | 20260914_P1_QA-089_bug-keep-expense-payment-status-consistent-with-its-supplier-ledger.docx |
| [KP-076](#kp-076) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>) | 20260914_P1_QA-125_bug-remove-public-access-to-protected-evidence-files.docx |
| [KP-077](#kp-077) | QA_PASSED | PARTIAL | [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>) | 20260914_P1_QA-126_bug-require-current-driver-ownership-before-deleting-trip-photos.docx |
| [KP-078](#kp-078) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data.docx |
| [KP-079](#kp-079) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P2_QA-035_bug-distinguish-zero-revenue-from-no-completed-trips.docx |
| [KP-080](#kp-080) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP18](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp18>) | 20260914_P2_QA-036_bug-open-blocked-transport-records-from-the-accounting-work-queue.docx |
| [KP-081](#kp-081) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P2_QA-037_bug-show-payable-ledger-entries-on-desktop.docx |
| [KP-082](#kp-082) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP19](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp19>) | 20260914_P2_QA-038_bug-fix-ocr-review-header-overlap-on-desktop-and-tablet.docx |
| [KP-083](#kp-083) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>) | 20260914_P2_QA-039_bug-fix-expense-creation-buttons-for-accountants.docx |
| [KP-084](#kp-084) | QA_PASSED | PARTIAL | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-040_bug-reject-negative-advance-amounts-without-changing-their-sign.docx |
| [KP-085](#kp-085) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P2_QA-042_bug-align-customer-shipment-status-across-list-and-details.docx |
| [KP-086](#kp-086) | QA_PASSED | DUPLICATE | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-045_bug-show-the-shipment-route-in-the-ops-plan.docx |
| [KP-087](#kp-087) | QA_PASSED | PARTIAL | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-047_enhancement-link-the-blocking-trip-when-driver-acceptance-is-rejected.docx |
| [KP-088](#kp-088) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P2_QA-048_bug-reconcile-fleet-trailer-totals-with-listed-trailers.docx |
| [KP-089](#kp-089) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P2_QA-049_bug-provide-the-trailer-selector-promised-by-the-fleet-assignment-flow.docx |
| [KP-090](#kp-090) | QA_PASSED | PARTIAL | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-051_bug-populate-the-ops-owner-picker-with-active-staff.docx |
| [KP-091](#kp-091) | QA_PASSED | PARTIAL | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-052_bug-keep-ops-dialogs-clear-of-the-fixed-page-header.docx |
| [KP-092](#kp-092) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>) | 20260914_P2_QA-054_bug-reconcile-the-ops-wallet-with-approved-advance-returns.docx |
| [KP-093](#kp-093) | QA_PASSED | PARTIAL | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-055_bug-restore-the-operations-owner-dialog-layout-and-button-styling.docx |
| [KP-094](#kp-094) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-057_bug-refresh-handoff-readiness-after-a-confirmed-order-exchange.docx |
| [KP-095](#kp-095) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-058_bug-show-a-valid-next-step-for-paper-handoff-on-completed-trips.docx |
| [KP-096](#kp-096) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>) | 20260914_P2_QA-059_bug-allow-configured-ops-categories-when-saving-trip-expenses.docx |
| [KP-097](#kp-097) | QA_PASSED | SUPERSEDED | [WP14](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp14>) | 20260914_P2_QA-061_bug-align-financial-policy-messages-with-approval-state.docx |
| [KP-098](#kp-098) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P2_QA-063_bug-keep-the-session-active-after-an-incorrect-current-password.docx |
| [KP-099](#kp-099) | QA_PASSED | PARTIAL | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P2_QA-065_bug-preserve-the-trip-completion-date-when-opening-the-editor.docx |
| [KP-100](#kp-100) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P2_QA-066_bug-keep-optional-generated-journey-legs-from-blocking-trip-corrections.docx |
| [KP-101](#kp-101) | QA_PASSED | PARTIAL | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_P2_QA-067_bug-align-completed-trip-corrections-with-the-promised-review-flow.docx |
| [KP-102](#kp-102) | QA_PASSED | PARTIAL | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P2_QA-068_bug-show-capital-contribution-errors-inside-the-open-form.docx |
| [KP-103](#kp-103) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP20](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp20>) | 20260914_P2_QA-069_bug-make-vehicle-ownership-setup-reachable-from-profit-distribution.docx |
| [KP-104](#kp-104) | QA_PASSED | PARTIAL | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P2_QA-070_bug-reject-malformed-company-email-before-saving-the-profile.docx |
| [KP-105](#kp-105) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P2_QA-071_bug-associate-company-form-labels-with-their-fields.docx |
| [KP-106](#kp-106) | QA_PASSED | PARTIAL | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_P2_QA-072_bug-allow-first-fuel-configuration-to-save-without-a-missing-version-loop.docx |
| [KP-107](#kp-107) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-073_bug-make-discipline-card-actions-keyboard-accessible.docx |
| [KP-108](#kp-108) | QA_PASSED | PARTIAL | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-076_enhancement-make-penalty-records-reachable-before-the-expanded-driver-ranking.docx |
| [KP-109](#kp-109) | QA_PASSED | SUPERSEDED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-077_bug-keep-pending-discipline-out-of-driver-pay.docx |
| [KP-110](#kp-110) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-078_bug-keep-driver-penalty-summaries-aligned-and-amounts-intact.docx |
| [KP-111](#kp-111) | QA_PASSED | PARTIAL | [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>) | 20260914_P2_QA-080_bug-make-attendance-day-clicks-update-an-open-payroll-draft.docx |
| [KP-112](#kp-112) | QA_PASSED | PARTIAL | [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>) | 20260914_P2_QA-081_bug-make-payroll-attendance-days-keyboard-accessible.docx |
| [KP-113](#kp-113) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-082_bug-keep-keyboard-focus-inside-the-discipline-cancellation-dialog.docx |
| [KP-114](#kp-114) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P2_QA-083_bug-exclude-cancelled-penalties-from-active-rankings-and-discipline-totals.docx |
| [KP-115](#kp-115) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>) | 20260914_P2_QA-087_bug-render-uploaded-expense-receipts-after-saving-and-reloading.docx |
| [KP-116](#kp-116) | QA_PASSED | PARTIAL | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P2_QA-093_bug-keep-financial-summary-labels-and-amounts-separate-on-phones.docx |
| [KP-117](#kp-117) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P2_QA-104_bug-prevent-statement-toolbar-actions-from-overlapping-on-tablets.docx |
| [KP-118](#kp-118) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P2_QA-107_bug-make-the-customer-delivery-confirmation-button-visible.docx |
| [KP-119](#kp-119) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P2_QA-108_bug-keep-the-customer-discrepancy-form-within-the-visible-row.docx |
| [KP-120](#kp-120) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P2_QA-121_bug-restore-contrast-for-the-expected-profit-label-in-trip-creation.docx |
| [KP-121](#kp-121) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P2_QA-132_bug-persist-clearing-of-optional-truck-text-fields.docx |
| [KP-122](#kp-122) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P2_QA-133_bug-keep-keyboard-active-options-visible-in-searchable-selectors.docx |
| [KP-123](#kp-123) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P3_QA-028_enhancement-show-a-clear-compact-title-for-each-configuration-page.docx |
| [KP-124](#kp-124) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P3_QA-033_enhancement-remove-the-internal-dashboard-version-label-from-the-main-summary.docx |
| [KP-125](#kp-125) | QA_PASSED | PARTIAL | [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>) | 20260914_P3_QA-041_enhancement-show-a-compact-status-on-every-advance-request.docx |
| [KP-126](#kp-126) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-043_enhancement-preserve-the-customer-shipment-queue-when-returning-from-details.docx |
| [KP-127](#kp-127) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-044_enhancement-make-customer-shipment-cards-easier-to-scan-on-phones.docx |
| [KP-128](#kp-128) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-046_enhancement-keep-tablet-multi-container-entry-compact.docx |
| [KP-129](#kp-129) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-056_enhancement-keep-vehicle-card-actions-compact-and-readable-on-phones.docx |
| [KP-130](#kp-130) | QA_PASSED | PARTIAL | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P3_QA-062_enhancement-localize-account-validation-beside-the-affected-fields.docx |
| [KP-131](#kp-131) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20261109_4-bug1-logout-not-working.docx |
| [KP-132](#kp-132) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20261109_4-bug2-driver-screen-missing-dispatched-order.docx |
| [KP-133](#kp-133) | QA_PASSED | IMPLEMENTATION_PRESENT_UNVERIFIED | [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>) | 20261109_4-bug4-edit-cont-button-crash-trim.docx |
| [KP-134](#kp-134) | QA_PASSED | PARTIAL | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | The UI waste lots of space-data-intensive-design.docx |
| [KP-135](#kp-135) | TODO | PARTIAL | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_18-self-healing-version-token-writes.docx |
| [KP-136](#kp-136) | TODO | NOT_IMPLEMENTED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P0_QA-144_bug-cus-delivery-date-enter-save.docx |
| [KP-137](#kp-137) | TODO | NOT_IMPLEMENTED | [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>) | 20260914_P0_QA-145_bug-dispatch-note-no-spaces.docx |
| [KP-138](#kp-138) | TODO | NOT_IMPLEMENTED | [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>) | 20260914_P0_QA-146_enhancement-remove-dispatch-date-picker.docx |
| [KP-139](#kp-139) | TODO | NOT_IMPLEMENTED | [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>) | 20260914_P0_QA-147_bug-duplicate-truck-2x20ft-dispatch.docx |
| [KP-140](#kp-140) | TODO | NOT_IMPLEMENTED | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | 20260914_P1_5-regression-lift-drop-info-missing-dispatch-detail.docx |
| [KP-141](#kp-141) | TODO | NOT_IMPLEMENTED | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_P1_QA-134_bug-reconcile-concurrent-trip-edits-before-retrying-a-version-conflict.docx |
| [KP-142](#kp-142) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P1_QA-139_enhancement-remove-offline-business-command-queues-and-retire-saved-commands.docx |
| [KP-143](#kp-143) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P1_QA-140_enhancement-require-a-live-connection-before-allowing-application-work.docx |
| [KP-144](#kp-144) | TODO | NOT_IMPLEMENTED | [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>) | 20260914_P2_QA-053_bug-enable-adding-receipts-to-saved-pending-ops-expenses.docx |
| [KP-145](#kp-145) | TODO | PARTIAL | [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>) | 20260914_P2_QA-064_bug-resolve-invalid-version-errors-when-publishing-revenue-adjustments.docx |
| [KP-146](#kp-146) | TODO | NOT_IMPLEMENTED | [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>) | 20260914_P2_QA-094_enhancement-keep-selected-payroll-details-close-to-the-driver-picker.docx |
| [KP-147](#kp-147) | TODO | PARTIAL | [WP14](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp14>) | 20260914_P2_QA-110_enhancement-remove-approval-steps-from-financial-configuration.docx |
| [KP-148](#kp-148) | TODO | PARTIAL | [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>) | 20260914_P2_QA-113_requirement-remove-approval-handoffs-from-advances-and-settlements.docx |
| [KP-149](#kp-149) | TODO | NOT_IMPLEMENTED | [WP16](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp16>) | 20260914_P2_QA-114_enhancement-remove-approval-routing-from-ops-field-expenses.docx |
| [KP-150](#kp-150) | TODO | NOT_IMPLEMENTED | [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>) | 20260914_P2_QA-115_enhancement-record-operating-expenses-without-internal-approval.docx |
| [KP-151](#kp-151) | TODO | NOT_IMPLEMENTED | [WP18](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp18>) | 20260914_P2_QA-116_enhancement-remove-internal-epod-approval-gates-from-accounting-and-billing.docx |
| [KP-152](#kp-152) | TODO | PARTIAL | [WP19](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp19>) | 20260914_P2_QA-117_enhancement-remove-internal-fuel-invoice-approval-and-approved-expense-prerequisites.docx |
| [KP-153](#kp-153) | TODO | PARTIAL | [WP20](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp20>) | 20260914_P2_QA-118_requirement-replace-profit-allocation-approval-with-direct-authorized-finalization.docx |
| [KP-154](#kp-154) | TODO | PARTIAL | [WP21](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp21>) | 20260914_P2_QA-119_enhancement-remove-the-internal-shipment-deletion-approval-request.docx |
| [KP-155](#kp-155) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P2_QA-124_bug-keep-valid-sessions-through-temporary-identity-service-failures.docx |
| [KP-156](#kp-156) | TODO | NOT_IMPLEMENTED | [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>) | 20260914_P2_QA-127_bug-enforce-ops-shipment-scope-when-serving-trip-photos.docx |
| [KP-157](#kp-157) | TODO | NOT_IMPLEMENTED | [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>) | 20260914_P2_QA-128_bug-honor-an-explicit-zero-road-allowance-override.docx |
| [KP-158](#kp-158) | TODO | NOT_IMPLEMENTED | [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>) | 20260914_P2_QA-129_bug-synchronize-actual-work-days-when-the-driver-completes-a-trip.docx |
| [KP-159](#kp-159) | TODO | NOT_IMPLEMENTED | [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>) | 20260914_P2_QA-130_bug-resolve-road-allowance-using-the-newly-selected-trailer-type.docx |
| [KP-160](#kp-160) | TODO | NOT_IMPLEMENTED | [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>) | 20260914_P2_QA-131_bug-retain-buffered-trip-photos-until-each-upload-is-confirmed.docx |
| [KP-161](#kp-161) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P2_QA-135_bug-allow-the-current-account-to-log-out-while-an-earlier-revocation-waits.docx |
| [KP-162](#kp-162) | TODO | NOT_IMPLEMENTED | [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>) | 20260914_P2_QA-137_bug-report-completed-trip-financial-edits-as-saved-without-a-false-approval-queu.docx |
| [KP-163](#kp-163) | TODO | PARTIAL | [WP23](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp23>) | 20260914_P2_QA-138_enhancement-replace-trip-credit-override-approval-requests-with-direct-authorized-except.docx |
| [KP-164](#kp-164) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P2_QA-141_enhancement-retire-the-offline-service-worker-cache-and-background-sync-with-an-upgrade.docx |
| [KP-165](#kp-165) | TODO | NOT_IMPLEMENTED | [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>) | 20260914_P2_QA-142_bug-distinguish-unavailable-route-assets-from-a-verified-new-deployment.docx |
| [KP-166](#kp-166) | TODO | NOT_IMPLEMENTED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P3_QA-027_bug-remove-duplicate-configuration-entries-from-the-settings-overview.docx |
| [KP-167](#kp-167) | TODO | NOT_IMPLEMENTED | [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>) | 20260914_P3_QA-029_bug-align-payroll-period-summary-with-the-current-default-rule.docx |
| [KP-168](#kp-168) | TODO | OPEN_RETEST_REQUIRED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-031_enhancement-make-the-mobile-trip-list-show-records-sooner.docx |
| [KP-169](#kp-169) | TODO | OPEN_RETEST_REQUIRED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-032_bug-match-container-helper-text-to-the-trip-creation-action.docx |
| [KP-170](#kp-170) | TODO | PARTIAL | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P3_QA-074_bug-explain-rejected-negative-amounts-in-discipline-rule-edits.docx |
| [KP-171](#kp-171) | TODO | NOT_IMPLEMENTED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P3_QA-075_bug-remove-the-duplicate-currency-unit-from-discipline-rankings.docx |
| [KP-172](#kp-172) | TODO | NOT_IMPLEMENTED | [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>) | 20260914_P3_QA-079_bug-describe-negative-earnings-balances-without-assuming-excess-advances.docx |
| [KP-173](#kp-173) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-088_enhancement-align-and-compact-the-expense-entry-form.docx |
| [KP-174](#kp-174) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-090_enhancement-make-customer-and-factory-directories-easier-to-scan.docx |
| [KP-175](#kp-175) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-091_enhancement-use-space-efficiently-in-the-customer-dialog.docx |
| [KP-176](#kp-176) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-092_enhancement-keep-template-column-properties-close-to-selection.docx |
| [KP-177](#kp-177) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-095_enhancement-prioritize-supplier-debt-lookup-on-the-payables-page.docx |
| [KP-178](#kp-178) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-096_enhancement-align-profit-metrics-for-compact-customer-comparison.docx |
| [KP-179](#kp-179) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-097_bug-distinguish-adjacent-currency-labels-on-financial-chart-axes.docx |
| [KP-180](#kp-180) | TODO | OPEN_RETEST_REQUIRED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-098_enhancement-show-cus-shipment-records-sooner-with-compact-filters.docx |
| [KP-181](#kp-181) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-099_enhancement-keep-the-driver-creation-footer-compact-on-phones.docx |
| [KP-182](#kp-182) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-101_enhancement-show-nonempty-accounting-queues-before-large-empty-sections.docx |
| [KP-183](#kp-183) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-102_enhancement-prioritize-account-ledgers-with-compact-debt-summaries.docx |
| [KP-184](#kp-184) | TODO | OPEN_RETEST_REQUIRED | [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>) | 20260914_P3_QA-103_enhancement-make-ops-work-queue-records-easier-to-scan.docx |
| [KP-185](#kp-185) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-106_enhancement-keep-the-company-profile-editor-and-save-action-together.docx |
| [KP-186](#kp-186) | TODO | OPEN_RETEST_REQUIRED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-109_enhancement-keep-empty-ancillary-services-below-core-trip-information.docx |
| [KP-187](#kp-187) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-111_bug-keep-fleet-trailer-identifiers-intact-at-tablet-widths.docx |
| [KP-188](#kp-188) | TODO | OPEN_RETEST_REQUIRED | [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>) | 20260914_P3_QA-112_bug-make-fleet-summary-breakdowns-readable-on-phones.docx |
| [KP-189](#kp-189) | TODO | OPEN_RETEST_REQUIRED | [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>) | 20260914_P3_QA-120_enhancement-prioritize-required-trip-fields-with-compact-estimate-and-progress-summaries.docx |
| [KP-190](#kp-190) | TODO | NOT_IMPLEMENTED | [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>) | 20260914_P3_QA-136_tech-debt-restore-the-repository-context-resolver-on-a-clean-checkout.docx |
| [KP-191](#kp-191) | TODO | PARTIAL | [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>) | P0_Mobile_Lai xe role man hinh chi tiet.docx |

## Per-file assessment

The requirement lists below retain historical context. The implementation steps and technical design apply the latest no-approval and online-only decisions wherever old criteria conflict. Evidence line anchors describe source, not claimed runtime execution. “Existing behavior” and a missing-evidence statement are deliberately distinguished.

<a id="kp-001"></a>

### KP-001 — Distinct error codes for stale version vs duplicate code on unit updates

**Source file:** [IN_PROGRESS/20260914_17-distinct-409-unit-update-errors.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_17-distinct-409-unit-update-errors.docx>)

**Source title (verbatim):** Distinct error codes for stale version vs duplicate code on unit updates

**SHA-256:** `d9949c446f4de0ff7bf3a4d862ea8f52fd1b25b9ccdc22676f30dbd2329f7b61`

**Claimed folder:** IN_PROGRESS. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 0.

**Delivery:** [KP-001](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-001>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-001.txt>).

**Requirements read:**

- Distinguish business-unit duplicate identity and stale/missing version failures through machine-readable code plus Vietnamese message; do not guess from shared HTTP 409 alone.
- Backend tests cover duplicate-code and stale-version error contracts on the actual business-unit update/deactivation endpoints.
- The frontend shows the correct Vietnamese recovery and preserves the draft in both cases.
- Audit fuel configuration for the same conflation; track that separately rather than changing fuel under this business-unit ticket.

**Existing behavior / assessment:** Business-unit stale/duplicate machine codes and token-bearing client exist. Appended QA evidence tests /api/trucks/4 rather than business units, so it does not close this contract.

**Connected current-source evidence:**

- [backend/src/routes/auth.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/auth.ts:104>) — STALE_VERSION emitted from row-version guard
- [backend/src/services/user.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/user.service.ts:203>) — DUPLICATE_CODE emitted for unit uniqueness
- [frontend/src/features/users/components/BusinessUnitsManager.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/BusinessUnitsManager.tsx:38>) — Distinct duplicate/version UI branches

**Missing, contradicted or unproven:**

- Business-unit stale/duplicate machine codes and token-bearing client exist. Appended QA evidence tests /api/trucks/4 rather than business units, so it does not close this contract.

**Target behavior / next work:**

- Keep current implementation; verify exact /auth/business-units PATCH and DELETE contracts.
- Replace truck evidence with linked business-unit requests and visible recovery.
- Cross-check the fuel configuration contract under KP-106; retain separate business-unit acceptance evidence.

**Required independent checks:**

- Duplicate code and name; genuine stale token; missing token; valid retry after explicit review; values retained.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-002"></a>

### KP-002 — CUS delivery date picker missing when editing shipment

**Source file:** [IN_PROGRESS/20260914_P0_QA-143_bug-cus-delivery-date-picker-missing.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_P0_QA-143_bug-cus-delivery-date-picker-missing.docx>)

**Source title (verbatim):** CUS delivery date picker missing when editing shipment

**SHA-256:** `d916c29a7279937e4da9eb493e54e10af90febf7e4c338bc26d6531420e2a094`

**Claimed folder:** IN_PROGRESS. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P0. **Images:** 0.

**Delivery:** [KP-002](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-002>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-002.txt>).

**Requirements read:**

- Yêu cầu: nhập liệu cus - điền ngày giờ giao hàng không thấy tab chọn ngày giờ nữa
- Tiêu chí nghiệm thu: (1) Trường ngày giờ giao hàng hiển thị date picker khi chỉnh sửa; (2) Date picker cho phép chọn ngày và giờ; (3) Regression test cho delivery date input

**Existing behavior / assessment:** CUS appointment calendar button/showPicker exists, and the parent exposes it only when editing is allowed. The missing-trigger complaint has not been proven resolved for the reported fixture.

**Connected current-source evidence:**

- [frontend/src/features/shipments/cus/CusAppointmentPopover.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusAppointmentPopover.tsx:265>) — Calendar trigger with showPicker and fallback
- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:223>) — Permission-gated appointment trigger

**Missing, contradicted or unproven:**

- CUS appointment calendar button/showPicker exists, and the parent exposes it only when editing is allowed. The missing-trigger complaint has not been proven resolved for the reported fixture.

**Target behavior / next work:**

- Use a disposable unassigned container and compare assigned/read-only state.
- Explain noneditable appointments and preserve role/assignment rules; fix only demonstrated trigger failure.

**Required independent checks:**

- Calendar, typed 24-hour time, native picker, keyboard and touch at 360/390/834/1440px; save/reload; denied state.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-003"></a>

### KP-003 — Keep automatic tire lifecycle dates consistent with the business date

**Source file:** [IN_PROGRESS/20260914_P2_QA-050_bug-keep-automatic-tire-lifecycle-dates-consistent-with-the-business-date.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_P2_QA-050_bug-keep-automatic-tire-lifecycle-dates-consistent-with-the-business-date.docx>)

**Source title (verbatim):** Keep automatic tire lifecycle dates consistent with the business date

**SHA-256:** `1114733ff50b24373128f913405be6df0d424c15088674d8caf1c1c850561389`

**Claimed folder:** IN_PROGRESS. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-003](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-003>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-003.txt>).

**Requirements read:**

- 1. Creation and same-day reinstallation display today's business date and 0 elapsed days; same-day disposal displays that date.
- 2. Values remain consistent after reload and across desktop, tablet and phone.
- 3. Cover UTC/business-date disagreement around midnight, the local day boundary and date-only round trips. Verify historical dates remain unchanged.

**Existing behavior / assessment:** New lifecycle dates use Asia/Ho_Chi_Minh; retaining the old historical disposal date is required and not proof of failure.

**Connected current-source evidence:**

- [backend/src/services/tire.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/tire.service.ts:114>) — Business-zone todayISO
- [backend/src/services/tire.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/tire.service.ts:378>) — Historical removedAt preserved; new disposalDate generated

**Missing, contradicted or unproven:**

- New lifecycle dates use Asia/Ho_Chi_Minh; retaining the old historical disposal date is required and not proof of failure.

**Target behavior / next work:**

- Verify new install/remove/dispose fixtures at the Vietnam date boundary.
- Do not rewrite historical dates to today to satisfy an erroneous QA observation.

**Required independent checks:**

- Before and after 17:00 UTC; same-day reinstallation; historical dates unchanged; staging UI and persisted new dates.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-004"></a>

### KP-004 — Validate container identifiers before adding them to a trip

**Source file:** [IN_PROGRESS/20260914_P2_QA-060_bug-validate-container-identifiers-before-adding-them-to-a-trip.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_P2_QA-060_bug-validate-container-identifiers-before-adding-them-to-a-trip.docx>)

**Source title (verbatim):** Validate container identifiers before adding them to a trip

**SHA-256:** `b98f41c0d6e8631683504abc204c06b42beb1bb1f25354dfbf71a7308ce0fef7`

**Claimed folder:** IN_PROGRESS. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-004](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-004>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-004.txt>).

**Requirements read:**

- 1. Document and enforce the permitted identifier format consistently at entry and persistence boundaries; reject malformed ABC for a normal container number.
- 2. Show accessible field feedback and preserve input for correction. Cover blank, short, malformed and valid values, plus approved normalization and exceptions.
- 3. Rejected input creates no container or cost group; valid input saves once and remains consistent after reload across phone, tablet and desktop.

**Existing behavior / assessment:** Current batch trip-container route parses the gated schema before idempotency handling. Previous claim that batch fix was absent is superseded by source.

**Connected current-source evidence:**

- [shared/src/schemas/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/schemas/index.ts:1309>) — Optional number format/checkdigit gate
- [shared/src/schemas/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/schemas/index.ts:1360>) — Batch elements use shared gate
- [backend/src/routes/trips/containers.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/trips/containers.ts:23>) — Validation before command

**Missing, contradicted or unproven:**

- Current batch trip-container route parses the gated schema before idempotency handling. Previous claim that batch fix was absent is superseded by source.

**Target behavior / next work:**

- Retest create/patch/batch/CUS/driver boundaries using independently valid identifiers.
- Confirm canonical form is persisted and explicit blank remains permitted only where intended.

**Required independent checks:**

- Invalid format or check digit; lowercase/spacing normalization; null/type-only row; valid save/reload; no write or consumed key after validation failure.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-005"></a>

### KP-005 — Make the base salary edit link open a usable driver salary editor

**Source file:** [IN_PROGRESS/20260914_P2_QA-084_bug-make-the-base-salary-edit-link-open-a-usable-driver-salary-editor.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_P2_QA-084_bug-make-the-base-salary-edit-link-open-a-usable-driver-salary-editor.docx>)

**Source title (verbatim):** Make the base salary edit link open a usable driver salary editor

**SHA-256:** `75bc124d2de548c18e93fe8666304f7474fbfd88f7881b9cf64eb7531f3a0b1e`

**Claimed folder:** IN_PROGRESS. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-005](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-005>) in [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-005.txt>).

**Requirements read:**

- 1. Open an actual salary workflow with the correct driver selected and explicit role permissions.
- 2. Validate amount/effective date and explain period restrictions; preserve historical and locked payroll according to policy.
- 3. After saving, reload the relevant profile/payroll to verify the effective value; retain payment limits.
- 4. Verify desktop, tablet and phone, including cancel and return to the selected payroll record.

**Existing behavior / assessment:** In-context salary modal and version token exist, but it writes a mutable baseSalary with no effective-date input/history, contrary to AC2.

**Connected current-source evidence:**

- [frontend/src/features/salary-attendance/base-salary-edit-modal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/base-salary-edit-modal.tsx:81>) — Loads current row version then PUTs baseSalary
- [frontend/src/features/salary-attendance/base-salary-edit-modal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/base-salary-edit-modal.tsx:153>) — Next-computation copy does not implement effective-date rule

**Missing, contradicted or unproven:**

- In-context salary modal and version token exist, but it writes a mutable baseSalary with no effective-date input/history, contrary to AC2.

**Target behavior / next work:**

- Introduce effective-dated base-salary versions under existing driver permissions.
- Show selected driver, effective date and period effect; preserve locked payroll snapshots.
- Use a reviewed current-value conflict comparison rather than token-only refresh.

**Required independent checks:**

- Effective-date before/inside/after open period; closed period unchanged; valid/zero/negative input; concurrent change; summary reload at three widths.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-006"></a>

### KP-006 — Allow unit edits and deactivation after a fresh reload

**Source file:** [IN_PROGRESS/20260914_P2_QA-085_bug-allow-unit-edits-and-deactivation-after-a-fresh-reload.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/IN_PROGRESS/20260914_P2_QA-085_bug-allow-unit-edits-and-deactivation-after-a-fresh-reload.docx>)

**Source title (verbatim):** Allow unit edits and deactivation after a fresh reload

**SHA-256:** `7a7160d5b59da2eac6599d572356891c23cbd96b102a2a0de4ff352c5d82e89c`

**Claimed folder:** IN_PROGRESS. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-006](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-006>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-006.txt>).

**Requirements read:**

- 1. Verify create → rename → deactivate → reactivate, including fresh reload before each update and persisted readback.
- 2. A genuine conflict must provide useful recovery; reloading must not return to an unrecoverable missing-version loop.
- 3. Keep duplicate-code validation and role permissions; preserve history and existing links when deactivating.
- 4. Reflect active status in new unit selections and verify controls/feedback on desktop, tablet and phone.

**Existing behavior / assessment:** Create/rename/deactivate/reactivate pass loaded updatedAt; source cannot prove claimed complete staging lifecycle.

**Connected current-source evidence:**

- [frontend/src/features/users/components/BusinessUnitsManager.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/BusinessUnitsManager.tsx:34>) — Version lookup
- [frontend/src/features/users/components/BusinessUnitsManager.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/BusinessUnitsManager.tsx:83>) — Deactivate with loaded token
- [frontend/src/api/userClient.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/api/userClient.ts:33>) — Canonical business-unit API path

**Missing, contradicted or unproven:**

- Create/rename/deactivate/reactivate pass loaded updatedAt; source cannot prove claimed complete staging lifecycle.

**Target behavior / next work:**

- Verify complete lifecycle, including reactivate, and legacy linked users.
- Preserve drafts and make latest-versus-local unit values visible on conflict.

**Required independent checks:**

- Create → rename → deactivate → reactivate → reload, inactive excluded from new selection but retained existing assignment, duplicate/stale errors.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-007"></a>

### KP-007 — Reassign a trip before driver acceptance

**Source file:** [QA_PASSED/20260911_1-bug1-reassign-before-driver-accept.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_1-bug1-reassign-before-driver-accept.docx>)

**Source title (verbatim):** Nguồn: 20260911_1.docx — BUG 1

**SHA-256:** `3af0a6307f0ad22d1e04b03e2418fa674886918fc75d2e7e58eaac06787d267b`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 5.

**Delivery:** [KP-007](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-007>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-007.txt>).

**Requirements read:**

- Permit reassignment of an issued/in-transit trip before the driver records ORDER_RECEIVED; preserve the acceptance and terminal-state limits.
- Persist the new carrier/truck/driver and dependent trailer consistently; show the new assignment in dispatch and driver views.
- Verify the pre-acceptance success path, post-acceptance rejection and resource combinations using a current build.

**Connected current-source evidence:**

- [backend/src/services/trip-lifecycle-ops.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-lifecycle-ops.service.ts:108>) — Reassignment runs in a transaction, locks the trip, checks expectedVersion, permits IN_TRANSIT without acknowledgement, resolves the selected truck’s trailer and writes the carrier sidecar.
- [backend/src/services/trip-queries.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-queries.service.ts:513>) — Trip detail exposes driverAccepted from ORDER_RECEIVED events.
- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx:73>) — Editor mirrors the IN_TRANSIT + acknowledgement lock and submits expectedVersion.

**Missing, contradicted or unproven:**

- The cited dev/API report is missing; its stated 33/33 tests and staging/deploy results are not current evidence.
- The document explicitly left simultaneous truck/trailer/driver changes blocked by fixture availability. No fresh multi-role readback was performed.
- CREATED with a historical acknowledgement is deliberately permitted by current guard; ordinary driver acceptance transitions to IN_TRANSIT. Recovery/legacy semantics still need an explicit regression case.

**Target behavior / next work:**

- Retain the direct operational reassignment path and terminal/resource/version validation; do not add internal approval.
- Run one clean OWN-to-OWN and OWN-to-EXTERNAL reassignment before acceptance, with a truck whose attached trailer differs; compare all dependent fields and both driver ownership views.
- After acceptance, verify the same action is unavailable and a concurrent stale submission is rejected. Link cache freshness verification to KP-043.

**Required independent checks:**

- Current backend reassignment integration cases with acknowledged/unacknowledged/terminal trips.
- Browser dispatch → new driver readback and simultaneous resource reassignment.

**Closure-claim review:** The appendix claims local success but expressly defers a resource-combination case and deployment; it cannot support full current completion.

<a id="kp-008"></a>

### KP-008 — Responsive dispatcher table and interaction density

**Source file:** [QA_PASSED/20260911_1-bug2-data-as-table-hide-sidebar.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_1-bug2-data-as-table-hide-sidebar.docx>)

**Source title (verbatim):** Nguồn: 20260911_1.docx — BUG 2

**SHA-256:** `b4c0429b42332ce6b265b1a957e44681f51362e78d8dcfd3bcff49649477d708`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 4.

**Delivery:** [KP-008](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-008>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-008.txt>).

**Requirements read:**

- Keep the detailed dispatch plan as a table on adequate desktop space.
- Below 1440px, yield the sidebar to its icon rail first; use labelled cards only when the plan container is at most 900px.
- Preserve usable navigation, actions and data at desktop, tablet and phone widths.

**Connected current-source evidence:**

- [frontend/src/lib/dispatch-sidebar-policy.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/dispatch-sidebar-policy.ts:16>) — Page-scoped policy closes the sidebar on /dispatch-detail entry below 1440px.
- [frontend/src/components/Layout.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/Layout.tsx:470>) — Layout calls the dispatch sidebar policy.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:780>) — A 900px container query converts the plan table into labelled cards.

**Missing, contradicted or unproven:**

- Historical 1600/1280/820 screenshots and 36/36 test log are absent.
- No current viewport sweep, sidebar reopen/resize transition, focus or touch check was performed; code breakpoints alone do not prove rendered geometry.

**Target behavior / next work:**

- Keep the table/rail/card progression; verify actual content-container widths around 900px and viewport widths around 1440px.
- Exercise entry, resize, manual sidebar reopen and route changes with long operational values; fix only observed overflow or lost actions.

**Required independent checks:**

- Boundary cases at 899/900/901 container pixels and 1439/1440 viewport pixels.
- Settled screenshots and keyboard navigation at phone/tablet/desktop.

**Closure-claim review:** The document reports three dev widths but explicitly lacks an interval sweep and deployment verification. Current connected CSS/policy supports the intended pattern.

<a id="kp-009"></a>

### KP-009 — Dispatch task tags and notes

**Source file:** [QA_PASSED/20260911_1-bug3-dispatch-note-column.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_1-bug3-dispatch-note-column.docx>)

**Source title (verbatim):** Nguồn: 20260911_1.docx — BUG 3

**SHA-256:** `b12776294aeaf26f167ff85cb68956904703106b40d208d8e25a244eaae4e9ce`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 4.

**Delivery:** [KP-009](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-009>) in [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-009.txt>).

**Requirements read:**

- Place labelled Phát lệnh / Hoàn thành actions in the notes column.
- Clamp long notes compactly while providing the full content on demand.
- Keep enough note/action width and verify both actions execute their intended flow.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:221>) — Computes the mutually exclusive labelled issue/complete action and renders it under the notes in the same cell.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:341>) — Notes are disclosure buttons that populate the full-text modal.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:487>) — Notes column receives 23%; note text is clamped to three lines at line627.

**Missing, contradicted or unproven:**

- The appendix explicitly says the issue and complete buttons were not clicked; screenshots do not close those action requirements.
- No current long-note, modal keyboard or responsive action execution evidence is available.

**Target behavior / next work:**

- Verify labelled actions with one eligible internal issue and one eligible external completion record, including resulting state and reload.
- Review long notes in collapsed/full states with keyboard and touch; retain compact table sizing.
- Fix manual note entry under KP-014/KP-137 before using a long typed note as the acceptance fixture.

**Required independent checks:**

- Issue/complete eligibility and mutation result tests.
- Long multiline note disclosure, Escape/focus return, and narrow-width actions.

**Closure-claim review:** Historical layout evidence supports intent only; the original report’s unclicked action paths remain unproven.

<a id="kp-010"></a>

### KP-010 — Driver summary and detail field hierarchy

**Source file:** [QA_PASSED/20260911_2.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_2.docx>)

**Source title (verbatim):** BUG 1

**SHA-256:** `c75952a1d562384c6359d97dd0512b7c1d26fa494dac28d81d527462d07a001c`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 5.

**Delivery:** [KP-010](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-010>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-010.txt>).

**Requirements read:**

- BUG1: compact, independently collapsible driver details with factory identity, address, warehouse phone and invoice information; remove unnecessary tractor/trailer repetition.
- BUG2 and wireframe: ordered summary card with factory abbreviation, route, container/type/operation, ports, task note and detail link.
- Add a delivery-report photo alongside container and seal photos, retaining a usable detail workflow.
- Embedded detail wireframe permits a route-led task header; do not claim that this original image alone requires factory-first detail header.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:69>) — Independent info/invoice collapse state and factory/contact/invoice facts are implemented.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:115>) — Summary card implements factory, route, container/type/operation, ports and task notes.
- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:420>) — Container, seal and delivery-note slots share one attachment card.

**Missing, contradicted or unproven:**

- The QA appendix addresses BUG1 collapsible sections only, while this document contains multiple bugs/features.
- The historical image is absent and the complete summary/detail/photo flow has no current build evidence.
- The final design contract must be reconciled with later driver layout/contact/empty-return requirements; do not treat the old wireframe’s exact ordering as the sole authority.

**Target behavior / next work:**

- Split closure tracking by BUG1, BUG2 and photo feature while retaining this original record as the umbrella.
- Use KP-027/KP-028/KP-036/KP-046 and the latest driver requirements as the consolidated implementation/verification package.
- Verify all subrequirements on one linked trip across summary, details, collapsed states and persisted attachments; do not close the umbrella from collapse-only evidence.

**Required independent checks:**

- Three-width driver card/detail states; empty and populated factory/invoice values.
- Upload/view/delete/reload for all three attachment types and device camera checks.

**Closure-claim review:** The QA-passed label overstates its own appendix, which describes only BUG1 collapse validation.

<a id="kp-011"></a>

### KP-011 — Carrier catalog consistency

**Source file:** [QA_PASSED/20260911_3-bug1-carrier-dropdown-missing.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_3-bug1-carrier-dropdown-missing.docx>)

**Source title (verbatim):** Nguồn: 20260911_3.docx — BUG 1

**SHA-256:** `8aa3b5412349eabaf73d7b293e8ac54dc67446bdc500842e35bf55b0f01abe56`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-011](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-011>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-011.txt>).

**Requirements read:**

- A carrier created inline from the CUS shipment workflow must immediately appear in carrier selectors without reload.
- Create it as an active carrier, not an ordinary customer, and refresh relevant catalog data.
- Preserve ordinary customer exclusion from carrier-only options.

**Connected current-source evidence:**

- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:134>) — Inline carrier resolution rejects an inactive/non-carrier name collision and creates ACTIVE + isCarrier=true rows.
- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:69>) — CUS draft sends newExternalCarrier name and plate.
- [frontend/src/features/shipments/create/CustomerCreateDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/create/CustomerCreateDialog.tsx:75>) — General intake customer creation invalidates the shared catalog query; carrier-specific creation is a separate branch.

**Missing, contradicted or unproven:**

- Cited live dropdown report and FE/BE test logs are absent.
- Current same-session visibility across CUS, detailed plan and reassignment selectors has not been checked.
- General customer creation does not itself mark isCarrier; tests must exercise the actual inline carrier entry point.

**Target behavior / next work:**

- Use the actual CUS new-carrier action; read back ACTIVE/isCarrier and immediate selected value after the save.
- Open each consuming selector in the same session and verify the new carrier appears once, without reload.
- Check duplicate and inactive-name collisions retain an actionable error; do not route identity creation through approval.

**Required independent checks:**

- Inline carrier create → catalog invalidation → selector tests.
- Ordinary customer exclusion and inactive/duplicate carrier cases.

**Closure-claim review:** The source contains the specific active-carrier path. Historical completion logs are unavailable, so no current dropdown or deployment pass is claimed.

<a id="kp-012"></a>

### KP-012 — Intake of unassigned shipments

**Source file:** [QA_PASSED/20260911_3-bug2-detail-plan-show-all-containers.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_3-bug2-detail-plan-show-all-containers.docx>)

**Source title (verbatim):** Nguồn: 20260911_3.docx — BUG 2

**SHA-256:** `04835e86b702fa7706362947447259aeb8e55c9bd4e3a4ba1862920d6cc0deb0`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-012](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-012>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-012.txt>).

**Requirements read:**

- Show every selected-day container, including carrier-less fulfillments.
- Permit selecting or changing carrier and plate directly in the detailed plan.
- Persist and reflect the assignment, preserving unrelated rows and fixture-independent tests.

**Connected current-source evidence:**

- [backend/src/services/dispatch-planning-detail-plan.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-detail-plan.service.ts:250>) — Detailed-plan filters explicitly include null plannedCarrierType.
- [frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx:215>) — Atomic row editor submits carrier, vehicle and estimates together.
- [backend/src/tests/dispatch-detail-plan.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/dispatch-detail-plan.test.ts:525>) — Integration test defines carrier-less selected-day rows, assigns an external carrier through the endpoint and rereads the plan.

**Missing, contradicted or unproven:**

- The cited carrier-null MEDU fixture screenshots and test results are missing.
- No current browser assignment/readback or populated-database query run was performed.
- Fulfillment-less branch rows and LCL identities need their separate positive-path verification, not extrapolation from FCL tests.

**Target behavior / next work:**

- Run the existing endpoint test in an isolated or run-scoped dataset.
- Verify carrier-null FCL visibility and direct OWN/EXTERNAL assignment/change at all supported widths.
- Include undecomposed FCL recovery and LCL allocation as distinct fixtures, preserving actual business validation.

**Required independent checks:**

- Carrier-null FCL list and assignment regression.
- Full reload and cross-view readback; separate LCL acceptance under KP-032.

**Closure-claim review:** The implementation and a meaningful API test definition exist. The historical 81-test closure is not proof of the current HEAD.

<a id="kp-013"></a>

### KP-013 — CUS container corrections without approval

**Source file:** [QA_PASSED/20260911_3-bug3-auto-approve-shipment-edits.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_3-bug3-auto-approve-shipment-edits.docx>)

**Source title (verbatim):** Nguồn: 20260911_3.docx — BUG 3

**SHA-256:** `d1db3d39485c3df66871ed30fcd14a703dcf910dcfdd2f7d531eea8e75eac8c4`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-013](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-013>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-013.txt>).

**Requirements read:**

- After saving an intake row with no container number, permit later number completion directly.
- Do not require approval, create a change request or park the update in a pending queue.
- Persist the exact valid value and preserve relevant operational/terminal guards.

**Connected current-source evidence:**

- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:349>) — Guard compares actual operational changes rather than presence of echoed fields; container identity is excluded.
- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:386>) — Comment and connected direct write path keep approval routing parked.
- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:397>) — Normalizes and validates a changed container number, rejects in-lot duplicates and updates inside the transaction.

**Missing, contradicted or unproven:**

- No current UI save/reload or request-count readback; cited successful fixture and logs are absent.
- The old phrase “auto-approve” must not be interpreted as retaining an approval subsystem. The current user decision is direct authorized edits with no internal approval.

**Target behavior / next work:**

- Retain direct completion of missing identity with format/duplicate/permission/version checks.
- Run the ordinary CUS form on unassigned and assigned nonterminal rows, including unchanged echoed weight/type fields.
- Verify terminal rows reject invalid corrections and no internal request/pending state is created.

**Required independent checks:**

- CUS number-only update integration and UI readback.
- No approval artifacts, duplicate number, invalid number and terminal guards.

**Closure-claim review:** The requested direct path is present. The historical “auto-approve” title is superseded terminology, not a requirement to rebuild approval.

<a id="kp-014"></a>

### KP-014 — Preserve spaces while typing dispatch notes

**Source file:** [QA_PASSED/20260911_3-bug4-task-tags-into-driver-note.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_3-bug4-task-tags-into-driver-note.docx>)

**Source title (verbatim):** Nguồn: 20260911_3.docx — BUG 4

**SHA-256:** `9fb0e82490e58a02190cc0c48e0969fee398cdd0d567ae7025c1b7b7090b9de4`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 5.

**Delivery:** [KP-014](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-014>) in [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-014.txt>).

**Requirements read:**

- Provide the canonical operational task tags in create/edit dispatch flows.
- Remove the dedicated task column and store tags first, then manual text as a separate note portion.
- Drivers must see selected tags and freely typed manual instructions intact.

**Connected current-source evidence:**

- [shared/src/driverTaskNote.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/driverTaskNote.ts:16>) — Composer joins tags with semicolons then manual text, but trims manualText at line24.
- [frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx:42>) — Controlled editor reparses its parent value each render; setManual at51 immediately recomposes and emits it.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:182>) — Driver card renders parsed tag chips and manual text separately.
- [backend/src/tests/dispatch-detail-plan.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/dispatch-detail-plan.test.ts:2290>) — Regression source enumerates the 14 canonical requested operation labels.

**Missing, contradicted or unproven:**

- Current typing path strips trailing spaces on every keystroke: typing a word, space, next word loses the separator. Whole-sentence paste tests do not prove ordinary typing.
- Canonical pool and driver readback are implemented, but current rendered/create-edit/save evidence is absent.
- This is the same underlying defect root independently traced for KP-137; keep one implementation package.

**Target behavior / next work:**

- Keep a raw manual-text draft while the user types; normalize only on explicit save or deliberate composition boundary.
- Preserve selected tags independently from manual draft state, including newline, leading/trailing editing spaces and cursor position.
- Save and reopen the final two-part note and confirm the driver sees the intended text. Retain direct online save and ordinary validation.

**Required independent checks:**

- Character-by-character input including space/newline, tag toggle mid-draft and Vietnamese input composition.
- Paste, reopen/save identity, tag rename and driver note readback.

**Closure-claim review:** Tag vocabulary and stored format are present, but the current controlled-input chain contradicts the claimed usable free-text entry. Source defect; no browser reproduction claimed here.

<a id="kp-015"></a>

### KP-015 — Reconcile superseded driver layout with latest requirements

**Source file:** [QA_PASSED/20260911_3-bug5-driver-ui-factory-abbrev.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260911_3-bug5-driver-ui-factory-abbrev.docx>)

**Source title (verbatim):** Nguồn: 20260911_3.docx — BUG 5

**SHA-256:** `3b39902743d2fb39f1eb00674b48b3125c337748f0ab58981ce72128e826b48e`

**Claimed folder:** QA_PASSED. **Audit:** SUPERSEDED. **Source priority:** Not stated. **Images:** 2.

**Delivery:** [KP-015](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-015>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-015.txt>).

**Canonical records:** [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-191>). No duplicate engineering implementation.

**Requirements read:**

- Use a factory abbreviation with full-name fallback prominently in driver details.
- Original layout requested factory → container → lift/drop → route → warehouse phone → plan/contact order.
- Do not lose route, contact or operational data while making the view compact.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:10>) — Current component explicitly follows the later wireframe: plan/factory, full name, address, contact phone, container, ports, route and contacts.
- [frontend/src/pages/driver/DriverTripHeader.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTripHeader.tsx:28>) — Stable header identity prefers factory short name, then full name, then route fallback.
- [docs/driver-trip-detail-design-spec.md](</Users/frank.nguyen/Documents/silversea/codebase/docs/driver-trip-detail-design-spec.md:28>) — Later shared driver-detail design contract specifies compact sections and independently collapsible information.

**Missing, contradicted or unproven:**

- The exact older row order is not the current layout contract; later KP-028/KP-038 and the newest driver consolidation requirements must govern.
- The shared factory fallback/content requirements remain applicable but still need current device verification.
- Historical 33-test/dev screenshots do not prove current visual completion.

**Target behavior / next work:**

- Retain this record as a historical source; map its factory identity/content requirements into the latest consolidated driver-detail package.
- Do not reintroduce an obsolete exact row order in parallel with newer full-name/address/contact requirements.
- Verify no required data is lost after the latest layout is implemented.

**Required independent checks:**

- Factory short/full/missing fallback tests and final three-width driver layout.
- Content parity with current detail API.

**Closure-claim review:** The appendix itself acknowledges ordering interpretation; current code follows a later explicit wireframe. This record should not generate a conflicting layout implementation.

<a id="kp-016"></a>

### KP-016 — Unassigned carrier projection in shipment details

**Source file:** [QA_PASSED/20260912_2-shipment-detail-unassigned-carrier.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260912_2-shipment-detail-unassigned-carrier.docx>)

**Source title (verbatim):** BUG: Chi tiết lô hàng CHƯA phân nhà xe không hiển thị đúng ở màn hình chi tiết

**SHA-256:** `328d0832dac6af425c882def48fed26ec22352952322c4b137eba6608b734641`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-016](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-016>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-016.txt>).

**Requirements read:**

- Always show a carrier section in shipment detail, including a clear unassigned state.
- Do not discard 45HC or container-less LCL assignments because they do not fit the 20/40 quantity buckets.
- Allow ready unassigned records to proceed into dispatch.

**Connected current-source evidence:**

- [frontend/src/features/shipments/detail/shipment-detail-view.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/shipment-detail-view.ts:21>) — Carrier grouping is performed before size buckets; unknown/45HC and container-less assignments are retained.
- [frontend/src/pages/ShipmentDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ShipmentDetailPage.tsx:211>) — Carrier summary is rendered with a stable section and explicit Chưa phân nhà xe empty label.
- [backend/src/tests/cus-shipment-workspace.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/cus-shipment-workspace.test.ts:2322>) — Defines LCL carrier summary/readiness after seeding an allocated lot-level fulfillment.

**Missing, contradicted or unproven:**

- Current 45HC/FCL/LCL detail screenshots and API readback are unverified.
- The LCL test seeds assignment rather than proving the UI/API allocation action; that remaining operational path belongs to KP-032.
- Missing historical report cannot substantiate deployment.

**Target behavior / next work:**

- Verify unassigned FCL and assigned 20/40/45HC/LCL summaries from actual saved records.
- Preserve grouping by carrier before quantity classification; keep quantity totals separately interpretable.
- Use the positive LCL allocation verification in KP-032 to prove reachability.

**Required independent checks:**

- Carrier summary tests for 45HC, unknown type and container-less LCL.
- Saved assignment → shipment detail and dispatch readback.

**Closure-claim review:** The grouping and explicit empty state are present. The historical closure is source-supported in intent but not currently exercised.

<a id="kp-017"></a>

### KP-017 — Truck-to-carrier linking

**Source file:** [QA_PASSED/20260912_3-trucks-carriers-link.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260912_3-trucks-carriers-link.docx>)

**Source title (verbatim):** FEATURE: Liên kết biển số xe ↔ nhà xe (trucks ↔ carriers)

**SHA-256:** `d6a078f882a54a48f2f40f3bf6eee5b491a3c39566d04a3f28fae4574e13d583`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 4.

**Delivery:** [KP-017](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-017>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-017.txt>).

**Requirements read:**

- Link or clear a truck’s carrier in the fleet catalog; only active carrier customers are valid.
- Filter trucks by carrier with coherent pagination/counts.
- Resolve equivalent normalized plates consistently and reflect changed links.

**Connected current-source evidence:**

- [backend/src/routes/config/catalog-crud.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/config/catalog-crud.routes.ts:321>) — Active/nondeleted/isCarrier validation is applied to truck create and update; carrierId is an equality filter at342.
- [backend/src/services/carrier-fleet-vehicle.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/carrier-fleet-vehicle.service.ts:64>) — Plate resolution falls back to active truck-carrier links using punctuation-insensitive comparison.
- [frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx:116>) — Fleet view has a client-side carrier filter; the nearby comment still describes a server filter as future although the route now supports it.
- [backend/src/tests/truck-carrier-link.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/truck-carrier-link.test.ts:1>) — Dedicated integration regression source exists for the link contract.

**Missing, contradicted or unproven:**

- Current fleet edit, pagination/filter count and cross-view readback were not run.
- The lookup consumer has a separate stale asynchronous result gap in KP-047; link storage alone does not prove autocomplete correctness.
- The old client-side-filter comment is stale and should be corrected when aligning the list query contract.

**Target behavior / next work:**

- Verify assign/change/clear with active, inactive and non-carrier targets, including saved fleet filter results.
- Use server-side filtering consistently if the fleet dataset is paginated; ensure totals are from the same filter contract.
- Retest both selected and typed plate consumers under KP-047 after changing a link.

**Required independent checks:**

- Truck carrier CRUD/filter integration with more than one page.
- Normalized plate lookup plus inactive/deleted carrier rejection.

**Closure-claim review:** Catalog support is connected in current source. Historical CRUD/lookup success is unavailable; later QA020 shows why catalog success is not sufficient.

<a id="kp-018"></a>

### KP-018 — Tracker decomposition and residual visual/release gaps

**Source file:** [QA_PASSED/20260912_4-tech-followups-tracker.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260912_4-tech-followups-tracker.docx>)

**Source title (verbatim):** still have bugs and also the Ui bottom of the screen has a gap, it shouldnt

**SHA-256:** `dfafefb1a264bffc71ecdd6ec951726b043ad09d77c6617db924a3022e26dc9b`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 7.

**Delivery:** [KP-018](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-018>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-018.txt>).

**Requirements read:**

- Resolve the original bottom-screen gap and mobile pages briefly rendering script text.
- Tracker items include photo-delete version simplification, build hash in health/footer, style-test timeout, controlled cleanup, driver/date-filter clickthrough and repinned permissions.
- Retain LOC ratchets, deploy asset checks, terminal guards, reassignment cache freshness, LCL carrier summaries, orphan prevention, migration/repository maintenance and trailer-fit guidance.
- Any historical cleanup/deployment task requires its own retained execution evidence, not a blanket code pass.

**Connected current-source evidence:**

- [backend/src/routes/forwarder/photos.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/forwarder/photos.ts:165>) — Photo-delete route passes no version precondition; the command retains ownership and mutable-trip checks.
- [backend/src/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/index.ts:163>) — Health endpoint exposes BUILD_HASH; current frontend source search found no health/buildHash footer consumer.
- [frontend/src/styles/workboard-standard.styles.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/styles/workboard-standard.styles.test.ts:70>) — Style guard has a 15000ms test timeout.
- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:155>) — useDispatchDetailPlan ceiling is now 533, whereas this tracker committed to returning it to 515.
- [scripts/frontend-asset-guard.sh](</Users/frank.nguyen/Documents/silversea/codebase/scripts/frontend-asset-guard.sh:19>) — Post-cutover guard checks every entry-page asset reference exists; Makefile wires it into deploy targets.
- [frontend/src/features/dispatch/detailed-plan/trailerFit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/trailerFit.ts:8>) — Trailer fit label/rank helpers distinguish compatible, unknown and provably incompatible options.

**Missing, contradicted or unproven:**

- Original bottom gap and script-text flash are not specifically closed by the tracker’s completion appendix and have no current reproduction/verification.
- Backend buildHash exists, but the requested frontend footer exposure was not found in current source.
- The 515-line hook ratchet regressed to 533 and its ceiling was raised; approval of that revised limit is not evidence that the original shrink-only requirement passed.
- Historical DB cleanup, object-store repair, deployment and clickthrough reports are absent. No present-day cleanup should be repeated from old IDs alone.
- Tracker migration/trunk history conflicts with later KP-026; resolve with current branch policy rather than re-running historical merges.

**Target behavior / next work:**

- Break the tracker into independently closable rows and explicitly link its original two visual complaints to current evidence or remaining work.
- Expose the current build identifier in a compact support surface if still desired; verify it agrees with the running backend rather than a static label.
- Extract the hook’s additional logic to meet the promised 515 ceiling, or document a separately authorized replacement architecture target; do not quietly count refreezing as shrink-only completion.
- Carry existing photo, terminal, trailer and asset guards forward; use KP-024/KP-026/KP-043 for their focused verification. Audit historical operations from retained records before deciding any new cleanup.

**Required independent checks:**

- Fresh phone/desktop load and footer-gap capture with current build ID.
- Photo deletion ownership/terminal/idempotency cases; style and structure guard run.
- Deploy asset negative fixture; archive verification for cleanup/merge claims.

**Closure-claim review:** The QA-passed summary claims all items1–9, yet the original visual complaints, frontend build identity and original hook ratchet are not closed by current evidence.

<a id="kp-019"></a>

### KP-019 — Internal-truck catalog loading and 24-hour stability

**Source file:** [QA_PASSED/20260912_5-fleet-vehicles-500-watch.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260912_5-fleet-vehicles-500-watch.docx>)

**Source title (verbatim):** BUG: Điều vận không tải được danh mục Xe nội bộ (Không thể tải dữ liệu)

**SHA-256:** `64975c4367aa361b0d80ef42472372e060a2d3ccda5d0d30682397d3a5ad12d3`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 1.

**Delivery:** [KP-019](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-019>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-019.txt>).

**Requirements read:**

- Make the internal vehicle catalog load reliably for Dispatcher.
- Observe a full 24-hour period with hourly checks and no unexpected 5xx outside a documented cutover window.
- Retain build, time, response/log evidence so a transient deploy error is distinguishable from a regression.

**Connected current-source evidence:**

- [backend/src/routes/config/catalog-crud.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/config/catalog-crud.routes.ts:340>) — The truck catalog route exists and has validated CRUD/list handling.
- [frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx:1>) — Connected internal vehicle catalog view is present.
- [backend/src/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/index.ts:163>) — Health buildHash can identify the observed backend version.

**Missing, contradicted or unproven:**

- A code review cannot establish 24-hour uptime. No current hourly monitor or logs were executed/read.
- The historical note describes a later log observation around a recreated container, not a retained complete sequence of required hourly browser/API checks.
- The cited fleet-500 report is absent, so even the original deployment-window explanation remains unverified here.

**Target behavior / next work:**

- Start a new bounded 24-hour observation on the intended release build with one explicit hourly catalog check and associated build/time.
- Record every failure and the exact cutover exception window; distinguish connection/tool failures from server 5xx.
- Close only after the complete window and final Dispatcher catalog readback, retaining evidence outside the disposable checkout.

**Required independent checks:**

- Hourly /fleet/vehicles backing-API and UI smoke observations for24h.
- During deploy, correlation of frontend state, API response and backend logs.

**Closure-claim review:** The original incident may have been transient, but neither historical summary nor current route code meets the explicit full-window evidence requirement.

<a id="kp-020"></a>

### KP-020 — Consistent driver detail typography and components

**Source file:** [QA_PASSED/20260912_6.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260912_6.docx>)

**Source title (verbatim):** TASK: Thống nhất thiết kế + cỡ chữ màn hình chi tiết chuyến (App tài xế)

**SHA-256:** `3b2666a780cd9e203aa488691651957a791b4c2935633c2ac14acb2e8e7fc7bd`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-020](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-020>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-020.txt>).

**Requirements read:**

- Use a consistent compact driver-detail type scale, spacing and visual hierarchy.
- Place container/seal/report attachments in one equal-sized group with usable touch targets.
- Keep site rules readable and secondary; use consistent primary/secondary actions without changing function.

**Connected current-source evidence:**

- [docs/driver-trip-detail-design-spec.md](</Users/frank.nguyen/Documents/silversea/codebase/docs/driver-trip-detail-design-spec.md:14>) — Defines driver detail type roles, section rhythm, collapse and one photo group.
- [frontend/src/components/trip/DriverContainerCard.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.css:125>) — Photo dimensions are96px; coarse-pointer actions receive44px minimum height at227.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:42>) — Shared collapsible section head implements expanded state and aria-controls.

**Missing, contradicted or unproven:**

- Historical design screenshot and typography census are absent.
- No current computed typography/contrast/touch measurement or actual layout inspection was performed.
- The newer driver information consolidation may supersede portions of the older display ordering; avoid conflicting parallel layouts.

**Target behavior / next work:**

- Keep one shared compact type/spacing vocabulary and merge later driver-content requirements into it.
- Measure actual computed text, contrast, hit targets, footer clearance and attachment dimensions on phone/tablet/desktop.
- Retest the underlying controls after style changes, especially collapse, file selection, camera and viewer.

**Required independent checks:**

- Settled three-width visual comparison and computed type/touch/contrast checks.
- Driver detail interaction regression after styling.

**Closure-claim review:** Current style/spec and component structure support implementation presence; the historical suite claim cannot substitute for a fresh rendered audit.

<a id="kp-021"></a>

### KP-021 — Verify dependency remediation against current advisory state

**Source file:** [QA_PASSED/20260913_1-dependabot-default-branch-vulnerabilities.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_1-dependabot-default-branch-vulnerabilities.docx>)

**Source title (verbatim):** Nợ kỹ thuật: 8 lỗ hổng Dependabot trên nhánh mặc định

**SHA-256:** `39fa1658e3808a856c4f2f7de74f0f396ed86bd975144810a84cf8d96dd16042`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-021](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-021>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-021.txt>).

**Requirements read:**

- Upgrade vulnerable direct/transitive packages and lockfile entries to the specified patched lines.
- Run build/type/lint/tests and verify staging uses the upgraded build.
- Verify the relevant default-branch Dependabot alerts are closed rather than equating version text with remote security status.

**Connected current-source evidence:**

- [backend/package.json](</Users/frank.nguyen/Documents/silversea/codebase/backend/package.json:42>) — Manifest uses multer^2.3.0 and sharp^0.35.4 at47.
- [frontend/package.json](</Users/frank.nguyen/Documents/silversea/codebase/frontend/package.json:70>) — Manifest uses vitest^4.1.11.
- [package.json](</Users/frank.nguyen/Documents/silversea/codebase/package.json:24>) — Root overrides include csv-parse^7.0.2 and js-yaml^4.3.2 at31.
- [pnpm-lock.yaml](</Users/frank.nguyen/Documents/silversea/codebase/pnpm-lock.yaml:2296>) — Lock includes @vitest/mocker4.1.11; corresponding multer/sharp/csv/js-yaml resolved entries are present.

**Missing, contradicted or unproven:**

- No dependency installation or current build/test/audit execution was performed; missing dependencies were reported by the lead.
- No remote Dependabot query, default-branch state or deployed version was checked.
- Historical zero-alert and test logs are absent; old mixed main/prod gate failures cannot be treated as current clean gates.

**Target behavior / next work:**

- Run the prescribed dependency/security and application gates in a prepared environment with the committed lockfile.
- Query current remote alerts against the actual default branch and link each closure to the resolved dependency graph.
- Deploy only through the normal reviewed release process and retain exact build/lockfile identity in smoke evidence.

**Required independent checks:**

- Current lockfile install, typecheck, lint, frontend/backend tests and production build.
- Remote advisory closure and runtime smoke for upload/image/test-runner changes.

**Closure-claim review:** Requested patched versions are present. Current risk/alert closure, full gates and deployment are unverified.

<a id="kp-022"></a>

### KP-022 — Carrier regression tests and component size guard

**Source file:** [QA_PASSED/20260913_13-vitest-debt-carrier-tests-loc-ceiling.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_13-vitest-debt-carrier-tests-loc-ceiling.docx>)

**Source title (verbatim):** Vitest debt — ShipmentDetailPage carrier tests + LOC ceiling

**SHA-256:** `bf9371ac63b5e9d2ade0ad166a60bfd41db5c3f4bd4a3063de60770ca02a9d80`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-022](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-022>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-022.txt>).

**Requirements read:**

- Repair ShipmentDetailPage carrier tests without weakening assertions.
- Keep the page within432 lines and preserve shrink-only structure ceilings.
- Pass required frontend checks and normal precommit hooks without bypass.

**Connected current-source evidence:**

- [frontend/src/pages/ShipmentDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ShipmentDetailPage.tsx:135>) — Carrier grouping is delegated to the detail helper; current file has390 lines.
- [frontend/src/features/shipments/detail/shipment-detail-view.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/shipment-detail-view.ts:21>) — Extracted grouping handles carrier-first aggregation independently.
- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:46>) — Page ceiling remains432; another promised shrink-only ceiling is now533 at155.
- [frontend/src/pages/ShipmentDetailPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ShipmentDetailPage.test.tsx:1>) — Page regression test source is present but was not executed.

**Missing, contradicted or unproven:**

- The page’s390 lines satisfy the numeric page limit, but test success and precommit execution are not established at current HEAD.
- The appendix says other ceilings were refrozen; the current533 hook ceiling conflicts with the linked515 shrink-only commitment.
- No historical staging wildcard evidence exists in the current checkout.

**Target behavior / next work:**

- Run carrier tests and structure checks using current dependencies and inspect failures before changing assertions.
- Preserve the page extraction and verify each carrier state still exercises real rendering.
- Resolve the linked ceiling regression under KP-018 as explicit remaining work; do not use a higher ceiling as evidence that shrink-only discipline passed.

**Required independent checks:**

- ShipmentDetailPage carrier scenarios and full structure guard.
- Normal precommit run with retained log and no hook bypass.

**Closure-claim review:** The narrow page-size requirement is source-supported; the broader no-ratchet-increase and successful-gates claims are not fully supported.

<a id="kp-023"></a>

### KP-023 — Deterministic detailed-plan tests

**Source file:** [QA_PASSED/20260913_2-detail-plan-tests-accumulation-trap.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_2-detail-plan-tests-accumulation-trap.docx>)

**Source title (verbatim):** Nợ kỹ thuật: test detail-plan phụ thuộc DB tích luỹ (page-1 flaky)

**SHA-256:** `9220ef3da730709311aec36e99d146e19ad2a83ed52c9df1bf221d10125fa18d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-023](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-023>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-023.txt>).

**Requirements read:**

- Remove accumulated-database/page1 dependence from detail-plan membership and facet tests.
- Use per-run query scopes or isolated databases without weakening assertions.
- Demonstrate repeatability with accumulated data and the full relevant backend suite.

**Connected current-source evidence:**

- [backend/src/tests/dispatch-detail-plan.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/dispatch-detail-plan.test.ts:720>) — Delivery-point facet request is scoped with the run suffix; pickup/drop facets likewise at744/751.
- [backend/src/tests/dispatch-detail-plan.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/dispatch-detail-plan.test.ts:849>) — Zone membership queries explicitly scope q to current-run lots.
- [backend/src/tests/dispatch-detail-plan.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/dispatch-detail-plan.test.ts:525>) — Carrier-less assignment test retains actual membership and mutation assertions.

**Missing, contradicted or unproven:**

- Test source now includes the described run-scoped requests, but no repeated accumulated-DB run was performed.
- Historical2032-test result and report are absent.
- A complete current test-suite scan/run is required before claiming no remaining unscoped membership assumptions.

**Target behavior / next work:**

- Retain meaningful membership assertions and isolate each new fixture with a searchable marker.
- Run affected tests repeatedly against both clean and deliberately populated test databases, then the relevant full suite.
- Fix any additional unscoped page-boundary assumption found in those runs rather than increasing limits or deleting assertions.

**Required independent checks:**

- Repeat facet/zone/detail-plan/fulfillment/master-plan tests in clean and accumulated datasets.
- Parallel-run isolation if supported by the suite.

**Closure-claim review:** Specific q-scoping changes exist. Historical repeated-suite completion cannot be independently confirmed.

<a id="kp-024"></a>

### KP-024 — Shipment foreign-key integrity

**Source file:** [QA_PASSED/20260913_3-missing-fk-shipment-children.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_3-missing-fk-shipment-children.docx>)

**Source title (verbatim):** Nợ kỹ thuật: thiếu FK shipment_fulfillments/shipment_containers → shipment

**SHA-256:** `0816de4625410f37b46fa069c9a78b8955860e3de2d1d9fdf9e397f757021b9b`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-024](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-024>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-024.txt>).

**Requirements read:**

- Enforce shipment→container/fulfillment foreign keys with an explicit deletion policy.
- Protect live trips from losing their fulfillment; align schema, migration and regression tests.
- Audit and safely handle pre-existing orphans with backup before applying the migration to a live environment.

**Connected current-source evidence:**

- [backend/drizzle/0073_shipment_children_foreign_keys.sql](</Users/frank.nguyen/Documents/silversea/codebase/backend/drizzle/0073_shipment_children_foreign_keys.sql:15>) — Adds CASCADE shipment child FKs and RESTRICT trips.fulfillment_id.
- [backend/src/db/schema/shipments.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/db/schema/shipments.ts:163>) — Container shipmentId uses CASCADE; fulfillment shipmentId has matching reference at220.
- [backend/src/db/schema/trips.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/db/schema/trips.ts:67>) — Trip fulfillment FK uses RESTRICT.
- [backend/src/tests/shipment-children-foreign-keys.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/shipment-children-foreign-keys.test.ts:13>) — Dedicated integration test defines invalid-reference rejection and protected/cascading deletion cases.

**Missing, contradicted or unproven:**

- Migration and schema definitions agree, but current live database application/orphan counts/backups were not checked.
- The document’s final note explicitly left deployment pending; the QA-passed label cannot prove it occurred.
- Historical cleanup and precheck reports are missing.

**Target behavior / next work:**

- Verify the target database migration ledger and actual constraint definitions read-only before scheduling any change.
- If unapplied, obtain current orphan audit and backup, resolve records by documented ownership, then apply through the normal migration release.
- Run invalid-child, parent deletion and live-trip RESTRICT integration tests; retain post-migration verification.

**Required independent checks:**

- Migration from a representative pre0073 database with deliberate orphan fixture.
- FK rejection, safe CASCADE and live-trip RESTRICT tests.

**Closure-claim review:** Code/migration/test definitions are present; deployment and data-preparation completion remain explicitly unproven.

<a id="kp-025"></a>

### KP-025 — Recover route chunk loading safely

**Source file:** [QA_PASSED/20260913_4-stale-chunk-reload.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_4-stale-chunk-reload.docx>)

**Source title (verbatim):** Nguồn: phát hiện trong buổi QA sweep staging 2026-09-13 (qa/2026-09-13_staging-ui-sweep/REPORT.md, mục Findings 1)

**SHA-256:** `854ccd3d001ccdccd7befc76926861ba733526ffc519080f52677e96b5c66e3c`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-025](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-025>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-025.txt>).

**Requirements read:**

- Recover from stale dynamic chunks after a deployment with a bounded reload.
- Prevent infinite reload loops and provide a useful exhausted-recovery state.
- Verify long-lived driver detail, dispatcher plan and shipment routes across an actual build change.

**Connected current-source evidence:**

- [frontend/src/lib/chunk-error.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/chunk-error.ts:23>) — Four-hour session cooldown limits recovery; matching chunk failures purge caches and reload at68–73.
- [frontend/src/lib/chunk-error.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/chunk-error.ts:85>) — Global preload/error/rejection listeners trigger bounded recovery.
- [frontend/src/components/shared/ErrorBoundary.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/shared/ErrorBoundary.tsx:25>) — React lazy-load errors enter the same recovery path.
- [frontend/src/main.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/main.tsx:23>) — Recovery listeners are installed at boot.

**Missing, contradicted or unproven:**

- No fresh controlled deploy/old-tab test was performed; cited driver proof is absent and the document defers Dispatcher E2E.
- Storage-denied, failed reload and consecutive deployments within the cooldown require clear recovery verification.
- Recovery must work within the internet-required product direction; do not preserve offline operation or replay business actions.

**Target behavior / next work:**

- Retain bounded online chunk recovery while coordinating service-worker retirement with the internet-required scope.
- Keep old tabs open through a controlled release and exercise all three named routes; inspect the final build and errors after recovery.
- Verify an actually broken deployment and denied session storage cannot create loops or hide an actionable reload message.

**Required independent checks:**

- Current chunk/error-boundary unit tests plus old-tab deploy smoke for driver/dispatch/shipment.
- Repeated failure, storage exception and consecutive-deploy cases.

**Closure-claim review:** The recovery hooks are connected. Historical driver-only deployment evidence does not establish all named routes or current behavior.

<a id="kp-026"></a>

### KP-026 — Verify actual migration history after merge

**Source file:** [QA_PASSED/20260913_5-main-prod-migration-renumber.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_5-main-prod-migration-renumber.docx>)

**Source title (verbatim):** Merge main↔prod: đánh lại số migration main sau 0073

**SHA-256:** `4b4656523dd838122089ef2d9876ace58480412e65f1125ace93a89e99eb96bd`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-026](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-026>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-026.txt>).

**Requirements read:**

- Reconcile main/prod migration number collisions without duplicating equivalent schema changes.
- Keep SQL files, journal and snapshot identities coherent.
- Prove migration on a representative database and integration of the intended branch history with required gates.

**Connected current-source evidence:**

- [backend/drizzle/meta/_journal.json](</Users/frank.nguyen/Documents/silversea/codebase/backend/drizzle/meta/_journal.json:490>) — Journal includes0073 then the renumbered0074–0077 entries before later migrations.
- [backend/drizzle/0074_gorgeous_tinkerer.sql](</Users/frank.nguyen/Documents/silversea/codebase/backend/drizzle/0074_gorgeous_tinkerer.sql:1>) — First renumbered migration file exists.
- [backend/drizzle/0077_trip_factory_site_snapshot.sql](</Users/frank.nguyen/Documents/silversea/codebase/backend/drizzle/0077_trip_factory_site_snapshot.sql:1>) — Factory snapshot migration exists in the reconciled numbered sequence.

**Missing, contradicted or unproven:**

- The original14-file plan was revised in the appendix to four new migrations after identifying ten equivalent changes; do not implement the old14 blindly.
- No current scratch migration, merge validation or remote branch history was executed in this review.
- Historical migration/merge report is absent; related tracker’s parked-main statement is older conflicting context, not current branch authority.

**Target behavior / next work:**

- Retain existing identity mapping and validate all journal tags resolve to unique SQL/snapshot files.
- Run the reconciled chain from both a clean schema and representative prior branch databases in a disposable environment.
- Document actual integration ancestry and required gate results; do not create a new merge or renumber already-applied migrations solely from this historical ticket.

**Required independent checks:**

- Migration chain validation, duplicate-change detection and scratch database migrations.
- Current branch integration/type/build/backend gates in a prepared environment.

**Closure-claim review:** Renumbered artifacts are present. The revised four-change solution is plausible but the historical all-gates/migrate/remote-push claims are not current verified evidence.

<a id="kp-027"></a>

### KP-027 — Driver Card View Layout Polish

**Source file:** [QA_PASSED/20260913_6-driver-card-view-layout.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_6-driver-card-view-layout.docx>)

**Source title (verbatim):** Driver Card View Layout Polish

**SHA-256:** `308cf4c1162ddc12d0c3529b85f62fe70ab979ec0c9b1614641b22ccc5087a46`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 8.

**Delivery:** [KP-027](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-027>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-027.txt>).

**Requirements read:**

- Driver summary cards show factory abbreviation, route, container/type and HÀNG TRẢ/HÀNG ĐÓNG in a compact ordered layout.
- Show lift/drop ports, task notes and a usable detail link.
- Derive operation from trade direction, preserving honest unknown fallbacks and responsive readability.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:66>) — IMPORT and EXPORT explicitly map to TRẢ HÀNG and ĐÓNG HÀNG.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:115>) — Factory, route and container/type/operation layout is implemented through159.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:160>) — Ports, notes and detail navigation follow in the card.
- [frontend/src/pages/DriverTripsPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.test.tsx:255>) — Test definition pins tradeDirection rather than loadingType and unknown fallback.

**Missing, contradicted or unproven:**

- No current summary-card visual/readback test was performed; cited screenshots are absent.
- Historical appendix listed unrelated suite failures and dev-only validation, so it is not a current clean release pass.
- Later driver requirements may change redundant return-depot/contact presentation; use one consolidated design package.

**Target behavior / next work:**

- Retain direction-based operation semantics and explicit unknown fallback.
- Verify IMPORT/EXPORT/unknown cards with long factory/route/container values at three widths and follow each detail link.
- Merge overlapping card operation tickets into this implementation package while retaining each record identity.

**Required independent checks:**

- Current DriverTripsPage tests and saved IMPORT/EXPORT card fixtures.
- Phone/tablet/desktop scanability and detail navigation.

**Closure-claim review:** Connected card structure exists; no fresh UI or all-green test/deploy evidence supports completion.

<a id="kp-028"></a>

### KP-028 — Driver Detail View — Add Full Factory Name, Address, Phone

**Source file:** [QA_PASSED/20260913_7-driver-detail-add-factory-info.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_7-driver-detail-add-factory-info.docx>)

**Source title (verbatim):** Driver Detail View — Add Full Factory Name, Address, Phone

**SHA-256:** `9ee762090955eed5c89e9eeb8c82fcac08271c3a950372fcb40b8c052ce9bf19`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 9.

**Delivery:** [KP-028](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-028>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-028.txt>).

**Requirements read:**

- Display short factory identity plus full factory name, separate address and warehouse contact phone.
- Show full invoice identity/address/tax information, preserving honest missing-data fallbacks.
- Keep factory identity prominent in expanded and collapsed detail states without duplicate misleading rows.

**Connected current-source evidence:**

- [backend/src/services/driver.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver.service.ts:742>) — Driver detail maps canonical factory full/short names, address and khoPhone.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:98>) — Factory fallback and adjacent full-name duplicate handling are explicit.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:127>) — Full name, address and phone rows precede container/port facts.
- [frontend/src/pages/driver/DriverTripHeader.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTripHeader.tsx:28>) — Factory identity remains the header title while route is secondary.

**Missing, contradicted or unproven:**

- No fresh API/UI readback for complete, missing and fallback factory data.
- Invoice grouping and phone/contact duplication must be reconciled with the newer consolidated contact/invoice requirements; current rows alone do not prove intuitive grouping.
- Cited historical dev evidence is absent and staging was deferred in the earlier appendix.

**Target behavior / next work:**

- Use current canonical factory and billing data with explicit labels, including honest empty values.
- Consolidate duplicate contact rows and invoice party grouping under the latest driver requirement; preserve distinct parties and tel links.
- Verify expanded/collapsed identity, long addresses, tax codes and complete/empty phone data at three widths.

**Required independent checks:**

- Current info-section/header tests plus live saved factory and invoice fixtures.
- Phone/contact and invoice-party grouping visual checks.

**Closure-claim review:** Required data mapping and rows exist. Historical screenshots and claimed fixtures are not currently available.

<a id="kp-029"></a>

### KP-029 — Driver Card View — Add HÀNG TRẢ/HÀNG ĐÓNG Column

**Source file:** [QA_PASSED/20260913_8-driver-card-container-type-column.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_8-driver-card-container-type-column.docx>)

**Source title (verbatim):** Driver Card View — Add HÀNG TRẢ/HÀNG ĐÓNG Column

**SHA-256:** `a6b1d809309db26c053716e329aba6ea3ff8d5386e6e1a59a93c8d71e3574ebb`

**Claimed folder:** QA_PASSED. **Audit:** DUPLICATE. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-029](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-029>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-029.txt>).

**Canonical records:** [KP-027](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-027>), [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-034>). No duplicate engineering implementation.

**Requirements read:**

- Add the driver card return/loading operation beside container and type.
- Use tradeDirection as authority and remain compact at phone width.
- Verify IMPORT, EXPORT and unknown values.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:66>) — Same direction label mapping serves this record and KP-027/KP-034.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:142>) — Operation pill is rendered in the shared card container row.

**Missing, contradicted or unproven:**

- This is the same implementation requirement as KP-027’s operation subrequirement and KP-034/KP-035.
- No separate current validation exists; historical shared report paths are absent.

**Target behavior / next work:**

- Retain KP-029 identity and link it to the canonical card-operation package.
- Use one shared set of direction/fallback/responsive acceptance results; avoid a second competing card redesign.

**Required independent checks:**

- Reuse KP-027/KP-034 operation and responsive checks.

**Closure-claim review:** The document explicitly references the shared card-layout report. Duplicate status does not mean independently verified completion.

<a id="kp-030"></a>

### KP-030 — Reconcile drop off destinations across driver trip views

**Source file:** [QA_PASSED/20260913_P1_QA-004_bug-reconcile-drop-off-destinations-across-driver-trip-views.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P1_QA-004_bug-reconcile-drop-off-destinations-across-driver-trip-views.docx>)

**Source title (verbatim):** Reconcile drop off destinations across driver trip views

**SHA-256:** `b931291fb2aa1bef424ad00d2535d6dced850b1ae98332a22dd0a90adbf6dcf8`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P1. **Images:** 3.

**Delivery:** [KP-030](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-030>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-030.txt>).

**Requirements read:**

- Reconcile delivery/drop-off destinations across driver summary, driver detail and CUS views.
- Keep factory delivery and empty-container return semantically distinct when applicable.
- Validate IMPORT and EXPORT with different locations, not just one repeated port fixture.

**Connected current-source evidence:**

- [backend/src/services/delivery-stage.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/delivery-stage.ts:40>) — Shared projection selects free-text delivery, then snapshot site, then port; exposes a different port as returnDepotName.
- [backend/src/services/driver-journey-board.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-journey-board.service.ts:249>) — Driver board consumes the shared delivery-stage projection.
- [backend/src/services/driver.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver.service.ts:727>) — Driver detail consumes the same projection.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:140>) — Detail renders lift/drop and optional return depot separately.

**Missing, contradicted or unproven:**

- No current same-record CUS/driver/dispatch readback or import/export semantic fixture was run.
- The helper itself receives no tradeDirection, so direction-specific semantics must be proven by upstream data and target labels rather than inferred from its name.
- Latest driver request KP-191 reportedly changes redundant empty-return presentation; reconcile that target before polishing the older extra row.

**Target behavior / next work:**

- Define current source/label semantics for import empty-return versus export load/drop, using the latest requirements.
- Verify shared projection and each consumer against distinct factory, delivery and port values; adjust direction-aware mapping if fixtures demonstrate mismatch.
- Remove duplicate presentation according to KP-191 without conflating separate physical events.

**Required independent checks:**

- Import/export direction cases with different delivery and return locations; missing/blank fallbacks.
- Same trip cross-view field comparison after reload.

**Closure-claim review:** A common helper and connected consumers are present. The historical build531 evidence is missing and does not prove current direction-specific semantics.

<a id="kp-031"></a>

### KP-031 — Reconcile carrier assignment between customer service and dispatch

**Source file:** [QA_PASSED/20260913_P1_QA-010_bug-reconcile-carrier-assignment-between-customer-service-and-dispatch.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P1_QA-010_bug-reconcile-carrier-assignment-between-customer-service-and-dispatch.docx>)

**Source title (verbatim):** Reconcile carrier assignment between customer service and dispatch

**SHA-256:** `72b190026df8eebaa440b664178a000ebb6be0f7ce47cbecb7b00864dcd31296`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P1. **Images:** 3.

**Delivery:** [KP-031](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-031>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-031.txt>).

**Requirements read:**

- CUS and dispatch must agree on current carrier and plate for the same shipment/container.
- Ignore cancelled historical trips when deriving current assignment.
- Cover planned-only, assigned, cancelled and reassigned readback.

**Connected current-source evidence:**

- [backend/src/services/cus-shipment-workspace-reads.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-reads.service.ts:389>) — CUS loads planned carrier identity from the fulfillment and filters cancelled trips from current joins at412.
- [backend/src/services/shipment-queries.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/shipment-queries.service.ts:475>) — Shipment assignment query excludes cancelled trip rows.
- [backend/src/services/dispatch-planning-detail-plan.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-detail-plan.service.ts:290>) — Detailed plan reads the same planned carrier fields; active trip join excludes cancelled/deleted rows at348.

**Missing, contradicted or unproven:**

- No current multi-view projection test or actual reassignment/cancellation readback was performed.
- Historical “old fixture stale, new fixture passed” evidence is absent; selecting a new fixture does not independently close stale existing-record behavior.
- The planned-versus-issued authority must remain explicit when reassignment writes trip carrier sidecars.

**Target behavior / next work:**

- Run a single fixture through planned-only, issued, cancelled and reassigned states and compare CUS/dispatch/detail after reload.
- Ensure each projection deliberately chooses current trip assignment over stale planned data where the business contract requires it.
- Retain historical audit data without allowing cancelled rows to win display selection.

**Required independent checks:**

- Current cross-view service tests and actual CUS/Dispatcher readback.
- Multiple historical trips plus active/current assignment fixture.

**Closure-claim review:** Current joins show the intended cancellation filtering and planned data sources, but the full current projection chain is not behaviorally verified.

<a id="kp-032"></a>

### KP-032 — Show the saved LCL delivery date and provide a usable dispatch path

**Source file:** [QA_PASSED/20260913_P1_QA-019_bug-show-the-saved-lcl-delivery-date-and-provide-a-usable-dispatch-path.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P1_QA-019_bug-show-the-saved-lcl-delivery-date-and-provide-a-usable-dispatch-path.docx>)

**Source title (verbatim):** Show the saved LCL delivery date and provide a usable dispatch path

**SHA-256:** `b2688dafb0c2cd0166fab76850d5eeb07611eaefb4d296c02460a285d14c4761`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P1. **Images:** 3.

**Delivery:** [KP-032](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-032>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-032.txt>).

**Requirements read:**

- Persist primary and later LCL delivery dates and show them in overview/detail.
- Provide LCL-specific schedule/prerequisite editing without fake container rows.
- An eligible LCL lot must be discoverable and actually allocatable through the normal dispatch UI/API, then show carrier readiness.
- Preserve FCL behavior.

**Connected current-source evidence:**

- [backend/src/services/shipment-intake.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/shipment-intake.service.ts:586>) — LCL readiness forbids fake containers and requires lot-level date/package/weight/volume data.
- [backend/src/services/shipment-fulfillment.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/shipment-fulfillment.service.ts:265>) — Decomposition creates a lot-level LCL fulfillment with null shipmentContainerId.
- [frontend/src/features/shipments/detail/ShipmentContainerScheduleEditor.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentContainerScheduleEditor.tsx:108>) — Schedule body includes a lot-level transport date for non-FCL cargo, but remains embedded in the container-oriented editor.
- [backend/src/tests/cus-shipment-workspace.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/cus-shipment-workspace.test.ts:2277>) — Test verifies LCL create date and summary projection; its “after allocation” phase directly seeds an allocated fulfillment at2324 rather than using the allocation endpoint.

**Missing, contradicted or unproven:**

- The completion appendix’s positive closure proves a visible LCL workboard row/detail link, not successful allocation; the cited real allocation case had previously hit a positive line-ID blocker.
- Current service primitives support LCL, but the exact no-container UI edit/allocation path and its identifiers are not fully verified.
- The current test seeds the resulting state, leaving the endpoint/UI mutation and its validation uncovered.

**Target behavior / next work:**

- Create a valid container-less LCL lot through the actual CUS flow; edit a previously absent delivery date through its visible LCL action.
- Trace and correct any container-only lineId assumption in schedule/assignment controls; use shipment/fulfillment identity for LCL rather than fabricating a container.
- Allocate carrier/vehicle and issue the LCL trip through the normal endpoint/UI, then read back overview/detail/dispatch/driver states.
- Retain explicit prerequisite feedback and rerun FCL regression cases.

**Required independent checks:**

- Positive LCL create → date edit → dispatch allocation → issue workflow, using real mutation endpoints.
- Missing-date and missing-prerequisite errors; no fake containers; FCL unaffected.

**Closure-claim review:** QA-passed exceeds the documented and current test evidence: date/readiness projection exists, but normal-path LCL allocation is not proven.

<a id="kp-033"></a>

### KP-033 — Preserve appointment minutes in the detailed dispatch plan

**Source file:** [QA_PASSED/20260913_P2_QA-001_bug-preserve-appointment-minutes-in-the-detailed-dispatch-plan.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-001_bug-preserve-appointment-minutes-in-the-detailed-dispatch-plan.docx>)

**Source title (verbatim):** Preserve appointment minutes in the detailed dispatch plan

**SHA-256:** `7af10287e8ccadacf60bb4a4dcf0ac7d1c6bd9a445161bf80cf44c1559759c5e`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 6.

**Delivery:** [KP-033](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-033>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-033.txt>).

**Requirements read:**

- Display exact appointment minutes instead of rounding to the hour on desktop and phone plan rows.
- Preserve full-time sort/filter semantics and honest unknown-time handling.
- Support the documented unsorted→ascending→descending sort cycle.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:249>) — Display prefers full runAt and falls back to legacy runHour only when absent.
- [frontend/src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts:214>) — Loaded-page sorting compares full runAt and places unknown times last in both directions.
- [backend/src/services/dispatch-planning-detail-plan.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-detail-plan.service.ts:180>) — Hour filtering uses hour*60+minute in the business timezone.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx:572>) — Regression source includes20:45 display and legacy/unknown fallback cases.

**Missing, contradicted or unproven:**

- No current rendered sort/filter verification or test run; historical report is absent.
- The adjacent issue-order default still drops minutes; that is a separate remaining schedule-flow problem recorded under KP-037, not proof that the row formatter is wrong.
- Sorting is explicitly over the loaded page; global multi-page expectations must be verified against the product contract.

**Target behavior / next work:**

- Retain full-minute row display/filter behavior and verify exact-minute values at both layouts.
- Run the three-state sort cycle with equal-hour different-minute and unknown-time rows; state whether ordering is page-local.
- Fix the issue-order timestamp default under KP-037 so a correctly displayed appointment is not changed when the user issues it.

**Required independent checks:**

- 00/15/30/45 minute, midnight, unknown-time display/filter/sort cases.
- Multiple-page scope and action transition to issue form.

**Closure-claim review:** Current formatter/sort/filter definitions implement this narrow ticket. The associated current issue-flow loss of minutes prevents broader schedule-completion claims.

<a id="kp-034"></a>

### KP-034 — Show the return or loading operation on driver trip cards

**Source file:** [QA_PASSED/20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards-staging-verified-20260914.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards-staging-verified-20260914.docx>)

**Source title (verbatim):** Show the return or loading operation on driver trip cards

**SHA-256:** `11a9456ab8fa473823c3cea499340f12fccba2a0f55cf468cbb3700aba55f539`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-034>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-034.txt>).

**Requirements read:**

- Show HÀNG TRẢ/HÀNG ĐÓNG on every applicable driver summary card.
- Use import/export direction rather than SINGLE/DOUBLE loading classification.
- Keep unknown values honest and verify current staging desktop/mobile.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:66>) — Direction-only operation mapping implements the requested labels.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:142>) — Known container cards show operation in the container/type row; no-container cards render known direction at155.
- [frontend/src/pages/DriverTripsPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.test.tsx:255>) — Test explicitly rejects deriving operation from loadingType.

**Missing, contradicted or unproven:**

- Cited staging wildcard reports are absent and no current browser verification was performed.
- This is overlapping scope with KP-027/KP-029 and the duplicate KP-035; retain identity without creating multiple fixes.

**Target behavior / next work:**

- Close against the shared card implementation and one current IMPORT/EXPORT/unknown evidence set.
- Keep separate old record IDs linked to the same work package and final proof.

**Required independent checks:**

- Reuse current card direction, fallback and responsive tests.

**Closure-claim review:** The document’s build531 staging claim is historical and unavailable. Source implementation is present, not a current staging pass.

<a id="kp-035"></a>

### KP-035 — Show the return or loading operation on driver trip cards

**Source file:** [QA_PASSED/20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-002_bug-show-the-return-or-loading-operation-on-driver-trip-cards.docx>)

**Source title (verbatim):** Show the return or loading operation on driver trip cards

**SHA-256:** `d44d6ed8d69649a59e76a7addb678b49b4a65479b12eebaed597ee0e4ecf4c37`

**Claimed folder:** QA_PASSED. **Audit:** DUPLICATE. **Source priority:** P2. **Images:** 5.

**Delivery:** [KP-035](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-035>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-035.txt>).

**Canonical records:** [KP-034](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-034>). No duplicate engineering implementation.

**Requirements read:**

- Show the return/loading operation on driver cards using shipment direction.
- Preserve compact layout and unknown fallback.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:66>) — Same tradeDirection implementation as KP-034.
- [frontend/src/pages/DriverTripsPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.test.tsx:255>) — Shared operation regression definition covers both records.

**Missing, contradicted or unproven:**

- This record repeats the same QA002 scope as KP-034 with an earlier dev-only closure.
- No independent current evidence exists; do not count duplicate QA IDs as separate completed behavior.

**Target behavior / next work:**

- Retain original KP-035 identity and link closure to KP-034/KP-027.
- Avoid generating a second implementation or duplicate screenshot exercise.

**Required independent checks:**

- Shared operation-card regression and current device proof.

**Closure-claim review:** An earlier duplicate record; its dev-only note is weaker than the later, still unverified KP-034 claim.

<a id="kp-036"></a>

### KP-036 — Unify driver attachment sections and their visual hierarchy

**Source file:** [QA_PASSED/20260913_P2_QA-003_bug-unify-driver-attachment-sections-and-their-visual-hierarchy.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-003_bug-unify-driver-attachment-sections-and-their-visual-hierarchy.docx>)

**Source title (verbatim):** Unify driver attachment sections and their visual hierarchy

**SHA-256:** `6e90f828e3c81267e00b75ac93761269304f0e80ccf5c17d2380eb65444424cf`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-036](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-036>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-036.txt>).

**Requirements read:**

- Unify container, seal and delivery-report attachments in one compact visual group.
- Use consistent dimensions and touch targets, without duplicate controls or sections.
- All three kinds must support file/camera selection, save/view/delete and reload persistence.

**Connected current-source evidence:**

- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:420>) — Single row renders Cont, Seal and Biên bản attachment slots.
- [frontend/src/components/trip/DriverContainerCard.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.css:125>) — Shared96px photo dimensions and coarse-pointer44px controls are defined.
- [backend/src/services/driver.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver.service.ts:674>) — Detail photo query includes CONTAINER, SEAL and DELIVERY_NOTE.
- [frontend/src/components/trip/DriverContainerCard.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.test.tsx:139>) — Upload/delete/unified-slot regression definitions are present.

**Missing, contradicted or unproven:**

- No current populated/empty three-width view or actual persistence tests were run.
- Historical appendix explicitly defers camera hardware; upload of one delivery report does not validate every attachment type and operation.
- Deletion, replacement, viewer focus and loading/error states must be verified as connected actions.

**Target behavior / next work:**

- Use one grouped attachment component and retain current compact touch styling.
- Exercise each file type through select, save, reload, full view, replacement and delete.
- Test camera permission granted/denied and actual capture on supported physical mobile hardware; mark unavailable hardware as unverified rather than passed.

**Required independent checks:**

- Three attachment types × empty/populated/action/reload states.
- Camera device matrix and viewer keyboard/focus checks.

**Closure-claim review:** Unified code is present. The appendix’s partial upload and deferred camera evidence cannot substantiate the whole functional acceptance matrix.

<a id="kp-037"></a>

### KP-037 — Clarify and align the driver appointment time

**Source file:** [QA_PASSED/20260913_P2_QA-005_bug-clarify-and-align-the-driver-appointment-time.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-005_bug-clarify-and-align-the-driver-appointment-time.docx>)

**Source title (verbatim):** Clarify and align the driver appointment time

**SHA-256:** `28ea7cd7dc3b8c8859330ebdc6cd41865f6831e640c24f9a96e02bb562604916`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-037](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-037>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-037.txt>).

**Requirements read:**

- Align driver summary/detail appointment time with the CUS/dispatch event they represent.
- If departure and customer appointment differ, label them distinctly rather than showing conflicting unlabelled times.
- Preserve nonzero minutes and midnight behavior in the business timezone.

**Connected current-source evidence:**

- [backend/src/services/dispatch-planning-detail-plan.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-detail-plan.service.ts:451>) — Plan runAt comes from customer appointment, then closing/planned return; runHour is a separate reduced display value.
- [frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts:31>) — Quick issue ignores runAt and reconstructs date + runHour + :00, losing appointment minutes before submission.
- [frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts:139>) — The issue request submits the resulting draft plannedStartAt as ISO.
- [backend/src/services/driver-journey-board.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-journey-board.service.ts:276>) — Driver summary schedule comes from trip.plannedStartAt.
- [frontend/src/api/driverClient.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/api/driverClient.ts:343>) — Driver detail plannedAt also derives from trip.plannedStartAt or departureDate.

**Missing, contradicted or unproven:**

- A20:45 plan appointment defaults to20:00 in quick issue: a deterministic source mismatch, not a fresh staging reproduction.
- Both driver views agree with the trip start, but that does not prove they show the customer appointment or distinguish separate events.
- The document itself says the timezone-only fix deferred scheduledAt-versus-CUS appointment semantics; current code still leaves that broader requirement incomplete.

**Target behavior / next work:**

- Initialize issue drafts from the full authoritative runAt converted to business-local date/time; only use an explicitly labelled fallback when no appointment exists.
- Define customer appointment versus operational start fields and labels; carry both if they are legitimately distinct.
- Verify CUS → detail plan → quick issue → driver summary/detail on the same record without implicit time changes.
- Coordinate with KP-140’s confirmed detailed-plan screenshot scope; do not apply its dispatch requirement to an unrelated driver-only view.

**Required independent checks:**

- 20:45 and 00:15 roundtrip through issue default and saved trip.
- Different appointment/start values with distinct labels; business timezone boundary cases.

**Closure-claim review:** The QA-passed label closes a timezone change but expressly leaves semantics; current quick-issue code also drops minutes.

<a id="kp-038"></a>

### KP-038 — Keep factory identity prominent and label its address in driver details

**Source file:** [QA_PASSED/20260913_P2_QA-006_bug-keep-factory-identity-prominent-and-label-its-address-in-driver-details.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-006_bug-keep-factory-identity-prominent-and-label-its-address-in-driver-details.docx>)

**Source title (verbatim):** Keep factory identity prominent and label its address in driver details

**SHA-256:** `bc26968cdb98f8fca4ba0ef1ad680f9539cdb6d2d0a364719be93878dd9443e6`

**Claimed folder:** QA_PASSED. **Audit:** DUPLICATE. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-038](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-038>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-038.txt>).

**Canonical records:** [KP-028](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-028>), [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-191>). No duplicate engineering implementation.

**Requirements read:**

- Keep factory identity prominent in driver detail header and collapsed state.
- Show the actual factory address with an explicit label and retain the route as route data.
- Handle short/full-name fallbacks without a misleading repeated row.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTripHeader.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTripHeader.tsx:28>) — Factory identity and subordinate route implement the same change as KP-028.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:98>) — Full-name fallback/duplicate handling and separate address row match KP-028.

**Missing, contradicted or unproven:**

- This is the QA006 subset already implemented and documented through KP-028.
- No separate current visual verification; later driver layout requirements should govern final arrangement.

**Target behavior / next work:**

- Retain KP-038 as a linked acceptance source under KP-028 and the latest driver detail package.
- Use a single full/short/missing factory and address verification matrix.

**Required independent checks:**

- Shared KP-028 identity/address/collapse tests.

**Closure-claim review:** The document references the same factory-detail report. Duplicate does not imply current visual signoff.

<a id="kp-039"></a>

### KP-039 — Improve readability of secondary dispatch information

**Source file:** [QA_PASSED/20260913_P2_QA-007_enhancement-improve-readability-of-secondary-dispatch-information.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-007_enhancement-improve-readability-of-secondary-dispatch-information.docx>)

**Source title (verbatim):** Improve readability of secondary dispatch information

**SHA-256:** `764412fee4458ad55fbcb065986f641b91664d38083dc16814c184b7deaf0bb4`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-039](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-039>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-039.txt>).

**Requirements read:**

- Make operational secondary dispatch text readable, including normal/hover/highlight backgrounds.
- Meet4.5:1 for normal-sized meaningful text and preserve compact typography.
- Do not make active data look disabled.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:566>) — Muted operational text uses --text-secondary with #64748b fallback instead of #94a3b8.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:605>) — Notes retain shared operational table font tokens rather than oversized text.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:361>) — Customer note uses the muted operational text class.

**Missing, contradicted or unproven:**

- Historical white-background computed contrast is not a complete current background/state matrix.
- Actual --text-secondary resolution, highlighted/hover surfaces and browser-rendered font sizes were not measured.
- Empty placeholders may be visually muted, but meaningful operational values need separate verification from genuinely disabled controls.

**Target behavior / next work:**

- Measure computed foreground/background contrast in normal, hover, selected, highlighted and error states.
- Use a shared contrast-safe operational token and adjust backgrounds or foregrounds only where measured contrast fails.
- Keep compact sizes while preserving readable weight/line height; retain a distinct disabled-control treatment.

**Required independent checks:**

- Computed contrast matrix at desktop/card layouts and visual readability checks.
- Regression for missing/empty versus active data styling.

**Closure-claim review:** A safer fallback exists; the reported single-background contrast value cannot establish every required current state.

<a id="kp-040"></a>

### KP-040 — Compact dispatcher phone cards and keep container codes readable

**Source file:** [QA_PASSED/20260913_P2_QA-011_enhancement-compact-dispatcher-phone-cards-and-keep-container-codes-readable.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-011_enhancement-compact-dispatcher-phone-cards-and-keep-container-codes-readable.docx>)

**Source title (verbatim):** Compact dispatcher phone cards and keep container codes readable

**SHA-256:** `a84e14c2f16710d08a02cf550ee285ec239cba4436063790662be7321d798e95`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-040](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-040>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-040.txt>).

**Requirements read:**

- Compact dispatcher phone records at 360/390/430px without splitting short container/type codes.
- Allow long names/notes to wrap and retain all operational actions.
- Preserve tablet/desktop table behavior.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:905>) — Phone-specific compact record rules prevent fragmented short codes and collapse empty notes.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:935>) — Atomic short values and wrapping long content are treated separately.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:240>) — Empty notes cell is explicitly identified for compact collapse.

**Missing, contradicted or unproven:**

- No current settled360/390/430 captures or action checks.
- The historical appendix names390/430 only;360 remains unproved even in that older report.
- Current minimum readable sizing, long-value wrapping and touch targets require rendered verification.

**Target behavior / next work:**

- Verify all three requested phone widths with short codes and very long names/notes.
- Exercise every retained row action and detail disclosure; inspect final bottom/side clearance.
- Check the same fixture in tablet/desktop layouts to avoid fixing phone through a global size reduction.

**Required independent checks:**

- 360/390/430 record geometry, long-content wrapping and actions.
- Desktop/tablet comparison and keyboard/touch access.

**Closure-claim review:** Relevant CSS exists. Historical partial viewport evidence is absent and does not support a current full responsive pass.

<a id="kp-041"></a>

### KP-041 — Complete staging evidence for remaining frontend regressions

**Source file:** [QA_PASSED/20260913_P2_QA-012_tech-debt-complete-staging-evidence-for-remaining-frontend-regressions.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-012_tech-debt-complete-staging-evidence-for-remaining-frontend-regressions.docx>)

**Source title (verbatim):** Complete staging evidence for remaining frontend regressions

**SHA-256:** `0d93d53af5093f8af8170ecf03eb08dfebf8cc6128e7937e13ba88f2ab87b49d`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-041](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-041>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-041.txt>).

**Requirements read:**

- Close every remaining frontend regression criterion with current build, fixture, screenshot/API result and explicit status.
- Cover positive/negative terminal and invalid-ID flows, actual LCL allocation and carrier lookup, forwarder/driver photos, physical camera, chunk recovery and 24h stability.
- Measure typography, responsiveness, contrast and touch targets, retaining final evidence.

**Connected current-source evidence:**

- [backend/src/tests/cus-shipment-workspace.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/cus-shipment-workspace.test.ts:2324>) — LCL allocation test bypasses the allocation action by seeding the post-allocation state.
- [frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts:31>) — Current issue default loses nonzero appointment minutes.
- [frontend/src/lib/chunk-error.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/chunk-error.ts:68>) — Recovery implementation exists but requires controlled deploy validation.
- [frontend/src/components/PhotoViewer.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/PhotoViewer.tsx:79>) — Pointer-pan implementation exists; source is not proof of the physical camera/pan scenarios.

**Missing, contradicted or unproven:**

- The generic campaign-complete appendix does not reconcile explicit gaps in KP-019/KP-032/KP-036/KP-037/KP-046.
- Historical report directories are absent, and no browser or release observation was performed for current HEAD.
- A counts/list-of-tickets closure is not evidence that every criterion or device worked.
- Approval-related old verification must be retired under the final no-internal-approval decision; offline replay must not be validated as a retained feature.

**Target behavior / next work:**

- Rebuild a criterion-level matrix with PASS/FAIL/BLOCKED/UNVERIFIED, current commit/build, actual route/role/viewport and retained evidence.
- Prioritize confirmed source gaps and their positive-path checks before broad visual repetition.
- Run camera/deploy/24h scenarios in suitable controlled environments; keep evidence limitations explicit.
- Replace superseded approval/offline acceptance cases with direct authorized online flow checks.

**Required independent checks:**

- All remaining named workflow and device/release scenarios, each with current evidence.
- Independent reconciliation that every original criterion has a valid current status.

**Closure-claim review:** A blanket QA-passed campaign statement is unsupported while its constituent documents disclose untested or still-incomplete requirements.

<a id="kp-042"></a>

### KP-042 — Allow container number updates without triggering the trip schedule guard

**Source file:** [QA_PASSED/20260913_P2_QA-013_bug-allow-container-number-updates-without-triggering-the-trip-schedule-guard.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-013_bug-allow-container-number-updates-without-triggering-the-trip-schedule-guard.docx>)

**Source title (verbatim):** Allow container number updates without triggering the trip schedule guard

**SHA-256:** `7b26362830c573bf05e646bd09f6b48053d56ece1a5c8760ce6c933b50e6fc4c`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-042](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-042>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-042.txt>).

**Requirements read:**

- Allow CUS number-only corrections on assigned nonterminal containers without triggering schedule/resource guards.
- Compare operational values rather than rejecting unchanged echoed fields.
- Preserve format/duplicate/terminal protections and write the correct container in multirow lots directly without approval.

**Connected current-source evidence:**

- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:349>) — Value-aware operational comparison excludes containerNumber and compares echoed type/weight/route/appointment/carrier fields.
- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:384>) — Only a linked trip plus actual operational mutation throws the schedule guard.
- [backend/src/services/cus-shipment-workspace-writes.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-shipment-workspace-writes.service.ts:397>) — Changed number is validated and checked for in-lot duplicates before update.

**Missing, contradicted or unproven:**

- The current UI roundtrip is not verified; the original appendix explicitly deferred it.
- Terminal/accounting-lock behavior, number format and multirow targeting require current integration results.
- No internal approval should be reintroduced while fixing guard granularity.

**Target behavior / next work:**

- Run the real CUS editor with unchanged type/weight echoes and a new valid number on an assigned trip.
- Assert schedule/resources remain unchanged and only the selected container changes after reload.
- Retain actual operational-change and terminal rejection cases, and verify no pending request is created.

**Required independent checks:**

- Number-only, identical echo, actual schedule/resource change, duplicate and terminal cases.
- Multi-container UI selection and persisted readback.

**Closure-claim review:** The precise value-aware guard is present. Historical red/green tests and current UI success remain unverified.

<a id="kp-043"></a>

### KP-043 — Refresh reassignment defaults after saving a new driver and vehicle

**Source file:** [QA_PASSED/20260913_P2_QA-014_bug-refresh-reassignment-defaults-after-saving-a-new-driver-and-vehicle.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-014_bug-refresh-reassignment-defaults-after-saving-a-new-driver-and-vehicle.docx>)

**Source title (verbatim):** Refresh reassignment defaults after saving a new driver and vehicle

**SHA-256:** `50d199e3f7e45cd23134d50ef9265710967a3638f9985092f1b23c87d238a9e4`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 4.

**Delivery:** [KP-043](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-043>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-043.txt>).

**Requirements read:**

- Reopening reassignment immediately or after a delay must show the saved assignment.
- Refresh on newer versions while preserving in-progress edits for unchanged versions.
- Late or out-of-order responses must not restore an older draft; preserve acceptance guards.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx:52>) — Draft seeding is keyed by tripId/version and ignores an unchanged version.
- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx:99>) — Successful mutation primes trip detail query data, invalidates it and closes.
- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.test.tsx:96>) — Tests newer-version reseed and same-version draft retention; save-cache test begins153.

**Missing, contradicted or unproven:**

- No current immediate/10-second reopen or real query race exercise.
- The seed logic accepts any different version; the tests inspected do not prove stale lower-version/out-of-order responses cannot reseed. Query cancellation/version monotonicity must be verified as a whole.
- Historical staging/defaults report is absent.

**Target behavior / next work:**

- Run save then immediate and delayed reopen against the same record.
- Simulate overlapping detail fetches with delayed older responses and confirm query/draft state never regresses; add an explicit version monotonicity rule only if the existing query behavior does not guarantee it.
- Keep unchanged-version drafts stable and refetch/lock when driver acceptance wins a concurrent race.

**Required independent checks:**

- Immediate/delayed reopen, same/new/lower version responses and overlapping fetches.
- Concurrent driver acceptance and stale expectedVersion rejection.

**Closure-claim review:** Cache priming and version-aware seeding are present; inspected tests cover common cases, not the full out-of-order requirement.

<a id="kp-044"></a>

### KP-044 — Keep customer service rows compact with concise missing data summaries

**Source file:** [QA_PASSED/20260913_P2_QA-015_enhancement-keep-customer-service-rows-compact-with-concise-missing-data-summaries.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-015_enhancement-keep-customer-service-rows-compact-with-concise-missing-data-summaries.docx>)

**Source title (verbatim):** Keep customer service rows compact with concise missing data summaries

**SHA-256:** `95e4c5f25f8974eece469543bded6fd00b5f249cf2c401bee8c89ca0d27f0b1e`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-044](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-044>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-044.txt>).

**Requirements read:**

- Keep incomplete CUS rows compact with a concise missing-data count.
- Reveal every missing item and provide appropriate direct editor links with mouse/keyboard/touch.
- Keep count/content coherent, focus return intact and read-only reasons clear.

**Connected current-source evidence:**

- [frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx:19>) — Maps missing-field codes to owning editor modes; declaration is deliberately non-actionable.
- [frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx:65>) — Native disclosure button exposes missingFields.length with aria-expanded/controls.
- [frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentMissingFieldsSummary.tsx:77>) — Every item is rendered; editable destinations use stable trigger IDs for focus restoration.

**Missing, contradicted or unproven:**

- No current dense table, expanded list, keyboard or touch verification.
- A count of missing fields may exceed the number of unique editor buttons because several fields share an editor; verify field-count semantics rather than assuming mismatch.
- Declaration remains a non-actionable external item with “controlled document flow” text; ensure the simplified no-internal-approval product has a clear valid destination or explanation.

**Target behavior / next work:**

- Verify count matches the complete missing-field list, including multiple fields owned by one editor.
- Exercise each enabled editor jump and focus return; show a useful read-only explanation for genuinely locked data.
- Align declaration guidance with the direct online workflow, removing obsolete internal approval routing if present downstream.

**Required independent checks:**

- Multiple missing fields, read-only destinations, declaration case and count consistency.
- Keyboard/touch disclosure, editor jump and focus return in dense rows.

**Closure-claim review:** The concise disclosure and editor mapping are implemented. Historical browser claims are not a current usability/accessibility pass.

<a id="kp-045"></a>

### KP-045 — Show driver acceptance before offering reassignment

**Source file:** [QA_PASSED/20260913_P2_QA-016_enhancement-show-driver-acceptance-before-offering-reassignment.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-016_enhancement-show-driver-acceptance-before-offering-reassignment.docx>)

**Source title (verbatim):** Show driver acceptance before offering reassignment

**SHA-256:** `3a8ac64918b340d65e40deb0aa194bf92e82e4ee7f4ffd2482ab5417dc89b6cb`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-045](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-045>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-045.txt>).

**Requirements read:**

- Distinguish issued trips from driver-accepted work before offering reassignment.
- Show known acceptance as a read-only state and preserve editable preacceptance work.
- Handle concurrent acceptance with rejection plus refreshed UI state.

**Connected current-source evidence:**

- [backend/src/services/trip-queries.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-queries.service.ts:513>) — Acceptance fact is projected from ORDER_RECEIVED.
- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.tsx:73>) — IN_TRANSIT+driverAccepted locks the editor; late save errors trigger refetch at116.
- [backend/src/services/driver-fulfillment.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-fulfillment.service.ts:180>) — Normal driver ORDER_RECEIVED transitions a CREATED trip to IN_TRANSIT within the command transaction.
- [frontend/src/features/dispatch/detailed-plan/TripReassignDialog.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/TripReassignDialog.test.tsx:199>) — A historical CREATED+acceptance fixture is deliberately kept editable, distinct from the normal acceptance path.

**Missing, contradicted or unproven:**

- No current concurrent acceptance browser/API proof or test run.
- The documented/tested CREATED+acknowledgement exception is broader than the plain “accepted locks” wording; normal acceptance makes that state IN_TRANSIT, but legacy/recovery records need an explicit consistent rule.
- This acceptance is the driver acknowledging work, not an internal approval gate; do not remove it merely because internal approvals are retired.

**Target behavior / next work:**

- Verify unaccepted IN_TRANSIT can be corrected and accepted IN_TRANSIT is visibly locked.
- Run the race where a driver accepts while the editor is open, confirming refreshed read-only state after409.
- Document and test how inconsistent legacy CREATED+ack records are repaired or treated; avoid silently relying on a fixture-only exception.

**Required independent checks:**

- Issued/unaccepted, normal accepted, terminal and concurrent acceptance cases.
- Legacy inconsistent status/acknowledgement recovery semantics.

**Closure-claim review:** Connected acceptance projection/lock exists. The historical exception and concurrent scenario remain unverified at current HEAD.

<a id="kp-046"></a>

### KP-046 — Open driver attachments in a readable full image viewer

**Source file:** [QA_PASSED/20260913_P2_QA-018_enhancement-open-driver-attachments-in-a-readable-full-image-viewer.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-018_enhancement-open-driver-attachments-in-a-readable-full-image-viewer.docx>)

**Source title (verbatim):** Open driver attachments in a readable full image viewer

**SHA-256:** `69d60fc5a063c80469291202090a13df11a109911e2037984d4644174e4da1a2`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 8.

**Delivery:** [KP-046](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-046>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-046.txt>).

**Requirements read:**

- Open any populated container/seal/report attachment in a readable full-image viewer.
- Support fit, zoom and pan; keyboard Escape/navigation; accessible opener/close and focus return.
- Retain compact thumbnails and preserve data after view/close/reload.

**Connected current-source evidence:**

- [frontend/src/components/PhotoViewer.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/PhotoViewer.tsx:50>) — Viewer handles Escape, arrows, zoom and reset keys.
- [frontend/src/components/PhotoViewer.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/PhotoViewer.tsx:79>) — Pointer pan is implemented when zoomed, with pointer capture.
- [frontend/src/components/PhotoViewer.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/PhotoViewer.tsx:114>) — Viewer renders a body portal with overlay, toolbar and transformed image.
- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:308>) — Populated slots use named buttons to open the shared viewer; parent renders it at708.
- [frontend/src/components/trip/DriverContainerCard.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.test.tsx:219>) — Test definition checks opening and Escape/opener focus return.

**Missing, contradicted or unproven:**

- Historical pan was explicitly not directly tested; one attachment used a mock key. No current physical or persisted-image test was performed.
- PhotoViewer itself lacks an explicit dialog role/aria-modal, focus containment or body scroll lock in its component; verify the full overlay manager behavior before treating keyboard/modal accessibility as complete.
- No current loading/broken-image, touch pinch/pan or close/background-scroll verification.

**Target behavior / next work:**

- Verify all three persisted image types with real readable fixtures and fit/zoom/pan on touch and pointer devices.
- Audit the connected overlay manager for dialog semantics, background interaction/scroll and focus containment; add missing behavior at the shared viewer layer.
- Ensure closing restores the original attachment button and never changes underlying attachment data.

**Required independent checks:**

- Real CONTAINER/SEAL/DELIVERY_NOTE after reload, zoom/pan, keyboard navigation/Escape.
- Screen-reader dialog semantics, focus containment, scroll lock and failed-image state.

**Closure-claim review:** Viewer functionality is present in code. Historical upload/view examples and mocked tests leave pan/device/accessibility and complete persisted-image coverage unproven.

<a id="kp-047"></a>

### KP-047 — Resolve the linked carrier consistently when selecting or typing a plate

**Source file:** [QA_PASSED/20260913_P2_QA-020_bug-resolve-the-linked-carrier-consistently-when-selecting-or-typing-a-plate.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-020_bug-resolve-the-linked-carrier-consistently-when-selecting-or-typing-a-plate.docx>)

**Source title (verbatim):** Resolve the linked carrier consistently when selecting or typing a plate

**SHA-256:** `47980131a65a30c9db90920f2236dfb6b6bd07decc9b6156a0e4f0fbbf54a478`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 4.

**Delivery:** [KP-047](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-047>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-047.txt>).

**Requirements read:**

- Selecting or typing an equivalent plate must resolve its active explicit carrier link consistently.
- Changed/cleared links must read back fresh; known unlinked internal trucks must retain legitimate OWN behavior and unknown plates remain manual.
- Preserve inactive-carrier validation and correct carrier/plate pairing on save/reload.

**Connected current-source evidence:**

- [backend/src/services/carrier-fleet-vehicle.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/carrier-fleet-vehicle.service.ts:40>) — Resolver normalizes plate and looks up active catalog vehicles, then active truck-carrier links.
- [frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx:714>) — Selecting a linked internal catalog truck promotes its explicit external carrier; an unlinked selected truck promotes OWN.
- [frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx:731>) — Typed free-text lookup fills carrier only for non-null carrierId. It neither resolves known internal OWN identity nor checks that the returned result still belongs to the currently typed plate.

**Missing, contradicted or unproven:**

- Current async callback can apply carrier A after the user has changed to plate B while carrier remains blank; it checks current carrierValue but not current vehicleValue or request identity.
- Selected unlinked trucks promote OWN; typed equivalent unlinked plates get null and stay carrier-less. The historical appendix treats blank as acceptable despite the record’s consistency/OWN requirement.
- No current live fleet-link edit and normal UI lookup/readback proof; the old fixture link was set via API after a UI automation limitation.

**Target behavior / next work:**

- Bind typed lookup results to the normalized plate/request identity; discard results after plate change, manual carrier selection, dialog close or a newer request.
- Return enough resolver identity to distinguish a known active internal truck from an unknown manual plate, and apply the same OWN/external rule for selection and typing.
- Verify link edit/clear/inactivation invalidates every consumer and save persists the correct carrier/plate pair.

**Required independent checks:**

- Slow A lookup followed by B typing with reversed response order; manual override and close/reopen.
- Linked/unlinked/unknown/inactive plate matrix with punctuation/case variants and full reload.

**Closure-claim review:** The common linked happy path exists, but current source does not satisfy stale-response protection or equivalent unlinked selection/typing behavior. No staged defect is claimed here.

<a id="kp-048"></a>

### KP-048 — Use 24 hour formatting in the CUS shipment drawer

**Source file:** [QA_PASSED/20260913_P2_QA-021_bug-use-24-hour-formatting-in-the-cus-shipment-drawer.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-021_bug-use-24-hour-formatting-in-the-cus-shipment-drawer.docx>)

**Source title (verbatim):** Use 24 hour formatting in the CUS shipment drawer

**SHA-256:** `6468cef0dd95b53040810f8ac2f44fa40e37f65f8f169d4de29c06be2e2bf5a9`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-048](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-048>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-048.txt>).

**Requirements read:**

- Use a fixed24-hour CUS drawer date/time format with no AM/PM dependence.
- Allow presets and exact typed values such as 20:46, 00:15 and 23:45, preserving save/reopen/reload.
- Keep shared creation behavior consistent and treat timezone persistence separately.

**Connected current-source evidence:**

- [frontend/src/features/shipments/cus/CusAppointmentPopover.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusAppointmentPopover.tsx:246>) — Typed path uses a buffered fixed-format text input; clipped native picker supports calendar selection without exposing locale formatting.
- [frontend/src/design-system/hooks/useBufferedDateTimeValue.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/hooks/useBufferedDateTimeValue.ts:28>) — Shared hook defines the HH:mm DD/MM/YYYY text contract.
- [frontend/src/features/shipments/cus/CusAppointmentPopover.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusAppointmentPopover.test.tsx:169>) — Tests exact24-hour entries across day boundary values.
- [frontend/src/features/shipments/cus/use-cus-detail.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/use-cus-detail.ts:299>) — CUS save converts draft local date/time through the dedicated timezone utility.

**Missing, contradicted or unproven:**

- No current actual input, calendar, save/reopen or deployed-locale browser test.
- A separate container schedule editor still uses native type=time with lang=en-GB; this record’s custom drawer behavior must not be generalized to every date/time field.
- Historical report is absent; formatting tests alone do not prove persistence/timezone correctness.

**Target behavior / next work:**

- Verify the actual CUS drawer’s typing, presets and calendar affordance on supported browser/device locales.
- Save20:46,00:15,23:45 and a preset, then reopen/reload and compare the persisted business timestamp.
- Reuse the proven shared input where other native controls violate the same product format, while keeping timezone conversion a separately tested concern.

**Required independent checks:**

- Fixed24-hour locale matrix, typed/preset/calendar paths and persistence.
- Separate timezone roundtrip and create-form parity tests.

**Closure-claim review:** The custom buffered drawer input and test definitions are present. Current browser and persistence completion remains unverified.

<a id="kp-049"></a>

### KP-049 — Align the CUS schedule preview with the selected time

**Source file:** [QA_PASSED/20260913_P2_QA-022_bug-align-the-cus-schedule-preview-with-the-selected-time.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-022_bug-align-the-cus-schedule-preview-with-the-selected-time.docx>)

**Source title (verbatim):** Align the CUS schedule preview with the selected time

**SHA-256:** `462a43aec0d88048abc769700e4794f4839788438c12634099c8ac12553e7716`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-049](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-049>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-049.txt>).

**Requirements read:**

- Selected picker time, draft preview and reopened value agree without a one-hour shift.
- Save/readback uses the same appointment instant; clearing and other fields are unaffected.
- Check desktop/phone and timezone differences without compensating stored values.

**Connected current-source evidence:**

- [frontend/src/lib/format.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/format.ts:69>) — Naive local date/time is formatted as its stated components; zoned instants use Asia/Ho_Chi_Minh.
- [frontend/src/lib/shipment-operations.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/shipment-operations.ts:49>) — Business-zone date/time formatting and +07:00 local-input conversion are explicit.
- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:233>) — Ledger preview uses the shared formatter.

**Missing, contradicted or unproven:**

- No current rendered picker/preview/save/reload or cross-timezone comparison was executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain the business-zone conversion boundary; verify all appointment renderers use it.
- Capture selected value, outgoing instant and refreshed preview for the same fixture/build.

**Required independent checks:**

- Picker values 13:30 and 20:46; save, reopen and reload; browsers in UTC+7 and UTC+8; date-boundary and cleared values.

**Closure-claim review:** Claims commit16148368, local appointment-popover REPORT and staging2 picker13:30 with DB06:30Z. Current implementation agrees with the intended conversion. Historical claim artifacts are unavailable and cannot support current completion.

<a id="kp-050"></a>

### KP-050 — Show the transport route beneath the factory on driver trip cards

**Source file:** [QA_PASSED/20260913_P2_QA-023_bug-show-the-transport-route-beneath-the-factory-on-driver-trip-cards.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-023_bug-show-the-transport-route-beneath-the-factory-on-driver-trip-cards.docx>)

**Source title (verbatim):** Show the transport route beneath the factory on driver trip cards

**SHA-256:** `26fcaed65ef5de1a8163e356a9d5197d8e3c060b396ef5ec7b1d772fb31b6c7e`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-050](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-050>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-050.txt>).

**Requirements read:**

- Board card shows factory short name followed by route name, not full street address.
- Full address remains in detail; ports/container/notes stay available and compact at 390px.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:115>) — Factory/route presentation uses routeName on the journey card.
- [backend/src/services/driver-journey-board.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-journey-board.service.ts:279>) — Board mapping provides routeName from connected route data.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:129>) — Detail retains factory address and contact facts.

**Missing, contradicted or unproven:**

- No fresh 390px card/detail comparison on known-route, long-route and missing-route fixtures.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Keep the card route and detailed street address separate.
- Retest the requested board fixtures and absent-route fallback at current build.

**Required independent checks:**

- Known factory and route, long Vietnamese names, absent route, and navigation to the full address in detail at 390/834/1440px.

**Closure-claim review:** Claims59d5d6e3 and journey-card-route-numberless-qa023-qa024 local/staging screenshots. Source implements the requested hierarchy; no current visual evidence checked.

<a id="kp-051"></a>

### KP-051 — Keep the container type visible when its number is not assigned

**Source file:** [QA_PASSED/20260913_P2_QA-024_bug-keep-the-container-type-visible-when-its-number-is-not-assigned.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-024_bug-keep-the-container-type-visible-when-its-number-is-not-assigned.docx>)

**Source title (verbatim):** Keep the container type visible when its number is not assigned

**SHA-256:** `e8aa9e86999e72ef1b9386914bafbc1f5db967fbcebf63fdff67c4ea257c1132`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-051](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-051>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-051.txt>).

**Requirements read:**

- Known container type remains visible when the container number is absent.
- Show honest missing-number text, replace it after numbering, and handle both type/number absent.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:81>) — Card visibility includes container type even without number/seal.
- [frontend/src/pages/DriverTripsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripsPage.tsx:159>) — Numberless card uses explicit placeholder and preserves type.

**Missing, contradicted or unproven:**

- Initial-number save/readback and all-null UI cases were not rerun.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Verify the known-type/missing-number branch and first-number transition on resettable current fixtures.

**Required independent checks:**

- 40HC with a NULL number; both type and number NULL; number assignment and reload; 390px wrapping without a duplicate type.

**Closure-claim review:** Claims59d5d6e3, local route-numberless evidence and staging2-qa024-numberless-type. Implementation present; historical same-commit claim does not prove current rendered transitions.

<a id="kp-052"></a>

### KP-052 — Provide factory invoice information in driver trip details

**Source file:** [QA_PASSED/20260913_P2_QA-025_requirement-gap-provide-factory-invoice-information-in-driver-trip-details.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-025_requirement-gap-provide-factory-invoice-information-in-driver-trip-details.docx>)

**Source title (verbatim):** Provide factory invoice information in driver trip details

**SHA-256:** `d48f54ef75babb41e9bdf9a728c091720558ecb2b16d8ec9e339cf999a4ddcec`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-052](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-052>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-052.txt>).

**Requirements read:**

- Show configured factory legal name, invoice address and tax code from factory data.
- Clearly separate customer invoice identity from the factory; never substitute customer data as factory data.
- Missing configuration is explicit; maintain readable compact detail and reload consistency.

**Connected current-source evidence:**

- [backend/src/services/driver.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver.service.ts:524>) — Factory invoice identity is selected from factory fee-invoice profiles, not customer identity.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:181>) — Factory heading and its fields render first.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:196>) — Customer company/address/tax fields render before the customer heading at line 208.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:168>) — Entire section is omitted if all invoice objects are absent; sparse address/tax fields are silently hidden.

**Missing, contradicted or unproven:**

- Customer fields currently fall under the preceding Factory heading, with Customer heading after those fields, contradicting clear party attribution.
- Entirely absent invoice data hides the requested honest factory-empty state; partial missing address/tax fields have no explicit state.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Render each party heading before a semantic group of that party fields; keep customer values in its own group.
- Define compact per-party/per-field missing-data text and ensure an unconfigured factory is explicit even when all invoice objects are absent.
- Add assertions for field ownership/order rather than merely asserting both heading strings exist.

**Required independent checks:**

- Use different factory and customer names, addresses and MST values; assert their grouped DOM order and inspect the 390px screenshot.
- All invoice objects NULL and partially configured factory profiles; verify source attribution after reload/readback.

**Closure-claim review:** Claims7174ebcb populated SUNRISE factory and separate customer plus honest-empty staging proof. Connected current JSX contradicts the separation claim; tests that only find headings do not establish correct grouping.

<a id="kp-053"></a>

### KP-053 — Save cleared container appointments in the CUS drawer

**Source file:** [QA_PASSED/20260913_P2_QA-026_bug-save-cleared-container-appointments-in-the-cus-drawer.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P2_QA-026_bug-save-cleared-container-appointments-in-the-cus-drawer.docx>)

**Source title (verbatim):** Save cleared container appointments in the CUS drawer

**SHA-256:** `21f67467147f63b19f4cf89f4e6f2bf3c471a1b1aafc604388e7e23d89dd7199`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 5.

**Delivery:** [KP-053](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-053>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-053.txt>).

**Requirements read:**

- Clearing an allowed appointment persists explicit NULL and exits dirty state.
- Do not change container/ports/pricing/other fields; show failed-save errors honestly.
- Set, replace, clear, cancel and reload respect readiness constraints.

**Connected current-source evidence:**

- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:40>) — Changed appointment draft emits explicit customerAppointmentAt:null rather than omission.
- [frontend/src/features/shipments/cus/use-cus-detail.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/use-cus-detail.ts:297>) — Normalizes empty/null appointment and routes a single change through save/error handling.
- [backend/src/tests/cus-shipment-workspace.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/cus-shipment-workspace.test.ts:2344>) — DB-backed tests cover allowed clearing and readiness rejection.

**Missing, contradicted or unproven:**

- Actual current tap/save/readback and unchanged sibling-field verification were not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain explicit NULL semantics and business readiness validation.
- Rerun the allowed-clear and last-required-appointment rejection cases with current browser and DB evidence.

**Required independent checks:**

- Clearing in PENDING persists NULL; clearing the last required appointment in READY rejects without side effects; set, replace and cancel; no mixed-field patch or stale dirty state.

**Closure-claim review:** Claims346c75c0,73backend tests and later real-tap plus DB proof for staging-qa026-cleared-appointment. The code and relevant tests support intended branches, but historical test results were not recovered or rerun.

<a id="kp-054"></a>

### KP-054 — Display container type once in the driver container summary

**Source file:** [QA_PASSED/20260913_P3_QA-008_enhancement-display-container-type-once-in-the-driver-container-summary.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P3_QA-008_enhancement-display-container-type-once-in-the-driver-container-summary.docx>)

**Source title (verbatim):** Display container type once in the driver container summary

**SHA-256:** `f2b73f6abc75855333365ae79d18eac3840a7fc4dfcddf5313edbb6741ee210d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-054](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-054>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-054.txt>).

**Requirements read:**

- Render one human-readable container type rather than duplicated 20DC variants.
- Preserve number/seal/edit behavior and support other container types.

**Connected current-source evidence:**

- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:394>) — Saved container displays containerTypeName once without appending raw code.

**Missing, contradicted or unproven:**

- No current visual/edit/readback verification for type variants.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain one canonical label and confirm no second component reintroduces the raw code.

**Required independent checks:**

- 20DC, 40HC, 45 and unknown types; edit/cancel number and seal; compact phone rendering.

**Closure-claim review:** Claims59d5d6e3 with qa008-container-type-once and staging wildcard evidence. Requested source change exists; current browser verification remains open.

<a id="kp-055"></a>

### KP-055 — Correct the Vietnamese towing capacity label in truck editing

**Source file:** [QA_PASSED/20260913_P3_QA-009_bug-correct-the-vietnamese-towing-capacity-label-in-truck-editing.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P3_QA-009_bug-correct-the-vietnamese-towing-capacity-label-in-truck-editing.docx>)

**Source title (verbatim):** Correct the Vietnamese towing capacity label in truck editing

**SHA-256:** `c5a38936e782a8ce52cc97409a0422e02b20dee6a59ac9413a4cf54e5b5d2c72`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-055](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-055>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-055.txt>).

**Requirements read:**

- Use Trọng tải kéo consistently in truck create/edit.
- Preserve unit, saved value and validation.

**Connected current-source evidence:**

- [frontend/src/features/fleet/TruckFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/TruckFormModal.tsx:197>) — Shared truck form label uses Trọng tải kéo.

**Missing, contradicted or unproven:**

- Actual shared create/edit screen and value preservation not rerun.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Run the shared form label regression and visually check create/edit without changing the value.

**Required independent checks:**

- Create/edit label, tonnage unit, validation and preservation of the existing value.

**Closure-claim review:** Claims TruckFormModal as the only occurrence and source-label unit/report evidence. Current label is corrected; source text alone does not verify all rendered call sites.

<a id="kp-056"></a>

### KP-056 — Use concise driver instructions when accepting an order

**Source file:** [QA_PASSED/20260913_P3_QA-017_enhancement-use-concise-driver-instructions-when-accepting-an-order.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260913_P3_QA-017_enhancement-use-concise-driver-instructions-when-accepting-an-order.docx>)

**Source title (verbatim):** Use concise driver instructions when accepting an order

**SHA-256:** `06eb922d4d509f5a6d22498c62ef25657b2bd226de5a863420aad1941057bfe7`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-056](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-056>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-056.txt>).

**Requirements read:**

- Concise stable Vietnamese describes acceptance action and actual effect.
- Remove temporary/internal Ops implementation copy and preserve visible compact action.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripDetailPage.tsx:374>) — Acceptance helper says to check details then accept; next sentence states trip begins after acceptance.

**Missing, contradicted or unproven:**

- Current action visibility and correspondence to successful server acceptance not rerun.
- Acceptance is an operational acknowledgement; it must not be turned into internal approval or offline replay.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Keep short instructions aligned with direct online acceptance and actual state transition.

**Required independent checks:**

- Unaccepted, accepted and busy trips; keyboard use and action visibility at 390px; the shared online requirement blocks the action when disconnected.

**Closure-claim review:** Claims5979664c and34/34 tests with new concise copy plus staging evidence. Copy change exists; wider acceptance/offline transition needs current verification.

<a id="kp-057"></a>

### KP-057 — Stable detailed-plan row identities

**Source file:** [QA_PASSED/20260914_1-duplicate-react-key-dispatch-plan-screens.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_1-duplicate-react-key-dispatch-plan-screens.docx>)

**Source title (verbatim):** Nguồn: QA-001 batch sweep (2026-09-13, testplan/qa/evidence/2026-09-13_dispatch-minutes-qa001/10-console-logs.txt) — phát hiện ngoài phạm vi thẻ QA-001.

**SHA-256:** `9080eff00d766ce1cc656bbbdc9cc465c0aabd77c3e0abd131aa708d2de9f5a3`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 1.

**Delivery:** [KP-057](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-057>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-057.txt>).

**Requirements read:**

- Unique stable keys for fulfillment and fulfillment-less rows across detailed/master plans.
- Missing appointment/container data must not create duplicate-key warnings; sorting/filtering keeps identity.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:39>) — Keys use fulfillment id, container id, then shipment identity fallback.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx:616>) — Regression renders several fulfillment-less branches and inspects duplicate-key console warnings.
- [frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/master-plan/MasterPlanGrid.tsx:279>) — Master rows use item.id.

**Missing, contradicted or unproven:**

- Current full mixed dataset and browser sort/filter console have not been checked.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retest all row families, including multiple branch rows from one shipment, with warning capture.

**Required independent checks:**

- Missing time/number; branches from the same shipment; sorting, filtering and reordering; zero duplicate-key warnings and stable selection.

**Closure-claim review:** Claims9704b809,2unit checks and zero console warnings in staging/detail+master sorting. Targeted implementation and regression source are present; claimed outputs unavailable.

<a id="kp-058"></a>

### KP-058 — Container PATCH regression coverage

**Source file:** [QA_PASSED/20260914_10-driver-container-route-wiring-test.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_10-driver-container-route-wiring-test.docx>)

**Source title (verbatim):** Nguồn: 20260914_9 review finding 3 — bảo vệ fix khỏi revert thầm lặng.

**SHA-256:** `96ae228cd79905be5cbed7f7698c6171bf93f1ca8d4b0413acd0f6c2f7c2e46c`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-058](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-058>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-058.txt>).

**Requirements read:**

- Real authenticated POST and PATCH routes must exercise validated schemas and idempotency binding.
- Malformed/check-digit values return 400 with no write; canonical valid input persists.
- Reverting either route to permissive schema must fail the regular regression suite.

**Connected current-source evidence:**

- [backend/src/tests/driver-container-routes.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/driver-container-routes.test.ts:128>) — Harness mounts actual auth/authorization and driverRoutes on HTTP server.
- [backend/src/tests/driver-container-routes.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/driver-container-routes.test.ts:141>) — POST tests malformed, wrong-check-digit and canonical valid values.
- [backend/src/tests/driver-container-routes.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/driver-container-routes.test.ts:161>) — PATCH coverage only clears an existing number; no malformed PATCH rejection test.
- [backend/src/routes/driver.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/driver.ts:859>) — Production PATCH currently uses the validated schema.

**Missing, contradicted or unproven:**

- PATCH reverting to a permissive schema can still satisfy the existing clear-only PATCH test.
- Current tests not executed and regular CI inclusion not demonstrated by a fresh run.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Add authenticated malformed and wrong-check-digit PATCH cases asserting unchanged number/version and no idempotency side effects.
- Add canonical valid PATCH, clear and replay checks; demonstrate a temporary permissive-schema mutation makes the test fail without committing that mutation.

**Required independent checks:**

- Actual POST/PATCH return 400 without writes for invalid input; canonicalization; permitted empty-value clearing; same-key replay; each route test detects a validation regression.

**Closure-claim review:** Claimsb6bbee71,3/3 actual HTTP tests and staging cut9 API evidence. Harness is real, but coverage does not meet the explicit revert-either-route criterion.

<a id="kp-059"></a>

### KP-059 — Route information on the actual OPS order page

**Source file:** [QA_PASSED/20260914_11-ops-orders-route-fallback.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_11-ops-orders-route-fallback.docx>)

**Source title (verbatim):** Nguồn: QA-045 staging round 3 (88) — scope gap: thẻ gốc nêu /ops/orders nhưng fix landed ở detail-plan.

**SHA-256:** `fa4ba7ac273d0374968a2fea17eb63630728b8921851ca41d166456e64e91d01`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 2.

**Delivery:** [KP-059](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-059>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-059.txt>).

**Requirements read:**

- Actual /ops/orders uses known container/route information instead of dash.
- Multiple routes have deterministic aggregate presentation; truly absent route is explicit.
- Keep list values consistent with source records and test real route.

**Connected current-source evidence:**

- [backend/src/services/ops-orders.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-orders.service.ts:65>) — Route scalar subquery aggregates distinct container route names in stable order, then falls back to shipment route.
- [frontend/src/pages/OpsOrdersPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/OpsOrdersPage.tsx:116>) — Null route renders explicit missing-route text.
- [frontend/src/pages/OpsOrdersPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/OpsOrdersPage.test.tsx:75>) — Known and absent-route presentation have source tests.

**Missing, contradicted or unproven:**

- Current browser mixed-route and fallback fixtures not rerun.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Use this as the /ops/orders work package, overlapping original KP086; do not file duplicate route-display work.
- Verify deterministic multi-route aggregation and genuine missing source data.

**Required independent checks:**

- One known route; several distinct routes; no container route with a shipment-route fallback; all routes missing; search, sort and three widths.

**Closure-claim review:** Claimsbf321535 and build4fc23c36 known21/20 versus missing26. Current implementation addresses original /ops/orders route rather than only detailed-plan sibling.

<a id="kp-060"></a>

### KP-060 — User-create email validation parity

**Source file:** [QA_PASSED/20260914_12-user-add-panel-email-validation-parity.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_12-user-add-panel-email-validation-parity.docx>)

**Source title (verbatim):** Nguồn: QA-062 boundary flag (2026-09-14) — cùng pattern, path CREATE.

**SHA-256:** `f64e117a7bd166df2dd44192f7ea66e2682da0300c0774e3563dd769dc2db1a6`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-060](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-060>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-060.txt>).

**Requirements read:**

- User creation rejects invalid email with Vietnamese field-level explanation, focus and associated invalid state.
- Valid/empty-optional email and other fields continue to work.

**Connected current-source evidence:**

- [frontend/src/features/users/components/UserAddPanel.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/UserAddPanel.tsx:91>) — Submit performs email validation and focuses the email input before onSave.
- [frontend/src/features/users/components/UserAddPanel.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/UserAddPanel.tsx:180>) — Email receives aria-invalid, aria-describedby and an alert error container.

**Missing, contradicted or unproven:**

- Appended evidence uses direct API 400/201, which cannot verify UI focus, Vietnamese copy or field association.
- Current create-panel keyboard/DOM interaction not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Add/execute create-panel interaction coverage for invalid/valid/empty email and check first invalid-field focus.
- Verify at three widths on the exact create panel.

**Required independent checks:**

- Saving an invalid email sends no request, announces a Vietnamese error and focuses Email; correction clears the error; valid and optional blank cases.

**Closure-claim review:** Claims9e09c901 and18tests; appended staging QA only exercises direct API validation. Source supports UI behavior, but the completion evidence described does not prove its UI acceptance criteria.

<a id="kp-061"></a>

### KP-061 — Import trailer assignment invariant

**Source file:** [QA_PASSED/20260914_13-fleet-import-trailer-double-claim-guard.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_13-fleet-import-trailer-double-claim-guard.docx>)

**Source title (verbatim):** Nguồn: QA-049 review finding 4 (2026-09-14).

**SHA-256:** `5498b3dcfad09df6dc6eeaef1c8256411c1295ba7d9982a780f56e47ee1dc94b`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-061](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-061>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-061.txt>).

**Requirements read:**

- September fleet import cannot leave two trucks claiming the same trailer.
- Apply the same transfer-auto-clear semantics used by catalog CRUD.

**Connected current-source evidence:**

- [backend/src/services/master-data-import-sep2026.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/master-data-import-sep2026.service.ts:599>) — Within import transaction, clears other truck currentTrailerId before assigning destination truck.
- [backend/src/services/master-data-import-sep2026.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/master-data-import-sep2026.service.ts:605>) — Destination truck coupling is set in same transaction.

**Missing, contradicted or unproven:**

- Document explicitly omits XLSX/import harness; DB snapshot showing zero duplicates is not proof the actual import path preserves the invariant.
- Concurrent imports and mirrored legacy plate fields remain unverified.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Build a resettable minimal import fixture with an already-coupled trailer and another target truck.
- Exercise actual import apply, replay and failure rollback; inspect both coupling id and displayed legacy plate fields.
- Use the common coupling invariant/locking path for competing import/CRUD operations.

**Required independent checks:**

- Import moves trailer A from truck 1 to truck 2 with one active claimant; repeated import; rollback after a later row fails; concurrent import and edit.

**Closure-claim review:** Claimseaab9703, mirrored CRUD implementation, no XLSX test harness, staging zero duplicate trailer claims. Requested clearing implementation exists. Actual importer behavior remains unverified; a dedicated import harness is recommended closure evidence, not an explicit original deliverable.

<a id="kp-062"></a>

### KP-062 — Dispatcher direct container-number correction

**Source file:** [QA_PASSED/20260914_14-dispatch-edit-container-count.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_14-dispatch-edit-container-count.docx>)

**Source title (verbatim):** Nãy tôi thử điều chỉnh bổ sung số cont của 1 cont trong lô hàng (khi tạo lô hàng chưa điền), role điều vận không cho sửa, role cus sửa được. mở cho phép điều vận sửa nhé và không cần phê duyệt nhé

**SHA-256:** `6da7edca91c4ae7a2be32d295b7d6ae33a4d345728ae502622789fef91ff10ce`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-062](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-062>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-062.txt>).

**Requirements read:**

- Dispatcher may directly edit container number on existing linked trip without internal approval.
- Route/port and accounting-lock restrictions remain explicit; customer ledger reads saved number.

**Connected current-source evidence:**

- [backend/src/services/cus-workspace-builders.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/cus-workspace-builders.service.ts:717>) — Dispatcher containerNumber field access becomes DIRECT when accounting lock is absent.
- [backend/src/tests/cus-shipment-workspace.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/cus-shipment-workspace.test.ts:772>) — Role/field access matrix includes linked Dispatcher and accounting-lock cases.

**Missing, contradicted or unproven:**

- Appended API save/readback does not prove editor affordance, keyboard operation or UI refresh.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Verify the actual Dispatcher editor is enabled only for the intended field and current permissions.
- Preserve direct correction; do not introduce a replacement approval stage.

**Required independent checks:**

- Dispatcher changes an existing trip container number and reads it back; locked-period denial; CUS/Accountant permission matrix; unchanged route/ports; three sizes.

**Closure-claim review:** Claimsc54d1575,74role tests and stagingAPI200 withCUS readback. Source permissions align; browser behavior and current test pass are unverified.

<a id="kp-063"></a>

### KP-063 — Direction-aware driver destinations and contact labels

**Source file:** [QA_PASSED/20260914_143_bug-hide-redundant-empty-container-return-when-equal-to-unloading-port.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_143_bug-hide-redundant-empty-container-return-when-equal-to-unloading-port.docx>)

**Source title (verbatim):** Màn hình chi tiết lái xe — ẩn "Trả cont rỗng" khi cảng hạ = nơi trả

**SHA-256:** `1723c229eb584a21dbd82c8d1f4686193ff20e53aae76a235ea62bc260137390`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 3.

**Delivery:** [KP-063](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-063>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-063.txt>).

**Requirements read:**

- Hide redundant empty-container return when identical to unloading destination; show different return and hide missing return.
- Use requested contact label Số điện thoại liên hệ and preserve contact action.
- Cover equal/different/null destinations and compact phone detail.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:160>) — Return-depot fact is conditional on nonempty value different from dropPoint.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:142>) — Current contact label is abbreviated SĐT liên hệ, differing from explicit requested full wording.
- [frontend/src/pages/driver/DriverTaskInfoSections.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.test.tsx:249>) — Tests cover differing/equal/absent return destination.

**Missing, contradicted or unproven:**

- Explicit AC4 full contact wording remains different in current source; the completion narrative accepts an abbreviation without a recorded user change.
- No current browser retest; historical full frontend suite reportedly had 24 failures.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Resolve the literal contact copy against the requested full wording; use the specified label unless the user accepts abbreviated copy.
- Retest destination comparisons without removing genuinely distinct return information.

**Required independent checks:**

- Equal, different and null return destinations; exact contact-label assertion and telephone action; full names/long labels at 390px; current relevant suites.

**Closure-claim review:** Claims two QA rounds,20/20 focused tests,1827pass/24preexisting failures, stagingequal/differentsite proof. Main conditional is implemented. Exact copy acceptance is not, and old failing full-suite statement is not a clean current pass.

<a id="kp-064"></a>

### KP-064 — Isolated adjustment idempotency tests

**Source file:** [QA_PASSED/20260914_15-adjustments-test-rerun-409-isolation.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_15-adjustments-test-rerun-409-isolation.docx>)

**Source title (verbatim):** Adjustments comprehensive test reruns 409 against a shared dev DB

**SHA-256:** `6698a30f10afca51b86e508ff7201a4df3ca85b73aabb7da749ec56bbbb2ca7c`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 0.

**Delivery:** [KP-064](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-064>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-064.txt>).

**Requirements read:**

- Adjustment tests pass twice consecutively and reject same key with different payload 409.
- Fix actual cause rather than weakening idempotency or using accidental shared data.
- Document failure mechanism and relevant test evidence.

**Connected current-source evidence:**

- [backend/src/routes/financial/payments.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/payments.routes.ts:218>) — Adjustment creation calls the service which owns auto-apply rather than nesting duplicate governance processing.
- [backend/src/tests/comprehensive.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/comprehensive.test.ts:620>) — Uses fresh trip-scoped key and asserts successful adjustment plus changed-payload 409.

**Missing, contradicted or unproven:**

- No current two-consecutive-run outputs; historical root-cause note is not executable proof.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Run the relevant integration group twice against isolated resettable DB fixtures.
- Keep changed-payload 409 and direct authorized adjustment behavior.

**Required independent checks:**

- Two consecutive suite runs; same-key/same-payload replay applies once; same key with a changed payload returns 409; version conflict preserves form inputs.

**Closure-claim review:** Claims double-autoApply root cause corrected after initial shared-key hypothesis,7/7twice and staging201/409. Current route/test matches corrected explanation; consecutive-run requirement remains unverified.

<a id="kp-065"></a>

### KP-065 — Component structure guards

**Source file:** [QA_PASSED/20260914_16-refreeze-structure-guard-ceilings.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_16-refreeze-structure-guard-ceilings.docx>)

**Source title (verbatim):** Refreeze structure-guard ceilings after fleet/profit/ops overshoots

**SHA-256:** `e346eb7d11a6f042180f1aa15e7bbe1f0847cd17579d637fc993f4083bf73389`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-065](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-065>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-065.txt>).

**Requirements read:**

- Dated honest ceilings for large files, full guard green and entries still exist.
- PenaltyReasonsPage stays below 593 lines through extraction.
- Record explicit follow-up shrinking rather than unlimited ceiling inflation.

**Connected current-source evidence:**

- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:110>) — Current RoleWorkInbox ceiling of 499 lines includes explained later six-line growth.
- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:169>) — Trailer, truck and penalty ceilings of 418, 450 and 593 lines exist.
- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:262>) — ProfitAnalysis ceiling of 591 lines remains pinned.
- [frontend/src/tests/structure.guard.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/tests/structure.guard.test.ts:280>) — Guard counts relevant TS/TSX source and verifies listed files.

**Missing, contradicted or unproven:**

- Read-only counts match current ceilings: RoleWorkInbox 499, trailer 418, truck 450, ProfitAnalysis 591, and PenaltyReasonsPage 581 against a 593-line ceiling. The full guard suite has not run.
- Explicit actionable shrink work packages and current tests proving extracted behavior are not established by the ceiling assertions.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain frozen, justified limits; execute whole guard before status closure.
- Track concrete component extraction targets and behavior tests rather than repeatedly enlarging ceilings.

**Required independent checks:**

- Full structure guard; all listed paths exist; behavior tests for extracted dialogs/rows; no stale allowlist entries.

**Closure-claim review:** Claims076d5c58 ceilings493/418/450/591 andPenalty563 with stagingbuild9d064b50. Current source differs slightly from historical counts; ceilings are currently respected by independent read-only counting, not a fresh full test run.

<a id="kp-066"></a>

### KP-066 — Reachable non-FCL transport date editor

**Source file:** [QA_PASSED/20260914_2-ledger-transport-date-edit-affordance.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_2-ledger-transport-date-edit-affordance.docx>)

**Source title (verbatim):** Nguồn: QA-015 review (2026-09-14) — phát hiện INFO ngoài phạm vi thẻ.

**SHA-256:** `cd0f4a3f5bbd3812ea91b964db6347ea7a673b4a0406bab80c497ee57ace9106`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 1.

**Delivery:** [KP-066](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-066>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-066.txt>).

**Requirements read:**

- Ledger provides discoverable transport-date edit for non-FCL whole lot.
- Respect access permissions and restore trigger focus after save/cancel.
- Both appointment/transport editor paths remain consistent.

**Connected current-source evidence:**

- [frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentContainerLedger.tsx:538>) — Stable labelled editor trigger and busy/competing-editor guards are present.
- [frontend/src/features/shipments/detail/ShipmentContainerScheduleEditor.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/detail/ShipmentContainerScheduleEditor.tsx:100>) — Non-FCL whole-lot transport DateInput is connected and gated.
- [frontend/src/features/shipments/cus/use-cus-detail.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/use-cus-detail.ts:126>) — Editor trigger focus is retained and restored.
- [frontend/src/features/shipments/cus/use-cus-detail.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/use-cus-detail.ts:297>) — Transport-only save path is distinguished from appointment update.

**Missing, contradicted or unproven:**

- Document explicitly says staging verification was bundle-string only and UI spot check was not completed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Run the actual non-FCL ledger action through save/cancel/readback rather than treating deployed text as UI proof.

**Required independent checks:**

- Authorized LCL/whole-lot edit and read-only role; Tab, Enter, Escape and focus return; date persists after reload; appointment path unaffected.

**Closure-claim review:** Claims457e85be,7/7local and bundle string presence; explicitly no completed staging UI spot-check. Implementation is present, but the record itself disclaims required end-to-end evidence despite QA_PASSED placement.

<a id="kp-067"></a>

### KP-067 — Appointment popover regression contract

**Source file:** [QA_PASSED/20260914_3-shipments-page-test-red-on-head-popover-contract.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_3-shipments-page-test-red-on-head-popover-contract.docx>)

**Source title (verbatim):** Nguồn: 20260914_2 full-suite chạy (7f, stash-proof trên prod HEAD) — test đỏ trên trunk.

**SHA-256:** `90c6ae23b46eea86ae1a378c5abbd9918a0a6ec53df3aca84458f68a899b1921`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-067](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-067>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-067.txt>).

**Requirements read:**

- Determine stale test expectation versus UI regression; test actual 24hDayTime contract.
- Both existing popover paths agree; current frontend suite all green.

**Connected current-source evidence:**

- [frontend/src/pages/ShipmentsPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ShipmentsPage.test.tsx:1268>) — Test now locates the actual Ngày giờ datetime input.
- [frontend/src/features/shipments/cus/CusAppointmentPopover.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusAppointmentPopover.tsx:32>) — Popover uses the shared local business-time conversion.

**Missing, contradicted or unproven:**

- No current complete frontend run establishes 100% pass or both popover paths together.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Rerun both popover interaction suites and full frontend suite using the exact HEAD.
- Keep assertions on selected value/save semantics rather than only revised labels.

**Required independent checks:**

- Set, replace, clear and cancel in existing/create popovers; 24-hour time representation; full frontend suite without unexpected failures.

**Closure-claim review:** Claimsa31357a3 label expectation update and1769green tests, no recoverable output path. Test contract change exists; historic count is not current execution evidence.

<a id="kp-068"></a>

### KP-068 — Compact driver detail facts

**Source file:** [QA_PASSED/20260914_4-driver-detail-mobile-layout-tweaks.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_4-driver-detail-mobile-layout-tweaks.docx>)

**Source title (verbatim):** The existing UI is almost same with target, but the layout ngay gio ke hoach and nha may (short name should be same row)

**SHA-256:** `c8e1fd7a731926a8c2a2b3d7c121802e714f31fac83af91e1c922d0542f71a4d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 2.

**Delivery:** [KP-068](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-068>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-068.txt>).

**Requirements read:**

- Schedule and factory short name share first row; contact phone directly follows factory address.
- Quantity uses grouped 1×20DC idiom while actual container/seal remain available.
- Long/missing facts stay readable at 390px.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:118>) — Schedule/factory facts lead the grid and phone follows address.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:82>) — Container quantities group by type using count×type while preserving later number facts.
- [frontend/src/pages/driver/DriverTaskInfoSections.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.test.tsx:281>) — Quantity formatting has focused test coverage.

**Missing, contradicted or unproven:**

- Current visual row placement at actual phone/tablet/desktop and long-text fixtures is not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Verify responsive layout using populated and sparse examples; keep compact alignment without shrinking text/touch affordances.

**Required independent checks:**

- Schedule and factory share the first row at 390px; long address/phone; multiple types/counts; missing factory/phone; grouped quantity versus actual container number.

**Closure-claim review:** Claims2bc0d872,51tests and390px staginge72f10c5. Requested hierarchy and grouping exist in source; current browser proof absent.

<a id="kp-069"></a>

### KP-069 — Detailed-plan route fallback without a fulfillment

**Source file:** [QA_PASSED/20260914_6-ops-plan-route-fulfillment-less-fallback.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_6-ops-plan-route-fulfillment-less-fallback.docx>)

**Source title (verbatim):** Nguồn: QA-045 review (2026-09-14) — MEDIUM follow-up ngoài scope thẻ gốc.

**SHA-256:** `8b5330808ce14492972bdbf1170bb63a6ccd58a9e8954788c93db4441b258698`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-069](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-069>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-069.txt>).

**Requirements read:**

- Detailed Ops plan uses shipment route when fulfillment-less container route is missing.
- Known container route takes precedence; truly absent source remains honest; master plan unchanged.

**Connected current-source evidence:**

- [backend/src/services/dispatch-detail-plan-fulfillment-less.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-detail-plan-fulfillment-less.ts:162>) — Fulfillment-less query coalesces container route with shipment route.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:268>) — Grid displays the supplied route/destination or explicit missing state.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.test.tsx:700>) — Grid tests cover supplied route and missing fallback display.

**Missing, contradicted or unproven:**

- Reported staging rows had shipmentRouteId set to NULL, so they did not exercise a populated shipment-route fallback.
- Current backend fixture for the exact fallback branch was not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Create a fulfillment-less container with no container route and a known shipment route; verify API and rendered grid.
- Keep this separate from /ops/orders aggregate policy in KP059.

**Required independent checks:**

- Container route takes precedence; populated shipment fallback; both routes null; master/detail consistency without imposing the same mixed-route aggregation policy.

**Closure-claim review:** Claims8cc7d8b7,78tests and twoAPIrows, one known and one missing. Fallback source is implemented; claimed staging example does not prove the decisive branch.

<a id="kp-070"></a>

### KP-070 — Retire obsolete expense-review buttons

**Source file:** [QA_PASSED/20260914_7-expense-review-buttons-stop-propagation.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_7-expense-review-buttons-stop-propagation.docx>)

**Source title (verbatim):** Nguồn: QA-086 browser rung (88, 2026-09-14) — phát hiện mới.

**SHA-256:** `826836adf80259fd4e7c81f2b0875dc31d79646e3313460cc2eebafa25de45fd`

**Claimed folder:** QA_PASSED. **Audit:** SUPERSEDED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-070](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-070>) in [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-070.txt>).

**Canonical records:** [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-150>). No duplicate engineering implementation.

**Requirements read:**

- Original task isolates Kiểm tra/Duyệt/Từ chối clicks from row navigation and preserves outside-row editing.
- Latest user decision supersedes those internal review actions: remove approvals rather than polish their event handling.

**Connected current-source evidence:**

- [frontend/src/pages/ExpenseListPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseListPage.tsx:88>) — Shared review action handler stops propagation.
- [frontend/src/pages/ExpenseListPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseListPage.tsx:373>) — Internal review buttons still render in the expense list.

**Missing, contradicted or unproven:**

- Current source retains the approval actions that the user has explicitly directed engineers to remove.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retire this stop-propagation ticket as superseded, preserving its filename/history.
- Remove internal approval buttons/states and wire direct authorized expense operations under the approval-removal work package.
- Retain general row/action event isolation for surviving ordinary actions.

**Required independent checks:**

- Expense completion requires no internal approval controls/routes; surviving edit/delete actions are keyboard accessible and do not trigger unintended row navigation.

**Closure-claim review:** Claimsae22ba8b stopPropagation and staging stillOnList proof. Old behavior is implemented but its approval-specific target is now obsolete; do not use it to justify retaining approval UI.

<a id="kp-071"></a>

### KP-071 — Driver delivery-point fallback

**Source file:** [QA_PASSED/20260914_8-drop-point-fallback-hardening.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_8-drop-point-fallback-hardening.docx>)

**Source title (verbatim):** Nguồn: P1_5 khảo sát (52, 2026-09-14) — hardening tìm thấy, defect chưa tái hiện.

**SHA-256:** `594e0567d17dc34e4aaf59b85d893a926a324deb215312f6e47b348bc6837e69`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-071](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-071>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-071.txt>).

**Requirements read:**

- Known delivery location must not disappear when optional primary field is absent.
- Use canonical delivery-stage source fallback and honest empty state; preserve return-depot distinction.

**Connected current-source evidence:**

- [backend/src/services/driver.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver.service.ts:727>) — Backend resolves delivery snapshot, explicit shipment delivery location and container dropoff port through one delivery-stage resolver.
- [frontend/src/api/driverClient.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/api/driverClient.ts:338>) — Resolved deliveryLocation maps to driver UI drop fields.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:74>) — UI has drop-port/warehouse fallback and final em dash.

**Missing, contradicted or unproven:**

- Historical sample with both fields set to NULL did not prove a populated alternate source.
- No current each-source fallback and return-depot comparison run.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Use the connected backend resolver rather than inventing separate conflicting frontend precedence.
- Verify each source independently with higher-priority source absent.

**Required independent checks:**

- Delivery snapshot only; explicit delivery location only; container drop-off only; all sources missing; distinct return destination; preserved contact/address.

**Closure-claim review:** Claims frontend dropPortName??dropWarehouseName hardening and18tests; staging bothnull sample. Current complete caller chain supplies the requested alternative source behavior even though variable names differ from original proposal.

<a id="kp-072"></a>

### KP-072 — Container-number format at each mutation boundary

**Source file:** [QA_PASSED/20260914_9-driver-add-path-container-validation.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_9-driver-add-path-container-validation.docx>)

**Source title (verbatim):** Nguồn: QA-060 review (2026-09-14) — cùng bug-class, path khác.

**SHA-256:** `c54e0a3e13338688d964aa9cc3b2705b7260dcf1c01540cfe33ac88d7490eaa2`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 0.

**Delivery:** [KP-072](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-072>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-072.txt>).

**Requirements read:**

- Driver add and update enforce shared normalized container format/check digit, with canonical persistence and idempotency fingerprint.
- Malformed numbers reject without writes; optional clear remains allowed where specified.
- Frontend feedback and backend enforcement agree.

**Connected current-source evidence:**

- [shared/src/schemas/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/schemas/index.ts:1256>) — Shared validated container fields canonicalize and validate format/check digit.
- [backend/src/routes/driver.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/driver.ts:815>) — POST uses the validated schema.
- [backend/src/routes/driver.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/driver.ts:859>) — PATCH uses validated optional number schema.
- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:71>) — Driver form uses common format/check-digit utilities for feedback.

**Missing, contradicted or unproven:**

- Current valid canonical write/reload and malformed path suite not executed.
- PATCH regression gap is tracked separately in KP058; do not count its clear-only test as invalid-format proof.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain one canonical validation boundary and exercise real routes on current build.
- Keep valid-input and clear cases alongside rejection cases.

**Required independent checks:**

- Uppercase, lowercase and spaces; malformed three-letter value; invalid check digit; valid canonical value; optional clearing; duplicate/replay fingerprint; no side effects after rejected writes.

**Closure-claim review:** Claim23566b92,sharedschema; staging invalid rejections only, canonical valid case onlylocal. Production schemas are connected; current end-to-end matrix remains unverified.

<a id="kp-073"></a>

### KP-073 — Prevent duplicate trips when creation fails

**Source file:** [QA_PASSED/20260914_P1_QA-030_bug-prevent-duplicate-trips-when-creation-fails.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P1_QA-030_bug-prevent-duplicate-trips-when-creation-fails.docx>)

**Source title (verbatim):** Prevent duplicate trips when creation fails

**SHA-256:** `71e9d29d0b68733bdb43a9eede3ef4fb04a62493f884dc12b4a9a2e1345637a7`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P1. **Images:** 5.

**Delivery:** [KP-073](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-073>) in [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-073.txt>).

**Requirements read:**

- Invalid leg data must leave no trip behind.
- Corrected submission creates one complete logical trip including legs and containers; retry is safe after uncertain failures.
- Validation/readiness/error UI agree; legitimate separate trips may share customer reference.

**Connected current-source evidence:**

- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:444>) — Leg validation now occurs before initial create.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:496>) — Creates the base trip through one POST.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:505>) — Changed-payload idempotency 409 regenerates the key and retries create.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:527>) — Leg/pre-departure details are saved through a separate later PUT.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:579>) — Containers save after those requests; later failure leaves earlier base request committed.

**Missing, contradicted or unproven:**

- Only prevalidation is fixed: base trip, leg details and containers still persist through separate requests.
- A later failure can strand a partial trip. Editing base payload then retrying can hit changed-payload 409, allocate a new key and create another base trip.
- Document explicitly leaves severed mid-create AC3 untested.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Prefer one transactional create API for the complete trip payload and one stable logical request identity.
- If staged creation is required, expose resumable draft identity and explicit recovery; never silently generate a new logical create key merely because the payload changed.
- Return field errors before write and retain logical recovery state until all steps finish.

**Required independent checks:**

- Inject failures after base creation, after legs and during container saves; reload/retry and corrected retry leave exactly one complete logical trip or an explicit recoverable draft.
- Double click, lost response and same-key/changed-payload cases; legitimate separate trips with the same reference remain allowed.

**Closure-claim review:** Claims2d8a0b28,12local tests and staging invalid-disabled0POST/corrected201; explicitly mid-create sever not covered. Connected request sequence contradicts the required all-or-recoverable logical operation; historical happy-path pass is insufficient.

<a id="kp-074"></a>

### KP-074 — Keep expense and supplier debt pending until the promised review is complete

**Source file:** [QA_PASSED/20260914_P1_QA-086_bug-keep-expense-and-supplier-debt-pending-until-the-promised-review-is-complete.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P1_QA-086_bug-keep-expense-and-supplier-debt-pending-until-the-promised-review-is-complete.docx>)

**Source title (verbatim):** Keep expense and supplier debt pending until the promised review is complete

**SHA-256:** `e238510ac56d7edb1edb955d4a5dee272a8b4859a3d3a49d028fe01ee4be9df0`

**Claimed folder:** QA_PASSED. **Audit:** SUPERSEDED. **Source priority:** P1. **Images:** 3.

**Delivery:** [KP-074](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-074>) in [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-074.txt>).

**Canonical records:** [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-150>). No duplicate engineering implementation.

**Requirements read:**

- Original requested pending→checked→approved before posting with distinct actors.
- Latest explicit user decision removes all internal approvals; direct authorized financial recording replaces this workflow.

**Connected current-source evidence:**

- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:209>) — Expense submission enters pending approval rather than direct final processing.
- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:244>) — Review/check/approve state machine remains in service.
- [frontend/src/pages/ExpenseListPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseListPage.tsx:373>) — Approval-specific buttons remain in frontend.

**Missing, contradicted or unproven:**

- This QA_PASSED record implements a workflow the user subsequently removed from scope.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Mark original approval task superseded and route remaining removal work to direct expense creation/settlement.
- Keep ordinary validation, authorization, audit and once-only ledger posting without maker/checker/approver gates.
- Migrate existing pending records under an explicit data transition.

**Required independent checks:**

- Direct authorized expense save and one ledger effect; no review queue or separate approval actors; failed validation creates no posting; migration of existing pending records.

**Closure-claim review:** Claims53d6a4b4 and later3-actorAPI12checks; UI and receipt interaction explicitly uncovered. Historical implementation is not the desired final product direction and must not be preserved as acceptance.

<a id="kp-075"></a>

### KP-075 — Keep expense payment status consistent with its supplier ledger

**Source file:** [QA_PASSED/20260914_P1_QA-089_bug-keep-expense-payment-status-consistent-with-its-supplier-ledger.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P1_QA-089_bug-keep-expense-payment-status-consistent-with-its-supplier-ledger.docx>)

**Source title (verbatim):** Keep expense payment status consistent with its supplier ledger

**SHA-256:** `d0afaec1c650efe520e80321e635175354f4bb922ec9e4194df36c80ff4e29a2`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P1. **Images:** 3.

**Delivery:** [KP-075](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-075>) in [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-075.txt>).

**Requirements read:**

- Paid status must correspond to an authorized persisted settlement, not a free edit flag.
- Partial/full payments, retries, errors and supported reversal must reconcile expense status with the supplier ledger.
- User can complete the workflow through UI without an internal approval gate.

**Connected current-source evidence:**

- [frontend/src/pages/PayableDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/PayableDetailPage.tsx:193>) — Payment form body sends supplier/amount/date/receipt but no expense selection or expenseIds.
- [backend/src/routes/financial/payments.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/payments.routes.ts:252>) — Real vendor endpoint accepts schema data and passes expenseIds through to auto-applied payment service.
- [backend/src/services/financial.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/financial.service.ts:1023>) — Linked expenses settle after ledger posting within the transaction.
- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:1078>) — Helper checks supplier/status but receives no payment amount and marks all selected rows PAID.
- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:1115>) — Reversal helper exists; repository references show tests but no production caller.

**Missing, contradicted or unproven:**

- Normal payment UI does not expose/pass expense linkage, so its payment cannot mark selected expense status consistently.
- Backend can mark selected expenses fully PAID even when payment amount is less than their total; no allocation/coverage check exists in the connected call chain.
- Reversal helper has no production entry point/caller; supported reversal is not reachable.
- APPROVED prerequisite conflicts with final no-internal-approval direction.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Define explicit allocation amounts between a payment and expenses; validate totals atomically and derive partial/paid status from allocated balance.
- Expose compact expense selection/allocation in authorized payment UI and invalidate expense plus supplier views after persistence.
- Wire a direct authorized audited reversal into the same transaction and restore allocations/status consistently.
- Remove approval prerequisite without weakening payment authorization or balance validation.

**Required independent checks:**

- A payment of 1 against an expense of 100 cannot mark it fully paid; partial and final allocations; summed coverage across multiple expenses; wrong supplier; concurrent/replayed payment applies once.
- Select in the UI, save and reload both ledgers; failure rollback; reachable reversal and reconciliation afterward; no approval actors.

**Closure-claim review:** Claims578e637b optionalexpenseIds settlement linkage and unit reversal; explicitly noHTTP reversal surface; stagingAPI tests only. Core backend linkage exists, but amount reconciliation, normal frontend reachability and production reversal do not meet the full requested behavior.

<a id="kp-076"></a>

### KP-076 — Remove public access to protected evidence files

**Source file:** [QA_PASSED/20260914_P1_QA-125_bug-remove-public-access-to-protected-evidence-files.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P1_QA-125_bug-remove-public-access-to-protected-evidence-files.docx>)

**Source title (verbatim):** Remove public access to protected evidence files

**SHA-256:** `b25706267dd8072c40873e6ba9245f6e085309b8267ad57d5fc6901281f12bf7`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P1. **Images:** 0.

**Delivery:** [KP-076](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-076>) in [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-076.txt>).

**Requirements read:**

- Sensitive uploads are not anonymously served by application or proxy.
- Authenticated owner/role access works; wrong owner/path traversal rejected; intentional public assets unaffected.
- Previously exposed URLs/cache/revoked access and both proxy/application regressions are verified.

**Connected current-source evidence:**

- [backend/src/tests/qa125-no-public-uploads.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/qa125-no-public-uploads.test.ts:20>) — Regression only reads index.ts to detect one express.static mount shape.
- [deploy/nginx-host-vantai.conf](</Users/frank.nguyen/Documents/silversea/codebase/deploy/nginx-host-vantai.conf:18>) — Host template comments removal of public upload alias.
- [backend/src/routes/upload.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/upload.ts:693>) — Protected photo route is retained for authorized serving.

**Missing, contradicted or unproven:**

- Source assertion covers application mount text, not a running Express/proxy or all equivalent static mounts.
- Current deployed proxy config, previously cached public objects and revoked URLs are unverified; historical sequence initially returned 200 before manual proxy change.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Verify actual deployment configuration and test representative old sensitive URLs through public host and direct app.
- Use explicit protected route tests for authenticated owner/wrongowner/traversal and intentional public assets.
- Invalidate previously public caches where exposure existed; record build/proxy identities.

**Required independent checks:**

- Anonymous access to old URLs is denied at proxy and app; authorized photo returns 200; wrong owner returns 401/403; traversal/encoding cases; public logo returns 200; revoked access and cache behavior.

**Closure-claim review:** Claimsd25b50bd; first staging exposed200, later manualnginx404 and unauthenticated/api/photos401. Code/templates remove known public route, but a historical corrected host response cannot certify current layered serving behavior.

<a id="kp-077"></a>

### KP-077 — Require current driver ownership before deleting trip photos

**Source file:** [QA_PASSED/20260914_P1_QA-126_bug-require-current-driver-ownership-before-deleting-trip-photos.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P1_QA-126_bug-require-current-driver-ownership-before-deleting-trip-photos.docx>)

**Source title (verbatim):** Require current driver ownership before deleting trip photos

**SHA-256:** `c884586eb1b262f7181a66809e19822f8fad4622be582aa42c4d1f4f1fcc7560`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P1. **Images:** 0.

**Delivery:** [KP-077](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-077>) in [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-077.txt>).

**Requirements read:**

- Only current assigned driver may delete permitted photo; wrong/former/no-profile drivers denied without side effects.
- Ownership remains true at deletion under concurrent reassignment; real authenticated route tests cover it.

**Connected current-source evidence:**

- [backend/src/routes/upload.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/upload.ts:600>) — Driver ownership helper runs before runIdempotent and its DB transaction.
- [backend/src/services/photo-authz.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/photo-authz.service.ts:46>) — Helper reads global db driver and trip ownership without transaction/lock.
- [backend/src/routes/upload.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/upload.ts:616>) — Transaction selects trip id/status without locking or rechecking driverId, then deletes photo.
- [backend/src/services/idempotency.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/idempotency.service.ts:306>) — Idempotency serialization is scoped to endpoint/key, not all mutations of a trip.
- [backend/src/services/trip-lifecycle-ops.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-lifecycle-ops.service.ts:117>) — Reassignment locks trip row and can update driver on CREATED/unacknowledged eligible trip.

**Missing, contradicted or unproven:**

- TOCTOU persists: old owner passes precheck, reassignment commits new owner, delete proceeds using stale authorization because transaction never rechecks ownership.
- Photo-row lock and endpoint/key idempotency lock do not serialize against reassignment trip-row lock.
- The claimed staging owner test returned 409 for a COMPLETED trip; it did not exercise an allowed owner deletion. The claim that the concurrent boundary was code-verified is unsupported.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Inside deletion transaction acquire the same trip-row lock/order used by reassignment, then verify current driver ownership and allowed status before side effects.
- Ensure idempotent replay also respects current ownership policy; keep cleanup outbox/deletion atomic.
- Add a controlled concurrency barrier test at preauthorization/transaction boundary.

**Required independent checks:**

- Driver A passes the precheck, reassignment to B commits, then A attempts deletion: deny it with photo and cleanup state unchanged. Reverse ordering has a deterministic authorized result.
- Successful current-owner deletion; wrong/former owner and no profile; same-key replay after reassignment; HTTP route with authentication mounted; no side effects on denial.

**Closure-claim review:** Claims ownership guard andAC4 codeverified, q23admin tests, wrongdriver403 and completedowner409. Exact connected transaction boundaries refute concurrency completion; no global trip serialization prevents the interleaving.

<a id="kp-078"></a>

### KP-078 — 20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data

**Source file:** [QA_PASSED/20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data.docx>)

**Source title (verbatim):** 20260914_P2_QA-034_bug-prevent-the-fixed-status-column-from-overlapping-trip-table-data

**SHA-256:** `eb0444c96058fa21a9c67938183183663b16c0b4c6c67d3b0ede41f95eb9316b`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-078](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-078>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-078.txt>).

**Requirements read:**

- Keep status header/values separate from revenue/cost columns at all horizontal offsets.
- Opaque sticky boundary and compact responsive table/cards preserve readability.
- Recovered file contains a QA result narrative rather than original full task body.

**Connected current-source evidence:**

- [frontend/src/pages/trip-list/table-extras.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/trip-list/table-extras.css:137>) — Status is natural-flow at rest; is-scrolled branch enables sticky right with opaque background and shadow.
- [frontend/src/pages/trip-list/table-extras.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/trip-list/table-extras.css:151>) — Header receives separate sticky layer/background.

**Missing, contradicted or unproven:**

- No current all-offset browser render check.
- Artifact is plain text stored with .docx extension, not a valid Word ZIP; this is an artifact defect independent of product status.
- Original acceptance body is not recoverable from this record; assessment is limited to its recovered QA narrative.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retain source identity but rebuild this artifact as valid DOCX before relying on Word/Kanban tooling.
- Verify horizontal scroll at zero, intermediate and maximum offsets states and responsive cards on current build.

**Required independent checks:**

- 1440/834/390px at initial, intermediate and maximum horizontal scroll; status/revenue text does not overlap; sticky hover/background behavior; keyboard scrolling.

**Closure-claim review:** Recovered QA-only text claims three-width pass and statusoffscreen atrest plus rightstickyafter scroll. Current CSS expresses intended fix; invalid document format is not proof that the product fix failed.

<a id="kp-079"></a>

### KP-079 — Distinguish zero revenue from no completed trips

**Source file:** [QA_PASSED/20260914_P2_QA-035_bug-distinguish-zero-revenue-from-no-completed-trips.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-035_bug-distinguish-zero-revenue-from-no-completed-trips.docx>)

**Source title (verbatim):** Distinguish zero revenue from no completed trips

**SHA-256:** `f212528687d27fb3ba4b6cef8109b0ebb52c275d35396d6993b7517669420ebb`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-079](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-079>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-079.txt>).

**Requirements read:**

- Distinguish no completed trips from completed trips with zero revenue/profit.
- Use actual scoped trip count and clear zero/missing distinction without changing calculations.
- Counts/date filters/drilldown remain consistent across widths.

**Connected current-source evidence:**

- [frontend/src/pages/finance-derived.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/finance-derived.ts:302>) — Count uses completed monthly trips or yearly report tripCount instead of trimmed chart presence.
- [frontend/src/pages/FinancePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FinancePage.tsx:261>) — Empty state branches on completedTripCount; zero chart has specific explanatory copy.
- [frontend/src/pages/finance-completed-count.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/finance-completed-count.test.tsx:49>) — Tests cover completed trips with zero values, absent trips and yearly count.

**Missing, contradicted or unproven:**

- Current rendered zero/missing-value fixture and filter/drilldown agreement not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Run scoped zero/empty/populated scenarios and confirm text follows counts, not nonzero chart buckets.

**Required independent checks:**

- Seven completed trips with zero revenue versus no trips; monthly/yearly switch; explanation for genuinely missing data; totals and drilldown agree at three sizes.

**Closure-claim review:** Claimsa322ddc0,4tests and staging7completedzero versus emptyOctober API. Count-based implementation exists; API result alone did not prove final rendered state.

<a id="kp-080"></a>

### KP-080 — Open blocked transport records from the accounting work queue

**Source file:** [QA_PASSED/20260914_P2_QA-036_bug-open-blocked-transport-records-from-the-accounting-work-queue.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-036_bug-open-blocked-transport-records-from-the-accounting-work-queue.docx>)

**Source title (verbatim):** Open blocked transport records from the accounting work queue

**SHA-256:** `84d9aa20a0174c9e0c4bf2e3802e8fe77b0999e1c240fae7e1ef63adcbea7114`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-080](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-080>) in [WP18](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp18>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-080.txt>).

**Requirements read:**

- Accounting work link reaches the exact authorized underlying record even when ineligible for a later operation.
- Explain missing requirements and relevant responsible action without hiding records.
- Original preserve-POD-approval gate is superseded by user no-internal-approval decision; ordinary evidence validation may remain.

**Connected current-source evidence:**

- [backend/src/services/accounting-transport-register.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/accounting-transport-register.service.ts:241>) — POD aggregation is joined without dropping source rows lacking accepted evidence.
- [backend/src/services/accounting-transport-register.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/accounting-transport-register.service.ts:329>) — Missing POD state is surfaced in record mapping.
- [frontend/src/features/accounting/AccountingTransportRegister.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/accounting/AccountingTransportRegister.tsx:186>) — Register exposes missing-evidence filter/state.

**Missing, contradicted or unproven:**

- Exact link→record navigation, owner handoff and scope/date context were not executed.
- Any surviving accepted-POD approval requirement must be removed under global approval-removal work, not retained from this historical AC.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retest work-link navigation with blocked and eligible fixtures and clear record context.
- Keep underlying record visibility; replace approval-dependent gating/copy with current direct workflow.

**Required independent checks:**

- Link to the exact record; authorized versus forbidden access; missing evidence remains visible; update evidence and read back; date filters and three sizes; no internal approval dependency.

**Closure-claim review:** Claimscfc61446 aggregateLEFT changes and stagingrecord lists on3cac398. Visibility implementation is present. Complete navigation and remaining obsolete gates are not established by a list API sample.

<a id="kp-081"></a>

### KP-081 — Show payable ledger entries on desktop

**Source file:** [QA_PASSED/20260914_P2_QA-037_bug-show-payable-ledger-entries-on-desktop.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-037_bug-show-payable-ledger-entries-on-desktop.docx>)

**Source title (verbatim):** Show payable ledger entries on desktop

**SHA-256:** `0e394e65ddbfeff663902694053ea20ab016b97337ca38f6d345b36ac9e614de`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-081](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-081>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-081.txt>).

**Requirements read:**

- Desktop payable details show ledger rows with all transaction types and correct balances/date filters.
- Use valid table semantics; retain compact phone/tablet cards and loading/empty/error states.

**Connected current-source evidence:**

- [frontend/src/pages/PayableDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/PayableDetailPage.tsx:508>) — Desktop tbody maps ledger entries through ExpenseLedgerRow.
- [frontend/src/pages/PayableDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/PayableDetailPage.tsx:463>) — Mobile path keeps card rendering.

**Missing, contradicted or unproven:**

- Current desktop rows, all types and state/filter reconciliation not visually or interactively checked.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Rerun table/card comparison on one populated supplier covering expense/payment/adjustment.
- Capture DOM structure and visible balances plus empty/error/loading states.

**Required independent checks:**

- At 1440px, tbody contains tr rather than li; every entry type; month filter, count and balance; phone/tablet cards; no lost metadata.

**Closure-claim review:** Claims3cac398,ExpenseLedgerRow replacement5tests and staging3tr/noli. Current semantic table wiring supports the fix; current rendered behavior is unverified.

<a id="kp-082"></a>

### KP-082 — Fix OCR review header overlap on desktop and tablet

**Source file:** [QA_PASSED/20260914_P2_QA-038_bug-fix-ocr-review-header-overlap-on-desktop-and-tablet.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-038_bug-fix-ocr-review-header-overlap-on-desktop-and-tablet.docx>)

**Source title (verbatim):** Fix OCR review header overlap on desktop and tablet

**SHA-256:** `34534ee923d845ffe5cb00593a3f94a06d34b587b31af9dedb9ee7286014fd98`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-082](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-082>) in [WP19](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp19>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-082.txt>).

**Requirements read:**

- Header guidance and filter stay readable without word-column/overlap on desktop/tablet.
- Keep compact working mobile behavior and operable filters.
- Approval/review preservation in original task is superseded; do not polish obsolete approval controls.

**Connected current-source evidence:**

- [frontend/src/pages/FuelEvidenceReviewPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FuelEvidenceReviewPage.tsx:74>) — Header uses explicit flexible group layout.
- [frontend/src/pages/FuelEvidenceReviewPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FuelEvidenceReviewPage.tsx:103>) — Filter wrapper has bounded width; guidance can shrink/wrap.
- [frontend/src/pages/FuelEvidenceReviewPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FuelEvidenceReviewPage.tsx:148>) — Page still includes accountant review instruction, outside surviving layout target.

**Missing, contradicted or unproven:**

- No current rendered header at 768/834/1440px or filter interaction.
- Review-specific workflow text/actions require removal in approval-removal package.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Apply layout only to surviving direct evidence workflow; remove approval-specific copy/actions.
- Verify long Vietnamese guidance and filter labels at each width without oversized components.

**Required independent checks:**

- Header at 390/768/834/1440px; keyboard filter operation and visible focus; no overlap; no internal review gate.

**Closure-claim review:** Claims1f80311c wrapper/guidance fix and allcriteria staging screenshots. Responsive constraints exist in code, but screenshots not available at claimed location and review target is partly superseded.

<a id="kp-083"></a>

### KP-083 — Fix expense creation buttons for accountants

**Source file:** [QA_PASSED/20260914_P2_QA-039_bug-fix-expense-creation-buttons-for-accountants.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-039_bug-fix-expense-creation-buttons-for-accountants.docx>)

**Source title (verbatim):** Fix expense creation buttons for accountants

**SHA-256:** `545905c2866b3319c191c4429298d283def28c3f4633aba23eee94fc232a1ec0`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-083](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-083>) in [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-083.txt>).

**Requirements read:**

- Enabled Accountant create/edit links open allowed forms instead of redirecting dashboard.
- Route guard and visible CTA agree; validation/save/back context and unauthorized denial remain clear.

**Connected current-source evidence:**

- [frontend/src/App.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/App.tsx:212>) — Finance read-only role guard is computed separately.
- [frontend/src/App.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/App.tsx:354>) — Expense new/edit routes use the corrected guard.

**Missing, contradicted or unproven:**

- Direct API creation cannot prove navigation, form visibility or back-context behavior.
- Current actual CTA journey not executed.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Test from Accountant list CTA to form and successful direct authorized save, retaining source queue context.
- Do not retain an internal approval handoff from historical pending status.

**Required independent checks:**

- Accountant create/edit CTAs; browser back and return to list; validation errors; permitted save/reload; clear denial for a forbidden role using the direct URL; three sizes.

**Closure-claim review:** Claims1b957ec5 route guard fix, later staging directAPI PENDING create. Guard change is present; appended API evidence does not close frontend acceptance.

<a id="kp-084"></a>

### KP-084 — Reject negative OPS advance and expense amounts

**Source file:** [QA_PASSED/20260914_P2_QA-040_bug-reject-negative-advance-amounts-without-changing-their-sign.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-040_bug-reject-negative-advance-amounts-without-changing-their-sign.docx>)

**Source title (verbatim):** Reject negative OPS advance and expense amounts

**SHA-256:** `21a55601341c2a9aae546cb36971e814cfe2965ed09c8f3d50610a064d9eed35`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-084](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-084>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-084.txt>).

**Requirements read:**

- Typed/pasted negative amounts remain visibly negative and block save with field-level error.
- Never silently convert negative to positive; zero/empty/positive formatting and persistence remain correct.
- Cover OPS advance/create-expense/edit-expense across widths.

**Connected current-source evidence:**

- [frontend/src/features/ops/OpsAdvanceRequestModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsAdvanceRequestModal.tsx:17>) — Negative flag is derived from state, but amountDigits removes minus.
- [frontend/src/features/ops/OpsAdvanceRequestModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsAdvanceRequestModal.tsx:47>) — Controlled displayed value formats sign-stripped digits; a lone minus renders empty.
- [frontend/src/features/ops/OpsExpenseFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsExpenseFormModal.tsx:159>) — Expense create repeats sign-stripped display; amountError is defined at line 72 but never rendered.
- [frontend/src/features/ops/OpsExpenseEditModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsExpenseEditModal.tsx:96>) — Expense edit repeats display issue; amountError defined at line 54 is never rendered.

**Missing, contradicted or unproven:**

- Typing minus then digits can become positive: controlled rerender removes the lone minus before next keystroke.
- Pasted negative displays positive digits, and editing that displayed string can clear the negative flag.
- Expense create/edit do not render their computed field error, contrary to AC.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Keep signed raw input text while editing; derive parsed amount separately and format on blur without removing sign.
- Render associated Vietnamese error in all three forms and disable submit for negative/zero/invalid input.
- Do not use API 400 evidence as a substitute for testing the controlled UI state sequence.

**Required independent checks:**

- Type - then 12345 one key at a time; paste -12345 and then edit/delete a digit; the negative remains visible and no POST is sent.
- Empty, zero and positive values; focus/error association; keyboard/mobile input; create, edit and advance forms at three sizes; only valid positive amounts persist.

**Closure-claim review:** Claims961d9d39 three forms preserve minus; appended QA uses direct API negative rejection only. Source controlled-value behavior contradicts the asserted UI fix; API validation does not cover sign-loss during typing.

<a id="kp-085"></a>

### KP-085 — Align customer shipment status across list and details

**Source file:** [QA_PASSED/20260914_P2_QA-042_bug-align-customer-shipment-status-across-list-and-details.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-042_bug-align-customer-shipment-status-across-list-and-details.docx>)

**Source title (verbatim):** Align customer shipment status across list and details

**SHA-256:** `2942ca47508587ebdef68e96bf65de021a0d80e87f04f42c8e45b0a49db31957`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-085](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-085>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-085.txt>).

**Requirements read:**

- Customer queue labels distinguish active processing from actual transport/delivery.
- Assigned trip is not proof of physical movement; list/detail statuses agree and workqueue state is separately labelled.

**Connected current-source evidence:**

- [backend/src/services/work-inbox.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/work-inbox.service.ts:140>) — Delivery state is derived from POD, delivery report and trip IN_TRANSIT status, otherwise NO_REPORT.
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:36>) — Customer bucket is neutral Đang xử lý.
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:107>) — NO_REPORT has explicit no delivery report wording.

**Missing, contradicted or unproven:**

- The current portal list/detail comparison for assigned, in-transit, reported and completed states has not been run.
- Accepted-POD internal approval must not be a future dependency; keep ordinary customer acknowledgement separate.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Verify label mapping with actual scoped fixtures and retain neutral processing bucket.
- Remove any internal evidence-approval prerequisite under final direction without implying GPS/physical movement from assignment.

**Required independent checks:**

- Assigned but not departed; IN_TRANSIT; driver-reported delivery; customer acknowledgement; list/detail history and counters at three sizes.

**Closure-claim review:** Claims66e911d3 truth mapping, neutralfrontend and staging3report. Source mapping addresses the wording problem; current portal states remain unverified.

<a id="kp-086"></a>

### KP-086 — Show the shipment route in the Ops plan

**Source file:** [QA_PASSED/20260914_P2_QA-045_bug-show-the-shipment-route-in-the-ops-plan.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-045_bug-show-the-shipment-route-in-the-ops-plan.docx>)

**Source title (verbatim):** Show the shipment route in the Ops plan

**SHA-256:** `26a7aa6190e1cd50ef414c3d6d6a703a98472d5da8de19dfd5c4959af024e531`

**Claimed folder:** QA_PASSED. **Audit:** DUPLICATE. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-086](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-086>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-086.txt>).

**Canonical records:** [KP-059](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-059>), [KP-069](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-069>). No duplicate engineering implementation.

**Requirements read:**

- Original /ops/orders route must display known booking/container route, deterministic mixed routes and honest missing values.
- Completion originally addressed a different detailed-plan route; original target still required follow-up.

**Connected current-source evidence:**

- [backend/src/services/ops-orders.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-orders.service.ts:65>) — Current actual Ops orders service implements the follow-up route aggregate/fallback now documented in KP059.
- [backend/src/services/dispatch-detail-plan-fulfillment-less.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-detail-plan-fulfillment-less.ts:162>) — Separate detailed-plan route fallback is the implementation documented in KP069.

**Missing, contradicted or unproven:**

- This record’s historical completion changed scope to the detailed plan and explicitly admitted that /ops/orders remained unresolved at that time.
- Current original-scope work overlaps KP059; detailed-plan work overlaps KP069. Keep source filename identity but avoid duplicate work packages.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Link original KP086 to KP059 for current /ops/orders acceptance and KP069 for sibling detailed-plan fix.
- Retest current original route once under the consolidated route-provenance package.

**Required independent checks:**

- Use the KP059 known, mixed, fallback and missing-route matrix at the actual /ops/orders route; do not substitute detailed-plan results.

**Closure-claim review:** Claims038e059f detailed-plan fix and admission original Ops orders remainsdash in separate follow-up. Duplicate acceptance scope is tracked by concrete sibling records; historical original-target completion was not supported.

<a id="kp-087"></a>

### KP-087 — Link the blocking trip when driver acceptance is rejected

**Source file:** [QA_PASSED/20260914_P2_QA-047_enhancement-link-the-blocking-trip-when-driver-acceptance-is-rejected.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-047_enhancement-link-the-blocking-trip-when-driver-acceptance-is-rejected.docx>)

**Source title (verbatim):** Link the blocking trip when driver acceptance is rejected

**SHA-256:** `1eafd57508434eff9b66042495cc9a4edc014404aac5ef9fb11211a065ef9f84`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-087](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-087>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-087.txt>).

**Requirements read:**

- Busy-vehicle guard remains correct; retain concrete reason and identify/link authorized blocking trip or clear operator handoff.
- Reload alone is insufficient guidance; retry when conflict resolved without bypass.
- Final user decision prohibits offline command queues/replay.

**Connected current-source evidence:**

- [frontend/src/pages/DriverTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripDetailPage.tsx:327>) — Conflict guidance is still based on offline command state and sync banner.
- [frontend/src/pages/DriverTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripDetailPage.tsx:345>) — Parses TRP code from lastError and searches owned board for a destination link.
- [frontend/src/pages/DriverTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripDetailPage.tsx:362>) — Conflict guidance/handoff derives from the queue-managed blocker.

**Missing, contradicted or unproven:**

- Blocking reason/link fix is coupled to offline queue CONFLICT state slated for removal.
- Historical staging exercised only foreign blocking trip/handoff; own authorized link branch unverified.
- Current stale/error/recovery interaction not run.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Port blocker details into immediate online mutation error state or structured API error; remove queued commands and background replay.
- Keep authorized blocking-trip link and fallback handoff in direct online acceptance view.
- Retry explicitly after current server state refresh; never autoaccept after reconnect.

**Required independent checks:**

- Link to an owned blocking trip; handoff when another driver owns it or access is unavailable; resolved stale blocker; one explicit retry; offline action blocked with no queue; reload retains recovery context without background mutations.

**Closure-claim review:** Claims1b8857b9 parsing offline CONFLICT error; only foreign-blocker staging branch tested. Some recovery UI exists, but implementation depends on a prohibited offline architecture and own-link criterion remains open.

<a id="kp-088"></a>

### KP-088 — Reconcile fleet trailer totals with listed trailers

**Source file:** [QA_PASSED/20260914_P2_QA-048_bug-reconcile-fleet-trailer-totals-with-listed-trailers.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-048_bug-reconcile-fleet-trailer-totals-with-listed-trailers.docx>)

**Source title (verbatim):** Reconcile fleet trailer totals with listed trailers

**SHA-256:** `5a34aca200387ac79b327ae62161c5e7e218b3de7227061a3f57ffd66e6b71f0`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-088](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-088>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-088.txt>).

**Requirements read:**

- Total includes all trailers, including unknown legacy type; breakdown sums to total.
- New/legacy type values match between cards/table/editor and refresh.
- Loading/error must not masquerade as real zero.

**Connected current-source evidence:**

- [frontend/src/pages/FleetPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FleetPage.tsx:68>) — Counts known 40FT/20FT types and derives unknown from full trailer length.
- [frontend/src/pages/FleetPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FleetPage.tsx:137>) — Headline total uses all trailers.
- [frontend/src/features/fleet/trailer-card.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/trailer-card.tsx:164>) — Trailer section applies matching unknown bucket.
- [frontend/src/features/fleet/trailer-card.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/trailer-card.tsx:30>) — Unknown type has explicit display label.

**Missing, contradicted or unproven:**

- Current create/edit/delete flows for new and legacy trailers, persisted readback, and loading/error UI have not been rerun.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Retest that total trailers equal known 40FT plus known 20FT plus unknown types, using legacy and new fixtures on the current build.
- Keep unknown truthful; do not infer stored type from a separate truck fallback.

**Required independent checks:**

- Legacy scenario with summary 0 versus 39 listed trailers, and new-record scenario with summary 1 versus 40 listed; unknown/null/unexpected types; type edit/readback; all three widths; loading/error does not appear as a real zero.

**Closure-claim review:** Claims4308927f,17tests, APIcreate/deletecount and localvisual115. Count implementation now includes unknowns; current data/render/error-state verification remains unproven.

<a id="kp-089"></a>

### KP-089 — Provide the trailer selector promised by the fleet assignment flow

**Source file:** [QA_PASSED/20260914_P2_QA-049_bug-provide-the-trailer-selector-promised-by-the-fleet-assignment-flow.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-049_bug-provide-the-trailer-selector-promised-by-the-fleet-assignment-flow.docx>)

**Source title (verbatim):** Provide the trailer selector promised by the fleet assignment flow

**SHA-256:** `85536c09b78b37260b2c914b356639c7ecbad821487923ddd902dddddf208865`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-089](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-089>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-089.txt>).

**Requirements read:**

- Truck editor exposes searchable trailer selector with plate/type/current coupling.
- Save/reopen and both sides update; replacing conflict is explicit and preserves one active coupling.
- Clear/search/error/keyboard work without forcing recreation.

**Connected current-source evidence:**

- [frontend/src/features/fleet/TruckFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/TruckFormModal.tsx:172>) — Trailer select is labelled and searchable; options include type and current coupled truck.
- [frontend/src/features/fleet/TruckFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/TruckFormModal.tsx:95>) — Only touched selection is sent, including explicit null clear.
- [frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx:278>) — Caller supplies active trailer options and coupled-to metadata.
- [backend/src/services/master-data-import.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/master-data-import.service.ts:1307>) — Shared CRUD coupling clears prior truck claim before assigning destination.

**Missing, contradicted or unproven:**

- Current real selector selection/save/readback and simultaneous-edit conflict handling not executed.
- One-to-one coupling across import/CRUD needs consolidated concurrency proof;KP-061 covers import-specific branch.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Run assignment/transfer/clear through both truck editor entry points and inspect both source/destination displays.
- Ensure existing coupling notice makes transfer effect explicit; use common transactional locking.

**Required independent checks:**

- Search by plate/type; assign an unassigned trailer; transfer from another truck; clear; stale/concurrent edits; reload both sides; inactive options; keyboard use at three sizes.

**Closure-claim review:** Claims416a64c2+97069fb5,4backendtests and staging modal/two-waystate screenshots. Control and backend assignment path exist; no current transactional or rendered behavior execution.

<a id="kp-090"></a>

### KP-090 — Populate the Ops owner picker with active staff

**Source file:** [QA_PASSED/20260914_P2_QA-051_bug-populate-the-ops-owner-picker-with-active-staff.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-051_bug-populate-the-ops-owner-picker-with-active-staff.docx>)

**Source title (verbatim):** Populate the Ops owner picker with active staff

**SHA-256:** `c74d36a389ed00548ae6ed1015bf382b56d9eea96649ebf6d6db521692ffe7bc`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-090](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-090>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-090.txt>).

**Requirements read:**

- Picker lists eligible active OPS users including newly created accounts with distinguishable identities.
- Assign/replace/clear persists one current owner and is reflected in tracking.
- Loading, empty and fetch-error/retry states are distinct without losing current selection.

**Connected current-source evidence:**

- [frontend/src/features/ops/AssignOpsDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/AssignOpsDialog.tsx:34>) — Fixed endpoint /auth/users?role=OPS&limit=100, but query destructures data only.
- [frontend/src/features/ops/AssignOpsDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/AssignOpsDialog.tsx:63>) — Loading/failure both map to empty option list; no refetch/retry or query error rendering.
- [backend/src/services/user.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/user.service.ts:508>) — The list filters by role/deletedAt but not ACTIVE status; the caller requests only the first 100 users.
- [backend/src/services/ops-fleet.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-fleet.service.ts:175>) — Save verifies role OPS only, not ACTIVE/deleted status.
- [frontend/src/features/ops/AssignOpsDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/AssignOpsDialog.tsx:88>) — Option label uses fullName or username, not a discriminator for duplicate names.

**Missing, contradicted or unproven:**

- Loading and failed fetches do not show the requested status or retry action; noOpsStaff covers only a successful empty response.
- Inactive OPS users can be offered and accepted; eligibility requirement is not enforced by connected list/save path.
- The first-100 result cap and 60-second stale query do not guarantee that newly eligible users are discoverable; duplicate display names lack a distinguishing identifier.
- Body contains DEV completion only, not a recoverable current QA test result.
- No fresh, independently checked execution evidence at this HEAD; current staging build identity and required browser outcomes remain unverified.

**Target behavior / next work:**

- Query eligible ACTIVE nondeleted OPS accounts with pagination/search or a dedicated selector endpoint; validate same eligibility on save inside assignment transaction.
- Render loading/error/retry/empty states distinctly and preserve current selection; invalidate/refetch after user creation.
- Include compact username/employee identifier for duplicate names and test concurrent owner replacement.

**Required independent checks:**

- Active, inactive, deleted and wrong-role users; more than 100 users and newly created users; duplicate names; loading, failure and retry; assign, replace, clear and read back with one active owner; tracking; keyboard use at three sizes.

**Closure-claim review:** Claims0cecf301 endpoint correction /users→/auth/users and empty-state text; no later QA paragraph recovered. Endpoint fix is real but several explicit acceptance criteria remain absent, and QA_PASSED folder is not substantiated by the document body.

<a id="kp-091"></a>

### KP-091 — Keep Ops dialogs clear of the fixed page header

**Source file:** [QA_PASSED/20260914_P2_QA-052_bug-keep-ops-dialogs-clear-of-the-fixed-page-header.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-052_bug-keep-ops-dialogs-clear-of-the-fixed-page-header.docx>)

**Source title (verbatim):** Keep Ops dialogs clear of the fixed page header

**SHA-256:** `d8b53d2c89070992391ba4fad022c7014290ebb61fa1851e96c00498d6748c05`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 4.

**Delivery:** [KP-091](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-091>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-091.txt>).

**Requirements read:**

- Keep dialog titles, close controls and content visible and reachable across screen sizes and scrolling. The fixed page header must not cover or intercept dialog controls.
- Expense and receipt dialogs expose their full title and pointer-accessible close control at all three tested sizes.
- Dialog content scrolls within the viewport; the title, close control and required actions remain reachable.
- Contain keyboard focus, support closing and return focus to the trigger. Verify the intended Escape behavior.
- Retest wallet edit/view dialogs and the new-expense dialog on /ops/orders, including empty receipts, long content and viewport resizing.

**Existing behavior / assessment:** Body portals and modal stacking are present; the custom Ops modal hook does not contain Tab focus or make the background inert, so the full keyboard requirement is not implemented.

**Connected current-source evidence:**

- [frontend/src/features/ops/OpsModalBackdrop.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsModalBackdrop.tsx:22>) — Connected wrapper uses createPortal and dialog semantics.
- [frontend/src/features/ops/useOpsModalDismiss.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/useOpsModalDismiss.ts:12>) — Focus entry/return and Escape handling, without a Tab trap or background exclusion.
- [frontend/src/features/ops/ops-modal.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/ops-modal.css:10>) — Fixed full-viewport overlay and bounded scroll layout.

**Missing, contradicted or unproven:**

- No current 1440/768/390 rendered evidence for wallet edit, receipt viewer and order expense forms.
- Required focus containment is absent from the custom modal implementation.

**Target behavior / next work:**

- Use the existing accessible modal foundation or add equivalent focus containment, nested-picker ownership and focus return to the shared Ops wrapper.
- Retain the body portal and bounded scrolling; verify title/close visibility with the fixed header and soft keyboard.

**Required independent checks:**

- Tab/Shift+Tab must remain inside each modal; Escape closes the topmost surface and returns to the opener.
- Run the three named forms at desktop, tablet and phone widths, including long content and scrolling.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-092"></a>

### KP-092 — Reconcile the Ops wallet with approved advance returns

**Source file:** [QA_PASSED/20260914_P2_QA-054_bug-reconcile-the-ops-wallet-with-approved-advance-returns.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-054_bug-reconcile-the-ops-wallet-with-approved-advance-returns.docx>)

**Source title (verbatim):** Reconcile the Ops wallet with approved advance returns

**SHA-256:** `36df698bf8c33e6e4d60026f31b9bde8f32d789adb1e7aaddd4f0cdebcee57d5`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-092](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-092>) in [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-092.txt>).

**Requirements read:**

- Reconcile available funds with approved returns exactly once. Clearly separate cumulative advances, returns and pending reservations so returned funds are not presented as available.
- Approved full and partial returns reconcile with the wallet after navigation and reload, without applying a return twice.
- Label available cash, cumulative advances, returns and pending reservations distinctly; do not show returned funds as spendable.
- Define how pending expenses affect availability. Test approval and rejection against that policy; the required negative-balance presentation is not assumed.
- Retest a new advance after settlement and verify consistent employee, period and settlement status across both pages.

**Existing behavior / assessment:** The wallet subtracts returned settlement funds as well as expenses. The numerical implementation exists, but current ledger-level and UI evidence is unavailable; historical approval-state rules need migration to the internet-only direct workflow.

**Connected current-source evidence:**

- [backend/src/services/ops-wallet.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-wallet.service.ts:64>) — Summary subtracts totalReturned from advance minus approved/pending expenses.
- [backend/src/services/ops-wallet.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-wallet.service.ts:93>) — Settlement returns are selected from approved historical records.
- [frontend/src/pages/OpsWalletPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/OpsWalletPage.tsx:28>) — Wallet displays balance, advance, return and expense summaries.

**Missing, contradicted or unproven:**

- No current end-to-end proof for full/partial/multiple returns and new funds after settlement.
- The old acceptance wording assumes internal approval; that is no longer the requested business process.

**Target behavior / next work:**

- Preserve the once-only return arithmetic and historical records while connecting it to authorized direct posting.
- Define available versus reserved amounts explicitly and refresh wallet and ledger from the committed result.

**Required independent checks:**

- Check full, partial and multiple returns, repeated readback, reversed records, and a later advance.
- Compare wallet totals to persisted entries after reload without adding any approval gate.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-093"></a>

### KP-093 — Restore the Operations owner dialog layout and button styling

**Source file:** [QA_PASSED/20260914_P2_QA-055_bug-restore-the-operations-owner-dialog-layout-and-button-styling.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-055_bug-restore-the-operations-owner-dialog-layout-and-button-styling.docx>)

**Source title (verbatim):** Restore the Operations owner dialog layout and button styling

**SHA-256:** `62125c0b7d37ac0928071f591b42edd957794e2e616d99efa4fa2b8214e9844a`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-093](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-093>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-093.txt>).

**Document recovery note:** word/document.xml: Opening and ending tag mismatch: body line 2 and p, line 2, column 11466 (<string>, line 2)

**Requirements read:**

- Use the app’s compact dialog and button pattern for Operations ownership: a bounded surface above the page, clear vehicle identity, readable form spacing and distinct close/save controls.
- Render the owner form in a compact modal layer with a backdrop and a clearly labeled vehicle, without reflowing the underlying vehicle list.
- Separate and style close/save controls; make the current disabled state visibly distinct and retain adequate touch targets.
- Support focus entry, contained keyboard navigation, Escape/close and focus return to the opener; keep picker options above the dialog surface.
- Verify desktop, tablet and phone layouts without clipping or oversized text. Preserve owner-selection rules and existing permissions.

**Existing behavior / assessment:** The assignment dialog has the shared overlay, styles and explicit button states, but inherits the same incomplete keyboard containment as KP-091. The document itself described DEV-ready rather than full post-fix UI verification.

**Connected current-source evidence:**

- [frontend/src/features/ops/AssignOpsDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/AssignOpsDialog.tsx:67>) — Rendered assignment form uses the shared Ops modal and structured actions.
- [frontend/src/features/ops/AssignOpsDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/AssignOpsDialog.tsx:99>) — Save is disabled when no change is selected.
- [frontend/src/features/ops/useOpsModalDismiss.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/useOpsModalDismiss.ts:12>) — Shared custom hook lacks a complete focus trap.

**Missing, contradicted or unproven:**

- Current all-width rendered and keyboard evidence is absent.
- Tab containment and interaction with a portaled staff picker are not implemented by this hook.

**Target behavior / next work:**

- Implement the shared focus fix once with KP-091, then verify this dialog independently.
- Keep vehicle context, eligible staff selection, disabled/no-change save and readable compact actions.

**Required independent checks:**

- Open/change/cancel/save at 390/768/1440; verify focus return, picker layering, long staff names and loading/error states.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-094"></a>

### KP-094 — Refresh handoff readiness after a confirmed order exchange

**Source file:** [QA_PASSED/20260914_P2_QA-057_bug-refresh-handoff-readiness-after-a-confirmed-order-exchange.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-057_bug-refresh-handoff-readiness-after-a-confirmed-order-exchange.docx>)

**Source title (verbatim):** Refresh handoff readiness after a confirmed order exchange

**SHA-256:** `55aff2e828e85b59a90e69bd502028cc51a11601d44f614c39818587991dec7d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-094](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-094>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-094.txt>).

**Requirements read:**

- Refresh the affected detail state after confirmed exchange and on return navigation, so readiness and the handoff action match current authoritative state without a full page reload.
- Previously visited detail pages show the confirmed exchange and correct handoff eligibility on in-app return, without manual reload.
- Keep the action blocked while exchange is unconfirmed or fails; preserve current workflow and permission checks.
- Verify queue, detail and handoff readback agree after save, navigation and refresh, including repeated eligible records and slow responses.

**Existing behavior / assessment:** The confirmed exchange branch invalidates both the trip detail and work inbox. Its production caller still runs through offline command enqueue/drain logic, which must be removed under the current direction.

**Connected current-source evidence:**

- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:257>) — Exchange command is enqueued and awaited; only its confirmed completion drives success.
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:281>) — The matching trip detail and trip list caches are invalidated after confirmation.

**Missing, contradicted or unproven:**

- No current slow-response/failure/prior-visit browser regression proof.
- Offline command replay is not an acceptable final architecture.

**Target behavior / next work:**

- Keep the targeted invalidation after an explicit successful online exchange request when removing the command queue.
- Reconcile the current detail and queue from the same persisted response; preserve failures as failures.

**Required independent checks:**

- Visit detail first, confirm exchange online, return without full reload and verify readiness.
- Reject/timeout the request and verify no false handoff readiness or automatic replay.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-095"></a>

### KP-095 — Show a valid next step for paper handoff on completed trips

**Source file:** [QA_PASSED/20260914_P2_QA-058_bug-show-a-valid-next-step-for-paper-handoff-on-completed-trips.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-058_bug-show-a-valid-next-step-for-paper-handoff-on-completed-trips.docx>)

**Source title (verbatim):** Show a valid next step for paper handoff on completed trips

**SHA-256:** `8ace761f47d06defb5683a54bcff769e1c911b122409461716f7138e44b36a9d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-095](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-095>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-095.txt>).

**Requirements read:**

- Apply trip lifecycle rules to queue and detail actions. For unresolved handoff on a completed trip, explain the blocked state and responsible role or supported correction route. Preserve the server guard against ordinary updates to completed trips.
- Completed and cancelled trips do not advertise handoff actions rejected solely because the record is terminal.
- Missing handoff remains visible with its reason and responsible role or supported correction action. Define the correction process without bypassing the terminal guard.
- An active, assigned trip with exchange complete still permits successful handoff by authorized Ops staff.
- Queue, detail and reload agree on action availability. Verify compact, readable states on phone, tablet and desktop, including keyboard activation.

**Existing behavior / assessment:** The work-inbox service and trip detail expose a terminal blocker and dispatcher-owned next step instead of an enabled handoff action. Current end-to-end evidence for both terminal and active fixtures is missing.

**Connected current-source evidence:**

- [backend/src/services/work-inbox.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/work-inbox.service.ts:211>) — Terminal status excludes handoff eligibility and adds an owner/action explanation.
- [frontend/src/pages/ForwarderTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderTripDetailPage.tsx:353>) — Terminal trip notice and disabled handoff rendering.

**Missing, contradicted or unproven:**

- Historical screenshots/API statements do not verify the current linked UI and route behavior.

**Target behavior / next work:**

- Verify the retained terminal rule and a usable owner/correction next step.
- Keep ordinary delivery handoff separate from removed internal approval workflows.

**Required independent checks:**

- Completed/cancelled trip: no impossible primary action.
- Active exchanged trip: explicit online handoff works; state refreshes in queue and detail.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-096"></a>

### KP-096 — Allow configured Ops categories when saving trip expenses

**Source file:** [QA_PASSED/20260914_P2_QA-059_bug-allow-configured-ops-categories-when-saving-trip-expenses.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-059_bug-allow-configured-ops-categories-when-saving-trip-expenses.docx>)

**Source title (verbatim):** Allow configured Ops categories when saving trip expenses

**SHA-256:** `566d4c51922c23ebd5b32ac003bae6e1d4d2dd3158a12c4d5e62f954cb52d539`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-096](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-096>) in [WP12](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp12>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-096.txt>).

**Requirements read:**

- Save selectable configured categories with their correct identity and rules. Explain unusable categories before submission with actionable Vietnamese feedback; retain the draft on errors.
- A configured selectable category saves successfully; reload retains the correct category, container, amounts and evidence choice.
- Verify both configured codes and supported legacy categories. Disabled or ineligible categories cannot be selected without an explanation.
- Apply the category’s invoice, amount and approval rules consistently; do not bypass them or silently substitute another category.
- Show a clear field-level Vietnamese error for invalid data, preserve the draft and prevent duplicate entries when corrected and retried.

**Existing behavior / assessment:** The enum restriction has been replaced by catalog-backed validation on create and update. Active, non-deleted codes are resolved exactly; current UI-to-database validation and recovery remain unverified.

**Connected current-source evidence:**

- [shared/src/schemas/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/schemas/index.ts:1389>) — Expense type accepts a bounded nonempty code rather than the fixed legacy enum.
- [backend/src/routes/forwarder/expenses.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/forwarder/expenses.ts:26>) — Create/update routes invoke active-category validation.
- [backend/src/services/forwarder-expense-commands.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/forwarder-expense-commands.service.ts:451>) — Code must match an ACTIVE non-deleted catalog row; otherwise Vietnamese validation is raised.

**Missing, contradicted or unproven:**

- No current create/update/reload proof for configured and legacy categories.
- Prior criteria mentioning approval must not recreate internal approval routing.

**Target behavior / next work:**

- Verify the existing category contract through the direct online expense entry path.
- Map invalid/deactivated category errors to the open field without replacing the user draft or duplicating the expense.

**Required independent checks:**

- Save exact active custom code and legacy code; reject inactive/deleted/unknown code on create and update.
- Check receipt, amount, receiver and duplicate-click validation without approval.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-097"></a>

### KP-097 — Align financial policy messages with approval state

**Source file:** [QA_PASSED/20260914_P2_QA-061_bug-align-financial-policy-messages-with-approval-state.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-061_bug-align-financial-policy-messages-with-approval-state.docx>)

**Source title (verbatim):** Align financial policy messages with approval state

**SHA-256:** `bf2d9963107610151ff3fd5cc2abdfc0444b457950d1b46bea7c8f79075cedb0`

**Claimed folder:** QA_PASSED. **Audit:** SUPERSEDED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-097](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-097>) in [WP14](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp14>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-097.txt>).

**Canonical records:** [KP-147](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-147>). No duplicate engineering implementation.

**Requirements read:**

- Make confirmation and feedback match the resulting policy state. If initial Admin creation intentionally approves immediately, state that before confirmation and report approval afterward. If it only requests approval, retain the current policy and show the pending request.
- Define the initial-policy outcome and label the confirmation accurately before the user commits.
- Both tabs report the resulting state and effective date accurately; changed current versions never receive an unchanged-configuration message.
- Pending and approved outcomes are distinct, with a valid next step when approval remains necessary. Preserve the existing permissions and closed-period constraints.
- Retest first-policy creation, subsequent requests and rejected duplicate effective months. Verify readable feedback on phone, tablet and desktop.

**Existing behavior / assessment:** The old target distinguishes approved and pending submissions. That requirement is superseded by the user decision to remove all internal approval. Preserve only truthful direct-save outcome, dates and conflict recovery; coordinate with KP-147 rather than restoring approval.

**Connected current-source evidence:**

- [frontend/src/features/app-settings/FinancePolicySection.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/app-settings/FinancePolicySection.tsx:127>) — Current financial policy section is connected from AppSettingsConfigPage.
- [frontend/src/pages/config/AppSettingsConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/AppSettingsConfigPage.tsx:42>) — Current app settings entry point retains financial-policy and vehicle-policy workflow integration.

**Missing, contradicted or unproven:**

- The completion claim validates an old APPROVED response, not the desired approval-free workflow.
- No current first-save/subsequent-save/duplicate-month all-width evidence.

**Target behavior / next work:**

- Replace request/approved/pending terminology with authorized direct save and effective-date/version history.
- Keep separate duplicate-month versus stale-version feedback and closed-period/role restrictions.

**Required independent checks:**

- First and subsequent direct saves return truthful applied state; future effective versions remain accurately described.
- Duplicate month and stale version preserve the draft and explain different remedies.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-098"></a>

### KP-098 — Keep the session active after an incorrect current password

**Source file:** [QA_PASSED/20260914_P2_QA-063_bug-keep-the-session-active-after-an-incorrect-current-password.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-063_bug-keep-the-session-active-after-an-incorrect-current-password.docx>)

**Source title (verbatim):** Keep the session active after an incorrect current password

**SHA-256:** `9958c552bc305b0121bb81dcecc8b5f44888e3a6e0e530f1adb93bcf28dcdc8d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-098](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-098>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-098.txt>).

**Requirements read:**

- Keep a valid session active and show an inline current-password error. Clear and focus the incorrect sensitive field so the user can retry. Use session-expired feedback and reauthentication when the session has actually expired.
- An incorrect current password produces a field-specific error without ending a valid session or changing the password.
- The dialog supports correcting the value and retrying, with keyboard focus and accessible error announcement. Do not expose password values.
- A genuinely expired session still follows the intended reauthentication flow with an accurate message.
- Retest empty fields, mismatched new passwords, wrong current password and a successful change on phone, tablet and desktop. Existing empty and mismatch validation must remain intact.

**Existing behavior / assessment:** Wrong-current-password returns a validation error rather than an authentication expiry, and the password modal contains inline feedback. The QA statement was API-oriented and does not establish the current interactive session behavior.

**Connected current-source evidence:**

- [backend/src/services/user.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/user.service.ts:452>) — Wrong current password is rejected with status 400.
- [backend/src/services/user.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/user.service.ts:1083>) — Transactional password change uses the same validation distinction.
- [frontend/src/components/layout/PasswordModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/layout/PasswordModal.tsx:65>) — Current password error is rendered in the modal.
- [frontend/src/components/Layout.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/Layout.tsx:548>) — Layout handles password-change failure.

**Missing, contradicted or unproven:**

- No current browser proof that profile, route and valid session remain usable after the failure.
- Expired-session and successful password-change revocation branches were not rerun.

**Target behavior / next work:**

- Verify the existing distinction end to end; keep the dialog draft and focus recovery usable.
- Retain actual expired/revoked-session handling without treating a wrong current password as logout.

**Required independent checks:**

- Wrong current password, empty inputs, mismatch, successful change and genuinely expired session at three widths.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-099"></a>

### KP-099 — Preserve the trip completion date when opening the editor

**Source file:** [QA_PASSED/20260914_P2_QA-065_bug-preserve-the-trip-completion-date-when-opening-the-editor.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-065_bug-preserve-the-trip-completion-date-when-opening-the-editor.docx>)

**Source title (verbatim):** Preserve the trip completion date when opening the editor

**SHA-256:** `751f8f3c13d194f1c3e7f407c29afb62207763e52d02ee86b50df480130cc0e7`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-099](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-099>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-099.txt>).

**Requirements read:**

- Initialize the editor with the same completion calendar date shown in the detail. Preserve that value during unrelated edits unless the user explicitly changes it. Apply one defined business-timezone rule consistently.
- The detail and untouched editor show the same completion calendar date for this record.
- An unrelated field change preserves the original completion date in any submitted change request; an explicit date change remains possible under existing permissions.
- Test timestamps around the Vietnam midnight boundary, including 18:00 UTC on the previous day, plus date-only values. Use correct conversions rather than adding a day indiscriminately.
- Verify reload and cancellation, and readable consistent dates on phone, tablet and desktop. Review shared date utilities while keeping this trip-editor fix independently testable.

**Existing behavior / assessment:** The initial state uses businessDateISO, but the connected edit hydration/reset effect overwrites it with the UTC string date prefix. This leaves the original previous-day defect reachable after async data arrival or reset.

**Connected current-source evidence:**

- [frontend/src/hooks/useTripFormState.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormState.ts:201>) — Initial completedAt is converted through businessDateISO.
- [frontend/src/hooks/useTripFormDispatch.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormDispatch.ts:136>) — Edit data hydrates once per trip and again after reset/refetch.
- [frontend/src/hooks/useTripFormDispatch.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormDispatch.ts:158>) — Hydration writes existingTrip.completedAt.slice(0,10), bypassing business timezone conversion.
- [frontend/src/lib/format.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/format.ts:143>) — Shared business-date formatter explicitly uses Asia/Ho_Chi_Minh.

**Missing, contradicted or unproven:**

- The completion claim checked API stability and the initializer, not the later connected setter.
- Untouched save and 409 reset are not proven safe at business-day boundaries.

**Target behavior / next work:**

- Use one business-date conversion rule for initial state, async hydration, route changes and conflict reset.
- Preserve date-only values according to the API contract; do not silently reinterpret them as instants.

**Required independent checks:**

- At an instant such as 18:00Z, assert detail/editor Vietnam date agrees before and after async hydration.
- Save an unrelated correction untouched; refetch/reset; verify the same persisted business date.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-100"></a>

### KP-100 — Keep optional generated journey legs from blocking trip corrections

**Source file:** [QA_PASSED/20260914_P2_QA-066_bug-keep-optional-generated-journey-legs-from-blocking-trip-corrections.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-066_bug-keep-optional-generated-journey-legs-from-blocking-trip-corrections.docx>)

**Source title (verbatim):** Keep optional generated journey legs from blocking trip corrections

**SHA-256:** `47fb496e656291e5800d6b921bf7c67ce5bb4a792bd570bce33b1e7a6ad12b8c`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-100](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-100>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-100.txt>).

**Requirements read:**

- Preserve absent journey details during unrelated corrections. Untouched suggestions must not require invented endpoints. Validate a leg when the user intentionally adds or edits it.
- Save unrelated corrections on a trip without detailed legs without forcing users to remove generated rows.
- Preserve existing legs; validate endpoints and nonnegative distance for intentionally added or edited legs.
- Dismiss optional suggestions without changing unrelated values; explain genuine blocking requirements.
- Retest absent, existing and new journeys at desktop, tablet and phone sizes; preserve applicable change controls.

**Existing behavior / assessment:** Edit mode now skips automatic leg generation and hydrates actual stored legs. Blank legs are filtered on submit and touched rows drive required endpoints; current browser/native-validation coverage remains incomplete.

**Connected current-source evidence:**

- [frontend/src/hooks/useTripFormLegs.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormLegs.ts:102>) — Edit mode returns before route-based default legs are generated.
- [frontend/src/hooks/useTripFormDispatch.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormDispatch.ts:205>) — Stored legs are hydrated into the edit form.
- [frontend/src/components/trip/JourneyLegRow.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/JourneyLegRow.tsx:19>) — Touched endpoint state controls required fields.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:339>) — Submission excludes empty journey rows.

**Missing, contradicted or unproven:**

- API-only success does not prove browser validation allows an unrelated edit with no journey.
- Distance-only drafts and genuine partial legs need targeted validation coverage.

**Target behavior / next work:**

- Keep stored absence distinct from a user-created partial leg.
- Verify unrelated corrections preserve existing legs and do not manufacture route data.

**Required independent checks:**

- No-leg edit, existing full-leg edit, blank added leg, partial endpoint, invalid distance, and create-mode generation.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-101"></a>

### KP-101 — Align completed trip corrections with the promised review flow

**Source file:** [QA_PASSED/20260914_P2_QA-067_bug-align-completed-trip-corrections-with-the-promised-review-flow.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-067_bug-align-completed-trip-corrections-with-the-promised-review-flow.docx>)

**Source title (verbatim):** Align completed trip corrections with the promised review flow

**SHA-256:** `57517789a458faede5ebf1088891b444b798aadbaf2fb5bd17966e7eb4138d61`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-101](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-101>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-101.txt>).

**Requirements read:**

- If review is required, stage the correction and retain current values until authorized approval. If Managers may apply corrections immediately, replace the review promise with clear immediate-save wording and confirm the financial impact before commitment.
- The permitted outcome for each role and completed-trip state is explicit before submission.
- Review-required corrections preserve current figures and expose the pending request. Permitted direct corrections clearly confirm their immediate effect.
- Feedback, detail and reload agree on pending or applied status, with the correction reason and actor recorded.
- Retest permitted and denied roles, validation and repeated submission. Verify readable confirmation on phone, tablet and desktop.

**Existing behavior / assessment:** The original request to reconcile an approval promise is superseded; direct save is desired. Current submit code still classifies actionKind TRIP_FINANCIAL_CHANGE as pending and announces a review queue, so truthful completion remains partial.

**Connected current-source evidence:**

- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:399>) — actionKind alone is treated as pending governance.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:408>) — Success toast still says the correction was sent to checking/approval.

**Missing, contradicted or unproven:**

- An action kind is not proof that a review is pending.
- The current no-approval direction supersedes the old conditional-review acceptance criterion.

**Target behavior / next work:**

- Use the actual committed/applied outcome to update detail cache and show a truthful saved message.
- Remove the phantom approval queue and coordinate with KP-162/QA-137; do not add approval to match the stale copy.

**Required independent checks:**

- Authorized completed-trip correction saves directly, displays persisted figures after reload, and never claims a pending review.
- Validation, conflict and ancillary failure must not erase the narrower successful commit outcome.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-102"></a>

### KP-102 — Show configuration validation errors inside open forms

**Source file:** [QA_PASSED/20260914_P2_QA-068_bug-show-capital-contribution-errors-inside-the-open-form.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-068_bug-show-capital-contribution-errors-inside-the-open-form.docx>)

**Source title (verbatim):** Show configuration validation errors inside open forms

**SHA-256:** `1111a43164e663e14c841280c58691d5fe3e517ec3cb1fcc279a40c24e0b314f`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-102](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-102>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-102.txt>).

**Requirements read:**

- Show clear Vietnamese guidance beside Số vốn góp or Mức cơ bản inside the active dialog. Associate each error with its field and preserve entered data and invalid-amount rejection.
- Both forms display readable error guidance beside the amount without closing. Use the visible Vietnamese field name and explain the permitted input.
- Associate and announce the error, focus its field or summary appropriately, and retain all values for correction.
- Valid corrections save once with consistent readback; invalid submissions create no record. Preserve each form’s business validation.
- Check visibility and keyboard access on desktop, tablet and phone. Regress other configuration dialogs using the same error-handling pattern.

**Existing behavior / assessment:** CrudTable now moves the alert inside an open add/edit modal. The requirement also asks for amount-field association and focus; the generic top-of-modal alert alone does not provide those.

**Connected current-source evidence:**

- [frontend/src/components/config/CrudTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/config/CrudTable.tsx:204>) — Create error is rendered inside the modal as an alert.
- [frontend/src/components/config/CrudTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/config/CrudTable.tsx:234>) — Edit modal uses the same global alert placement.

**Missing, contradicted or unproven:**

- The rejected amount is not linked to the error by field id/aria-describedby here.
- Current focus-first-invalid and three-width behavior are unverified.

**Target behavior / next work:**

- Keep errors inside the active form and map known validation paths to their fields.
- Associate message and invalid state with the input, focus the first invalid field, and preserve remaining values.

**Required independent checks:**

- Negative capital contribution and road allowance amount: reject, visible field message, keyboard correction, valid retry and retained draft.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-103"></a>

### KP-103 — Make vehicle ownership setup reachable from profit distribution

**Source file:** [QA_PASSED/20260914_P2_QA-069_bug-make-vehicle-ownership-setup-reachable-from-profit-distribution.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-069_bug-make-vehicle-ownership-setup-reachable-from-profit-distribution.docx>)

**Source title (verbatim):** Make vehicle ownership setup reachable from profit distribution

**SHA-256:** `66c67d4ee68914b63d7935dfc374fe170507def642a4e3492ecca7c123e97546`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-103](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-103>) in [WP20](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp20>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-103.txt>).

**Requirements read:**

- Link each blocked vehicle to an authorized ownership editor, or provide that setup at the linked destination. Support effective-dated partner ownership under defined business rules, then let users return and refresh the preview. Preserve the guard against distributing profit without valid ownership.
- The warning identifies affected vehicles and opens the correct authorized ownership editor with context.
- Validate eligible partners, effective dates and share totals using explicitly defined business rules.
- After saving, reopen ownership and refresh the quarterly preview; eligible amounts reflect the saved configuration.
- Retain the ownership guard, explain role restrictions and verify desktop, tablet and phone recovery.

**Existing behavior / assessment:** Profit warning links affected truck ids to an existing ownership editor for Admin; Manager receives an explicit owner restriction. Full saved-ownership-to-preview recovery and business validation are not established by the cited API-only pass.

**Connected current-source evidence:**

- [frontend/src/pages/ProfitPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ProfitPage.tsx:450>) — Warning identifies blocked trucks and links authorized users to the truck-specific owner editor.
- [frontend/src/pages/config/TrucksConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/TrucksConfigPage.tsx:54>) — Truck list exposes the ownership action.
- [frontend/src/pages/config/TruckOwnersConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/TruckOwnersConfigPage.tsx:75>) — Owner form submits partner, percentage and effective date.
- [frontend/src/pages/config/TruckOwnersConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/TruckOwnersConfigPage.tsx:195>) — Current ownership total is summarized and imbalance warned.

**Missing, contradicted or unproven:**

- Eligible partner policy and effective-date/share-total validation need end-to-end proof.
- No current browser save/reopen/return-to-preview proof for Admin and Manager at three widths.

**Target behavior / next work:**

- Verify the per-truck deep link, authorized owner form and effective-date rules together.
- Keep ownership validation as an ordinary distribution prerequisite, separate from removed internal approval.

**Required independent checks:**

- Missing, partial and complete ownership; invalid shares/date/partner under defined policy; save/reopen and refresh preview.
- Manager receives an actionable authorized-owner explanation; direct URL permission remains enforced.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-104"></a>

### KP-104 — Reject malformed company email before saving the profile

**Source file:** [QA_PASSED/20260914_P2_QA-070_bug-reject-malformed-company-email-before-saving-the-profile.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-070_bug-reject-malformed-company-email-before-saving-the-profile.docx>)

**Source title (verbatim):** Reject malformed company email before saving the profile

**SHA-256:** `d8bd1d29261fc1ba462c996db84e2099a714111c6ad26afd900898c476f9b991`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-104](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-104>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-104.txt>).

**Requirements read:**

- Reject a malformed nonblank email with clear Vietnamese feedback at Email and keep the form open for correction. Preserve optional blank behavior where supported. A valid corrected address must save and survive reload.
- Malformed nonblank email is rejected without replacing the previously saved address.
- Provide a Vietnamese field error with an accessible association; preserve unrelated draft values.
- Valid email saves and reloads correctly; retain supported optional blank behavior and required-name validation.
- Verify desktop, tablet and phone correction flows, including malformed, corrected and optional blank values.

**Existing behavior / assessment:** Malformed email is rejected by the UI and schema, but the API schema still rejects an explicit empty string although optional blank is a required supported case. The UI sends that empty string and displays validation globally instead of associating it with Email.

**Connected current-source evidence:**

- [frontend/src/pages/config/CompanyInfoConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.tsx:124>) — Frontend validates only a nonempty trimmed email before sending the form.
- [frontend/src/pages/config/CompanyInfoConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.tsx:325>) — Email input has a label, but not the required error association.
- [frontend/src/pages/config/CompanyInfoConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.tsx:356>) — Save error is a general message near actions.
- [shared/src/schemas/index.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/schemas/index.ts:980>) — Schema applies trim and email validation to the supplied string; an explicit empty string fails that email rule. Omitted/default behavior was not executed and is not asserted here.
- [backend/src/routes/config/operational-config.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/config/operational-config.routes.ts:123>) — Company save parses the provided profile through this schema.

**Missing, contradicted or unproven:**

- Mocked frontend blank-email tests do not validate the connected API schema.
- Inline associated error and current blank save/readback acceptance remain incomplete.

**Target behavior / next work:**

- Make the API contract explicitly accept either blank or a valid trimmed email; keep malformed nonempty values rejected.
- Attach errors to Email with invalid/description state and first-error focus while preserving the draft.

**Required independent checks:**

- API plus real form: omitted email, empty string, whitespace-only, valid email and malformed email; save and reload.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-105"></a>

### KP-105 — Associate company form labels with their fields

**Source file:** [QA_PASSED/20260914_P2_QA-071_bug-associate-company-form-labels-with-their-fields.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-071_bug-associate-company-form-labels-with-their-fields.docx>)

**Source title (verbatim):** Associate company form labels with their fields

**SHA-256:** `6795cd3424dd67838ad7efdafd1cd4b7a07f56601279a5e6d7eb045837bb1d68`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-105](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-105>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-105.txt>).

**Requirements read:**

- Name each control from its visible Vietnamese label using shared labeled form controls. Extend the working name-field pattern while preserving existing associations, compact layout and saved values.
- Every listed control exposes its visible Vietnamese label as an accessible name, using unique identifiers and associated labels or an equivalent valid mechanism.
- Clicking each visible label focuses its intended control; keyboard navigation follows a sensible order without duplicate identifiers or ambiguous names.
- Run a screen-reader check and accessibility-tree inspection on desktop, tablet and phone, covering populated and empty fields.

**Existing behavior / assessment:** Current company fields use visible labels with matching input ids. Static/component evidence supports the implementation; screen-reader and actual pointer label behavior across widths are not current verified evidence.

**Connected current-source evidence:**

- [frontend/src/pages/config/CompanyInfoConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.tsx:227>) — Company fields use htmlFor/id bindings throughout the form.
- [frontend/src/pages/config/CompanyInfoConfigPage.test.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.test.tsx:120>) — Component test names the every-field label contract.

**Missing, contradicted or unproven:**

- No current assistive-technology run or full-width rendered artifact.

**Target behavior / next work:**

- Verify all ten exact Vietnamese accessible names and clicking each label focuses the correct field.
- Retain compact layout and distinguish validation association from label association (KP-104).

**Required independent checks:**

- Keyboard and label-click checks, accessible-name assertions, and a screen-reader sample on the current build.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-106"></a>

### KP-106 — Allow first fuel configuration to save without a missing version loop

**Source file:** [QA_PASSED/20260914_P2_QA-072_bug-allow-first-fuel-configuration-to-save-without-a-missing-version-loop.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-072_bug-allow-first-fuel-configuration-to-save-without-a-missing-version-loop.docx>)

**Source title (verbatim):** Allow first fuel configuration to save without a missing version loop

**SHA-256:** `5d200ae4134c9f9240ba0af641e24edb73423da4fe40ffd80abdeb1ad566fac9`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-106](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-106>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-106.txt>).

**Requirements read:**

- Support the initial configuration save and later version-checked edits. Load or initialize the required state before enabling submission. If loading fails, provide a recovery action that can actually resolve it while preserving the user’s draft.
- A valid initial configuration saves and is visible after reload; fuel-price history reflects the first save.
- Subsequent changes use valid version state; stale edits receive meaningful recovery without silently overwriting changes.
- Distinguish loading, unconfigured and error states; preserve draft input during recoverable failures.
- Verify initial save, later edit and reload recovery on desktop, tablet and phone, preserving numeric and threshold validation.

**Existing behavior / assessment:** First-create versus existing-version submission is implemented. Conflict recovery claims to retain the draft, but invalidation updates fuelConfig and the unconditional hydration effect replaces form values. Loading/fetch failure is also not distinguished from a truly absent config.

**Connected current-source evidence:**

- [frontend/src/pages/config/FuelConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/FuelConfigPage.tsx:22>) — Only query data is consumed; config loading/error are not represented.
- [frontend/src/pages/config/FuelConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/FuelConfigPage.tsx:45>) — Every fresh fuelConfig overwrites the editable form.
- [frontend/src/pages/config/FuelConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/FuelConfigPage.tsx:73>) — Existing timestamp or null is included in save.
- [frontend/src/pages/config/FuelConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/FuelConfigPage.tsx:85>) — Conflict invalidates the query while promising that typed values are retained.
- [backend/src/routes/config/operational-config.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/config/operational-config.routes.ts:93>) — Backend distinguishes initial creation and expected-version updates.

**Missing, contradicted or unproven:**

- The claimed retained-draft conflict behavior is contradicted by the current effect.
- No current genuine-empty initialization, fetch-error or concurrent-session evidence.

**Target behavior / next work:**

- Represent loading, missing configuration and fetch failure separately; block ambiguous save.
- Refresh the authoritative version without replacing dirty values, then present deliberate conflict reconciliation and retry.

**Required independent checks:**

- Genuine first save; existing edit; concurrent update with a dirty draft; failed initial read; history/readback and explicit retry.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-107"></a>

### KP-107 — Make discipline card actions keyboard accessible

**Source file:** [QA_PASSED/20260914_P2_QA-073_bug-make-discipline-card-actions-keyboard-accessible.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-073_bug-make-discipline-card-actions-keyboard-accessible.docx>)

**Source title (verbatim):** Make discipline card actions keyboard accessible

**SHA-256:** `6cc8be4d93cec731025759f89c4b5352326c7ca62bbf3ae1ba46399336b4a6fa`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-107](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-107>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-107.txt>).

**Requirements read:**

- Use native buttons named for the action and record, with keyboard focus and Enter/Space activation. Preserve the compact card layout and current permissions.
- Each action exposes a button role and a Vietnamese name identifying both action and record; decorative icons do not obscure the name.
- Tab and Shift+Tab reach both actions in a sensible order. Focus makes the control visible without hover; Enter and Space trigger the intended action once.
- Preserve edit behavior and deletion safeguards and permissions. Return focus appropriately when a dialog closes or a record is removed.
- Verify keyboard and screen-reader operation across desktop, tablet and phone layouts with multiple cards, without enlarging the card unnecessarily.

**Existing behavior / assessment:** Connected penalty cards now render native edit/delete buttons with record-specific accessible names. Current pointer, keyboard, focus-visible and touch proof remains incomplete.

**Connected current-source evidence:**

- [frontend/src/features/penalties/components/PenaltyReasonActions.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyReasonActions.tsx:8>) — Edit/delete are native buttons with explicit per-record aria-labels.
- [frontend/src/pages/config/PenaltyReasonsConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/PenaltyReasonsConfigPage.tsx:479>) — Every rendered rule card consumes the action component.

**Missing, contradicted or unproven:**

- No current assistive-technology or all-width interaction run.

**Target behavior / next work:**

- Keep native semantics and verify focus indication remains visible even when hover actions are visually subdued.

**Required independent checks:**

- Tab through each record; Enter/Space edit/delete; cancel and focus return; disabled/permission cases and touch.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-108"></a>

### KP-108 — Make penalty records reachable before the expanded driver ranking

**Source file:** [QA_PASSED/20260914_P2_QA-076_enhancement-make-penalty-records-reachable-before-the-expanded-driver-ranking.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-076_enhancement-make-penalty-records-reachable-before-the-expanded-driver-ranking.docx>)

**Source title (verbatim):** Make penalty records reachable before the expanded driver ranking

**SHA-256:** `3d372e832c6ba9f77c6b9a288750311c8a9715e1d01f328912f73b8d7d11d35d`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-108](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-108>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-108.txt>).

**Requirements read:**

- Make the record ledger and pending-record review immediately reachable through primary placement or a clear tab/jump action. Keep rankings available in a compact, collapsible or paginated section, preserving the current creation action.
- From the initial viewport, reach record search and pending records directly without traversing 39 entries.
- Retain complete rankings, their time filters and counts through compact expansion or pagination.
- Preserve Lập biên bản at the top and maintain ledger filters, record actions and position after review.
- Verify phone, tablet and desktop; tab/jump controls must support keyboard use and move focus clearly.

**Existing behavior / assessment:** Phone ranking is collapsed by default, but the full desktop ranking remains before the primary ledger. The document claims desktop was unchanged, while the source requirement asks for prompt record access across device sizes.

**Connected current-source evidence:**

- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:78>) — Mobile ranking defaults closed.
- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:206>) — Mobile ranking toggle exposes the optional ranking.
- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:226>) — Desktop ranking remains an expanded block before records.

**Missing, contradicted or unproven:**

- Primary ledger reachability is not resolved for the full desktop list.
- Old pending-approval review wording is superseded by direct authorized record workflows.

**Target behavior / next work:**

- Make the ledger the primary destination at all widths, with a compact optional ranking or a clear direct jump.
- Keep create access, counts, filtering and cancellation history; do not recreate approval controls.

**Required independent checks:**

- Large driver list at 390/834/1440: reach and search records without traversing every ranking card/row.
- Expand ranking without losing the current ledger context; preserve touch target and keyboard access.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-109"></a>

### KP-109 — Keep pending discipline out of driver pay

**Source file:** [QA_PASSED/20260914_P2_QA-077_bug-keep-pending-discipline-out-of-driver-pay.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-077_bug-keep-pending-discipline-out-of-driver-pay.docx>)

**Source title (verbatim):** Keep pending discipline out of driver pay

**SHA-256:** `6372dc57ef9445e1814dbf0b1429ac5bb978b7ae40ebff3f101c0f7df17de504`

**Claimed folder:** QA_PASSED. **Audit:** SUPERSEDED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-109](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-109>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-109.txt>).

**Requirements read:**

- Exclude pending records from applied payroll deductions and show their status consistently. If Admin creation is intentionally an immediate approval, record and display that approved state under the agreed policy, rather than leaving the item pending.
- Pending records do not change applied deductions or current payable earnings; both roles can see the pending status.
- Authorized approval applies the deduction exactly once and updates both views. Rejection/cancellation follows the defined policy without leaving a pending deduction applied.
- Verify create, reload, approval and cancellation across Admin and Driver on desktop, tablet and phone; distinguish approved deductions from pending amounts.

**Existing behavior / assessment:** The old target requires pending discipline to await approval before pay impact; that policy is superseded. The completion note claims approval removal, but current production UI and routes still implement PENDING plus approval by another user.

**Connected current-source evidence:**

- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:20>) — Current comments/status vocabulary explicitly retain pending until another approver.
- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:462>) — Approve action is offered for pending records created by another user.
- [frontend/src/pages/PenaltyPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/PenaltyPage.tsx:190>) — Page wires the approval handler.
- [backend/src/routes/financial/penalties.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/penalties.routes.ts:163>) — Connected approval endpoint invokes approvePenaltyIdempotent.

**Missing, contradicted or unproven:**

- Current source contradicts the completion statement that all internal approval was removed.
- Historical pending rows need a deliberate migration rule; no automatic relabel-as-approved workaround.

**Target behavior / next work:**

- Implement authorized direct discipline recording with ordinary validation, explicit status and auditable cancellation.
- Remove approval UI/endpoints/business gating, migrate outstanding states deliberately, and calculate payroll from effective non-cancelled records once.

**Required independent checks:**

- Create/edit/cancel direct discipline with correct payroll/ranking effects, permissions and audit trail.
- Verify historical pending records follow the defined migration without hidden deduction or duplicate posting.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-110"></a>

### KP-110 — Keep driver penalty summaries aligned and amounts intact

**Source file:** [QA_PASSED/20260914_P2_QA-078_bug-keep-driver-penalty-summaries-aligned-and-amounts-intact.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-078_bug-keep-driver-penalty-summaries-aligned-and-amounts-intact.docx>)

**Source title (verbatim):** Keep driver penalty summaries aligned and amounts intact

**SHA-256:** `bca617cfc7da746048e26e9d23558ca73bbae951d0779019a9d6775b1fa9a0a6`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-110](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-110>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-110.txt>).

**Requirements read:**

- Use the available summary width consistently with a compact responsive layout. Keep each monetary value intact on one line with a clear currency unit, using tabular numerals and sensible wrapping rules. Keep period labels readable without oversized cards or text.
- At 390px and other supported phone widths, summaries use available width coherently and 60.000 remains an uninterrupted value with its currency unit.
- Use compact balanced columns or rows; do not solve wrapping by oversized text, excessive card height or hiding digits. Preserve readable period labels.
- Verify zero, current and larger permitted amounts on phone, tablet and desktop, with no overlap, truncation or horizontal page overflow.
- Keep values and status policy unchanged by this layout fix; verify the displayed number matches the underlying value.

**Existing behavior / assessment:** Responsive summary styling and narrow-phone amount typography are present. Current rendering with realistic long/large amounts at the stated breakpoints is not established by source or the older small-value fixture.

**Connected current-source evidence:**

- [frontend/src/pages/DriverPenaltyPage.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverPenaltyPage.css:374>) — Narrow-phone styles reduce decorative space and preserve money typography.
- [frontend/src/pages/DriverPenaltyPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverPenaltyPage.tsx:125>) — Page renders the discipline summary metrics.

**Missing, contradicted or unproven:**

- All specified phone/tablet/desktop sizes and large monetary values have not been verified against current HEAD.

**Target behavior / next work:**

- Retest the shared metric layout with representative long labels, large values and status filters.
- Keep whole amounts readable; do not use clipped or ellipsized money.

**Required independent checks:**

- Zero, five-digit and large grouped amounts at 390/420/834/1440, increased text size, and summary/count consistency.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-111"></a>

### KP-111 — Make attendance day clicks update an open payroll draft

**Source file:** [QA_PASSED/20260914_P2_QA-080_bug-make-attendance-day-clicks-update-an-open-payroll-draft.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-080_bug-make-attendance-day-clicks-update-an-open-payroll-draft.docx>)

**Source title (verbatim):** Make attendance day clicks update an open payroll draft

**SHA-256:** `ebde02cb6a8d5c90797a1ee58b0bcd6befd60839668c849b5943850e438c1225`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-111](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-111>) in [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-111.txt>).

**Requirements read:**

- Clicking an eligible attendance day in an open draft must apply the advertised next state with clear saving and success feedback, then persist after reload. If the update fails, explain the reason and restore the prior state. Explain any permission or locking restriction before offering the action.
- Cycle eligible days through the advertised states and persist the selected driver's changes after reload.
- Show pending, success and failure feedback; avoid duplicate updates from repeated clicks and roll back a failed change.
- Preserve restrictions for trip days, locked periods and unauthorized users, with an explanation.
- Verify mouse, keyboard and touch interaction on desktop, tablet and phone without changing another driver or day.

**Existing behavior / assessment:** Optimistic update, rollback and success/error feedback are wired. Desktop cells disable during an update, but the production mobile list discards isUpdating and remains clickable, and the handler has no in-flight guard. Duplicate-update and mobile interaction acceptance remains incomplete.

**Connected current-source evidence:**

- [frontend/src/features/salary-attendance/useSalaryAttendancePage.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/useSalaryAttendancePage.ts:132>) — Handler checks selected driver and lock, then mutates and toasts; no pending-request guard.
- [frontend/src/hooks/useSalaryQueries.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useSalaryQueries.ts:38>) — Workday update applies optimistic cache state and rollback.
- [frontend/src/features/salary-attendance/salary-attendance-components.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/salary-attendance-components.tsx:183>) — MobileDayList ignores isUpdating and renders clickable day rows.
- [frontend/src/pages/SalaryAttendancePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/SalaryAttendancePage.tsx:250>) — MobileDayList is a current reachable production branch.

**Missing, contradicted or unproven:**

- Repeated mobile clicks can enter the handler while the prior update is pending.
- Current persisted pointer/touch success, conflict rollback and cross-driver isolation are not verified.

**Target behavior / next work:**

- Apply one mutation-in-flight guard to all attendance presentations and disable the actual mobile action.
- Use explicit saving state, confirm committed results, and roll back/reconcile failures without changing another driver.

**Required independent checks:**

- Slow request with rapid repeated phone taps; success, network failure and 409; verify exactly one intended transition and correct readback.
- Locked/trip-day/unauthorized restrictions remain intact.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-112"></a>

### KP-112 — Make payroll attendance days keyboard accessible

**Source file:** [QA_PASSED/20260914_P2_QA-081_bug-make-payroll-attendance-days-keyboard-accessible.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-081_bug-make-payroll-attendance-days-keyboard-accessible.docx>)

**Source title (verbatim):** Make payroll attendance days keyboard accessible

**SHA-256:** `d922d06249de7eaa86621491039a2af26ec592255afd072a781b0490beb85e94`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-112](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-112>) in [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-112.txt>).

**Requirements read:**

- Make the compact calendar keyboard operable. Expose each full date, attendance state and editability while retaining payroll safeguards.
- Use native buttons or a complete keyboard calendar pattern. Accessible names include full date and state; decorative icons do not replace these names.
- Tab enters/exits logically; documented arrows may navigate days. Show visible focus and support appropriate Enter/Space activation exactly once.
- Explain locked/read-only days; preserve permissions and payroll locks. Only offer state changes permitted by current business rules.
- Verify keyboard and screen-reader operation on desktop, tablet and phone, including open/closed periods. Keep the calendar compact; pointer persistence is QA-080.

**Existing behavior / assessment:** Desktop CalCell is a native named button, but the mobile day list still uses unnamed non-focusable clickable DIVs. The requested keyboard contract is therefore only partially implemented.

**Connected current-source evidence:**

- [frontend/src/features/salary-attendance/salary-attendance-components.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/salary-attendance-components.tsx:30>) — Desktop CalCell exposes button semantics and a date/state label.
- [frontend/src/features/salary-attendance/salary-attendance-components.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/salary-attendance/salary-attendance-components.tsx:199>) — Mobile interactive day is a DIV with onClick and no keyboard action semantics.
- [frontend/src/pages/SalaryAttendancePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/SalaryAttendancePage.tsx:250>) — The mobile list is connected to the same attendance mutation.

**Missing, contradicted or unproven:**

- Mobile keyboard and assistive-technology access is not implemented by the current row.

**Target behavior / next work:**

- Use a native button for an eligible mobile day with its full date/current-state accessible name.
- Apply lock and pending states consistently with the desktop cell; preserve an orderly Tab sequence and visible focus.

**Required independent checks:**

- At phone width, Tab reaches each eligible day and Enter/Space changes it once; locked/trip days are explained and non-actionable.
- Screen-reader date/state labels and focus stability after save.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-113"></a>

### KP-113 — Keep keyboard focus inside the discipline cancellation dialog

**Source file:** [QA_PASSED/20260914_P2_QA-082_bug-keep-keyboard-focus-inside-the-discipline-cancellation-dialog.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-082_bug-keep-keyboard-focus-inside-the-discipline-cancellation-dialog.docx>)

**Source title (verbatim):** Keep keyboard focus inside the discipline cancellation dialog

**SHA-256:** `44f16ef1063539f7fc4e7ac75ab35fe0622af760ebf4c2d4cf7498483fd0e3ca`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-113](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-113>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-113.txt>).

**Requirements read:**

- Use a shared accessible confirmation dialog with a name and modal semantics. Move focus inside on opening, contain keyboard navigation, make the background inactive, and restore focus when closing.
- The confirmation exposes an appropriate named dialog role and modal state; initial focus moves to a suitable control inside it.
- Tab and Shift+Tab stay inside the open dialog, and background controls cannot receive focus or interaction.
- Escape and Đóng dismiss without cancellation and restore focus to the trigger. Only explicit confirmation performs the existing authorized cancellation.
- Check keyboard, accessibility-tree and screen-reader behavior on desktop, tablet and phone without enlarging the compact layout.

**Existing behavior / assessment:** Cancellation now uses the shared Modal, which invokes useFocusTrap and confirm/cancel shortcuts. That is meaningful implementation evidence, but current keyboard behavior including animated close and focus return remains unverified.

**Connected current-source evidence:**

- [frontend/src/features/penalties/components/CancelPenaltyDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/CancelPenaltyDialog.tsx:25>) — Cancellation is wrapped by shared Modal with explicit name.
- [frontend/src/components/UI.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/UI.tsx:472>) — Modal uses confirmation shortcuts and useFocusTrap for the active content.

**Missing, contradicted or unproven:**

- Historical Escape automation limitations and current all-width keyboard evidence are unresolved.

**Target behavior / next work:**

- Verify the shared modal rather than reintroducing custom focus handling.
- Keep background controls unreachable while open and restore the actual opener after cancel.

**Required independent checks:**

- Tab/Shift+Tab wrap; Escape/close/backdrop behavior; input Enter does not accidentally confirm; focus return after animated dismissal.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-114"></a>

### KP-114 — Exclude cancelled penalties from active rankings and discipline totals

**Source file:** [QA_PASSED/20260914_P2_QA-083_bug-exclude-cancelled-penalties-from-active-rankings-and-discipline-totals.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-083_bug-exclude-cancelled-penalties-from-active-rankings-and-discipline-totals.docx>)

**Source title (verbatim):** Exclude cancelled penalties from active rankings and discipline totals

**SHA-256:** `a79e9c8f201395f6bd7e7ce80fb2cc1b51e712db696b3ee76c552c7f6d88d6d4`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-114](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-114>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-114.txt>).

**Requirements read:**

- Exclude cancelled records from active violation/fine totals, safety streaks and ranking calculations. Recompute affected summaries consistently while retaining the cancelled record and its audit history.
- Cancellation removes the record's contribution from active counts, fine totals, compliance grade and safety streak immediately and after reload.
- Recompute from remaining eligible records across each ranking period; do not reset unrelated records or drivers.
- Retain the cancelled record and cancellation audit details in history, clearly distinct from active totals.
- Verify desktop, tablet and phone summaries; preserve the correctly working payroll reversal.

**Existing behavior / assessment:** Penalty aggregation selects effective ACTIVE records, so cancelled records are excluded from ranking calculations while history remains available. Current full UI/ledger comparison before and after cancellation is not present.

**Connected current-source evidence:**

- [backend/src/services/penalty-reads.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/penalty-reads.service.ts:215>) — Aggregation filters penalty status to ACTIVE.
- [backend/src/tests/penalties-list.test.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/tests/penalties-list.test.ts:1>) — Related penalty listing coverage exists; it was not executed in this review.

**Missing, contradicted or unproven:**

- No current ranking, safe-day, totals and history proof after reload.
- Effective status must be aligned with the requested removal of internal approval.

**Target behavior / next work:**

- Keep cancelled records in history and exclude them from active aggregate inputs.
- Reconcile the same status rule across Admin, Driver and payroll as discipline becomes direct posting.

**Required independent checks:**

- Before/create/cancel/reload comparison of ranking, amount, count and safe days; another active record remains counted.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-115"></a>

### KP-115 — Render uploaded expense receipts after saving and reloading

**Source file:** [QA_PASSED/20260914_P2_QA-087_bug-render-uploaded-expense-receipts-after-saving-and-reloading.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-087_bug-render-uploaded-expense-receipts-after-saving-and-reloading.docx>)

**Source title (verbatim):** Render uploaded expense receipts after saving and reloading

**SHA-256:** `6d1da985e1b9e001091398a71064201ba77f4f69c042c1e9f7231b03a99f4b5d`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-115](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-115>) in [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-115.txt>).

**Requirements read:**

- Show a readable, persisted thumbnail and accessible preview. Resolve the media URL for the authorized user, with distinct loading feedback and a clear retryable error if retrieval fails.
- Both valid fixtures display correctly immediately and after reload, with nonzero intrinsic dimensions and a readable keyboard-accessible preview.
- Loading and failed retrieval have distinct feedback; retry works without creating duplicate entries. Preserve authorized access to expense evidence.
- Delete and replacement still work. Verify the saved image at 1440 × 900, 834 × 1112 and 390 × 844 using compact controls.

**Existing behavior / assessment:** The current expense photo panel renders authenticated previews, failed-image feedback, an explicit reload retry and a viewer. Current successful upload/readback, permissions and loading-state behavior still require validation.

**Connected current-source evidence:**

- [frontend/src/pages/expense-entry-sections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/expense-entry-sections.tsx:77>) — ExpensePhotoAside is the actual connected receipt component.
- [frontend/src/pages/expense-entry-sections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/expense-entry-sections.tsx:103>) — Failed thumbnails produce an explicit alert and retry action.
- [frontend/src/pages/expense-entry-sections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/expense-entry-sections.tsx:122>) — Image source uses the authenticated upload URL helper and load/error handling.
- [frontend/src/pages/ExpenseEntryPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseEntryPage.tsx:696>) — Expense page renders the receipt panel.

**Missing, contradicted or unproven:**

- No current upload/reload/full-view proof for old and newly created records.
- Image loading versus error states and role access remain unverified.

**Target behavior / next work:**

- Verify receipt URLs and explicit retry on the current online form with authorized records.
- Preserve visible failure instead of a broken-image icon; do not add offline storage or replay.

**Required independent checks:**

- Upload, save, fresh reload, preview, delete and readback; forbidden/expired session and transient image failure; explicit retry only.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-116"></a>

### KP-116 — Keep financial summary labels and amounts separate at narrow widths

**Source file:** [QA_PASSED/20260914_P2_QA-093_bug-keep-financial-summary-labels-and-amounts-separate-on-phones.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-093_bug-keep-financial-summary-labels-and-amounts-separate-on-phones.docx>)

**Source title (verbatim):** Keep financial summary labels and amounts separate at narrow widths

**SHA-256:** `00c8b1197a0de70b9735fdfaf3c02ed340dc8e717e0ccc441103a2c0f9601b78`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 6.

**Delivery:** [KP-116](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-116>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-116.txt>).

**Requirements read:**

- Use a compact responsive summary layout that reserves space for both the complete label and its value. Reflow each label above its amount, or use fewer columns when needed, without enlarging the summaries unnecessarily.
- No label, value or currency unit overlaps or clips on all five routes at 390, 834 and 1440 px, including the six-metric Accountant overview.
- Keep amounts, minus signs, decimal precision and currency units intact; allow labels to wrap naturally in a reserved area.
- Verify zero, negative and longer formatted amounts, long labels and text zoom. Preserve logical reading order and readable type.
- Keep summaries compact with consistent alignment and modest padding; preserve calculations. Filters, payroll selection and record cards are outside this task.

**Existing behavior / assessment:** Phone summary rules exist, but the six-item accounting SummaryRail remains one flex row at 834px: wrapping begins only at 700px. The ticket explicitly includes tablet overflow, so the claimed cross-route completion is not supported.

**Connected current-source evidence:**

- [frontend/src/design-system/SummaryRail.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/SummaryRail.css:19>) — Rail uses a single flex row with shrinkable items.
- [frontend/src/design-system/SummaryRail.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/SummaryRail.css:55>) — Values do not shrink within their items.
- [frontend/src/design-system/SummaryRail.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/SummaryRail.css:71>) — First wrapping breakpoint is max-width 700px.
- [frontend/src/features/accounting/AccountingOverview.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/accounting/AccountingOverview.tsx:42>) — Overview supplies six metrics to the same rail.

**Missing, contradicted or unproven:**

- No suitable tablet reflow rule addresses the six-metric 834px case.
- Current five-route geometry and large values are not visually verified.

**Target behavior / next work:**

- Make the summary respond to available container width and metric minimum width, including 834px.
- Use compact wrapping or stacked label/value groups without collisions or truncated monetary values.

**Required independent checks:**

- Expenses, salary, debt, finance and accounting overview at 390/834/1440 with long labels, large totals and zoom.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-117"></a>

### KP-117 — Prevent statement toolbar actions from overlapping on tablets

**Source file:** [QA_PASSED/20260914_P2_QA-104_bug-prevent-statement-toolbar-actions-from-overlapping-on-tablets.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-104_bug-prevent-statement-toolbar-actions-from-overlapping-on-tablets.docx>)

**Source title (verbatim):** Prevent statement toolbar actions from overlapping on tablets

**SHA-256:** `13f28a6732c53552a105b5f23e364b004cda7660ba6ff2f474b998140c1a1898`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-117](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-117>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-117.txt>).

**Requirements read:**

- Keep both toolbar actions fully readable and independently reachable. Reflow the date range, export template and actions before they collide, using the available width efficiently.
- The two actions have non-overlapping bounds and fully readable labels throughout tablet widths and near layout breakpoints.
- Wrap related controls onto a compact additional row when necessary. Keep date and template labels associated with their fields and retain the action order.
- Preserve approximately 44-pixel touch targets, keyboard access and visible focus. Each control must activate only its own action.
- Verify the current fixture, longer labels and text zoom at phone, tablet and desktop sizes. Preserve the line-item editor, export options, notes and dialog footer without adding oversized fields or unnecessary vertical gaps.
- Regression-check filtering and adding a presentation row after the layout fix. Preserve existing values, calculations and permissions.

**Existing behavior / assessment:** The statement toolbar wraps controls below 880px and preserves touch-height actions. Current actual button geometry and action behavior at tablet width are not proven by the DEV-completed note.

**Connected current-source evidence:**

- [frontend/src/components/billing/BillingDocumentBuilder.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/billing/BillingDocumentBuilder.css:516>) — Responsive toolbar wrap rules for narrow containers.

**Missing, contradicted or unproven:**

- No current rendered tablet evidence or complete statement action regression.

**Target behavior / next work:**

- Verify the existing wrapping implementation with the longest labels and real selected statement.
- Retain data-entry width and reachable generate/cancel actions without collision.

**Required independent checks:**

- 834px/768px tablet plus 390/1440; keyboard order, long labels, enabled/loading/error actions.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-118"></a>

### KP-118 — Make the customer delivery confirmation button visible

**Source file:** [QA_PASSED/20260914_P2_QA-107_bug-make-the-customer-delivery-confirmation-button-visible.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-107_bug-make-the-customer-delivery-confirmation-button-visible.docx>)

**Source title (verbatim):** Make the customer delivery confirmation button visible

**SHA-256:** `487a49aa9debbd15c1801fbdcfb43d8e0b075739f82a37e90d6504ce0b5f2bb6`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-118](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-118>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-118.txt>).

**Requirements read:**

- Give the customer delivery acknowledgment a clearly visible compact button treatment on every row background. Keep it distinguishable from reporting a discrepancy and from disabled or busy states.
- The enabled acknowledgment has a legible label and visible control boundary on normal, alternate, hovered and focused row backgrounds. Use at least 4.5:1 normal-text contrast.
- Preserve a clear visual distinction between delivery acknowledgment and discrepancy reporting. Do not require hover or focus to discover the acknowledgment.
- Retain its accessible name, keyboard activation, visible focus and approximately 44-pixel phone touch target without oversized controls.
- Disabled and busy states remain understandable and cannot resemble an enabled control that disappeared. Verify loading, eligible and already-acknowledged states.
- Check all three viewport sizes and the intended acknowledgment result. Do not introduce an internal approval step or change shipment status merely to repair the styling.

**Existing behavior / assessment:** Customer confirmation uses the shared brand button colors rather than transparent or invisible styling. The previous attempt with the wrong role cannot establish current Customer UI completion.

**Connected current-source evidence:**

- [frontend/src/components/work-inbox/RoleWorkInbox.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.css:61>) — Primary work-inbox action uses brand foreground/background tokens.
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:463>) — Actual customer acknowledgement button uses the class.

**Missing, contradicted or unproven:**

- No current correct-role rendered contrast, hover/focus and successful confirmation proof.

**Target behavior / next work:**

- Retest as a scoped CUSTOMER on an eligible shipment.
- Keep customer delivery acknowledgement; it is an external business action, not internal approval.

**Required independent checks:**

- Visible default/hover/focus/busy/disabled states at 390/834/1440; explicit online success and failure with scoped permissions.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-119"></a>

### KP-119 — Keep the customer discrepancy form within the visible row

**Source file:** [QA_PASSED/20260914_P2_QA-108_bug-keep-the-customer-discrepancy-form-within-the-visible-row.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-108_bug-keep-the-customer-discrepancy-form-within-the-visible-row.docx>)

**Source title (verbatim):** Keep the customer discrepancy form within the visible row

**SHA-256:** `41a931f4d443a6417b0859535aac50a632c02209af58156b049701b202aab8c9`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-119](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-119>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-119.txt>).

**Requirements read:**

- Keep the expanded discrepancy editor and its actions visible together. Use a full-width expanded row, a suitably sized popover or a sheet with shipment context. Fit the form to the available width with modest padding, a useful reason field and clear Submit and Cancel actions.
- Opening the editor keeps the entire reason field and both actions inside the visible content area without table-level horizontal scrolling.
- Preserve the shipment identity and existing permissions, validation, submission and cancellation behavior; do not trigger the row’s navigation while editing.
- At 390, 834 and 1440 px, keep labels and actions readable, spacing compact and touch targets usable. Avoid nested decorative cards or unnecessary blank space.
- Verify keyboard entry, focus order, visible focus, long reasons, inline errors, pending submission and cancellation; opening or resizing the editor must preserve the draft.

**Existing behavior / assessment:** The discrepancy form now occupies a full expanded table row with a spanning cell rather than the narrow action column. Current clipping, mobile layout and preserved-draft behavior need real layout verification.

**Connected current-source evidence:**

- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:471>) — Expanded discrepancy form is in a separate full-width spanning table row.
- [frontend/src/components/work-inbox/RoleWorkInbox.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.css:289>) — Dedicated full-row discrepancy layout styles.

**Missing, contradicted or unproven:**

- No current rendered proof that the full textarea and actions remain visible without horizontal scrolling at desktop.

**Target behavior / next work:**

- Verify the expanded-row implementation at all three widths and with a long typed discrepancy.
- Keep source-record context and explicit save/cancel; preserve the draft on validation/conflict.

**Required independent checks:**

- Desktop clipping boundary, tablet reflow, phone touch/soft keyboard, keyboard focus, empty/long reason and failed-save recovery.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-120"></a>

### KP-120 — Restore contrast for the expected profit label in trip creation

**Source file:** [QA_PASSED/20260914_P2_QA-121_bug-restore-contrast-for-the-expected-profit-label-in-trip-creation.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-121_bug-restore-contrast-for-the-expected-profit-label-in-trip-creation.docx>)

**Source title (verbatim):** Restore contrast for the expected profit label in trip creation

**SHA-256:** `e9e9f4df016d9fd8bf68ae25b3582e54a77c0addf7f995c1df4d569dfdfc83c7`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-120](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-120>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-120.txt>).

**Requirements read:**

- Render the expected-profit label with legible contrast against its actual card background. Keep the label and value visually associated and use a consistent financial-summary text treatment.
- Use at least 4.5:1 contrast for the normal-size label against the rendered background, including any transparency.
- Keep label and amount readable together for zero, positive and negative estimates. Do not change calculation or sign formatting as part of the styling fix.
- Verify every estimate label at desktop, tablet and any phone state that exposes the summary. Preserve readable typography and compact spacing.
- Check shared summary text styles on both pale and dark surfaces so repairing this label does not make another variant unreadable. Keep financial labels accessible in the document structure.

**Existing behavior / assessment:** The hard-coded light label color was removed in favor of the summary theme, and profit sign presentation is explicit. Current color contrast in the production palette and all result states is not proven.

**Connected current-source evidence:**

- [frontend/src/components/trip/TripSummaryCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/TripSummaryCard.tsx:44>) — Profit label no longer forces the problematic inline white color.
- [frontend/src/components/trip/TripSummaryCard.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/TripSummaryCard.css:82>) — Shared summary styling owns label/value colors.

**Missing, contradicted or unproven:**

- No current measured contrast or rendered positive/zero/negative result comparison.

**Target behavior / next work:**

- Verify the label and amount in their actual rendered background states.
- Keep expected versus saved semantics clear and preserve negative sign visibility.

**Required independent checks:**

- Positive, zero and negative profit at phone/tablet/desktop; focus/zoom and contrast check against the active palette.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-121"></a>

### KP-121 — Persist clearing of optional truck text fields

**Source file:** [QA_PASSED/20260914_P2_QA-132_bug-persist-clearing-of-optional-truck-text-fields.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-132_bug-persist-clearing-of-optional-truck-text-fields.docx>)

**Source title (verbatim):** Persist clearing of optional truck text fields

**SHA-256:** `dd14702dd645ce61d17f2dde04d51fcce5bd8c7093ff85bb98199c499edffa64`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-121](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-121>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-121.txt>).

**Requirements read:**

- Represent an intentional clear with the supported explicit null value, while preserving any deliberately untouched fields. Reopened and reloaded truck data must match the saved blank form.
- Each intentionally cleared text field is sent as explicit null and remains blank in API readback and both editors after reload.
- Nonempty text remains trimmed where appropriate. Unchanged metadata and carrier/trailer relationships remain intact.
- Add a component/serialization test for clear versus unchanged values and an API persistence regression using the existing nullable schema. Retain optimistic concurrency and idempotency guards.
- Verify clearing and saving at phone, tablet and desktop widths; no additional field or oversized control is needed.

**Existing behavior / assessment:** The truck editor sends null for cleared optional text fields, resolving the undefined-omission cause in the form. Current API persistence from both entry points is not verified.

**Connected current-source evidence:**

- [frontend/src/features/fleet/TruckFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/TruckFormModal.tsx:96>) — Optional cleared truck fields are normalized to null for submission.
- [frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx:278>) — Internal vehicle view consumes the truck edit flow.

**Missing, contradicted or unproven:**

- No current save/reload proof for clearing each optional field and preserving unrelated data.

**Target behavior / next work:**

- Verify nullable payload handling through both fleet edit entry points.
- Keep omitted-field semantics distinct from explicit clear and preserve version/permission checks.

**Required independent checks:**

- Populate then clear every nullable text field, save/reload, compare untouched fields; conflict and invalid-required-field cases.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-122"></a>

### KP-122 — Keep keyboard active options visible in searchable selectors

**Source file:** [QA_PASSED/20260914_P2_QA-133_bug-keep-keyboard-active-options-visible-in-searchable-selectors.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P2_QA-133_bug-keep-keyboard-active-options-visible-in-searchable-selectors.docx>)

**Source title (verbatim):** Keep keyboard active options visible in searchable selectors

**SHA-256:** `02dde08a13770646a3fde31f2b8fdb3d398b44ce1dd2ab74fbfd7499b8789320`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-122](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-122>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-122.txt>).

**Requirements read:**

- Keep the active option visibly inside the list viewport as keyboard navigation, filtering or opening changes it. Preserve search-input focus, the active-descendant relationship and compact list height.
- Every active option is visible while navigating with ArrowUp/ArrowDown and on reopening. Scroll only the list as needed; avoid jumping the page or moving typing focus.
- Enter selects the visible active option; multi-select toggles it without losing focus. Empty results and changed option sets have a valid active index.
- Add overflow-list tests and a real-browser geometry check at desktop, tablet and phone widths, including zoom. Retain search, clearing, Escape and focus return.
- Verify accessible active-option announcements separately with a screen reader. Keep compact typography and existing touch target dimensions.

**Existing behavior / assessment:** Both selectors scroll the active option into view on keyboard movement. Existing short-list component tests do not prove overflow geometry, list-only scrolling or long-list behavior.

**Connected current-source evidence:**

- [frontend/src/design-system/forms/SearchableSelect.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/forms/SearchableSelect.tsx:193>) — Active option scrollIntoView runs when selection navigation changes.
- [frontend/src/design-system/forms/SearchableMultiSelect.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/design-system/forms/SearchableMultiSelect.tsx:193>) — Multi-select has corresponding active-option scroll behavior.

**Missing, contradicted or unproven:**

- No current overflowed real-list keyboard/scroll/zoom evidence.
- Relevant tests do not demonstrate every long-list boundary and focus condition.

**Target behavior / next work:**

- Verify keyboard navigation through real overflowed lists and preserve the trigger/parent scroll context.
- Keep filtering, reopening and loading further options synchronized with a valid active index.

**Required independent checks:**

- Arrow/Home/End/Enter beyond initial viewport; filter after scrolling, reopen, load more, multi-select, nested modal and zoom.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-123"></a>

### KP-123 — Show compact module and record titles across the app

**Source file:** [QA_PASSED/20260914_P3_QA-028_enhancement-show-a-clear-compact-title-for-each-configuration-page.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-028_enhancement-show-a-clear-compact-title-for-each-configuration-page.docx>)

**Source title (verbatim):** Show compact module and record titles across the app

**SHA-256:** `099e8b114ae9944d0ead7aaf099d775cab63513a71b553da10457a61650cf5be`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 4.

**Delivery:** [KP-123](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-123>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-123.txt>).

**Requirements read:**

- Show the current module and, on record pages, the relevant identity in one compact header or toolbar. Preserve clear parent context and back navigation without a large banner.
- Each affected configuration page visibly names its module; tire pages visibly identify the selected vehicle plate beside the module context.
- Visible title, accessible heading and selected record agree after direct navigation, record changes and back navigation.
- Keep titles readable and compact across desktop, tablet and phone, preserving space for data and controls.

**Existing behavior / assessment:** CrudTable opts into visible module titles, and tire views resolve vehicle identity. Current visual verification for every named module and truck/trailer record remains unavailable.

**Connected current-source evidence:**

- [frontend/src/components/config/CrudTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/config/CrudTable.tsx:105>) — Generic configuration table requests a visible page title.
- [frontend/src/components/PageHeader.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/PageHeader.tsx:25>) — PageHeader supports visible versus screen-reader-only title presentation.
- [frontend/src/pages/TruckTiresPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TruckTiresPage.tsx:67>) — Tire page resolves the vehicle label for record identity.

**Missing, contradicted or unproven:**

- No current per-route three-width evidence for all configurations and tire record titles.

**Target behavior / next work:**

- Check visible module and record identity once per distinct page template without duplicating giant headers.
- Preserve compact actions/breadcrumbs and meaningful loading/missing-record state.

**Required independent checks:**

- Direct navigation/back and truck-to-trailer record switches at 390/834/1440; long plate/title and no duplicate headings.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-124"></a>

### KP-124 — Remove the internal dashboard version label from the main summary

**Source file:** [QA_PASSED/20260914_P3_QA-033_enhancement-remove-the-internal-dashboard-version-label-from-the-main-summary.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-033_enhancement-remove-the-internal-dashboard-version-label-from-the-main-summary.docx>)

**Source title (verbatim):** Remove the internal dashboard version label from the main summary

**SHA-256:** `61e603560c4ebffb9ffbe920a8e86f3a5520be282a2788e1c63903211f7d16c1`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-124](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-124>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-124.txt>).

**Requirements read:**

- Keep the useful refresh timestamp and data-completeness status in plain language. Remove the technical version identifier from the normal summary, or place it in an explicit diagnostics view if it is needed for support.
- The normal dashboard summary no longer displays executive-dashboard-v1 or a comparable unexplained internal version token.
- The refresh timestamp and meaningful data-completeness warnings remain visible and accurate.
- Any support identifier remains available only through deliberate diagnostic access, if required.
- The compact layout remains readable at mobile, tablet and desktop widths.

**Existing behavior / assessment:** The internal definition token is confined to a footer tooltip while the visible footer shows the update time. Current rendered and accessibility behavior remains unverified.

**Connected current-source evidence:**

- [frontend/src/components/dashboard/ExecutiveFinancialStrip.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/dashboard/ExecutiveFinancialStrip.tsx:97>) — Technical definition identifier is placed in the title attribute; visible copy is the update time.
- [frontend/src/pages/DashboardPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DashboardPage.tsx:370>) — Dashboard consumes this strip when capability allows.

**Missing, contradicted or unproven:**

- No current loading/error/partial/complete dashboard visual comparison.

**Target behavior / next work:**

- Verify the visible dashboard contains only useful business metadata while optional support details remain unobtrusive.

**Required independent checks:**

- Complete/partial/loading/error states and timestamp readability at all widths.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-125"></a>

### KP-125 — Show a compact status on every advance request

**Source file:** [QA_PASSED/20260914_P3_QA-041_enhancement-show-a-compact-status-on-every-advance-request.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-041_enhancement-show-a-compact-status-on-every-advance-request.docx>)

**Source title (verbatim):** Show a compact status on every advance request

**SHA-256:** `ad04f320f53ce91fe280466650e104e57b5cd7d026b2246cf7869adcd29144d7`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P3. **Images:** 5.

**Delivery:** [KP-125](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-125>) in [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-125.txt>).

**Requirements read:**

- Display a short textual status on every advance row or card, using the existing status vocabulary. Place it within the current compact layout, keeping amount and purpose easy to scan and approval metadata secondary.
- Every row or card shows its actual status in text, including the All view; status remains consistent with filters and counts.
- Use a compact label or badge within existing space at desktop, tablet and mobile widths; do not add taller cards or oversized text.
- Retain approval metadata. Where a rejected state and reason exist, make the reason accessible without expanding every row by default. No rejected fixture was exercised.

**Existing behavior / assessment:** Every advance card now shows a textual status, but its vocabulary and metadata still encode internal approval. The compact status pattern is useful; the approval-preservation target is obsolete and needs revision with the advance workflow removal package.

**Connected current-source evidence:**

- [frontend/src/pages/ForwarderAdvancesPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderAdvancesPage.tsx:301>) — Every record renders a status badge.
- [frontend/src/pages/ForwarderAdvancesPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderAdvancesPage.tsx:313>) — Approver/rejection metadata remains part of the card.
- [frontend/src/pages/ForwarderAdvancesPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderAdvancesPage.tsx:252>) — Status filters are built from the shared approval vocabulary.

**Missing, contradicted or unproven:**

- Current direct-workflow status vocabulary and historical-state migration are not defined by this old record.
- No current all-width badge/filter consistency evidence.

**Target behavior / next work:**

- Retain the compact per-row state, but derive it from authorized direct-save/payment lifecycle instead of approval.
- Coordinate with KP-148/advance removal and preserve historical audit facts without exposing new approval actions.

**Required independent checks:**

- Mixed records in All and each current-state filter: labels/counts agree; long purposes do not enlarge every card.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-126"></a>

### KP-126 — Preserve the customer shipment queue when returning from details

**Source file:** [QA_PASSED/20260914_P3_QA-043_enhancement-preserve-the-customer-shipment-queue-when-returning-from-details.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-043_enhancement-preserve-the-customer-shipment-queue-when-returning-from-details.docx>)

**Source title (verbatim):** Preserve the customer shipment queue when returning from details

**SHA-256:** `7ee5dca623d689b2c672569e9111fbbc8a37c4e61cfab4b6a746acd3fe5966ea`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-126](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-126>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-126.txt>).

**Requirements read:**

- Restore the selected queue, list position and useful focus so customers can continue reviewing nearby shipments. Retain the current customer scope.
- The explicit Danh sách lô hàng link restores the originating queue selection and relevant list position after reviewing a shipment.
- Restore focus to the originating record or a sensible list fallback if it moved queues; preserve the scoped customer.
- Directly opened details without prior list context have a valid default return destination.
- Verify repeated list-detail-return cycles on phone, tablet and desktop; add no extra filters or controls.

**Existing behavior / assessment:** Queue tab/page/row are encoded in navigation and echoed by the detail return link. The list consumes return context and restores focus; current browser position and stale-row recovery are not verified.

**Connected current-source evidence:**

- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:118>) — List reads queue/page return parameters.
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:181>) — Return context is consumed and originating row focus is restored.
- [frontend/src/pages/portal/PortalShipmentDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/portal/PortalShipmentDetailPage.tsx:62>) — Detail return link preserves tab/page/row parameters.

**Missing, contradicted or unproven:**

- No current back-navigation proof for long lists, moved/deleted rows or changed customer scope.

**Target behavior / next work:**

- Verify URL-based context restoration without adding offline state or leaking another scope.
- Define a safe fallback when the originating row is no longer in the page.

**Required independent checks:**

- Open from later page/filter, return, browser back, direct detail link, row moved/removed and account scope change.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-127"></a>

### KP-127 — Make customer shipment cards easier to scan on phones

**Source file:** [QA_PASSED/20260914_P3_QA-044_enhancement-make-customer-shipment-cards-easier-to-scan-on-phones.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-044_enhancement-make-customer-shipment-cards-easier-to-scan-on-phones.docx>)

**Source title (verbatim):** Make customer shipment cards easier to scan on phones

**SHA-256:** `0127d768e92a82178deb43fb2148837ae3d72b7e3f592695f68d547e2dfe60db`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-127](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-127>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-127.txt>).

**Requirements read:**

- Prioritize shipment identity, container, clearly labeled status and the record action. Omit empty milestone rows, show actual blockers and group secondary metadata. Preserve full detail access without enlarging components or text.
- Empty milestone fields do not create dedicated rows. Actual milestones and blockers remain clearly visible when present.
- Group secondary metadata and remove redundant copy while retaining shipment/container identity, meaningful status and Xem hồ sơ.
- At 390 × 844 with these fixtures, aim to show two complete compact cards in the current content area, with readable text and usable touch actions.
- Verify long identifiers, multiple containers and populated blockers; retain the compact desktop table. Status wording is handled separately in QA-042.

**Existing behavior / assessment:** Customer-only irrelevant milestone columns and empty mobile fields are suppressed, while relevant record data remains. The document does not supply current height/readability evidence for realistic dense and blocked cards.

**Connected current-source evidence:**

- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:401>) — Role-dependent table rendering distinguishes customer information from Ops controls.
- [frontend/src/components/work-inbox/RoleWorkInbox.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.css:373>) — Mobile card rules hide explicitly empty cells.

**Missing, contradicted or unproven:**

- No current two-card density comparison with long locations, multiple containers and blockers.

**Target behavior / next work:**

- Verify the compact card information hierarchy with realistic fixtures and keep the primary customer action visible.
- Preserve full details in deliberate expansion rather than blank rows or nested cards.

**Required independent checks:**

- 390px cards with missing and complete fields, long identifiers, multiple blockers, large text and linked detail access.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-128"></a>

### KP-128 — Keep tablet multi container entry compact

**Source file:** [QA_PASSED/20260914_P3_QA-046_enhancement-keep-tablet-multi-container-entry-compact.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-046_enhancement-keep-tablet-multi-container-entry-compact.docx>)

**Source title (verbatim):** Keep tablet multi container entry compact

**SHA-256:** `684b2758c99edc53f25ec67f73d275ae81eb7128e5bc732517f33925f83b3bec`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-128](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-128>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-128.txt>).

**Requirements read:**

- Retain two columns but reduce unnecessary vertical gaps. Keep identity, values and edit controls easy to compare, preserving readable labels, contextual addresses and the editing workflow.
- At 768 × 1024, populated container cards use materially less height than the captured 488-pixel example, without shrinking text or touch targets.
- Retain two-column alignment, visible container identity and labels; long names, addresses and validation messages wrap without overlap.
- Dropdowns, date entry, adding and removing containers, focus order and per-container values remain usable and distinct.
- Verify populated and invalid drafts plus desktop and phone layouts; this scope is the creation form.

**Existing behavior / assessment:** Current shipment container entry uses compact responsive rows and a two-column card fallback. The modest historical height measurement does not establish a material current density improvement or the full interaction requirements.

**Connected current-source evidence:**

- [frontend/src/pages/clerk/ClerkShipmentCreatePage.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/clerk/ClerkShipmentCreatePage.css:208>) — Container table falls back to a compact two-column row with small gaps/padding.
- [frontend/src/pages/clerk/ClerkShipmentCreatePage.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/clerk/ClerkShipmentCreatePage.css:218>) — Tablet layout removes duplicated page padding.
- [frontend/src/features/shipments/create/ShipmentContainerCell.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/create/ShipmentContainerCell.css:2>) — Editable cell retains the touch control minimum height.

**Missing, contradicted or unproven:**

- No current measured tablet card height versus the original approximately 488px baseline.
- Validation, repeated container editing and keyboard/soft-keyboard behavior remain unverified.

**Target behavior / next work:**

- Measure the current end-to-end multi-container form and remove redundant spacing while preserving readable labels and tap targets.
- Reuse compact aligned fields rather than nesting more cards.

**Required independent checks:**

- Two and many containers at 768/834/1440/390; long data, field errors, add/remove, route/date pickers and save readiness.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-129"></a>

### KP-129 — Keep vehicle card actions compact and readable on phones

**Source file:** [QA_PASSED/20260914_P3_QA-056_enhancement-keep-vehicle-card-actions-compact-and-readable-on-phones.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-056_enhancement-keep-vehicle-card-actions-compact-and-readable-on-phones.docx>)

**Source title (verbatim):** Keep vehicle card actions compact and readable on phones

**SHA-256:** `cdedc85ada93106310e5f8bc9a6d6c7fee17d0147d50a4b2bddce8166ebc2946`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-129](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-129>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-129.txt>).

**Requirements read:**

- Use the available card width for compact, clearly labeled actions. A full-width action row with sensible wrapping or an accessible overflow menu can preserve readable labels without enlarging text or controls unnecessarily.
- Keep every action label readable as intact words; prevent character-by-character wrapping of Xóa.
- Use the card width efficiently, retain adequate touch targets and distinguish the destructive action without oversized text or excess vertical space.
- If using an overflow menu, give it a clear accessible name and expose all permitted actions with keyboard and touch support.
- Verify phone widths and longer labels, plus tablet and desktop regression. Preserve each action's vehicle context, permissions and existing confirmation behavior.

**Existing behavior / assessment:** Catalog CSS now makes the action row span the mobile card and wrap whole labels rather than individual characters. Current longest-label and permission-state layouts still need visual confirmation.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/catalogs/catalogs.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/catalogs.css:223>) — Vehicle action group spans full card width and wraps buttons.
- [frontend/src/features/dispatch/catalogs/catalogs.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/catalogs.css:238>) — Action labels are kept unbroken.
- [frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/catalogs/FleetVehiclesView.tsx:241>) — Internal vehicle table renders the relevant action group.

**Missing, contradicted or unproven:**

- No current full set of actions, loading/disabled labels and phone/tablet comparison.

**Target behavior / next work:**

- Verify real role-dependent actions remain compact and fully readable with sufficient touch targets.

**Required independent checks:**

- 390px vehicle cards, long labels, permission-reduced actions, busy state, keyboard and detail opening without accidental row activation.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-130"></a>

### KP-130 — Localize administrative form validation beside the affected fields

**Source file:** [QA_PASSED/20260914_P3_QA-062_enhancement-localize-account-validation-beside-the-affected-fields.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20260914_P3_QA-062_enhancement-localize-account-validation-beside-the-affected-fields.docx>)

**Source title (verbatim):** Localize administrative form validation beside the affected fields

**SHA-256:** `5c6b21fb8b2d2d9e8646039f181872b116deccbe8ecf13406af429b02ac2c5af`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-130](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-130>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-130.txt>).

**Requirements read:**

- Use concise Vietnamese messages beside the affected fields, with accessible associations and first-error focus. Any summary should use visible field labels and avoid raw schema names or duplicate technical messages.
- Provide Vietnamese field messages for Email, Mật khẩu mới and Tiền kết hợp mặc định using their visible labels.
- Associate and announce validation feedback, focus the first invalid field and preserve unrelated input.
- Clear resolved errors and avoid duplicate or contradictory summary and inline messages.
- Retain rejection rules and supported blank optional email; retest combined errors and correction on desktop, tablet and phone.

**Existing behavior / assessment:** User edit has associated Vietnamese field errors and focus handling. Trip expense configuration shows Vietnamese messages but lacks aria-invalid and aria-describedby/message ids on the affected fields, so the broadened acceptance contract is partial.

**Connected current-source evidence:**

- [frontend/src/features/users/components/UserEditPanel.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/UserEditPanel.tsx:119>) — User edit builds field-specific messages and focuses the first invalid input.
- [frontend/src/features/users/components/UserEditPanel.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/users/components/UserEditPanel.tsx:215>) — Email input exposes invalid/description associations.
- [frontend/src/pages/config/TripExpenseConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/TripExpenseConfigPage.tsx:104>) — Expense config input has id/name but no error association or invalid state.
- [frontend/src/pages/config/TripExpenseConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/TripExpenseConfigPage.tsx:106>) — Separate alert paragraph lacks an id linking it to the input.

**Missing, contradicted or unproven:**

- Trip-expense fields do not expose the same accessible error contract as user edit.
- API validation alone does not verify both actual editing entry points and focus correction.

**Target behavior / next work:**

- Apply reusable field-error ids, aria-invalid and aria-describedby to all five expense amounts.
- Preserve Vietnamese messages, first-error focus, correction/retry and optional blank email semantics.

**Required independent checks:**

- Combined invalid email/password and each negative expense amount: reject, focus, announce associated error, correct and save.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-131"></a>

### KP-131 — Reliable logout and account switching

**Source file:** [QA_PASSED/20261109_4-bug1-logout-not-working.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20261109_4-bug1-logout-not-working.docx>)

**Source title (verbatim):** Please fucking user browser click to test don’t fucknig use headless to test

**SHA-256:** `55e9f590d5a46e88e7d89fd62426728097949e37e584b218a24cedb36d145ddb`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 12.

**Delivery:** [KP-131](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-131>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-131.txt>).

**Requirements read:**

- Logout must work from the real Admin and Driver UI, clear the active local session and revoke the appropriate server session.
- Use actual pointer interaction, then verify login redirect and protected-route access; do not infer success from programmatic click only.

**Existing behavior / assessment:** The mobile overlay is marked as part of the dropdown interaction region and the logout button calls the shared auth flow. Historical multi-round staging evidence explains the pointer event fix, but is not current-HEAD verification.

**Connected current-source evidence:**

- [frontend/src/components/Layout.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/Layout.tsx:796>) — Mobile overlay participates in dropdown-root event ownership.
- [frontend/src/components/Layout.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/Layout.tsx:864>) — Logout action remains connected to the shared handler.

**Missing, contradicted or unproven:**

- No current real pointer-down/up proof across Admin and Driver, nor current server revocation readback.
- Related cross-session logout and offline-token/queue retirement work must be considered separately.

**Target behavior / next work:**

- Verify actual pointer and keyboard logout on the current build and isolate rapid session changes.
- Remove offline sync behavior under the current direction without weakening server session revocation or local exit.

**Required independent checks:**

- Admin and Driver desktop/phone logout, duplicate clicks, slow revocation, new session before old request resolves, and post-logout protected navigation.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-132"></a>

### KP-132 — Issued orders visible on the driver board

**Source file:** [QA_PASSED/20261109_4-bug2-driver-screen-missing-dispatched-order.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20261109_4-bug2-driver-screen-missing-dispatched-order.docx>)

**Source title (verbatim):** Nguồn: 20261109_4.docx — Bug 2

**SHA-256:** `e7da8ee51e1790dfcabb9c6588b5a176f07612265abe104fae18ecd72a91fe0a`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 6.

**Delivery:** [KP-132](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-132>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-132.txt>).

**Requirements read:**

- An eligible shipment dispatched to the intended driver must appear on that driver’s new-order board with matching identifiers.
- Incomplete route/trailer/allocation readiness must produce actionable feedback rather than unexplained missing work.

**Existing behavior / assessment:** Driver board selects the assigned driver and eligible fulfillment trip states. The document contains a historical fixture-specific issuance investigation; current issue-to-board behavior and all readiness boundaries are not fully established.

**Connected current-source evidence:**

- [backend/src/services/driver-journey-board.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-journey-board.service.ts:182>) — Board query scopes by driver, fulfillment linkage and eligible trip status.

**Missing, contradicted or unproven:**

- Historical fixture and build differ from current HEAD.
- Successful issue/readback, old-driver removal and route/trailer readiness errors need a current connected test.

**Target behavior / next work:**

- Trace an authorized online dispatch issue to its persisted trip and the same driver board response.
- Keep explicit readiness errors for incomplete allocation and clear refresh feedback; do not invent missing jobs from a mismatched driver fixture.

**Required independent checks:**

- Assign/issue eligible job, driver login/reload, pre-acceptance reassignment, active/complete states, and failed readiness validation.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-133"></a>

### KP-133 — Null-safe driver container editing

**Source file:** [QA_PASSED/20261109_4-bug4-edit-cont-button-crash-trim.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/20261109_4-bug4-edit-cont-button-crash-trim.docx>)

**Source title (verbatim):** Nguồn: 20261109_4.docx — BUG 4

**SHA-256:** `bd3e842a395ec04f861a9982c40a384a170a4ff7d409294c158011d56a80d3c5`

**Claimed folder:** QA_PASSED. **Audit:** IMPLEMENTATION_PRESENT_UNVERIFIED. **Source priority:** Not stated. **Images:** 4.

**Delivery:** [KP-133](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-133>) in [WP10](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp10>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-133.txt>).

**Requirements read:**

- Clicking Sửa on SỐ CONT & SEAL must open the form instead of Cannot read properties of null (reading trim).
- Normalize saved NULL number/seal values to editable strings so draft validation cannot trim null.

**Existing behavior / assessment:** The driver container editor initializes missing number/seal values to empty strings before trim-based validation. Current live save and required-number boundaries remain unverified.

**Connected current-source evidence:**

- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:118>) — Container and seal drafts use null-safe empty-string defaults.
- [frontend/src/components/trip/DriverContainerCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/DriverContainerCard.tsx:324>) — Validation operates on the normalized draft.

**Missing, contradicted or unproven:**

- No current real NULL fixture interaction, required-number validation and save/reload evidence.

**Target behavior / next work:**

- Keep null normalization at every editor entry and verify valid first-number entry without crash.
- Preserve ordinary validation and explicit online save, with no offline queuing.

**Required independent checks:**

- NULL number/seal, seal-only attempt, valid first number, cancel/reopen, save/reload and large text/soft keyboard.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-134"></a>

### KP-134 — App-wide density acceptance beyond one grid

**Source file:** [QA_PASSED/The UI waste lots of space-data-intensive-design.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/QA_PASSED/The UI waste lots of space-data-intensive-design.docx>)

**Source title (verbatim):** The UI waste lots of space, you should utilise all available space, make it data intensive design, currently it has too much waste space

**SHA-256:** `914c0b1a726361360ac2f934ad961b900cf91f1bb188154c35a3d98431f8eed1`

**Claimed folder:** QA_PASSED. **Audit:** PARTIAL. **Source priority:** Not stated. **Images:** 4.

**Delivery:** [KP-134](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-134>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-134.txt>).

**Requirements read:**

- Reduce unnecessary whitespace and nested-card overhead in a data-intensive UI while preserving readable complete values and usable controls.
- Verify the specifically changed detailed dispatch grid across desktop, tablet and phone, including expanded rows and long labels.

**Existing behavior / assessment:** The implementation compacted the detailed dispatch grid below 900px. This is a meaningful scoped change, but the broad request about wasted space throughout the data-intensive UI was not completed by a single grid adjustment.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:780>) — Container-width responsive block begins at 900px.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:809>) — Detail rows adopt the compact tablet structure.
- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.css:910>) — Phone rules preserve whole-unit rendering.

**Missing, contradicted or unproven:**

- No current measured after-render for the named dispatch fixture at all widths.
- The document narrows the broad user request without demonstrating app-wide completion; related density tickets must be reconciled rather than duplicated.

**Target behavior / next work:**

- Close the scoped dispatch grid only after comparing current row density, long data and controls.
- Maintain a per-template density checklist for the remaining app surfaces and fold existing density tickets into those work packages.

**Required independent checks:**

- Detailed plan at 390/820/1280/1600 with expanded data, long identifiers, labels, keyboard and touch; verify no clipping or per-character codes.

**Closure-claim review:** QA_PASSED/DEV/test-count/API assertions are claims, not assumed current proof. No COMPLETION_SUPPORTED classification is granted from historical screenshots or source alone.

<a id="kp-135"></a>

### KP-135 — Self-healing version-token writes across crud-factory clients

**Source file:** [TODO/20260914_18-self-healing-version-token-writes.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_18-self-healing-version-token-writes.docx>)

**Source title (verbatim):** Self-healing version-token writes across crud-factory clients

**SHA-256:** `3b28f52d8e2296887522808197f3698b1f83bcc9b3daa49998add87296283cad`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-135](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-135>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-135.txt>).

**Requirements read:**

- Historical proposal: distinguish missing-version HTTP 428 / VERSION_TOKEN_REQUIRED from genuine conflict HTTP 409; pin both backend contracts.
- Historical proposal: on missing-token code, transport GETs the latest target, retries once and warns; prove exactly-once save and no extra send for explicit-token clients. This recovery proposal is NOT adopted because it can overwrite a newer snapshot the user never reviewed.
- Enumerate protected CONFIG PUT/PATCH/DELETE callers and prove the regression check fails when a new caller omits expectedUpdatedAt.
- Current replacement: bind each write to the actual edited snapshot; reject missing tokens and reconcile real conflicts without generic GET-latest replay.

**Existing behavior / assessment:** The proposed generic GET-latest-and-retry behavior on 428 would hide missing caller versions and could overwrite concurrent values. It is a proposal, not a completed implementation.

**Connected current-source evidence:**

- [frontend/src/lib/api/client.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/api/client.ts:109>) — Transport serializes explicit expectedUpdatedAt
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:388>) — Existing blind 409 retry illustrates the hazard.
- [frontend/src/lib/api/client.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/api/client.ts:109>) — Protected writes silently fall back to a remembered path token; background reads can update it independently of an existing draft.

**Missing, contradicted or unproven:**

- The proposed generic GET-latest-and-retry behavior on 428 would hide missing caller versions and could overwrite concurrent values. It is a proposal, not a completed implementation.

**Target behavior / next work:**

- Adopt VERSION_TOKEN_REQUIRED machine code and inventory explicit mutation callers.
- Do not implement generic fresh-version replay. Bind token to the original read snapshot and reconcile on 428/409.
- Enumerate CONFIG writes plus auth business-unit PATCH/DELETE; add missing-token boundary tests.
- Remove the remembered-path token fallback for protected mutations. Require the caller-owned original snapshot version and retain the draft on a missing-token contract error.

**Required independent checks:**

- Two editors; missing token; stale token; non-version 409; no automatic resend; no lost concurrent fields.
- Load draft A, complete background GET B, then save A: B must not silently authorize A. Exercise missing, stale and valid explicit versions and prove exactly one logical write.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-136"></a>

### KP-136 — CUS delivery date edit does not save on Enter

**Source file:** [TODO/20260914_P0_QA-144_bug-cus-delivery-date-enter-save.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P0_QA-144_bug-cus-delivery-date-enter-save.docx>)

**Source title (verbatim):** CUS delivery date edit does not save on Enter

**SHA-256:** `44895c0338a3ee0cab4db5de9f2854964f40a518b00542effc6a52e03ad740ad`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P0. **Images:** 0.

**Delivery:** [KP-136](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-136>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-136.txt>).

**Requirements read:**

- Yêu cầu: khi sửa tay giờ giao và ngày giao -> ấn enter thì không lưu và không out ra màn hình hiển thị
- Tiêu chí nghiệm thu: (1) Nhập ngày/giờ giao hàng rồi Enter → lưu và quay về màn hình chính; (2) Dữ liệu đã lưu hiển thị đúng; (3) Regression test

**Existing behavior / assessment:** Pressing Enter in the CUS appointment popover closes it; onChange only updates the row draft. The popover has no awaitable commit callback.

**Connected current-source evidence:**

- [frontend/src/features/shipments/cus/CusAppointmentPopover.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusAppointmentPopover.tsx:172>) — Enter prevents default and closes
- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:246>) — onChange changes draft only

**Missing, contradicted or unproven:**

- Pressing Enter in the CUS appointment popover closes it; onChange only updates the row draft. The popover has no awaitable commit callback.

**Target behavior / next work:**

- Separate draft, confirm and close callbacks; Enter and explicit Xác nhận call same parent commit.
- Close after confirmed save; retain draft and errors otherwise. Handle composition and native picker Enter separately.

**Required independent checks:**

- Type a date/time then Enter without blur; explicit confirm; double Enter; invalid/partial value; failed save; reload persisted appointment.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-137"></a>

### KP-137 — Dispatch note text input does not allow spaces

**Source file:** [TODO/20260914_P0_QA-145_bug-dispatch-note-no-spaces.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P0_QA-145_bug-dispatch-note-no-spaces.docx>)

**Source title (verbatim):** Dispatch note text input does not allow spaces

**SHA-256:** `49779666bf337a17f9061844d1461f8cd4d5938836e5d0dee4f9ce575a864909`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P0. **Images:** 0.

**Delivery:** [KP-137](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-137>) in [WP09](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp09>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-137.txt>).

**Requirements read:**

- Yêu cầu: phần điều vận - chỗ ghi chú note text : nhập không cách ô được
- Tiêu chí nghiệm thu: (1) Trường ghi chú điều vận cho phép nhập khoảng trắng; (2) Văn bản có khoảng trắng lưu đúng; (3) Regression test

**Existing behavior / assessment:** A probe of the current shared helper reproduces typed “gọi lái xe” becoming “gọiláixe”: the controlled note normalizes trailing whitespace on every keystroke.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx:42>) — Manual state derived from formatted value
- [frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DispatchTaskTagEditor.tsx:51>) — Every keystroke composes
- [shared/src/driverTaskNote.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/driverTaskNote.ts:24>) — trim removes trailing typed space

**Missing, contradicted or unproven:**

- A probe of the current shared helper reproduces typed “gọi lái xe” becoming “gọiláixe”: the controlled note normalizes trailing whitespace on every keystroke.

**Target behavior / next work:**

- Keep raw manual text in an independent edit buffer; compose/normalize at explicit save.
- Preserve tags and ordinary spaces/newlines through reopen.

**Required independent checks:**

- Character-by-character typing, IME, paste, multiple spaces, tag toggle/rename, and save/reload. The current pure-helper probe failed.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-138"></a>

### KP-138 — Remove unnecessary date picker from dispatch issue form

**Source file:** [TODO/20260914_P0_QA-146_enhancement-remove-dispatch-date-picker.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P0_QA-146_enhancement-remove-dispatch-date-picker.docx>)

**Source title (verbatim):** Remove unnecessary date picker from dispatch issue form

**SHA-256:** `fcbc56098d81173b6c90a27eea92f0d2406fa7f8f2929f5a99b07485b019d785`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P0. **Images:** 0.

**Delivery:** [KP-138](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-138>) in [WP07](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp07>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-138.txt>).

**Requirements read:**

- Yêu cầu: phần phát lệnh không cần chọn ngày giờ, xóa date picker thừa
- Tiêu chí nghiệm thu: (1) Form phát lệnh không hiển thị date picker; (2) Phát lệnh hoạt động bình thường không cần ngày giờ; (3) Regression test

**Existing behavior / assessment:** Dispatch issue form still renders quick dates, time/date inputs and presets the requirement asks to remove.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/IssueOrderFields.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/IssueOrderFields.tsx:212>) — Schedule control block
- [frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/useIssueOrder.ts:31>) — Issue draft schedule derivation

**Missing, contradicted or unproven:**

- Dispatch issue form still renders quick dates, time/date inputs and presets the requirement asks to remove.

**Target behavior / next work:**

- Remove editable issue schedule controls while displaying concise inherited schedule.
- Resolve required timestamps from canonical planning data, retaining minutes and rollover; route missing schedule to its owning editor.
- Do not remove CUS appointment editing.

**Required independent checks:**

- OWN and external issue; 08:00/20:45/23:30; missing date; midnight rollover; identical persisted schedule before and after control removal.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-139"></a>

### KP-139 — Duplicate truck error when assigning 2x20ft containers to same truck

**Source file:** [TODO/20260914_P0_QA-147_bug-duplicate-truck-2x20ft-dispatch.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P0_QA-147_bug-duplicate-truck-2x20ft-dispatch.docx>)

**Source title (verbatim):** Duplicate truck error when assigning 2x20ft containers to same truck

**SHA-256:** `6eed86afd3610d3acd5e9dc454fc3b0eb9bcd166900ff6bdd7f22849ad612abd`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P0. **Images:** 0.

**Delivery:** [KP-139](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-139>) in [WP08](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp08>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-139.txt>).

**Requirements read:**

- Yêu cầu: 1 xe kế hoạch đi 2 cont 20 : phát lệnh 1 cont 20 rồi cont 20 còn lại báo là đã trùng đầu kéo, nếu đã chọn cả 2 cont đều là kẹp vẫn lỗi
- Tiêu chí nghiệm thu: (1) Phát lệnh 2 cont 20ft cho cùng 1 xe không báo trùng; (2) Cả 2 cont đều gán đúng đầu kéo; (3) Regression test cho multi-container dispatch

**Existing behavior / assessment:** The independent assignment path rejects another overlapping trip on the same truck. A canonical tripPairs/KEP service already exists, but the current pairing capacity check evaluates each cargo separately rather than their combined simultaneous load. The requested second 20FT assignment is not safely integrated with that authority.

**Connected current-source evidence:**

- [backend/src/services/dispatch-planning-commands.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-commands.service.ts:228>) — Availability arguments identify an individual trip but contain no validated pair/group identity.
- [backend/src/services/dispatch-planning-commands.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/dispatch-planning-commands.service.ts:264>) — Truck overlap rejected
- [backend/src/services/trip-pairing.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-pairing.service.ts:150>) — KEP allows overlapping windows but compares each cargo weight separately with capacity; combined simultaneous cargo must be validated.

**Missing, contradicted or unproven:**

- The independent assignment path rejects another overlapping trip on the same truck. A canonical tripPairs/KEP service already exists, but the current pairing capacity check evaluates each cargo separately rather than their combined simultaneous load. The requested second 20FT assignment is not safely integrated with that authority.
- The historical staging conflict has not been reproduced with a current eligible paired fixture in this audit.

**Target behavior / next work:**

- Extend the canonical tripPairs/KEP authority and existing resource locking; do not introduce a competing pair/reservation store. Establish both fulfillment members atomically before the second independent assignment hits an unrelated-conflict check.
- Validate two eligible 20FT containers, combined concurrent cargo weight, truck/trailer/driver identity, versions and schedule compatibility. A capable 40FT trailer may carry two 20FT containers; a 40FT cargo container is not a member of this two-20FT case.
- Preserve unrelated conflict checks and separate cargo/evidence history. Reassignment, unpairing and cancellation recalculate surviving resource occupancy.

**Required independent checks:**

- Two eligible 20FT containers on one capable 40FT trailer succeed; combined overload, 40FT cargo member, third member, mismatched resources and unrelated booking fail.
- Race two pair/assignment requests; cancel or reassign one member; verify the survivor remains protected and both driver/dispatch views agree.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-140"></a>

### KP-140 — Lift/drop ports on dispatcher Detailed Vehicle Plan

**Source file:** [TODO/20260914_P1_5-regression-lift-drop-info-missing-dispatch-detail.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P1_5-regression-lift-drop-info-missing-dispatch-detail.docx>)

**Source title (verbatim):** Role điều vận màn hình chi tiết

**SHA-256:** `42806dd980a10200a10f3dbd46f0accd92fbeb95c159c8875e3a2f3a690d1a30`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P1. **Images:** 1.

**Delivery:** [KP-140](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-140>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-140.txt>).

**Requirements read:**

- Tiêu chí nghiệm thu: (1) Thông tin địa điểm nâng/hạ hiển thị lại trên màn chi tiết điều vận đúng dữ liệu từng chuyến; (2) commit gây regression xác định + regression test khóa hiển thị; (3) layout các viewport giữ tính compact của đợt density.

**Existing behavior / assessment:** Embedded screenshot is the dispatcher DetailedPlanGrid and lacks lift/drop fields. Appended speculation that it is another driver-like screen is contradicted by the screenshot.

**Connected current-source evidence:**

- [frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx:210>) — Current rendered table columns
- [frontend/src/api/dispatchPlanningClient.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/api/dispatchPlanningClient.ts:1>) — Transport read-model entry point

**Missing, contradicted or unproven:**

- Embedded screenshot is the dispatcher DetailedPlanGrid and lacks lift/drop fields. Appended speculation that it is another driver-like screen is contradicted by the screenshot.

**Target behavior / next work:**

- Restore compact lift/drop facts in Kế hoạch chi tiết using direction-aware source fields.
- Trace pickup/drop/empty-return separately; add regression fixture rather than waiting for an already identifiable URL.

**Required independent checks:**

- IMPORT/EXPORT/FCL/LCL, configured and missing sites; same facts in desktop rows and narrow summaries; no duplicated or swapped destinations.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-141"></a>

### KP-141 — Reconcile concurrent trip edits before retrying a version conflict

**Source file:** [TODO/20260914_P1_QA-134_bug-reconcile-concurrent-trip-edits-before-retrying-a-version-conflict.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P1_QA-134_bug-reconcile-concurrent-trip-edits-before-retrying-a-version-conflict.docx>)

**Source title (verbatim):** Reconcile concurrent trip edits before retrying a version conflict

**SHA-256:** `17b819d078a0035f97ff88c225fdcf35c0cd5aa3136a8d048ddfcf81b6e04cc8`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P1. **Images:** 0.

**Delivery:** [KP-141](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-141>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-141.txt>).

**Requirements read:**

- 1. An edit 409 never triggers an unchanged full-payload retry with only the new version. Non-version business conflicts are explained without blind retry.
- 2. Keep A's local draft visible and B's committed values intact. Any merge compares original, local and latest values; conflicting fields require an explicit choice by the current editor.
- 3. A reconciled save uses the version actually reviewed and still rejects another concurrent update. This is edit conflict handling, not an internal approval workflow.
- 4. Add a hook regression capturing both requests and prove B's changed revenue survives A's notes edit. Then verify two-session UI and persisted readback for CREATED and another ordinarily editable state; no approval gate is introduced.

**Existing behavior / assessment:** After an edit returns 409, the client fetches the current trip and retries the original full payload with fresh.version; concurrent writer values can be lost.

**Connected current-source evidence:**

- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:335>) — Original full edit payload
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:388>) — Fresh-version-only retry
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:335>) — Figures commit before container/instruction saves; later failure can leave a partially applied edit.

**Missing, contradicted or unproven:**

- After an edit returns 409, the client fetches the current trip and retries the original full payload with fresh.version; concurrent writer values can be lost.

**Target behavior / next work:**

- Remove blind retry. Retain original/local/latest snapshots and compare fields.
- Merge only proven non-overlapping edits; show explicit choices for conflicting fields then submit reviewed latest version.
- Define merge semantics for null, blank and explicit zero and reconcile child rows by stable IDs. Use an atomic domain command where practical; otherwise retain confirmed stage results and retry only uncommitted operations after readback.

**Required independent checks:**

- Two sessions editing notes versus revenue; same-field conflict; a second race during review; non-version 409; CREATED and editable completed trips.
- Partial figure success followed by child-save failure; null/blank/zero clears; child reorder/delete; manual retry must not duplicate a committed child operation.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-142"></a>

### KP-142 — Remove offline business command queues and retire saved commands

**Source file:** [TODO/20260914_P1_QA-139_enhancement-remove-offline-business-command-queues-and-retire-saved-commands.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P1_QA-139_enhancement-remove-offline-business-command-queues-and-retire-saved-commands.docx>)

**Source title (verbatim):** Remove offline business command queues and retire saved commands

**SHA-256:** `2a6c905edfbd7292eeae59d45fd99ca02f6f5bb45a3a553c96e84d2702c0f90d`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P1. **Images:** 0.

**Delivery:** [KP-142](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-142>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-142.txt>).

**Requirements read:**

- 1. Acceptance/progress, e-POD submission/completion, paper handoff and both order-exchange actions submit explicitly online. Offline or failed requests never enter a persistent or in-memory replay queue.
- 2. Reconnect, reload, route changes and account switches never automatically submit business commands. A lost response remains an uncertain outcome: refresh server state before an explicit retry, using the same operation idempotency key where appropriate.
- 3. Retire silversea.driver-offline-command-queue.v1 and its role/account-scoped keys, plus the offline-queue object store in IndexedDB database silversea, before any drain. Remove queue memory singletons/listeners; preserve unrelated storage. Storage-access failures must not re-enable replay.
- 4. Notify affected users that unsent queued actions were not applied and require manual re-entry. Do not describe an in-flight request with an unknown server outcome as definitely unapplied, and do not expose another account’s action details.
- 5. Remove queue-only state, replay controls, sender code and unused legacy consumer. Move the idempotency helper out of the queue module for online callers. Preserve server permissions, validation, version checks and duplicate protection; introduce no approval gate.
- 6. Add migration and online-submit regressions across every listed action, including response loss, rapid clicks, blocked storage, populated old queues and account switching. Replace tests that require offline retention/replay.

**Existing behavior / assessment:** Role-specific localStorage queue and IndexedDB queue still have active drain callers on driver, POD, OPS detail and inbox.

**Connected current-source evidence:**

- [frontend/src/features/driver/useOfflineCommandQueue.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/driver/useOfflineCommandQueue.ts:43>) — Durable queue key
- [frontend/src/pages/DriverTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverTripDetailPage.tsx:98>) — Active drain
- [frontend/src/pages/ForwarderTripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderTripDetailPage.tsx:89>) — OPS drain
- [frontend/src/components/work-inbox/RoleWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/work-inbox/RoleWorkInbox.tsx:229>) — Inbox drain
- [frontend/src/lib/offline-queue.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/offline-queue.ts:87>) — IndexedDB store

**Missing, contradicted or unproven:**

- Role-specific localStorage queue and IndexedDB queue still have active drain callers on driver, POD, OPS detail and inbox.

**Target behavior / next work:**

- Remove enqueue/drain imports and UI promises; direct online commands only.
- Run owned-storage retirement before any legacy queue reader, including scoped and unscoped keys and earlier tabs.
- Retain explicit idempotent online retry and reconcile unknown outcomes.

**Required independent checks:**

- Offline before click and midflight; reconnect/reload/account switch emits zero automatic mutations; old profile with pending/conflicted entries; no duplicate commit.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-143"></a>

### KP-143 — Require a live connection before allowing application work

**Source file:** [TODO/20260914_P1_QA-140_enhancement-require-a-live-connection-before-allowing-application-work.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P1_QA-140_enhancement-require-a-live-connection-before-allowing-application-work.docx>)

**Source title (verbatim):** Require a live connection before allowing application work

**SHA-256:** `6af8f8ce80cac46c10f44d463f87b7aa4911a8c80a07256b6a14f0772c2f3181`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P1. **Images:** 0.

**Delivery:** [KP-143](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-143>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-143.txt>).

**Requirements read:**

- 1. At phone 390 px, tablet 768 px and desktop 1440 px, show a concise Vietnamese connection message and Retry without nested cards or oversized padding. Prevent pointer, keyboard and modal bypasses of the business-action gate.
- 2. Audit direct API calls and mutation hooks. No business mutation is queued, paused for later automatic execution, or replayed on reconnect. Configure library behavior explicitly and test it; retain manual online retry and idempotency.
- 3. Treat navigator.onLine as a hint. Distinguish no connection from temporary service failure; use bounded reachability checks and show stable recovery feedback.
- 4. Do not report an uncertain save as definitely failed or definitely saved. After reconnect, read back the result before an explicit retry with the original idempotency identity.
- 5. Cover all role shells, startup/deep links, rapid connection changes, account switching, an open modal and pending saves. Keep auth recovery in QA-124 and local logout in QA-135 functional.

**Existing behavior / assessment:** OfflineBanner remains an informational autosync message and useOnline observes browser connectivity only.

**Connected current-source evidence:**

- [frontend/src/components/shared/OfflineBanner.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/shared/OfflineBanner.tsx:16>) — Banner renders from onLine without operation gate
- [frontend/src/hooks/useOnline.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useOnline.ts:12>) — Browser online hint

**Missing, contradicted or unproven:**

- OfflineBanner remains an informational autosync message and useOnline observes browser connectivity only.

**Target behavior / next work:**

- Add shared internet/service-required state across office, Driver, OPS, CUS, Customer portal and login.
- Gate new business commands; preserve an inert in-memory draft and local logout; use a bounded service-recovery check.
- GET refresh may resume; writes require explicit user retry.

**Required independent checks:**

- All eight roles; offline startup/click/mid-flight; browser online but service returns 503; recovery; keyboard focus; compact layouts.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-144"></a>

### KP-144 — Enable adding receipts to saved pending OPS expenses

**Source file:** [TODO/20260914_P2_QA-053_bug-enable-adding-receipts-to-saved-pending-ops-expenses.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-053_bug-enable-adding-receipts-to-saved-pending-ops-expenses.docx>)

**Source title (verbatim):** Enable adding receipts to saved pending OPS expenses

**SHA-256:** `8387d1971a96090ec625dba4682549c26a63488cf6cc409e4bb322e8e1f04a47`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-144](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-144>) in [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-144.txt>).

**Requirements read:**

- 1. Attach and manage receipts on a saved pending expense using compact controls on phone, tablet and desktop.
- 2. Persist attachments to the same expense and display them after reopening and reload; preserve its amount and shipment association.
- 3. Update Nợ chứng từ only after confirmed persistence satisfies the receipt rule. Upload failure must retain accurate status and provide retry.

**Existing behavior / assessment:** Saved OPS expense editor has amount/date/note but no upload; photo modal lists/deletes receipts only.

**Connected current-source evidence:**

- [frontend/src/features/ops/OpsExpenseEditModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsExpenseEditModal.tsx:79>) — Saved editor fields
- [frontend/src/features/ops/OpsExpensePhotosModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsExpensePhotosModal.tsx:17>) — Viewer-only receipt surface

**Missing, contradicted or unproven:**

- Saved OPS expense editor has amount/date/note but no upload; photo modal lists/deletes receipts only.

**Target behavior / next work:**

- Expose add/capture receipt on same saved expense and receipt-debt entry point.
- Bind upload to existing expense, preserve amount/scope and update missing-receipt state only after confirmed readback.
- Coordinate permissions with direct-record expense lifecycle.

**Required independent checks:**

- Saved expense no receipt → attach → reload; upload error/retry; duplicate file; revoked scope; locked accounting item read-only.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-145"></a>

### KP-145 — Resolve invalid version errors when publishing revenue adjustments

**Source file:** [TODO/20260914_P2_QA-064_bug-resolve-invalid-version-errors-when-publishing-revenue-adjustments.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-064_bug-resolve-invalid-version-errors-when-publishing-revenue-adjustments.docx>)

**Source title (verbatim):** Resolve invalid version errors when publishing revenue adjustments

**SHA-256:** `8c9cb0ac492bfe73b261d5e5683240bc48b8063e941665970bf1941ff6945f4b`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-145](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-145>) in [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-145.txt>).

**Requirements read:**

- 1. Eligible adjustments use a finite current version and publish once; verify saved adjustment and financial readback after reload.
- 2. Missing prerequisites or version data block invalid submission, preserve inputs and provide Vietnamese recovery guidance. Keep empty required-field validation.
- 3. On stale versions, refresh state and require review before retry; preserve conflict protection and prevent duplicates. Test valid, missing-version, stale-version and ineligible cases on desktop, tablet and phone.

**Existing behavior / assessment:** The document claims improved backend adjustment creation/application. The current frontend still casts response rows as having amount and calls Number(a.amount), despite the debit/credit response shape.

**Connected current-source evidence:**

- [frontend/src/pages/TripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripDetailPage.tsx:401>) — Reading the absent amount field produces NaN when the response contains debit/credit fields.

**Missing, contradicted or unproven:**

- The document claims improved backend adjustment creation/application. The current frontend still casts response rows as having amount and calls Number(a.amount), despite the debit/credit response shape.

**Target behavior / next work:**

- Define shared adjustment result DTO and explicit financial sign semantics.
- Render correct amount/direction; return authoritative updated trip/version and linked adjustment.
- Keep single transaction posting and conflict handling; never fabricate zero for absent amount.

**Required independent checks:**

- Positive/negative/zero adjustment; ledger linkage; repeated submit; version conflict; signed UI and reload. Trip 19 currently shows no adjustment rows, so no fresh browser NaN reproduction is claimed.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-146"></a>

### KP-146 — Keep selected payroll details close to the driver picker

**Source file:** [TODO/20260914_P2_QA-094_enhancement-keep-selected-payroll-details-close-to-the-driver-picker.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-094_enhancement-keep-selected-payroll-details-close-to-the-driver-picker.docx>)

**Source title (verbatim):** Keep selected payroll details close to the driver picker

**SHA-256:** `af3864b0c2c3b43d472d8fb50f7d50768667e006dd111c12d3fae7230492013e`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-146](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-146>) in [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-146.txt>).

**Requirements read:**

- 1. Selecting a driver exposes their calendar/detail or its loading/error state without manually traversing the whole roster. Keep the selected identity visible.
- 2. Provide compact search and a clear way to reopen or browse the full roster; preserve every driver and existing selection semantics.
- 3. Use responsive columns or a bounded selector instead of 39 permanent cards above the work area; avoid extra nested surfaces or oversized controls.
- 4. Verify all three widths, long names, keyboard selection and 39 or more drivers. Preserve period/payment actions; metric overlap is QA-093 and calendar behavior remains separate.

**Existing behavior / assessment:** Driver roster is rendered before selected attendance content as one unbounded mapped list.

**Connected current-source evidence:**

- [frontend/src/pages/SalaryAttendancePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/SalaryAttendancePage.tsx:106>) — All filtered driver cards
- [frontend/src/pages/SalaryAttendancePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/SalaryAttendancePage.tsx:146>) — Selected calendar follows roster

**Missing, contradicted or unproven:**

- Driver roster is rendered before selected attendance content as one unbounded mapped list.

**Target behavior / next work:**

- Use a bounded searchable roster beside the selected driver/calendar. On phone, a disclosure should return to the current driver.

**Required independent checks:**

- 39 drivers; first/middle/last selection; search; back; keyboard; calendar and salary visible without scrolling past the entire roster.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-147"></a>

### KP-147 — Remove approval steps from financial configuration

**Source file:** [TODO/20260914_P2_QA-110_enhancement-remove-approval-steps-from-financial-configuration.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-110_enhancement-remove-approval-steps-from-financial-configuration.docx>)

**Source title (verbatim):** Remove approval steps from financial configuration

**SHA-256:** `10b6762ff6f681dd8e691a06f69f29fe4b49457e5e5f64b503559580a0a17e9b`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-147](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-147>) in [WP14](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp14>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-147.txt>).

**Requirements read:**

- 1. A valid authorized save completes directly, persists after reload and takes effect on the stated date without a second user or an approval queue.
- 2. Keep input validation, permitted date ranges, closed-period rules, role access and clear conflict recovery. Removing approval must not bypass ordinary data checks.
- 3. Retain meaningful version and change history with actor and time. Resolve pre-existing pending requests during migration without duplicate versions or silent data loss.
- 4. Remove approval-only wording, statuses and request actions in both tabs. Show clear success, validation and save-error feedback at 390, 834 and 1440 px with usable keyboard and touch controls.

**Existing behavior / assessment:** Incomplete removal: request-oriented UI and response contracts remain, although the connected configuration helper applies the change in the request.

**Connected current-source evidence:**

- [frontend/src/pages/config/AppSettingsConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/AppSettingsConfigPage.tsx:179>) — Reporting-policy and vehicle-profile save handlers call request mutations; status-based approval messages remain at42–46 and pending UI at335.
- [frontend/src/features/app-settings/FinancePolicySection.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/app-settings/FinancePolicySection.tsx:127>) — Both financial tabs retain approved-version wording (vehicle counterpart292).
- [backend/src/routes/app-settings.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/app-settings.ts:214>) — POST financial-reporting/policy/requests and truck-profiles/requests are Admin-only idempotent request endpoints.
- [backend/src/services/financial-reporting-policy.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/financial-reporting-policy.service.ts:341>) — Policy and truck-profile version requests enforce open month, current public version and duplicate effective-month checks.
- [backend/src/services/price-config-governance.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/price-config-governance.service.ts:396>) — Helper applies immediately, populating APPROVED/approverId/appliedAt from the same actor.

**Missing, contradicted or unproven:**

- Incomplete removal: request-oriented UI and response contracts remain, although the connected configuration helper applies the change in the request.
- Do not claim a second-person wait in the current configuration backend. The remaining work includes truthful UI/API contracts and removal of fabricated approval semantics.
- Keep future effective dates, version identity, closed-period protections and ordinary role authority.
- The general level-1 cap is a credit-exception policy; coordinate that part with KP-163, not this two-tab package.

**Target behavior / next work:**

- Expose authorized direct version creation and a saved/effective result contract; replace request queues and approved-history vocabulary.
- Preserve actor/time/change history as audit, migrate legacy pending records deliberately and remove dead pending branches.

**Required independent checks:**

- First/subsequent/future save, duplicate effective month, stale version, role denial, reload and all three responsive widths.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-148"></a>

### KP-148 — Remove approval handoffs from advances and settlements

**Source file:** [TODO/20260914_P2_QA-113_requirement-remove-approval-handoffs-from-advances-and-settlements.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-113_requirement-remove-approval-handoffs-from-advances-and-settlements.docx>)

**Source title (verbatim):** Remove approval handoffs from advances and settlements

**SHA-256:** `ff374547c013b0e36ca143b988cc0d03c78118761cd85a99ae7121c520c16f67`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-148](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-148>) in [WP15](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp15>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-148.txt>).

**Requirements read:**

- 1. Authorized creation, correction, settlement and reversal save directly, with clear success/error feedback and no reviewer or approver.
- 2. Remove approval buckets, proposal reasons and reviewer handoffs. Keep useful business notes and ordinary role access.
- 3. Eligibility uses recorded advances/expenses, remaining balances and completeness. Preserve arithmetic, required fields and duplicate-posting protection.
- 4. Migrate pending requests through a logged transition so none remain stranded. Retain historical audit evidence without active approval requirements.
- 5. Saving a record must not falsely report an unperformed cash transfer. Verify refresh, failures and the complete direct lifecycle.
- 6. Use compact controls on phone, tablet and desktop. Coordinate Ops expense removal with QA-114.

**Existing behavior / assessment:** Partial direct execution exists, but advance/settlement status models and visible approval handoffs remain.

**Connected current-source evidence:**

- [frontend/src/pages/ForwarderAdvancesPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ForwarderAdvancesPage.tsx:252>) — Shared approval statuses drive filters, badges and approver metadata.
- [frontend/src/pages/AdminAdvancesPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/AdminAdvancesPage.tsx:427>) — Admin workspace still says proposals enter the approval center.
- [backend/src/routes/forwarder/advances.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/forwarder/advances.ts:64>) — Creation chains createAdvanceRequest then approveAdvanceRequest in one transaction.
- [backend/src/routes/forwarder/advances.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/forwarder/advances.ts:161>) — Settlement creation chains create+approve in one transaction, including linked expense approvals.
- [backend/src/routes/financial/advances.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/advances.routes.ts:57>) — Advance approve/reject routes remain; settlement decision routes were removed and reversal applies directly at157.
- [backend/src/services/advance-settlement.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/advance-settlement.service.ts:344>) — Settlement eligibility remains tied to APPROVED advances.

**Missing, contradicted or unproven:**

- Partial direct execution exists, but advance/settlement status models and visible approval handoffs remain.
- Distinguish advance requests, settlements and the separate Ops cash-entry model; their current transitions are not identical.
- Directly setting APPROVED and self-approver is specifically insufficient under the user request.
- An accounting record must not imply a real cash transfer; preserve actual outstanding/returned/settled amounts and reference protections.

**Target behavior / next work:**

- Define direct recorded/outstanding/settled/reversed states and use ordinary posting commands, replacing create-then-approve adapters.
- Update eligibility, wallet aggregation, history and entry forms together; migrate pending/link records without duplicate money.

**Required independent checks:**

- Direct create/correct/settle/reverse lifecycle; partial refund, repeat submit, insufficient funds, used references and fresh readback across Ops and accounting.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-149"></a>

### KP-149 — Remove approval routing from Ops field expenses

**Source file:** [TODO/20260914_P2_QA-114_enhancement-remove-approval-routing-from-ops-field-expenses.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-114_enhancement-remove-approval-routing-from-ops-field-expenses.docx>)

**Source title (verbatim):** Remove approval routing from Ops field expenses

**SHA-256:** `e8b629daa85f974b917535225fedaa4df211e244008cc7cdc584cf3ac5fc7db9`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-149](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-149>) in [WP16](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp16>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-149.txt>).

**Requirements read:**

- 1. An authorized valid expense save or edit persists directly and updates related views without a reviewer, approver or pending-approval queue.
- 2. Remove category approval-routing fields and the level1 approval cap. Keep ordinary amount, category, receipt and role validation; remove only thresholds used for approval escalation.
- 3. Keep evidence upload, expense correction, ownership and genuine payment or settlement state available. Reconcile wallet totals without approval-based reservations or duplicate postings.
- 4. Migrate existing pending items deliberately, preserving attachments, history and balances. Do not implement removal by silently marking all items approved.
- 5. At 390, 834 and 1440 px, show compact recorded-state lists and clear save/error feedback with keyboard and touch access.

**Existing behavior / assessment:** Real Ops expense approval endpoints and state restrictions remain; the document also misattributes the shared level-1 credit cap to Ops.

**Connected current-source evidence:**

- [frontend/src/features/ops/OpsAccountantTab.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/ops/OpsAccountantTab.tsx:19>) — Accountant field-expense filter uses pending/approved/rejected lifecycle.
- [backend/src/routes/ops.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/ops.ts:365>) — Admin expense approve and reject endpoints call decideOpsExpense with approval decisions.
- [backend/src/services/ops-expenses.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/ops-expenses.service.ts:389>) — Decision service checks receipts and updates PENDING to APPROVED/REJECTED; approved records restrict author edits.
- [frontend/src/pages/config/ForwarderExpenseTypesConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/ForwarderExpenseTypesConfigPage.tsx:208>) — Category form exposes Finance per-item and Director daily no-invoice approval limits.
- [frontend/src/features/app-settings/OperationalPolicySection.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/app-settings/OperationalPolicySection.tsx:98>) — Displayed level-1 amount cap is bound to creditTierOneCap.
- [backend/src/services/credit-limit.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/credit-limit.service.ts:428>) — That app-setting value controls credit override tier selection, not the Ops category route.

**Missing, contradicted or unproven:**

- Real Ops expense approval endpoints and state restrictions remain; the document also misattributes the shared level-1 credit cap to Ops.
- Move/co-own the app-settings credit cap part with KP-163. Do not delete a credit authority rule as if it were merely an Ops filter.
- Receipt requirements, allowed alternative evidence, genuine paidAt and settlement locks are ordinary data controls; retain them independently of reviewers.
- Two expense models exist (opsExpenseEntries and tripExpenses); reconcile both callers without conflating their identifiers and balances.

**Target behavior / next work:**

- Replace the field expense decision lifecycle with direct authorized recorded entries and precise correction/settlement states.
- Remove only category thresholds used to route internal approval; preserve amount/category/evidence validation and scope.
- Update wallet totals and list counts with a logged pending-record migration, not a mass fake approval.

**Required independent checks:**

- Own and unauthorized expense create/edit; receipts/alternative evidence, no-invoice category, settlement-linked edit, duplicate save and wallet reconciliation.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-150"></a>

### KP-150 — Record operating expenses without internal approval

**Source file:** [TODO/20260914_P2_QA-115_enhancement-record-operating-expenses-without-internal-approval.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-115_enhancement-record-operating-expenses-without-internal-approval.docx>)

**Source title (verbatim):** Record operating expenses without internal approval

**SHA-256:** `68e84c6905d76ac09e758ceef62b9316d690ab1344d486c3ebe055eaf98027fd`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 3.

**Delivery:** [KP-150](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-150>) in [WP17](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp17>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-150.txt>).

**Requirements read:**

- 1. A valid authorized create or edit saves directly and remains correct after reload, without another user or an internal approval queue.
- 2. Allow invoice evidence during creation and editing. Keep ordinary required fields, receipt rules, file checks and role access; an approval reason must not be required.
- 3. Update expense totals and applicable supplier debt exactly once. Keep recorded, unpaid and paid states consistent; saving must not imply a bank transfer or settlement that did not occur.
- 4. Remove checker/approver actions and pending-approval UI. Migrate existing pending records while retaining evidence and history without duplicate expense or debt entries.
- 5. Verify clear save, validation and error states at 390, 834 and 1440 px, including keyboard and touch use.

**Existing behavior / assessment:** Not removed: operating-expense creation currently persists a pending record and real distinct checker/approver endpoints control supplier-debt posting.

**Connected current-source evidence:**

- [frontend/src/pages/ExpenseEntryPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseEntryPage.tsx:356>) — Form requires a review reason and shows two-person promise at689.
- [backend/src/routes/expense.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/expense.ts:221>) — POST /expenses calls submitExpense rather than directly posting the ledger.
- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:209>) — submitExpense validates input and writes approvalStatus PENDING without posting debt.
- [backend/src/services/expense.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/expense.service.ts:249>) — reviewExpense implements CHECK and APPROVE with separate actor restrictions.
- [backend/src/routes/expense.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/expense.ts:246>) — Check/approve/reject endpoints are reachable and role-gated.
- [frontend/src/pages/expense-entry-sections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/expense-entry-sections.tsx:77>) — Actual invoice attachment component is part of the entry flow and must be available during direct creation.

**Missing, contradicted or unproven:**

- Not removed: operating-expense creation currently persists a pending record and real distinct checker/approver endpoints control supplier-debt posting.
- This is a real current workflow gate, not only misleading copy.
- Preserve the existing guard against marking an unpaid expense PAID without a supplier payment; removing approval must not regress the debt/payment fixes.
- Receipt upload must support a draft/staged attachment lifecycle or atomic attachment association without an approval prerequisite.

**Target behavior / next work:**

- Create/update authorized valid expense and its applicable supplier-debt entry atomically once; return the resulting expense and posting state.
- Remove reviewer queues, endpoints and mandatory approval reasons, replacing them with useful business notes where needed.
- Migrate pending/check states and associated evidence without duplicate expense or ledger entries.

**Required independent checks:**

- Direct new expense and correction, pre-save images, invalid category/amount, repeated save, paid/unpaid consistency and supplier ledger reload.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-151"></a>

### KP-151 — Remove internal ePOD approval gates from accounting and billing

**Source file:** [TODO/20260914_P2_QA-116_enhancement-remove-internal-epod-approval-gates-from-accounting-and-billing.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-116_enhancement-remove-internal-epod-approval-gates-from-accounting-and-billing.docx>)

**Source title (verbatim):** Remove internal ePOD approval gates from accounting and billing

**SHA-256:** `01db19eed831c0bbfd8be4d68c2b2ab29ff21fdd85d219d9289c17b0e06815be`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 2.

**Delivery:** [KP-151](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-151>) in [WP18](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp18>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-151.txt>).

**Requirements read:**

- 1. Remove internal e-POD approval requirements and related approval actions/status queues from accounting readiness and debit-note eligibility, including service-side checks.
- 2. A complete, valid saved e-POD is usable without an approver action or a fabricated approval record. Migrate pending records without losing evidence or history.
- 3. Continue to explain actual missing evidence or invalid data. Do not automatically include every captured trip if another independent valid condition is unmet.
- 4. Keep external customer acknowledgement separate. Verify direct evidence save, readiness refresh and billing generation at phone, tablet and desktop widths with accurate compact status text.

**Existing behavior / assessment:** Not removed: accounting readiness and billing eligibility still require internal accepted e-POD status.

**Connected current-source evidence:**

- [backend/src/services/accounting-transport-register.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/accounting-transport-register.service.ts:71>) — Accepted submission projection explicitly filters tripPodSubmissions.status = ACCEPTED.
- [backend/src/services/accounting-transport-register.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/accounting-transport-register.service.ts:186>) — No accepted submission becomes MISSING_ACCEPTED_POD.
- [backend/src/services/billing-document-shared.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/billing-document-shared.service.ts:154>) — Billing eligibility rejects absent/draft/submitted/rejected POD with approval-specific messages.
- [backend/src/routes/shipments/pod.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/shipments/pod.routes.ts:65>) — The review route invokes reviewTripPodSubmission.
- [frontend/src/features/accounting/AccountingWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/accounting/AccountingWorkInbox.tsx:33>) — Work queue still presents internal POD approval as a financial prerequisite.

**Missing, contradicted or unproven:**

- Not removed: accounting readiness and billing eligibility still require internal accepted e-POD status.
- A saved photo is not automatically a complete valid POD: keep trip linkage, required evidence, version and completeness checks.
- Keep external customer acknowledgement and disputes separate; they are not internal approval to delete.
- Preserve immutable prior versions and corrections without inventing accepted/reviewer events.

**Target behavior / next work:**

- Define one saved-valid-evidence readiness predicate and use it consistently in accounting register, inbox and billing candidates.
- Remove review actions/status dependence; migrate submitted/accepted/rejected legacy evidence with a transparent completeness outcome and retained audit.

**Required independent checks:**

- Complete versus missing/invalid evidence, corrected version, wrong customer/trip, reload/invalidation and debit-note generation without a reviewer.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-152"></a>

### KP-152 — Remove internal fuel invoice approval and approved expense prerequisites

**Source file:** [TODO/20260914_P2_QA-117_enhancement-remove-internal-fuel-invoice-approval-and-approved-expense-prerequisites.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-117_enhancement-remove-internal-fuel-invoice-approval-and-approved-expense-prerequisites.docx>)

**Source title (verbatim):** Remove internal fuel invoice approval and approved expense prerequisites

**SHA-256:** `90f77adce45f84a77499311c2e864263e548e5212fc1fbce83650ab473da818f`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-152](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-152>) in [WP19](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp19>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-152.txt>).

**Requirements read:**

- 1. Remove invoice approval/rejection queues, reviewer actions and approved-expense eligibility checks from UI and services. Give authorized users a direct save action.
- 2. Retain exact allocated-litres reconciliation, required references, valid unit prices and duplicate prevention as save validation. Never replace actual allocations with an automatic equal split.
- 3. Link valid recorded expenses regardless of approval status. Migrate pending/draft records without losing invoice, evidence or allocation history or inventing approval events.
- 4. Keep OCR suggestions editable and corrected evidence directly saveable without another approver.
- 5. Check create, edit, validation and reload on phone, tablet and desktop. Show the actual recorded/posting state after save with no hidden approval wait.

**Existing behavior / assessment:** Not removed: invoice creation, approved-expense eligibility and a separate approval/posting command remain; some corrections already auto-apply.

**Connected current-source evidence:**

- [frontend/src/pages/payables-fuel-invoices.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/payables-fuel-invoices.tsx:589>) — Allocation picker explicitly requires approved fuel expense; create action at1062 is draft-only.
- [backend/src/services/fuel-invoice.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/fuel-invoice.service.ts:252>) — Linked expense must have approvalStatus APPROVED.
- [backend/src/services/fuel-invoice.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/fuel-invoice.service.ts:620>) — approveFuelInvoice validates allocated litres and builds the posting change.
- [backend/src/routes/financial/fuel-invoices.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/fuel-invoices.routes.ts:226>) — Separate approve endpoint applies through transient governance.
- [backend/src/services/fuel-invoice.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/fuel-invoice.service.ts:733>) — Exact allocated-litres reconciliation is a real validation to retain.

**Missing, contradicted or unproven:**

- Not removed: invoice creation, approved-expense eligibility and a separate approval/posting command remain; some corrections already auto-apply.
- Draft can remain an explicit editable incomplete business state if needed, but must not be the sole save path into a hidden approval wait.
- Do not remove invoice reconciliation, price/reference validity, duplicate prevention or replace allocations with an equal split.
- OCR correction is ordinary data entry, not automatically an approval action.

**Target behavior / next work:**

- Provide direct authorized valid invoice save/posting, linking eligible recorded expenses without approval state.
- Fold reconciliation into the direct command, retain optional incomplete drafts with honest state, and remove approval/rejection queues and prerequisites.
- Migrate existing invoice/evidence/allocation states with exact posting identity and history.

**Required independent checks:**

- Exact/under/over allocation, invalid price or duplicate invoice, valid recorded expense, correction/reversal and all-width reload.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-153"></a>

### KP-153 — Replace profit allocation approval with direct authorized finalization

**Source file:** [TODO/20260914_P2_QA-118_requirement-replace-profit-allocation-approval-with-direct-authorized-finalization.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-118_requirement-replace-profit-allocation-approval-with-direct-authorized-finalization.docx>)

**Source title (verbatim):** Replace profit allocation approval with direct authorized finalization

**SHA-256:** `f44e676354d226ba6548d356160d0a81bc581f328899492e610fa94811a9d362`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-153](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-153>) in [WP20](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp20>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-153.txt>).

**Requirements read:**

- 1. Provide direct authorized finalization with preview, saving feedback and a persisted result; no reviewer or approver.
- 2. Remove approval-only queues, reasons and waiting/rejected states. Give existing pending records a logged migration path.
- 3. Retain ownership percentages, period consistency, arithmetic and duplicate-finalization protection. Missing data remains actionable.
- 4. Preserve audit history and role access. Recording allocation must not claim an actual payment or transfer occurred.
- 5. Rename Báo cáo & Phê duyệt to an accurate approval-free group label, retaining both report links.
- 6. Keep period, preview and finalization together across phone, tablet and desktop. Verify readback, duplicate attempts and validation failures.

**Existing behavior / assessment:** The backend already finalizes in-request, but UI still promises an independent review and displays pending workflow state.

**Connected current-source evidence:**

- [frontend/src/pages/ProfitPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ProfitPage.tsx:158>) — Confirmation and success message say distribution goes to checking/approval.
- [frontend/src/pages/ProfitPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ProfitPage.tsx:435>) — Primary action is Gửi duyệt phân bổ; pending explanation remains at555.
- [backend/src/routes/financial/reports.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/reports.routes.ts:178>) — Authorized distribution endpoint executes autoApplyGovernanceAction in an idempotent serializable transaction.
- [backend/src/routes/financial/reports.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/financial/reports.routes.ts:212>) — Route emits the distribution event at request time, not a later review.

**Missing, contradicted or unproven:**

- The backend already finalizes in-request, but UI still promises an independent review and displays pending workflow state.
- Do not describe the current backend as waiting for a second user.
- Preserve preview, truck ownership, percentages, period rules, transaction isolation and duplicate finalization controls.
- Finalizing allocation is an accounting event, not a cash transfer.

**Target behavior / next work:**

- Return and render the actual finalized distribution with a direct action and no pending-review UI.
- Replace transient approval representation with honest direct-action audit and define legacy pending migration; rename the approval navigation group.

**Required independent checks:**

- Preview/finalize/readback, incomplete ownership, wrong/closed period, concurrent finalization, repeat request and unauthorized role.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-154"></a>

### KP-154 — Remove the internal shipment deletion approval request

**Source file:** [TODO/20260914_P2_QA-119_enhancement-remove-the-internal-shipment-deletion-approval-request.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-119_enhancement-remove-the-internal-shipment-deletion-approval-request.docx>)

**Source title (verbatim):** Remove the internal shipment deletion approval request

**SHA-256:** `b2d68ec912fd0f307c6cc0ae06899eab5ef14093d03c46456829f524d34a248c`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 1.

**Delivery:** [KP-154](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-154>) in [WP21](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp21>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-154.txt>).

**Requirements read:**

- 1. Remove the shipment deletion approval queue, approver action and submit-for-approval lifecycle from all affected roles and services.
- 2. For an authorized user and an eligible shipment, show a clear delete or cancel action and a confirmation naming the shipment and consequence; report the actual result and refresh the list.
- 3. Keep permission checks, required reason rules and operational/financial reference protections. When deletion is invalid, show the concrete blocking references and the available supported next action.
- 4. Preserve existing records and request history during migration. Resolve old pending requests without inventing approvals or silently deleting shipments.
- 5. Verify eligible, blocked, cancelled and failed-action states with keyboard and phone/tablet/desktop layouts. One confirmed action must not create duplicate requests or mutations.

**Existing behavior / assessment:** The CUS deletion backend already deletes eligible shipments directly; the visible confirmation remains an approval request and can misrepresent an immediate destructive result.

**Connected current-source evidence:**

- [frontend/src/pages/ShipmentsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ShipmentsPage.tsx:590>) — Dialog/action still say deletion request; description at608 claims administrator approval.
- [frontend/src/features/shipments/cus/use-cus-actions.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/use-cus-actions.ts:118>) — Action calls requestShipmentDelete, then reports the shipment deleted.
- [frontend/src/api/shipmentClient.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/api/shipmentClient.ts:896>) — Client calls /shipments/cus-workspace/:id/delete-request.
- [backend/src/routes/shipments/cus-workspace.routes.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/shipments/cus-workspace.routes.ts:271>) — Route is CUS-only, with version/reason and idempotent shipment write.
- [backend/src/services/shipment-governance.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/shipment-governance.service.ts:26>) — Service enforces CUS, locks/version-checks then calls softDeleteShipment directly; returns pendingApproval false at55.

**Missing, contradicted or unproven:**

- The CUS deletion backend already deletes eligible shipments directly; the visible confirmation remains an approval request and can misrepresent an immediate destructive result.
- The document’s Admin observation is historical; do not widen current CUS-only service authority merely to match that screenshot. Verify each actual role’s intended capability.
- This route does not currently park deletion in an approval queue; fix pre-commit consequence wording urgently.
- Retain reference and operational protections; never automatically execute historical pending deletion requests.

**Target behavior / next work:**

- Present a direct named delete/cancel confirmation that matches actual eligibility and role authority.
- Retain soft-delete/audit/idempotency and explain concrete blocking references with supported next steps.
- Remove obsolete request/approval contracts and resolve historical requests explicitly without silent deletion.

**Required independent checks:**

- Eligible direct delete; dispatched/financially referenced blocked deletion; stale version; cancel dialog; role denial and repeated confirm.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-155"></a>

### KP-155 — Keep valid sessions through temporary identity service failures

**Source file:** [TODO/20260914_P2_QA-124_bug-keep-valid-sessions-through-temporary-identity-service-failures.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-124_bug-keep-valid-sessions-through-temporary-identity-service-failures.docx>)

**Source title (verbatim):** Keep valid sessions through temporary identity service failures

**SHA-256:** `7d72fc8ba5784c7ed1bd3ae25fe4ed3e0f967e2371d5d9b03947417f0d6fb741`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-155](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-155>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-155.txt>).

**Requirements read:**

- 1. HTTP 503, 502, 429 and network errors preserve valid credentials while protected work remains blocked.
- 2. Retry after connection/service recovery restores identity without entering credentials again.
- 3. HTTP 401, expiry and actual revocation still clear the session and scoped data.
- 4. Cover startup failure and recovery separately from genuine authentication rejection.

**Existing behavior / assessment:** fetchAuthUser clears the valid token for every ApiError, including 503, and query retry is disabled.

**Connected current-source evidence:**

- [frontend/src/hooks/useAuth.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useAuth.tsx:111>) — Auth lookup clears the token for every ApiError.

**Missing, contradicted or unproven:**

- fetchAuthUser clears the valid token for every ApiError, including 503, and query retry is disabled.

**Target behavior / next work:**

- Distinguish invalid authentication from temporary identity/service failure.
- Preserve valid credentials while protected content is gated; explicit bounded recovery restores identity.

**Required independent checks:**

- 401, expired and revoked credentials versus 502/503/429/network failure; startup and existing-session recovery; account-switch isolation.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-156"></a>

### KP-156 — Enforce OPS shipment scope when serving trip photos

**Source file:** [TODO/20260914_P2_QA-127_bug-enforce-ops-shipment-scope-when-serving-trip-photos.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-127_bug-enforce-ops-shipment-scope-when-serving-trip-photos.docx>)

**Source title (verbatim):** Enforce OPS shipment scope when serving trip photos

**SHA-256:** `80d87f329f37a9c9cfd2cfc0fa91befcaa83303bfa29e89aeded896d67f8892d`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-156](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-156>) in [WP04](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp04>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-156.txt>).

**Requirements read:**

- 1. Assigned OPS can retrieve the synthetic trip photo through the authenticated route.
- 2. Unassigned OPS and an account whose assignment was revoked cannot retrieve the same known key.
- 3. Office permissions and DRIVER ownership behavior remain consistent.
- 4. Add route-level tests for current assignment, revocation and absent trip records; keep errors consistent with record visibility.
- 5. Retest this authenticated boundary independently of QA-125: closing the public alias alone must not be treated as an OPS authorization fix.

**Existing behavior / assessment:** The authenticated trip-photo route applies its ownership check only to DRIVER. OPS requests with a known key do not use the current shipment-assignment predicate.

**Connected current-source evidence:**

- [backend/src/routes/upload.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/upload.ts:719>) — The tripMatch branch applies its ownership guard to DRIVER only.

**Missing, contradicted or unproven:**

- The authenticated trip-photo route applies its ownership check only to DRIVER. OPS requests with a known key do not use the current shipment-assignment predicate.

**Target behavior / next work:**

- Centralize exact photo-key authorization with current OPS shipment scope and intended office roles.
- Check existing trip and revoked assignment before sending bytes.

**Required independent checks:**

- Assigned then revoked OPS access using a known key; unassigned actor; absent trip; driver ownership; office-role policy. Use synthetic images only.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-157"></a>

### KP-157 — Honor an explicit zero road allowance override

**Source file:** [TODO/20260914_P2_QA-128_bug-honor-an-explicit-zero-road-allowance-override.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-128_bug-honor-an-explicit-zero-road-allowance-override.docx>)

**Source title (verbatim):** Honor an explicit zero road allowance override

**SHA-256:** `0eef392af0094a1516a01139f9d852861454814fbab04257d60bc1b61fe84c15`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-157](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-157>) in [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-157.txt>).

**Requirements read:**

- 1. Use the explicit override whenever it is non-null and valid, including zero. Keep ordinary negative/invalid input validation.
- 2. Add pure calculation cases for null, undefined, zero and positive overrides against a positive automatic allowance; assert totalRoadAllowance, totalCost and grossProfit.
- 3. Add edit/save/readback coverage for zero, then clear to automatic and confirm the automatic amount returns. Retain direct authorized saves without adding approval stages.

**Existing behavior / assessment:** The shared totals predicate excludes an explicit zero roadAllowanceOverride.

**Connected current-source evidence:**

- [shared/src/calculations/tripTotals.ts](</Users/frank.nguyen/Documents/silversea/codebase/shared/src/calculations/tripTotals.ts:141>) — The override is used only when greater than 0.

**Missing, contradicted or unproven:**

- The shared totals predicate excludes an explicit zero roadAllowanceOverride.

**Target behavior / next work:**

- Use a non-null valid override, including 0; absence means automatic calculation.
- Keep schema validation and accurate persisted applied totals.

**Required independent checks:**

- null, undefined, 0, positive and negative values; save 0/readback, then clear; cost and profit deltas.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-158"></a>

### KP-158 — Synchronize actual work days when the driver completes a trip

**Source file:** [TODO/20260914_P2_QA-129_bug-synchronize-actual-work-days-when-the-driver-completes-a-trip.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-129_bug-synchronize-actual-work-days-when-the-driver-completes-a-trip.docx>)

**Source title (verbatim):** Synchronize actual work days when the driver completes a trip

**SHA-256:** `6513f7448e2b6372d321467fa4fc58ebd53f3cc6616cb55fdaf3f1486bc4fe59`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-158](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-158>) in [WP06](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp06>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-158.txt>).

**Requirements read:**

- 1. Persist the completion attendance update atomically with completion where compatible with lock order, or enqueue durable, idempotent synchronization in that transaction. A transient failure must not silently leave attendance permanently stale.
- 2. Use Asia/Ho_Chi_Minh business dates and the persisted completion timestamp; cover same-day, midnight, multiple days, Sunday and payroll-period boundaries.
- 3. Exercise the actual driver completion route, then read driverWorkDays and payroll; verify repeated requests and retries neither omit days nor duplicate work-day/financial records.
- 4. Preserve legitimate existing trip attribution, permissions and closed-period handling. Keep direct driver completion; do not restore an approval step.

**Existing behavior / assessment:** The driver completion transaction transitions status and recomputes shipment state. After commit, it only invalidates reports; no attendance synchronization is called.

**Connected current-source evidence:**

- [backend/src/services/driver-fulfillment.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-fulfillment.service.ts:410>) — Actual completion flow
- [backend/src/services/driver-fulfillment.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/driver-fulfillment.service.ts:494>) — Only report invalidation runs after commit.
- [backend/src/services/trip-attendance-sync.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-attendance-sync.service.ts:30>) — Existing wrapper uses global database access and swallows errors, so invoking it inside another transaction does not provide atomic attendance synchronization.
- [backend/src/services/attendance.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/attendance.service.ts:200>) — Driver/date upsert can overwrite trip attribution; multiple trip contributions and manual attendance need explicit derivation.

**Missing, contradicted or unproven:**

- The driver completion transaction transitions status and recomputes shipment state. After commit, it only invalidates reports; no attendance synchronization is called.

**Target behavior / next work:**

- Invoke attendance authority inside completion transaction with consistent lock order, or durable transactional outbox.
- Derive business dates from persisted completion instant; replay converges.
- Use an executor-aware attendance operation whose failure aborts the completion transaction, or a durable transactional outbox. Do not wrap the current global-db/swallowing helper and call the result atomic.
- Derive each driver/day from all eligible trip contributions and explicit manual attendance provenance. Recompute after cancellation/reassignment and reject stale events by current trip state/version; coordinate payroll closing and cache refresh after the attendance commit.

**Required independent checks:**

- Saturday to Sunday; multi-day trip; midnight; period boundary; failed synchronization; replayed completion; existing trip attribution; locked period.
- Two trips on one day; cancel/reassign only one; preexisting manual attendance; duplicate/out-of-order completion after cancellation; worker failure/retry and payroll finalization race.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-159"></a>

### KP-159 — Resolve road allowance using the newly selected trailer type

**Source file:** [TODO/20260914_P2_QA-130_bug-resolve-road-allowance-using-the-newly-selected-trailer-type.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-130_bug-resolve-road-allowance-using-the-newly-selected-trailer-type.docx>)

**Source title (verbatim):** Resolve road allowance using the newly selected trailer type

**SHA-256:** `7761e3741c8a13f679a273fd19be44fa3a15c2e947e35603e05633bc1a1583b3`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-159](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-159>) in [WP05](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp05>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-159.txt>).

**Requirements read:**

- 1. Use the final route/trailer pair for all allowance resolution and persistence. Do not run a fallback for the obsolete trailer type.
- 2. Represent missing rate separately from a valid zero; decide the supported missing-rate behavior explicitly and keep user feedback accurate.
- 3. Add service/API regression cases for 40FT→20FT and reverse, with new-type positive, zero and missing rates; also change route and trailer together.
- 4. Assert trailer type, roadAllowanceBaseApplied, totalRoadAllowance, totalCost and grossProfit after reload; retain existing valid manual overrides and direct authorized editing.

**Existing behavior / assessment:** A missing or zero allowance for the new type falls back to the previous trip.trailerType.

**Connected current-source evidence:**

- [backend/src/services/trip-figure-updates.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-figure-updates.service.ts:216>) — The final type is resolved first.
- [backend/src/services/trip-figure-updates.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-figure-updates.service.ts:301>) — A zero result falls back to a query using the old type.

**Missing, contradicted or unproven:**

- A missing or zero allowance for the new type falls back to the previous trip.trailerType.

**Target behavior / next work:**

- Resolve the final route/type exactly once; distinguish a missing rate from configured 0.
- Use an explicit missing-rate error or incomplete estimate rather than the obsolete rate.

**Required independent checks:**

- 40FT to 20FT and reverse: positive, zero and absent new rate; simultaneous route/type change; manual override; reload base allowance, cost and profit.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-160"></a>

### KP-160 — Retain buffered trip photos until each upload is confirmed

**Source file:** [TODO/20260914_P2_QA-131_bug-retain-buffered-trip-photos-until-each-upload-is-confirmed.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-131_bug-retain-buffered-trip-photos-until-each-upload-is-confirmed.docx>)

**Source title (verbatim):** Retain buffered trip photos until each upload is confirmed

**SHA-256:** `f2265d5bfefaff13a7c84a7ed9200537c63b1a59b4b5396b7592964245e007dc`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-160](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-160>) in [WP03](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp03>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-160.txt>).

**Requirements read:**

- 1. A failed or unattempted file remains available in the open form for an explicit online retry; upload only unresolved files with stable idempotency identity. No durable offline storage or reconnect replay.
- 2. Successful uploads immediately replace their previews. Never revoke a blob still displayed, or retain a blob as a durable server attachment URL.
- 3. A partial failure preserves the saved trip/container IDs and explains which attachments remain; a retry does not create a duplicate trip or duplicate confirmed attachment.
- 4. Test first/middle upload failure, missing returned photo URL and lost connection. Verify explicit online retry and readback without recapturing, duplicate saves or automatic reconnection upload. Preserve row deletion and replacement behavior.

**Existing behavior / assessment:** Both photo-flush methods empty pending arrays before uploads. A later failure discards retryable files and URL replacements.

**Connected current-source evidence:**

- [frontend/src/hooks/useTripFormPhotos.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormPhotos.ts:159>) — Clears the trip-photo buffer before upload completion.
- [frontend/src/hooks/useTripFormPhotos.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useTripFormPhotos.ts:245>) — Clears the row-photo buffer before upload completion.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:523>) — Trip creation catches the photo-flush failure.
- [frontend/src/lib/api/client.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/api/client.ts:130>) — Generated command identity is released on responses below 500 before JSON parse, making malformed success/unknown result retries unsafe.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:497>) — Create conflict recovery can mint a new key; preserve and reconcile the original logical trip identity before any fresh create.

**Missing, contradicted or unproven:**

- Both photo-flush methods empty pending arrays before uploads. A later failure discards retryable files and URL replacements.

**Target behavior / next work:**

- Track each in-memory attachment as selected, uploading, confirmed or failed; remove only confirmed items.
- Apply the URL replacement before revoking the old blob URL; retain created entity IDs and explain partial success.
- Allow manual online retry only; do not create a durable queue.
- Add UNKNOWN_OUTCOME for a lost response, malformed success or missing required attachment identity/URL. Retain the caller-owned per-attachment command key through validated response or authorized readback; do not equate unknown outcome with rejected upload.
- Use stable row/attachment IDs plus generation/tombstone guards so late results cannot reattach replaced/deleted rows. Retain the blob preview and created trip ID until the relevant server result is confirmed. All retries are explicit and online; no durable queue/reconnect replay.

**Required independent checks:**

- First or middle upload failure; missing URL; lost response after commit; deleted row; explicit retry without recapture; no duplicate entity or attachment.
- Lost response after server attachment; malformed 2xx; missing URL; deletion/replacement during upload; rapid concurrent retry clicks; repeated create after an unknown result.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-161"></a>

### KP-161 — Allow the current account to log out while an earlier revocation waits

**Source file:** [TODO/20260914_P2_QA-135_bug-allow-the-current-account-to-log-out-while-an-earlier-revocation-waits.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-135_bug-allow-the-current-account-to-log-out-while-an-earlier-revocation-waits.docx>)

**Source title (verbatim):** Allow the current account to log out while an earlier revocation waits

**SHA-256:** `97d825f9c5bf7d963e4a5f0d76e0bf63e3b25f82ab669c8785ae098c29955226`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-161](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-161>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-161.txt>).

**Requirements read:**

- 1. B signs out locally immediately while A’s revocation is pending.
- 2. Online revocation targets the correct token; a late response cannot alter another session. Do not add an offline revocation queue.
- 3. Repeated sign-out taps remain idempotent.
- 4. Test failed or hung revocation followed by account switching and logout.

**Existing behavior / assessment:** The provider-wide logoutInFlight guard returns before reading the current account token. Revocation for the previous account can block logout of a newly signed-in account. The durable revocation queue also remains.

**Connected current-source evidence:**

- [frontend/src/hooks/useAuth.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useAuth.tsx:186>) — Provider-wide logout guard.
- [frontend/src/hooks/useAuth.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/useAuth.tsx:204>) — Queued token revocation and retry.

**Missing, contradicted or unproven:**

- The provider-wide logoutInFlight guard returns before reading the current account token. Revocation for the previous account can block logout of a newly signed-in account. The durable revocation queue also remains.

**Target behavior / next work:**

- Always clear the current local session immediately; deduplicate only the specific token-revocation request.
- Retire durable logout-token replay with the online-only migration; explain remote uncertainty without retaining a credential replay queue.

**Required independent checks:**

- Account A logout hangs, then account B logs in and logs out; late A response; repeated click; expired session; no legacy queued tokens in localStorage.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-162"></a>

### KP-162 — Report completed trip financial edits as saved without a false approval queue

**Source file:** [TODO/20260914_P2_QA-137_bug-report-completed-trip-financial-edits-as-saved-without-a-false-approval-queu.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-137_bug-report-completed-trip-financial-edits-as-saved-without-a-false-approval-queu.docx>)

**Source title (verbatim):** Report completed trip financial edits as saved without a false approval queue

**SHA-256:** `24016999d59a28f596ea4f0ea3e7f1d7814719a43fcc5fa1167bf28b8a5a609c`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-162](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-162>) in [WP02](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp02>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-162.txt>).

**Requirements read:**

- 1. Successful completed-trip edits show a truthful direct-save result and the resulting figures/version without a pending-review message or queue dependency.
- 2. Use an explicit API result contract; do not infer pending status from actionKind or pretend to approve a request in the UI.
- 3. Preserve reason, authorization, validation, idempotency and version-conflict recovery. Distinguish a committed financial update from a later attachment/container/instruction failure.
- 4. Add frontend coverage using the real applied-action response shape and verify save/readback in desktop, tablet and phone flows. Existing backend direct-apply tests must remain valid.

**Existing behavior / assessment:** Confirmed remaining false-success semantics: applied completed-trip action is still classified as pending from actionKind alone.

**Connected current-source evidence:**

- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:399>) — actionKind TRIP_FINANCIAL_CHANGE sets pendingGovernance and skips immediate cache replacement.
- [frontend/src/hooks/use-trip-form-submit.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/hooks/use-trip-form-submit.ts:408>) — Success toast directs user to checking/approval queue.
- [backend/src/routes/trips/figures.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/routes/trips/figures.ts:98>) — Completed-trip actuals call autoApplyGovernanceAction during the request and return its action result.
- [backend/src/services/adjustment-governance.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/adjustment-governance.service.ts:777>) — Direct-application helper supplies the applied action response.

**Missing, contradicted or unproven:**

- Confirmed remaining false-success semantics: applied completed-trip action is still classified as pending from actionKind alone.
- Supersedes the approval-expectation direction of KP-101/QA-067; do not restore approval to make the message true.
- The applied-action object is not a TripDetail. Do not place it into the detail cache merely by changing the pending boolean.

**Target behavior / next work:**

- Define an explicit saved-action/resulting-trip response or fetch the authoritative trip after success.
- Update figures/version and show saved outcome; preserve the distinction between committed figures and later attachment/instruction failures.

**Required independent checks:**

- Real applied-action response shape, current trip/version readback, ancillary failure, idempotent retry and conflict recovery at all widths.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-163"></a>

### KP-163 — Replace trip credit override approval requests with direct authorized exception handling

**Source file:** [TODO/20260914_P2_QA-138_enhancement-replace-trip-credit-override-approval-requests-with-direct-authorized-except.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-138_enhancement-replace-trip-credit-override-approval-requests-with-direct-authorized-except.docx>)

**Source title (verbatim):** Replace trip credit override approval requests with direct authorized exception handling

**SHA-256:** `1c78f0727d2f243fc767c3d36e967fb27dd5b00253d18f3f41c4698834831f44`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-163](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-163>) in [WP23](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp23>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-163.txt>).

**Requirements read:**

- 1. The over-limit user flow contains no internal approval request, waiting/approved selection or approval queue. An authorized exception has a direct, clearly described result.
- 2. Keep credit-limit warning/blocking behavior and enforce permitted exception authority, customer/scope matching, expiry, exposure ceiling and single-use rules where applicable.
- 3. Record the actual actor and exception reason without fabricated reviewer/approver actions. Preserve historical records read-only with truthful legacy labels.
- 4. Cover within-limit, authorized over-limit, unauthorized, expired/wrong-customer exception, changed exposure, duplicate submit and failed-save recovery. Verify the full trip flow on desktop, tablet and phone.

**Existing behavior / assessment:** Directly applied credit overrides still use an approved-request record and a separate approved-selection trip workflow.

**Connected current-source evidence:**

- [frontend/src/pages/TripCreatePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripCreatePage.tsx:118>) — Creates a separate credit request before trip retry.
- [frontend/src/pages/TripCreatePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripCreatePage.tsx:270>) — Request picker/badge still describes approved and pending records.
- [backend/src/services/trip-create.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/trip-create.service.ts:210>) — Trip creation passes creditApprovalRequestId to assertCreditLimit.
- [backend/src/services/credit-limit.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/credit-limit.service.ts:431>) — Override creation inserts request and applies within the same transaction.
- [backend/src/services/credit-limit.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/credit-limit.service.ts:766>) — Use requires APPROVED status, exact customer/scope/expiry and single-use checks.
- [backend/src/services/credit-limit.service.ts](</Users/frank.nguyen/Documents/silversea/codebase/backend/src/services/credit-limit.service.ts:428>) — App-setting creditTierOneAmountCap selects the exception authority tier.

**Missing, contradicted or unproven:**

- Directly applied credit overrides still use an approved-request record and a separate approved-selection trip workflow.
- No second-person wait is established in this current path; the defect is the request/approved workflow and dependence.
- Coordinate the app-settings cap portion misgrouped in KP-149 here. Removing internal approval cannot erase ordinary credit-limit or exception-authority limits.
- Keep exposure ceiling, customer/shipment matching, expiry and consumed exception identity; define direct authority explicitly instead of granting everyone an exception.

**Target behavior / next work:**

- Provide direct authorized exception handling within trip creation with clear amount/scope/reason and actual outcome.
- Replace request/approved selection and fake reviewer events with direct exception audit; migrate legacy records read-only or through explicit conversion.
- Preserve current exposure recheck and single-use/concurrency controls during trip commit.

**Required independent checks:**

- Within limit, authorized/unauthorized over-limit, wrong customer, expired/consumed exception, changed exposure, repeat submit and failed trip recovery.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-164"></a>

### KP-164 — Retire the offline service worker cache and background sync with an upgrade migration

**Source file:** [TODO/20260914_P2_QA-141_enhancement-retire-the-offline-service-worker-cache-and-background-sync-with-an-upgrade.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-141_enhancement-retire-the-offline-service-worker-cache-and-background-sync-with-an-upgrade.docx>)

**Source title (verbatim):** Retire the offline service worker cache and background sync with an upgrade migration

**SHA-256:** `1d013cc797fb780e282ace073f6cdb513a7a7565855442edd9241eb00d7ce219`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-164](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-164>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-164.txt>).

**Requirements read:**

- 1. Neither registration path installs offline fetch fallbacks or periodic journey polling. Remove the token-cache producer and count metadata consumer together.
- 2. Migration removes only identified TransTing offline caches/entries and the refresh-journey-board tag; unrelated caches, normal authentication and ordinary push remain intact. Repeated migration is safe and does not recreate retired storage.
- 3. Previously controlled tabs converge to the new worker without reload loops; no cached application response restores offline operations. QA-140 supplies the internet-required state where the application is loaded.
- 4. Add worker/migration tests and verify old-profile, multi-tab, fresh-profile and installed-app upgrades in Chrome. Verify notification delivery/click navigation after migration and no queued mutation replay, coordinated with QA-139.

**Existing behavior / assessment:** Startup and push registration still install the offline-shell worker. The worker caches navigation and performs periodic journey reads; the token mirror recreates its cache.

**Connected current-source evidence:**

- [frontend/src/main.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/main.tsx:35>) — Offline worker registration.
- [frontend/public/sw.js](</Users/frank.nguyen/Documents/silversea/codebase/frontend/public/sw.js:160>) — Offline fetch fallback.
- [frontend/src/lib/token.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/token.ts:17>) — Auth-token cache mirror.

**Missing, contradicted or unproven:**

- Startup and push registration still install the offline-shell worker. The worker caches navigation and performs periodic journey reads; the token mirror recreates its cache.

**Target behavior / next work:**

- Ship a minimal push-only worker at the existing URL/scope; remove offline fetch and periodic synchronization.
- Retire only owned cache entries, registration tags and token-cache producers before re-enabling push; ensure migration converges across multiple tabs.

**Required independent checks:**

- Old and fresh profiles; installed app; multiple tabs; unsupported APIs; push receipt/click; repeated migration; no offline business screen or replay.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-165"></a>

### KP-165 — Distinguish unavailable route assets from a verified new deployment

**Source file:** [TODO/20260914_P2_QA-142_bug-distinguish-unavailable-route-assets-from-a-verified-new-deployment.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P2_QA-142_bug-distinguish-unavailable-route-assets-from-a-verified-new-deployment.docx>)

**Source title (verbatim):** Distinguish unavailable route assets from a verified new deployment

**SHA-256:** `52feaaec0004be9f68cc09ac53a35a357ad072833aabe3366530fd2c24956a1b`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P2. **Images:** 0.

**Delivery:** [KP-165](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-165>) in [WP13](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp13>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-165.txt>).

**Requirements read:**

- 1. Connection and asset-service failures do not claim a new version, indiscriminately purge caches or immediately force a deployment reload. Provide a clear unavailable state and explicit retry; connectivity indicators alone must not be treated as proof that the asset service works.
- 2. A verified outdated build has a bounded refresh path with loop protection and a truthful fallback if assets remain unavailable. Unrelated connection failures must not consume that deployment-recovery allowance.
- 3. Any retained cache cleanup targets only relevant application assets and agrees with QA-141's offline-worker retirement. Never reintroduce cached offline business operation, queued commands or automatic mutation replay.
- 4. Add cases for unchanged-build network failure, asset-service failure, genuine stale deployment, repeated failure and exhausted recovery in both the React boundary and global event paths. Check compact, accessible recovery text and retry at phone, tablet and desktop widths.

**Existing behavior / assessment:** Generic dynamic-import/preload errors trigger cache purging, reload and a new-version message without evidence that the build changed.

**Connected current-source evidence:**

- [frontend/src/lib/chunk-error.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/chunk-error.ts:25>) — Generic error classification.
- [frontend/src/lib/chunk-error.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/lib/chunk-error.ts:53>) — Global cache deletion and reload.
- [frontend/src/components/shared/ErrorBoundary.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/shared/ErrorBoundary.tsx:32>) — New-version copy.

**Missing, contradicted or unproven:**

- Generic dynamic-import/preload errors trigger cache purging, reload and a new-version message without evidence that the build changed.

**Target behavior / next work:**

- Compare frontend build identity and asset/service availability; show a truthful unavailable state when there is no evidence of a stale build.
- Allow bounded reload only for a verified stale deployment; clean up only owned assets and use an independent cooldown.

**Required independent checks:**

- Unchanged-build network failure; asset 503; new build with stale tab; repeated failure; cooldown; React boundary/global handler; stated limits of in-memory drafts.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-166"></a>

### KP-166 — Remove duplicate configuration entries from the settings overview

**Source file:** [TODO/20260914_P3_QA-027_bug-remove-duplicate-configuration-entries-from-the-settings-overview.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-027_bug-remove-duplicate-configuration-entries-from-the-settings-overview.docx>)

**Source title (verbatim):** Remove duplicate configuration entries from the settings overview

**SHA-256:** `a000b3ac48aae649ea501278bc05303c48906f69b9e65be7f134723abdf35fc1`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-166](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-166>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-166.txt>).

**Requirements read:**

- 1. The overview contains one fuel-price-periods entry and one route-terms entry.
- 2. Each entry retains the correct destination, current count and existing create/edit actions.
- 3. Desktop, tablet and mobile present the remaining choices compactly without oversized replacement panels.

**Existing behavior / assessment:** The current registry contains duplicate IDs/destinations, and a fresh staging screenshot shows both duplicates.

**Connected current-source evidence:**

- [frontend/src/data/searchRegistry.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/data/searchRegistry.ts:76>) — Two entries each for fuel prices and freight terms.

**Missing, contradicted or unproven:**

- The current registry contains duplicate IDs/destinations, and a fresh staging screenshot shows both duplicates.

**Target behavior / next work:**

- Deduplicate by canonical destination/ID; preserve role visibility, counts and routing.
- Add a registry-uniqueness check.

**Required independent checks:**

- Each destination appears once; links open correctly; role access unchanged; recheck staging screenshot.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-167"></a>

### KP-167 — Align payroll period summary with the current default rule

**Source file:** [TODO/20260914_P3_QA-029_bug-align-payroll-period-summary-with-the-current-default-rule.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-029_bug-align-payroll-period-summary-with-the-current-default-rule.docx>)

**Source title (verbatim):** Align payroll period summary with the current default rule

**SHA-256:** `93e8e6b4e98d0ce3bb45ba5e5768c27976f6484253b3945e30e7dc84531fb7ee`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-167](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-167>) in [WP24](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp24>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-167.txt>).

**Requirements read:**

- 1. With no custom override, the overview and detail describe the same effective system default.
- 2. With a custom period, both views consistently identify that rule and its dates after save and reload.
- 3. Keep the card summary short and clear; the copy fix does not silently change the effective payroll period.

**Existing behavior / assessment:** The hardcoded 26th-to-25th description conflicts with the current first-to-last-day status in the same staging card.

**Connected current-source evidence:**

- [frontend/src/data/searchRegistry.ts](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/data/searchRegistry.ts:80>) — Hardcoded default-period copy.
- [frontend/src/pages/ConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ConfigPage.tsx:73>) — Query for the effective salary configuration.

**Missing, contradicted or unproven:**

- The hardcoded 26th-to-25th description conflicts with the current first-to-last-day status in the same staging card.

**Target behavior / next work:**

- Derive the summary from the effective system/custom rule, or use neutral copy. Do not change payroll policy.

**Required independent checks:**

- No override/system default; custom rule; save/reload; overview/detail agreement.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-168"></a>

### KP-168 — Make the mobile trip list show records sooner

**Source file:** [TODO/20260914_P3_QA-031_enhancement-make-the-mobile-trip-list-show-records-sooner.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-031_enhancement-make-the-mobile-trip-list-show-records-sooner.docx>)

**Source title (verbatim):** Make the mobile trip list show records sooner

**SHA-256:** `d7d79f959a77c16d31f735dd3f95a1fd659afee2c56b13865f7afb9049af5ed2`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-168](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-168>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-168.txt>).

**Requirements read:**

- 1. At 390 × 844, the default list begins within the first half of the viewport and exposes one complete compact trip card when records exist.
- 2. Status counts and selected filters remain understandable without presenting the same summary twice.
- 3. Search, filter reset and trip creation remain easy to reach; touch controls and text remain readable.
- 4. Tablet and desktop preserve useful data density and do not gain oversized controls or unnecessary empty panels.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/TripListPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripListPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Replace repeated status charts/chips with one compact filter strip; show the first complete phone record before the middle of the viewport.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-169"></a>

### KP-169 — Match container helper text to the trip creation action

**Source file:** [TODO/20260914_P3_QA-032_bug-match-container-helper-text-to-the-trip-creation-action.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-032_bug-match-container-helper-text-to-the-trip-creation-action.docx>)

**Source title (verbatim):** Match container helper text to the trip creation action

**SHA-256:** `f7b7976d4d361cf1cd485f893d95ac83e654ad200582671c2482aa41dca8631f`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-169](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-169>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-169.txt>).

**Requirements read:**

- 1. Creation help references the current creation action and never instructs users to find an absent Lưu cập nhật button.
- 2. Editing help also agrees with its actual footer action.
- 3. Keep the help concise and readable on mobile, tablet and desktop without changing the save behavior or adding a large message panel.

**Existing behavior / assessment:** The creation-helper mismatch remains an open historical report. The shared create/edit mode text must be verified.

**Connected current-source evidence:**

- [frontend/src/components/trip/ContainerInstancesCard.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/trip/ContainerInstancesCard.tsx:1>) — Shared container form.

**Missing, contradicted or unproven:**

- The creation-helper mismatch remains an open historical report. The shared create/edit mode text must be verified.

**Target behavior / next work:**

- Pass the form mode/action label to the concise helper, or use accurate mode-neutral copy.

**Required independent checks:**

- Create “Tạo lệnh” and edit “Lưu cập nhật” labels; container persistence unchanged at all widths.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-170"></a>

### KP-170 — Explain rejected negative amounts in discipline rule edits

**Source file:** [TODO/20260914_P3_QA-074_bug-explain-rejected-negative-amounts-in-discipline-rule-edits.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-074_bug-explain-rejected-negative-amounts-in-discipline-rule-edits.docx>)

**Source title (verbatim):** Explain rejected negative amounts in discipline rule edits

**SHA-256:** `dfd08daa364f5d822750b85066a45615a569ac50147d434e53a6430fa67a5b9b`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-170](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-170>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-170.txt>).

**Requirements read:**

- 1. Reject negative amounts with a visible Vietnamese explanation beside the field; preserve the saved value.
- 2. Expose the invalid state and message accessibly, with focus after a rejected submission.
- 3. If Save is disabled for invalid input, explain why; never leave an enabled submission silently ineffective.
- 4. Verify Enter, click, correction and reload on desktop, tablet and phone; retain name and severity values.

**Existing behavior / assessment:** A negative amount receives no adjacent field error in the reason editor. Save forwards Number(amount), while the disabled state checks only the name and duplicates.

**Connected current-source evidence:**

- [frontend/src/pages/config/PenaltyReasonsConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/PenaltyReasonsConfigPage.tsx:208>) — Amount field without an associated validation message.
- [frontend/src/pages/config/PenaltyReasonsConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/PenaltyReasonsConfigPage.tsx:248>) — Save handler and disabled-state guards.

**Missing, contradicted or unproven:**

- A negative amount receives no adjacent field error in the reason editor. Save forwards Number(amount), while the disabled state checks only the name and duplicates.

**Target behavior / next work:**

- Keep the raw amount draft; validate nonnegative input before sending a request; show a Vietnamese field error with id, aria-invalid, aria-describedby and focus handling.

**Required independent checks:**

- Type and paste a negative value; Enter and click save; correction; zero; empty value; no saved negative amount; retain reason and severity.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-171"></a>

### KP-171 — Remove duplicate currency units from discipline amounts

**Source file:** [TODO/20260914_P3_QA-075_bug-remove-the-duplicate-currency-unit-from-discipline-rankings.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-075_bug-remove-the-duplicate-currency-unit-from-discipline-rankings.docx>)

**Source title (verbatim):** Remove duplicate currency units from discipline amounts

**SHA-256:** `faf9eacd856957fdb630d03cc1f59a68f0fdd49debf85f0aa1f929971fdf09cb`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-171](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-171>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-171.txt>).

**Requirements read:**

- 1. The 60,000 VND ranking and confirmation amounts display one unit, such as 60.000 ₫, without an added đ.
- 2. Zero and nonzero amounts use the same formatting convention; preserve underlying values, sorting and compact column alignment.
- 3. Check visible and accessibility text on desktop, tablet and phone; ledger and rule amounts remain consistently formatted.

**Existing behavior / assessment:** Discipline amount displays append a manual “đ” to an already formatted currency value.

**Connected current-source evidence:**

- [frontend/src/features/penalties/components/PenaltyTable.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/PenaltyTable.tsx:285>) — Ranking display duplicates the currency unit.
- [frontend/src/features/penalties/components/CancelPenaltyDialog.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/penalties/components/CancelPenaltyDialog.tsx:42>) — Confirmation display duplicates the currency unit.

**Missing, contradicted or unproven:**

- Discipline amount displays append a manual “đ” to an already formatted currency value.

**Target behavior / next work:**

- Use one currency formatter in rankings, confirmation and scoreboard; remove the manual suffix.

**Required independent checks:**

- Zero, nonzero and large values; visible text and accessibility tree contain exactly one currency unit; sort arithmetic unchanged.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-172"></a>

### KP-172 — Describe negative earnings balances without assuming excess advances

**Source file:** [TODO/20260914_P3_QA-079_bug-describe-negative-earnings-balances-without-assuming-excess-advances.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-079_bug-describe-negative-earnings-balances-without-assuming-excess-advances.docx>)

**Source title (verbatim):** Describe negative earnings balances without assuming excess advances

**SHA-256:** `d78c78ad49579e521943865f02dba0b0c3f8e58c43b1650ce78b3ccf17b3c9f5`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-172](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-172>) in [WP22](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp22>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-172.txt>).

**Requirements read:**

- 1. A negative balance caused solely by deductions must not claim that excess advances were paid.
- 2. Cover deduction-only, actual advance, mixed, zero and positive balances with accurate Vietnamese wording.
- 3. Preserve the balance calculation and component amounts; keep the label consistent on phone, tablet and desktop.

**Existing behavior / assessment:** The negative-earnings headline is selected from the balance sign alone and states that the advance was excessive.

**Connected current-source evidence:**

- [frontend/src/pages/DriverEarningsPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DriverEarningsPage.tsx:128>) — Label selection based only on balance sign.

**Missing, contradicted or unproven:**

- The negative-earnings headline is selected from the balance sign alone and states that the advance was excessive.

**Target behavior / next work:**

- Use neutral signed-balance wording or a label derived from the actual components.

**Required independent checks:**

- Deduction only; advance only; mixed components; zero; positive balance; unchanged arithmetic and component amounts.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-173"></a>

### KP-173 — Align and compact the expense entry form

**Source file:** [TODO/20260914_P3_QA-088_enhancement-align-and-compact-the-expense-entry-form.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-088_enhancement-align-and-compact-the-expense-entry-form.docx>)

**Source title (verbatim):** Align and compact the expense entry form

**SHA-256:** `45cf9df42d44d0c0dce6fb2240cd82efd296d95fa881e2fc0630b22436b60cc9`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-173](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-173>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-173.txt>).

**Requirements read:**

- 1. Align labels, inline Thêm mới actions and controls on consistent row baselines. Keep both effective dates together in reading and keyboard order.
- 2. Present the automatic entry date as compact read-only metadata; size receipt and action areas to their content without removing upload, cancel or submission controls.
- 3. At desktop/tablet/phone widths, retain logical field order, readable long values and visible validation. Avoid horizontal overflow and oversized headings or fields; provide at least 44px phone touch hit areas.
- 4. Check recurring and non-recurring forms, empty/populated receipts and validation states. Preserve values, permissions and submission semantics; approval posting and broken receipts remain QA-086/087.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/ExpenseEntryPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/ExpenseEntryPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Align label/control baselines and the effective-date pair; size the receipt area to its content and reduce scrolling through required fields.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-174"></a>

### KP-174 — Make customer and factory directories easier to scan

**Source file:** [TODO/20260914_P3_QA-090_enhancement-make-customer-and-factory-directories-easier-to-scan.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-090_enhancement-make-customer-and-factory-directories-easier-to-scan.docx>)

**Source title (verbatim):** Make customer and factory directories easier to scan

**SHA-256:** `bcc6f7e4f0cce5e02bef2c00f434f61282630b56b6a28c58802f56268f9815b4`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 4.

**Delivery:** [KP-174](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-174>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-174.txt>).

**Requirements read:**

- 1. Keep codes, MST and phones unbroken; give identity/route useful width. Use deliberate column selection or scrolling instead of smaller text.
- 2. Show a complete phone customer summary sooner by reducing summary-panel height. Preserve search, filters, export and creation.
- 3. Factory summaries retain code, customer, name, route and status. Group ordinal/edit with identity; materially reduce phone/tablet card height.
- 4. Keep full names, addresses, contacts, terms, missing-value meaning and editing accessible through explicit touch/keyboard details.
- 5. Check long/empty values, readability, focus and touch targets at all widths. Regress /config directories: trucks, trailers, tire-positions, cargo-types, pricing-tables, fuel-price-periods, freight-rate-terms and routes. Preserve compact desktop tables and the route tablet view.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/config/CustomersConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CustomersConfigPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Use compact customer/factory summaries, unbroken identifiers and secondary details on demand; include secondary directories in regression coverage.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-175"></a>

### KP-175 — Use space efficiently in the customer dialog

**Source file:** [TODO/20260914_P3_QA-091_enhancement-use-space-efficiently-in-the-customer-dialog.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-091_enhancement-use-space-efficiently-in-the-customer-dialog.docx>)

**Source title (verbatim):** Use space efficiently in the customer dialog

**SHA-256:** `312594cc491a0d39ad41a89bd7a182580a5dbfc4b80c8d5e3baad7b24a85bea9`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-175](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-175>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-175.txt>).

**Requirements read:**

- 1. Use more of the phone width: target about 12–16 pixels of content inset within the surface, while respecting safe areas and close controls.
- 2. Give long customer/contact fields full row width where needed. Pair short fields only when labels and expected values remain usable; do not force one grid at every size.
- 3. Reduce repeated blank row gaps and align paired inputs when labels wrap. At 1440 × 900, expose final fields/actions sooner without shrinking readable text.
- 4. Keep all fields, defaults, carrier option, debt-template selection and create/cancel actions. Maintain logical focus order, visible validation and at least 44-pixel phone touch hit areas.
- 5. Check creation and populated editing at all three widths, including long names and invalid inputs. No overlap, lost values or horizontal clipping; actions remain reachable while scrolling.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/config/CustomerForm.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CustomerForm.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Use 12–16px phone surface insets; give long fields the full width; pair short fields only when they fit; keep the footer compact.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-176"></a>

### KP-176 — Keep template column properties close to selection

**Source file:** [TODO/20260914_P3_QA-092_enhancement-keep-template-column-properties-close-to-selection.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-092_enhancement-keep-template-column-properties-close-to-selection.docx>)

**Source title (verbatim):** Keep template column properties close to selection

**SHA-256:** `60771753c59feff37811ec6f9fb9889e56751a29e155ced9d3275bd909b45764`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-176](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-176>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-176.txt>).

**Requirements read:**

- 1. Selecting a phone column exposes its properties without traversing the full list; return preserves the list position.
- 2. Identify the selected column beside its property controls.
- 3. Keep navigation compact and properties adjacent or inline where space allows. Search is optional; traversing the full grid must not be required.
- 4. Preserve column identity, order, visibility, alignment, total settings, preview, saving and navigation with unsaved changes.
- 5. Check first/middle/last, hidden and long-name columns at all three widths. Preserve readable text, focus continuity and adequate touch targets.
- 6. Edited values and preview remain tied to the intended column. Do not silently save or discard changes.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/config/DebitNoteTemplateEditorPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/DebitNoteTemplateEditorPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Selecting a column should immediately expose adjacent or inline properties; retain selected identity and draft order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-177"></a>

### KP-177 — Prioritize supplier debt lookup on the payables page

**Source file:** [TODO/20260914_P3_QA-095_enhancement-prioritize-supplier-debt-lookup-on-the-payables-page.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-095_enhancement-prioritize-supplier-debt-lookup-on-the-payables-page.docx>)

**Source title (verbatim):** Prioritize supplier debt lookup on the payables page

**SHA-256:** `7495ed98caf215c27dd3c55f899662ef4129cd2e1767fc997006cf3cd5490976`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-177](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-177>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-177.txt>).

**Requirements read:**

- 1. At desktop, tablet and phone widths, the initial view prioritizes debt totals, supplier search and available supplier records.
- 2. Keep invoice capture and lookup easy to open, with concise invoice counts when useful. Do not preserve or introduce internal approval queues or gates.
- 3. Use one concise empty message. Reduce repeated tiles, nested containers and excess spacing without enlarging components or shrinking readable text.
- 4. Preserve supplier filters, relevant invoice search, balances, aging categories, ordinary role access and navigation to invoice and supplier detail views.
- 5. Verify empty and populated invoice states with a populated supplier queue; preserve keyboard navigation, visible focus and adequate phone touch targets.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/PayableListPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/PayableListPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Prioritize supplier balance, search and records; place fuel invoices in a secondary tab/disclosure and show one empty-state message.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-178"></a>

### KP-178 — Align profit metrics for compact customer comparison

**Source file:** [TODO/20260914_P3_QA-096_enhancement-align-profit-metrics-for-compact-customer-comparison.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-096_enhancement-align-profit-metrics-for-compact-customer-comparison.docx>)

**Source title (verbatim):** Align profit metrics for compact customer comparison

**SHA-256:** `f3fc5a7edadb87c94ec314c89e650d3f2c5b68e577d942fe4b6bac7bdc1d3f99`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 2.

**Delivery:** [KP-178](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-178>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-178.txt>).

**Requirements read:**

- 1. At wide widths, align comparable amounts beneath shared headings or an equally clear compact row structure.
- 2. Keep customer identity and source links available without duplicating a large label inventory for every record.
- 3. At tablet and phone widths, adapt to available space without squeezing seven unreadable columns. Preserve clear label/value associations and compact spacing.
- 4. Verify long names, long source lists, large or negative amounts, zero values and unavailable margins; keep units and signs intact.
- 5. Preserve financial calculations, analysis selection, low-margin filtering, exports and authorized source navigation. Check readable text, keyboard focus and adequate touch targets.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/components/finance/ProfitabilityReportPanel.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/finance/ProfitabilityReportPanel.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Use shared financial column headings at wide widths and compact labelled rows on narrow screens; preserve source links and signs.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-179"></a>

### KP-179 — Distinguish adjacent currency labels on financial chart axes

**Source file:** [TODO/20260914_P3_QA-097_bug-distinguish-adjacent-currency-labels-on-financial-chart-axes.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-097_bug-distinguish-adjacent-currency-labels-on-financial-chart-axes.docx>)

**Source title (verbatim):** Distinguish adjacent currency labels on financial chart axes

**SHA-256:** `9fd7fd384f1bb9699125a960082cacf445394b05cffb7d93e0c27dad4d371fbc`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-179](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-179>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-179.txt>).

**Requirements read:**

- 1. Distinct Y-axis positions have distinguishable monetary meanings; the captured repeated “1tr₫” and “2tr₫” captions no longer make adjacent grid lines ambiguous.
- 2. Apply a consistent Vietnamese currency/unit policy with enough precision for the active scale. Keep exact tooltip values and chart data consistent with that policy.
- 3. Verify zero, small, million-scale and larger values, plus day/month views. Negative values, if supported, remain correctly signed. Do not alter financial records to fix presentation.
- 4. Check Accountant and Manager views at phone, tablet and desktop widths. Keep tick labels readable without overlap, excessive decimals or oversized chart/text.

**Existing behavior / assessment:** The historical chart shows duplicate adjacent currency labels. Current raw tick values were not exercised in this pass.

**Connected current-source evidence:**

- [frontend/src/components/charts/RevenueTrendChart.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/components/charts/RevenueTrendChart.tsx:1>) — Finance chart implementation.

**Missing, contradicted or unproven:**

- The historical chart shows duplicate adjacent currency labels. Current raw tick values were not exercised in this pass.

**Target behavior / next work:**

- Choose tick intervals and precision together so distinct tick values format distinctly; retain exact tooltip values.

**Required independent checks:**

- Zero, small, million-scale and large values; negative values if supported; day/month at all widths; no data changes.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-180"></a>

### KP-180 — Show CUS shipment records sooner with compact filters

**Source file:** [TODO/20260914_P3_QA-098_enhancement-show-cus-shipment-records-sooner-with-compact-filters.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-098_enhancement-show-cus-shipment-records-sooner-with-compact-filters.docx>)

**Source title (verbatim):** Show CUS shipment records sooner with compact filters

**SHA-256:** `193f17aafeb3c7c6df3a32f4c79f555024575e355ccb4574252016f4610db614`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-180](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-180>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-180.txt>).

**Requirements read:**

- 1. Reduce space above phone/tablet records while keeping search and primary actions reachable. Secondary filters use a named, discoverable control.
- 2. When collapsed, show active-filter counts and selected values. Reopening preserves selections; users can identify and remove active criteria.
- 3. Preserve delivery/transport date meanings, ranges and Hôm nay/Hôm sau/Tất cả behavior. Keep all-dates and reset state clear, distinct from the global reporting month.
- 4. Preserve search/apply behavior, options, creation/export, summaries and pagination. Rearranging controls must not silently apply or discard criteria.
- 5. Use compact aligned desktop controls and a single filter surface, without nested cards or oversized text. Preserve readable labels and adequate touch targets.
- 6. Verify active filters, long labels, empty results and expanded controls at all widths, with keyboard focus, disclosure state and logical navigation.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/features/shipments/cus/CusContainerLedger.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/shipments/cus/CusContainerLedger.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Use one compact filter surface with primary search; place secondary filters in a disclosure that retains active criteria and date meanings.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-181"></a>

### KP-181 — Keep the driver creation footer compact on phones

**Source file:** [TODO/20260914_P3_QA-099_enhancement-keep-the-driver-creation-footer-compact-on-phones.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-099_enhancement-keep-the-driver-creation-footer-compact-on-phones.docx>)

**Source title (verbatim):** Keep the driver creation footer compact on phones

**SHA-256:** `1beb980d6090ae490ee5bbc675ce58af6fc91eed39029ba01d6cc2074a27aee9`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-181](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-181>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-181.txt>).

**Requirements read:**

- 1. At supported phone widths, the required-field hint remains readable without forming a narrow word column beside the actions.
- 2. Place the hint separately where needed; keep Hủy and Thêm lái xe in a compact, balanced action row with adequate touch targets around 44 pixels.
- 3. Do not enlarge text, fields or the footer to resolve the layout. Retain readable labels, button states and access to the final form fields.
- 4. Preserve required-field validation, disabled submission, cancel behavior and logical keyboard focus. Verify long labels and validation messages.
- 5. Check 360, 390 and 430-pixel phones plus tablet and desktop; no overlapping content, horizontal overflow or obscured footer actions.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/features/fleet/DriverFormModal.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/fleet/DriverFormModal.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Separate the required-field hint from the phone action row; provide 44px touch targets without stretching buttons to 75px height.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-182"></a>

### KP-182 — Show nonempty accounting queues before large empty sections

**Source file:** [TODO/20260914_P3_QA-101_enhancement-show-nonempty-accounting-queues-before-large-empty-sections.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-101_enhancement-show-nonempty-accounting-queues-before-large-empty-sections.docx>)

**Source title (verbatim):** Show nonempty accounting queues before large empty sections

**SHA-256:** `5da1508e53a232ac1c178ade313c171b03c4fc24d383933777a847a56a1008a6`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-182](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-182>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-182.txt>).

**Requirements read:**

- 1. Use a compact empty state so the first nonempty queue and more of its first record appear sooner; avoid a large empty card or duplicate message.
- 2. Retain relevant counts, refresh controls, record identities, data or processing blockers and valid direct actions. Distinguish actionable records from records missing required information.
- 3. Handle both queues populated, both empty, loading and errors without hiding status or causing disruptive focus or scroll jumps.
- 4. At all three widths, keep text readable, controls easy to touch and keyboard accessible, and desktop rows compact. The layout must support the workflow without internal reviewer or approver queues.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/features/accounting/AccountingWorkInbox.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/features/accounting/AccountingWorkInbox.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Show nonempty work queues first and concise empty buckets; preserve stable focus, counts and meaningful data blockers.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-183"></a>

### KP-183 — Prioritize account ledgers with compact debt summaries

**Source file:** [TODO/20260914_P3_QA-102_enhancement-prioritize-account-ledgers-with-compact-debt-summaries.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-102_enhancement-prioritize-account-ledgers-with-compact-debt-summaries.docx>)

**Source title (verbatim):** Prioritize account ledgers with compact debt summaries

**SHA-256:** `5a228ae439b5c86fafce87749b13135177c2d8e33be27ec3b60aa822fdeaa702`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-183](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-183>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-183.txt>).

**Requirements read:**

- 1. Combine repeated summary values and risk information into a compact region. Show meaningful warnings immediately; make all aging buckets and explanatory details easy to expand.
- 2. In the observed fixtures, expose ledger navigation and core filters within the initial phone and tablet viewport. Avoid nested summary cards and dedicated tall cards for empty aging buckets.
- 3. Keep period selection and transaction filters in a compact coherent toolbar. Preserve current versus period balances, dates, account context and active filter values.
- 4. Retain aging drilldowns, payment and statement actions, permissions and transaction content. This change must not alter financial calculations or hide overdue balances.
- 5. Verify empty, single-bucket and mixed-aging accounts at all three widths. Maintain readable figures, visible focus and approximately 44-pixel phone touch targets without oversized headings or fields.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/DebtDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/DebtDetailPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Use compact identity, balance and risk summaries with an aging disclosure; put ledger filters in the first viewport and share the pattern with PayableDetailPage.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-184"></a>

### KP-184 — Make Ops work queue records easier to scan

**Source file:** [TODO/20260914_P3_QA-103_enhancement-make-ops-work-queue-records-easier-to-scan.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-103_enhancement-make-ops-work-queue-records-easier-to-scan.docx>)

**Source title (verbatim):** Make Ops work queue records easier to scan

**SHA-256:** `74f414a8d3da3843ab160487959270db74700ee3ffb676b7e3351ee4efaaed88`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-184](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-184>) in [WP26](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp26>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-184.txt>).

**Requirements read:**

- 1. Materially reduce the captured 410–430 px card height without shrinking readable text or touch controls; show more of the work list in the same viewport.
- 2. Keep shipment and container identity, driver, vehicle, meaningful milestones, blocker ownership, update time and valid next action available and clearly related.
- 3. Avoid repeating the same identity in the header and information area; group secondary details without obscuring blockers or the primary action.
- 4. Verify active, waiting and terminal records, long names and multiple containers at all three widths. Preserve keyboard access, permissions and the compact desktop table.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/OpsOrdersPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/OpsOrdersPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Show identity, vehicle, blocker and next action once; keep milestones compact and preserve the desktop comparison table.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-185"></a>

### KP-185 — Keep the company profile editor and save action together

**Source file:** [TODO/20260914_P3_QA-106_enhancement-keep-the-company-profile-editor-and-save-action-together.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-106_enhancement-keep-the-company-profile-editor-and-save-action-together.docx>)

**Source title (verbatim):** Keep the company profile editor and save action together

**SHA-256:** `db882f91fc08d39db96dde54a2ee90ec98adb38b890f2668d7ed3eda93afa3a4`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-185](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-185>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-185.txt>).

**Requirements read:**

- 1. Save is reachable directly from the editable form without traversing a permanently expanded duplicate profile; keep its state and validation feedback clear.
- 2. If comparison is useful, make it optional and explicitly identify saved and draft values. Preserve all company, contact, bank and logo controls.
- 3. Use available width for long fields, compact related groups and appropriate field heights. Avoid extra nested cards and large blank gaps.
- 4. Verify populated, blank and invalid drafts at all three widths, with readable labels, usable touch targets, keyboard order and visible validation. Preserve permissions, values and saving behavior.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/config/CompanyInfoConfigPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/config/CompanyInfoConfigPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Place Save beside editable fields. Offer an optional explicit saved-versus-draft comparison instead of a permanent duplicate profile.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-186"></a>

### KP-186 — Keep empty ancillary services below core trip information

**Source file:** [TODO/20260914_P3_QA-109_enhancement-keep-empty-ancillary-services-below-core-trip-information.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-109_enhancement-keep-empty-ancillary-services-below-core-trip-information.docx>)

**Source title (verbatim):** Keep empty ancillary services below core trip information

**SHA-256:** `a1928bb2cac57044dcedf76f9cbcb5480e340b986fc627f028d60a2dbebfaac6`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-186](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-186>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-186.txt>).

**Requirements read:**

- 1. At desktop and tablet widths, core trip facts precede the empty ancillary-services section. Preserve the phone view’s useful basic-information-first order.
- 2. Replace the large empty illustration panel with a compact descriptive row or disclosure. Avoid a fixed tall blank section when no services exist.
- 3. Keep existing service entry points easy to find. Populated services must retain their descriptions, amounts, editing access and relevant billing links.
- 4. Keep trip identity, status and primary actions prominent. Preserve vehicle, driver, trailer, dates, container information and financial figures.
- 5. Verify trips with zero, one and several services at all three widths. Use readable type, compact spacing, keyboard access and appropriate phone touch targets; do not change service calculations or introduce approval steps.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/TripDetailPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripDetailPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Place core facts before optional services; show empty services as a compact row; retain populated-service actions and the existing phone order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-187"></a>

### KP-187 — Keep fleet trailer identifiers intact at tablet widths

**Source file:** [TODO/20260914_P3_QA-111_bug-keep-fleet-trailer-identifiers-intact-at-tablet-widths.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-111_bug-keep-fleet-trailer-identifiers-intact-at-tablet-widths.docx>)

**Source title (verbatim):** Keep fleet trailer identifiers intact at tablet widths

**SHA-256:** `e68039696238b19682521998c243123bfb7b93d802982624562f622270f46de8`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-187](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-187>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-187.txt>).

**Requirements read:**

- 1. RM, 40FT and equivalent short type labels do not split character by character. Trailer plates remain intact and easy to compare.
- 2. When space requires multiple lines, wrap between complete identifier and type units. Avoid a miniature card or excessive padding inside the table cell.
- 3. Keep the relationship between truck, trailer, assigned driver and tire action clear. Preserve stored values and existing navigation.
- 4. Verify common and longer plate formats, missing trailer/type data and narrow tablet breakpoints, plus desktop and phone. Preserve compact rows, readable typography and visible keyboard focus.
- 5. Do not solve the issue by hiding meaningful type information, reducing text to an unreadable size or making the whole table unnecessarily wide.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/FleetPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FleetPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Wrap between whole trailer plate/type tokens; avoid nested badge padding and character-by-character breaks.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-188"></a>

### KP-188 — Make fleet summary breakdowns readable on phones

**Source file:** [TODO/20260914_P3_QA-112_bug-make-fleet-summary-breakdowns-readable-on-phones.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-112_bug-make-fleet-summary-breakdowns-readable-on-phones.docx>)

**Source title (verbatim):** Make fleet summary breakdowns readable on phones

**SHA-256:** `725d6eac834f622f3451ca9f702072903d7eefdaf34a5036574f271c0b87a630`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 1.

**Delivery:** [KP-188](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-188>) in [WP27](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp27>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-188.txt>).

**Requirements read:**

- 1. Every count and category forms a clearly separated readable group. No trailing label or value is clipped or concatenated with its neighbor.
- 2. Wrap between complete groups and allow the card to fit its content. Maintain concise spacing and a consistent breakdown layout across all four fleet summaries.
- 3. Keep headline counts readable and unchanged. Do not suppress unknown-type categories or alter classifications to make the layout fit.
- 4. Verify zero values, longer labels, larger counts and text zoom at phone, tablet and desktop widths. Avoid overlapping decorative graphics and preserve readable text.
- 5. Keep the summaries compact and the vehicle list close beneath them. This is a layout fix, not a change to fleet aggregation or assignment rules.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/FleetPage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/FleetPage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Keep each count/category pair together when wrapping; preserve the unknown category and compact vehicle list.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-189"></a>

### KP-189 — Prioritize required trip fields with compact estimate and progress summaries

**Source file:** [TODO/20260914_P3_QA-120_enhancement-prioritize-required-trip-fields-with-compact-estimate-and-progress-summaries.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-120_enhancement-prioritize-required-trip-fields-with-compact-estimate-and-progress-summaries.docx>)

**Source title (verbatim):** Prioritize required trip fields with compact estimate and progress summaries

**SHA-256:** `cc04995e41d75837ebba6a727f7732cc015cda6a5972022ebfa3fd6e752f9158`

**Claimed folder:** TODO. **Audit:** OPEN_RETEST_REQUIRED. **Source priority:** P3. **Images:** 3.

**Delivery:** [KP-189](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-189>) in [WP25](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp25>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-189.txt>).

**Requirements read:**

- 1. Place the first required fields close to the form introduction on desktop and tablet; avoid a large stacked summary block before data entry.
- 2. Use a concise estimate and progress treatment with access to complete costs, revenue and completion details. Preserve all values and calculation behavior.
- 3. Keep required-field feedback and the create/cancel actions easy to find. Retain a logical keyboard order and visible focus.
- 4. Preserve the phone’s field-first ordering. Use readable type, compact spacing and suitable touch targets without enlarging headings or adding nested decorative cards.
- 5. Verify empty, partially completed and completed forms at all three widths. Summary updates and validation must remain understandable without covering fields or hiding errors.

**Existing behavior / assessment:** Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Connected current-source evidence:**

- [frontend/src/pages/TripCreatePage.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/TripCreatePage.tsx:1>) — Implementation entry point, not a claimed current pixel measurement

**Missing, contradicted or unproven:**

- Historical rendered finding remains in TODO. Current implementation entry point located; exact geometry and current responsive completion are not independently remeasured in this pass.

**Target behavior / next work:**

- Place required fields first on desktop/tablet; keep estimate/progress adjacent or collapsible, preserving the existing phone order.
- Implement the complete source acceptance criteria; reproduce before editing and reuse shared layout primitives.

**Required independent checks:**

- Source fixture at 390×844, 834×1112 and 1440×900; 360/430px and 1024px boundary; 200% zoom; long, empty, loading and error states; keyboard/touch; persisted values unaffected.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-190"></a>

### KP-190 — Restore the repository context resolver on a clean checkout

**Source file:** [TODO/20260914_P3_QA-136_tech-debt-restore-the-repository-context-resolver-on-a-clean-checkout.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/20260914_P3_QA-136_tech-debt-restore-the-repository-context-resolver-on-a-clean-checkout.docx>)

**Source title (verbatim):** Restore the repository context resolver on a clean checkout

**SHA-256:** `dcc2591aa8ad9819e8f067a402e6783674dd90dd4e02bc8d227b06c597e7676b`

**Claimed folder:** TODO. **Audit:** NOT_IMPLEMENTED. **Source priority:** P3. **Images:** 0.

**Delivery:** [KP-190](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-190>) in [WP01](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp01>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-190.txt>).

**Requirements read:**

- 1. Context validation succeeds on a fresh checkout with documented setup only.
- 2. Frontend and backend profiles resolve existing sources even when optional local QA or plan artifacts are absent.
- 3. Add a clean-checkout fixture covering missing optional and invalid required references.

**Existing behavior / assessment:** The context checker was executed at the current HEAD and fails on the missing roadmap plan and QA README before profile resolution.

**Connected current-source evidence:**

- [.codex/context-manifest.json](</Users/frank.nguyen/Documents/silversea/codebase/.codex/context-manifest.json:21>) — Missing referenced paths.
- [scripts/context-for.mjs](</Users/frank.nguyen/Documents/silversea/codebase/scripts/context-for.mjs:140>) — Global validation before profile resolution.

**Missing, contradicted or unproven:**

- The context checker was executed at the current HEAD and fails on the missing roadmap plan and QA README before profile resolution.

**Target behavior / next work:**

- Correct stale required paths, or mark intentionally optional references as optional. Do not disable all validation.
- Keep frontend/backend profiles narrow and resolvable on a fresh checkout.

**Required independent checks:**

- Clean-checkout context check and frontend/backend profile resolution; invalid required reference fails; missing optional reference does not break an unrelated profile.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.

<a id="kp-191"></a>

### KP-191 — Latest driver detail field and invoice requirements

**Source file:** [TODO/P0_Mobile_Lai xe role man hinh chi tiet.docx](</Users/frank.nguyen/Documents/silversea/codebase/docs/Kanban-PROD/TODO/P0_Mobile_Lai xe role man hinh chi tiet.docx>)

**Source title (verbatim):** Lai xe role, man hinh chi tiet

**SHA-256:** `1019218b72eb55ae82c9b217a892e3ad1ee2a81b4f366e6dd96c62c9e885d11c`

**Claimed folder:** TODO. **Audit:** PARTIAL. **Source priority:** P0. **Images:** 5.

**Delivery:** [KP-191](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#kp-191>) in [WP11](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_Implementation_Plan.md#wp11>). [Recovered complete source text](</Users/frank.nguyen/Documents/silversea/TODO/20260914_KANBAN_PROD_EVIDENCE/source-text/KP-191.txt>).

**Requirements read:**

- Consolidate contactname/phone directlybelowaddress under Số điện thoại liên hệ.
- Render eachnumber pairedwithitstype;avoidambiguousaggregate mapping for multiplecontainers.
- IMPORT hạmeans empty-returndepot;remove redundantreturnrow for thatdirection;retain actualotherstopdata.
- Separate uppercase tasktags anddrivernotes;correctinvoicepartyheadingsbeforefields.

**Existing behavior / assessment:** All five embedded images were inspected. The contact label was partially changed, but duplicate contact rows, separate number/type aggregation and return-depot semantics remain. The invoice block exists, but the customer heading follows its fields.

**Connected current-source evidence:**

- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:82>) — Aggregates container numbers separately from their types.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:133>) — Contact phone followed by another contact section.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:143>) — Drop destination and conditional empty-return destination.
- [frontend/src/pages/driver/DriverTaskInfoSections.tsx](</Users/frank.nguyen/Documents/silversea/codebase/frontend/src/pages/driver/DriverTaskInfoSections.tsx:196>) — Invoice party heading/field ordering.

**Missing, contradicted or unproven:**

- All five embedded images were inspected. The contact label was partially changed, but duplicate contact rows, separate number/type aggregation and return-depot semantics remain. The invoice block exists, but the customer heading follows its fields.

**Target behavior / next work:**

- Consolidate contact name and phone directly below the address under “Số điện thoại liên hệ”.
- Render each container number paired with its type; avoid ambiguous aggregate mapping for multiple containers.
- For IMPORT, “Hạ” means the empty-return depot. Remove the redundant return row for that direction while retaining actual other-stop information.
- Separate uppercase task tags and driver notes; place each invoice party heading before its fields.

**Required independent checks:**

- All five image requirements; IMPORT/EXPORT/LCL; multiple containers; missing or distinct contacts; same or distinct depot; populated factory/customer invoice identities; phone/tablet/desktop.

**Closure-claim review:** Read complete source ticket including appended claims. Current source inspected where references below specify a behavior; cited historical staging screenshots are not treated as current execution. QA evidence directories named in closures are absent from this checkout.
