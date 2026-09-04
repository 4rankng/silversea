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
  'src/api/shipmentClient.ts': 1099,
  'src/components/agent/AgentAssistant.tsx': 473,
  'src/components/billing/BillingDocumentBuilder.tsx': 716,
  'src/components/Layout.tsx': 843,
  'src/components/shipment/TripPodReviewPanel.tsx': 588,
  'src/components/trip/AncillaryFeesCard.tsx': 607,
  'src/components/trip/ContainerInstancesCard.tsx': 591,
  'src/components/trip/DriverContainerCard.tsx': 585,
  'src/components/trip/ShipmentCostEntryForm.tsx': 522,
  'src/components/UI.tsx': 661,
  'src/components/untitled-ui/base/badges/badges.tsx': 416,
  'src/components/untitled-ui/base/select/tag-select.tsx': 401,
  'src/components/work-inbox/RoleWorkInbox.tsx': 485,
  'src/features/app-settings/FinancePolicySection.tsx': 431,
  'src/features/dispatch/detailed-plan/DetailedPlanFilters.tsx': 445,
  'src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx': 691,
  'src/features/dispatch/detailed-plan/useDispatchDetailPlan.ts': 446,
  'src/features/dispatch/master-plan/DispatchAllocationPopover.tsx': 454,
  'src/features/dispatch/master-plan/MasterPlanFilters.tsx': 735,
  'src/features/dispatch/master-plan/MasterPlanGrid.tsx': 508,
  'src/features/fleet/truck-card.tsx': 440,
  'src/features/penalties/components/PenaltyTable.tsx': 592,
  'src/features/recoverable-costs/RecoverableCostsWorkspace.tsx': 455,
  'src/features/salary-attendance/salary-attendance-components.tsx': 755,
  'src/features/salary-attendance/useSalaryAttendancePage.ts': 452,
  'src/features/shipments/create/ShipmentCreateWorkspace.tsx': 886,
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
