import { useMemo, useState } from 'react';
import { Loader2, Check, Info, Wallet, Receipt, FileText, User } from 'lucide-react';
import { formatCurrency, formatDate } from '../lib/format';
import { Money } from '../components/shared/Money';
import { Modal } from '../components/UI';
import { NumberField } from '../design-system';
import { useAdminAdvanceBalances, useAdminSettlementEligibility, useCreateAdvanceSettlementForForwarder } from '../hooks/useForwarderQueries';
import { useCatalogs } from '../hooks/useCatalogs';
import { ExpenseEntryStatus } from '@tingting/shared';
import type { AdminCreateAdvanceSettlementInput } from '@tingting/shared';
import { expenseLabel } from '../features/forwarder/forwarder-settlement-model';

/**
 * SIL-487 — "Lập phiếu hoàn ứng" cho kế toán (nghiệp vụ chi hộ, PRD
 * PhanHeKeToan mockup ảnh 8/9). Kế toán chọn nhân viên có tạm ứng còn tồn,
 * chọn tạm ứng + khoản chi chưa gắn phiếu, khai tiền hoàn lại (CÓ DẤU — FB-100)
 * rồi tick "Xác nhận hoàn ứng" trước khi ghi nhận. Same apply-at-creation
 * contract as the Ops self-service form: the tick of the SUBMITTER (here the
 * accountant) is the "xác nhận hoàn ứng" stamp (FB-100 Option B).
 */
export default function AdminAdvanceSettlementCreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [forwarderId, setForwarderId] = useState<number | null>(null);
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<number>>(new Set());
  const [refundAmount, setRefundAmount] = useState('0');
  const [note, setNote] = useState('');
  // FB-100 — the live submit's own mandatory tick; gates BOTH the footer
  // button and the handler (keyboard/programmatic submit must not bypass it).
  const [refundConfirmed, setRefundConfirmed] = useState(false);

  const { data: balancesData } = useAdminAdvanceBalances();
  const eligibility = useAdminSettlementEligibility(open ? forwarderId : null);
  const { data: catalogs } = useCatalogs();
  const createSettlement = useCreateAdvanceSettlementForForwarder();

  const balances = balancesData?.items ?? [];
  const advances = eligibility.data?.advances ?? [];
  const expenses = eligibility.data?.expenses ?? [];
  const expenseTypeOptions = useMemo(() => catalogs?.forwarderExpenseTypes ?? [], [catalogs]);

  const totalAdvance = advances
    .filter(r => selectedRequestIds.has(r.id))
    .reduce((sum, r) => sum + Number(r.amount), 0);
  const totalExpense = expenses
    .filter(e => selectedExpenseIds.has(e.id))
    .reduce((sum, e) => sum + Number(e.buyAmount), 0);
  const totalRefund = Number(refundAmount) || 0;
  const balance = totalAdvance - totalExpense - totalRefund;

  function pickForwarder(id: number) {
    if (id === forwarderId) return;
    setForwarderId(id);
    setSelectedRequestIds(new Set());
    setSelectedExpenseIds(new Set());
    // SIL-487 review — refund/note typed for the previous staff must not ride
    // into another staff's phiếu; the balance warning alone is not a guard.
    setRefundAmount('0');
    setNote('');
    setRefundConfirmed(false);
  }

  function toggleRequest(id: number) {
    setSelectedRequestIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleExpense(id: number) {
    const expense = expenses.find(item => item.id === id);
    // Same readiness law as the Ops form: Ops phải kê xong khoản chi trước
    // khi phiếu nhận nó (settlement never promotes an incomplete cost).
    if (expense?.completionStatus !== ExpenseEntryStatus.COMPLETED) return;
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function reset() {
    setForwarderId(null);
    setSelectedRequestIds(new Set());
    setSelectedExpenseIds(new Set());
    setRefundAmount('0');
    setNote('');
    setRefundConfirmed(false);
  }

  function handleClose() {
    if (createSettlement.isPending) return;
    createSettlement.reset();
    reset();
    onClose();
  }

  async function handleSubmit() {
    // FB-100 — the tick gates the handler too, not just the button.
    if (forwarderId == null || selectedRequestIds.size === 0 || !refundConfirmed || createSettlement.isPending) return;
    const payload: AdminCreateAdvanceSettlementInput = {
      forwarderId,
      refundAmount: totalRefund,
      note: note || undefined,
      advanceRequestIds: Array.from(selectedRequestIds),
      ...(selectedExpenseIds.size > 0 ? { tripExpenseIds: Array.from(selectedExpenseIds) } : {}),
    };
    try {
      await createSettlement.mutateAsync(payload);
      reset();
      onClose();
    } catch {
      // Mutation error renders inside the dialog; keep the selections.
    }
  }

  const isFormReady = forwarderId != null && selectedRequestIds.size > 0 && refundConfirmed;

  return (
    <Modal
      isOpen={open}
      title="Lập phiếu hoàn ứng"
      subtitle="Nghiệp vụ chi hộ"
      polished
      ariaLabel="Lập phiếu hoàn ứng cho nhân viên"
      maxWidth={640}
      onClose={handleClose}
      footer={
        <>
          <span className="as-create__footer-hint">
            {forwarderId == null
              ? 'Chọn nhân viên trước.'
              : selectedRequestIds.size === 0
                ? 'Chọn ít nhất 1 tạm ứng chưa quyết toán.'
                : !refundConfirmed
                  ? 'Tích "Xác nhận hoàn ứng" trước khi ghi nhận phiếu.'
                  : undefined}
          </span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={handleClose}>
            Hủy
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            disabled={!isFormReady || createSettlement.isPending}
            onClick={handleSubmit}
          >
            {createSettlement.isPending ? <Loader2 size={14} className="spin" /> : <Check size={14} />}
            Ghi nhận phiếu
          </button>
        </>
      }
    >
      <div className="as-create">
        {/* ── Bước 1: chọn nhân viên (tồn tạm ứng) ── */}
        <fieldset className="as-create__section">
          <legend className="as-create__section-title"><User size={14} aria-hidden="true" /> Nhân viên được quyết toán</legend>
          {balances.length === 0 ? (
            <p className="as-create__empty">Không có tạm ứng nào còn tồn trên hệ thống.</p>
          ) : (
            <div className="as-create__pick-list" role="radiogroup" aria-label="Nhân viên được quyết toán">
              {balances.map(item => (
                <label key={item.forwarderId} className={`as-create__pick${forwarderId === item.forwarderId ? ' as-create__pick--selected' : ''}`}>
                  <input
                    type="radio"
                    name="as-create-forwarder"
                    checked={forwarderId === item.forwarderId}
                    onChange={() => pickForwarder(item.forwarderId)}
                  />
                  <span className="as-create__pick-name">{item.name}</span>
                  <span className="as-create__pick-meta">Còn tạm ứng <Money value={Number(item.outstanding)} /></span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        {forwarderId != null && (
          eligibility.isPending ? (
            <p className="as-create__loading" role="status"><Loader2 size={14} className="spin" /> Đang tải tạm ứng và khoản chi…</p>
          ) : eligibility.isError ? (
            <p className="as-create__empty" role="alert">{eligibility.error instanceof Error ? eligibility.error.message : 'Không tải được danh sách tạm ứng.'}</p>
          ) : (
            <>
              {/* ── Bước 2a: tạm ứng chưa quyết toán ── */}
              <fieldset className="as-create__section">
                <legend className="as-create__section-title"><Wallet size={14} aria-hidden="true" /> Tạm ứng chưa quyết toán</legend>
                {advances.length === 0 ? (
                  <p className="as-create__empty">
                    Nhân viên này không có tạm ứng đủ điều kiện (chưa giải ngân đủ hoặc đã nằm trong phiếu khác).
                  </p>
                ) : (
                  <div className="as-create__pick-list">
                    {advances.map(r => (
                      <label key={r.id} className={`as-create__pick${selectedRequestIds.has(r.id) ? ' as-create__pick--selected' : ''}`}>
                        <input type="checkbox" checked={selectedRequestIds.has(r.id)} onChange={() => toggleRequest(r.id)} />
                        <span className="as-create__pick-name">{formatCurrency(Number(r.amount))}</span>
                        <span className="as-create__pick-meta">{r.reason} · {formatDate(r.createdAt)}</span>
                      </label>
                    ))}
                  </div>
                )}
              </fieldset>

              {/* ── Bước 2b: khoản chi chưa gắn phiếu ── */}
              <fieldset className="as-create__section">
                <legend className="as-create__section-title"><Receipt size={14} aria-hidden="true" /> Khoản chi chưa gắn phiếu</legend>
                {expenses.length === 0 ? (
                  <p className="as-create__empty">Không có khoản chi nào chưa thanh toán.</p>
                ) : (
                  <div className="as-create__pick-list">
                    {expenses.map(exp => {
                      const settled = exp.completionStatus !== ExpenseEntryStatus.COMPLETED;
                      return (
                        <label
                          key={exp.id}
                          className={`as-create__pick${selectedExpenseIds.has(exp.id) ? ' as-create__pick--selected' : ''}${settled ? ' as-create__pick--disabled' : ''}`}
                        >
                          <input type="checkbox" checked={selectedExpenseIds.has(exp.id)} disabled={settled} onChange={() => toggleExpense(exp.id)} />
                          <span className="as-create__pick-name">{expenseLabel(exp.expenseType, expenseTypeOptions)}</span>
                          <span className="as-create__pick-meta">
                            {formatCurrency(Number(exp.buyAmount))}
                            {exp.tripCode ? ` · ${exp.tripCode}` : ''}
                            {settled ? ' · Ops chưa xác nhận kê xong' : ''}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </fieldset>

              {/* ── Tổng kết + tiền hoàn lại ── */}
              <div className="as-create__summary">
                <div className="as-create__summary-row"><FileText size={14} aria-hidden="true" /> <span>Tạm ứng</span> <strong><Money value={totalAdvance} /></strong></div>
                <div className="as-create__summary-row"><span>Chi phí</span> <strong><Money value={totalExpense} sign={totalExpense === 0 ? undefined : '−'} /></strong></div>
                <div className="as-create__summary-row as-create__summary-row--refund">
                  <label className="as-create__refund-label" htmlFor="as-create-refund">Tiền hoàn lại</label>
                  <NumberField
                    grouped
                    signed
                    id="as-create-refund"
                    value={refundAmount === '' ? '' : Number(refundAmount)}
                    onChange={(n) => setRefundAmount(n === '' ? '' : String(n))}
                    placeholder="0"
                  />
                </div>
                {balance !== 0 && (
                  <p className="as-create__warn" role="status">
                    <Info size={14} aria-hidden="true" />
                    Chênh lệch: {formatCurrency(balance)} (tạm ứng − chi phí − hoàn lại)
                  </p>
                )}
                <label className="as-create__confirm" data-field-id="admin-settlement-refund-confirmed">
                  <input
                    type="checkbox"
                    checked={refundConfirmed}
                    onChange={e => setRefundConfirmed(e.target.checked)}
                    disabled={createSettlement.isPending}
                  />
                  Xác nhận hoàn ứng
                </label>
              </div>
            </>
          )
        )}

        {createSettlement.error && (
          <p className="as-create__empty" role="alert">
            {createSettlement.error instanceof Error ? createSettlement.error.message : 'Không ghi nhận được phiếu hoàn ứng. Thử lại.'}
          </p>
        )}
      </div>
    </Modal>
  );
}
