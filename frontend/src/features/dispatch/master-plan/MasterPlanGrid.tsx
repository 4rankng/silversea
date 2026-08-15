import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Badge } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import './MasterPlanGrid.css';

interface MasterPlanGridProps {
  items: ShipmentListItem[];
  onAllocate: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [year, month, day] = iso.slice(0, 10).split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('vi-VN');
}

/** Time-of-day line for col 1 — derived from the cutoff timestamp when present. */
function formatHour(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return '—';
  return `${date.getHours()}H`;
}

/** Cutoff proximity: orange within 3 days, red when overdue/today. */
function cutoffUrgency(iso: string | null | undefined): 'none' | 'soon' | 'urgent' {
  if (!iso) return 'none';
  const date = new Date(iso);
  if (isNaN(date.getTime())) return 'none';
  const days = (date.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
  if (days < 1) return 'urgent';
  if (days <= 3) return 'soon';
  return 'none';
}

function formatWeight(kg: number | null): string {
  if (kg == null) return '—';
  return `${new Intl.NumberFormat('vi-VN').format(kg)} kg`;
}

/**
 * Multi-line dispatch master-plan grid (docx §3): 7 grouped columns, ≤3 lines
 * per cell, no horizontal scroll. Col 7 hosts the allocation action (Phase 3).
 */
export function MasterPlanGrid({ items, onAllocate }: MasterPlanGridProps) {
  return (
    <div className="master-plan-grid__wrapper">
      <table className="master-plan-grid">
        <colgroup>
          <col className="master-plan-grid__col master-plan-grid__col--schedule" />
          <col className="master-plan-grid__col master-plan-grid__col--customer" />
          <col className="master-plan-grid__col master-plan-grid__col--documents" />
          <col className="master-plan-grid__col master-plan-grid__col--locations" />
          <col className="master-plan-grid__col master-plan-grid__col--cargo" />
          <col className="master-plan-grid__col master-plan-grid__col--notes" />
          <col className="master-plan-grid__col master-plan-grid__col--allocation" />
        </colgroup>
        <thead>
          <tr>
            <th>Thời gian &amp; lịch trình</th>
            <th>Khách hàng &amp; nhà máy</th>
            <th>Chứng từ &amp; hãng tàu</th>
            <th>Địa điểm nâng/hạ</th>
            <th>Tổng quan hàng hóa</th>
            <th>Ghi chú</th>
            <th>Phân bổ nhà xe</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const urgency = cutoffUrgency(item.customsCutoffAt);
            return (
              <tr key={item.id} className="master-plan-grid__row">
                <td className="master-plan-grid__cell" data-label="Thời gian & lịch trình">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">
                    Giao: {formatDate(item.expectedDeliveryDate)}
                  </div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">
                    Giờ: {formatHour(item.plannedReturnAt ?? item.closingAt)}
                  </div>
                  <div className={`master-plan-grid__line${urgency === 'none' ? ' master-plan-grid__line--muted' : urgency === 'soon' ? ' master-plan-grid__line--soon' : ' master-plan-grid__line--urgent'}`}>
                    Cutoff: {formatDateTime(item.customsCutoffAt)}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Khách hàng & nhà máy">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">{item.customerName ?? '—'}</div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">{item.factoryName ?? '—'}</div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">{item.deliveryLocation ?? '—'}</div>
                </td>
                <td className="master-plan-grid__cell" data-label="Chứng từ & hãng tàu">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">
                    {item.blNumber || item.bookingRef || '—'}
                  </div>
                  <div className="master-plan-grid__line">
                    {item.tradeDirection === 'IMPORT' ? (
                      <Badge type="pill-color" size="sm" color="blue">Nhập</Badge>
                    ) : item.tradeDirection === 'EXPORT' ? (
                      <Badge type="pill-color" size="sm" color="orange">Xuất</Badge>
                    ) : '—'}
                  </div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">{item.shippingLineName ?? '—'}</div>
                </td>
                <td className="master-plan-grid__cell" data-label="Địa điểm nâng/hạ">
                  <div className="master-plan-grid__line">Nâng: {item.pickupLocation ?? '—'}</div>
                  <div className="master-plan-grid__line">Hạ: {item.deliveryLocation ?? '—'}</div>
                </td>
                <td className="master-plan-grid__cell" data-label="Tổng quan hàng hóa">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">
                    {item.containerTypeSummary ?? '—'}
                  </div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">
                    {formatWeight(item.totalCargoWeightKg)}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Ghi chú">
                  <div className="master-plan-grid__line master-plan-grid__line--notes" title={item.operationalNotes ?? undefined}>
                    {item.operationalNotes ?? '—'}
                  </div>
                </td>
                <td className="master-plan-grid__cell master-plan-grid__cell--action" data-label="Phân bổ nhà xe">
                  {item.carrierAllocationSummary.length > 0 && (
                    <div className="master-plan-grid__chips">
                      {item.carrierAllocationSummary.map((entry) => {
                        const counts = [
                          entry.count20 > 0 ? `${entry.count20}x20'` : null,
                          entry.count40 > 0 ? `${entry.count40}x40'` : null,
                        ].filter(Boolean).join(' · ');
                        return (
                          <Badge
                            key={`${entry.carrierType}-${entry.externalCarrierId}`}
                            type="pill-color"
                            size="sm"
                            color="indigo"
                            className="master-plan-grid__chip"
                          >
                            {counts ? `${entry.carrierLabel}: ${counts}` : entry.carrierLabel}
                          </Badge>
                        );
                      })}
                    </div>
                  )}
                  <UUIButton
                    size="sm"
                    color="secondary"
                    className="master-plan-grid__allocate-btn"
                    // The press target may be the button's inner text span — resolve
                    // back to the button itself for focus restoration.
                    onPress={(event) => onAllocate(item, (event.target as HTMLElement).closest('button') as HTMLButtonElement)}
                  >
                    {item.allocationStatus === 'FULLY_ALLOCATED' ? 'Sửa phân bổ' : 'Phân bổ'}
                  </UUIButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
