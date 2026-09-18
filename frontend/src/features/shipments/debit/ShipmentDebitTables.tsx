// Settlement workspace tables + the draft/delta helpers they render from.
// Split from ShipmentDebitWorkspace.tsx at the guard's new-file ceiling:
// the container keeps queries, mutations and the action rail; this module
// is the pure rendering and delta math.
import { AlertTriangle, Paperclip } from 'lucide-react';
import type { DebitDetailChiHoRow, ShipmentDebitDetail, ShipmentDebitEditsBody } from '../../../api/shipmentDebit';
import { formatMoney } from '../../../lib/format';

const money = (value: number | null | undefined) => (value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value));

const num = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** CUS draft: per-expense sell/note edits, other-fee amount edits, and the
 * Phí khác add/remove lists. Pure delta — untouched cells never travel. */
export interface DraftState {
  freight: Record<string, { psActual: string; psNotes: string }>;
  items: Record<number, { thuKhach: string; note: string }>;
  feeAmounts: Record<number, string>;
  addedFees: Array<{ key: string; tripId: number; name: string; amount: string }>;
  removedFeeIds: number[];
}

export const DRAFT_EMPTY: DraftState = { freight: {}, items: {}, feeAmounts: {}, addedFees: [], removedFeeIds: [] };

export const buildDraft = (detail: ShipmentDebitDetail): DraftState => ({
  freight: Object.fromEntries(detail.freightRows.map((row) => [row.containerNumber, { psActual: row.psActual == null ? '' : String(row.psActual), psNotes: row.psNotes ?? '' }])),
  items: {},
  feeAmounts: Object.fromEntries(detail.chiHoRows.flatMap((row) => row.otherFees.map((fee) => [fee.id, fee.amount == null ? '' : String(fee.amount)]))),
  addedFees: [],
  removedFeeIds: [],
});

export const buildDelta = (detail: ShipmentDebitDetail, draft: DraftState): ShipmentDebitEditsBody => {
  const edits: NonNullable<ShipmentDebitEditsBody['edits']> = [];
  for (const row of detail.chiHoRows) {
    for (const item of row.items) {
      const cell = draft.items[item.id];
      if (!cell) continue;
      const sell = cell.thuKhach.trim() === '' ? null : num(cell.thuKhach);
      const note = cell.note;
      const changed = sell !== (item.thuKhach ?? null) || note !== (item.note ?? '');
      if (changed) {
        const edit: NonNullable<ShipmentDebitEditsBody['edits']>[number] = { expenseId: item.id, sellAmount: sell };
        if (note !== (item.note ?? '')) edit.note = note;
        edits.push(edit);
      }
    }
  }
  for (const row of detail.chiHoRows) {
    for (const fee of row.otherFees) {
      const raw = draft.feeAmounts[fee.id];
      if (raw == null) continue;
      const amount = num(raw);
      if (amount !== (fee.amount ?? 0)) edits.push({ expenseId: fee.id, buyAmount: amount });
    }
  }
  return {
    edits,
    addOtherFees: draft.addedFees.filter((fee) => fee.name.trim() !== '').map((fee) => ({ tripId: fee.tripId, name: fee.name.trim(), amount: num(fee.amount) })),
    removeExpenseIds: draft.removedFeeIds,
  };
};

/** Bảng 2.1 — auto freight per container + the CUS-entered actual PS. */
export function FreightTable({ detail, draft, frozen, setFreight }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setFreight: (containerNumber: string, patch: Partial<{ psActual: string; psNotes: string }>) => void;
}) {
  return (
    <table className="csc-debit-table csc-debit-table--freight">
      <caption>Bảng 2.1 — Cước vận tải</caption>
      <thead><tr>
        <th scope="col">Số Container</th>
        <th scope="col">Cước thu</th>
        <th scope="col">Phụ phí xăng dầu</th>
        <th scope="col">Lạch Huyện</th>
        <th scope="col">Phí Hải Quan</th>
        <th scope="col">PS thực tế</th>
        <th scope="col">Tổng</th>
        <th scope="col">Ghi chú</th>
      </tr></thead>
      <tbody>
        {detail.freightRows.map((row) => {
          const cells = draft.freight[row.containerNumber] ?? { psActual: '', psNotes: '' };
          const total = (row.freightCharge ?? 0) + (row.fuelSurcharge ?? 0) + (row.lachHuyenFee ?? 0) + (row.customsFee ?? 0) + num(cells.psActual || '0');
          return (
            <tr key={row.containerNumber}>
              <td>{row.containerNumber}<small>{row.containerTypeLabel ?? ''}</small></td>
              <td>{money(row.freightCharge)}</td>
              <td>{money(row.fuelSurcharge)}</td>
              <td>{money(row.lachHuyenFee)}</td>
              <td>{money(row.customsFee)}</td>
              <td>
                <input
                  className="csc-debit-input"
                  aria-label={`PS thực tế ${row.containerNumber}`}
                  value={cells.psActual}
                  disabled={frozen}
                  onChange={(event) => setFreight(row.containerNumber, { psActual: event.target.value })}
                />
              </td>
              <td>{money(total === 0 && row.freightCharge == null ? null : total)}</td>
              <td>
                <input
                  className="csc-debit-input"
                  aria-label={`Ghi chú PS ${row.containerNumber}`}
                  value={cells.psNotes}
                  disabled={frozen}
                  onChange={(event) => setFreight(row.containerNumber, { psNotes: event.target.value })}
                />
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}


/** Bảng 2.2 — chi hộ & tiền treo. Core expense rows read Ops amounts
 * read-only; thu khách and note are the CUS cells. OTHER lines are the
 * hand-managed Phí khác. */
export function ChiHoTable({ detail, draft, frozen, setItem, setFeeAmount, addFee, removeFee, setAddedFee }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setItem: (expenseId: number, patch: Partial<{ thuKhach: string; note: string }>) => void;
  setFeeAmount: (feeId: number, value: string) => void;
  addFee: (tripId: number) => void;
  removeFee: (feeId: number) => void;
  setAddedFee: (key: string, patch: Partial<{ name: string; amount: string }>) => void;
}) {
  const armed = (row: DebitDetailChiHoRow) => (row.carrierDetention ?? 0) > 0 || (row.repairAdvance ?? 0) > 0;
  return (
    <table className="csc-debit-table csc-debit-table--chiho">
      <caption>Bảng 2.2 — Phí Chi Hộ &amp; Tiền Treo</caption>
      <thead><tr>
        <th scope="col">Container</th>
        <th scope="col">Khoản chi (Ops)</th>
        <th scope="col">Số tiền</th>
        <th scope="col">Thu khách</th>
        <th scope="col">Ghi chú</th>
        <th scope="col">Phí khác (CUS)</th>
        <th scope="col">Cược hãng tàu</th>
        <th scope="col">Tạm thu sửa chữa</th>
        <th scope="col">Chứng từ Ops</th>
      </tr></thead>
      <tbody>
        {detail.chiHoRows.map((row) => (
          <tr key={row.tripId} className={armed(row) ? 'csc-debit-row--warn' : undefined}>
            <td>{row.containerNumber ?? '—'}</td>
            <td colSpan={4}>
              <div className="csc-debit-itemlist">
                {row.items.map((item) => (
                  <div className="csc-debit-item" key={item.id}>
                    <span className="csc-debit-item__name">{item.feeName ?? item.expenseType}</span>
                    <span className="csc-debit-item__amount">{money(item.amount)}</span>
                    <input
                      className="csc-debit-input csc-debit-input--sell"
                      aria-label={`Thu khách ${item.feeName ?? item.expenseType} ${row.containerNumber ?? row.tripId}`}
                      placeholder="Thu khách"
                      value={draft.items[item.id]?.thuKhach ?? (item.thuKhach == null ? '' : String(item.thuKhach))}
                      disabled={frozen}
                      onChange={(event) => setItem(item.id, { thuKhach: event.target.value })}
                    />
                    <input
                      className="csc-debit-input csc-debit-input--note"
                      aria-label={`Ghi chú ${item.feeName ?? item.expenseType} ${row.containerNumber ?? row.tripId}`}
                      placeholder="Ghi chú"
                      value={draft.items[item.id]?.note ?? item.note ?? ''}
                      disabled={frozen}
                      onChange={(event) => setItem(item.id, { note: event.target.value })}
                    />
                  </div>
                ))}
                {row.items.length === 0 && <span>Chưa xác định</span>}
              </div>
            </td>
            <td>
              {row.otherFees.map((fee) => (
                <div className="csc-debit-otherfee" key={fee.id}>
                  <span className="csc-debit-item__name">{fee.name}</span>
                  <input
                    className="csc-debit-input"
                    aria-label={`Số tiền phí khác ${fee.name} ${row.containerNumber ?? row.tripId}`}
                    value={draft.feeAmounts[fee.id] ?? ''}
                    disabled={frozen}
                    onChange={(event) => setFeeAmount(fee.id, event.target.value)}
                  />
                  <button type="button" aria-label={`Xóa phí khác ${fee.name}`} disabled={frozen} onClick={() => removeFee(fee.id)}>×</button>
                </div>
              ))}
              {draft.addedFees.filter((fee) => fee.tripId === row.tripId).map((fee) => (
                <div className="csc-debit-otherfee" key={fee.key}>
                  <input className="csc-debit-input" placeholder="Tên phí" aria-label={`Tên phí mới ${row.containerNumber ?? row.tripId}`} value={fee.name} disabled={frozen}
                    onChange={(event) => setAddedFee(fee.key, { name: event.target.value })} />
                  <input className="csc-debit-input" placeholder="Số tiền" aria-label={`Số tiền phí mới ${row.containerNumber ?? row.tripId}`} value={fee.amount} disabled={frozen}
                    onChange={(event) => setAddedFee(fee.key, { amount: event.target.value })} />
                </div>
              ))}
              {!frozen && <button type="button" className="csc-debit-addfee" onClick={() => addFee(row.tripId)}>+ Thêm chi phí</button>}
            </td>
            <td className="csc-debit-warn-cell">{(row.carrierDetention ?? 0) > 0 && <><AlertTriangle aria-hidden="true" size={13} />⚠ </>}{money(row.carrierDetention)}</td>
            <td className="csc-debit-warn-cell">{(row.repairAdvance ?? 0) > 0 && <><AlertTriangle aria-hidden="true" size={13} />⚠ </>}{money(row.repairAdvance)}</td>
            <td><span className="csc-debit-docs"><Paperclip aria-hidden="true" size={13} />{row.opsDocsStatus === 'READY' ? 'Đã đủ' : 'Chờ bổ sung'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Adjust-cước panel: reason mandatory, contract freight kept visible for
 * comparison, and the before/after history beside the form. */
export function AdjustPanel({ detail, reason, setReason, pending, error, history, onSubmit }: {
  detail: ShipmentDebitDetail;
  reason: string;
  setReason: (value: string) => void;
  pending: boolean;
  error: string | null;
  history: Array<{ id: number; reason: string; adjustedAt: string }> | undefined;
  onSubmit: () => void;
}) {
  return (
    <div className="csc-debit-adjust">
      <p className="csc-debit-adjust__title">Điều chỉnh cước sau khóa — cước hợp đồng giữ lại để đối chiếu</p>
      <table className="csc-debit-table">
        <tbody>
          {detail.freightRows.map((row) => (
            <tr key={row.containerNumber}>
              <th scope="row">{row.containerNumber}{row.containerTypeLabel ? ` (${row.containerTypeLabel})` : ''}</th>
              <td>Cước hợp đồng: {row.freightCharge == null ? 'Chưa xác định' : formatMoney(row.freightCharge)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <label className="csc-debit-adjust__reason">
        <span>Lý do (bắt buộc)</span>
        <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} />
      </label>
      {history && history.length > 0 && (
        <ul className="csc-debit-adjust__history">
          {history.map((item) => (
            <li key={item.id}>
              <span>{new Date(item.adjustedAt).toLocaleString('vi-VN')}</span>
              <span>{item.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {error && <span className="csc-debit-save-error" role="alert">{error}</span>}
      <button type="button" disabled={pending || reason.trim() === ''} onClick={onSubmit}>
        {pending ? 'Đang gửi…' : 'Gửi điều chỉnh'}
      </button>
    </div>
  );
}

/** Bảng 2.3 — lot-level payable rollup. CUS reads; Ops writes upstream. */
export function PayablesTable({ payables }: { payables: ShipmentDebitDetail['payables'] }) {
  return (
    <table className="csc-debit-table csc-debit-table--payables">
      <caption>Bảng 2.3 — Phí Phải trả (chỉ xem)</caption>
      <tbody>
        <tr><th scope="row">Tổng chi hộ phải trả</th><td>{money(payables.chiHoTotal)}</td></tr>
      </tbody>
    </table>
  );
}
