import { useCallback, useRef, useState } from 'react';
import { ShipmentStatus } from '@tingting/shared';
import type { ShipmentListItem } from '../../../api/shipmentClient';
import { Badge } from '../../../components/untitled-ui/base/badges/badges';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import {
  appointmentGroupFactorySegment,
  displayNote,
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
  /** Called when dispatch staff saves an inline operational-notes edit. */
  onUpdateNotes?: (shipment: ShipmentListItem, notes: string) => void;
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

/** Parsed container-type demand bucket: type label → count.
 *  Insertion order is preserved so the formatted output stays deterministic. */
type ContainerTypeCounts = Map<string, number>;

/**
 * Parse a `containerSummary` string ("1 x 40DC + 1 x 20DC") into a type→count
 * map. Accepts `*` / `×` / `x` separators (rolling-deployment tolerance).
 * Returns null for empty/invalid input so callers can keep the original
 * `null` semantics instead of forcing a fake zero.
 */
function parseContainerTypeCounts(summary: string | null | undefined): ContainerTypeCounts | null {
  if (!summary) return null;
  const counts: ContainerTypeCounts = new Map();
  const parts = summary.split(/\s*\+\s*/);
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    const match = part.match(/^(\d+)\s*(?:\*|×|x)\s*([A-Za-z0-9]+)\s*$/);
    if (!match) continue;
    const qty = Number.parseInt(match[1], 10);
    const type = match[2];
    if (!Number.isFinite(qty) || qty <= 0) continue;
    counts.set(type, (counts.get(type) ?? 0) + qty);
  }
  return counts.size > 0 ? counts : null;
}

/** Render a type→count map back to the operational "1 x 40DC + 1 x 20DC"
 *  shape. Insertion order is preserved so the first appearance order drives
 *  the line order (matches the CUS workspace contract). */
function formatContainerTypeCounts(counts: ContainerTypeCounts): string {
  return Array.from(counts.entries())
    .map(([type, qty]) => `${qty} x ${type}`)
    .join(' + ');
}

type ContainerPortGroupLine = {
  direction: 'lift' | 'drop';
  label: 'Nâng' | 'Hạ';
  portName: string;
  containerSummary: string | null;
};

type ContainerPortGroupKey = string;

/**
 * The backend exposes one `containerPortGroup` per appointment instant (per-day
 * when a lot splits across close/return dates), so a single shipment can carry
 * N groups for the SAME (pickup → dropoff) pair — each with a partial
 * container count. Dispatch needs the TOTAL demand per lift/drop pair, not
 * the per-day split. We aggregate groups by (pickup, dropoff) and sum the
 * container-type counts so each port column reads "Cảng HP · 3 x 40DC"
 * instead of three "1 x 40DC" lines.
 *
 * Customer feedback L2 (24/08/2026) — when `scheduleDate` is set, only
 * groups whose `localDate` matches are aggregated, so the cảng cells reflect
 * only the conts running on that day.
 */
function aggregateContainerPortGroupLines(item: ShipmentListItem, scheduleDate?: string | null): ContainerPortGroupLine[] {
  const allGroups = item.containerPortGroups ?? [];
  const containerPortGroups = scheduleDate
    ? allGroups.filter((group) => group.localDate === scheduleDate)
    : allGroups;
  if (containerPortGroups.length === 0) {
    if (allGroups.length === 0) {
      return [
        { direction: 'lift', label: 'Nâng', portName: '—', containerSummary: null },
        { direction: 'drop', label: 'Hạ', portName: '—', containerSummary: null },
      ];
    }
    // Date filter active but no conts on that day — render placeholders
    return [
      { direction: 'lift', label: 'Nâng', portName: '—', containerSummary: null },
      { direction: 'drop', label: 'Hạ', portName: '—', containerSummary: null },
    ];
  }

  const aggregated = new Map<ContainerPortGroupKey, {
    pickup: string | null;
    dropoff: string | null;
    counts: ContainerTypeCounts;
  }>();

  for (const group of containerPortGroups) {
    const key = `${group.pickupPortName ?? ''}__${group.dropoffPortName ?? ''}`;
    const existing = aggregated.get(key);
    if (existing) {
      const parsed = parseContainerTypeCounts(group.containerSummary);
      if (parsed) {
        for (const [type, qty] of parsed.entries()) {
          existing.counts.set(type, (existing.counts.get(type) ?? 0) + qty);
        }
      }
    } else {
      aggregated.set(key, {
        pickup: group.pickupPortName,
        dropoff: group.dropoffPortName,
        counts: parseContainerTypeCounts(group.containerSummary) ?? new Map(),
      });
    }
  }

  return Array.from(aggregated.values()).flatMap((entry) => {
    const liftName = entry.pickup ?? '—';
    const dropName = entry.dropoff ?? '—';
    const summary = entry.counts.size > 0 ? formatContainerTypeCounts(entry.counts) : null;
    return [
      { direction: 'lift' as const, label: 'Nâng' as const, portName: liftName, containerSummary: summary },
      { direction: 'drop' as const, label: 'Hạ' as const, portName: dropName, containerSummary: summary },
    ];
  });
}

/**
 * Multi-line dispatch master-plan grid (docx §3): 8 grouped columns with
 * distinct lift/drop port columns and no horizontal scroll. The allocation column exposes its
 * allocation values as the edit trigger, matching the full-cell editing
 * contract used by data grids.
 */
export function MasterPlanGrid({ items, onAllocate, onViewContainers = () => {}, scheduleDate, onUpdateNotes }: MasterPlanGridProps) {
  const [editingNotesId, setEditingNotesId] = useState<number | null>(null);
  const [editingNotesValue, setEditingNotesValue] = useState('');
  const notesInputRef = useRef<HTMLTextAreaElement | null>(null);

  const startNotesEdit = useCallback((item: ShipmentListItem) => {
    setEditingNotesId(item.id);
    setEditingNotesValue(item.operationalNotes ?? '');
    // Focus the textarea after React renders it.
    requestAnimationFrame(() => notesInputRef.current?.focus());
  }, []);

  const cancelNotesEdit = useCallback(() => {
    setEditingNotesId(null);
    setEditingNotesValue('');
  }, []);

  const saveNotesEdit = useCallback((item: ShipmentListItem) => {
    const trimmed = editingNotesValue.trim();
    if (trimmed !== (item.operationalNotes ?? '')) {
      onUpdateNotes?.(item, trimmed);
    }
    setEditingNotesId(null);
    setEditingNotesValue('');
  }, [editingNotesValue, onUpdateNotes]);

  return (
    <div className="master-plan-grid__wrapper">
      <table className="master-plan-grid ops-table">
        <colgroup>
          <col className="master-plan-grid__col master-plan-grid__col--schedule" />
          <col className="master-plan-grid__col master-plan-grid__col--customer" />
          <col className="master-plan-grid__col master-plan-grid__col--route-shipping" />
          <col className="master-plan-grid__col master-plan-grid__col--lift-port" />
          <col className="master-plan-grid__col master-plan-grid__col--drop-port" />
          <col className="master-plan-grid__col master-plan-grid__col--cargo" />
          <col className="master-plan-grid__col master-plan-grid__col--allocation" />
          <col className="master-plan-grid__col master-plan-grid__col--notes" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Thời gian &amp; lịch trình</th>
            <th scope="col">Khách hàng &amp; nhà máy</th>
            <th scope="col">Tuyến đường &amp; hãng tàu</th>
            <th scope="col">Cảng nâng</th>
            <th scope="col">Cảng hạ</th>
            <th scope="col">Tổng quan hàng hóa</th>
            <th scope="col">Phân bổ nhà xe</th>
            <th scope="col">Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const urgency = cutoffUrgency(item.customsCutoffAt);
            const portGroupLines = aggregateContainerPortGroupLines(item, scheduleDate);
            // A completed lot's allocation is history — the backend rejects
            // carrier changes once the lot leaves READY_FOR_DISPATCH, so the
            // button must not invite the attempt.
            const allocationLocked = item.status === ShipmentStatus.COMPLETED;
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
                  <div className="master-plan-grid__line master-plan-grid__line--strong">
                    {item.blNumber || item.bookingRef || '—'}
                  </div>
                </td>
                <td className="master-plan-grid__cell" data-label="Tuyến đường & hãng tàu">
                  <div className="master-plan-grid__route-shipping">
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-route">
                      {item.routeName ?? '—'}
                    </div>
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-direction">
                      {item.tradeDirection === 'IMPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Nhập</Badge>
                      ) : item.tradeDirection === 'EXPORT' ? (
                        <Badge type="pill-color" size="sm" color="gray">Xuất</Badge>
                      ) : '—'}
                    </div>
                    <div className="master-plan-grid__line master-plan-grid__line--strong master-plan-grid__route-shipping-carrier">{item.shippingLineName ?? '—'}</div>
                  </div>
                </td>
                <td className="master-plan-grid__cell master-plan-grid__cell--lift-port" data-label="Cảng nâng">
                  {portGroupLines
                    .filter((line) => line.direction === 'lift')
                    .map((line, index) => (
                      <div key={`${index}-${line.portName}`} className="master-plan-grid__location-block">
                        <div className="master-plan-grid__line master-plan-grid__location-value">{line.portName}</div>
                        {line.containerSummary && formatContainerSummaryLines(line.containerSummary).map((summaryLine) => (
                          <div key={summaryLine} className="master-plan-grid__line master-plan-grid__location-value">{summaryLine}</div>
                        ))}
                      </div>
                    ))}
                </td>
                <td className="master-plan-grid__cell master-plan-grid__cell--drop-port" data-label="Cảng hạ">
                  {portGroupLines
                    .filter((line) => line.direction === 'drop')
                    .map((line, index) => (
                      <div key={`${index}-${line.portName}`} className="master-plan-grid__location-block">
                        <div className="master-plan-grid__line master-plan-grid__location-value">{line.portName}</div>
                        {line.containerSummary && formatContainerSummaryLines(line.containerSummary).map((summaryLine) => (
                          <div key={summaryLine} className="master-plan-grid__line master-plan-grid__location-value">{summaryLine}</div>
                        ))}
                      </div>
                    ))}
                </td>
                <td className="master-plan-grid__cell" data-label="Tổng quan hàng hóa">
                  <div className="master-plan-grid__cargo-summary">
                    {(() => {
                      // Customer feedback L2 — when a single-day filter is
                      // applied, show the per-day cont count from
                      // appointmentGroups instead of the master lô totals.
                      const dayGroups = scheduleDate
                        ? (item.appointmentGroups ?? []).filter((g) => g.localDate === scheduleDate)
                        : [];
                      const daySummary = dayGroups.length > 0
                        ? (() => {
                            const merged = new Map<string, number>();
                            for (const group of dayGroups) {
                              for (const piece of (group.containerSummary || '').split(/\s*\+\s*/)) {
                                const trimmed = piece.trim();
                                const match = trimmed.match(/^(\d+)\s*[x*×]\s*(.+)$/i);
                                if (match) {
                                  const qty = Number(match[1]);
                                  const label = match[2].trim();
                                  merged.set(label, (merged.get(label) ?? 0) + qty);
                                }
                              }
                            }
                            if (merged.size === 0) return null;
                            return Array.from(merged.entries())
                              .map(([label, qty]) => `${qty} x ${label}`)
                              .join(' + ');
                          })()
                        : null;
                      const summaryToShow = daySummary ?? item.containerTypeSummary;
                      return formatContainerSummaryLines(summaryToShow).map((summaryLine) => (
                        <div key={summaryLine} className="master-plan-grid__line">
                          {summaryLine}
                        </div>
                      ));
                    })()}
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
                    if (allocationLocked) return;
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
                    isDisabled={allocationLocked}
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
                  {editingNotesId === item.id ? (
                    <div className="master-plan-grid__notes-editor">
                      <textarea
                        ref={notesInputRef}
                        className="master-plan-grid__notes-input"
                        value={editingNotesValue}
                        onChange={(e) => setEditingNotesValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            saveNotesEdit(item);
                          }
                          if (e.key === 'Escape') cancelNotesEdit();
                        }}
                        rows={2}
                        maxLength={2000}
                        aria-label="Ghi chú điều phối"
                      />
                      <div className="master-plan-grid__notes-actions">
                        <button
                          type="button"
                          className="master-plan-grid__notes-save"
                          onClick={() => saveNotesEdit(item)}
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          className="master-plan-grid__notes-cancel"
                          onClick={cancelNotesEdit}
                        >
                          Hủy
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      {(item.operationalNotes || onUpdateNotes) && (
                        <div
                          className="master-plan-grid__line master-plan-grid__line--notes master-plan-grid__notes-trigger"
                          title={item.operationalNotes ?? 'Nhấn để thêm ghi chú'}
                          onClick={() => { if (onUpdateNotes) startNotesEdit(item); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (onUpdateNotes) startNotesEdit(item);
                            }
                          }}
                          role={onUpdateNotes ? 'button' : undefined}
                          tabIndex={onUpdateNotes ? 0 : undefined}
                        >
                          {displayNote(item.operationalNotes) || (onUpdateNotes ? '—' : '')}
                        </div>
                      )}
                      {item.factoryNotes && (
                        <div className="master-plan-grid__line master-plan-grid__line--muted master-plan-grid__line--notes" title={item.factoryNotes}>
                          NM: {item.factoryNotes}
                        </div>
                      )}
                    </>
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
