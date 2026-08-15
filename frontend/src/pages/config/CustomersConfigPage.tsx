import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { useBackShortcut } from '../../hooks/useBackShortcut';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Users, Plus, Loader2 } from 'lucide-react';
import { useConfirm, Modal } from '../../components/UI';
import { AssetIcon } from '../../components/AssetIcon';
import { configClient } from '../../api/configClient';
import { tripClient } from '../../api/tripClient';
import { formatCurrency } from '../../lib/format';
import {
  buildCustomerDebitNoteModeOptions,
  describeCustomerDebitNoteMode,
  type EditableCustomerDebitNoteMode,
} from '../../lib/customerDebitNoteMode';
import { downloadCSV } from '../../lib/csv';
import { useCRUD } from '../../hooks/useCRUD';
import { qk } from '../../api/keys';
import type { Customer, TripDetail, DebitNoteTemplate } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import './config-page.css';

function toThresholdPercent(value: string | null | undefined): string {
  if (!value) return '';
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return '';
  return String(Math.round(ratio * 10000) / 100);
}

function fromThresholdPercent(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed / 100;
  if (ratio < 0.01 || ratio > 0.99) return null;
  return Math.round(ratio * 10000) / 10000;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label} {children}</label></div>;
}

function CustomerForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: Customer; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [contactInfo, setContactInfo] = useState(item?.contactInfo || '');
  const [creditLimit, setCreditLimit] = useState(item?.creditLimit || '');
  const [creditWarningThreshold, setCreditWarningThreshold] = useState(toThresholdPercent(item?.creditWarningThreshold));
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  const [debitNoteMode, setDebitNoteMode] = useState<Customer['debitNoteMode']>(item?.debitNoteMode ?? 'MONTHLY');
  const [debitNoteTemplateId, setDebitNoteTemplateId] = useState<number | null>(item?.debitNoteTemplateId ?? null);
  const { data: templates } = useQuery<DebitNoteTemplate[]>({
    queryKey: qk.catalogs.debitNoteTemplates,
    queryFn: () => configClient.getDebitNoteTemplates(),
    staleTime: 60_000,
  });

  const debitNoteModeOptions = buildCustomerDebitNoteModeOptions(debitNoteMode);
  const debitNoteModeDescription = describeCustomerDebitNoteMode(debitNoteMode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Tên khách hàng *">
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Nhập tên…" required />
        </Field>
        <Field label="Mã số thuế">
          <input className="input" value={taxCode} onChange={e => setTaxCode(e.target.value)} placeholder="Nhập MST…" />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Người liên hệ">
          <input className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Tên người liên hệ…" />
        </Field>
        <Field label="Số điện thoại">
          <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="SĐT liên hệ…" />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Hạn mức tín dụng">
          <input className="input" type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Cảnh báo công nợ (%)">
          <input
            className="input"
            type="number"
            min="1"
            max="99"
            step="0.01"
            value={creditWarningThreshold}
            onChange={e => setCreditWarningThreshold(e.target.value)}
            placeholder="Mặc định hệ thống"
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Trạng thái">
          <select className="input" value={status} onChange={e => setStatus(e.target.value as CustomerStatus)}>
            <option value="ACTIVE">Hoạt động</option>
            <option value="LOCKED">Tạm khoá</option>
          </select>
        </Field>
        <Field label="Chu kỳ giấy báo nợ">
          <select
            className="input"
            value={debitNoteMode}
            onChange={e => setDebitNoteMode(e.target.value as EditableCustomerDebitNoteMode)}
          >
            {debitNoteModeOptions.map((option) => (
              <option key={option.value} value={option.value} disabled={option.disabled}>
                {option.label}
              </option>
            ))}
          </select>
          {debitNoteModeDescription ? (
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
              {debitNoteModeDescription}
            </div>
          ) : null}
        </Field>
      </div>

      <Field label="Thông tin liên hệ khác / Địa chỉ">
        <textarea className="input" value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="SĐT, email, địa chỉ khác…" rows={3} style={{ resize: 'vertical' }} />
      </Field>

      <Field label="Mẫu giấy báo nợ">
        <select
          className="input"
          value={debitNoteTemplateId ?? ''}
          onChange={e => setDebitNoteTemplateId(e.target.value === '' ? null : Number(e.target.value))}
        >
          <option value="">Dùng mẫu mặc định</option>
          {(templates ?? []).map(t => (
            <option key={t.id} value={t.id}>{t.name}{t.isDefault ? ' — mặc định' : ''}</option>
          ))}
        </select>
      </Field>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>Hủy</button>
        <button type="button" className="btn btn--primary" onClick={() => {
          if (!name.trim()) return;
          const threshold = fromThresholdPercent(creditWarningThreshold);
          if (creditWarningThreshold.trim() && threshold == null) return;
          onsave({
            name: name.trim(),
            taxCode: taxCode.trim() || null,
            contactPerson: contactPerson.trim() || null,
            phone: phone.trim() || null,
            contactInfo: contactInfo.trim() || null,
            creditLimit: creditLimit ? String(creditLimit) : null,
            creditWarningThreshold: threshold,
            status,
            debitNoteMode,
            debitNoteTemplateId,
          });
        }} disabled={saving}>
          {saving && <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />}
          {item ? 'Cập nhật' : 'Thêm mới'}
        </button>
      </div>
    </div>
  );
}

export default function CustomersConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const navigate = useNavigate();
  const handleBack = () => navigate('/config');
  useBackShortcut(handleBack);
  const [customerFilter, setCustomerFilter] = useState<'all' | 'high-risk' | 'active' | 'locked'>('all');
  const [search, setSearch] = useState('');

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
    if (!search) return byStatus;
    const q = search.toLowerCase();
    return byStatus.filter(c =>
      c.name.toLowerCase().includes(q) || (c.taxCode || '').toLowerCase().includes(q)
    );
  }, [customers, customerFilter, search]);

  return (
    <div ref={pageRef} className="cfg-page cfg-page--customers">
      <div className="page-header">
        <button
          type="button"
          onClick={handleBack}
          aria-label="Quay lại danh sách cấu hình"
          className="page-header__back-btn"
          style={{ marginRight: 4 }}
        >
          <ArrowLeft size={18} />
        </button>
        <div className="page-header-main" style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div className="page-header-icon" aria-hidden="true">
            <AssetIcon name="customer" size={28} />
          </div>
          <div style={{ minWidth: 0 }}>
            <h1 className="page-title">Khách hàng & Đối tác</h1>
            <p className="page-subtitle">
              <strong>{totalCount}</strong> khách hàng đang quản lý
              {top4Pct > 0 && <> · <strong style={{ color: 'var(--danger)' }}>{top4Pct}%</strong> doanh thu tập trung ở 4 KH lớn nhất</>}
            </p>
          </div>
        </div>
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
      </div>

      <div className="kpi-grid" style={{ marginBottom: 20 }}>
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
        <div style={{ padding: '6px 12px 8px', display: 'flex', alignItems: 'center', gap: 6, color: 'var(--fg-3)', fontSize: 12 }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>
          Nhấn vào một hàng để xem chi tiết và chỉnh sửa khách hàng
        </div>
        <div className="table-scroll">
          <table className="cfg-customer-table">
            <thead>
              <tr>
                <th>Khách hàng</th><th>Liên hệ</th><th className="num">Chuyến {monthLabel}</th>
                <th className="num">Doanh thu {monthLabel}</th><th className="num">Hạn mức TD</th><th>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && <tr className="cfg-empty-row"><td colSpan={6} style={{ textAlign: 'center', padding: '48px 12px', color: 'var(--ink-3)' }}>Chưa có dữ liệu</td></tr>}
              {filtered.map(c => {
                const risk = getRiskLevel(c);
                const stats = customerTripStats.get(c.id);
                const creditLimit = parseFloat(c.creditLimit || '0');
                return (
                  <tr
                    key={c.id}
                    onClick={() => crud.setEditingId(c.id)}
                    style={{ cursor: 'pointer' }}
                    title="Nhấp để chỉnh sửa hoặc xóa"
                  >
                    <td data-label="Khách hàng">
                      <div className="row-strong"><span className={`risk-dot risk-dot--${risk}`} />{c.name}</div>
                      {c.taxCode && <div className="row-meta">MST {c.taxCode}</div>}
                      <div className="row-meta">
                        Cảnh báo: {c.creditWarningThreshold
                          ? `${toThresholdPercent(c.creditWarningThreshold)}%`
                          : 'Mặc định hệ thống'}
                      </div>
                    </td>
                    <td data-label="Liên hệ">
                      {c.contactPerson && <div className="row-strong">{c.contactPerson}</div>}
                      <div className="row-meta">{c.phone || c.contactInfo || '—'}</div>
                    </td>
                    <td className="num" data-label={`Chuyến ${monthLabel}`}>{stats?.trips ?? '—'}</td>
                    <td className="num big" data-label={`Doanh thu ${monthLabel}`}>{stats?.revenue ? formatCurrency(stats.revenue) : '—'}</td>
                    <td className="num" data-label="Hạn mức TD">{creditLimit > 0 ? formatCurrency(creditLimit) : '—'}</td>
                    <td data-label="Trạng thái">
                      {c.status === CustomerStatus.LOCKED
                        ? <span className="pill pill--danger"><span className="dot" />Tạm khoá</span>
                        : <span className="pill pill--success"><span className="dot" />Hoạt động</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="table-foot">
          <span>Đang hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> trên <strong style={{ fontFamily: 'var(--font-data)' }}>{totalCount}</strong> khách hàng</span>
        </div>
      </div>
      {crud.error && <div style={{ textAlign: 'center', color: 'var(--danger)', marginTop: 12 }}>{crud.error}</div>}

      {/* Modal for adding a new customer */}
      <Modal
        isOpen={crud.showAddForm && !crud.editingId}
        title="Thêm khách hàng mới"
        onClose={crud.cancelForm}
        maxWidth={600}
      >
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

      {/* Modal for editing/deleting an existing customer */}
      {(() => {
        const item = customers.find(x => x.id === crud.editingId);
        if (!item) return null;
        return (
          <Modal
            isOpen={true}
            title="Chỉnh sửa thông tin khách hàng"
            onClose={crud.cancelForm}
            maxWidth={600}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20, padding: '8px 4px' }}>
              <CustomerForm
                item={item}
                saving={crud.saving}
                onsave={(d) => {
                  crud.doUpdate(item.id, d);
                }}
                oncancel={crud.cancelForm}
              />
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn--ghost"
                  style={{ color: 'var(--danger)', borderColor: 'var(--danger-soft)', cursor: 'pointer' }}
                  disabled={crud.deleting === item.id || crud.saving}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await confirm(`Bạn có chắc chắn muốn xóa khách hàng "${item.name}" này?`, {
                      confirmLabel: 'Xóa',
                      variant: 'danger',
                    });
                    if (ok) {
                      await crud.doDelete(item.id);
                      crud.cancelForm();
                    }
                  }}
                >
                  {crud.deleting === item.id ? 'Đang xóa...' : 'Xóa khách hàng này'}
                </button>
              </div>
            </div>
          </Modal>
        );
      })()}

      {confirmDialog}
    </div>
  );
}
