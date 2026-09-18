import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Paperclip } from 'lucide-react';
import { adjustShipmentCost, getShipmentDebitDetail, listShipmentCostAdjustments, lockShipmentCost, saveShipmentDebitEdits } from '../../../api/shipmentClient';
import type { ShipmentDebitChiHoRow, ShipmentDebitDetail, ShipmentDebitFreightRow } from '../../../api/shipmentClient';
import { formatMoney } from '../../../lib/format';
import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import './ShipmentDebitWorkspace.css';

const money = (value: string | null | undefined) => (value == null || value === '' ? 'Chưa xác định' : formatMoney(value));

const num = (value: string | null | undefined): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

interface DraftState {
  freight: Record<string, { psActual: string; psNotes: string }>;
  chiHo: Record<string, { otherFees: Array<{ name: string; amount: string }> }>;
  thuKhach: string;
}

const buildDraft = (detail: ShipmentDebitDetail): DraftState => ({
  freight: Object.fromEntries(detail.freightRows.map((row) => [row.containerNumber, { psActual: row.psActual ?? '', psNotes: row.psNotes ?? '' }])),
  chiHo: Object.fromEntries(detail.chiHoRows.map((row) => [row.containerNumber, { otherFees: row.otherFees.map((fee) => ({ name: fee.name, amount: fee.amount ?? '' })) }])),
  thuKhach: detail.thuKhachTotal ?? '',
});

const DRAFT_EMPTY: DraftState = { freight: {}, chiHo: {}, thuKhach: '' };

/** Bảng 2.1 — auto freight per container + the CUS-entered actual PS. */
function FreightTable({ detail, draft, frozen, setFreight }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setFreight: (containerNumber: string, patch: Partial<{ psActual: string; psNotes: string }>) => void;
}) {
  const columns = ['Số Container', 'Cước thu', 'Phụ phí xăng dầu', 'Lạch Huyện', 'Phí Hải Quan', 'PS thực tế', 'Tổng', 'Ghi chú'];
  return (
    <table className="csc-debit-table csc-debit-table--freight">
      <caption>Bảng 2.1 — Cước vận tải</caption>
      <thead><tr>{columns.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
      <tbody>
        {detail.freightRows.map((row) => {
          const cells = draft.freight[row.containerNumber] ?? { psActual: '', psNotes: '' };
          const total = num(row.freightCharge) + num(row.fuelSurcharge) + num(row.lachHuyenFee) + num(row.customsFee) + num(cells.psActual || null);
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
              <td>{money(total == 0 ? null : String(total))}</td>
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

/** Bảng 2.2 — chi hộ & tiền treo per container. Ops rows read-only for CUS. */
function ChiHoTable({ detail, draft, frozen, setOtherFees, addOtherFee }: {
  detail: ShipmentDebitDetail;
  draft: DraftState;
  frozen: boolean;
  setOtherFees: (containerNumber: string, fees: Array<{ name: string; amount: string }>) => void;
  addOtherFee: (containerNumber: string) => void;
}) {
  const armed = (row: ShipmentDebitChiHoRow) => num(row.carrierDetention) > 0 || num(row.repairAdvance) > 0;
  return (
    <table className="csc-debit-table csc-debit-table--chiho">
      <caption>Bảng 2.2 — Phí Chi Hộ &amp; Tiền Treo</caption>
      <thead><tr>
        <th scope="col">Số Container</th><th scope="col">Phí Nâng</th><th scope="col">Phí Hạ</th>
        <th scope="col">Phí CSHT</th><th scope="col">Chi phí Ops có hóa đơn</th>
        <th scope="col">Phí khác (CUS nhập)</th><th scope="col">Cược hãng tàu</th>
        <th scope="col">Tạm thu sửa chữa</th><th scope="col">Chứng từ Ops</th>
      </tr></thead>
      <tbody>
        {detail.chiHoRows.map((row) => (
          <tr key={row.containerNumber} className={armed(row) ? 'csc-debit-row--warn' : undefined}>
            <td>{row.containerNumber}</td>
            <td>{money(row.liftFee)}</td>
            <td>{money(row.lowerFee)}</td>
            <td>{row.cshtFee == null ? 'Chưa xác định' : `${formatMoney(row.cshtFee)}${row.cshtInvoiceNumber ? ` (HD ${row.cshtInvoiceNumber})` : ''}`}</td>
            <td>{money(row.opsPaidTotal)}</td>
            <td>
              {(draft.chiHo[row.containerNumber]?.otherFees ?? []).map((fee, index) => (
                <div className="csc-debit-otherfee" key={index}>
                  <input className="csc-debit-input" placeholder="Tên phí" aria-label={`Tên phí khác ${row.containerNumber} ${index + 1}`} value={fee.name} disabled={frozen}
                    onChange={(event) => { const fees = [...(draft.chiHo[row.containerNumber]?.otherFees ?? [])]; fees[index] = { ...fees[index], name: event.target.value }; setOtherFees(row.containerNumber, fees); }} />
                  <input className="csc-debit-input" placeholder="Số tiền" aria-label={`Số tiền phí khác ${row.containerNumber} ${index + 1}`} value={fee.amount} disabled={frozen}
                    onChange={(event) => { const fees = [...(draft.chiHo[row.containerNumber]?.otherFees ?? [])]; fees[index] = { ...fees[index], amount: event.target.value }; setOtherFees(row.containerNumber, fees); }} />
                  <button type="button" aria-label={`Xóa phí khác ${row.containerNumber} ${index + 1}`} disabled={frozen}
                    onClick={() => setOtherFees(row.containerNumber, (draft.chiHo[row.containerNumber]?.otherFees ?? []).filter((_, i) => i !== index))}>×</button>
                </div>
              ))}
              {!frozen && <button type="button" className="csc-debit-addfee" onClick={() => addOtherFee(row.containerNumber)}>+ Thêm chi phí</button>}
            </td>
            <td className="csc-debit-warn-cell">{num(row.carrierDetention) > 0 && <><AlertTriangle aria-hidden="true" size={13} />⚠ </>}{money(row.carrierDetention)}</td>
            <td className="csc-debit-warn-cell">{num(row.repairAdvance) > 0 && <><AlertTriangle aria-hidden="true" size={13} />⚠ </>}{money(row.repairAdvance)}</td>
            <td><span className="csc-debit-docs"><Paperclip aria-hidden="true" size={13} />{row.opsDocsStatus === 'READY' ? 'Đã đủ' : 'Chờ bổ sung'}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Bảng 2.3 — lot-level payables. CUS reads; only Ops/dispatch writes these. */
function PayablesTable({ payables }: { payables: ShipmentDebitDetail['payables'] }) {
  const rows: Array<[string, string | null]> = [
    ['Cước trả + Lạch Huyện', payables.freightReturn],
    ['Phí HQGS', payables.customsFee],
    ['Phí phát sinh (Ops)', payables.psOps],
  ];
  return (
    <table className="csc-debit-table csc-debit-table--payables">
      <caption>Bảng 2.3 — Phí Phải trả (chỉ xem)</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}><th scope="row">{label}</th><td>{money(value)}</td></tr>
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
          {detail.freightRows.map((row) => (
            <tr key={row.containerNumber}>
              <th scope="row">{row.containerNumber}</th>
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
  const [justLocked, setJustLocked] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustReason, setAdjustReason] = useState('');
  useEffect(() => {
    if (detail.data) setDraft(buildDraft(detail.data));
  }, [detail.data]);

  const setFreight = (containerNumber: string, patch: Partial<{ psActual: string; psNotes: string }>) => {
    setDraft((current) => ({ ...current, freight: { ...current.freight, [containerNumber]: { ...(current.freight[containerNumber] ?? { psActual: '', psNotes: '' }), ...patch } } }));
  };
  const setOtherFees = (containerNumber: string, fees: Array<{ name: string; amount: string }>) => {
    setDraft((current) => ({ ...current, chiHo: { ...current.chiHo, [containerNumber]: { otherFees: fees } } }));
  };
  const addOtherFee = (containerNumber: string) => {
    setOtherFees(containerNumber, [...(draft.chiHo[containerNumber]?.otherFees ?? []), { name: '', amount: '' }]);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        freightRows: detail.data?.freightRows.map((row) => ({ containerNumber: row.containerNumber, ...(draft.freight[row.containerNumber] ?? { psActual: '', psNotes: '' }) })) ?? [],
        chiHoRows: detail.data?.chiHoRows.map((row) => ({ containerNumber: row.containerNumber, otherFees: draft.chiHo[row.containerNumber]?.otherFees ?? [] })) ?? [],
        thuKhachTotal: draft.thuKhach === '' ? null : draft.thuKhach,
      };
      return saveShipmentDebitEdits(shipmentId, body, crypto.randomUUID());
    },
    onSuccess: async () => {
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
    mutationFn: (reason: string) => adjustShipmentCost(shipmentId, { reason, changes: {
      freightRows: detail.data?.freightRows.map((row) => ({ containerNumber: row.containerNumber, ...(draft.freight[row.containerNumber] ?? { psActual: '', psNotes: '' }) })) ?? [],
      chiHoRows: detail.data?.chiHoRows.map((row) => ({ containerNumber: row.containerNumber, otherFees: draft.chiHo[row.containerNumber]?.otherFees ?? [] })) ?? [],
      thuKhachTotal: draft.thuKhach === '' ? null : draft.thuKhach,
    } }, crypto.randomUUID()),
    onSuccess: async () => {
      setAdjustOpen(false);
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
      <FreightTable detail={detail.data} draft={draft} frozen={frozen} setFreight={setFreight} />
      <ChiHoTable detail={detail.data} draft={draft} frozen={frozen} setOtherFees={setOtherFees} addOtherFee={addOtherFee} />
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
        <label className="csc-debit-thukhach">
          <span>Thu khách</span>
          <input className="csc-debit-input" aria-label="Thu khách" value={draft.thuKhach} disabled={frozen} onChange={(event) => setDraft((current) => ({ ...current, thuKhach: event.target.value }))} />
        </label>
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
