import { useState } from 'react';
import { Btn } from '../components/UI';
import { Plus } from 'lucide-react';
import { SummaryRail } from '../design-system';
import { useOpsWalletSummary, useOpsAdvanceRequests } from '../hooks/useOpsQueries';
import { OpsAdvanceRequestModal } from '../features/ops/OpsAdvanceRequestModal';
import { ExpenseReconciliationHistory } from '../features/expense-accounting/ExpenseReconciliationHistory';
import { OpsExpenseHistory } from '../features/ops/OpsExpenseHistory';
import { OpsSettlementsPanel } from '../features/ops/OpsSettlementsPanel';
import { OpsFundBookSection } from '../features/ops/OpsFundBookSection';
import { formatVnd } from '../features/ops/opsStatus';
import './OpsWalletPage.css';
import { OpsQueryFeedback } from '../features/ops/OpsQueryFeedback';
import { AdvanceDraftActions } from '../components/shared/AdvanceDraftActions';
import { formatDate } from '../lib/format';

const ADVANCE_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'var(--ink-muted)', RECORDED: 'var(--success-text)', VOIDED: 'var(--err, #dc2626)',
  PENDING: 'var(--warn, #d97706)',
  APPROVED: 'var(--success-text)',
  REJECTED: 'var(--err, #dc2626)',
};

// Green means "money received". A recorded request with no cash delivered
// yet is still an outstanding payment (card 20260922_27) — amber, not the
// success token.
function advanceStatusColor(row: { status: string; fundedAmount?: number | null }): string {
  if (['RECORDED', 'APPROVED'].includes(row.status) && Number(row.fundedAmount ?? 0) <= 0) {
    return 'var(--warn, #d97706)';
  }
  return ADVANCE_STATUS_COLORS[row.status] ?? 'inherit';
}

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
        <h1>Quỹ tạm ứng</h1>
        <Btn variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setAdvanceOpen(true)}>Xin Tạm Ứng</Btn>
      </header>

      <OpsQueryFeedback loading={summaryQuery.isLoading} error={summaryQuery.isError} label="số dư" onRetry={summaryQuery.refetch} />
      {/* Card 20260930_218 — three bespoke balance cards, each carrying a
          caption of its own, became the shared ruled summary rail: labels
          left, values right, no card chrome. The two captions that only
          restated their own label are gone (law §8 — no lecturing copy); the
          "đã ứng" figure is real data and rides the rail as its own item. */}
      <SummaryRail
        ariaLabel="Số dư"
        items={[
          { label: 'Số dư hiện tại', value: summary ? `${formatVnd(summary.balance)} ₫` : '…' },
          { label: 'Đã ứng', value: summary ? `${formatVnd(summary.totalAdvance)} ₫` : '…' },
          { label: 'Đã trả lại', value: summary ? `${formatVnd(summary.returned ?? '0')} ₫` : '…' },
          { label: 'Chi phí đã ghi nhận', value: summary ? `${formatVnd(summary.approved)} ₫` : '…' },
        ]}
      />
      {/* Honest debt: a negative balance is a fact, not an error state. */}
      {summary && Number(summary.balance) < 0 && (
        <p className="ops-wallet__negative" role="status">
          Khoản chi vượt số tiền đang có — đối chiếu tạm ứng, chi phí và tiền hoàn lại.
        </p>
      )}

      <OpsFundBookSection />

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
                    <td data-label="Ngày">{formatDate(row.createdAt)}</td>
                    <td className="ops-money" data-label="Số tiền">{formatVnd(row.amount)} ₫</td>
                    <td className="ops-wallet__wide" data-label="Lý do">{row.reason}</td>
                    <td className="ops-wallet__advance-status" data-label="Trạng thái">
                      <span style={{ color: advanceStatusColor(row), fontWeight: 600, fontSize: 'var(--text-body-size)' }}>
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
