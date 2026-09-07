import { useState } from 'react';
import { PageHeader } from '../components/UI';
import { Pagination } from '../design-system';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { TripReassignDialog } from '../features/dispatch/detailed-plan/TripReassignDialog';
import { PairTripsDialog } from '../features/dispatch/detailed-plan/PairTripsDialog';
import type { DispatchDetailPlanRow } from '../api/dispatchPlanningClient';
import { useDispatchDetailPlan } from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
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
  const [pairRow, setPairRow] = useState<DispatchDetailPlanRow | null>(null);

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <PageHeader
        title="Kế hoạch Chi tiết Xe"
        iconName="truck"
        description="Gom chuyến, kiểm tra lịch chạy và gán biển số theo từng container."
      />

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
          sortKey={detailPlan.sortKey}
          onToggleSort={detailPlan.toggleSort}
          onAtomicSave={detailPlan.savePlan}
          onOpenTripReassign={setReassignTripId}
          onIssueOrder={detailPlan.issueOrder}
          onOpenPair={setPairRow}
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

      {pairRow && (
        <PairTripsDialog
          row={pairRow}
          candidates={detailPlan.items}
          onClose={() => setPairRow(null)}
          onPaired={detailPlan.refresh}
        />
      )}
    </div>
  );
}
