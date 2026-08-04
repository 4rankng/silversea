import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { SearchableSelect, TextField } from '../../design-system';
import { Drawer, Modal, useConfirm } from '../UI';
import {
  CarrierAllocationSummary,
  carrierOptionKey,
  type CarrierAllocationDemand,
  type CarrierAllocationOption,
  type CarrierAllocationValue,
  validateCarrierAllocations,
} from './CarrierAllocationSummary';
import './CarrierAllocationDialog.css';

interface CarrierAllocationDraftRow {
  key: string;
  carrierKey: string;
  count20: string;
  count40: string;
}

interface CarrierAllocationDialogProps {
  isOpen: boolean;
  title?: string;
  description?: string;
  carrierOptions: CarrierAllocationOption[];
  demand: CarrierAllocationDemand;
  value: CarrierAllocationValue[];
  onClose: () => void;
  onSave: (rows: CarrierAllocationValue[]) => void;
}

function newDraftRow(): CarrierAllocationDraftRow {
  return {
    key: crypto.randomUUID(),
    carrierKey: '',
    count20: '',
    count40: '',
  };
}

function toDraftRows(value: CarrierAllocationValue[]): CarrierAllocationDraftRow[] {
  if (value.length === 0) return [newDraftRow()];
  return value.map((row) => ({
    key: crypto.randomUUID(),
    carrierKey: carrierOptionKey(row.carrierType, row.externalCarrierId),
    count20: row.count20 > 0 ? String(row.count20) : '',
    count40: row.count40 > 0 ? String(row.count40) : '',
  }));
}

function normalizeRows(
  rows: CarrierAllocationDraftRow[],
  options: CarrierAllocationOption[],
): CarrierAllocationValue[] {
  const optionByKey = new Map(options.map((option) => [option.key, option]));
  return rows
    .map((row) => {
      const option = optionByKey.get(row.carrierKey);
      if (!option) return null;
      return {
        carrierType: option.carrierType,
        externalCarrierId: option.externalCarrierId,
        carrierLabel: option.label,
        count20: row.count20.trim() === '' ? 0 : Number(row.count20),
        count40: row.count40.trim() === '' ? 0 : Number(row.count40),
      } satisfies CarrierAllocationValue;
    })
    .filter((row): row is CarrierAllocationValue => row != null);
}

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= 767;
}

export function CarrierAllocationDialog({
  isOpen,
  title = 'Gán nhà xe',
  description = 'Nhập đúng số lượng 20\' và 40\' theo từng nhà xe.',
  carrierOptions,
  demand,
  value,
  onClose,
  onSave,
}: CarrierAllocationDialogProps) {
  const { confirm, dialog } = useConfirm();
  const [draftRows, setDraftRows] = useState<CarrierAllocationDraftRow[]>(() => toDraftRows(value));
  const [dirty, setDirty] = useState(false);
  const [mobile, setMobile] = useState(isMobileViewport);
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    setDraftRows(toDraftRows(value));
    setDirty(false);
  }, [isOpen, value]);

  useEffect(() => {
    if (!isOpen) return;
    const handleResize = () => setMobile(isMobileViewport());
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    setOpener(document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      const firstField = panelRef.current?.querySelector<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
      );
      firstField?.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      opener?.focus();
    };
  }, [isOpen, opener]);

  const normalizedRows = useMemo(() => normalizeRows(draftRows, carrierOptions), [draftRows, carrierOptions]);
  const validation = useMemo(
    () => validateCarrierAllocations(draftRows, demand, carrierOptions),
    [carrierOptions, demand, draftRows],
  );

  const dismissalRequested = async () => {
    if (dirty) {
      const shouldClose = await confirm('Phân bổ nhà xe đang có thay đổi chưa lưu. Đóng mà không lưu?', {
        confirmLabel: 'Đóng không lưu',
        cancelLabel: 'Tiếp tục chỉnh',
        variant: 'warning',
      });
      if (!shouldClose) return;
    }
    onClose();
  };

  function updateRow(rowKey: string, patch: Partial<CarrierAllocationDraftRow>) {
    setDraftRows((current) => current.map((row) => (row.key === rowKey ? { ...row, ...patch } : row)));
    setDirty(true);
  }

  function addRow() {
    setDraftRows((current) => [...current, newDraftRow()]);
    setDirty(true);
  }

  function removeRow(rowKey: string) {
    setDraftRows((current) => {
      const remaining = current.filter((row) => row.key !== rowKey);
      return remaining.length > 0 ? remaining : [newDraftRow()];
    });
    setDirty(true);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
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
  }

  const body = (
    <div
      ref={panelRef}
      className={`carrier-allocation-dialog${mobile ? ' is-mobile' : ''}`}
      onKeyDown={handleKeyDown}
    >
      <p className="carrier-allocation-dialog__description">{description}</p>
      <div className="carrier-allocation-dialog__progress" role="status" aria-live="polite">
        <span>Đã gán {validation.assigned20}/{demand.count20} container 20'</span>
        <span>Đã gán {validation.assigned40}/{demand.count40} container 40'</span>
      </div>

      <div className="carrier-allocation-dialog__rows" role="list" aria-label="Các dòng phân bổ nhà xe">
        {draftRows.map((row, index) => (
          <div key={row.key} className="carrier-allocation-dialog__row" role="listitem">
            <div className="carrier-allocation-dialog__row-head">
              <strong>Dòng {index + 1}</strong>
              <button
                type="button"
                className="carrier-allocation-dialog__remove"
                onClick={() => removeRow(row.key)}
                aria-label={`Xóa dòng nhà xe ${index + 1}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
            <div className="carrier-allocation-dialog__fields">
              <label className="carrier-allocation-dialog__field">
                <span>Nhà xe</span>
                <SearchableSelect
                  id={`carrier-allocation-${row.key}`}
                  value={row.carrierKey}
                  onChange={(value) => updateRow(row.key, { carrierKey: value })}
                  options={carrierOptions.map((option) => ({
                    value: option.key,
                    label: option.label,
                    searchText: option.searchText,
                  }))}
                  placeholder="Chọn nhà xe"
                  searchPlaceholder="Tìm tên nhà xe"
                />
              </label>
              <TextField
                label="20'"
                type="number"
                min="0"
                step="1"
                value={row.count20}
                onChange={(event) => updateRow(row.key, { count20: event.target.value })}
              />
              <TextField
                label="40'"
                type="number"
                min="0"
                step="1"
                value={row.count40}
                onChange={(event) => updateRow(row.key, { count40: event.target.value })}
              />
            </div>
          </div>
        ))}
      </div>

      <button type="button" className="carrier-allocation-dialog__add" onClick={addRow}>
        <Plus size={16} />
        Thêm nhà xe
      </button>

      <CarrierAllocationSummary
        allocations={normalizedRows}
        demand={demand}
        warning={validation.isExact ? null : validation.errors[0] ?? null}
      />

      {validation.errors.length > 0 ? (
        <ul className="carrier-allocation-dialog__errors" role="alert">
          {validation.errors.map((error) => <li key={error}>{error}</li>)}
        </ul>
      ) : null}

      <div className="carrier-allocation-dialog__footer">
        <button type="button" className="btn btn--secondary" onClick={() => { void dismissalRequested(); }}>
          Hủy
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!validation.isExact}
          onClick={() => {
            onSave(normalizedRows);
            onClose();
          }}
        >
          Lưu phân bổ
        </button>
      </div>
      {dialog}
    </div>
  );

  return mobile ? (
    <Drawer
      isOpen={isOpen}
      onClose={() => { void dismissalRequested(); }}
      title={title}
      subtitle={description}
    >
      {body}
    </Drawer>
  ) : (
    <Modal
      isOpen={isOpen}
      onClose={() => { void dismissalRequested(); }}
      title={title}
      maxWidth="min(92vw, 860px)"
    >
      {body}
    </Modal>
  );
}
