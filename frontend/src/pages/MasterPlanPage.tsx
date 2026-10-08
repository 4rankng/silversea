import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { Role } from '@tingting/shared';
import { EmptyState, Pagination } from '../design-system';
import type { ShipmentListItem } from '../api/shipmentClient';
import { updateShipment } from '../api/shipmentClient';
import { ApiError } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { useToast } from '../components/shared/Toast';
import { toastActionError } from '../lib/api/action-error';
import { DisabledActionTip } from '../components/shared/DisabledActionTip';
import { SkeletonTable } from '../components/shared/Skeleton';
import { useDispatchMasterPlan } from '../features/dispatch/master-plan/useDispatchMasterPlan';
import { exportMasterPlanWorksheet } from '../features/dispatch/master-plan/masterPlanExport';
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
  const { user } = useAuth();
  const masterPlan = useDispatchMasterPlan();
  const { toast } = useToast();
  const [allocating, setAllocating] = useState<ShipmentListItem | null>(null);
  const [containerDetailShipment, setContainerDetailShipment] = useState<ShipmentListItem | null>(null);
  const [exporting, setExporting] = useState(false);
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
      toast({ kind: 'success', message: 'Đã lưu ghi chú điều phối.' });
    } catch (error) {
      // Keep the server's own reason (the dispatcher intake-stage gate, a
      // version conflict, …): ApiError.message is already the output of the
      // shared Vietnamese formatter (lib/api/errors.ts), so surface it as-is
      // and fall back only when the failure carries no message. Card
      // 20261008_6: the policy gates denial/abort first; `describe` keeps
      // this site's ApiError-only passthrough (validation messages verbatim,
      // generic throwables down to the fallback).
      const fallback = 'Không lưu được ghi chú điều phối. Vui lòng thử lại.';
      toastActionError(toast, 'lưu ghi chú điều phối', error, fallback,
        (e) => (e instanceof ApiError && e.message ? e.message : fallback));
      // The editor awaits this rejection to retain its draft for a retry.
      throw error;
    }
  }, [masterPlan, toast]);

  // Single-day scope (deliveryDateFrom === deliveryDateTo): the grid narrows
  // its schedule/port/cargo lines to that day — the worksheet takes the same
  // argument so its columns match the screen exactly.
  const scheduleDate = masterPlan.filters.deliveryDateFrom
    && masterPlan.filters.deliveryDateFrom === masterPlan.filters.deliveryDateTo
    ? masterPlan.filters.deliveryDateFrom
    : null;

  // Card 081026093510 (lead ruling 2026-10-08): the export enable condition
  // is DATA-DRIVEN — export is possible whenever the dispatcher's current
  // filtered view holds >= 1 row; at 0 rows the button disables WITH the
  // "Không có dữ liệu để xuất" explanation. Busy states carry their own
  // explanation (the 'Đang xuất…' label, or the loading reason).
  const exportDisabledReason = exporting
    ? null
    : masterPlan.loading
      ? 'Đang tải dữ liệu…'
      : masterPlan.total === 0
        ? 'Không có dữ liệu để xuất'
        : null;
  const exportDisabled = exporting || exportDisabledReason != null;

  const handleExportExcel = async () => {
    if (exportDisabled) return;
    setExporting(true);
    try {
      const count = await exportMasterPlanWorksheet(masterPlan.filters, scheduleDate);
      toast({ kind: 'success', message: `Đã xuất ${count} lô hàng ra tệp Excel.` });
    } catch {
      // FB-053 export feedback convention.
      toast({ kind: 'error', message: 'Chưa xuất được tệp Excel — vui lòng thử lại.' });
    } finally {
      setExporting(false);
    }
  };

  // Customer ask (Cap_nhat_UI_va_logic 2.1): hint inside the "Sản lượng" bar
  // listing last day's OWN trucks that dropped containers in the zone.
  const presenceDropPlates = (masterPlan.presence?.items ?? [])
    .filter((item) => item.evidence.some((evidence) => evidence.reason === 'D-1_DROP'))
    .map((item) => item.plateNumber);

  return (
    <div className="dispatch-plan-page dispatch-plan-page--wide page-anim">
      <h1 className="sr-only">Kế hoạch Tổng quát</h1>

      <section className="dispatch-plan-page__workspace">
        {masterPlan.error && (
          <div className="dispatch-plan-page__error" role="alert">
            <span>{masterPlan.error}</span>
            {/* Sweep (card 081026093510): the retry used to disable silently
                while a load was in flight — same aria-described explanation. */}
            <DisabledActionTip id="master-plan-retry" reason={masterPlan.loading ? 'Đang tải dữ liệu…' : null}>
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => { if (masterPlan.loading) return; masterPlan.refetch(); }}
                aria-disabled={masterPlan.loading || undefined}
              >
                Thử lại
              </button>
            </DisabledActionTip>
          </div>
        )}

        <MasterPlanFilters
          filters={masterPlan.filters}
          onChange={masterPlan.updateFilters}
          action={(
            <>
              {/* Card 081026093510: data-driven export — enabled while the
                  filtered view holds >= 1 row. At 0 rows the action stays
                  aria-disabled (focusable + hoverable, NEVER `disabled`) so
                  DisabledActionTip can explain "Không có dữ liệu để xuất" on
                  hover AND keyboard focus. */}
              <DisabledActionTip id="master-plan-export" reason={exportDisabledReason}>
                <button
                  type="button"
                  className="btn btn--secondary btn--sm"
                  aria-disabled={exportDisabled || undefined}
                  onClick={() => { if (exportDisabled) return; void handleExportExcel(); }}
                >
                  <Download size={14} aria-hidden="true" />
                  {exporting ? 'Đang xuất…' : 'Xuất file Excel'}
                </button>
              </DisabledActionTip>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => navigate('/shipments/new')}>
                <Plus size={16} aria-hidden="true" />
                Tạo lô hàng
              </button>
            </>
          )}
        />

        {masterPlan.dispatchSummary && (
          <div className="master-plan-cargo-summary">
            <span className="master-plan-cargo-summary__group">
              <span className="master-plan-cargo-summary__label">Sản lượng:</span>
              <span className="master-plan-cargo-summary__count">{masterPlan.dispatchSummary.totalFclContainers} cont</span>
            </span>
            {masterPlan.dispatchSummary.size20ft > 0 && (
              <span className="master-plan-cargo-summary__count">20′: {masterPlan.dispatchSummary.size20ft}</span>
            )}
            {masterPlan.dispatchSummary.size40ft > 0 && (
              <span className="master-plan-cargo-summary__count">40′: {masterPlan.dispatchSummary.size40ft}</span>
            )}
            {masterPlan.dispatchSummary.sizeOther > 0 && (
              <span className="master-plan-cargo-summary__count">Khác: {masterPlan.dispatchSummary.sizeOther}</span>
            )}
            {masterPlan.dispatchSummary.lclFulfillments > 0 && (
              <span className="master-plan-cargo-summary__group">
                <span className="master-plan-cargo-summary__label">Lẻ:</span>
                <span className="master-plan-cargo-summary__count">{masterPlan.dispatchSummary.lclFulfillments} lô</span>
              </span>
            )}
            {presenceDropPlates.length > 0 && masterPlan.presence && (
              <span
                className="master-plan-cargo-summary__zone-hint"
                title="Xe SilverSea hôm trước có cont hạ tại khu vực này"
              >
                Hạ {masterPlan.presence.zoneLabel}: {presenceDropPlates.join('; ')}
              </span>
            )}
          </div>
        )}

        {/* Customer ask (Kiến nghị L2 3.1): the Lạch Huyện truck table sits
            BELOW the "Sản lượng" aggregate, not above it. */}
        {masterPlan.presence && (
          <ZoneTruckPresencePanel
            items={masterPlan.presence.items}
            zoneLabel={masterPlan.presence.zoneLabel}
            date={masterPlan.presence.date}
            onSelectPlate={(plate) => masterPlan.updateFilters({ q: plate })}
          />
        )}

        {masterPlan.loading ? (
          <div role="status">
            <SkeletonTable rows={6} cols={8} />
            <span className="sr-only">Đang tải dữ liệu…</span>
          </div>
        ) : masterPlan.items.length === 0 && !masterPlan.error ? (
          <EmptyState
            context="trucks"
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
              // `assertDispatcherCanMutateShipmentIntake` scopes a dispatcher's
              // write to intake-stage lots; offer the note affordance there only.
              notesIntakeOnly={user?.role === Role.DISPATCHER}
              scheduleDate={scheduleDate}
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
        />
      )}
      <DispatchContainerDetailDrawer
        shipment={containerDetailShipment}
        onClose={() => setContainerDetailShipment(null)}
        onSaved={() => masterPlan.refetch()}
      />
    </div>
  );
}
