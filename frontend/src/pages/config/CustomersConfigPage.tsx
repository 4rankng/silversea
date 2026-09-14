import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
import type { Customer, TripDetail } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import { CustomerForm } from './CustomerForm';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import './config-page.css';
import './customer-config-density.css';

export default function CustomersConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [customerFilter, setCustomerFilter] = useState<'all' | 'high-risk' | 'active' | 'locked'>('all');
  const [search, setSearch] = useState('');
  // Client-side column sort — the catalog is a full in-memory array (and the
  // month trip/revenue columns are derived client-side), so there is no
  // server sort to call; null keeps the fetch order.
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));

  const { data, refetch } = useQuery({
    queryKey: qk.tripForm.customersConfig(search),
    queryFn: async () => {
      const [custList, tripRes] = await Promise.all([
        configClient.getAllCustomers(search || undefined),
        tripClient.fetchAllTrips({}).catch(() => ({ items: [] as TripDetail[], total: 0 })),
      ]);
      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const statsMap = new Map<number, { trips: number; revenue: number }>();
      tripRes.items.forEach((t: TripDetail) => {
        const dep = t.departureDate || '';
        if (dep.startsWith(thisMonth)) {
          const cid = t.customerId;
          if (cid) {
            const s = statsMap.get(cid) || { trips: 0, revenue: 0 };
            s.trips++;
            s.revenue += parseFloat(t.revenue || '0');
            statsMap.set(cid, s);
          }
        }
      });
      return { customers: custList, customerTripStats: statsMap };
    },
    staleTime: 2 * 60 * 1000,
  });

  const customers = useMemo(() => data?.customers ?? [], [data?.customers]);
  const customerTripStats = data?.customerTripStats ?? new Map<number, { trips: number; revenue: number }>();

  const crud = useCRUD('/customers', async () => { await refetch(); });
  const { confirm, dialog: confirmDialog } = useConfirm();

  const now = new Date();
  const monthLabel = `${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getFullYear()).slice(-2)}`;
  const totalCount = customers.length;
  const activeCount = customers.filter(c => c.status === CustomerStatus.ACTIVE).length;
  const lockedCount = customers.filter(c => c.status === CustomerStatus.LOCKED).length;

  const allRevenues = customers.map(c => customerTripStats.get(c.id)?.revenue || 0).sort((a, b) => b - a);
  const totalRevenue = allRevenues.reduce((s, v) => s + v, 0);
  const top4Revenue = allRevenues.slice(0, 4).reduce((s, v) => s + v, 0);
  const top4Pct = totalRevenue > 0 ? Math.round((top4Revenue / totalRevenue) * 100) : 0;

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
    // Server-side search via fetchAllPaginated already filters by name.
    // Client-side filter only adds taxCode matching (server only checks name).
    let result = byStatus;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.name.toLowerCase().includes(q) || (c.taxCode || '').toLowerCase().includes(q)
      );
    }
    return sortClientSide(result, sort, {
      name: c => c.name,
      contact: c => c.contactPerson || c.phone || c.contactInfo || null,
      monthTrips: c => customerTripStats.get(c.id)?.trips ?? null,
      monthRevenue: c => customerTripStats.get(c.id)?.revenue ?? null,
      creditLimit: c => {
        const limit = parseFloat(c.creditLimit || '0');
        return limit > 0 ? limit : null;
      },
      status: c => c.status,
    }, (a, b) => b.id - a.id);
  }, [customers, customerFilter, search, sort, customerTripStats]);

  return (
    <div ref={pageRef} className="cfg-page cfg-page--customers">
      <PageHeader
        title="Khách hàng & Đối tác"
        description={
          <>
            <strong>{totalCount}</strong> khách hàng đang quản lý
            {top4Pct > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{top4Pct}%</strong> doanh thu tập trung ở 4 KH lớn nhất</>}
          </>
        }
        onBack={handleBack}
        iconName="customer"
        action={
          <div className="page-actions">
          <button className="btn btn--secondary" onClick={async () => {
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
          <button className="btn btn--primary" onClick={() => crud.setShowAddForm(true)}>
            <Plus size={14} /> Thêm khách hàng
          </button>
          </div>
        }
      />

      <div className="kpi-grid cfg-customer-summary" role="group" aria-label="Tổng quan khách hàng">
        <div className="kpi">
          <div className="kpi__top"><span className="kpi__label">Tổng khách hàng</span></div>
          <div className="kpi__value">{totalCount}</div>
          <div className="kpi__meta kpi__meta--up">Đang quản lý</div>
          <div className="kpi__watermark" aria-hidden="true"><Users size={72} /></div>
        </div>
        <div className="kpi kpi--success">
          <div className="kpi__top"><span className="kpi__label">Đang hoạt động</span></div>
          <div className="kpi__value">{activeCount}<span className="kpi__value-unit">/{totalCount}</span></div>
          <div className="kpi__meta">{totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0}% hoạt động đều</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="8 12 11 15 16 9"/></svg></div>
        </div>
        <div className="kpi kpi--warn">
          <div className="kpi__top"><span className="kpi__label">Top 4 chiếm</span></div>
          <div className="kpi__value">{top4Pct}<span className="kpi__value-unit">%</span></div>
          <div className="kpi__meta">{top4Pct > 60 ? 'Rủi ro tập trung cao' : 'Doanh thu tháng này'}</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></div>
        </div>
        <div className="kpi kpi--danger">
          <div className="kpi__top"><span className="kpi__label">Tạm khoá</span></div>
          <div className="kpi__value">{lockedCount}</div>
          <div className="kpi__meta">Do nợ quá hạn</div>
          <div className="kpi__watermark" aria-hidden="true"><svg aria-hidden="true" width="72" height="72" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>
        </div>
      </div>

      <div className="table-wrap">
        <div className="toolbar">
          {(['all', 'high-risk', 'active', 'locked'] as const).map(f => {
            const labels = { all: `Tất cả · ${totalCount}`, 'high-risk': 'Rủi ro cao', active: `Hoạt động · ${activeCount}`, locked: `Tạm khoá · ${lockedCount}` };
            return <button key={f} className={`filter-pill${customerFilter === f ? ' is-active' : ''}`} onClick={() => setCustomerFilter(f)}>{labels[f]}</button>;
          })}
          <div className="toolbar__spacer" />
          <div className="toolbar__search">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input
              type="text"
              name="customerSearch"
              aria-label="Tìm khách hàng theo tên hoặc mã số thuế"
              placeholder="Tìm theo tên, MST…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="table-scroll">
          <div className="record-table-wrap">
          <table className="record-table ops-table cfg-customer-table">
            <thead>
              <tr>
                <SortHeader label="Tên Khách hàng" sortKey="name" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Mã KH" sortKey="code" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Mã Số Thuế" sortKey="taxCode" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Địa Chỉ" sortKey="address" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Giám đốc" sortKey="contactPerson" sort={sort} onSortChange={handleSort} />
                <SortHeader label="SĐT Giám đốc" sortKey="phone" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Người Liên Hệ" sortKey="accountantName" sort={sort} onSortChange={handleSort} />
                <SortHeader label="SĐT Kế toán" sortKey="accountantPhone" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Email" sortKey="contactInfo" sort={sort} onSortChange={handleSort} />
                <SortHeader className="num" label="Hạn Thanh Toán Chi hộ (Ngày)" sortKey="agencyFeePaymentTermDays" sort={sort} onSortChange={handleSort} />
                <SortHeader className="num" label="Hạn Thanh Toán Cước (Ngày)" sortKey="paymentTermDays" sort={sort} onSortChange={handleSort} />
                <th style={{ width: 88 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr className="cfg-empty-row"><td colSpan={13} data-label="" style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>Chưa có dữ liệu</td></tr>}
              {filtered.map((c, index) => (
                <tr key={c.id}>
                  <td data-label="Tên Khách hàng"><div className="row-strong">{c.name}</div></td>
                  <td data-label="Tên viết tắt">{c.shortName || '—'}</td>
                  <td data-label="Mã KH">{c.code || '—'}</td>
                  <td data-label="Mã Số Thuế">{c.taxCode || '—'}</td>
                  <td data-label="Địa Chỉ" style={{ overflowWrap: 'anywhere' }}>{c.address || '—'}</td>
                  <td data-label="Giám đốc">{c.contactPerson || '—'}</td>
                  <td data-label="SĐT Giám đốc">{c.phone || '—'}</td>
                  <td data-label="Người Liên Hệ">{c.accountantName || '—'}</td>
                  <td data-label="SĐT Kế toán">{c.accountantPhone || '—'}</td>
                  <td data-label="Email" style={{ overflowWrap: 'anywhere' }}>{c.contactInfo || '—'}</td>
                  <td className="num" data-label="Hạn Thanh Toán Chi hộ (Ngày)">{c.agencyFeePaymentTermDays ?? '—'}</td>
                  <td className="num" data-label="Hạn Thanh Toán Cước (Ngày)">{c.paymentTermDays ?? '—'}</td>
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
                        onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                      >
                        <MoreHorizontal size={14} />
                      </button>
                    </div>
                    {menuOpenId === c.id && (
                      <div style={{
                        position: 'absolute', right: 12, zIndex: 20,
                        background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
                        boxShadow: '0 4px 14px rgba(10,10,10,0.06)', overflow: 'hidden', minWidth: 140,
                        ...(index >= filtered.length - 2 && filtered.length > 2
                          ? { bottom: '100%', marginBottom: 4 }
                          : { top: '100%', marginTop: 4 }),
                      }} onClick={(e) => e.stopPropagation()}>
                        <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px',  border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                          onClick={() => { setMenuOpenId(null); crud.setEditingId(c.id); }}>
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
          <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> khách hàng</span>
        </div>
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}

      {/* Modal for adding a new customer */}
      <Modal isOpen={crud.showAddForm && !crud.editingId} title="Thêm khách hàng mới" polished onClose={crud.cancelForm} maxWidth={600}>
        <div style={{ padding: '8px 4px' }}>
          <CustomerForm
            saving={crud.saving}
            onsave={(d) => {
              crud.doCreate(d);
            }}
            oncancel={crud.cancelForm}
          />
        </div>
      </Modal>

      {/* Modal for editing an existing customer */}
      {(() => {
        const item = customers.find(x => x.id === crud.editingId);
        if (!item) return null;
        return (
          <Modal isOpen={true} title="Chỉnh sửa thông tin khách hàng" polished onClose={crud.cancelForm} maxWidth={600}>
            <div style={{ padding: '8px 4px' }}>
              <CustomerForm
                item={item}
                saving={crud.saving}
                onsave={(d) => {
                  crud.doUpdate(item.id, d);
                }}
                oncancel={crud.cancelForm}
              />
            </div>
          </Modal>
        );
      })()}

      {confirmDialog}
    </div>
  );
}
