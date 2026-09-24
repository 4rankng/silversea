// Card 20260922_64 — the per-customer "Chi phí khác" catalog on the
// quotation screen. Ruling 9a: amounts are TẠM editable defaults stored as
// DATA — nothing hardcoded here; Kiểm hóa/đặc-thù stay pending-empty (9b/9c)
// and render "—" with no autofill. Saves ride the frame PUT (replace-all on
// both cells and fees), so every save releases a MANUAL_EDIT version (ruling
// 6 — new version, never overwrite; concurrent-edit loss is recoverable via
// the _62 version history).
import { useEffect, useRef, useState } from 'react';
import {
  FEE_ROUTING_MODES,
  type FeeRoutingMode,
  type QuotationFeeInput,
} from '@tingting/shared';
import type { QuotationFeeView } from '@tingting/shared';
import { EmptyState, UuiSelectField } from '../../design-system';

export const FEE_ROUTING_LABELS: Record<FeeRoutingMode, string> = {
  DEDICATED_CUSTOMS: 'Cột riêng — Hải quan giám sát',
  DEDICATED_LACH_HUYEN: 'Cột riêng — Nâng/Hạ Lạch Huyện',
  OTHER_COSTS: 'Cột chi phí khác',
};

// Working copy of one catalog row while unsaved.
interface FeeRowDraft {
  key: string;
  id: number | null;
  feeName: string;
  subType: string;
  amountText: string; // '' = pending-empty (renders —, saves null)
  routing: FeeRoutingMode;
  note: string;
  isNew: boolean;
}

interface QuotationFeesSectionProps {
  fees: QuotationFeeView[];
  saving: boolean;
  onSaveFees(fees: QuotationFeeInput[]): void;
}

export function QuotationFeesSection({ fees, saving, onSaveFees }: QuotationFeesSectionProps) {
  const [rows, setRows] = useState<FeeRowDraft[]>([]);
  const [dirty, setDirty] = useState(false);

  // Resync the working copy when the server view changes — but NEVER while
  // the operator has unsaved edits (dirty): a background refetch arriving
  // mid-edit must not silently wipe the working catalog.
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (dirtyRef.current) return;
    setRows((fees ?? []).map((row) => ({
      key: `fee-${row.id}`,
      id: row.id,
      feeName: row.feeName,
      subType: row.subType ?? '',
      amountText: row.defaultAmount == null ? '' : String(row.defaultAmount),
      routing: row.routing,
      note: row.note ?? '',
      isNew: false,
    })));
    setDirty(false);
  }, [fees]);

  function updateRow(key: string, patch: Partial<FeeRowDraft>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
    dirtyRef.current = true;
    setDirty(true);
  }

  function addRow() {
    dirtyRef.current = true;
    setDirty(true);
    setRows((current) => [...current, {
      key: `new-${current.length}-${Date.now()}`,
      id: null,
      feeName: '',
      subType: '',
      amountText: '',
      // Entry-time classification default (shared helper): the two dedicated
      // fees classify by name; the operator can change it before saving.
      routing: 'OTHER_COSTS',
      note: '',
      isNew: true,
    }]);
    setDirty(true);
  }

  function removeRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
    dirtyRef.current = true;
    setDirty(true);
  }

  function commit() {
    const payload: QuotationFeeInput[] = rows
      .filter((row) => row.feeName.trim().length > 0)
      .map((row) => ({
        feeName: row.feeName.trim(),
        subType: row.subType.trim() || null,
        defaultAmount: row.amountText.trim() === '' ? null : Number(row.amountText.replace(/\./g, '').replace(',', '.')),
        routing: row.routing,
        note: row.note.trim() || null,
        sortOrder: rows.indexOf(row),
      }));
    onSaveFees(payload);
  }

  return (
    <section className="quotation-fees" aria-label="Danh mục chi phí khác">
      <h3>Chi phí khác</h3>
      <p className="quotation-status">
        Mức tiền là mặc định sửa được (TẠM — khách sẽ báo số chốt sau); ô trống = chờ khách hoặc nhập tay theo lô.
      </p>
      {rows.length === 0 && !dirty ? (
        <EmptyState context="trips" title="Chưa có dòng chi phí nào cho khách này." />
      ) : (
        <table className="tt-table quotation-fees__table">
          <thead>
            <tr>
              <th scope="col">STT</th>
              <th scope="col">Nội dung</th>
              <th scope="col">Phân loại</th>
              <th scope="col">Số tiền mặc định (TẠM)</th>
              <th scope="col">Định tuyến</th>
              <th scope="col">Ghi chú</th>
              <th scope="col"><span className="sr-only">Thao tác</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.key}>
                <td>{index + 1}</td>
                <td>{row.isNew ? (
                  <input aria-label="Nội dung" value={row.feeName} onChange={(e) => updateRow(row.key, { feeName: e.target.value })} />
                ) : row.feeName}</td>
                <td>{row.isNew ? (
                  <input aria-label="Phân loại" value={row.subType} onChange={(e) => updateRow(row.key, { subType: e.target.value })} />
                ) : (row.subType || '—')}</td>
                <td>
                  <input
                    aria-label={`Số tiền mặc định ${row.feeName || 'dòng mới'}${row.subType ? ` · ${row.subType}` : ''}`}
                    className="quotation-fees__amount-input"
                    inputMode="numeric"
                    value={row.amountText}
                    onChange={(e) => updateRow(row.key, { amountText: e.target.value })}
                  />
                </td>
                <td>
                  <UuiSelectField
                    label="Định tuyến"
                    hideLabel
                    ariaLabel={`Định tuyến ${row.feeName || 'dòng mới'}`}
                    width="content"
                    value={row.routing}
                    onChange={(e) => updateRow(row.key, { routing: e.target.value as FeeRoutingMode })}
                    options={FEE_ROUTING_MODES.map((mode) => ({ value: mode, label: FEE_ROUTING_LABELS[mode] }))}
                  />
                </td>
                <td>{row.isNew ? (
                  <input aria-label="Ghi chú" value={row.note} onChange={(e) => updateRow(row.key, { note: e.target.value })} />
                ) : (row.note || '—')}</td>
                <td>
                  <button type="button" className="btn btn--secondary btn--sm" onClick={() => removeRow(row.key)}>Xoá</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn--secondary btn--sm" onClick={addRow}>Thêm dòng</button>
        <button type="button" className="btn btn--primary btn--sm" disabled={saving || !dirty} onClick={commit}>Lưu danh mục</button>
      </div>
    </section>
  );
}
