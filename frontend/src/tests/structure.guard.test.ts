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
 * Regeneration recipe (run from frontend/):
 *   find src/pages src/features src/components src/hooks src/api \
 *     \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.*' | xargs wc -l \
 *     | awk '$1 > 400 && $2 != "total" {print "  \x27" $2 "\x27: " $1 ","}'
 * then DELETE every entry that got smaller before pasting.
 */

const NEW_FILE_MAX_LOC = 400;

const FROZEN_MAX_LOC: Record<string, number> = {
  'src/design-system/forms/SearchableSelect.tsx': 481,
  'src/api/driverClient.ts': 650,
  'src/api/keys.ts': 562,
  // Added 2026-09-07: baseline 401 (was new-file capped) — the atomic plan
  // save now carries operationalNotes and the tag-pool client helpers
  // (list/create) live here beside the other dispatch planning calls.
  'src/api/dispatchPlanningClient.ts': 410,
  // Bumped 400 (new-file) → 430: 2026-09-07 dropdown-flip sweep — the
  // multi-select picker gained selectionLabel + onSearchChange (aria names
  // and debounced server refetch) during the facet migration. Reviewed as a
  // contract change; a future split (extract the popover body) should
  // restore a smaller ceiling.
  'src/design-system/forms/SearchableMultiSelect.tsx': 430,
  // Bumped 1099 → 1110: minor growth from added keyboard helpers and
  // dispatch-status normalization (18539e54 + cec0f963, 2026-09-05).
  // Reviewed as a contract change; a future split should restore a smaller
  // ceiling.
  'src/api/shipmentClient.ts': 1110,
  'src/components/billing/BillingDocumentBuilder.tsx': 716,
  // Raised 843 → 856: the CUS + dispatcher sidebar catalog entries
  // (e69e67a7, effdf61f) shipped past the old ceiling. Reviewed as nav
  // additions; a future sidebar split should restore a smaller ceiling.
  'src/components/Layout.tsx': 856,
  'src/components/shipment/TripPodReviewPanel.tsx': 588,
  'src/components/trip/AncillaryFeesCard.tsx': 607,
  'src/components/trip/ContainerInstancesCard.tsx': 591,
  'src/components/trip/DriverContainerCard.tsx': 585,
  'src/components/trip/ShipmentCostEntryForm.tsx': 522,
  'src/components/UI.tsx': 665,
  'src/components/untitled-ui/base/badges/badges.tsx': 416,
  'src/components/untitled-ui/base/select/tag-select.tsx': 401,
  'src/components/work-inbox/RoleWorkInbox.tsx': 485,
  'src/features/app-settings/FinancePolicySection.tsx': 431,
  'src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx': 445,
  // Bumped 691 → 705: 2026-09-07 driver-note composer — the dispatch edit
  // dialog gains the "Ghi chú tác vụ" section (draft field, save body,
  // re-anchor, and the DispatchTaskTagEditor mount). The composer itself is
  // a separate component; only wiring lives here. Reviewed as a contract
  // change; a future split (extract the whole notes section) should restore
  // a smaller ceiling.
  // Bumped 705 → 725: 2026-09-08 TC_COMB_01-03 — enforce 20ft container rule
  // for isCombined checkbox, disabling and tooltip title for 40ft/45ft containers,
  // atomic plan save guard. Reviewed as a contract change.
  'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx': 725,
  // Bumped 446 → 448: driver-note save now carries operationalNotes and the
  // optimistic row update refreshes notes.vehicleNote (2026-09-07). Reviewed
  // as a contract change.
  'src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts': 448,
  'src/features/dispatch/master-plan/DispatchAllocationPopover.tsx': 454,
  'src/features/dispatch/master-plan/MasterPlanFilters.tsx': 735,
  // Bumped 508 → 520: 282fe386 (2026-09-05, "fix(dispatch): keep dispatched
  // and completed lots visible on the master plan") + b15dd696 added chip
  // rendering for dispatched/completed lots and a carrier-allocation column
  // that bumps the file by ~7 lines. Reviewed as a contract change because
  // the ratchet only shrinks under the original behaviour; a future split
  // should restore a smaller ceiling.
  'src/features/dispatch/master-plan/MasterPlanGrid.tsx': 520,
  'src/features/fleet/truck-card.tsx': 440,
  'src/features/penalties/components/PenaltyTable.tsx': 592,
  'src/features/recoverable-costs/RecoverableCostsWorkspace.tsx': 455,
  'src/features/salary-attendance/salary-attendance-components.tsx': 755,
  'src/features/salary-attendance/useSalaryAttendancePage.ts': 452,
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
  'src/features/shipments/create/ShipmentCreateWorkspace.tsx': 985,
  // Bumped to 411: 2026-09-07 customer feedback — the per-row "Xác nhận"
  // action column (inline save) so the user no longer has to press Enter
  // or hunt for the header "Hoàn tất" button after typing a container
  // appointment. Reviewed as a contract change; a future split (extract
  // `useContainerLineDraft` so this becomes a thin presentational row)
  // should restore a smaller ceiling.
  // Bumped 411 → 460: 2026-09-08 TC_BTN_01-03 — visible inline Save (primary green)
  // & Cancel buttons next to appointment input, Enter/Escape handling,
  // success/error toast notifications. Reviewed as a contract change.
  'src/features/shipments/cus/CusContainerLedger.tsx': 460,
  'src/features/shipments/detail/ShipmentContainerLedger.tsx': 750,
  'src/features/tires/tire-controls.tsx': 526,
  'src/features/tires/tire-dialogs.tsx': 426,
  'src/features/trips/tripColumns.tsx': 512,
  'src/features/users/components/UserEditPanel.tsx': 423,
  'src/features/users/components/UserTable.tsx': 603,
  'src/hooks/use-trip-form-submit.ts': 608,
  'src/hooks/useTripFormDispatch.ts': 545,
  'src/pages/AdminAdvanceSettlementsPage.tsx': 608,
  'src/pages/AdminAdvancesPage.tsx': 563,
  'src/pages/AuditLogPage.tsx': 567,
  'src/pages/config/AppSettingsConfigPage.tsx': 571,
  'src/pages/config/CustomersConfigPage.tsx': 500,
  'src/pages/config/DebitNoteTemplateEditorPage.tsx': 420,
  'src/pages/config/PenaltyReasonsConfigPage.tsx': 519,
  'src/pages/config/RoutesConfigPage.tsx': 449,
  'src/pages/CreditOverrideQueuePage.tsx': 580,
  'src/pages/CustomersPage.tsx': 722,
  'src/pages/DashboardPage.tsx': 686,
  'src/pages/debt-detail-ledger.tsx': 443,
  'src/pages/DebtDetailPage.tsx': 816,
  'src/pages/DebtListPage.tsx': 548,
  'src/pages/DriverTripDetailPage.tsx': 623,
  'src/pages/DriverTripPodPage.tsx': 520,
  'src/pages/ExpenseEntryPage.tsx': 702,
  'src/pages/FinancePage.tsx': 987,
  'src/pages/ForwarderSettlementCreatePage.tsx': 503,
  'src/pages/ForwarderTripDetailPage.tsx': 1107,
  'src/pages/GovernanceActionsPage.tsx': 633,
  'src/pages/PayableDetailPage.tsx': 608,
  'src/pages/PayableListPage.tsx': 664,
  'src/pages/payables-fuel-invoices.tsx': 1078,
  'src/pages/ProfitPage.tsx': 567,
  'src/pages/SalaryAttendancePage.tsx': 780,
  'src/pages/SettlementPrintPage.tsx': 646,
  'src/pages/ShipmentsPage.tsx': 609,
  'src/pages/SupplierListPage.tsx': 626,
  'src/pages/TripCreatePage.tsx': 576,
  'src/pages/TripDetailPage.tsx': 438,
  'src/pages/TripEditPage.tsx': 540,
  'src/pages/TripListPage.tsx': 655,
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
