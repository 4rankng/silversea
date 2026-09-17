import { useState } from 'react';
import { Btn } from '../components/UI';
import { Plus, Wallet } from 'lucide-react';
import { useOpsWalletSummary, useOpsAdvanceRequests } from '../hooks/useOpsQueries';
import { OpsAdvanceRequestModal } from '../features/ops/OpsAdvanceRequestModal';
import { ExpenseReconciliationHistory } from '../features/expense-accounting/ExpenseReconciliationHistory';
import { OpsExpenseHistory } from '../features/ops/OpsExpenseHistory';
import { OpsSettlementsPanel } from '../features/ops/OpsSettlementsPanel';
import { formatVnd } from '../features/ops/opsStatus';
import './OpsWalletPage.css';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { AdvanceDraftActions } from '../components/shared/AdvanceDraftActions';

const ADVANCE_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'var(--ink-muted)', RECORDED: 'var(--ok, #16a34a)', VOIDED: 'var(--err, #dc2626)',
  PENDING: 'var(--warn, #d97706)',
  APPROVED: 'var(--ok, #16a34a)',
  REJECTED: 'var(--err, #dc2626)',
};

// Requests are recorded directly; cash receipt is shown independently of status.
const ADVANCE_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Chưa ghi sổ', RECORDED: 'Đã ghi nhận', VOIDED: 'Đã hủy',
  PENDING: 'Đang ghi nhận',
  APPROVED: 'Đã ghi nhận',
  REJECTED: 'Từ chối',
};

/**
 * Quỹ tạm ứng cá nhân (OpsVanHanh §5): 4 thẻ real-time, xin tạm ứng, lịch sử
 * chi phí với nhắc nợ chứng từ, và đề nghị thanh toán theo lô.
 */
export default function OpsWalletPage() {
  const summaryQuery = useOpsWalletSummary();
  const { data: summary } = summaryQuery;
  const advancesQuery = useOpsAdvanceRequests();
  const { data: advanceData, isLoading: advanceLoading } = advancesQuery;
  const [advanceOpen, setAdvanceOpen] = useState(false);

  const advanceItems = advanceData?.items ?? [];

  return (
    <div className="ops-wallet page-shell">
      <header className="ops-wallet__bar">
        <h1><Wallet size={20} aria-hidden /> Quỹ tạm ứng</h1>
        <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setAdvanceOpen(true)}>Xin Tạm Ứng</Btn>
      </header>

      <OpsQueryFeedback loading={summaryQuery.isLoading} error={summaryQuery.isError} label="số dư" onRetry={summaryQuery.refetch} />
      <section className="ops-wallet__cards" aria-label="Số dư">
        <div className="ops-wallet-card ops-wallet-card--balance">
          <span className="ops-wallet-card__label">SỐ DƯ HIỆN TẠI</span>
          <strong>{summary ? `${formatVnd(summary.balance)} ₫` : '…'}</strong>
          {/* Honest debt: a negative balance is a fact, not an error state. */}
          {summary && Number(summary.balance) < 0 && (
            <small>Khoản chi vượt số tiền đang có; đối chiếu tạm ứng, chi phí và tiền hoàn lại.</small>
          )}
          <small>Đã ứng {summary ? formatVnd(summary.totalAdvance) : '…'} ₫</small>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Đã trả lại</span>
          <strong>{summary ? `${formatVnd(summary.returned ?? '0')} ₫` : '…'}</strong>
          <small>Tiền đã hoàn về công ty theo quyết toán</small>
        </div>
        <div className="ops-wallet-card">
          <span className="ops-wallet-card__label">Chi phí đã ghi nhận</span>
          <strong style={{ color: 'var(--ok, #16a34a)' }}>{summary ? `${formatVnd(summary.approved)} ₫` : '…'}</strong>
        </div>
      </section>

      {/* KP-125: compact status on every advance request row */}
      {(advanceItems.length > 0 || advanceLoading || advancesQuery.isError) && (
        <section className="ops-wallet__section" aria-label="Yêu cầu tạm ứng">
          <header className="ops-wallet__section-head">
            <h2>Yêu cầu tạm ứng</h2>
          </header>
          <div className="ops-wallet__scroll">
            <table className="tt-table ops-wallet__table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Số tiền</th>
                  <th>Lý do</th>
                  <th>Trạng thái</th>
                </tr>
              </thead>
              <tbody>
                {advanceItems.map((row) => (
                  <tr key={row.id} className={`ops-wallet__row ops-wallet__row--advance${row.status === 'DRAFT' ? ' ops-wallet__row--draft' : ''}`}>
                    <td data-label="Ngày">{new Date(row.createdAt).toLocaleDateString('vi-VN')}</td>
                    <td className="ops-money" data-label="Số tiền">{formatVnd(row.amount)} ₫</td>
                    <td className="ops-wallet__wide" data-label="Lý do">{row.reason}</td>
                    <td className="ops-wallet__advance-status" data-label="Trạng thái">
                      <span style={{ color: ADVANCE_STATUS_COLORS[row.status] ?? 'inherit', fontWeight: 600, fontSize: 'var(--text-body-size)' }}>
                        {['RECORDED', 'APPROVED'].includes(row.status) ? Number(row.fundedAmount ?? 0) > 0 ? `Đã nhận ${formatVnd(row.fundedAmount!)} ₫` : 'Chưa giao tiền' : ADVANCE_STATUS_LABELS[row.status] ?? row.status}
                      </span>
                      <AdvanceDraftActions request={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <OpsQueryFeedback loading={advanceLoading} error={advancesQuery.isError} label="yêu cầu tạm ứng" onRetry={advancesQuery.refetch} />
          </div>
        </section>
      )}

      <OpsExpenseHistory />
      <ExpenseReconciliationHistory />
      <OpsSettlementsPanel />

      {advanceOpen && <OpsAdvanceRequestModal onClose={() => setAdvanceOpen(false)} />}
    </div>
  );
}
