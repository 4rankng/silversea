import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustShipmentCost,
  getShipmentDebitDetail,
  listShipmentCostAdjustments,
  lockShipmentCost,
  saveShipmentDebitEdits,
  type ShipmentDebitDetail,
} from '../../../api/shipmentClient';
import { useAuth } from '../../../hooks/useAuth';
import { Role } from '@tingting/shared';
import { AdjustPanel, ChiHoTable, DRAFT_EMPTY, FreightTable, PayablesTable, buildDelta, buildDraft, type DraftState } from './ShipmentDebitTables';
import './ShipmentDebitWorkspace.css';


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

  const setFreight = (containerNumber: string, patch: Partial<{ psActual: string; psNotes: string }>) => {
    setDraft((current) => {
      const prev = current.freight[containerNumber] ?? { psActual: '', psNotes: '' };
      return { ...current, freight: { ...current.freight, [containerNumber]: { psActual: patch.psActual ?? prev.psActual, psNotes: patch.psNotes ?? prev.psNotes } } };
    });
  };
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
      <FreightTable detail={detail.data} draft={draft} frozen={frozen} setFreight={setFreight} />
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
