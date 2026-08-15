import { useRef, useState } from 'react';
import { ArrowLeft, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, Pagination } from '../design-system';
import { PageHeader } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import type { ShipmentListItem } from '../api/shipmentClient';
import { useDispatchMasterPlan } from '../features/dispatch/master-plan/useDispatchMasterPlan';
import { MasterPlanFilters } from '../features/dispatch/master-plan/MasterPlanFilters';
import { MasterPlanGrid } from '../features/dispatch/master-plan/MasterPlanGrid';
import { DispatchAllocationPopover } from '../features/dispatch/master-plan/DispatchAllocationPopover';
import { DetailedPlanGrid } from '../features/dispatch/detailed-plan/DetailedPlanGrid';
import { useDispatchDetailPlan } from '../features/dispatch/detailed-plan/useDispatchDetailPlan';
import './VehicleAllocationPage.css';

type VehicleTab = 'summary' | 'detail';

export default function VehicleAllocationPage({ initialTab = 'summary' as VehicleTab }: { initialTab?: VehicleTab } = {}) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<VehicleTab>(initialTab);
  const masterPlan = useDispatchMasterPlan();
  const detailPlan = useDispatchDetailPlan();
  const [allocating, setAllocating] = useState<ShipmentListItem | null>(null);
  const allocationTriggerRef = useRef<HTMLButtonElement | null>(null);

  const handleAllocate = (shipment: ShipmentListItem, trigger: HTMLButtonElement) => {
    allocationTriggerRef.current = trigger;
    setAllocating(shipment);
  };

  const isDetailedPlan = activeTab === 'detail';
  const pageTitle = isDetailedPlan ? 'Kế hoạch chi tiết xe' : 'Phân bổ phương tiện';
  const pageDescription = isDetailedPlan
    ? 'Gom chuyến, kiểm tra lịch chạy và gán biển số theo từng container.'
    : 'Kế hoạch phân bổ nhà xe cho các lô hàng';

  return (
    <div className="vehicle-allocation-page page-anim">
      <Breadcrumbs
        className="vehicle-allocation-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Điều phối', to: '/dispatch' },
          { label: isDetailedPlan ? 'Kế hoạch chi tiết xe' : 'Phân xe' },
        ]}
      />

      <button
        type="button"
        onClick={() => navigate(-1)}
        className="vehicle-allocation-page__back"
      >
        <ArrowLeft size={18} /> Quay lại
      </button>

      <PageHeader
        title={pageTitle}
        iconName="truck"
        description={pageDescription}
      />

      <section className="vehicle-allocation-page__workspace">
        <div className="vehicle-allocation-page__tabs">
          <button
            type="button"
            className={`vehicle-allocation-page__tab${activeTab === 'summary' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('summary')}
          >
            Kế hoạch Tổng quát
          </button>
          <button
            type="button"
            className={`vehicle-allocation-page__tab${activeTab === 'detail' ? ' is-active' : ''}`}
            onClick={() => setActiveTab('detail')}
          >
            Kế hoạch Chi tiết
          </button>
        </div>

        {masterPlan.error && (
          <div className="vehicle-allocation-page__error" role="alert">
            {masterPlan.error}
          </div>
        )}

        {activeTab === 'summary' && (
          <>
            <MasterPlanFilters filters={masterPlan.filters} onChange={masterPlan.updateFilters} />

            {masterPlan.loading ? (
              <div className="vehicle-allocation-page__loading">
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
          </>
        )}

        {activeTab === 'detail' && (
          <DetailedPlanGrid
            filters={detailPlan.filters}
            onFilterChange={detailPlan.updateFilters}
            loadDeliveryPointFacets={detailPlan.loadDeliveryPointFacets}
            items={detailPlan.items}
            loading={detailPlan.loading}
            error={detailPlan.error}
            assignmentError={detailPlan.assignmentError}
            lotBanner={detailPlan.lotBanner}
            onClearLotBanner={detailPlan.clearLotBanner}
            sortKey={detailPlan.sortKey}
            onToggleSort={detailPlan.toggleSort}
            onAssignPlate={detailPlan.assignPlate}
          />
        )}
        {activeTab === 'detail' && detailPlan.nextCursor && (
          <div className="vehicle-allocation-page__load-more">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={detailPlan.loadMore}
              disabled={detailPlan.loadingMore}
            >
              {detailPlan.loadingMore ? 'Đang tải…' : 'Tải thêm'}
            </button>
          </div>
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
