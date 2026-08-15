import { Truck } from 'lucide-react';
import { EmptyState } from '../../../design-system';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';
import { PlateAssignmentCell } from './PlateAssignmentCell';
import { DetailedPlanFilters } from './DetailedPlanFilters';
import type { DetailedPlanFilterState, DetailPlanSortKey } from './useDispatchDetailPlan';
import './DetailedPlanGrid.css';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

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
  assignmentError: string | null;
  lotBanner: string | null;
  onClearLotBanner: () => void;
  sortKey: DetailPlanSortKey;
  onToggleSort: (key: 'runHour' | 'deliveryPoint') => void;
  onAssignPlate: (
    row: DispatchDetailPlanRow,
    body: { truckId?: number | null; externalCarrierVehicleId?: number | null; plateNumber?: string | null; clear?: boolean },
  ) => Promise<unknown>;
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
  assignmentError,
  lotBanner,
  onClearLotBanner,
  sortKey,
  onToggleSort,
  onAssignPlate,
}: DetailedPlanGridProps) {
  if (error) {
    return (
      <>
        <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} />
        <div className="dispatch-plan-page__error" role="alert">{error}</div>
      </>
    );
  }

  return (
    <>
      <DetailedPlanFilters filters={filters} onChange={onFilterChange} loadDeliveryPointFacets={loadDeliveryPointFacets} loadPickupPortFacets={loadPickupPortFacets} loadDropoffPortFacets={loadDropoffPortFacets} />

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
          <table className="detailed-plan-grid">
            <thead>
              <tr>
                <th>
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'runHour' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('runHour')}
                    aria-label="Sắp xếp theo giờ chạy"
                  >
                    Thời gian &amp; lịch trình {sortKey === 'runHour' ? '▲' : '↕'}
                  </button>
                </th>
                <th>
                  <button
                    type="button"
                    className={`detailed-plan-grid__sort${sortKey === 'deliveryPoint' ? ' is-sorted' : ''}`}
                    onClick={() => onToggleSort('deliveryPoint')}
                    aria-label="Sắp xếp theo điểm trả"
                  >
                    Khách hàng &amp; lộ trình {sortKey === 'deliveryPoint' ? '▲' : '↕'}
                  </button>
                </th>
                <th>Chứng từ</th>
                <th>Container</th>
                <th>Ghi chú</th>
                <th>Điều phối</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.fulfillmentId} className={`detailed-plan-grid__row${row.lotFullyPlated ? ' detailed-plan-grid__row--plated' : ''}`}>
                  <td className="detailed-plan-grid__cell">
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                      {row.docs.tradeDirection === 'IMPORT' ? 'Nhận:' : 'Giao:'} {formatDate(row.time.deliveryDate)}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                      Giờ: {row.time.runHour != null ? `${row.time.runHour}H` : '—'}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell">
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                      KH: {row.customerRoute.customerName}
                    </div>
                    <div className="detailed-plan-grid__line">
                      Nhà máy: {row.customerRoute.factoryName ?? '—'}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--muted detailed-plan-grid__line--italic">
                      Điểm trả: {row.customerRoute.deliveryPoint ?? '—'}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell">
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--strong">
                      Bill: {row.docs.billNumber ?? '—'}
                    </div>
                    <div className="detailed-plan-grid__line">
                      <span className={`detailed-plan-grid__badge${row.docs.tradeDirection === 'EXPORT' ? ' detailed-plan-grid__badge--export' : ' detailed-plan-grid__badge--import'}`}>
                        {row.docs.tradeDirection === 'EXPORT' ? 'XUẤT' : row.docs.tradeDirection === 'IMPORT' ? 'NHẬP' : '—'}
                      </span>
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell">
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
                  <td className="detailed-plan-grid__cell">
                    <div className="detailed-plan-grid__line">
                      Xe: {row.notes.vehicleNote ?? '—'}
                    </div>
                    <div className="detailed-plan-grid__line detailed-plan-grid__line--muted">
                      Khách: {row.notes.customerNote ?? '—'}
                    </div>
                  </td>
                  <td className="detailed-plan-grid__cell">
                    <PlateAssignmentCell row={row} onAssign={onAssignPlate} />
                    {row.lotFullyPlated && (
                      <div className="detailed-plan-grid__lot-flag">Đã phân xe</div>
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
