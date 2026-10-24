import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus, Loader2, MoreHorizontal, Pencil, Trash2, Download } from 'lucide-react';
import { PageHeader, useConfirm, Modal } from '../../components/UI';
import { configClient } from '../../api/configClient';
import { tripClient } from '../../api/tripClient';
import { financialClient, type CustomerAging } from '../../api/financialClient';
import { useCustomerLedgerEntries } from '../../hooks/useQueries';
import { qk } from '../../api/keys';
import { downloadCSV } from '../../lib/csv';
import { useCRUD } from '../../hooks/useCRUD';
import { useDropdownDismiss } from '../../hooks/useDropdownDismiss';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import { titleCaseVn, shortNameChipLabel } from '../../lib/format';
import { Money } from '../../components/shared/Money';
import type { Customer } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import { CustomerForm } from './CustomerForm';
import { CustomerMetricsRow } from '../../features/customers/CustomerHeaderMetrics';
import { EmptyState, FilterBar, Tabs } from '../../design-system';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import './customer-config-density.css';
// SIL-169: the shared customers-surface contract (metric row, chips, dots,
// kebab menu, 7-column table cells). Page-scoped rules in that sheet key off
// .customers-page and stay inert here.
import '../CustomersPage.css';

/** SIL-169 mirrors the aging risk rule so the catalog's risk tab, dot and
 * metric agree with the accounting screens (same source: aging.service.ts). */
type RiskLevel = 'high' | 'med' | 'low';
function classifyAgingRisk(totalOutstanding: number, aging: { over90: number; d30: number; d60: number }): RiskLevel {
  if (totalOutstanding <= 0) return 'low';
  if (aging.over90 > 0 || totalOutstanding > 100_000_000) return 'high';
  if (aging.d30 > 0 || aging.d60 > 0) return 'med';
  return 'low';
}

/** SIL-169 metric ② — same idle definition as the /customers page. */
function idleCustomerCount(entries: { entityType: string; entityId: number; timestamp: string }[] | undefined): { count: number; since: string | null } | null {
  if (!entries) return null;
  const lastByCustomer = new Map<number, string>();
  for (const entry of entries) {
    if (entry.entityType !== 'CUSTOMER') continue;
    const prev = lastByCustomer.get(entry.entityId);
    if (!prev || entry.timestamp > prev) lastByCustomer.set(entry.entityId, entry.timestamp);
  }
  const cutoff = Date.now() - 30 * 86_400_000;
  let count = 0;
  let oldestSince: string | null = null;
  for (const ts of lastByCustomer.values()) {
    const t = Date.parse(ts);
    if (Number.isNaN(t) || t >= cutoff) continue;
    count += 1;
    if (!oldestSince || ts < oldestSince) oldestSince = ts;
  }
  return { count, since: oldestSince };
}

export default function CustomersConfigPage() {
  const { user } = useAuth();
  const canReadTripStats = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'DISPATCHER'].includes(user?.role ?? '');
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [customerFilter, setCustomerFilter] = useState<'all' | 'high-risk' | 'active' | 'locked'>('all');
  const [search, setSearch] = useState('');
  const searchQuery = search.trim().replace(/\s+/g, ' ');
  // Client-side column sort — the catalog is a full in-memory array (and the
  // month trip/revenue columns are derived client-side), so there is no
  // server sort to call; null keeps the fetch order.
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));

  const { data, refetch, isPending, isFetching, isError } = useQuery({
    queryKey: qk.tripForm.customersConfig(searchQuery),
    queryFn: () => configClient.getAllCustomers(searchQuery || undefined),
    staleTime: 2 * 60 * 1000,
    placeholderData: keepPreviousData,
  });

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const tripStats = useQuery({
    queryKey: qk.trips.customerCatalogStats(user?.userId, user?.role, thisMonth),
    queryFn: () => tripClient.fetchAllTrips({
      dateFrom: `${thisMonth}-01`,
      dateTo: `${thisMonth}-${new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()}`,
    }),
    enabled: canReadTripStats,
    staleTime: 2 * 60 * 1000,
  });
  const customers = useMemo(() => data ?? [], [data]);
  const exportStatsUnavailable = canReadTripStats && (tripStats.isFetching || tripStats.isError || !tripStats.data);
  // SIL-169 — the three inline header metrics: debt/overdue/risk from the
  // EXISTING receivables-aging projection, idle-30 from the ledger feed. The
  // aging endpoint serves ADMIN/MANAGER/ACCOUNTANT; this catalog page also
  // hosts CUS/DISPATCHER editors, for whom the projection is unavailable and
  // the metrics read '—' — never an invented number (no new endpoint).
  const AGING_SNAPSHOT_LIMIT = 200;
  const { data: agingSnapshot } = useQuery({
    queryKey: qk.financial.customerAging({ limit: AGING_SNAPSHOT_LIMIT }),
    queryFn: () => financialClient.getCustomerAging({ limit: AGING_SNAPSHOT_LIMIT }),
    staleTime: 2 * 60 * 1000,
    retry: false,
  });
  const agingByCustomer = useMemo(
    () => new Map((agingSnapshot?.customers ?? []).map((row: CustomerAging) => [row.customerId, row])),
    [agingSnapshot],
  );
  const agingTotals = agingSnapshot?.totals;
  const overdueAmount = agingTotals ? agingTotals.d30 + agingTotals.d60 + agingTotals.over90 : null;
  const { data: ledgerEntries } = useCustomerLedgerEntries();
  const idle30 = useMemo(() => idleCustomerCount(ledgerEntries), [ledgerEntries]);
  /** Risk dot + risk tab share one definition with the aging projection. */
  const riskOf = (c: Customer): RiskLevel => {
    const row = agingByCustomer.get(c.id);
    if (row) return classifyAgingRisk(row.totalOutstanding, row.aging);
    // No projection (or a role it does not serve): a locked account is still
    // a standing risk the catalog itself knows about.
    if (c.status === CustomerStatus.LOCKED) return 'high';
    return 'low';
  };
  const customerTripStats = useMemo(() => {
    const statsMap = new Map<number, { trips: number; revenue: number }>();
    if (!canReadTripStats) return statsMap;
    for (const trip of tripStats.data?.items ?? []) {
      if (!trip.customerId || !trip.departureDate?.startsWith(thisMonth)) continue;
      const stats = statsMap.get(trip.customerId) ?? { trips: 0, revenue: 0 };
      stats.trips++;
      stats.revenue += parseFloat(trip.revenue || '0');
      statsMap.set(trip.customerId, stats);
    }
    return statsMap;
  }, [canReadTripStats, tripStats.data, thisMonth]);

  const crud = useCRUD('/customers', async () => { await refetch(); });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const monthLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
  const totalCount = customers.length;
  const activeCount = customers.filter(c => c.status === CustomerStatus.ACTIVE).length;
  const lockedCount = customers.filter(c => c.status === CustomerStatus.LOCKED).length;

  const allRevenues = customers.map(c => customerTripStats.get(c.id)?.revenue || 0).sort((a, b) => b - a);
  const totalRevenue = allRevenues.reduce((s, v) => s + v, 0);
  const top4Revenue = allRevenues.slice(0, 4).reduce((s, v) => s + v, 0);
  const top4Pct = totalRevenue > 0 ? Math.round((top4Revenue / totalRevenue) * 100) : null;

  const filtered = useMemo(() => {
    const byStatus = customers.filter(c => {
      if (customerFilter === 'active') return c.status === CustomerStatus.ACTIVE;
      if (customerFilter === 'locked') return c.status === CustomerStatus.LOCKED;
      // SIL-169: one risk definition with the aging projection (was a stub
      // with debt = 0 that could only ever fire for locked accounts).
      if (customerFilter === 'high-risk') return riskOf(c) === 'high';
      return true;
    });
    // The API searches full/short name, tax code, phone and contact person.
    // Filtering again by only name/MST would discard valid API matches.
    return sortClientSide(byStatus, sort, {
      name: c => c.name,
      shortName: c => c.shortName,
      code: c => c.code,
      taxCode: c => c.taxCode,
      address: c => c.address,
      contactPerson: c => c.contactPerson,
      phone: c => c.phone,
      accountantName: c => c.accountantName,
      accountantPhone: c => c.accountantPhone,
      contactInfo: c => c.contactInfo,
      agencyFeePaymentTermDays: c => c.agencyFeePaymentTermDays,
      paymentTermDays: c => c.paymentTermDays,
      contact: c => c.contactPerson || c.phone || c.contactInfo || null,
      monthTrips: c => customerTripStats.get(c.id)?.trips ?? null,
      monthRevenue: c => customerTripStats.get(c.id)?.revenue ?? null,
      creditLimit: c => {
        const limit = parseFloat(c.creditLimit || '0');
        return limit > 0 ? limit : null;
      },
      status: c => c.status,
    }, (a, b) => b.id - a.id);
  }, [customers, customerFilter, sort, customerTripStats, agingByCustomer]);

  /** Card _37 export — unchanged sheet contract; SIS-ROLE gating stays: the
   * button waits for the month stats this sheet promises its reader. */
  async function exportCatalog() {
    const headers = ['Khách hàng', 'MST', 'Liên hệ', 'Chuyến ' + monthLabel, 'Doanh thu ' + monthLabel, 'Hạn mức TD', 'Trạng thái'];
    const rows = filtered.map(c => {
      const stats = customerTripStats.get(c.id);
      const creditLimit = parseFloat(c.creditLimit || '0');
      return [
        c.name,
        c.taxCode || '',
        c.contactInfo || c.phone || '',
        stats?.trips ?? '',
        stats?.revenue ?? '',
        creditLimit > 0 ? creditLimit : '',
        c.status === CustomerStatus.LOCKED ? 'Tạm khoá' : 'Hoạt động',
      ];
    });
    await downloadCSV(`khach-hang-${monthLabel.replace(/\s/g, '-')}.xlsx`, headers, rows, {
      title: 'DANH SÁCH KHÁCH HÀNG',
      subtitle: `Tháng ${monthLabel} · ${filtered.length} khách hàng`,
      columnTypes: ['text', 'text', 'text', 'number', 'currency', 'currency', 'text'],
      totalsColumns: [3, 4],
      totalsLabel: 'TỔNG CỘNG',
    });
  }

  return (
    <div ref={pageRef} className="cfg-page cfg-page--customers">
      {/* SIL-169: the four KPI cards are gone; the same three inline metrics
          as /customers ride beside the H1 (aging + ledger feeds — '—' for the
          roles the aging endpoint does not serve). */}
      <PageHeader
        title="Khách hàng & Đối tác"
        onBack={handleBack}
        action={(
          <CustomerMetricsRow
            data={{
              overdueAmount,
              overdueCount: agingTotals?.overdueCount ?? null,
              idleCount: idle30?.count ?? null,
              idleSince: idle30?.since ?? null,
              riskCount: agingTotals?.highRiskCount ?? null,
            }}
          />
        )}
      />

      <div className="table-wrap">
        {/* Shared filter-bar contract (card 20260922_38) + SIL-169: the
            boxed tab segment with whole-set counts, the export and the add
            button on ONE row. "Tạm khoá" hides while it counts zero rows. */}
        <FilterBar
          search={{ value: search, onChange: setSearch, placeholder: 'Tên, MST, điện thoại…', ariaLabel: 'Tìm khách hàng theo tên, tên ngắn, mã số thuế, điện thoại hoặc người liên hệ' }}
          quickFiltersLabel="Lọc khách hàng"
          quickFilters={(
            <Tabs
              variant="boxed"
              tabs={[
                { id: 'all', label: 'Tất cả', count: data ? totalCount : undefined },
                { id: 'high-risk', label: 'Rủi ro cao', count: agingTotals?.highRiskCount, countTone: (agingTotals?.highRiskCount ?? 0) > 0 ? 'warning' : undefined },
                { id: 'active', label: 'Hoạt động', count: data ? activeCount : undefined },
                ...(lockedCount > 0 ? [{ id: 'locked' as const, label: 'Tạm khoá', count: lockedCount }] : []),
              ]}
              value={customerFilter}
              onChange={(id) => setCustomerFilter(id as typeof customerFilter)}
              ariaLabel="Lọc theo trạng thái khách hàng"
            />
          )}
          actions={(
            <>
              <button type="button" className="btn btn--secondary btn--sm" disabled={isFetching || isError || exportStatsUnavailable}
                title={exportStatsUnavailable ? 'Tải xong doanh thu để xuất đầy đủ dữ liệu' : undefined} onClick={() => void exportCatalog()}>
                <Download size={14} aria-hidden="true" />
                Xuất Excel
              </button>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => { crud.setError(null); crud.setShowAddForm(true); }}>
                <Plus size={14} /> Thêm khách hàng
              </button>
            </>
          )}
        />
        <div className="cfg-customer-fetch-status" role="status" aria-live="polite">
          {isFetching ? (isPending ? 'Đang tải khách hàng…' : 'Đang cập nhật kết quả…') : isError ? <>
            Không thể tải khách hàng. <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void refetch(); }}>Thử lại</button>
          </> : null}
          {' · '}
          {/* SIS-ROLE-01/02 contracts (unchanged states, new home): the month
              stats line keeps its exact strings (own span each, so assistive
              text stays queryable), the retry refetches ONLY the stats, and
              the export keeps waiting on them. */}
          {!canReadTripStats ? <span>Tài khoản không xem doanh thu</span>
            : tripStats.isError ? <span>Không thể tải doanh thu.</span>
              : tripStats.isPending ? <span>Đang tải doanh thu…</span>
                : top4Pct == null ? <span>Chưa có doanh thu tháng này</span>
                  : <span>Top 4 KH chiếm {top4Pct}% doanh thu {monthLabel}{top4Pct > 60 ? ' — rủi ro tập trung cao' : ''}</span>}
          {canReadTripStats && tripStats.isError && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void tripStats.refetch(); }}>Thử lại</button>
          )}
        </div>
        <div className="table-scroll" aria-busy={isFetching}>
          {/* SIL-169 visual-gate re-dispatch: --scroll adoption — the fixed
              978px budget scrolls on 640–1023 canvases; the ≥640 real-table
              geometry comes from CustomersPage.css (.cus-table key). */}
          <div className="record-table-wrap record-table-wrap--scroll">
          <table className="record-table ops-table cfg-customer-table cus-table" style={{ tableLayout: 'fixed' }}>
              {/* SIL-169 verdict (b): the same 7-column budget as /customers —
                  the two-tier group header and the presence-driven column set
                  are retired with it. Client-side sort stays on the business
                  keys the catalog owns (name, taxCode). */}
              <colgroup>
                <col style={{ width: 260 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 120 }} />
                <col className="cus-col-action" />
              </colgroup>
              <thead>
                <tr>
                  <SortHeader label="Khách hàng" sortKey="name" sort={sort} onSortChange={handleSort} />
                  <SortHeader label="MST" sortKey="taxCode" sort={sort} onSortChange={handleSort} />
                  <th>Địa chỉ</th>
                  <th>Liên hệ</th>
                  <th>Hạn thanh toán</th>
                  <th className="cus-th-debt">Công nợ</th>
                  <th><span className="sr-only">Thao tác</span></th>
                </tr>
              </thead>
            <tbody>
              {!isFetching && !isError && filtered.length === 0 && <tr className="cfg-empty-row"><td colSpan={7} data-label="">
                <EmptyState variant="compact" illustration="fleet" title={search || customerFilter !== 'all' ? 'Không có khách hàng phù hợp' : 'Chưa có khách hàng'} />
              </td></tr>}
              {filtered.map((c, index) => {
                const aging = agingByCustomer.get(c.id);
                const debt = aging ? aging.totalOutstanding : null;
                const overdueDays = aging?.maxOverdueDays ?? 0;
                const termDays = c.paymentTermDays != null ? Number(c.paymentTermDays)
                  : c.agencyFeePaymentTermDays != null ? Number(c.agencyFeePaymentTermDays) : null;
                const termTitle = c.paymentTermDays != null ? 'Hạn thanh toán cước'
                  : c.agencyFeePaymentTermDays != null ? 'Hạn thanh toán chi hộ' : undefined;
                const addr = c.address || c.contactInfo;
                return (
                <tr key={c.id}>
                  <td data-label="Khách hàng" className="cfg-customer-identity">
                    <span className="cus-id">
                      <span className={`cus-dot cus-dot--${riskOf(c)}`} aria-hidden="true" />
                      {/* Title-case display (SIL-169); the full legal name
                          rides the title tooltip and every export. */}
                      <span className="row-strong cfg-customer-full-name" title={c.name}>{titleCaseVn(c.name)}</span>
                      {c.shortName && c.shortName !== c.name && <span className="cus-chip">{titleCaseVn(c.shortName)}</span>}
                      {c.status === CustomerStatus.LOCKED && <span className="cus-chip cus-chip--locked">Tạm khoá</span>}
                    </span>
                    {c.code && <span className="cus-code-sub"><span className="data-token">{c.code}</span></span>}
                  </td>
                  <td data-label="Mã số thuế"><span className="data-token">{c.taxCode || '—'}</span></td>
                  {/* Card 20260926_9 (Director's no-migration ruling): ĐỊA CHỈ
                      falls back to the address-bearing contact_info field. */}
                  <td data-label="Địa chỉ" className="cus-addr-cell" title={addr || undefined}>{addr || '—'}</td>
                  <td data-label="Liên hệ">
                    <span className="customers-contact-stack">
                      <span className="cus-contact-main">
                        {c.contactPerson || '—'}
                        {c.phone && <span className="data-token" style={{ marginLeft: 6 }}>{c.phone}</span>}
                      </span>
                      {(c.accountantName || c.accountantPhone) && (
                        <span className="cus-contact-sub">
                          {c.accountantName}
                          {c.accountantName && c.accountantPhone && ' · '}
                          {c.accountantPhone && <span className="data-token">{c.accountantPhone}</span>}
                        </span>
                      )}
                    </span>
                  </td>
                  <td data-label="Hạn thanh toán" className="cus-term-cell" title={termTitle ?? undefined}>
                    {termDays != null ? <>{termDays} <span className="cus-term-unit">ngày</span></> : '—'}
                  </td>
                  {/* Debt/overdue from the aging projection; CUS/DISPATCHER
                      editors read '—' — the endpoint is not theirs. */}
                  <td data-label="Công nợ" className="cus-debt-cell" data-overdue={overdueDays > 0 || undefined}>
                    {debt != null
                      ? <span className="customers-contact-stack">
                          <Money value={debt} compact />
                          {overdueDays > 0 && <span className="cus-debt-sub">quá hạn {overdueDays} ngày</span>}
                        </span>
                      : '—'}
                  </td>
                  <td
                    data-label=""
                    className="record-table__action"
                    data-dropdown-root={menuOpenId === c.id ? '' : undefined}
                    style={{ position: 'relative' }}
                  >
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Tùy chọn"
                        aria-label={`Thao tác khách hàng ${c.shortName || c.name}`}
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                    {menuOpenId === c.id && (
                      <div className={`cus-kebab-menu${index >= filtered.length - 2 && filtered.length > 2 ? ' cus-kebab-menu--up' : ''}`} role="menu" onClick={(e) => e.stopPropagation()}>
                        <button type="button" role="menuitem"
                          onClick={() => { setMenuOpenId(null); crud.setError(null); crud.setEditingId(c.id); }}>
                          <Pencil size={13} /> Sửa
                        </button>
                        <button type="button" role="menuitem" className="cus-kebab-menu__danger"
                          disabled={crud.deleting === c.id}
                          onClick={async () => {
                            const ok = await confirm(`Xóa khách hàng "${c.name}"?`, { confirmLabel: 'Xóa', variant: 'danger' });
                            if (ok) { setMenuOpenId(null); crud.doDelete(c.id); }
                          }}>
                          {crud.deleting === c.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
        <div className="table-foot">
          {data && <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> khách hàng</span>}
        </div>
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}

      {/* Modal for adding a new customer */}
      <Modal isOpen={crud.showAddForm && !crud.editingId} title="Thêm khách hàng mới" polished onClose={crud.cancelForm} maxWidth={600}>
          <CustomerForm
            saving={crud.saving}
            error={crud.error}
            onsave={(d) => {
              crud.setError(null);
              crud.doCreate(d);
            }}
            oncancel={crud.cancelForm}
          />
      </Modal>

      {/* Modal for editing an existing customer */}
      {(() => {
        const item = customers.find(x => x.id === crud.editingId);
        if (!item) return null;
        return (
          <Modal isOpen={true} title="Chỉnh sửa thông tin khách hàng" polished onClose={crud.cancelForm} maxWidth={600}>
              <CustomerForm
                item={item}
                saving={crud.saving}
                error={crud.error}
                onsave={(d) => {
                  crud.setError(null);
                  crud.doUpdate(item.id, d);
                }}
                oncancel={crud.cancelForm}
              />
          </Modal>
        );
      })()}

      {confirmDialog}
    </div>
  );
}
