import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/UI';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { AccountingOverview } from './AccountingOverview';
import { AccountingTransportRegister } from './AccountingTransportRegister';
import { AccountingWorkInbox } from './AccountingWorkInbox';
import { buildTransportSelectionScopeKey, displayBusinessDate } from './accountingWorkspaceUtils';
import { useAccountingWorkspaceQueries } from './useAccountingWorkspaceQueries';
import { useAccountingWorkspaceUrlState } from './useAccountingWorkspaceUrlState';

export function AccountingWorkspaceRoot() {
  const {
    state,
    setFrom,
    setTo,
    viewHref,
    setTransportSearch,
    setTransportFilter,
    applyTransportSearch,
    setTransportPage,
    resetTransportSearch,
  } = useAccountingWorkspaceUrlState();
  const queries = useAccountingWorkspaceQueries(state);

  return (
    <main className="accounting-page" data-testid="accounting-workspace">
      <PageHeader
        title={state.activeView === 'work' ? 'Công việc kế toán' : 'Tổng Quan'}
        description={state.activeView === 'work'
          ? 'Xử lý hồ sơ đã đủ điều kiện và nhìn rõ nguyên nhân đang chặn trước khi đối soát.'
          : 'Đối chiếu vận tải, công nợ, thanh toán và báo cáo trên cùng một kỳ dữ liệu.'}
      />

      {state.activeView !== 'work' && <section className="accounting-period" aria-labelledby="accounting-period-title">
        <div>
          <span className="accounting-eyebrow" id="accounting-period-title">
            Kỳ làm việc
          </span>
          <strong>
            {displayBusinessDate(state.from)} — {displayBusinessDate(state.to)}
          </strong>
        </div>
        <div className="accounting-period__fields">
          <BufferedUuiDateInput
            label="Từ ngày"
            size="sm"
            value={state.from}
            max={state.to || undefined}
            onChange={setFrom}
          />
          <BufferedUuiDateInput
            label="Đến ngày"
            size="sm"
            value={state.to}
            min={state.from || undefined}
            max={state.today}
            onChange={setTo}
          />
        </div>
      </section>}

      <nav className="accounting-tabs" aria-label="Không gian kế toán">
        <Link
          to={viewHref('work')}
          aria-current={state.activeView === 'work' ? 'page' : undefined}
        >
          Công việc
        </Link>
        <Link
          to={viewHref('overview')}
          aria-current={state.activeView === 'overview' ? 'page' : undefined}
        >
          Tổng quan
        </Link>
        <Link
          to={viewHref('transport')}
          aria-current={state.activeView === 'transport' ? 'page' : undefined}
        >
          Đối chiếu vận tải
        </Link>
      </nav>

      {state.activeView === 'overview' && queries.hasOverviewError && (
        <div className="accounting-alert" role="alert">
          Một phần số liệu chưa tải được. Các đường dẫn nghiệp vụ vẫn hoạt động để
          bạn tiếp tục xử lý.
        </div>
      )}

      {state.activeView === 'work' ? (
        <AccountingWorkInbox transportViewHref={viewHref('transport')} />
      ) : state.activeView === 'overview' ? (
        <AccountingOverview
          to={state.to}
          transportViewHref={viewHref('transport')}
          receivables={queries.receivables}
          payables={queries.payables}
          profitability={queries.profitability}
        />
      ) : (
        <AccountingTransportRegister
          rows={queries.transportRegister.data?.items ?? []}
          total={queries.transportRegister.data?.total ?? 0}
          totalPages={queries.transportRegister.data?.totalPages ?? 0}
          fingerprint={queries.transportRegister.data?.filterFingerprint}
          page={state.transportPage}
          search={state.transportSearch}
          customerId={state.customerId ? String(state.customerId) : ''}
          carrierId={state.carrierId ? String(state.carrierId) : ''}
          customers={(queries.transportParties.data ?? []).filter((party) => !party.isCarrier)}
          carriers={(queries.transportParties.data ?? []).filter((party) => party.isCarrier)}
          ownership={state.ownership ?? ''}
          readiness={state.readiness ?? ''}
          selectionScopeKey={buildTransportSelectionScopeKey(state)}
          loading={queries.transportRegister.isLoading}
          error={queries.transportRegister.isError}
          onSearchChange={setTransportSearch}
          onFilterChange={setTransportFilter}
          onSearch={applyTransportSearch}
          onPageChange={setTransportPage}
          onRetry={() => queries.transportRegister.refetch()}
          onReset={resetTransportSearch}
        />
      )}
    </main>
  );
}
