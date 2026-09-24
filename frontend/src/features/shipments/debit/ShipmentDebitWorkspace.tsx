import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustShipmentCost,
  getShipmentDebitDetail,
  listShipmentCostAdjustments,
  lockShipmentCost,
  saveShipmentDebitEdits,
} from '../../../api/shipmentClient';
import { useAuth } from '../../../hooks/useAuth';
import { useActiveQuotationFees } from '../../../hooks/useQuotationQueries';
import { useReasonPrompt } from '../../../components/reason-prompt';
import { qk } from '../../../api/keys';
import { Role } from '@tingting/shared';
import { AdjustPanel, ChiHoTable, DRAFT_EMPTY, FreightTable, PayablesTable, buildDelta, buildDraft, deltaIsEmpty, type DraftState } from './ShipmentDebitTables';
import './ShipmentDebitWorkspace.css';


export function ShipmentDebitWorkspace({ shipmentId, customerId, locked, onSaved }: {
  shipmentId: number;
  /** Card _64: the L1 filter's customer — keys the active-frame fee catalog
   *  (dedicated routing columns + the ghi chú aggregation). */
  customerId: number;
  locked: boolean;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: qk.shipmentDebit.detail(shipmentId),
    queryFn: () => getShipmentDebitDetail(shipmentId),
  });
  const [draft, setDraft] = useState<DraftState>(DRAFT_EMPTY);
  useEffect(() => {
    if (detail.data) setDraft(buildDraft(detail.data));
  }, [detail.data]);
  const [justLocked, setJustLocked] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustReason, setAdjustReason] = useState('');
  const saveAttempt = useRef<{ signature: string; key: string } | null>(null);
  const saveInFlight = useRef(false);

  const setFreight = (containerNumber: string, patch: Partial<{ psActual: string; note: string }>) => {
    setDraft((current) => {
      const prev = current.freight[containerNumber] ?? { psActual: '', note: '' };
      return { ...current, freight: { ...current.freight, [containerNumber]: { psActual: patch.psActual ?? prev.psActual, note: patch.note ?? prev.note } } };
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
    mutationFn: ({ body, key }: { body: ReturnType<typeof buildDelta>; key: string }) =>
      saveShipmentDebitEdits(shipmentId, body, key),
    onSuccess: async () => {
      saveAttempt.current = null;
      setDraft(DRAFT_EMPTY);
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.detail(shipmentId) });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summaryAll });
      onSaved();
    },
    onSettled: () => { saveInFlight.current = false; },
  });

  async function saveDraft() {
    if (saveInFlight.current || !detail.data) return;
    const body = buildDelta(detail.data, draft);
    if (deltaIsEmpty(body)) return;
    // Q10 (card 20260922_78): a removal batch requires a mandatory free-text
    // reason — prompt before anything is sent; cancel aborts the whole save.
    let outgoing = body;
    if (body.removeExpenseIds?.length) {
      const reason = await prompt('Nhập lý do bỏ các dòng phí đã chọn trước khi lưu.', { confirmLabel: 'Lưu' });
      if (reason == null) return;
      outgoing = { ...body, removalReason: reason };
    }
    const signature = JSON.stringify([shipmentId, outgoing]);
    // A missing response may follow a committed write. Replaying an unchanged
    // command must reuse its key, especially when it adds new expense rows.
    if (saveAttempt.current?.signature !== signature) {
      saveAttempt.current = { signature, key: crypto.randomUUID() };
    }
    saveInFlight.current = true;
    save.mutate({ body: outgoing, key: saveAttempt.current.key });
  }

  const auth = useAuth();
  const feeCatalog = useActiveQuotationFees(customerId).data ?? [];
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const role = auth?.user?.role;
  const canLock = role === Role.ADMIN || role === Role.ACCOUNTANT || role === Role.CUS;
  const canAdjust = role === Role.ADMIN || role === Role.ACCOUNTANT;
  const settled = locked || justLocked;

  const lockCost = useMutation({
    mutationFn: () => lockShipmentCost(shipmentId, crypto.randomUUID()),
    onSuccess: async () => {
      setJustLocked(true);
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.detail(shipmentId) });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summaryAll });
      onSaved();
    },
  });

  const adjust = useMutation({
    mutationFn: (reason: string) => adjustShipmentCost(shipmentId, { reason, changes: detail.data ? buildDelta(detail.data, draft) : {} }, crypto.randomUUID()),
    onSuccess: async () => {
      setAdjustOpen(false);
      setAdjustReason('');
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.detail(shipmentId) });
    },
  });

  const history = useQuery({
    queryKey: qk.shipmentDebit.costAdjustments(shipmentId),
    queryFn: () => listShipmentCostAdjustments(shipmentId),
    enabled: adjustOpen,
  });
  const adjustError = adjust.isError && adjust.error instanceof Error ? adjust.error.message : null;
  const lockError = lockCost.isError && lockCost.error instanceof Error ? lockCost.error.message : null;

  if (detail.isPending) return <p className="csc-debit-loading">Đang tải chi tiết lô…</p>;
  if (detail.isError || !detail.data) return <p className="csc-debit-error" role="alert">Không thể tải chi tiết quyết toán của lô.</p>;

  const frozen = settled || save.isPending;
  const delta = detail.data ? buildDelta(detail.data, draft) : null;
  return (
    <div className="csc-debit-workspace" data-locked={locked ? '' : undefined}>
      <FreightTable detail={detail.data} draft={draft} frozen={frozen} setFreight={setFreight} />
      <ChiHoTable detail={detail.data} draft={draft} frozen={frozen} feeCatalog={feeCatalog} setFeeAmount={setFeeAmount} addFee={addFee} removeFee={removeFee} setAddedFee={setAddedFee} />
      <PayablesTable detail={detail.data} />
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
      {!frozen && delta && !deltaIsEmpty(delta) && (
        <div className="csc-debit-savebar">
          <button type="button" disabled={save.isPending} onClick={saveDraft}>
            {save.isPending ? 'Đang lưu…' : 'Lưu điều chỉnh'}
          </button>
          {save.isSuccess && <span className="csc-debit-saved" role="status">Đã lưu</span>}
          {save.isError && <span className="csc-debit-save-error" role="alert">Không lưu được — thử lại.</span>}
        </div>
      )}
      <div className="csc-debit-actions">
        <button type="button" disabled={!settled || !canAdjust} aria-label="Điều chỉnh cước" onClick={() => setAdjustOpen((open) => !open)}>✏️ ĐIỀU CHỈNH CƯỚC</button>
        <button type="button" className="csc-debit-actions__lock" disabled={settled || !canLock} aria-label="Khóa lô hàng" onClick={() => lockCost.mutate()}>🔒 KHÓA LÔ HÀNG</button>
        {lockCost.isPending && <span className="csc-debit-saved" role="status">Đang khóa…</span>}
        {lockError && <span className="csc-debit-save-error" role="alert">{lockError}</span>}
      </div>
        {reasonDialog}
    </div>
  );
}
