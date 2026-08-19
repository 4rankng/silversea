import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Badge } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { formatISODate } from '../../../lib/format';
import '../../../styles/operational-table-typography.css';
import './MasterPlanGrid.css';

interface MasterPlanGridProps {
  items: ShipmentListItem[];
  onAllocate: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
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
 * The API uses ` + ` to keep the grouped container demand machine-readable.
 * Render each type as its own operational line, while accepting summaries from
 * an older backend that still used `*` or `×` during a rolling deployment.
 */
function formatContainerSummaryLines(summary: string | null): string[] {
  if (!summary) return ['—'];

  return summary
    .split(/\s*\+\s*/)
    .map((part) => part.trim().replace(/^(\d+)\s*(?:\*|×|x)\s*/i, '$1 x '))
    .filter(Boolean);
}

/**
 * Multi-line dispatch master-plan grid (docx §3): 7 grouped columns, ≤3 lines
 * per cell, no horizontal scroll. Col 7 exposes its allocation values as the
 * edit trigger, matching the full-cell editing contract used by data grids.
 */
export function MasterPlanGrid({ items, onAllocate }: MasterPlanGridProps) {
  return (
    <div className="master-plan-grid__wrapper">
      <table className="master-plan-grid ops-table">
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
            <th scope="col">Thời gian &amp; lịch trình</th>
            <th scope="col">Khách hàng &amp; nhà máy</th>
            <th scope="col">Chứng từ &amp; hãng tàu</th>
            <th scope="col">Địa điểm nâng/hạ</th>
            <th scope="col">Tổng quan hàng hóa</th>
            <th scope="col">Ghi chú</th>
            <th scope="col">Phân bổ nhà xe</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const urgency = cutoffUrgency(item.customsCutoffAt);
            return (
              <tr key={item.id} className="master-plan-grid__row">
                <td className="master-plan-grid__cell" data-label="Thời gian & lịch trình">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">
                    Giao: {formatISODate(item.expectedDeliveryDate)}
                  </div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">
                    Giờ: {formatHour(item.plannedReturnAt ?? item.closingAt)}
                  </div>
                  <div className={`master-plan-grid__line${urgency === 'none' ? ' master-plan-grid__line--muted' : urgency === 'soon' ? ' master-plan-grid__line--soon' : ' master-plan-grid__line--urgent'}`}>
                    Hạn hoàn tất hải quan: {formatDateTime(item.customsCutoffAt)}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Khách hàng & nhà máy">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">{item.customerName ?? '—'}</div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">{item.factoryName ?? '—'}</div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">{item.deliveryLocation ?? '—'}</div>
                </td>
                <td className="master-plan-grid__cell" data-label="Chứng từ & hãng tàu">
                  <div className="master-plan-grid__documents">
                    <div className="master-plan-grid__line master-plan-grid__documents-bill">
                      {item.blNumber || item.bookingRef || '—'}
                    </div>
                    <div className="master-plan-grid__line master-plan-grid__documents-direction">
                      {item.tradeDirection === 'IMPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Nhập</Badge>
                      ) : item.tradeDirection === 'EXPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Xuất</Badge>
                      ) : '—'}
                    </div>
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__documents-carrier">{item.shippingLineName ?? '—'}</div>
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Địa điểm nâng/hạ">
                  <div className="master-plan-grid__line">Nâng: {item.pickupLocation ?? '—'}</div>
                  <div className="master-plan-grid__line">Hạ: {item.deliveryLocation ?? '—'}</div>
                </td>
                <td className="master-plan-grid__cell" data-label="Tổng quan hàng hóa">
                  <div className="master-plan-grid__cargo-summary">
                    {formatContainerSummaryLines(item.containerTypeSummary).map((summaryLine) => (
                      <div key={summaryLine} className="master-plan-grid__line master-plan-grid__line--strong">
                        {summaryLine}
                      </div>
                    ))}
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
                <td
                  className="master-plan-grid__cell master-plan-grid__cell--action"
                  data-label="Phân bổ nhà xe"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('button')) return;
                    const trigger = event.currentTarget.querySelector<HTMLButtonElement>('.master-plan-grid__allocation-trigger');
                    if (!trigger) return;
                    trigger.focus();
                    onAllocate(item, trigger);
                  }}
                >
                  <UUIButton
                    size="sm"
                    color="tertiary"
                    noTextPadding
                    aria-label="Chỉnh sửa phân bổ nhà xe"
                    className="master-plan-grid__allocation-trigger"
                    // The press target may be the button's inner text span — resolve
                    // back to the button itself for focus restoration.
                    onPress={(event) => onAllocate(item, (event.target as HTMLElement).closest('button') as HTMLButtonElement)}
                  >
                    <span className="master-plan-grid__allocation-label" aria-hidden="true">Phân bổ nhà xe</span>
                    {item.carrierAllocationSummary.length > 0 ? (
                      <span className="master-plan-grid__chips">
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
                              color="gray"
                              className="master-plan-grid__chip"
                            >
                              {counts ? `${entry.carrierLabel}: ${counts}` : entry.carrierLabel}
                            </Badge>
                          );
                        })}
                      </span>
                    ) : (
                      <span className="master-plan-grid__allocation-empty">Chưa phân bổ</span>
                    )}
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
