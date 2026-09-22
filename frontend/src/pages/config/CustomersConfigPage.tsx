import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useAuth } from '../../hooks/useAuth';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Users, Plus, Loader2, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { PageHeader, useConfirm, Modal } from '../../components/UI';
import { configClient } from '../../api/configClient';
import { tripClient } from '../../api/tripClient';
import { downloadCSV } from '../../lib/csv';
import { useCRUD } from '../../hooks/useCRUD';
import { useDropdownDismiss } from '../../hooks/useDropdownDismiss';
import { qk } from '../../api/keys';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import type { Customer } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import { CustomerForm } from './CustomerForm';
import { EmptyState } from '../../design-system';
import { ListFilterBar } from '../../components/ListFilterBar';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import './customer-config-density.css';

function CustomerCompactDetails({ customer: c }: { customer: Customer }) {
  const facts = [
    ['Tên đầy đủ', c.name], ['Tên viết tắt', c.shortName], ['Mã KH', c.code], ['Mã số thuế', c.taxCode],
    ['Địa chỉ', c.address], ['Người liên hệ', c.contactPerson], ['SĐT liên hệ', c.phone],
    ['Kế toán liên hệ', c.accountantName], ['SĐT kế toán', c.accountantPhone], ['Liên hệ khác', c.contactInfo],
    ['Hạn thanh toán chi hộ', c.agencyFeePaymentTermDays == null ? null : `${c.agencyFeePaymentTermDays} ngày`],
    ['Hạn thanh toán cước', c.paymentTermDays == null ? null : `${c.paymentTermDays} ngày`],
  ];
  return <details className="cfg-customer-details">
    <summary>Thông tin chi tiết</summary>
    <dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Chưa cập nhật'}</dd></div>)}</dl>
  </details>;
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

  function getRiskLevel(c: Customer): 'high' | 'med' | 'low' {
    const debt = 0;
    const limit = parseFloat(c.creditLimit || '0');
    if (limit > 0 && debt > limit * 0.8) return 'high';
    if (c.status === CustomerStatus.LOCKED) return 'high';
    if (limit > 0 && debt > limit * 0.5) return 'med';
    return 'low';
  }

  const filtered = useMemo(() => {
    const byStatus = customers.filter(c => {
      if (customerFilter === 'active') return c.status === CustomerStatus.ACTIVE;
      if (customerFilter === 'locked') return c.status === CustomerStatus.LOCKED;
      if (customerFilter === 'high-risk') return getRiskLevel(c) === 'high';
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
  }, [customers, customerFilter, sort, customerTripStats]);

  // Card 20260922_22 — a column no row in the current result fills hides
  // itself: the catalog previously spent most of its width on "—"
  // placeholders. Mandatory columns (Tên khách hàng + actions) always render;
  // hidden columns return as soon as any filtered row carries data.
  const colPresence = useMemo(() => {
    const present: Record<string, boolean> = {};
    for (const c of filtered) {
      if (c.shortName?.trim() && c.shortName !== c.name) present.shortName = true;
      if (c.code?.trim()) present.code = true;
      if (c.taxCode?.trim()) present.taxCode = true;
      if (c.address?.trim()) present.address = true;
      if (c.contactPerson?.trim()) present.contactPerson = true;
      if (c.phone?.trim()) present.phone = true;
      if (c.accountantName?.trim()) present.accountantName = true;
      if (c.accountantPhone?.trim()) present.accountantPhone = true;
      if (c.contactInfo?.trim()) present.contactInfo = true;
      if (c.agencyFeePaymentTermDays != null) present.agencyFeePaymentTermDays = true;
      if (c.paymentTermDays != null) present.paymentTermDays = true;
    }
    return present;
  }, [filtered]);

  return (
    <div ref={pageRef} className="cfg-page cfg-page--customers">
      <PageHeader
        title="Khách hàng & Đối tác"
        description={
          <>
            <strong>{data ? totalCount : '—'}</strong> khách hàng đang quản lý
            {top4Pct != null && top4Pct > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{top4Pct}%</strong> doanh thu tập trung ở 4 KH lớn nhất</>}
          </>
        }
        onBack={handleBack}
        iconName="customer"
        action={
          <div className="page-actions">
          <button className="btn btn--secondary" disabled={isFetching || isError || exportStatsUnavailable}
            title={exportStatsUnavailable ? 'Tải xong doanh thu để xuất đầy đủ dữ liệu' : undefined} onClick={async () => {
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
          }}>
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Xuất Excel
          </button>
          <button className="btn btn--primary" onClick={() => { crud.setError(null); crud.setShowAddForm(true); }}>
            <Plus size={14} /> Thêm khách hàng
          </button>
          </div>
        }
      />

      <div className="kpi-grid cfg-customer-summary" role="group" aria-label="Tổng quan khách hàng" aria-busy={isFetching}>
        <div className="kpi">
          <div className="kpi__top"><span className="kpi__label">Tổng khách hàng</span></div>
          <div className="kpi__value">{data ? totalCount : '—'}</div>
          <div className="kpi__meta kpi__meta--up">Đang quản lý</div>
          <div className="kpi__watermark" aria-hidden="true"><Users size={72} /></div>
        </div>
        <div className="kpi kpi--success">
          <div className="kpi__top"><span className="kpi__label">Đang hoạt động</span></div>
          <div className="kpi__value">{data ? activeCount : '—'}{data && <span className="kpi__value-unit">/{totalCount}</span>}</div>
          <div className="kpi__meta">Trạng thái hoạt động</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg></div>
        </div>
        <div className="kpi kpi--warn">
          <div className="kpi__top"><span className="kpi__label">Top 4 chiếm</span></div>
          <div className="kpi__value">{top4Pct ?? '—'}{top4Pct != null && <span className="kpi__value-unit">%</span>}</div>
          <div className="kpi__meta">{!canReadTripStats ? 'Tài khoản không xem doanh thu'
            : tripStats.isError ? <>Không thể tải doanh thu. <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void tripStats.refetch(); }}>Thử lại</button></>
              : tripStats.isPending ? 'Đang tải doanh thu…'
                : top4Pct == null ? 'Chưa có doanh thu tháng này' : top4Pct > 60 ? 'Rủi ro tập trung cao' : 'Doanh thu tháng này'}</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
        </div>
        <div className="kpi kpi--danger">
          <div className="kpi__top"><span className="kpi__label">Tạm khoá</span></div>
          <div className="kpi__value">{data ? lockedCount : '—'}</div>
          <div className="kpi__meta">Trạng thái tạm khoá</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        </div>
      </div>

      <div className="table-wrap">
        {/* Shared filter-bar contract (card 20260922_38): one quick-filter
            group + search; the duplicate mobile "Lọc khách hàng" select is
            gone (one input per datum — the pills wrap under the bar contract). */}
        <ListFilterBar
          search={{ value: search, onChange: setSearch, placeholder: 'Tên, MST, điện thoại…', ariaLabel: 'Tìm khách hàng theo tên, tên ngắn, mã số thuế, điện thoại hoặc người liên hệ' }}
          quickFiltersLabel="Lọc khách hàng"
          quickFilters={(['all', 'high-risk', 'active', 'locked'] as const).map(f => {
            const labels = { all: `Tất cả${data ? ` · ${totalCount}` : ''}`, 'high-risk': 'Rủi ro cao', active: `Hoạt động${data ? ` · ${activeCount}` : ''}`, locked: `Tạm khoá${data ? ` · ${lockedCount}` : ''}` };
            return <button key={f} type="button" aria-pressed={customerFilter === f} className={`filter-pill${customerFilter === f ? ' is-active' : ''}`} onClick={() => setCustomerFilter(f)}>{labels[f]}</button>;
          })}
        />
        <div className="cfg-customer-fetch-status" role="status" aria-live="polite">
          {isFetching ? (isPending ? 'Đang tải khách hàng…' : 'Đang cập nhật kết quả…') : isError ? <>
            Không thể tải khách hàng. <button type="button" className="btn btn--ghost btn--sm" onClick={() => { void refetch(); }}>Thử lại</button>
          </> : null}
        </div>
        <div className="table-scroll" aria-busy={isFetching}>
          <div className="record-table-wrap">
          <table className="record-table ops-table cfg-customer-table">
            <thead>
              <tr>
                <SortHeader label="Tên Khách hàng" sortKey="name" sort={sort} onSortChange={handleSort} />
                {colPresence.shortName && <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={handleSort} />}
                {colPresence.code && <SortHeader label="Mã KH" sortKey="code" sort={sort} onSortChange={handleSort} />}
                {colPresence.taxCode && <SortHeader label="Mã Số Thuế" sortKey="taxCode" sort={sort} onSortChange={handleSort} />}
                {colPresence.address && <SortHeader label="Địa Chỉ" sortKey="address" sort={sort} onSortChange={handleSort} />}
                {colPresence.contactPerson && <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={handleSort} />}
                {colPresence.phone && <SortHeader label="SĐT liên hệ" sortKey="phone" sort={sort} onSortChange={handleSort} />}
                {colPresence.accountantName && <SortHeader label="Kế toán liên hệ" sortKey="accountantName" sort={sort} onSortChange={handleSort} />}
                {colPresence.accountantPhone && <SortHeader label="SĐT Kế toán" sortKey="accountantPhone" sort={sort} onSortChange={handleSort} />}
                {colPresence.contactInfo && <SortHeader label="Liên hệ khác" sortKey="contactInfo" sort={sort} onSortChange={handleSort} />}
                {colPresence.agencyFeePaymentTermDays && <SortHeader className="num" label="Hạn Thanh Toán Chi hộ (Ngày)" sortKey="agencyFeePaymentTermDays" sort={sort} onSortChange={handleSort} />}
                {colPresence.paymentTermDays && <SortHeader className="num" label="Hạn Thanh Toán Cước (Ngày)" sortKey="paymentTermDays" sort={sort} onSortChange={handleSort} />}
                <th style={{ width: 88 }}></th>
              </tr>
            </thead>
            <tbody>
              {!isFetching && !isError && filtered.length === 0 && <tr className="cfg-empty-row"><td colSpan={2 + Object.keys(colPresence).length} data-label="">
                <EmptyState variant="compact" illustration="fleet" title={search || customerFilter !== 'all' ? 'Không có khách hàng phù hợp' : 'Chưa có khách hàng'} />
              </td></tr>}
              {filtered.map((c, index) => (
                <tr key={c.id}>
                  <td data-label="Tên Khách hàng" className="cfg-customer-identity">
                    {c.shortName && c.shortName !== c.name && <strong className="cfg-customer-short-name">{c.shortName}</strong>}
                    <div className="row-strong cfg-customer-full-name" title={c.name}>{c.name}</div>
                    <div className="cfg-customer-compact-meta">
                      {c.taxCode && <span>MST {c.taxCode}</span>}
                      {(c.contactPerson || c.phone) && <span>{[c.contactPerson, c.phone].filter(Boolean).join(' · ')}</span>}
                    </div>
                    <CustomerCompactDetails customer={c} />
                  </td>
                  {colPresence.shortName && <td data-label="Tên viết tắt">{c.shortName || '—'}</td>}
                  {colPresence.code && <td data-label="Mã KH">{c.code || '—'}</td>}
                  {colPresence.taxCode && <td data-label="Mã Số Thuế">{c.taxCode || '—'}</td>}
                  {colPresence.address && <td data-label="Địa Chỉ" style={{ overflowWrap: 'anywhere' }}>{c.address || '—'}</td>}
                  {colPresence.contactPerson && <td data-label="Người liên hệ">{c.contactPerson || '—'}</td>}
                  {colPresence.phone && <td data-label="SĐT liên hệ">{c.phone || '—'}</td>}
                  {colPresence.accountantName && <td data-label="Kế toán liên hệ">{c.accountantName || '—'}</td>}
                  {colPresence.accountantPhone && <td data-label="SĐT Kế toán">{c.accountantPhone || '—'}</td>}
                  {colPresence.contactInfo && <td data-label="Liên hệ khác" style={{ overflowWrap: 'anywhere' }}>{c.contactInfo || '—'}</td>}
                  {colPresence.agencyFeePaymentTermDays && <td className="num" data-label="Hạn Thanh Toán Chi hộ (Ngày)">{c.agencyFeePaymentTermDays ?? '—'}</td>}
                  {colPresence.paymentTermDays && <td className="num" data-label="Hạn Thanh Toán Cước (Ngày)">{c.paymentTermDays ?? '—'}</td>}
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
                      <div style={{
                        position: 'absolute', right: 12, zIndex: 20,
                        background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
                        boxShadow: '0 4px 14px rgba(10,10,10,0.06)', overflow: 'hidden', minWidth: 140,
                        ...(index >= filtered.length - 2 && filtered.length > 2
                          ? { bottom: '100%', marginBottom: 4 }
                          : { top: '100%', marginTop: 4 }),
                      }} onClick={(e) => e.stopPropagation()}>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                          onClick={() => { setMenuOpenId(null); crud.setError(null); crud.setEditingId(c.id); }}>
                          <Pencil size={13} /> Sửa
                        </button>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
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
              ))}
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
