import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adjustShipmentCost,
  getShipmentDebitDetail,
  listShipmentCostAdjustments,
  listShipmentCostLockHistory,
  lockShipmentCost,
  saveShipmentDebitEdits,
  unlockShipmentCost,
} from '../../../api/shipmentClient';
import { formatDateTimeVN } from '../../../lib/format';
import { useAuth } from '../../../hooks/useAuth';
import { useReasonPrompt } from '../../../components/reason-prompt';
import { useToast } from '../../../components/shared/Toast';
import { qk } from '../../../api/keys';
import { Role } from '@tingting/shared';
import { AdjustPanel, DebitCoHdBlock, DebitKhongHdBlock, DRAFT_EMPTY, buildDelta, buildDraft, deltaIsEmpty, type DraftState } from './ShipmentDebitTables';
import { UnattachedTripsTable } from './ShipmentDebitTables.unattached';
import './ShipmentDebitWorkspace.css';


export function ShipmentDebitWorkspace({ shipmentId, locked, lotCode, onSaved }: {
  shipmentId: number;
  locked: boolean;
  /** The lot's display code for the unlock toast; falls back to #id. */
  lotCode?: string | null;
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
  // SIL-790 (REV2 ticket-v2 VI.2) — a lot with NO Phí khác row anywhere used
  // to render the Chốt-giá-bán drawer without the [Thực chi Ops | Thu khách
  // hàng] pair at all (QA 10/11, C18): the pair is per-fee, and the lot had
  // no fee to pair. Seed ONE draft row in that case so the pair is on screen
  // the moment the drawer opens — CUS types Thu khách hàng directly; Lưu
  // creates the fee with that sell in ONE call (create now carries
  // sellAmount). A bare seed stays a no-op save (buildDelta skips it).
  const seededForLot = useRef<number | null>(null);
  useEffect(() => {
    const data = detail.data;
    if (!data || locked) return;
    if (seededForLot.current === shipmentId) return;
    const hasAnyFee = data.chiHoRows.some((row) => row.otherFees.length > 0);
    if (hasAnyFee) { seededForLot.current = shipmentId; return; }
    const tripId = data.chiHoRows[0]?.tripId;
    if (tripId == null) return;
    seededForLot.current = shipmentId;
    setDraft((current) => current.addedFees.length > 0 ? current : {
      ...current,
      addedFees: [{ key: 'seed-sil790', tripId, name: 'Phí không hóa đơn', amount: '', sell: '' }],
    });
  }, [detail.data, locked, shipmentId]);
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
  /** REV2 — the dual-input's editable side: Thu Khách Hàng per Phí khác row. */
  const setFeeSell = (feeId: number, value: string) => {
    setDraft((current) => ({ ...current, feeSells: { ...current.feeSells, [feeId]: value } }));
  };
  const addFee = (tripId: number) => {
    setDraft((current) => ({ ...current, addedFees: [...current.addedFees, { key: `new-${crypto.randomUUID()}`, tripId, name: '', amount: '', sell: '' }] }));
  };
  const removeFee = (feeId: number) => {
    setDraft((current) => ({ ...current, removedFeeIds: [...current.removedFeeIds, feeId], feeSells: Object.fromEntries(Object.entries(current.feeSells).filter(([id]) => Number(id) !== feeId)) }));
  };
  const setAddedFee = (key: string, patch: Partial<{ name: string; amount: string; sell: string }>) => {
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
  const role = auth?.user?.role;
  const { prompt, dialog: reasonDialog } = useReasonPrompt();
  const canLock = role === Role.ADMIN || role === Role.ACCOUNTANT || role === Role.CUS;
  const canAdjust = role === Role.ADMIN || role === Role.ACCOUNTANT;
  const settled = locked || justLocked;

  const lockCost = useMutation({
    mutationFn: () => lockShipmentCost(shipmentId, crypto.randomUUID()),
    onSuccess: async () => {
      setJustLocked(true);
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.detail(shipmentId) });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summaryAll });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.costLockHistory(shipmentId) });
      onSaved();
    },
  });

  // Audit 2026-11-04 §2.1 — MỞ KHÓA the active cost lock. Clearance mirrors
  // the backend route (SIL-721, owner 07/11: Quản trị · Giám đốc · Kế toán —
  // supersedes the audit's original ADMIN-only note); the mandatory
  // reason rides the house prompt. Shown while a lock is active (`settled`),
  // including the one this screen just took.
  const { toast } = useToast();
  const unlockCost = useMutation({
    mutationFn: (reason: string) => unlockShipmentCost(shipmentId, { reason }, crypto.randomUUID()),
    onSuccess: async () => {
      setJustLocked(false);
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.detail(shipmentId) });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.summaryAll });
      await queryClient.invalidateQueries({ queryKey: qk.shipmentDebit.costLockHistory(shipmentId) });
      toast({ kind: 'success', message: `Đã mở khóa chi phí lô ${lotCode ?? `#${shipmentId}`}` });
      onSaved();
    },
  });

  async function unlockLot() {
    const reason = await prompt('Nhập lý do mở khóa chi phí lô.', { confirmLabel: 'Mở khóa', reasonLabel: 'Lý do mở khóa (bắt buộc)' });
    if (reason == null) return;
    unlockCost.mutate(reason);
  }


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
  // SIL-679 r2 (QA comment 3834 §1b) — "Lịch sử khóa": the lot's khóa/mở
  // khóa trail on the lot detail. Read clearance mirrors the unlock route
  // (SIL-721, owner 07/11: Quản trị · Giám đốc (MANAGER) · Kế toán),
  // fetched whenever an allowed role opens this workspace — a lock/unlock
  // through the buttons above invalidates the key like the other queries,
  // so the section always shows the persisted trail.
  const canUnlock = role === Role.ADMIN || role === Role.MANAGER || role === Role.ACCOUNTANT;
  const lockHistory = useQuery({
    queryKey: qk.shipmentDebit.costLockHistory(shipmentId),
    queryFn: () => listShipmentCostLockHistory(shipmentId),
    enabled: canUnlock,
  });
  const adjustError = adjust.isError && adjust.error instanceof Error ? adjust.error.message : null;
  const lockError = lockCost.isError && lockCost.error instanceof Error ? lockCost.error.message : null;

  if (detail.isPending) return <p className="csc-debit-loading">Đang tải chi tiết lô…</p>;
  if (detail.isError || !detail.data) return <p className="csc-debit-error" role="alert">Không thể tải chi tiết quyết toán của lô.</p>;

  const frozen = settled || save.isPending;
  const delta = detail.data ? buildDelta(detail.data, draft) : null;
  return (
    <div className="csc-debit-workspace" data-locked={locked ? '' : undefined}>
      {/* SIL-837 (REV2) — the drawer reads as two named blocks: "Phí Có HĐ"
          (chỉ đọc) and "Phí Không HĐ" (nhập được) — not the old matrices. */}
      <DebitCoHdBlock detail={detail.data} />
      <DebitKhongHdBlock
        detail={detail.data}
        draft={draft}
        frozen={frozen}
        setFreight={setFreight}
        setFeeSell={setFeeSell}
        addFee={addFee}
        removeFee={removeFee}
        setAddedFee={setAddedFee}
      />
      {/* REV2 (ticket-v2 Phần VI mục 2) — Bảng 2.3 payables is OUT of the
          Chốt-giá-bán drawer: the CUS surface carries no giá vốn; cost work
          lives on Bảng Kiểm soát lô hàng (chot-debit). */}
      {/* Card 20260924_3 — display-only section for unattached fulfillment
          work; renders nothing when the lot has none (never zero-render). */}
      <UnattachedTripsTable trips={detail.data.unattachedTrips ?? []} />
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
      {/* SIL-679 r2 (QA comment 3834 §1b) — "Lịch sử khóa": the lot's
          khóa/mở khóa trail (read clearance mirrors the unlock route —
          Quản trị · Giám đốc · Kế toán per SIL-721). Static read-only
          status text — never styled actionable. */}
      {canUnlock && (
        <section className="csc-debit-lock-history" aria-label="Lịch sử khóa">
          <p className="csc-debit-lock-history__title">Lịch sử khóa</p>
          {lockHistory.isPending && <p className="csc-debit-lock-history__note">Đang tải lịch sử khóa…</p>}
          {lockHistory.isError && <p className="csc-debit-lock-history__note" role="alert">Không tải được lịch sử khóa.</p>}
          {lockHistory.data != null && (lockHistory.data.length === 0
            ? <p className="csc-debit-lock-history__note">Lô chưa từng khóa chi phí.</p>
            : <>
              {lockHistory.data[0]?.debitNoteId != null && (
                <p className="csc-debit-lock-history__note">Lô đang nằm trong Debit Note #{lockHistory.data[0].debitNoteId}</p>
              )}
              <ul className="csc-debit-adjust__history">
                {lockHistory.data.map((event, index) => (
                  <li key={`${event.lockId}-${event.action}-${index}`}>
                    <span>{formatDateTimeVN(event.timestamp)}</span>
                    <span>
                      {event.action === 'LOCK' ? 'Khóa lô' : 'Mở khóa lô'}
                      {` — ${event.actorName ?? (event.actorId != null ? `#${event.actorId}` : 'không rõ')}`}
                      {event.reason ? `: ${event.reason}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </>)}
        </section>
      )}
      <div className="csc-debit-actions">
        <button type="button" disabled={!settled || !canAdjust} aria-label="Điều chỉnh cước" title={!settled ? 'Chốt số liệu quyết toán trước khi điều chỉnh cước' : !canAdjust ? 'Lô đã khóa hoặc ngoài phạm vi được sửa' : undefined} onClick={() => setAdjustOpen((open) => !open)}>ĐIỀU CHỈNH CƯỚC</button>
        <button type="button" className="csc-debit-actions__lock" disabled={settled || !canLock} aria-label="Khóa lô hàng" title={settled ? 'Quyết toán đã khóa' : !canLock ? 'Cần quyền khóa lô hàng' : undefined} onClick={() => lockCost.mutate()}>KHÓA LÔ HÀNG</button>
        {lockCost.isPending && <span className="csc-debit-saved" role="status">Đang khóa…</span>}
        {lockError && <span className="csc-debit-save-error" role="alert">{lockError}</span>}
        {canUnlock && settled && (
          <button type="button" className="csc-debit-actions__unlock" disabled={unlockCost.isPending} aria-label="Mở khóa lô hàng" onClick={() => void unlockLot()}>MỞ KHÓA</button>
        )}
        {unlockCost.isPending && <span className="csc-debit-saved" role="status">Đang mở khóa…</span>}
        {unlockCost.isError && unlockCost.error instanceof Error && (
          <span className="csc-debit-save-error" role="alert">{unlockCost.error.message}</span>
        )}
      </div>
        {reasonDialog}
    </div>
  );
}
