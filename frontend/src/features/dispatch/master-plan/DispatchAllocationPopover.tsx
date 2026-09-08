import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  getCusShipmentWorkspaceDetail,
  saveShipmentCarrierAllocations,
  type ShipmentCarrierAllocationSummaryEntry,
  type ShipmentListItem,
} from '../../../api/shipmentClient';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { CloseButton } from '../../../components/untitled-ui/base/buttons/close-button';
import {
  AllocationDayGroup,
  AllocationRow,
  buildInitialDayGroups,
  syncDayGroupsWithContainers,
  toEmptyRow,
  validateDayGroups,
} from './allocationDayHelpers';
import { DispatchAllocationDaySection } from './DispatchAllocationDaySection';
import { useCarrierAllocationOptions } from './useCarrierAllocationOptions';
import './DispatchAllocationPopover.css';

interface DispatchAllocationPopoverProps {
  shipment: ShipmentListItem;
  onClose: () => void;
  /** Called with the refreshed row after a successful save. */
  onSaved: (updated: ShipmentListItem) => void;
  /** The master-plan action that opened this dialog, restored after it closes. */
  returnFocusTarget?: HTMLElement | null;
}

/**
 * "Phân bổ phương tiện" popover (docx §4, TC-DV-DISPATCH-043):
 * Separates carrier allocation by packing/return date for multi-date lots,
 * with MAX-mode validation and partial saves supported.
 */
export function DispatchAllocationPopover({ shipment, onClose, onSaved, returnFocusTarget }: DispatchAllocationPopoverProps) {
  const { options, loading: optionsLoading, error: optionsError, empty: optionsEmpty, reload: reloadOptions } = useCarrierAllocationOptions();
  const [days, setDays] = useState<AllocationDayGroup[]>(() => buildInitialDayGroups(shipment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const hasUserEdited = useRef(false);

  useEffect(() => {
    let active = true;
    getCusShipmentWorkspaceDetail(shipment.id)
      .then((detail) => {
        if (!active || hasUserEdited.current) return;
        if (detail && Array.isArray(detail.containers) && detail.containers.length > 0) {
          const synced = syncDayGroupsWithContainers(detail.containers);
          if (synced.length > 0) {
            setDays(synced);
          }
        }
      })
      .catch(() => {
        // Graceful fallback to initial day groups derived from appointmentGroups
      });
    // Re-sync only on shipment change: containers are carrier-agnostic, and
    // re-running on `options` churn would clobber the appointmentGroups
    // prefill while the bootstrap list is still loading.
    return () => { active = false; };
  }, [shipment.id]);

  useEffect(() => {
    const closeControl = dialogRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Đóng"]');
    (closeControl ?? dialogRef.current)?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusTarget?.focus();
    };
  }, [onClose, returnFocusTarget]);

  const demand = useMemo(() => ({
    count20: shipment.containerCount20,
    count40: shipment.containerCount40,
  }), [shipment]);

  const validation = useMemo(
    () => validateDayGroups(days, demand, options),
    [days, demand, options],
  );

  const hasUserAllocations = days.some((day) =>
    day.rows.some((row) => Number(row.count20 || 0) > 0 || Number(row.count40 || 0) > 0),
  );

  const isMultiDay = days.length > 1;

  const updateRow = (dayIndex: number, rowIndex: number, patch: Partial<AllocationRow>) => {
    hasUserEdited.current = true;
    setDays((prev) => prev.map((d, di) => {
      if (di !== dayIndex) return d;
      return {
        ...d,
        rows: d.rows.map((r, ri) => (ri === rowIndex ? { ...r, ...patch } : r)),
      };
    }));
  };

  const addRow = (dayIndex: number) => {
    hasUserEdited.current = true;
    const targetDay = days[dayIndex];
    if (!targetDay) return;
    const usedKeys = new Set(targetDay.rows.map((row) => row.carrierKey));
    const next = options.find((option) => !usedKeys.has(option.key) && option.isActive !== false);
    if (!next) return;

    setDays((prev) => prev.map((d, di) => {
      if (di !== dayIndex) return d;
      return { ...d, rows: [...d.rows, toEmptyRow(next.key)] };
    }));

    window.requestAnimationFrame(() => {
      const rowIndex = targetDay.rows.length;
      const selector = isMultiDay
        ? `[data-allocation-row="${dayIndex}-${rowIndex}"] .dispatch-allocation-popover__fields button`
        : `[data-allocation-row="${rowIndex}"] .dispatch-allocation-popover__fields button`;
      dialogRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };

  const removeRow = (dayIndex: number, rowIndex: number) => {
    hasUserEdited.current = true;
    const targetDay = days[dayIndex];
    if (!targetDay || targetDay.rows.length <= 1) return;

    setDays((prev) => prev.map((d, di) => {
      if (di !== dayIndex) return d;
      return { ...d, rows: d.rows.filter((_, i) => i !== rowIndex) };
    }));

    window.requestAnimationFrame(() => {
      const nextIndex = Math.max(0, Math.min(rowIndex, targetDay.rows.length - 2));
      const selector = isMultiDay
        ? `[data-allocation-row="${dayIndex}-${nextIndex}"] .dispatch-allocation-popover__fields button`
        : `[data-allocation-row="${nextIndex}"] .dispatch-allocation-popover__fields button`;
      dialogRef.current?.querySelector<HTMLButtonElement>(selector)?.focus();
    });
  };

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleSave = async () => {
    if (validation.hasErrors || saving) return;
    setSaving(true);
    setError(null);
    try {
      const carrierAllocations = days.flatMap((day) =>
        day.rows
          .filter((row) => row.carrierKey && (Number(row.count20 || 0) > 0 || Number(row.count40 || 0) > 0))
          .map((row) => {
            const option = options.find((candidate) => candidate.key === row.carrierKey);
            return {
              carrierType: option?.carrierType ?? ('OWN' as const),
              externalCarrierId: option?.externalCarrierId ?? null,
              count20: Number(row.count20 || 0),
              count40: Number(row.count40 || 0),
              appointmentDate: (day.dateKey === '__UNSCHEDULED__' || day.dateKey === '__ALL__') ? null : day.dateKey,
            };
          }),
      );

      const response = await saveShipmentCarrierAllocations(
        shipment.id,
        {
          expectedVersion: shipment.version,
          carrierAllocations,
        },
        undefined,
        'partial',
      );

      const summaryByCarrier = new Map<string, ShipmentCarrierAllocationSummaryEntry>();
      for (const alloc of carrierAllocations) {
        const key = alloc.carrierType === 'OWN' ? 'OWN' : `EXTERNAL:${alloc.externalCarrierId}`;
        const option = options.find((o) => o.key === key);
        const label = option?.carrierType === 'OWN' ? 'SilverSea' : option?.label ?? 'Nhà xe chưa xác định';
        const cur = summaryByCarrier.get(key) ?? {
          carrierType: alloc.carrierType,
          externalCarrierId: alloc.externalCarrierId,
          carrierLabel: label,
          count20: 0,
          count40: 0,
        };
        cur.count20 += alloc.count20;
        cur.count40 += alloc.count40;
        summaryByCarrier.set(key, cur);
      }
      const summary = [...summaryByCarrier.values()].filter((e) => e.count20 > 0 || e.count40 > 0);

      onSaved({
        ...shipment,
        version: response.shipment.version,
        carrierAllocationSummary: summary,
        allocationStatus: validation.totalAssigned20 >= demand.count20 && validation.totalAssigned40 >= demand.count40
          ? 'FULLY_ALLOCATED'
          : 'PARTIALLY_ALLOCATED',
      });
      onClose();
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 409) {
        setError('Lô hàng đã thay đổi. Vui lòng đóng và mở lại để lấy số liệu mới.');
      } else {
        setError('Không thể lưu phân bổ. Vui lòng thử lại.');
      }
      setSaving(false);
    }
  };

  let globalRowOffset = 0;

  return (
    <div className="dispatch-allocation-popover__overlay" onClick={onClose}>
      <div
        ref={dialogRef}
        className="dispatch-allocation-popover"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dispatch-allocation-title"
        aria-describedby="dispatch-allocation-description"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dispatch-allocation-popover__header">
          <div className="dispatch-allocation-popover__heading">
            <p className="dispatch-allocation-popover__eyebrow">Kế hoạch tổng quát</p>
            <h3 id="dispatch-allocation-title">Phân bổ nhà xe</h3>
            <div className="dispatch-allocation-popover__shipment">
              <strong>{shipment.blNumber || shipment.bookingRef || shipment.shipmentCode}</strong>
              <span>{shipment.customerName ?? 'Chưa có tên khách hàng'}</span>
            </div>
          </div>
          <CloseButton size="xs" label="Đóng" slot={null} onPress={onClose} />
        </div>
        <p id="dispatch-allocation-description" className="dispatch-allocation-popover__description">
          {isMultiDay
            ? 'Lô hàng có nhiều ngày đóng/trả khác nhau. Phân bổ nhà xe và số container cho từng ngày.'
            : 'Chọn nhà xe và số container giao cho từng đơn vị. Có thể lưu khi chưa phân đủ và bổ sung sau.'}
        </p>

        <section className={`dispatch-allocation-popover__summary is-${validation.overallState}`} aria-labelledby="dispatch-allocation-summary-title">
          <div className="dispatch-allocation-popover__summary-heading">
            <div>
              <h4 id="dispatch-allocation-summary-title">Tổng phân bổ{isMultiDay ? ' toàn lô' : ''}</h4>
              <p>Không được phân vượt nhu cầu của lô hàng.</p>
            </div>
            <span className="dispatch-allocation-popover__state" aria-live="polite">
              {validation.overallState === 'error' ? 'Cần điều chỉnh' : validation.overallState === 'complete' ? 'Đã phân đủ' : 'Chưa phân đủ'}
            </span>
          </div>
          <div className="dispatch-allocation-popover__balance" role="table" aria-label="Tổng số container đã phân bổ">
            <div className="dispatch-allocation-popover__balance-header" role="row">
              <span role="columnheader">Loại</span>
              <span role="columnheader">Nhu cầu</span>
              <span role="columnheader">Đã phân</span>
              <span role="columnheader">Còn lại</span>
            </div>
            <div className="dispatch-allocation-popover__balance-row" role="row">
              <strong role="rowheader">20'</strong>
              <span role="cell">{demand.count20}</span>
              <span role="cell">{validation.totalAssigned20}</span>
              <strong role="cell">{validation.overallState === 'error' ? validation.totalRemaining20 : Math.max(0, validation.totalRemaining20)}</strong>
            </div>
            <div className="dispatch-allocation-popover__balance-row" role="row">
              <strong role="rowheader">40'</strong>
              <span role="cell">{demand.count40}</span>
              <span role="cell">{validation.totalAssigned40}</span>
              <strong role="cell">{validation.overallState === 'error' ? validation.totalRemaining40 : Math.max(0, validation.totalRemaining40)}</strong>
            </div>
          </div>
        </section>

        {!isMultiDay && (
          <div className="dispatch-allocation-popover__section-head">
            <div>
              <h4>Phân bổ theo nhà xe</h4>
              <p>Mỗi nhà xe chỉ xuất hiện một lần.</p>
            </div>
          </div>
        )}

        {days.map((day, dayIndex) => {
          const section = (
            <DispatchAllocationDaySection
              key={day.dateKey}
              day={day}
              dayIndex={dayIndex}
              isMultiDay={isMultiDay}
              validation={validation.dayResults[dayIndex]!}
              options={options}
              optionsLoading={optionsLoading}
              globalRowOffset={globalRowOffset}
              onUpdateRow={updateRow}
              onAddRow={addRow}
              onRemoveRow={removeRow}
            />
          );
          globalRowOffset += day.rows.length;
          return section;
        })}

        {optionsError && (
          <div className="dispatch-allocation-popover__notice is-warning" role="alert">
            <span>Không tải được danh sách nhà xe ngoài. Bạn vẫn có thể dùng đội xe nội bộ hoặc thử tải lại.</span>
            <UUIButton size="sm" color="secondary" onPress={reloadOptions}>Tải lại</UUIButton>
          </div>
        )}
        {optionsEmpty && !optionsError && !hasUserAllocations && (
          <div className="dispatch-allocation-popover__notice is-warning" role="status" data-testid="carrier-allocation-empty-externals">
            <span>Chưa có nhà xe ngoài nào được cấu hình. Liên hệ Quản trị viên để bật cờ isCarrier trong danh mục Khách hàng.</span>
          </div>
        )}
        <div className={`dispatch-allocation-popover__notice dispatch-allocation-popover__allocation-note is-${validation.overallState}`} role={validation.overallState === 'error' ? 'alert' : 'status'}>
          {validation.overallState === 'error' ? (
            <ul>
              {[...new Set(validation.allErrors)].map((validationError) => <li key={validationError}>{validationError}</li>)}
            </ul>
          ) : validation.overallState === 'complete' ? (
            <span>Đã phân bổ đủ số container của lô hàng.</span>
          ) : (
            <span>
              Có thể lưu phân bổ hiện tại và bổ sung sau. Còn {Math.max(0, validation.totalRemaining20)} container 20' và {Math.max(0, validation.totalRemaining40)} container 40'.
            </span>
          )}
        </div>
        {error && (
          <div className="dispatch-allocation-popover__notice is-error" role="alert">{error}</div>
        )}

        <div className="dispatch-allocation-popover__actions">
          <UUIButton size="sm" color="secondary" onPress={onClose} isDisabled={saving}>Hủy</UUIButton>
          <UUIButton
            size="sm"
            color="primary"
            className="dispatch-allocation-popover__save"
            onPress={handleSave}
            isDisabled={validation.hasErrors || saving}
            isLoading={saving}
          >
            {saving ? 'Đang lưu…' : 'Lưu phân bổ'}
          </UUIButton>
        </div>
      </div>
    </div>
  );
}
