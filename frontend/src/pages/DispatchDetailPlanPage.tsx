import { useMemo, useState } from 'react';
import { ConfirmDialog } from '../components/UI';
import { Pagination } from '../design-system';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { TripReassignDialog } from '../features/dispatch/detailed-plan/TripReassignDialog';
import { PairTripsDialog } from '../features/dispatch/detailed-plan/PairTripsDialog';
import { selectPairCandidates } from '../features/dispatch/detailed-plan/pairCandidates';
import { useDispatchDetailPlan } from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';
import { billBookingReference } from '../lib/business-reference';
import './DispatchPlanPage.css';

/**
 * Kế hoạch Chi tiết (/dispatch-detail) — step 2 of dispatch planning: the
 * container-level grid auto-split from the carrier allocations made on
 * /dispatch (Kế hoạch Tổng quát). The dispatcher filters/sorts by run hour and
 * drop-off point to bundle trips, then assigns license plates per container.
 */
export default function DispatchDetailPlanPage() {
  const detailPlan = useDispatchDetailPlan();
  const [reassignTripId, setReassignTripId] = useState<number | null>(null);
  // Ghép chuyến (LoHangKepKetHop §3.1): the row whose trip anchors the pair;
  // null keeps the dialog closed. Candidates are the loaded unpaired OWN
  // rows with trips — the same set the grid offers the button for.
  const [pairRow, setPairRow] = useState<DispatchDetailPlanRow | null>(null);
  const pairCandidates = useMemo(
    () => selectPairCandidates(detailPlan.items, pairRow),
    [detailPlan.items, pairRow],
  );
  // Staff close for external-carrier trips: external drivers don't use the
  // app, so dispatch/CUS confirm the completion from the grid row.
  const [completingRow, setCompletingRow] = useState<DispatchDetailPlanRow | null>(null);
  const [completing, setCompleting] = useState(false);

  async function confirmCompleteExternalTrip() {
    if (!completingRow) return;
    setCompleting(true);
    try {
      await detailPlan.completeExternalTrip(completingRow);
      setCompletingRow(null);
    } catch {
      // assignmentError banner already surfaced the failure; keep the dialog
      // open only until the next render — the row flips or the error shows.
      setCompletingRow(null);
    } finally {
      setCompleting(false);
    }
  }

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <section className="dispatch-plan-page__workspace">
        <DetailedPlanGrid
          filters={detailPlan.filters}
          onFilterChange={detailPlan.updateFilters}
          loadDeliveryPointFacets={detailPlan.loadDeliveryPointFacets}
          loadPickupPortFacets={detailPlan.loadPickupPortFacets}
          loadDropoffPortFacets={detailPlan.loadDropoffPortFacets}
          items={detailPlan.items}
          loading={detailPlan.loading}
          error={detailPlan.error}
          onRetry={detailPlan.refresh}
          assignmentError={detailPlan.assignmentError}
          lotBanner={detailPlan.lotBanner}
          onClearLotBanner={detailPlan.clearLotBanner}
          presence={detailPlan.presence}
          zones={detailPlan.zones}
          assignmentCounts={detailPlan.assignmentStatusCounts}
          sortKey={detailPlan.sortKey}
          sortDirection={detailPlan.sortDirection}
          onToggleSort={detailPlan.toggleSort}
          onAtomicSave={detailPlan.savePlan}
          onOpenTripReassign={setReassignTripId}
          onCompleteExternalTrip={setCompletingRow}
          onIssueOrder={detailPlan.issueOrder}
          onOpenPair={(row) => {
            setPairRow(row);
            // Card 353: a stale grid window (rows fetched before a just-issued
            // sibling got its tripId) left "Lệnh ghép cùng" empty. Refresh on
            // open so the candidates always reflect the issued pairs.
            void detailPlan.refresh();
          }}
          onEnsureFulfillment={detailPlan.ensureFulfillment}
          autoOpenFulfillmentId={detailPlan.autoOpenFulfillmentId}
          onAutoOpenConsumed={detailPlan.consumeAutoOpen}
        />
        {detailPlan.total > detailPlan.pageSize && (
          <Pagination
            page={detailPlan.page}
            totalPages={detailPlan.totalPages}
            totalItems={detailPlan.total}
            pageSize={detailPlan.pageSize}
            onChange={detailPlan.setPage}
          />
        )}
      </section>

      <TripReassignDialog
        tripId={reassignTripId}
        onClose={() => setReassignTripId(null)}
        onReassigned={detailPlan.refresh}
      />

      <PairTripsDialog
        row={pairRow}
        candidates={pairCandidates}
        onClose={() => setPairRow(null)}
        onPaired={detailPlan.refresh}
      />

      <ConfirmDialog
        isOpen={completingRow != null}
        message={`Hoàn thành chuyến với xe ngoài ${
          completingRow?.container.containerNumber?.trim()
            || billBookingReference(completingRow?.docs.billNumber)
        }? Xe ngoài không dùng app nên điều vận/CUS chốt chuyến thay tài xế.`}
        confirmLabel={completing ? 'Đang hoàn thành…' : 'Hoàn thành chuyến'}
        onConfirm={() => void confirmCompleteExternalTrip()}
        onCancel={() => { if (!completing) setCompletingRow(null); }}
      />
    </div>
  );
}
