#!/usr/bin/env node
// Frontend structure guard — the "god files stay dead" ratchet, as a plain
// node script (card 20261003_308). The pre-commit hook used to boot a full
// vitest environment just for this check, holding .git/index.lock for
// minutes per commit; the same four checks run here in ~0.1s. The vitest
// suite `src/tests/structure.guard.test.ts` is a thin wrapper that spawns
// this file, so CI keeps covering the exact code the hook runs.
//
// Ratchet rule (unchanged): FROZEN_MAX_LOC may only SHRINK (regenerate a
// smaller entry after a split lands). Growing or adding an entry is a
// contract change reviewed like one. Baseline history comments move with
// the map, verbatim from the former suite.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const NEW_FILE_MAX_LOC = 400;

const FROZEN_MAX_LOC = {
  'src/design-system/forms/SearchableSelect.tsx': 481,
  // Added as baseline 455 (was new-file capped): 2026-09-22 card 20260922_4 —
  // the searchable-family bare-Enter commit adds a capture-phase Enter branch
  // beside Escape in ComboBoxValue (explicit-navigation tracking, unique-match
  // commit, auto-highlight drop) plus the onEnterCommit prop plumbing. The
  // pre-existing 09-07/09-08 combobox baselines live under the workspace
  // entry below; this file's own growth is refrozen here. Reviewed as a
  // contract change; a future split (extract the keydown-capture handlers)
  // should restore a smaller ceiling.
  // 26/09: invalid-focus red outline ternary (error-wins-over-focus contract)
  // 03/10: card 20261002_272 — the paired-field Tab hand-off (onReady handle
  //  via ComboBoxStateContext + the openApiRef plumbing) landed +19 over the
  //  frozen 467; refrozen 467→486, shrink candidate (extract the handle into
  //  a hook).
  'src/components/untitled-ui/base/select/combobox.tsx': 486,
  // Bumped 650 -> 656: ticket 365943ea - factoryShortName and operationalNotes fields
  // Bumped 656 -> 679: 2026-09-11 trip-detail polish — wire gains
  // factoryAddress / khoPhone / invoiceMaster / knownTagLabels and their
  // fulfillment mapping.
  // Bumped 679 -> 684: e-POD thumbnails — downloadPodFile client method.
  // Bumped 684 -> 691: 2026-09-11 prod-merge redo — union of the pair/ad-hoc
  // card fields (T7 label, pairKind/pairOrder/pairLocked) with the
  // tag-pool/trip-detail polish client. Reviewed as a contract change.
  'src/api/driverClient.ts': 691,
  // Bumped 562 -> 600: 2026-09-22 phoi-phieu stack closeout (b8b4dffb) — the
  // qk factory gains the phoiPhieu/depositTracker/invoiceTracking and
  // accounting.debitBoard groups (lint rider: inline keys centralized).
  // Split candidate: per-domain key files composed into qk like the expense
  // and shipment-debit groups.
  // Bumped 600 -> 602: 2026-09-23 card 20260923_1 — the drawer-ops batch
  // (cd862de4) repaired a merge slip in the shipment key tuple
  // (`'tires',, 'quotations'` → one key per line), which costs the two lines
  // the old ceiling did not carry. Split candidate unchanged.
  // Bumped 602 -> 604: 2026-09-23 card 20260923_5 — the silent-409 toast fix
  // (d9e7e2ee) maps the remove-container rejection to a typed error branch in
  // the query keys module. Split candidate unchanged.
  // Bumped 604 -> 606: 2026-09-27 lint sweep (@tingting/no-bare-query-key) —
  // the last inline page keys move into the composed ./pageQueryKeys domain
  // (one import + one spread are the only lines keys.ts grows). Split
  // candidate unchanged: further domains should keep landing there.
  'src/api/keys.ts': 606,
  // Added as baseline 460 (was new-file capped): 2026-09-22 — card 18's
  // combined-invoice tracking page landed over the ceiling without a
  // baseline; refrozen here to unblock cut #24. Split candidate.
  // Added as baseline 440 (was new-file capped): 2026-09-23 card 20260922_56 —
  // the quotation config screen (filters + frame list + live 10-column grid)
  // landed over the ceiling without a baseline; the update-payload and fee
  // routing follow-ups completed it. Refrozen here to unblock cut #7.
  // Split candidate: extract the live-grid table into its own component.
  'src/pages/config/QuotationConfigPage.tsx': 440,
  // Added as baseline 460 (was new-file capped): 2026-09-22 card 20260922_56's
  // sibling invoice surface — refrozen here to unblock cut #24. Split candidate.
  'src/pages/AccountingInvoiceTrackingPage.tsx': 460,
  // Added as baseline 414 (was new-file capped): 2026-09-21 card 20260921_2 -
  // the CUS detail hook gains addContainer/removeContainer row mutations
  // beside the existing per-mode edit sessions. A future split should
  // extract the mutation family and restore a smaller ceiling.
  'src/features/shipments/cus/use-cus-detail.ts': 414,
  // Added as baseline 432 (was new-file capped): 2026-09-10 T4 — the page
  // mounts DebitNoteFreightOverride (financial trio) reading the detail's
  // freightRate.latest snapshot view.
  'src/pages/ShipmentDetailPage.tsx': 432,
  // Added 2026-09-07: baseline 401 (was new-file capped) — the atomic plan
  // save now carries operationalNotes and the tag-pool client helpers
  // (list/create) live here beside the other dispatch planning calls.
  // Bumped 410 → 430: 2026-09-08 external-carrier staff close — the client
  // gains completeDispatchExternalTrip beside the other dispatch planning
  // calls, and DispatchDetailPlanRow.taskStatus gains 'COMPLETED'.
  // Reviewed as a contract change. 2026-09-12: the 450 decompose bump was
  // reverted by extracting the client to dispatchDetailBranch.ts (ticket
  // 2026.9 (1)._4 item 7) — ceiling restored to 430.
  // Bumped 430 → 441: 2026-09-14 appointment-minutes fix — detail-plan rows
  // gain the runAt iso field (coalesced time source) so the grid can sort and
  // render minutes off one timestamp. Reviewed as a contract change; a future
  // split should restore a smaller ceiling.
  // Bumped 441 → 444: 2026-09-22 card 20260922_32 — the detail-plan filter
  // interface gains the dateFrom/dateTo range fields (wire half of the
  // month-scope feature). Reviewed as a contract change.
  'src/api/dispatchPlanningClient.ts': 449,
  // Bumped 400 (new-file) → 430: 2026-09-07 dropdown-flip sweep — the
  // multi-select picker gained selectionLabel + onSearchChange (aria names
  // and debounced server refetch) during the facet migration. Reviewed as a
  // contract change; a future split (extract the popover body) should
  // restore a smaller ceiling.
  'src/design-system/forms/SearchableMultiSelect.tsx': 433,
  // Bumped 1099 → 1110: minor growth from added keyboard helpers and
  // dispatch-status normalization (18539e54 + cec0f963, 2026-09-05).
  // Reviewed as a contract change; a future split should restore a smaller
  // ceiling.
  // Raised 1118 → 1119: pairKind tag source on the detail containers payload
  // (LoHangKepKetHop §3.2, 2026-09-09). Reviewed as a contract addition; a
  // future split should restore a smaller ceiling.
  // Bumped 1119 → 1159: 2026-09-10 pricing engine — Shipment gains isAdHoc
  // and ShipmentDetail gains the freightRate.latest snapshot view (T4/T7).
  // Bumped 1159 → 1201: 2026-09-18 card 20260918_18 — the settlement L2
  // workspace client contract (detail + idempotent edits).
  // Bumped 1201 → 1232: 2026-09-18 card 20260918_19 — the lock and cost-adjustment
  // client functions (snapshot contract).
  // Shrunk 1232 → 1102: 2026-09-18 wave-end debt pass — the settlement
  // contracts extracted to src/api/shipmentDebit.ts (re-exported).
  // Bumped 1102 -> 1105: 2026-09-19 card _5 — declaration channel field on
  // the request type (additive optional, FE half of the BE contract).
  // Bumped 1105 -> 1143: 2026-09-21 card 20260921_2 - add/remove container
  // row clients beside the CUS workspace line-update call.
  // Bumped 1143 -> 1146: 2026-09-22 lint rider (LEAD) — residual growth
  // swept in with the 22_4 wave's client work; shrink candidate.
  // Bumped 1146 -> 1154: 2026-09-25 card 20260925_5 (FE) — the allocation
  // filter contract gains the ShipmentAllocationFilter type + doc comment;
  // shrink candidate.
  // 2026-10-03 settlement addendum: the 263 FE landing's delete-client fn
  //  landed +10 over the frozen 1154 (guard was tree-blocked by foreign
  //  WIP at the time); refrozen 1154→1164, shrink debt on the tech-debt
  //  ledger.
  'src/api/shipmentClient.ts': 1164,
  // Bumped 717 -> 784: 2026-09-20 card _37/_43 billing-gate scope — the
  // document builder grew with the billing readiness gate work.
  'src/components/billing/BillingDocumentBuilder.tsx': 784,
  // Raised 843 → 856: the CUS + dispatcher sidebar catalog entries
  // (e69e67a7, effdf61f) shipped past the old ceiling. Reviewed as nav
  // additions; a future sidebar split should restore a smaller ceiling.
  // Bumped 870 → 879: 2026-09-14 wrong-current-password field
  // handling — ref + field-error announce in the change-password dialog.
  // Reviewed as a contract change.
    'src/components/Layout.tsx': 879,
  'src/components/trip/AncillaryFeesCard.tsx': 607,
  'src/components/trip/ContainerInstancesCard.tsx': 591,
  // Bumped 585 → 720: 2026-09-13 driver attachments unification — the card
  // absorbs the deleted DriverDeliveryNoteCard (single photo block: note
  // capture moves in, scanner renders in both states) and mounts the shared
  // PhotoViewer with focus restore for full-image viewing. Reviewed as a
  // contract change; a future split (extract the photo block) should restore
  // a smaller ceiling.
  'src/components/trip/DriverContainerCard.tsx': 738,
  // Baseline 410 (was new-file capped): e-POD photos now render as tappable
  // thumbnails opening the fullscreen viewer — thumbnail state/effect + the
  // render branch live beside the upload lifecycle they serve.
  // Bumped 410 → 423: 2026-09-16 unified-datetime patch batch — POD submission
  // gains the shared datetime adapter wiring.
  'src/components/trip/TripPodSubmission.tsx': 423,
  'src/components/trip/ShipmentCostEntryForm.tsx': 522,
  // 2026-09-24 card _24 sweep part 2: +3 for disabled-button reason captions (silent-disable anti-pattern)
  'src/components/UI.tsx': 668,
  'src/components/untitled-ui/base/badges/badges.tsx': 416,
  // Bumped 485 → 493: 2026-09-14 order-exchange refresh — the trip detail
  // refetch after a confirmed exchange adds the confirmed-state fact rows.
  // Reviewed as a contract change.
  // Bumped 493 → 499: 2026-09-14 expand dispute form to full row —
  // the Fragment wrapper and expanded <tr> for the discrepancy editor
  // add 6 lines over the previous inline-in-cell layout.
  // Reviewed as a contract change.
  'src/components/work-inbox/RoleWorkInbox.tsx': 499,
  // Bumped 431 → 444: 2026-09-14 duplicate-month picker guard —
  // taken months warn before submit (rework of the staging round-5 loop).
  // Reviewed as a contract change.
    'src/features/app-settings/FinancePolicySection.tsx': 444,
  'src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx': 445,
  // Baseline 407 (was new-file capped 400): 2026-09-14 header sort direction —
  // both sortable headers gain aria-sort + flipping ▲/▼ glyphs, and rows key
  // on a stable identity helper (branch rows carry a null fulfillment id).
  // Bumped 435 → 439: 2026-09-15 multiline note-line spans (20260915_35).
    // Bumped 439 -> 450: 2026-09-23 P1 mount-resilience fix (a00e0a64) — the grid's
  // error branch became a cold-load-only path with a non-blocking refresh
  // banner; rows stay mounted through transient failures. Reviewed as a
  // contract change; a future split should restore a smaller ceiling.
  // Bumped 450 -> 451: 2026-09-26 visual sweep (case-QA-2026-09-26-02) — the
  // lot-banner close button swaps the U+2715 text glyph for the lucide X
  // icon (design law §1); the import is the added line. Reviewed as a
  // contract change.
'src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx': 455,
  // Bumped 691 → 705: 2026-09-07 driver-note composer — the dispatch edit
  // dialog gains the "Ghi chú tác vụ" section (draft field, save body,
  // re-anchor, and the DispatchTaskTagEditor mount). The composer itself is
  // a separate component; only wiring lives here. Reviewed as a contract
  // change; a future split (extract the whole notes section) should restore
  // a smaller ceiling.
  // Bumped 705 → 725: 2026-09-08 TC_COMB_01-03 — enforce 20ft container rule
  // for isCombined checkbox, disabling and tooltip title for 40ft/45ft containers,
  // atomic plan save guard. Reviewed as a contract change.
  // Bumped 725 → 745: 2026-09-08 external-carrier staff close — the cell
  // gains the "Hoàn thành" quick action (button + prop) and the issue chip
  // derives a completed state. Reviewed as a contract change.
  // Bumped 745 -> 789: ticket 8afc13a9 - carrier-less auto-load (Option B) + fleet error surfacing
  // Bumped 789 -> 792: EXTERNAL-pick on a carrier-less row now loads that carrier's vehicles (predicate fix)
  // Bumped 792 → 832: 2026-09-13/14 dispatch editor — carrier resolution by
  // linked plate (truck→carrier map promotes the pick, plate-compare key,
  // carrier-options fallback label) + the driver-acceptance chip derive.
  // Reviewed as a contract change; a future split (extract the carrier-link
  // resolution) should restore a smaller ceiling.
  'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx': 873,
  // Bumped 446 → 448: driver-note save now carries operationalNotes and the
  // optimistic row update refreshes notes.vehicleNote (2026-09-07). Reviewed
  // as a contract change.
  // Bumped 450 → 485: 2026-09-08 external-carrier staff close — the hook
  // gains completeExternalTrip (client call + optimistic row flip + typed
  // errors), mirroring issueOrder. Reviewed as a contract change.
  // Bumped 485 → 515: 2026-09-09 background auto-refresh table persistence
  // (preserves open carrier/vehicle dialog during 30s poll).
  // Bumped 515 → 540 on 2026-09-12 (ensureFulfillment decompose-then-edit),
  // returned to 515 the same day: the ensure logic extracted to
  // ensureFulfillment.ts — ticket 2026.9 (1)._4 item 7 DEBT CLEARED.
  // 2026-09-15 KP-018: filter/query contract extracted to detailPlanFilters.ts.
  // Bumped 515 → 518: 2026-09-16 card 20260916_9 — decompose re-keys the grid
  // row and unmounts the pressing editor cell; the hook now tracks the fresh
  // fulfillment id so the surviving cell auto-opens the editor.
  // Bumped 518 → 521: 2026-09-16 landing 2a5dd222 — customer-sort state on
  // the detailed-plan hook; refreeze owed by the growing lane (BE1).
  // Bumped 521 → 532: 2026-09-22 card 20260922_32 — the topbar month scope
  // wiring (initial range seeding + change effect) on the detailed-plan
  // hook. Reviewed as a contract change; a future split (extract the filter
  // state machine) should restore a smaller ceiling.
  'src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts': 532,
  'src/features/dispatch/master-plan/DispatchAllocationPopover.tsx': 454,
  'src/features/dispatch/master-plan/MasterPlanFilters.tsx': 735,
  // Bumped 508 → 520: 282fe386 (2026-09-05, "fix(dispatch): keep dispatched
  // and completed lots visible on the master plan") + b15dd696 added chip
  // rendering for dispatched/completed lots and a carrier-allocation column
  // that bumps the file by ~7 lines. Reviewed as a contract change because
  // the ratchet only shrinks under the original behaviour; a future split
  // should restore a smaller ceiling.
  // Bumped 520 → 585: 2026-09-09 note truncation and inline modal detail trigger.
  'src/features/dispatch/master-plan/MasterPlanGrid.tsx': 585,
  // First baseline 418 (was new-file capped): the trailer fleet totals
  // reconcile through an explicit unknown-type bucket (legend twins + KPI
  // meta), landing 2026-09-14.
  'src/features/fleet/trailer-card.tsx': 418,
  // Bumped 441 → 450: 2026-09-14 trailer selector wiring — the card builds
  // trailerOptions (ACTIVE-only + coupledToPlate hint) for the picker.
  'src/features/fleet/truck-card.tsx': 450,
  'src/features/penalties/components/PenaltyTable.tsx': 593,
  'src/features/recoverable-costs/RecoverableCostsWorkspace.tsx': 456,
  'src/features/salary-attendance/salary-attendance-components.tsx': 756,
  'src/features/salary-attendance/useSalaryAttendancePage.ts': 453,
  // Bumped 886 → 965: the file was already at 949 before the 2026-09-06
  // free-text work landed (cust-create wave + the inline customer/factory/
  // route/port dialog wiring pushed it past the original ceiling). The
  // current change re-homes the container-type dialog wiring into a
  // dedicated ContainerTypeCellPicker sub-component (+14 net lines) so the
  // workspace stops being the single source of every "add catalog" dialog.
  // Reviewed as a contract change because the ratchet only shrinks under
  // the original behaviour; a future split (extract `useCustomerDialog`,
  // `usePortDialog`, `useRouteDialog` into shared hooks) should restore a
  // smaller ceiling.
  // Bumped 965 → 970: 2026-09-07 type-to-search wave — the searchable
  // combobox props (Hãng tàu / Kho lấy hàng wiring) pushed the file two
  // lines past the ceiling. Reviewed as a contract change; a future split
  // (extract the container-table row) should restore a smaller ceiling.
  // Bumped 970 → 972: 2026-09-08 popover-flip regression (TC-CUS-CREATE-038)
  // — every SearchableField whose sibling sits below (Khách hàng, Hãng tàu,
  // Tuyến đường, Cảng nâng, Cảng hạ, Nhà máy LCL, Kho lấy hàng) gained
  // `popoverPlacement="top"` so the dropdown opens upward and never covers
  // the "+ Thêm" inline-create button. Net +2 lines (one `popoverPlacement`
  // prop per affected SearchableField, plus the prop forwarding plumbing in
  // USearchableField). Reviewed as a contract change; a future split should
  // restore a smaller ceiling.
  // Bumped 1080 → 1103: 2026-09-10 T4 — the live FreightPreviewCard mounts
  // in the workspace (first container row drives the engine input).
  // Bumped 1103 → 1104: 2026-09-16 unified-datetime patch batch (create-form
  // adapter wiring, one line over the T4 bump).
  // Bumped 1104 → 1131: 2026-09-17 bulk appointment copy (hover overlay +
  // copy helper + per-row gate, mirrors the CUS ledger affordance).
  // Bumped 1131 → 1132: 2026-09-17 compact pill redesign (Copy icon import).
  // Bumped 1132 → 1140: 2026-09-18 card 20260916_3 — the Lệnh chạy ngoài
  // intake toggle returns at the top of the create form (user ruling, label
  // without the retired suffix).
  // Bumped 1140 → 1143: 2026-09-18 card 20260916_3 — allowsCustomValue gates
  // on the four adhoc creatable fields (customer/route/factory/ports).
  // Bumped 1169 → 1174: 2026-09-18 card 20260918_16 — the factory-dropdown
  // fetch guard documents why a non-numeric customer id clears the list.
  // Shrunk 1174 → 1120: 2026-09-18 debt card D1 — the adhoc free-text
  // decision logic extracted to createAdhocFieldLogic.ts (factory over
  // injected callbacks; behavior pinned by the mode-toggle + clerk suites).
  // Bumped 1120 → 1123: 2026-09-20 card 20260920_13 — the adhoc-lot toggle
  // docks on the identity section header (eb27d82c); split debt tracked on
  // the D1 extraction note.
  // Bumped 1123 → 1130: 2026-09-20 card 20260920_26 — the row-cell "+ Thêm"
  // buttons move into the combobox listbox as a typed-text create option;
  // split debt tracked on the D1 extraction note.
  // Bumped 1130 → 1160: 2026-09-22 card 20260922_6 — the cược-container
  // deposit row docks under the identity grid (fca7be71); extraction of the
  // deposit fields into their own component rides the PhoiPhieu rework stack.
  'src/features/shipments/create/ShipmentCreateWorkspace.tsx': 1160,
  // Bumped 1143 → 1169: 2026-09-18 card 20260918_8 — row-tier creatable
  // factory/route cells (allowsCustomValue + raw passthrough updaters).
  // Bumped to 411: 2026-09-07 customer feedback — the per-row "Xác nhận"
  // action column (inline save) so the user no longer has to press Enter
  // or hunt for the header "Hoàn tất" button after typing a container
  // appointment. Reviewed as a contract change; a future split (extract
  // `useContainerLineDraft` so this becomes a thin presentational row)
  // should restore a smaller ceiling.
  // Bumped 411 → 460: 2026-09-08 TC_BTN_01-03 — visible inline Save (primary green)
  // & Cancel buttons next to appointment input, Enter/Escape handling,
  // success/error toast notifications. Reviewed as a contract change.
  // Bumped 460 → 530: 2026-09-08 external-carrier staff close — the CUS
  // ledger gains the Hoàn thành row action (button, confirm dialog, handler,
  // refetch hook). Reviewed as a contract change; a future split (extract
  // the external-trip close dialog) should restore a smaller ceiling.
  // Bumped 530 → 591: 2026-09-23 card 20260923_1 — the drawer owns the lot's
  // container composition again: the Thêm container form (fields, inline
  // validation, add API call, house UuiSelectField for loại cont) and the
  // per-row Xóa riding the cus-workspace add/remove endpoints, plus the
  // trip-attached disable. Reviewed as a contract change; split candidate:
  // extract the add-container form into its own component (the ledger is now
  // the largest CUS feature file).
  'src/features/shipments/cus/CusContainerLedger.tsx': 591,
  // Bumped 750 -> 852: 2026-09-21 card 20260921_2 - per-row add/remove
  // affordances and the inline add-row form on the container workboard.
  // Bumped 852 -> 858: 2026-09-22 card 20260922_3 — the container Xoa gains
  // the useConfirm danger dialog (confirm-before-delete, cross-cutting
  // card-20 rule). The whole confirm interaction is worth its lines; split
  // candidate logged for the wave-close notes.
  // Bumped 858 -> 859: 2026-09-22 — the ledger table's Thao tac column lands
  // its header/cell share (8e21fbdf); 1-line overage caught by the tree-wide
  // guard on the next landing. Shrink candidate routed to FE's test-debt batch.
  // Bumped 859 -> 866: 2026-09-22 card-22 family — the ledger's post-Thao-tac
  // growth (48beaea0 territory, 863L actual) refrozen so the next lane's
  // commit is not blocked; split candidate stands.
  // Bumped 866 -> 872: 2026-09-25 card 20260925_6 — the ledger vehicle editor
  // regains the NEW_EXTERNAL plate branch (quick-select restore); extraction
  // candidate stands (externalVendorPlateOptions already moved to its own lib).
  // Bumped 872 -> 873: 2026-09-26 card 20260925_9 — the add-container row's
  // native date input swaps to the shared BufferedUuiDateInput (import line);
  // net +1. Split candidate stands.
  // Bumped 873 -> 905: 2026-09-28 card 20260928_193 — column visibility returns
  // to the ledger (it was QA-passed on 2026-09-18 as card 20260917_4 and deleted
  // by 03d584ec the next day). The cost is the column table (8 keys), the
  // `hiddenColumns` prop and five `{!isHidden('…') && (…)}` wrappers on the
  // `<col>`/`SortHeader`/`<td>` triple — the conditional must wrap all three or a
  // `table-layout: fixed` table shows a ghost column. Split candidate stands and
  // is now the bigger one: the tbody cell groups are the extraction seam.
  'src/features/shipments/detail/ShipmentContainerLedger.tsx': 905,
  'src/features/tires/tire-controls.tsx': 527,
  'src/features/tires/tire-dialogs.tsx': 427,
  // Bumped 513 → 524: 2026-09-20 missing-ground-price chip (D2) — the 15T
  // revenue cell renders '—' + 'Thiếu giá 15T' chip + tooltip per the
  // CHANGELOG spec; cell branch + predicate import only, no new columns.
  'src/features/trips/tripColumns.tsx': 524,
  'src/features/users/components/UserEditPanel.tsx': 423,
  'src/features/users/components/UserTable.tsx': 603,
  // Bumped 609 → 650: 2026-09-14 trip-create atomicity — pre-create leg
  // validation (shared findInvalidLeg helper) + form-session idempotency key
  // with conflict regen. Reviewed as a contract change.
  'src/hooks/use-trip-form-submit.ts': 650,
  // Bumped 546 → 553: 2026-09-14 readiness includes leg validity (same
  // shared rule as submit) exposed to the action bar. Reviewed as a
  // contract change.
  'src/hooks/useTripFormDispatch.ts': 553,
  'src/pages/AdminAdvanceSettlementsPage.tsx': 609,
  'src/pages/AdminAdvancesPage.tsx': 564,
  'src/pages/AuditLogPage.tsx': 568,
  'src/pages/config/AppSettingsConfigPage.tsx': 571,
  'src/pages/config/CustomersConfigPage.tsx': 500,
  'src/pages/config/DebitNoteTemplateEditorPage.tsx': 421,
  'src/pages/config/PenaltyReasonsConfigPage.tsx': 537,
  'src/pages/config/RoutesConfigPage.tsx': 449,
  // Bumped 722 -> 807: 2026-09-20 card _37 — the owner's 13-criterion UX
  // overhaul (column selector, merged cells, bulk select, drawer, KPI
  // filters). Bumped 878 -> 948: bulk notify/status dialogs + BE drawer
  // histories wired. Split debt: CustomerFormModal (~350L) extraction
  // restores the ceiling.
  'src/pages/CustomersPage.tsx': 963,
  'src/pages/DashboardPage.tsx': 687,
  'src/pages/debt-detail-ledger.tsx': 444,
  'src/pages/DebtDetailPage.tsx': 816,
  'src/pages/DebtListPage.tsx': 548,
  // Bumped 623 -> 691: 2026-09-11 trip-detail polish — collapsible
  // operation chips, address-first Tuyến row, conditional Kho row, plate
  // rows removed, master invoice rows, Đóng/Trả header chip. Reviewed as a
  // contract change; a future split (extract the fact grid) should restore
  // a smaller ceiling.
  'src/pages/DriverTripDetailPage.tsx': 691,
  'src/pages/DriverTripPodPage.tsx': 520,
  // Bumped 702 → 704: 2026-09-23 Q10 deletion trail (card 20260922_78) —
  // ExpenseEntryPage gains the governed "Xóa phiếu chi" action wiring the
  // already-Q10-shaped governed-delete endpoint (reason prompt + Idempotency-Key
  // + If-Unmodified-Since). Reviewed as a contract change.
  'src/pages/ExpenseEntryPage.tsx': 704,
  // Bumped 987 → 999: 2026-09-14 chart empty-state three-way
  // branch — the no-trip message now keys on completed-trip presence with a
  // distinct completed-but-zero explanation. Reviewed as a contract change.
    'src/pages/FinancePage.tsx': 999,
  'src/pages/ForwarderSettlementCreatePage.tsx': 503,
  'src/pages/ForwarderTripDetailPage.tsx': 1107,
  'src/pages/PayableDetailPage.tsx': 608,
  'src/pages/PayableListPage.tsx': 680,
  'src/pages/payables-fuel-invoices.tsx': 1078,
  // Bumped 567 → 591: 2026-09-14 ownership-blocked warning — the affected
  // trucks list renders as links inside the warning block.
  'src/pages/ProfitPage.tsx': 591,
  'src/pages/SalaryAttendancePage.tsx': 780,
  'src/pages/SettlementPrintPage.tsx': 646,
  // Bumped 609 → 625: 2026-09-09 useClickOutside dismissal for quick edit draft.
  // Bumped 634 → 680: 2026-09-16 unified-datetime patch batch — quick-edit
  // schedule wiring moves to the shared surfaces.
  // Bumped 680 → 696: 2026-09-18 card 20260917_12 — the Loại lô tri-state
  // filter select joins the workboard toolbar (ad-hoc list filter).
  // Bumped 696 → 697: 2026-09-18 office request — the rows-per-page selector
  // joins the pagination bar. One line (the URL reader call); the selector
  // options come from the workboard hook module the page already imports.
  // Shrunk 697 → 509: 2026-09-19 debt card D2 residual — the workboard
  // toolbar (search, advanced toggle, reset and their draft state/handlers)
  // extracted to components/WorkboardFilters.tsx beside the advanced-
  // criteria half; DOM/classname parity pinned by the page suite.
  // Refrozen 509 → 558: 2026-09-23 unattributed-WIP window (ContainerDialog-
  // lane ShipmentsPage.tsx/.css/.test.tsx +85/−17 held UNLANDED per ownership
  // protocol — AGENTS.md bans the side-branch park; the tree-wide guard was
  // blocking every unrelated landing). Shrink debt on card 20260922_83:
  // restore 509 once that WIP lands attributed or reverts.
  // Refrozen 558 → 610: 2026-09-23 card 20260923_1 — that WIP LANDED
  // (cd862de4) and this landing adds the drawer's lot-delete bar/guard, so the
  // page carries the drawer ops instead of the removed ContainerManageDialog
  // wiring. The 20260922_83 shrink debt stays open and now has a named split:
  // extract the drawer body into a CusShipmentDrawer component.
  // Bumped 759 -> 779: 2026-09-28 card 20260928_193 — the workboard's column
  // picker wiring: the `useHiddenColumns` call with its data predicate, the
  // conditional `<col>`/`SortHeader` triple, and the `columns` prop on the bar.
  // 2026-10-03 tree settlement: audit-session chunk +1 (status filter),
  //  refrozen 779→780 at landing c5*; shrink debt on the tech-debt ledger.
  // 2026-10-03 settlement addendum: the 263 FE landing grew the factory
  //  config page to 460L (delete affordance + confirm modal) — first
  //  baseline entry (new-file ceiling 400 superseded), shrink debt on
  //  the tech-debt ledger.
  'src/pages/config/FactoriesConfigPage.tsx': 460,
  'src/pages/ShipmentsPage.tsx': 780,
  'src/pages/SupplierListPage.tsx': 626,
  'src/pages/TripDetailPage.tsx': 438,
  // Bumped 540 -> 554: ticket 7a74d6eb - fetch-error branch (alert + retry)
  'src/pages/TripEditPage.tsx': 554,
  'src/pages/TripListPage.tsx': 655,
  // Bumped 576 → 586: 2026-09-09 hard 24h contract — the credit-override
  // "Hiệu lực đến" datetime-local was replaced by a buffered time-first 24h
  // text input (useBufferedDateTimeValue wiring: ref/defaultValue/onBlur +
  // placeholder/maxLength attrs). Reviewed as a contract change; the value
  // contract ('YYYY-MM-DDTHH:mm') is unchanged.
  'src/pages/TripCreatePage.tsx': 586,
  // Baseline 430 (was new-file capped 400): 2026-09-14 _18 self-healing
  // version-token writes — the transport now detects the backend's
  // VERSION_TOKEN_REQUIRED 428, refetches the row once, and retries with the
  // fresh token (request/requestOnce split + heal branch + dev warn).
  // Reviewed as a contract change; future splits should restore smaller.
  'src/lib/api/client.ts': 430,
};

const SIZE_ROOTS = ['src/pages', 'src/features', 'src/components', 'src/hooks', 'src/api', 'src/lib', 'src/design-system', 'src/context'];

function countLines(path) {
  // trimEnd first: split('\n').length overcounts files ending in a newline
  // by one vs `wc -l`, which the baseline was generated with.
  return readFileSync(path, 'utf8').trimEnd().split('\n').length;
}

function listSourceFiles(root, acc = []) {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) listSourceFiles(full, acc);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
  return acc;
}

/** Every violation of the ratchet on the current tree; [] means green. */
export function runGuard({ cwd = process.cwd() } = {}) {
  const violations = [];
  const files = SIZE_ROOTS.flatMap((root) => listSourceFiles(join(cwd, root)))
    .map((file) => relative(cwd, file));
  for (const rel of files) {
    const loc = countLines(join(cwd, rel));
    const ceiling = FROZEN_MAX_LOC[rel];
    if (ceiling != null) {
      if (loc > ceiling) violations.push(`${rel}: ${loc}L exceeds frozen ceiling ${ceiling}L (ratchet only shrinks)`);
    } else if (loc > NEW_FILE_MAX_LOC) {
      violations.push(`${rel}: ${loc}L exceeds the ${NEW_FILE_MAX_LOC}L new-file ceiling — split it or justify a baseline entry`);
    }
  }
  const missing = Object.keys(FROZEN_MAX_LOC).filter((rel) => {
    try { statSync(join(cwd, rel)); return false; } catch { return true; }
  });
  if (missing.length > 0) violations.push(`stale entries: ${missing.join(', ')} — remove or rename them after file moves`);
  return violations;
}

/** The Untitled UI manifest must match what is vendored (both directions). */
export function runManifestCheck({ cwd = process.cwd() } = {}) {
  const VENDOR_ROOT = 'src/components/untitled-ui';
  const manifest = JSON.parse(readFileSync(join(cwd, VENDOR_ROOT, 'installed.json'), 'utf8'));
  const walk = (rel, acc = []) => {
    for (const entry of readdirSync(join(cwd, rel))) {
      const childRel = `${rel}/${entry}`;
      if (statSync(join(cwd, childRel)).isDirectory()) walk(childRel, acc);
      else if (entry !== 'installed.json' && !entry.includes('.test.')) acc.push(childRel);
    }
    return acc;
  };
  const onDisk = walk(VENDOR_ROOT).map((rel) => rel.slice(VENDOR_ROOT.length + 1)).sort();
  const recorded = [...manifest.files].sort();
  const violations = [];
  const unrecorded = onDisk.filter((file) => !manifest.files.includes(file));
  const gone = manifest.files.filter((file) => !onDisk.includes(file));
  if (unrecorded.length > 0) violations.push(`vendored but not in installed.json: ${unrecorded.join(', ')} — regenerate the manifest in the same commit`);
  if (gone.length > 0) violations.push(`listed in installed.json but not on disk: ${gone.join(', ')} — regenerate the manifest in the same commit`);
  if (JSON.stringify(recorded) !== JSON.stringify(manifest.files)) violations.push('installed.json.files must be sorted');
  return violations;
}

/** No new local date formatters outside lib/format and the documented exceptions. */
export function runDateFormatterCheck({ cwd = process.cwd() } = {}) {
  // Documented intentional variants (phase-4 inventory): midnight-normalized
  // CUS dates, print-precision day/month, host-local tables with raw-echo
  // invalid handling. Everything else must use lib/format.
  const allowed = new Set([
    'src/lib/format.ts',
    'src/features/shipments/cus/cusUtils.ts',
    'src/features/dispatch/master-plan/MasterPlanGrid.tsx',
    'src/pages/SettlementPrintPage.tsx',
    'src/pages/ShipmentDetailPage.tsx',
    // 2026-09-16 unified-datetime patch batch: driver trip model derives
    // display labels from trip legs; the buffered hook normalizes partial
    // date text for the shared surfaces.
    'src/features/driver/driver-trip-model.ts',
    'src/design-system/hooks/useBufferedDateTextValue.ts',
  ]);
  const offenders = [];
  for (const rel of SIZE_ROOTS.flatMap((root) => listSourceFiles(join(cwd, root))).map((file) => relative(cwd, file))) {
    if (allowed.has(rel)) continue;
    const source = readFileSync(join(cwd, rel), 'utf8');
    // Matches implementations (function decls, arrow/function consts) but
    // NOT alias consts like `const formatDateTime = formatDateTimeShort`.
    if (/^(?:export )?function\s+format(?:Date|DateTime)\w*\s*\(|^(?:export )?(?:const|let)\s+format(?:Date|DateTime)\w*\s*(?::[^=]+)?=\s*(?:\(|async\s|function\b)/m.test(source)) {
      offenders.push(rel);
    }
  }
  return offenders.length > 0
    ? [`local date formatters: ${offenders.join(', ')} — import from lib/format instead`]
    : [];
}

function main() {
  const violations = [...runGuard(), ...runManifestCheck(), ...runDateFormatterCheck()];
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log('structure guard OK');
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
