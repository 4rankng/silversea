import { useId, useRef, useState } from 'react';
import { qk } from '../../api/keys';
import { useQuery } from '@tanstack/react-query';
import { expenseAccountingClient } from '../../api/expenseAccountingClient';
import { driverClient } from '../../api/driverClient';
import { actionErrorMessage, backgroundErrorMessage } from '../../lib/api/action-error';
import { ExpenseProofs } from '../../features/expense-accounting/ExpenseProofs';
import type { DriverEvidenceKind } from '../../features/driver/useDriverExpenseEntry';

/** SIL-1132 (KB §10.6.2 / SIL-271) — the ONE Hóa đơn / Phiếu thu tick pair,
 *  "Loại chứng từ": exactly two house buttons (btn--sm — compact, on the 40px
 *  ordinary ceiling per ShipmentCostEntryForm.css) side by side, one of two,
 *  `aria-pressed` so assistive tech hears the choice. Shared by the draft row
 *  (pick the kind before saving) and this panel (declare the kind of a SAVED
 *  row) so the pair cannot drift between the two surfaces. */
export function EvidenceKindTicks({ value, disabled = false, onSelect }: {
  value: DriverEvidenceKind | null;
  disabled?: boolean;
  onSelect: (kind: DriverEvidenceKind) => void;
}) {
  const labelId = useId();
  return (
    <div className="shipment-cost-entry__evidence-ticks" role="group" aria-labelledby={labelId}>
      <span id={labelId} className="shipment-cost-entry__evidence-ticks-label">Loại chứng từ</span>
      <button type="button" className={`btn btn--sm${value === 'INVOICE' ? ' btn--primary' : ' btn--secondary'}`} aria-pressed={value === 'INVOICE'} disabled={disabled} onClick={() => onSelect('INVOICE')}>Hóa đơn</button>
      <button type="button" className={`btn btn--sm${value === 'RECEIPT' ? ' btn--primary' : ' btn--secondary'}`} aria-pressed={value === 'RECEIPT'} disabled={disabled} onClick={() => onSelect('RECEIPT')}>Phiếu thu</button>
    </div>
  );
}

/** Evidence belongs to the saved source: opening this never creates a cost.
 *  SIL-1132 — the panel is KIND-AWARE, never anonymous photos only: the driver
 *  declares the row's document kind (Hóa đơn or Phiếu thu) here and attaches
 *  its photo beneath, so kế toán phơi phiếu reads a classified paper. */
export function DriverSavedExpenseProofs({ expenseId, evidenceKind = null, onKindDeclared }: {
  expenseId: number;
  /** The row's declared kind; null = legacy unclassified ("Chưa phân loại"). */
  evidenceKind?: DriverEvidenceKind | null;
  /** Present ⇒ the declaration is wired (driver surface). Called after a
   *  successful declare so the saved-row caption re-reads the new kind. */
  onKindDeclared?: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const source = useQuery({ queryKey: qk.expenseAccounting.entry('DRIVER', expenseId), enabled: open,
    queryFn: () => expenseAccountingClient.get({ sourceKind: 'DRIVER', sourceId: expenseId }) });
  const loadError = source.error ? backgroundErrorMessage(source.error, 'Không tải được chứng từ.') : null;
  const kindLock = useRef(false);
  const [kindBusy, setKindBusy] = useState(false);
  const [kindError, setKindError] = useState<string | null>(null);
  async function declare(kind: DriverEvidenceKind) {
    if (!onKindDeclared || kindLock.current) return;
    kindLock.current = true; setKindBusy(true); setKindError(null);
    try {
      await driverClient.declareIncidentalCostEvidenceKind({ costId: expenseId, evidenceKind: kind });
      await onKindDeclared();
    } catch (cause) {
      // SIL-1035 — offline becomes the one Vietnamese sentence; server
      // refusals (e.g. the ROAD Phiếu-thu photo law) stay verbatim.
      const message = actionErrorMessage('khai loại chứng từ', cause, 'Chưa lưu được loại chứng từ.');
      if (message !== null) setKindError(message);
    } finally { kindLock.current = false; setKindBusy(false); }
  }
  // The kind is a mutation of the saved row — the same mutability reading as
  // "Sửa khoản chi" (RECORDED, unconfirmed, unlocked, unreconciled): a settled
  // row's classification is kế toán's to adjust through the linked correction.
  const mutable = source.data != null && source.data.status === 'RECORDED'
    && !source.data.locked && !source.data.confirmedAt && !source.data.reconciliationId;
  return <div><button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(value => !value)} aria-expanded={open}>
    {open ? 'Ẩn chứng từ' : 'Xem / bổ sung chứng từ'}
  </button>{open && <>{source.isPending && <p role="status">Đang tải chứng từ…</p>}{loadError && <p role="alert">{loadError}</p>}
    {source.data && onKindDeclared && (mutable
      ? <EvidenceKindTicks value={evidenceKind} disabled={kindBusy} onSelect={(kind) => void declare(kind)} />
      : <p className="shipment-cost-entry__empty">Loại chứng từ: {evidenceKind === 'INVOICE' ? 'Hóa đơn' : evidenceKind === 'RECEIPT' ? 'Phiếu thu' : 'Chưa phân loại chứng từ'} — khoản chi đã đối chiếu hoặc khóa, liên hệ kế toán để đổi loại chứng từ.</p>)}
    {kindBusy && <p role="status" className="shipment-cost-entry__empty">Đang lưu loại chứng từ…</p>}
    {kindError && <p role="alert" className="shipment-cost-entry__banner--error">{kindError}</p>}
    {source.data && <ExpenseProofs entry={source.data} canUpload={source.data.status === 'RECORDED'} />}</>}</div>;
}
