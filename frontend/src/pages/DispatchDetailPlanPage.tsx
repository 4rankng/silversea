import { PageHeader } from '../components/UI';
import { Pagination } from '../design-system';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
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
          sortKey={detailPlan.sortKey}
          onToggleSort={detailPlan.toggleSort}
          onAssignPlate={detailPlan.assignPlate}
          onAssignCarrier={detailPlan.assignCarrier}
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
    </div>
  );
}
