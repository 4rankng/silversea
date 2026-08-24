import { Truck } from 'lucide-react';
import { EmptyState } from '../../../design-system';
import { DISPATCH_CLASSIFICATION_LABELS } from '@tingting/shared';
import type { DispatchClassification } from '@tingting/shared';
import type { DispatchDetailPlanRow, ZoneTruckPresenceItem } from '../../../api/dispatchPlanningClient';
import { Badge } from '../../../components/untitled-ui/base/badges/badges';
import {
  DispatchPlanEditorCell,
  type AtomicPlanSaveResult,
} from './DispatchPlanEditorCell';
import { DetailedPlanFilters } from './DetailedPlanFilters';
import { ZoneTruckPresencePanel } from './ZoneTruckPresencePanel';
import type { DetailedPlanFilterState, DetailPlanSortKey } from './useDispatchDetailPlan';
import { formatISODate } from '../../../lib/format';
import '../../../styles/operational-table-typography.css';
import './DetailedPlanGrid.css';

function formatWeight(kg: string | null | undefined): string {
  if (kg == null || kg === '') return '—';
  const value = Number(kg);
  if (!Number.isFinite(value)) return kg;
  return `${new Intl.NumberFormat('vi-VN').format(value)} kg`;
}

interface DetailedPlanGridProps {
  filters: DetailedPlanFilterState;
  onFilterChange: (patch: Partial<DetailedPlanFilterState>) => void;
  loadDeliveryPointFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  loadPickupPortFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  loadDropoffPortFacets: (q?: string) => Promise<Array<{ id: number; name: string }>>;
  items: DispatchDetailPlanRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  assignmentError: string | null;
  lotBanner: string | null;
  onClearLotBanner: () => void;
  presence: { zone: string; zoneLabel: string; date: string; items: ZoneTruckPresenceItem[] } | null;
  zones: Array<{ code: string; label: string }>;
  sortKey: DetailPlanSortKey;
  onToggleSort: (key: 'runHour' | 'deliveryPoint') => void;
  onAtomicSave: (
    row: DispatchDetailPlanRow,
    body: {
      carrierType: 'OWN' | 'EXTERNAL';
      externalCarrierId?: number | null;
      truckId?: number | null;
      externalCarrierVehicleId?: number | null;
      plateNumber?: string | null;
      clearVehicle?: boolean;
      plannedRevenue: number | null;
      plannedCarrierCost: number | null;
      classification: DispatchClassification;
      isCombined: boolean;
    },
  ) => Promise<AtomicPlanSaveResult>;
  onOpenTripReassign: (tripId: number) => void;
}

/**
 * "Kế hoạch Chi tiết" grid (docx §5): one row per container (or LCL shipment),
 * 6 multi-line columns, in-row plate assignment. Rows are pre-derived from the
 * carrier allocation made on the master-plan screen.
 */
export function DetailedPlanGrid({
  filters,
  onFilterChange,
  loadDeliveryPointFacets,
  loadPickupPortFacets,
  loadDropoffPortFacets,
  items,
  loading,
  error,
  onRetry,
  assignmentError,
  lotBanner,
  onClearLotBanner,
  presence,
  zones,
  sortKey,
  onToggleSort,
  onAtomicSave,
  onOpenTripReassign,
}: DetailedPlanGridProps) {
  if (error) {
    return (
      <>
        <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} />
        <div className="dispatch-plan-page__error" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry} disabled={loading}>Thử lại</button>
        </div>
      </>
    );
  }

  return (
    <>
      <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} zones={zones} />

      <ZoneTruckPresencePanel
        items={presence?.items ?? []}
        zoneLabel={presence?.zoneLabel ?? ''}
        date={presence?.date ?? null}
        onSelectPlate={(plate) => onFilterChange({ q: plate })}
      />

      {assignmentError && (
        <div className="dispatch-plan-page__error" role="alert">{assignmentError}</div>
      )}

      {lotBanner && (
        <div className="detailed-plan-grid__lot-banner" role="status">
          <span>{lotBanner}</span>
          <button type="button" onClick={onClearLotBanner} aria-label="Đóng thông báo">✕</button>
        </div>
      )}

      {loading ? (
        <div className="dispatch-plan-page__loading">Đang tải dữ liệu…</div>
      ) : items.length === 0 ? (
        <EmptyState
          illustration="/assets/illustrations/empty-dispatch.svg"
          icon={Truck}
          title="Không có dòng kế hoạch nào"
          description="Các container của lô đã phân bổ nhà xe sẽ xuất hiện ở đây."
        />
      ) : (
        <div className="detailed-plan-grid__wrapper">
          <table className="detailed-plan-grid ops-table">
            <colgroup>
              <col className="detailed-plan-grid__col detailed-plan-grid__col--schedule" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--route" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--documents" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--container" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--assignment" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--classification" />
              <col className="detailed-plan-grid__col detailed-plan-grid__col--notes" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'runHour' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('runHour')}
                    aria-label="Sắp xếp theo giờ chạy"
                  >
                    Thời gian &amp; lịch trình {sortKey === 'runHour' ? '▲' : '↕'}
                  </button>
                </th>
                <th scope="col">
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'deliveryPoint' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('deliveryPoint')}
                    aria-label="Sắp xếp theo điểm trả"
                  >
                    Khách hàng &amp; lộ trình {sortKey === 'deliveryPoint' ? '▲' : '↕'}
                  </button>
                </th>
                <th scope="col">Tuyến đường</th>
                <th scope="col">Container</th>
                <th scope="col">Điều phối</th>
                <th scope="col">Phân loại</th>
                <th scope="col">Ghi chú</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.fulfillmentId} className={`detailed-plan-grid__row${row.lotFullyPlated ? ' detailed-plan-grid__row--plated' : ''}`}>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--schedule" data-label="Thời gian & lịch trình">
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                      {row.docs.tradeDirection === 'IMPORT' ? 'Nhận:' : 'Giao:'} {formatISODate(row.time.deliveryDate)}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                      Giờ: {row.time.runHour != null ? `${row.time.runHour}H` : '—'}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--route" data-label="Khách hàng & lộ trình">
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                      {row.customerRoute.customerName}
                    </div>
                    <div className="detailed-plan-grid__line">
                      {row.customerRoute.factoryName ?? '—'}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong detailed-plan-grid__route-bill">
                      {row.docs.billNumber ? `Bill: ${row.docs.billNumber}` : '—'}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__documents-direction">
                      {row.docs.tradeDirection === 'IMPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Nhập</Badge>
                      ) : row.docs.tradeDirection === 'EXPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Xuất</Badge>
                      ) : '—'}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--documents" data-label="Tuyến đường">
                    {row.customerRoute.routeName ? (
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                        {row.customerRoute.routeName}
                      </div>
                    ) : (
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">—</div>
                    )}
                    {row.isCombined && (
                      <span className="detailed-plan-grid__combined-note" title="Đóng kết hợp">
                        Kết hợp
                      </span>
                    )}
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--container" data-label="Container">
                    {row.cargoMode === 'FCL' ? (
                      <>
                        <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                          {row.container.containerNumber ?? 'Chưa có số'}
                        </div>
                        <div className="detailed-plan-grid__line">{row.container.containerTypeLabel ?? '—'}</div>
                        <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                          {formatWeight(row.container.cargoWeightKg)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">Lô hàng lẻ</div>
                        <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                          {formatWeight(row.container.cargoWeightKg)}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--editable" data-label="Điều phối">
                    <DispatchPlanEditorCell
                      row={row}
                      onAtomicSave={onAtomicSave}
                      onOpenTripReassign={onOpenTripReassign}
                    />
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--classification" data-label="Phân loại">
                    <span className="detailed-plan-grid__classification">
                      {DISPATCH_CLASSIFICATION_LABELS[row.classification]}
                    </span>
                  </td>
                  <td className="detailed-plan-grid__cell detailed-plan-grid__cell--notes" data-label="Ghi chú">
                    {row.notes.vehicleNote && (
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--notes">
                        Xe: {row.notes.vehicleNote}
                      </div>
                    )}
                    {row.notes.customerNote && (
                      <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                        Khách: {row.notes.customerNote}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
