import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DRIVER_INCIDENTAL_COST_LABELS } from '@tingting/shared';

import {
  correctPhoiPhieuRow,
  updatePhoiPhieuRowAmounts,
  type PhoiPhieuRow,
} from '../../api/phoiPhieuClient';
import { qk } from '../../api/keys';

export type PhoiPhieuChiHoEditRow = NonNullable<PhoiPhieuRow['chiHoRows']>[number];

/** SIL-783 (id 906) — the audit reason every board invoice edit carries, the
 *  same requirement the chi-hộ detail dialog's amount edits satisfy. */
export const PHOI_INVOICE_EDIT_REASON = 'Kế toán sửa số hóa đơn trên bảng phơi phiếu';

/** Card 071026141580 — blank feeName is the sentinel: the cell falls back to
 *  the driver-cost type label (lái xe khai, SIL-807) before the generic
 *  'Chi phí'. Shared by the fee line and the board's aria labels so a screen
 *  reader hears the same fee name the cell prints. */
export function phoiChiHoFeeLabel(row: Pick<PhoiPhieuChiHoEditRow, 'feeName' | 'sourceKind' | 'costType'>): string {
  return row.feeName?.trim()
    || (row.sourceKind === 'DRIVER' && row.costType
      ? DRIVER_INCIDENTAL_COST_LABELS[row.costType as keyof typeof DRIVER_INCIDENTAL_COST_LABELS] ?? row.costType
      : null)
    || 'Chi phí';
}

interface Props {
  tripId: number;
  chiHoRow: PhoiPhieuChiHoEditRow;
  /** Accessible name — the board row's Bill/Booking plus the fee line. */
  ariaLabel: string;
}

/**
 * One inline Số-HĐ editor on the phơi-phiếu board (SIL-783, id 906): the
 * accountant edits the invoice number straight in the table — phoi received
 * or not — and it persists through the same update/correct split the chi-hộ
 * detail dialog uses (a confirmed row can only be *corrected*, an open row is
 * updated in place). Empty input clears the stored number (null), matching
 * the nullable column.
 */
export function PhoiPhieuInvoiceCell({ tripId, chiHoRow, ariaLabel }: Props) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(chiHoRow.invoiceNumber ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The refetch after a save (or a colleague's edit landing through another
  // surface) is the truth — re-sync the draft so the stale local text can
  // never be re-committed over it.
  useEffect(() => {
    setDraft(chiHoRow.invoiceNumber ?? '');
  }, [chiHoRow.entryId, chiHoRow.invoiceNumber]);

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (next === (chiHoRow.invoiceNumber ?? '')) return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        expectedVersion: chiHoRow.version,
        reason: PHOI_INVOICE_EDIT_REASON,
        invoiceNumber: next === '' ? null : next,
      };
      const kind = chiHoRow.sourceKind ?? 'OPS';
      if (chiHoRow.confirmed) await correctPhoiPhieuRow(chiHoRow.entryId, payload, { kind });
      else await updatePhoiPhieuRowAmounts(tripId, chiHoRow.entryId, payload, { kind });
      await queryClient.invalidateQueries({ queryKey: qk.phoiPhieu.rowsAll });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Không lưu được số hóa đơn.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ppc-invoice-line">
      <label className="ppc-invoice-fee">
        <small>{phoiChiHoFeeLabel(chiHoRow)}</small>
        <input
          className="ppc-invoice-input"
          value={draft}
          aria-label={ariaLabel}
          disabled={saving}
          placeholder="Số HĐ"
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => void commit()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      {error && <span role="alert" className="ppc-invoice-error">{error}</span>}
    </div>
  );
}
