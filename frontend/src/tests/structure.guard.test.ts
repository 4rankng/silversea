import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Frontend structure guard — the "god files stay dead" ratchet.
 *
 * Mirrors the backend SIZE_BASELINE pattern (see docs/backend-architecture.md):
 * every existing oversized file is grandfathered at its CURRENT line count;
 * it may only shrink. Any file not listed must stay ≤ NEW_FILE_MAX_LOC.
 *
 * Ratchet rule: FROZEN_MAX_LOC may only SHRINK (regenerate a smaller entry
 * after a split lands). Growing or adding an entry requires an explicit,
 * justified change to this file reviewed like a contract change.
 *
 * 2026-09-09 contract change: bumped 48 entries by +1..+8 lines to match
 * the post-merge tree after origin/prod → main (commit 468bd371). The
 * merged tree carries both branches' feature sets; most files grew by a
 * single line of trailing-context/import noise. Reviewed as a contract
 * change; future splits should restore smaller ceilings.
 *
 * Regeneration recipe (run from frontend/):
 *   find src/pages src/features src/components src/hooks src/api \
 *     \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | xargs wc -l \
 *     | awk '$1 > 400 && $2 != "total" {print "  \x27" $2 "\x27: " $1 ","}'
 * then DELETE every entry that got smaller before pasting.
 */

const NEW_FILE_MAX_LOC = 400;

const FROZEN_MAX_LOC: Record<string, number> = {
  'src/design-system/forms/SearchableSelect.tsx': 481,
  // Bumped 650 -> 656: ticket 365943ea - factoryShortName and operationalNotes fields
  // Bumped 656 -> 679: 2026-09-11 trip-detail polish — wire gains
  // factoryAddress / khoPhone / invoiceMaster / knownTagLabels and their
  // fulfillment mapping.
  // Bumped 679 -> 684: e-POD thumbnails — downloadPodFile client method.
  // Bumped 684 -> 691: 2026-09-11 prod-merge redo — union of the pair/ad-hoc
  // card fields (T7 label, pairKind/pairOrder/pairLocked) with the
  // tag-pool/trip-detail polish client. Reviewed as a contract change.
  'src/api/driverClient.ts': 691,
  'src/api/keys.ts': 562,
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
  'src/api/dispatchPlanningClient.ts': 441,
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
  'src/api/shipmentClient.ts': 1159,
  'src/components/billing/BillingDocumentBuilder.tsx': 717,
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
  'src/components/trip/DriverContainerCard.tsx': 720,
  // Baseline 410 (was new-file capped): e-POD photos now render as tappable
  // thumbnails opening the fullscreen viewer — thumbnail state/effect + the
  // render branch live beside the upload lifecycle they serve.
  // Bumped 410 → 423: 2026-09-16 unified-datetime patch batch — POD submission
  // gains the shared datetime adapter wiring.
  'src/components/trip/TripPodSubmission.tsx': 423,
  'src/components/trip/ShipmentCostEntryForm.tsx': 522,
  'src/components/UI.tsx': 665,
  'src/components/untitled-ui/base/badges/badges.tsx': 416,
  'src/components/untitled-ui/base/select/tag-select.tsx': 405,
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
  'src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx': 439,
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
  'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx': 832,
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
  'src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts': 521,
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
  'src/features/shipments/create/ShipmentCreateWorkspace.tsx': 1174,
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
  'src/features/shipments/cus/CusContainerLedger.tsx': 530,
  'src/features/shipments/detail/ShipmentContainerLedger.tsx': 750,
  'src/features/tires/tire-controls.tsx': 527,
  'src/features/tires/tire-dialogs.tsx': 427,
  'src/features/trips/tripColumns.tsx': 513,
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
  'src/pages/CustomersPage.tsx': 722,
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
  'src/pages/ExpenseEntryPage.tsx': 702,
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
  'src/pages/ShipmentsPage.tsx': 697,
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

/** Source roots the size ratchet covers. */
const SIZE_ROOTS = ['src/pages', 'src/features', 'src/components', 'src/hooks', 'src/api', 'src/lib', 'src/design-system', 'src/context'];

function listSourceFiles(root: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(root)) {
    const full = join(root, entry);
    if (statSync(full).isDirectory()) {
      listSourceFiles(full, acc);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

function countLines(path: string): number {
  // trimEnd first: split('\n').length overcounts files ending in a newline
  // by one vs `wc -l`, which the baseline was generated with.
  return readFileSync(path, 'utf8').trimEnd().split('\n').length;
}

describe('frontend structure guard', () => {
  it('no source file exceeds its frozen ceiling (or the new-file max)', () => {
    const violations: string[] = [];
    for (const root of SIZE_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const rel = relative(process.cwd(), file);
        const loc = countLines(file);
        const ceiling = FROZEN_MAX_LOC[rel];
        if (ceiling != null) {
          if (loc > ceiling) violations.push(`${rel}: ${loc}L exceeds frozen ceiling ${ceiling}L (ratchet only shrinks)`);
        } else if (loc > NEW_FILE_MAX_LOC) {
          violations.push(`${rel}: ${loc}L exceeds the ${NEW_FILE_MAX_LOC}L new-file ceiling — split it or justify a baseline entry`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('frozen baseline entries all still exist (no dead ratchet entries)', () => {
    const missing = Object.keys(FROZEN_MAX_LOC).filter((rel) => {
      try { statSync(join(process.cwd(), rel)); return false; } catch { return true; }
    });
    expect(missing, `stale entries: ${missing.join(', ')} — remove or rename them after file moves`).toEqual([]);
  });

  it('no new local date formatters outside lib/format and the documented exceptions', () => {
    // Documented intentional variants (phase-4 inventory): midnight-normalized
    // CUS dates, print-precision day/month, host-local tables with raw-echo
    // invalid handling. Everything else must use lib/format.
    const allowed = new Set([
      'src/lib/format.ts',
      'src/features/shipments/cus/cusUtils.ts',
      'src/features/dispatch/master-plan/MasterPlanGrid.tsx',
      'src/pages/SettlementPrintPage.tsx',
      'src/pages/ShipmentDetailPage.tsx',
      // Delegating wrappers (phase 4): body is a lib/formatISODate call, only
      // the surface-specific empty-state text is local.
      'src/features/shipments/detail/ShipmentContainerLedger.tsx',
      'src/pages/portal/PortalDebitNotesPage.tsx',
      // 2026-09-16 unified-datetime patch batch: driver trip model derives
      // display labels from trip legs; the buffered hook normalizes partial
      // date text for the shared surfaces.
      'src/features/driver/driver-trip-model.ts',
      'src/design-system/hooks/useBufferedDateTextValue.ts',
    ]);
    const offenders: string[] = [];
    for (const root of SIZE_ROOTS) {
      for (const file of listSourceFiles(root)) {
        const rel = relative(process.cwd(), file);
        if (allowed.has(rel)) continue;
        const source = readFileSync(file, 'utf8');
        // Matches implementations (function decls, arrow/function consts) but
        // NOT alias consts like `const formatDateTime = formatDateTimeShort`.
        if (/^(?:export )?function\s+format(?:Date|DateTime)\w*\s*\(|^(?:export )?(?:const|let)\s+format(?:Date|DateTime)\w*\s*(?::[^=]+)?=\s*(?:\(|async\s|function\b)/m.test(source)) {
          offenders.push(rel);
        }
      }
    }
    expect(offenders, `local date formatters: ${offenders.join(', ')} — import from lib/format instead`).toEqual([]);
  });
});
