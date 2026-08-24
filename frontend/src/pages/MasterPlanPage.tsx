import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Truck } from 'lucide-react';
import { EmptyState, Pagination } from '../design-system';
import type { ShipmentListItem } from '../api/shipmentClient';
import { updateShipment } from '../api/shipmentClient';
import { useDispatchMasterPlan } from '../features/dispatch/master-plan/useDispatchMasterPlan';
import { MasterPlanFilters } from '../features/dispatch/master-plan/MasterPlanFilters';
import { MasterPlanGrid } from '../features/dispatch/master-plan/MasterPlanGrid';
import { DispatchAllocationPopover } from '../features/dispatch/master-plan/DispatchAllocationPopover';
import { DispatchContainerDetailDrawer } from '../features/dispatch/master-plan/DispatchContainerDetailDrawer';
import { ZoneTruckPresencePanel } from '../features/dispatch/detailed-plan/ZoneTruckPresencePanel';
import './DispatchPlanPage.css';

/**
 * Kế hoạch Tổng quát (/dispatch) — step 1 of dispatch planning: the dispatcher
 * spreads daily volume across carriers (nhà xe) at the shipment level. Saving
 * an allocation auto-splits the lot into per-container rows on
 * /dispatch-detail (Kế hoạch Chi tiết).
 */
export default function MasterPlanPage() {
  const navigate = useNavigate();
  const masterPlan = useDispatchMasterPlan();
  const [allocating, setAllocating] = useState<ShipmentListItem | null>(null);
  const [containerDetailShipment, setContainerDetailShipment] = useState<ShipmentListItem | null>(null);
  const allocationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const containerDetailTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleAllocate = (shipment: ShipmentListItem, trigger: HTMLButtonElement) => {
    allocationTriggerRef.current = trigger;
    setAllocating(shipment);
  };

  const handleViewContainers = (shipment: ShipmentListItem, trigger: HTMLButtonElement) => {
    containerDetailTriggerRef.current = trigger;
    setContainerDetailShipment(shipment);
  };

  const handleUpdateNotes = useCallback(async (shipment: ShipmentListItem, notes: string) => {
    try {
      const response = await updateShipment(shipment.id, {
        expectedVersion: shipment.version,
        operationalNotes: notes,
      });
      masterPlan.replaceItem({ ...shipment, operationalNotes: notes, version: response.version } as ShipmentListItem);
    } catch {
      // Silently fail — the user can retry. A toast could be added later.
    }
  }, [masterPlan]);

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <h1 className="sr-only">Kế hoạch Tổng quát</h1>

      <section className="dispatch-plan-page__workspace">
        {masterPlan.error && (
          <div className="dispatch-plan-page__error" role="alert">
            <span>{masterPlan.error}</span>
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={masterPlan.refetch}
              disabled={masterPlan.loading}
            >
              Thử lại
            </button>
          </div>
        )}

        <MasterPlanFilters
          filters={masterPlan.filters}
          onChange={masterPlan.updateFilters}
          action={(
            <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/shipments/new')}>
              <Plus size={16} aria-hidden="true" />
              Tạo lô hàng
            </button>
          )}
        />

        {masterPlan.presence && (
          <ZoneTruckPresencePanel
            items={masterPlan.presence.items}
            zoneLabel={masterPlan.presence.zoneLabel}
            date={masterPlan.presence.date}
            onSelectPlate={(plate) => masterPlan.updateFilters({ q: plate })}
          />
        )}

        {masterPlan.dispatchSummary && (
          <div className="master-plan-cargo-summary">
            <span className="master-plan-cargo-summary__label">Sản lượng:</span>
            <span className="master-plan-cargo-summary__count">
              {masterPlan.dispatchSummary.totalFclContainers} cont
            </span>
            {(masterPlan.dispatchSummary.size20ft > 0 || masterPlan.dispatchSummary.size40ft > 0 || masterPlan.dispatchSummary.sizeOther > 0) && (
              <>
                <span className="master-plan-cargo-summary__separator">(</span>
                {masterPlan.dispatchSummary.size20ft > 0 && (
                  <>
                    <span className="master-plan-cargo-summary__count">20': {masterPlan.dispatchSummary.size20ft}</span>
                    {(masterPlan.dispatchSummary.size40ft > 0 || masterPlan.dispatchSummary.sizeOther > 0) && (
                      <span className="master-plan-cargo-summary__separator"> · </span>
                    )}
                  </>
                )}
                {masterPlan.dispatchSummary.size40ft > 0 && (
                  <>
                    <span className="master-plan-cargo-summary__count">40': {masterPlan.dispatchSummary.size40ft}</span>
                    {masterPlan.dispatchSummary.sizeOther > 0 && (
                      <span className="master-plan-cargo-summary__separator"> · </span>
                    )}
                  </>
                )}
                {masterPlan.dispatchSummary.sizeOther > 0 && (
                  <span className="master-plan-cargo-summary__count">Khác: {masterPlan.dispatchSummary.sizeOther}</span>
                )}
                <span className="master-plan-cargo-summary__separator">)</span>
              </>
            )}
            {masterPlan.dispatchSummary.lclFulfillments > 0 && (
              <>
                <span className="master-plan-cargo-summary__separator"> · </span>
                <span className="master-plan-cargo-summary__label">Lẻ:</span>
                <span className="master-plan-cargo-summary__count">{masterPlan.dispatchSummary.lclFulfillments} lô</span>
              </>
            )}
          </div>
        )}

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
            <MasterPlanGrid
              items={masterPlan.items}
              onAllocate={handleAllocate}
              onViewContainers={handleViewContainers}
              onUpdateNotes={handleUpdateNotes}
              scheduleDate={
                masterPlan.filters.deliveryDateFrom
                && masterPlan.filters.deliveryDateFrom === masterPlan.filters.deliveryDateTo
                  ? masterPlan.filters.deliveryDateFrom
                  : null
              }
            />
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
      <DispatchContainerDetailDrawer
        shipment={containerDetailShipment}
        onClose={() => setContainerDetailShipment(null)}
        returnFocusTarget={containerDetailTriggerRef.current}
      />
    </div>
  );
}
