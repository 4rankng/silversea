import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
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
import './DispatchAllocationPopover.css';

const OWN_CARRIER_OPTION: CarrierAllocationOption = {
  key: 'OWN',
  label: 'Đội xe nội bộ SilverSea',
  carrierType: 'OWN',
  externalCarrierId: null,
  isActive: true,
};

interface AllocationRow {
  carrierKey: string;
  count20: string;
  count40: string;
}

function toRow(option: CarrierAllocationOption): AllocationRow {
  return { carrierKey: option.key, count20: '', count40: '' };
}

function prefillRows(shipment: ShipmentListItem): AllocationRow[] {
  if (shipment.carrierAllocationSummary.length === 0) return [toRow(OWN_CARRIER_OPTION)];
  return shipment.carrierAllocationSummary.map((entry) => ({
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
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
    }).catch(() => {
      // Options stay at OWN-only on bootstrap failure — the grid still works.
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    closeButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
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

  const updateRow = (index: number, patch: Partial<AllocationRow>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => {
    const usedKeys = new Set(rows.map((row) => row.carrierKey));
    const next = options.find((option) => !usedKeys.has(option.key) && option.isActive !== false);
    if (!next) return;
    setRows((prev) => [...prev, toRow(next)]);
  };

  const removeRow = (index: number) => {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== index)));
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
          carrierAllocations: rows
            .filter((row) => row.carrierKey)
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
        aria-label="Phân bổ phương tiện"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dispatch-allocation-popover__header">
          <h3>Phân bổ phương tiện</h3>
          <button ref={closeButtonRef} type="button" className="dispatch-allocation-popover__close" onClick={onClose} aria-label="Đóng">
            <X size={16} />
          </button>
        </div>
        <p className="dispatch-allocation-popover__meta">
          {shipment.blNumber || shipment.bookingRef || shipment.shipmentCode} · {shipment.customerName ?? '—'}
        </p>

        <div className="dispatch-allocation-popover__rows">
          {rows.map((row, index) => (
            <div key={index} className="dispatch-allocation-popover__row">
              <select
                value={row.carrierKey}
                onChange={(event) => updateRow(index, { carrierKey: event.target.value })}
                aria-label={`Nhà xe dòng ${index + 1}`}
              >
                {options.map((option) => (
                  <option key={option.key} value={option.key} disabled={option.isActive === false}>
                    {option.label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={0}
                placeholder="20'"
                value={row.count20}
                onChange={(event) => updateRow(index, { count20: event.target.value })}
                aria-label={`Số container 20' dòng ${index + 1}`}
              />
              <input
                type="number"
                min={0}
                placeholder="40'"
                value={row.count40}
                onChange={(event) => updateRow(index, { count40: event.target.value })}
                aria-label={`Số container 40' dòng ${index + 1}`}
              />
              <button
                type="button"
                className="dispatch-allocation-popover__remove"
                onClick={() => removeRow(index)}
                aria-label={`Xóa dòng ${index + 1}`}
                disabled={rows.length <= 1}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <button type="button" className="dispatch-allocation-popover__add" onClick={addRow}>
          <Plus size={14} /> Thêm nhà xe
        </button>

        <p className={`dispatch-allocation-popover__progress${validation.isExact ? '' : ' is-error'}`}>
          20': {validation.assigned20}/{demand.count20} · 40': {validation.assigned40}/{demand.count40}
        </p>
        {validation.errors.length > 0 && (
          <p className="dispatch-allocation-popover__error" role="alert">{validation.errors[0]}</p>
        )}
        {error && (
          <p className="dispatch-allocation-popover__error" role="alert">{error}</p>
        )}

        <div className="dispatch-allocation-popover__actions">
          <button type="button" onClick={onClose} disabled={saving}>Hủy</button>
          <button
            type="button"
            className="dispatch-allocation-popover__save"
            onClick={handleSave}
            disabled={!validation.isExact || saving}
          >
            {saving ? 'Đang lưu…' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  );
}
