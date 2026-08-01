import { Link } from 'react-router-dom';
import { PageHeader } from '../../components/UI';
import { AccountingOverview } from './AccountingOverview';
import { AccountingTransportRegister } from './AccountingTransportRegister';
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
        title="Tổng Quan"
        description="Đối chiếu vận tải, công nợ, thanh toán và báo cáo trên cùng một kỳ dữ liệu."
      />

      <section className="accounting-period" aria-labelledby="accounting-period-title">
        <div>
          <span className="accounting-eyebrow" id="accounting-period-title">
            Kỳ làm việc
          </span>
          <strong>
            {displayBusinessDate(state.from)} — {displayBusinessDate(state.to)}
          </strong>
        </div>
        <div className="accounting-period__fields">
          <label>
            <span>Từ ngày</span>
            <input
              type="date"
              value={state.from}
              max={state.to}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            <span>Đến ngày</span>
            <input
              type="date"
              value={state.to}
              min={state.from}
              max={state.today}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
      </section>

      <nav className="accounting-tabs" aria-label="Không gian kế toán">
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

      {state.activeView === 'overview' ? (
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
