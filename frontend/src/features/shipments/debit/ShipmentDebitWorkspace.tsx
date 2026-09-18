import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Paperclip } from 'lucide-react';
import {
  adjustShipmentCost,
  getShipmentDebitDetail,
  listShipmentCostAdjustments,
  lockShipmentCost,
  saveShipmentDebitEdits,
  type DebitDetailChiHoRow,
  type DebitDetailExpenseItem,
  type ShipmentDebitDetail,
  type ShipmentDebitEditsBody,
} from '../../../api/shipmentClient';
import { formatMoney } from '../../../lib/format';
import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import './ShipmentDebitWorkspace.css';

const money = (value: number | null | undefined) => (value == null || Number.isNaN(value) ? 'Chưa xác định' : formatMoney(value));

const num = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** CUS draft: per-expense sell/note edits, other-fee amount edits, and the
 * Phí khác add/remove lists. Pure delta — untouched cells never travel. */
interface DraftState {
  items: Record<number, { thuKhach: string; note: string }>;
  feeAmounts: Record<number, string>;
  addedFees: Array<{ key: string; tripId: number; name: string; amount: string }>;
  removedFeeIds: number[];
}

const DRAFT_EMPTY: DraftState = { items: {}, feeAmounts: {}, addedFees: [], removedFeeIds: [] };

const buildDraft = (detail: ShipmentDebitDetail): DraftState => ({
  items: {},
  feeAmounts: Object.fromEntries(detail.chiHoRows.flatMap((row) => row.otherFees.map((fee) => [fee.id, fee.amount == null ? '' : String(fee.amount)]))),
  addedFees: [],
  removedFeeIds: [],
});

const buildDelta = (detail: ShipmentDebitDetail, draft: DraftState): ShipmentDebitEditsBody => {
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

/** Bảng 2.1 — auto freight per trip (read-only engine output). */
function FreightTable({ detail }: { detail: ShipmentDebitDetail }) {
  return (
    <table className="csc-debit-table csc-debit-table--freight">
      <caption>Bảng 2.1 — Cước vận tải</caption>
      <thead><tr>
        <th scope="col">Chuyến</th>
        <th scope="col">Cước thu</th>
        <th scope="col">Phụ phí xăng dầu</th>
        <th scope="col">Tổng</th>
      </tr></thead>
      <tbody>
        {detail.freightRows.map((row, index) => (
          <tr key={row.tripId ?? `rate-${index}`}>
            <td>{row.rateKey ?? `Chuyến #${row.tripId ?? index + 1}`}</td>
            <td>{money(row.freight)}</td>
            <td>{money(row.surcharge)}</td>
            <td>{money(row.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Bảng 2.2 — chi hộ & tiền treo. Core expense rows read Ops amounts
 * read-only; thu khách and note are the CUS cells. OTHER lines are the
 * hand-managed Phí khác. */
function ChiHoTable({ detail, draft, frozen, setItem, setFeeAmount, addFee, removeFee, setAddedFee }: {
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
function AdjustPanel({ detail, reason, setReason, pending, error, history, onSubmit }: {
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
          {detail.freightRows.map((row, index) => (
            <tr key={row.tripId ?? index}>
              <th scope="row">{row.rateKey ?? `Chuyến #${row.tripId ?? index + 1}`}</th>
              <td>Cước hợp đồng: {row.freight == null ? 'Chưa xác định' : formatMoney(row.freight)}</td>
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
function PayablesTable({ payables }: { payables: ShipmentDebitDetail['payables'] }) {
  return (
    <table className="csc-debit-table csc-debit-table--payables">
      <caption>Bảng 2.3 — Phí Phải trả (chỉ xem)</caption>
      <tbody>
        <tr><th scope="row">Tổng chi hộ phải trả</th><td>{money(payables.chiHoTotal)}</td></tr>
      </tbody>
    </table>
  );
}

export function ShipmentDebitWorkspace({ shipmentId, locked, onSaved }: {
  shipmentId: number;
  locked: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ['shipment-debit-detail', shipmentId],
    queryFn: () => getShipmentDebitDetail(shipmentId),
  });
  const [draft, setDraft] = useState<DraftState>(DRAFT_EMPTY);
  useEffect(() => {
    if (detail.data) setDraft(buildDraft(detail.data));
  }, [detail.data]);
  const [justLocked, setJustLocked] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustReason, setAdjustReason] = useState('');

  const setItem = (expenseId: number, patch: Partial<{ thuKhach: string; note: string }>) => {
    setDraft((current) => {
      const prev = current.items[expenseId] ?? { thuKhach: '', note: '' };
      return { ...current, items: { ...current.items, [expenseId]: { thuKhach: patch.thuKhach ?? prev.thuKhach, note: patch.note ?? prev.note } } };
    });
  };
  const setFeeAmount = (feeId: number, value: string) => {
    setDraft((current) => ({ ...current, feeAmounts: { ...current.feeAmounts, [feeId]: value } }));
  };
  const addFee = (tripId: number) => {
    setDraft((current) => ({ ...current, addedFees: [...current.addedFees, { key: `new-${crypto.randomUUID()}`, tripId, name: '', amount: '' }] }));
  };
  const removeFee = (feeId: number) => {
    setDraft((current) => ({ ...current, removedFeeIds: [...current.removedFeeIds, feeId], feeAmounts: Object.fromEntries(Object.entries(current.feeAmounts).filter(([id]) => Number(id) !== feeId)) }));
  };
  const setAddedFee = (key: string, patch: Partial<{ name: string; amount: string }>) => {
    setDraft((current) => ({ ...current, addedFees: current.addedFees.map((fee) => (fee.key === key ? { ...fee, ...patch } : fee)) }));
  };

  const save = useMutation({
    mutationFn: () => {
      const body = detail.data ? buildDelta(detail.data, draft) : {};
      return saveShipmentDebitEdits(shipmentId, body, crypto.randomUUID());
    },
    onSuccess: async () => {
      setDraft(DRAFT_EMPTY);
      await queryClient.invalidateQueries({ queryKey: ['shipment-debit-detail', shipmentId] });
      await queryClient.invalidateQueries({ queryKey: ['shipment-debit-summary'] });
      onSaved();
    },
  });

  const auth = useAuth();
  const role = auth?.user?.role;
  const canLock = role === Role.ADMIN || role === Role.ACCOUNTANT || role === Role.CUS;
  const canAdjust = role === Role.ADMIN || role === Role.ACCOUNTANT;
  const settled = locked || justLocked;

  const lockCost = useMutation({
    mutationFn: () => lockShipmentCost(shipmentId, crypto.randomUUID()),
    onSuccess: async () => {
      setJustLocked(true);
      await queryClient.invalidateQueries({ queryKey: ['shipment-debit-detail', shipmentId] });
      await queryClient.invalidateQueries({ queryKey: ['shipment-debit-summary'] });
      onSaved();
    },
  });

  const adjust = useMutation({
    mutationFn: (reason: string) => adjustShipmentCost(shipmentId, { reason, changes: detail.data ? buildDelta(detail.data, draft) : {} }, crypto.randomUUID()),
    onSuccess: async () => {
      setAdjustOpen(false);
      setAdjustReason('');
      await queryClient.invalidateQueries({ queryKey: ['shipment-debit-detail', shipmentId] });
    },
  });

  const history = useQuery({
    queryKey: ['shipment-cost-adjustments', shipmentId],
    queryFn: () => listShipmentCostAdjustments(shipmentId),
    enabled: adjustOpen,
  });
  const adjustError = adjust.isError && adjust.error instanceof Error ? adjust.error.message : null;
  const lockError = lockCost.isError && lockCost.error instanceof Error ? lockCost.error.message : null;

  if (detail.isPending) return <p className="csc-debit-loading">Đang tải chi tiết lô…</p>;
  if (detail.isError || !detail.data) return <p className="csc-debit-error" role="alert">Không thể tải chi tiết quyết toán của lô.</p>;

  const frozen = settled || save.isPending;
  return (
    <div className="csc-debit-workspace" data-locked={locked ? '' : undefined}>
      <FreightTable detail={detail.data} />
      <ChiHoTable detail={detail.data} draft={draft} frozen={frozen} setItem={setItem} setFeeAmount={setFeeAmount} addFee={addFee} removeFee={removeFee} setAddedFee={setAddedFee} />
      <PayablesTable payables={detail.data.payables} />
      {adjustOpen && (
        <AdjustPanel
          detail={detail.data}
          reason={adjustReason}
          setReason={setAdjustReason}
          pending={adjust.isPending}
          error={adjustError}
          history={history.data}
          onSubmit={() => adjust.mutate(adjustReason)}
        />
      )}
      <div className="csc-debit-actions">
        <button type="button" disabled={frozen} onClick={() => save.mutate()}>{save.isPending ? 'Đang lưu…' : 'Lưu điều chỉnh'}</button>
        <button type="button" disabled={!settled || !canAdjust} aria-label="Điều chỉnh cước" onClick={() => setAdjustOpen((open) => !open)}>✏️ Điều chỉnh cước</button>
        <button type="button" disabled={settled || !canLock} aria-label="Khóa lô hàng" onClick={() => lockCost.mutate()}>🔒 Khóa lô hàng</button>
        {lockCost.isPending && <span className="csc-debit-saved" role="status">Đang khóa…</span>}
        {lockError && <span className="csc-debit-save-error" role="alert">{lockError}</span>}
        {save.isSuccess && <span className="csc-debit-saved" role="status">Đã lưu</span>}
        {save.isError && <span className="csc-debit-save-error" role="alert">Không lưu được — thử lại.</span>}
      </div>
    </div>
  );
}
