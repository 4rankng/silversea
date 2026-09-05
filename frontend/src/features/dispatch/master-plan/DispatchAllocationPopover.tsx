import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { tripClient } from '../../../api/tripClient';
import {
  saveShipmentCarrierAllocations,
  type ShipmentListItem,
} from '../../../api/shipmentClient';
import {
  carrierOptionKey,
  validateCarrierAllocations,
  type CarrierAllocationOption,
} from '../../../components/shipment/CarrierAllocationSummary';
import { Button as UUIButton } from '../../../components/untitled-ui/base/buttons/button';
import { CloseButton } from '../../../components/untitled-ui/base/buttons/close-button';
import { Input as UUIInput } from '../../../components/untitled-ui/base/input/input';
import { UuiSelectField } from '../../../design-system';
import './DispatchAllocationPopover.css';

const OWN_CARRIER_OPTION: CarrierAllocationOption = {
  key: 'OWN',
  label: 'Đội xe nội bộ SilverSea',
  carrierType: 'OWN',
  externalCarrierId: null,
  isActive: true,
};

interface AllocationRow {
  key: string;
  carrierKey: string;
  count20: string;
  count40: string;
}

function toRow(option: CarrierAllocationOption): AllocationRow {
  return { key: crypto.randomUUID(), carrierKey: option.key, count20: '', count40: '' };
}

function prefillRows(shipment: ShipmentListItem): AllocationRow[] {
  if (shipment.carrierAllocationSummary.length === 0) return [toRow(OWN_CARRIER_OPTION)];
  return shipment.carrierAllocationSummary.map((entry) => ({
    key: crypto.randomUUID(),
    carrierKey: carrierOptionKey(entry.carrierType, entry.externalCarrierId),
    count20: entry.count20 > 0 ? String(entry.count20) : '',
    count40: entry.count40 > 0 ? String(entry.count40) : '',
  }));
}

interface DispatchAllocationPopoverProps {
  shipment: ShipmentListItem;
  onClose: () => void;
  /** Called with the refreshed row after a successful save. */
  onSaved: (updated: ShipmentListItem) => void;
  /** The master-plan action that opened this dialog, restored after it closes. */
  returnFocusTarget?: HTMLElement | null;
}

/**
 * "Phân bổ phương tiện" popover (docx §4): repeater of vendor rows with
 * 20'/40' counts, MAX-mode validation (over-allocation blocks save, partial
 * allowed), save via the existing carrier-allocations API with 409 retry.
 */
export function DispatchAllocationPopover({ shipment, onClose, onSaved, returnFocusTarget }: DispatchAllocationPopoverProps) {
  const [options, setOptions] = useState<CarrierAllocationOption[]>([OWN_CARRIER_OPTION]);
  const [rows, setRows] = useState<AllocationRow[]>(() => prefillRows(shipment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState(false);
  const [optionsEmpty, setOptionsEmpty] = useState(false);
  const [optionsReloadKey, setOptionsReloadKey] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    setOptionsLoading(true);
    setOptionsError(false);
    setOptionsEmpty(false);
    tripClient.getBootstrap().then((bootstrap) => {
      if (cancelled) return;
      const external = (bootstrap.externalCarriers ?? []).map((carrier) => ({
        key: carrierOptionKey('EXTERNAL', carrier.id),
        label: carrier.name,
        carrierType: 'EXTERNAL' as const,
        externalCarrierId: carrier.id,
        isActive: carrier.isActive,
      }));
      setOptions([OWN_CARRIER_OPTION, ...external]);
      // Surface the "only OWN available" state explicitly so a dispatcher does
      // not assume the "Thêm nhà xe" button is broken when no external
      // carriers are configured yet. The notice points them at the admin role
      // (only ADMIN can flip `customers.isCarrier = true` via the catalog
      // CRUD, see `customer-intake.service.ts`).
      setOptionsEmpty(external.length === 0);
      setOptionsLoading(false);
    }).catch(() => {
      if (cancelled) return;
      setOptionsError(true);
      setOptionsLoading(false);
    });
    return () => { cancelled = true; };
  }, [optionsReloadKey]);

  useEffect(() => {
    // Focus the dialog's close control so keyboard users land somewhere
    // actionable; falls back to the dialog container itself.
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
    () => validateCarrierAllocations(rows, demand, options, 'MAX'),
    [rows, demand, options],
  );

  const remaining = useMemo(() => ({
    count20: demand.count20 - validation.assigned20,
    count40: demand.count40 - validation.assigned40,
  }), [demand, validation.assigned20, validation.assigned40]);

  const allocationState = validation.errors.length > 0
    ? 'error'
    : remaining.count20 === 0 && remaining.count40 === 0
      ? 'complete'
      : 'partial';

  const rowIssues = useMemo(() => {
    const optionByKey = new Map(options.map((option) => [option.key, option]));
    const carrierCounts = new Map<string, number>();
    rows.forEach((row) => carrierCounts.set(row.carrierKey, (carrierCounts.get(row.carrierKey) ?? 0) + 1));
    const validCount = (value: string) => value.trim() === '' || /^\d+$/.test(value.trim());
    const numericCount = (value: string) => (value.trim() === '' ? 0 : Number(value));

    return rows.map((row) => {
      const option = optionByKey.get(row.carrierKey);
      let carrier: string | null = null;
      let count20: string | null = null;
      let count40: string | null = null;

      if (!option) carrier = 'Chọn một nhà xe hợp lệ.';
      else if (option.isActive === false) carrier = 'Nhà xe này đang ngưng hoạt động.';
      else if ((carrierCounts.get(row.carrierKey) ?? 0) > 1) carrier = 'Nhà xe này đã có ở một dòng khác.';

      if (!validCount(row.count20)) count20 = 'Nhập số nguyên từ 0 trở lên.';
      if (!validCount(row.count40)) count40 = 'Nhập số nguyên từ 0 trở lên.';
      if (!count20 && validation.assigned20 > demand.count20 && numericCount(row.count20) > 0) {
        count20 = `Tổng đang vượt ${validation.assigned20 - demand.count20} container 20'.`;
      }
      if (!count40 && validation.assigned40 > demand.count40 && numericCount(row.count40) > 0) {
        count40 = `Tổng đang vượt ${validation.assigned40 - demand.count40} container 40'.`;
      }
      return { carrier, count20, count40 };
    });
  }, [demand, options, rows, validation.assigned20, validation.assigned40]);

  const updateRow = (index: number, patch: Partial<AllocationRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    const usedKeys = new Set(rows.map((row) => row.carrierKey));
    const next = options.find((option) => !usedKeys.has(option.key) && option.isActive !== false);
    if (!next) return;
    setRows((prev) => [...prev, toRow(next)]);
    const nextIndex = rows.length;
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(`[data-allocation-row="${nextIndex}"] .dispatch-allocation-popover__fields button`)
        ?.focus();
    });
  };

  const removeRow = (index: number) => {
    if (rows.length <= 1) return;
    setRows((prev) => prev.filter((_, i) => i !== index));
    const nextIndex = Math.max(0, Math.min(index, rows.length - 2));
    window.requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLButtonElement>(`[data-allocation-row="${nextIndex}"] .dispatch-allocation-popover__fields button`)
        ?.focus();
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
    if (!validation.isExact || saving) return;
    setSaving(true);
    setError(null);
    try {
      const response = await saveShipmentCarrierAllocations(
        shipment.id,
        {
          expectedVersion: shipment.version,
          // An untouched row (0/0, e.g. the default own-fleet row when the
          // whole shipment goes to an external carrier) isn't a real
          // allocation — the backend rejects a carrier with zero containers.
          carrierAllocations: rows
            .filter((row) => row.carrierKey && (Number(row.count20 || 0) > 0 || Number(row.count40 || 0) > 0))
            .map((row) => {
              const option = options.find((candidate) => candidate.key === row.carrierKey);
              return {
                carrierType: option?.carrierType ?? 'OWN',
                externalCarrierId: option?.externalCarrierId ?? null,
                count20: Number(row.count20 || 0),
                count40: Number(row.count40 || 0),
              };
            }),
        },
        undefined,
        'partial',
      );
      // Re-derive the row from the saved state so chips and allocationStatus
      // refresh without a list refetch — propagating the server's new version
      // so an immediate re-edit doesn't 409 on a stale expectedVersion.
      const summary = rows
        .filter((row) => row.carrierKey)
        .map((row) => {
          const option = options.find((candidate) => candidate.key === row.carrierKey);
          return {
            carrierType: option?.carrierType ?? ('OWN' as const),
            externalCarrierId: option?.externalCarrierId ?? null,
            // Match the backend's chip labels (INTERNAL_FLEET_CARRIER_NAME).
            carrierLabel: option?.carrierType === 'OWN' ? 'SilverSea' : option?.label ?? 'Nhà xe chưa xác định',
            count20: Number(row.count20 || 0),
            count40: Number(row.count40 || 0),
          };
        })
        .filter((entry) => entry.count20 > 0 || entry.count40 > 0);
      onSaved({
        ...shipment,
        version: response.shipment.version,
        carrierAllocationSummary: summary,
        allocationStatus: validation.assigned20 >= demand.count20 && validation.assigned40 >= demand.count40
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
          Chọn nhà xe và số container giao cho từng đơn vị. Có thể lưu khi chưa phân đủ và bổ sung sau.
        </p>

        <section className={`dispatch-allocation-popover__summary is-${allocationState}`} aria-labelledby="dispatch-allocation-summary-title">
          <div className="dispatch-allocation-popover__summary-heading">
            <div>
              <h4 id="dispatch-allocation-summary-title">Tổng phân bổ</h4>
              <p>Không được phân vượt nhu cầu của lô hàng.</p>
            </div>
            <span className="dispatch-allocation-popover__state" aria-live="polite">
              {allocationState === 'error' ? 'Cần điều chỉnh' : allocationState === 'complete' ? 'Đã phân đủ' : 'Chưa phân đủ'}
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
              <span role="cell">{validation.assigned20}</span>
              <strong role="cell">{allocationState === 'error' ? remaining.count20 : Math.max(0, remaining.count20)}</strong>
            </div>
            <div className="dispatch-allocation-popover__balance-row" role="row">
              <strong role="rowheader">40'</strong>
              <span role="cell">{demand.count40}</span>
              <span role="cell">{validation.assigned40}</span>
              <strong role="cell">{allocationState === 'error' ? remaining.count40 : Math.max(0, remaining.count40)}</strong>
            </div>
          </div>
        </section>

        <div className="dispatch-allocation-popover__section-head">
          <div>
            <h4>Phân bổ theo nhà xe</h4>
            <p>Mỗi nhà xe chỉ xuất hiện một lần.</p>
          </div>
        </div>

        <div className="dispatch-allocation-popover__rows" role="list" aria-label="Các dòng phân bổ nhà xe">
          {rows.map((row, index) => (
            <div key={row.key} className="dispatch-allocation-popover__row" role="listitem" data-allocation-row={index}>
              <div className="dispatch-allocation-popover__row-head">
                <strong>Phân bổ {index + 1}</strong>
                {rows.length > 1 && (
                  <button
                    type="button"
                    className="dispatch-allocation-popover__remove"
                    onClick={() => removeRow(index)}
                    aria-label={`Xóa dòng ${index + 1}`}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                )}
              </div>
              <div className="dispatch-allocation-popover__fields">
                <UuiSelectField
                  wrapperClassName="dispatch-allocation-popover__carrier"
                  controlClassName="dispatch-allocation-popover__control"
                  label="Nhà xe"
                  hint={rowIssues[index]?.carrier ?? (optionsLoading ? 'Đang tải danh sách nhà xe…' : undefined)}
                  value={row.carrierKey}
                  onChange={(event) => updateRow(index, { carrierKey: event.target.value })}
                  ariaLabel={`Nhà xe dòng ${index + 1}`}
                  invalid={Boolean(rowIssues[index]?.carrier)}
                  disabled={optionsLoading}
                  options={options.map((option) => ({
                    label: option.label,
                    value: option.key,
                    disabled: option.isActive === false,
                  }))}
                />
                <UUIInput
                  className="dispatch-allocation-popover__count"
                  inputClassName="dispatch-allocation-popover__control"
                  type="number"
                  size="sm"
                  label="Container 20'"
                  placeholder="0"
                  hint={rowIssues[index]?.count20}
                  isInvalid={Boolean(rowIssues[index]?.count20)}
                  value={row.count20}
                  onChange={(value) => updateRow(index, { count20: value })}
                  aria-label={`Số container 20' dòng ${index + 1}`}
                  inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
                />
                <UUIInput
                  className="dispatch-allocation-popover__count"
                  inputClassName="dispatch-allocation-popover__control"
                  type="number"
                  size="sm"
                  label="Container 40'"
                  placeholder="0"
                  hint={rowIssues[index]?.count40}
                  isInvalid={Boolean(rowIssues[index]?.count40)}
                  value={row.count40}
                  onChange={(value) => updateRow(index, { count40: value })}
                  aria-label={`Số container 40' dòng ${index + 1}`}
                  inputProps={{ min: 0, step: 1, inputMode: 'numeric' }}
                />
              </div>
            </div>
          ))}
        </div>

        <UUIButton
          type="button"
          size="sm"
          color="secondary"
          className="dispatch-allocation-popover__add"
          iconLeading={<Plus size={16} aria-hidden="true" />}
          onPress={addRow}
          isDisabled={optionsLoading || !options.some((option) => option.isActive !== false && !rows.some((row) => row.carrierKey === option.key))}
        >
          Thêm nhà xe
        </UUIButton>

        {optionsError && (
          <div className="dispatch-allocation-popover__notice is-warning" role="alert">
            <span>Không tải được danh sách nhà xe ngoài. Bạn vẫn có thể dùng đội xe nội bộ hoặc thử tải lại.</span>
            <UUIButton size="sm" color="secondary" onPress={() => setOptionsReloadKey((key) => key + 1)}>Tải lại</UUIButton>
          </div>
        )}
        {optionsEmpty && !optionsError && (
          <div className="dispatch-allocation-popover__notice is-warning" role="status" data-testid="carrier-allocation-empty-externals">
            <span>
              Chưa có nhà xe ngoài nào được cấu hình. Liên hệ Quản trị viên để đánh dấu khách hàng là nhà xe (isCarrier = true) trong danh mục Khách hàng.
            </span>
          </div>
        )}
        <div className={`dispatch-allocation-popover__notice dispatch-allocation-popover__allocation-note is-${allocationState}`} role={allocationState === 'error' ? 'alert' : 'status'}>
          {allocationState === 'error' ? (
            <ul>
              {[...new Set(validation.errors)].map((validationError) => <li key={validationError}>{validationError}</li>)}
            </ul>
          ) : allocationState === 'complete' ? (
            <span>Đã phân bổ đủ số container của lô hàng.</span>
          ) : (
            <span>
              Có thể lưu phân bổ hiện tại và bổ sung sau. Còn {Math.max(0, remaining.count20)} container 20' và {Math.max(0, remaining.count40)} container 40'.
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
            isDisabled={!validation.isExact || saving}
            isLoading={saving}
          >
            {saving ? 'Đang lưu…' : 'Lưu phân bổ'}
          </UUIButton>
        </div>
      </div>
    </div>
  );
}
