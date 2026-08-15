import { useRef, useState } from 'react';
import { Truck } from 'lucide-react';
import { EmptyState, Pagination } from '../design-system';
import { PageHeader } from '../components/UI';
import type { ShipmentListItem } from '../api/shipmentClient';
import { useDispatchMasterPlan } from '../features/dispatch/master-plan/useDispatchMasterPlan';
import { MasterPlanFilters } from '../features/dispatch/master-plan/MasterPlanFilters';
import { MasterPlanGrid } from '../features/dispatch/master-plan/MasterPlanGrid';
import { DispatchAllocationPopover } from '../features/dispatch/master-plan/DispatchAllocationPopover';
import './DispatchPlanPage.css';

/**
 * Kế hoạch Tổng quát (/dispatch) — step 1 of dispatch planning: the dispatcher
 * spreads daily volume across carriers (nhà xe) at the shipment level. Saving
 * an allocation auto-splits the lot into per-container rows on
 * /dispatch-detail (Kế hoạch Chi tiết).
 */
export default function MasterPlanPage() {
  const masterPlan = useDispatchMasterPlan();
  const [allocating, setAllocating] = useState<ShipmentListItem | null>(null);
  const allocationTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleAllocate = (shipment: ShipmentListItem, trigger: HTMLButtonElement) => {
    allocationTriggerRef.current = trigger;
    setAllocating(shipment);
  };

  return (
    <div className="dispatch-plan-page page-anim">
      <PageHeader
        title="Kế hoạch Tổng quát"
        iconName="truck"
        description="Kế hoạch phân bổ nhà xe cho các lô hàng"
      />

      <section className="dispatch-plan-page__workspace">
        {masterPlan.error && (
          <div className="dispatch-plan-page__error" role="alert">
            {masterPlan.error}
          </div>
        )}

        <MasterPlanFilters filters={masterPlan.filters} onChange={masterPlan.updateFilters} />

        {masterPlan.loading ? (
          <div className="dispatch-plan-page__loading">
            Đang tải dữ liệu…
          </div>
        ) : masterPlan.items.length === 0 && !masterPlan.error ? (
          <EmptyState
            illustration="/assets/illustrations/empty-clients.svg"
            icon={Truck}
            title="Không có lô hàng nào cần phân xe"
            description="Lô hàng có ngày giao sẽ xuất hiện ở đây."
          />
        ) : (
          <>
            <MasterPlanGrid items={masterPlan.items} onAllocate={handleAllocate} />
            {masterPlan.total > masterPlan.pageSize && (
              <Pagination
                page={masterPlan.page}
                totalPages={masterPlan.totalPages}
                totalItems={masterPlan.total}
                pageSize={masterPlan.pageSize}
                onChange={masterPlan.setPage}
              />
            )}
          </>
        )}
      </section>

      {allocating && (
        <DispatchAllocationPopover
          shipment={allocating}
          onClose={() => setAllocating(null)}
          onSaved={(updated) => masterPlan.replaceItem(updated)}
          returnFocusTarget={allocationTriggerRef.current}
        />
      )}
    </div>
  );
}
