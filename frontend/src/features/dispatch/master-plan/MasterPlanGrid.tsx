import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Badge } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import {
  appointmentGroupFactorySegment,
  formatAppointmentGroupLine,
} from '../../shipments/cus/cusUtils';
import { formatISODate } from '../../../lib/format';
import '../../../styles/operational-table-typography.css';
import './MasterPlanGrid.css';

interface MasterPlanGridProps {
  items: ShipmentListItem[];
  onAllocate: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  onViewContainers?: (shipment: ShipmentListItem, trigger: HTMLButtonElement) => void;
  /** Active single-day view (YYYY-MM-DD) — when set, each row's schedule
   *  lines show only that day's đóng/trả appointments. */
  scheduleDate?: string | null;
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

/**
 * Per-container appointment line projection for the master-plan "Giờ:" cell.
 *
 * EPIC 2.4 mapping: the create form's "Ngày giờ đóng trả" field is per
 * container, so the lot's close/return time is N values, not one. Render one
 * display line per group ("09:00 25/08/2026 · Sunrise · 1x40HC"), matching
 * the CUS workspace contract. When no per-container appointment is set we
 * fall back to the shipment-level `plannedReturnAt ?? closingAt` so the
 * master plan never silently drops a schedule that is genuinely only
 * stored at the shipment level (legacy data).
 */
function formatAppointmentGroupLines(item: ShipmentListItem, scheduleDate?: string | null): string[] {
  if (item.appointmentGroups && item.appointmentGroups.length > 0) {
    const groups = scheduleDate
      ? item.appointmentGroups.filter((group) => group.localDate === scheduleDate)
      : item.appointmentGroups;
    return groups.map((group) => (
      `${formatAppointmentGroupLine(group.at, group.localDate)}${appointmentGroupFactorySegment(group.factoryName)} · ${group.containerSummary}`
    ));
  }
  const fallback = formatHour(item.plannedReturnAt ?? item.closingAt);
  return fallback === '—' ? [] : [fallback];
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

type ContainerPortGroupLine = {
  direction: 'lift' | 'drop';
  label: 'Nâng' | 'Hạ';
  portName: string;
  containerSummary: string | null;
};

function formatContainerPortGroupLines(item: ShipmentListItem): ContainerPortGroupLine[] {
  const containerPortGroups = item.containerPortGroups ?? [];
  if (containerPortGroups.length > 0) {
    return containerPortGroups.flatMap((group) => [
      {
        direction: 'lift',
        label: 'Nâng',
        portName: group.pickupPortName ?? '—',
        containerSummary: group.containerSummary,
      },
      {
        direction: 'drop',
        label: 'Hạ',
        portName: group.dropoffPortName ?? '—',
        containerSummary: group.containerSummary,
      },
    ]);
  }
  return [
    { direction: 'lift', label: 'Nâng', portName: '—', containerSummary: null },
    { direction: 'drop', label: 'Hạ', portName: '—', containerSummary: null },
  ];
}

/**
 * Multi-line dispatch master-plan grid (docx §3): 7 grouped columns with
 * grouped lift/drop pairs and no horizontal scroll. Col 7 exposes its
 * allocation values as the edit trigger, matching the full-cell editing
 * contract used by data grids.
 */
export function MasterPlanGrid({ items, onAllocate, onViewContainers = () => {}, scheduleDate }: MasterPlanGridProps) {
  return (
    <div className="master-plan-grid__wrapper">
      <table className="master-plan-grid ops-table">
        <colgroup>
          <col className="master-plan-grid__col master-plan-grid__col--schedule" />
          <col className="master-plan-grid__col master-plan-grid__col--customer" />
          <col className="master-plan-grid__col master-plan-grid__col--documents" />
          <col className="master-plan-grid__col master-plan-grid__col--locations" />
          <col className="master-plan-grid__col master-plan-grid__col--cargo" />
          <col className="master-plan-grid__col master-plan-grid__col--allocation" />
          <col className="master-plan-grid__col master-plan-grid__col--notes" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Thời gian &amp; lịch trình</th>
            <th scope="col">Khách hàng &amp; nhà máy</th>
            <th scope="col">Chứng từ &amp; hãng tàu</th>
            <th scope="col">Địa điểm nâng/hạ</th>
            <th scope="col">Tổng quan hàng hóa</th>
            <th scope="col">Phân bổ nhà xe</th>
            <th scope="col">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const urgency = cutoffUrgency(item.customsCutoffAt);
            return (
              <tr key={item.id} className="master-plan-grid__row">
                <td className="master-plan-grid__cell" data-label="Thời gian & lịch trình">
                  <div className="master-plan-grid__line">
                    Lịch cont sớm nhất: {formatISODate(item.expectedDeliveryDate)}
                  </div>
                  {(item.containersMissingAppointment ?? 0) > 0 && (item.containerTotal ?? 0) > 0 && (
                    <div
                      className="master-plan-grid__line master-plan-grid__line--urgent"
                      role="status"
                    >
                      Cảnh báo: Còn {item.containersMissingAppointment}/{item.containerTotal} cont chưa chốt ngày đóng trả
                    </div>
                  )}
                  {formatAppointmentGroupLines(item, scheduleDate).map((line, lineIdx) => (
                    <div
                      key={`${item.id}-${lineIdx}-${line}`}
                      className="master-plan-grid__line master-plan-grid__line--muted"
                    >
                      {line}
                    </div>
                  ))}
                  {item.customsCutoffAt && (
                    <div className={`master-plan-grid__line${urgency === 'soon' ? ' master-plan-grid__line--soon' : ' master-plan-grid__line--urgent'}`}>
                      Hạn hoàn tất hải quan: {formatDateTime(item.customsCutoffAt)}
                    </div>
                  )}
                </td>
                <td className="master-plan-grid__cell" data-label="Khách hàng & nhà máy">
                  <div className="master-plan-grid__line master-plan-grid__line--strong">{item.customerName ?? '—'}</div>
                  <div className="master-plan-grid__line">{item.factoryNames && item.factoryNames.length > 0 ? item.factoryNames.join(' + ') : item.factoryName ?? '—'}</div>
                  <div className="master-plan-grid__line master-plan-grid__line--strong">{item.routeName ?? '—'}</div>
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
                  {formatContainerPortGroupLines(item).map((line, index) => (
                    <div key={`${index}-${line.direction}-${line.portName}`} className="master-plan-grid__location-block">
                      <div className={`master-plan-grid__line master-plan-grid__location-label master-plan-grid__location-label--${line.direction}`}>
                        {line.label}:
                      </div>
                      <div className="master-plan-grid__line master-plan-grid__location-value">
                        {line.portName}{line.containerSummary ? ` · ${line.containerSummary}` : ''}
                      </div>
                    </div>
                  ))}
                </td>
                <td className="master-plan-grid__cell" data-label="Tổng quan hàng hóa">
                  <div className="master-plan-grid__cargo-summary">
                    {formatContainerSummaryLines(item.containerTypeSummary).map((summaryLine) => (
                      <div key={summaryLine} className="master-plan-grid__line">
                        {summaryLine}
                      </div>
                    ))}
                  </div>
                  <div className="master-plan-grid__line master-plan-grid__line--muted">
                    {formatWeight(item.totalCargoWeightKg)}
                  </div>
                  <UUIButton
                    size="xs"
                    color="tertiary"
                    className="master-plan-grid__container-detail-trigger"
                    aria-label={`Xem chi tiết container của ${item.shipmentCode ?? item.blNumber ?? item.bookingRef ?? 'lô hàng'}`}
                    onPress={(event) => onViewContainers(item, (event.target as HTMLElement).closest('button') as HTMLButtonElement)}
                  >
                    Xem chi tiết cont
                  </UUIButton>
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
                    // The press target may be button's inner text span — resolve
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
                <td className="master-plan-grid__cell" data-label="Ghi chú">
                  <div className="master-plan-grid__line master-plan-grid__line--notes" title={item.operationalNotes ?? undefined}>
                    {item.operationalNotes ?? '—'}
                  </div>
                  {item.factoryNotes && (
                    <div className="master-plan-grid__line master-plan-grid__line--muted master-plan-grid__line--notes" title={item.factoryNotes}>
                      NM: {item.factoryNotes}
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
