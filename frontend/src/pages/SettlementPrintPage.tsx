import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Printer, Loader2, FileSpreadsheet, X, Pencil, Save, CheckCircle2, RotateCcw } from 'lucide-react';
import { formatCurrency } from '../lib/format';
import { ADVANCE_SETTLEMENT_STATUS_LABELS, type AdvanceSettlementStatus } from '@tingting/shared';
import { api } from '../lib/api';
import {
  useForwarderSettlementDetail,
  useAdminSettlementDetail,
  useUpdateAdvanceSettlement,
  useUpdateSettlementExpense,
  useCheckSettlement,
  useApproveSettlement,
  useReverseAdvanceSettlement,
} from '../hooks/useForwarderQueries';
import { useAuth } from '../hooks/useAuth';
import { PageHeader, StatusPill } from '../components/UI';
import { usePageAnimations } from '../hooks/animations';
import { useBackShortcut } from '../hooks/useBackShortcut';
import './SettlementPrintPage.css';

// ─── Expense type Vietnamese labels ───
const EXPENSE_TYPE_LABELS: Record<string, string> = {
  LIFTING: 'Nâng hạ',
  LOWERING: 'Nâng hạ',
  INFRASTRUCTURE: 'Hạ tầng',
  CUSTOMS: 'Thủ tục HQ',
  WEIGHING: 'Cân hàng',
  INSPECTION: 'Kiểm tra',
  OTHER: 'Khác',
};

function settlementStatusVariant(status: AdvanceSettlementStatus): 'neutral' | 'info' | 'warn' | 'success' | 'danger' {
  switch (status) {
    case 'PENDING': return 'warn';
    case 'CHECKED_BY_ACCOUNTANT': return 'info';
    case 'APPROVED': return 'success';
    case 'REJECTED': return 'danger';
    default: return 'neutral';
  }
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit' });
}

interface LinkedExpense {
  id: number;
  tripId: number;
  expenseType: string;
  buyAmount: string;
  sellAmount?: string;
  submittedBuyAmount?: string | null;
  adjustmentReason?: string | null;
  adjustedAt?: string | null;
  completionStatus?: string | null;
  containerNumber: string | null;
  invoiceNumber: string | null;
  note: string | null;
  tripCode: string | null;
  departureDate: string | null;
  customerName: string | null;
}

interface LinkedRequest {
  id: number;
  amount: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface SettlementData {
  id: number;
  version: number;
  code: string;
  forwarderId: number;
  forwarderName?: string;
  totalExpenseAmount: string;
  refundAmount: string;
  status: AdvanceSettlementStatus;
  checkedBy: number | null;
  checkerName?: string | null;
  approvedBy: number | null;
  approverName?: string | null;
  note: string | null;
  createdAt: string;
  linkedRequests?: LinkedRequest[];
  linkedExpenses?: LinkedExpense[];
  eligibleAdvanceRequests?: LinkedRequest[];
  eligibleExpenses?: LinkedExpense[];
}

export function settlementReviewPermissions(input: {
  isPortal: boolean;
  userId?: number;
  role?: string;
  settlement: Pick<SettlementData, 'status' | 'checkedBy' | 'forwarderId'>;
}) {
  const isFinancialReviewer = !input.isPortal
    && (input.role === 'ACCOUNTANT' || input.role === 'ADMIN');
  return {
    canEditAndCheck: isFinancialReviewer && input.settlement.status === 'PENDING',
    canApprove: isFinancialReviewer
      && input.settlement.status === 'CHECKED_BY_ACCOUNTANT'
      && input.settlement.checkedBy != null
      && input.userId !== input.settlement.checkedBy
      && input.userId !== input.settlement.forwarderId,
    canRequestApprovedGovernance: isFinancialReviewer
      && input.settlement.status === 'APPROVED',
  };
}

export function settlementBalanceSummary(
  totalAdvance: number,
  totalExpense: number,
  refund: number,
) {
  const balance = totalAdvance - totalExpense - refund;
  return {
    balance,
    label: balance === 0
      ? 'Chênh lệch sau quyết toán'
      : balance > 0
        ? 'Còn dư chưa hoàn'
        : 'Thiếu phải bổ sung',
  };
}

// ─── Build table rows grouped by date → container ───
function buildPrintRows(expenses: LinkedExpense[]) {
  const grouped = new Map<string, Map<string, LinkedExpense[]>>();

  for (const exp of expenses) {
    const dateKey = exp.departureDate || 'unknown';
    const containerKey = exp.containerNumber || '-';
    if (!grouped.has(dateKey)) grouped.set(dateKey, new Map());
    const containerMap = grouped.get(dateKey)!;
    if (!containerMap.has(containerKey)) containerMap.set(containerKey, []);
    containerMap.get(containerKey)!.push(exp);
  }

  const rows: Array<{
    date: string;
    container: string;
    customer: string;
    expenseType: string;
    amount: string;
    invoice: string;
    tripCode: string;
  }> = [];

  // Date keys (ISO 'YYYY-MM-DD') sort chronologically as strings; push the
  // 'unknown' bucket last so rows are ordered by transport date ascending (B6).
  const sortedDateKeys = [...grouped.keys()].sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  for (const dateKey of sortedDateKeys) {
    const containerMap = grouped.get(dateKey)!;
    for (const [containerKey, exps] of containerMap) {
      const sorted = [...exps].sort((a, b) => a.expenseType.localeCompare(b.expenseType));
      for (const exp of sorted) {
        rows.push({
          date: dateKey !== 'unknown' ? formatDate(dateKey) : '—',
          container: containerKey !== '-' ? containerKey : '—',
          customer: exp.customerName || '—',
          expenseType: EXPENSE_TYPE_LABELS[exp.expenseType] || exp.expenseType,
          amount: exp.buyAmount,
          invoice: exp.invoiceNumber || '',
          tripCode: exp.tripCode || '',
        });
      }
    }
  }

  return rows;
}

// ─── Component ───
export default function SettlementPrintPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isPortal = user?.role === 'FORWARDER' || user?.role === 'DRIVER';
  
  const fwdQuery = useForwarderSettlementDetail(isPortal ? Number(id) : 0);
  const admQuery = useAdminSettlementDetail(!isPortal ? Number(id) : 0);
  
  const settlement = isPortal ? fwdQuery.data : admQuery.data;
  const isLoading = isPortal ? fwdQuery.isLoading : admQuery.isLoading;
  const error = isPortal ? fwdQuery.error : admQuery.error;
  const { rootRef } = usePageAnimations({ ready: !isLoading });
  const [showPreview, setShowPreview] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<LinkedExpense | null>(null);
  const [editedAmount, setEditedAmount] = useState('');
  const [adjustmentReason, setAdjustmentReason] = useState('');
  const [selectedRequestIds, setSelectedRequestIds] = useState<Set<number>>(new Set());
  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<number>>(new Set());
  const [refundAmount, setRefundAmount] = useState('0');
  const [settlementNote, setSettlementNote] = useState('');
  const [selectionReady, setSelectionReady] = useState(false);
  const [reversalReason, setReversalReason] = useState('');
  const [governanceNotice, setGovernanceNotice] = useState<string | null>(null);
  const updateExpense = useUpdateSettlementExpense();
  const updateSettlement = useUpdateAdvanceSettlement();
  const checkSettlement = useCheckSettlement();
  const approveSettlement = useApproveSettlement();
  const reverseSettlement = useReverseAdvanceSettlement();
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleBack = () => navigate(-1);
  useBackShortcut(handleBack);

  const handlePrint = async () => {
    const endpoint = isPortal 
      ? `/forwarder/me/advance-settlements/${id}/export?format=html`
      : `/finance/advance-settlements/${id}/export?format=html`;
    const html = await api.postForText(endpoint, {});
    setPreviewHtml(html);
    setShowPreview(true);
  };

  const handleIframePrint = () => {
    iframeRef.current?.contentWindow?.print();
  };

  const loadedSettlement = settlement as SettlementData | undefined;
  useEffect(() => {
    if (!loadedSettlement || selectionReady) return;
    setSelectedRequestIds(new Set((loadedSettlement.linkedRequests ?? []).map(request => request.id)));
    setSelectedExpenseIds(new Set((loadedSettlement.linkedExpenses ?? []).map(expense => expense.id)));
    setRefundAmount(String(Number(loadedSettlement.refundAmount || 0)));
    setSettlementNote(loadedSettlement.note ?? '');
    setSelectionReady(true);
  }, [loadedSettlement, selectionReady]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--ink-3)' }}>
        <Loader2 size={20} className="spin" />
        <span style={{ fontSize: 14 }}>Đang tải phiếu thanh toán…</span>
      </div>
    );
  }

  if (error || !settlement) {
    return (
      <div className="fade-up">
        <div className="card" style={{ padding: 24 }}>
          <p style={{ color: 'var(--danger)', fontSize: 14 }}>{error ? String(error) : 'Không tìm thấy phiếu thanh toán'}</p>
          <button className="btn btn--secondary btn--sm" style={{ marginTop: 12 }} onClick={() => navigate('/my-settlements')}>
            Quay lại
          </button>
        </div>
      </div>
    );
  }

  const s = settlement as SettlementData;
  const expenses = s.linkedExpenses || [];
  const requests = s.linkedRequests || [];
  const totalAdvance = requests.reduce((sum, r) => sum + Number(r.amount), 0);
  const totalExpense = expenses.reduce((sum, e) => sum + Number(e.buyAmount), 0);
  const refund = Number(s.refundAmount || 0);
  const { balance, label: balanceLabel } = settlementBalanceSummary(totalAdvance, totalExpense, refund);

  const rows = buildPrintRows(expenses);
  const totalFromRows = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const {
    canEditAndCheck: canEditExpenses,
    canApprove: canApproveChecked,
    canRequestApprovedGovernance,
  } = settlementReviewPermissions({
    isPortal,
    userId: user?.userId,
    role: user?.role,
    settlement: s,
  });

  const requestCandidates = [...requests, ...(s.eligibleAdvanceRequests ?? [])]
    .filter((request, index, items) => items.findIndex(item => item.id === request.id) === index);
  const expenseCandidates = [...expenses, ...(s.eligibleExpenses ?? [])]
    .filter((expense, index, items) => items.findIndex(item => item.id === expense.id) === index);

  const toggleSelection = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) => {
    setter(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCheck = async () => {
    if (selectedRequestIds.size === 0) return;
    const refreshed = await updateSettlement.mutateAsync({
      settlementId: s.id,
      expectedVersion: s.version,
      advanceRequestIds: [...selectedRequestIds],
      tripExpenseIds: [...selectedExpenseIds],
      refundAmount: Number(refundAmount) || 0,
      note: settlementNote.trim() || null,
    });
    await checkSettlement.mutateAsync({
      id: s.id,
      expectedVersion: (refreshed as SettlementData | undefined)?.version ?? s.version + 1,
    });
  };

  const handleApprove = async () => {
    await approveSettlement.mutateAsync({ id: s.id, expectedVersion: s.version });
  };

  const startEditingExpense = (expense: LinkedExpense) => {
    setEditingExpense(expense);
    setEditedAmount(expense.buyAmount);
    setAdjustmentReason(expense.adjustmentReason ?? '');
  };

  const saveExpenseAdjustment = async () => {
    if (!editingExpense || !adjustmentReason.trim() || Number(editedAmount) <= 0) return;
    await updateExpense.mutateAsync({
      settlementId: s.id,
      expenseId: editingExpense.id,
      expectedVersion: s.version,
      buyAmount: Number(editedAmount),
      invoiceNumber: editingExpense.invoiceNumber,
      note: editingExpense.note,
      adjustmentReason: adjustmentReason.trim(),
    });
    setEditingExpense(null);
    if (s.status === 'APPROVED') {
      setGovernanceNotice('Đã gửi điều chỉnh vào hàng chờ kiểm tra. Phiếu và sổ công nợ chưa thay đổi.');
    }
  };

  const requestReversal = async () => {
    const reason = reversalReason.trim();
    if (!reason) return;
    await reverseSettlement.mutateAsync({ id: s.id, expectedVersion: s.version, reason });
    setReversalReason('');
    setGovernanceNotice('Đã gửi yêu cầu hoàn tác vào hàng chờ kiểm tra. Phiếu vẫn giữ trạng thái đã duyệt.');
  };

  return (
    <div ref={rootRef}>
      {/* ── Page Header (hidden in print) ── */}
      <div className="no-print">
        <PageHeader
          title={`Phiếu thanh toán ${s.code}`}
          iconName="settlement"
          description={s.forwarderName || ''}
          action={
            <div className="settlement-detail__header-actions">
              <StatusPill variant={settlementStatusVariant(s.status)}>
                {ADVANCE_SETTLEMENT_STATUS_LABELS[s.status] || s.status}
              </StatusPill>
              <button className="btn btn--secondary btn--sm" onClick={handleBack}>
                <ArrowLeft size={14} /> Trở về
              </button>
              <button className="btn btn--primary btn--sm" onClick={handlePrint}>
                <Printer size={14} /> In
              </button>
              <button
                className="btn btn--secondary btn--sm"
                onClick={() => {
                  api.getBlob(`/forwarder/me/advance-settlements/${s.id}/export`)
                    .then(blob => {
                      const a = document.createElement('a');
                      a.href = URL.createObjectURL(blob);
                      a.download = `phieu-thanh-toan-${s.code}.xlsx`;
                      a.click();
                      URL.revokeObjectURL(a.href);
                    });
                }}
              >
                <FileSpreadsheet size={14} /> Excel
              </button>
            </div>
          }
        />
      </div>

      <div className="settlement-detail">
        {/* ── Info Grid ── */}
        <div className="settlement-detail__section">
          <div className="settlement-detail__info">
            <div className="settlement-detail__info-item">
              <span className="settlement-detail__info-label">Số phiếu</span>
              <span className="settlement-detail__info-value">{s.code}</span>
            </div>
            <div className="settlement-detail__info-item">
              <span className="settlement-detail__info-label">Ngày lập</span>
              <span className="settlement-detail__info-value">{new Date(s.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
            </div>
            <div className="settlement-detail__info-item">
              <span className="settlement-detail__info-label">Nhân viên</span>
              <span className="settlement-detail__info-value">{s.forwarderName || '—'}</span>
            </div>
          </div>
        </div>

        {/* ── Advances ── */}
        {requests.length > 0 && (
          <div className="settlement-detail__section">
            <h2 className="settlement-detail__section-title">Tạm ứng đã nhận</h2>
            <div className="settlement-detail__advances">
              {requests.map(r => (
                <div key={r.id} className="settlement-detail__advance-row">
                  <span className="settlement-detail__advance-amount">{formatCurrency(Number(r.amount))}</span>
                  <span className="settlement-detail__advance-reason">{r.reason}</span>
                  <span className="settlement-detail__advance-date">{new Date(r.createdAt).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}</span>
                </div>
              ))}
              <div className="settlement-detail__advance-total">
                <span>Tổng tạm ứng:</span>
                <strong>{formatCurrency(totalAdvance)}</strong>
              </div>
            </div>
          </div>
        )}

        {canEditExpenses && (
          <div className="settlement-detail__section no-print">
            <h2 className="settlement-detail__section-title">Tạm ứng đưa vào phiếu</h2>
            <p className="settlement-editor-hint">Chỉ các tạm ứng đã duyệt và còn đủ điều kiện mới có thể thêm vào phiếu.</p>
            <div className="settlement-link-list">
              {requestCandidates.map(request => (
                <label key={request.id} className="settlement-link-option">
                  <input type="checkbox" checked={selectedRequestIds.has(request.id)} onChange={() => toggleSelection(setSelectedRequestIds, request.id)} />
                  <span>{request.reason}</span>
                  <strong>{formatCurrency(Number(request.amount))}</strong>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ── Expense Table ── */}
        <div className="settlement-detail__section">
          <h2 className="settlement-detail__section-title">Chi tiết chi phí</h2>
          {editingExpense && (
            <div className="settlement-expense-editor no-print">
              <div>
                <strong>{EXPENSE_TYPE_LABELS[editingExpense.expenseType] || editingExpense.expenseType}</strong>
                <span>Số Ops kê: {formatCurrency(Number(editingExpense.submittedBuyAmount ?? editingExpense.buyAmount))}</span>
              </div>
              <label>
                Số tiền kế toán chốt
                <input className="input" type="number" min="1" value={editedAmount} onChange={event => setEditedAmount(event.target.value)} />
              </label>
              <label>
                Lý do điều chỉnh *
                <input className="input" value={adjustmentReason} onChange={event => setAdjustmentReason(event.target.value)} placeholder="Ví dụ: Điều chỉnh theo hóa đơn thực tế" />
              </label>
              <div className="settlement-expense-editor__actions">
                <button className="btn btn--ghost" onClick={() => setEditingExpense(null)}>Hủy</button>
                <button className="btn btn--primary" disabled={!adjustmentReason.trim() || Number(editedAmount) <= 0 || updateExpense.isPending} onClick={saveExpenseAdjustment}>
                  {updateExpense.isPending ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Lưu điều chỉnh
                </button>
              </div>
            </div>
          )}
          <div className="expense-grid">
            <div className="expense-grid__header">
              <span>Ngày</span>
              <span>Nội dung</span>
              <span>Khách hàng</span>
              <span>Số cont</span>
              <span className="u-right">Thành tiền</span>
              <span>Hóa đơn</span>
            </div>
            {rows.map((row, idx) => (
              <div key={idx} className="expense-grid__row">
                <span className="u-muted">{row.date}</span>
                <span>{row.expenseType}</span>
                <span className="u-wrap">{row.customer}</span>
                <span className="u-mono">{row.container}</span>
                <span className="u-right u-num">{formatCurrency(Number(row.amount))}</span>
                <span>{row.invoice}</span>
              </div>
            ))}
            <div className="expense-grid__total">
              <span className="u-bold" style={{ gridColumn: '1 / 5' }}>Tổng cộng</span>
              <span className="u-right u-num u-bold">{formatCurrency(totalFromRows)}</span>
              <span></span>
            </div>
          </div>
          {canRequestApprovedGovernance && (
            <div className="settlement-expense-actions no-print">
              <p className="settlement-editor-hint">
                Điều chỉnh và hoàn tác chỉ có hiệu lực sau khi đủ người lập, người kiểm tra và người phê duyệt.
              </p>
              {expenses.map(expense => (
                <button
                  key={expense.id}
                  className="btn btn--secondary btn--sm"
                  onClick={() => startEditingExpense(expense)}
                >
                  <Pencil size={14} /> Lập điều chỉnh {expense.tripCode || 'chuyến chưa có mã'}
                </button>
              ))}
              <label>
                Lý do hoàn tác
                <input
                  className="input"
                  value={reversalReason}
                  onChange={event => setReversalReason(event.target.value)}
                  placeholder="Nhập lý do hoàn tác phiếu đã duyệt"
                />
              </label>
              <button
                className="btn btn--danger btn--sm"
                disabled={!reversalReason.trim() || reverseSettlement.isPending}
                onClick={requestReversal}
              >
                {reverseSettlement.isPending ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                Gửi yêu cầu hoàn tác
              </button>
              {governanceNotice && <p role="status">{governanceNotice}</p>}
              {reverseSettlement.error && <p className="settlement-finalize__error">{String(reverseSettlement.error)}</p>}
            </div>
          )}
          {canEditExpenses && (
            <div className="settlement-expense-actions no-print">
              {expenseCandidates.map(expense => (
                <div key={expense.id} className="settlement-expense-option">
                  <label>
                    <input type="checkbox" checked={selectedExpenseIds.has(expense.id)} onChange={() => toggleSelection(setSelectedExpenseIds, expense.id)} />
                    <span>
                      <strong>{expense.tripCode || 'Chuyến chưa có mã'} · {expense.containerNumber || 'Chi phí chung'}</strong>
                      <small>{EXPENSE_TYPE_LABELS[expense.expenseType] || expense.expenseType} · {formatCurrency(Number(expense.buyAmount))}</small>
                    </span>
                  </label>
                  {expenses.some(item => item.id === expense.id) && (
                    <button className="btn btn--secondary btn--sm" onClick={() => startEditingExpense(expense)}>
                      <Pencil size={14} /> Sửa số tiền
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Summary ── */}
        <div className="settlement-detail__summary">
          <div className="settlement-detail__summary-card">
            <div className="settlement-detail__summary-label">Tổng tạm ứng</div>
            <div className="settlement-detail__summary-value">{formatCurrency(totalAdvance)}</div>
          </div>
          <div className="settlement-detail__summary-card">
            <div className="settlement-detail__summary-label">Tổng chi phí</div>
            <div className="settlement-detail__summary-value">{formatCurrency(totalExpense)}</div>
          </div>
          {refund > 0 ? (
            <div className="settlement-detail__summary-card settlement-detail__summary-card--refund">
              <div className="settlement-detail__summary-label">Tiền đã hoàn lại</div>
              <div className="settlement-detail__summary-value settlement-detail__summary-value--positive">{formatCurrency(refund)}</div>
            </div>
          ) : null}
          <div className="settlement-detail__summary-card settlement-detail__summary-card--balance">
            <div className="settlement-detail__summary-label">{balanceLabel}</div>
            <div className={`settlement-detail__summary-value ${balance >= 0 ? 'settlement-detail__summary-value--positive' : 'settlement-detail__summary-value--negative'}`}>
              {formatCurrency(Math.abs(balance))}
            </div>
          </div>
        </div>

        {/* ── Note ── */}
        {s.note && (
          <div className="settlement-detail__note">
            <strong>Ghi chú:</strong> {s.note}
          </div>
        )}

        {(canEditExpenses || s.status === 'CHECKED_BY_ACCOUNTANT') && (
          <div className="settlement-finalize no-print">
            {canEditExpenses ? (
              <div className="settlement-finalize__fields">
                <label>Tiền hoàn lại
                  <input className="input" type="number" min="0" value={refundAmount} onChange={event => setRefundAmount(event.target.value)} />
                </label>
                <label>Ghi chú
                  <textarea className="input" rows={2} value={settlementNote} onChange={event => setSettlementNote(event.target.value)} />
                </label>
              </div>
            ) : (
              <p className="settlement-editor-hint">
                Kế toán {s.checkerName || 'đã phân công'} đã kiểm tra phiếu.
                {canApproveChecked
                  ? ' Vui lòng đối chiếu lần cuối trước khi phê duyệt.'
                  : ' Phiếu đang chờ một người khác phê duyệt.'}
              </p>
            )}
            {(updateSettlement.error || checkSettlement.error || approveSettlement.error) && (
              <p className="settlement-finalize__error">
                {String(updateSettlement.error || checkSettlement.error || approveSettlement.error)}
              </p>
            )}
            {canEditExpenses && (
              <button
                className="btn btn--primary"
                disabled={selectedRequestIds.size === 0 || updateSettlement.isPending || checkSettlement.isPending}
                onClick={handleCheck}
              >
                {updateSettlement.isPending || checkSettlement.isPending ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                Lưu và chuyển phê duyệt
              </button>
            )}
            {canApproveChecked && (
              <button
                className="btn btn--primary"
                disabled={approveSettlement.isPending}
                onClick={handleApprove}
              >
                {approveSettlement.isPending ? <Loader2 size={16} className="spin" /> : <CheckCircle2 size={16} />}
                Phê duyệt phiếu
              </button>
            )}
          </div>
        )}

        {/* ── Signatures (print only) ── */}
        <div className="settlement-detail__signatures">
          <div className="settlement-detail__sig-block">
            <div className="settlement-detail__sig-label">Người lập</div>
            <div className="settlement-detail__sig-line">(Ký, họ tên)</div>
          </div>
          <div className="settlement-detail__sig-block">
            <div className="settlement-detail__sig-label">Kế toán</div>
            <div className="settlement-detail__sig-line">(Ký, họ tên)</div>
          </div>
          <div className="settlement-detail__sig-block">
            <div className="settlement-detail__sig-label">Quản lý</div>
            <div className="settlement-detail__sig-line">(Ký, họ tên)</div>
          </div>
        </div>
      </div>

      {/* ── Print Preview Modal ── */}
      {showPreview && previewHtml && (
        <div className="print-preview-overlay">
          <div className="print-preview-toolbar">
            <span className="print-preview-title">Phiếu thanh toán {s.code}</span>
            <div className="print-preview-actions">
              <button className="btn btn--primary btn--sm" onClick={handleIframePrint}>
                <Printer size={14} /> In / Lưu PDF
              </button>
              <button className="btn btn--secondary btn--sm" onClick={() => setShowPreview(false)}>
                <X size={14} /> Đóng
              </button>
            </div>
          </div>
          <div className="print-preview-body">
            <iframe
              ref={iframeRef}
              className="print-preview-iframe"
              title={`Phiếu thanh toán ${s.code}`}
              srcDoc={previewHtml}
            />
          </div>
        </div>
      )}
    </div>
  );
}
