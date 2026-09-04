import { useState, useEffect, useMemo, type CSSProperties } from 'react'; // useEffect remains for the form modal's reset-on-open
import { useNavigate } from 'react-router-dom';
import {
  Plus, Download, Search,
  MoreHorizontal, Pencil, Trash2, X, Save, Loader2, Truck,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { labelStyle } from '../utils/formStyles';
import { PageHeader, FilterPill, StatusPill, Modal, ModalChipLive } from '../components/UI';
import { SummaryRail } from '../design-system';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination, useTableQueryState } from '../design-system';
import { useToast } from '../components/shared/Toast';
import { formatCurrency } from '../lib/format';
import type { Customer, LedgerEntry } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import { useCustomerLedgerEntries } from '../hooks/useQueries';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { usePageAnimations } from '../hooks/animations';
import { useDropdownDismiss } from '../hooks/useDropdownDismiss';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Badge } from '../components/shared/Badge';
import { StatusStrip, StatusDot } from '../components/shared/StatusStrip';
import { Money } from '../components/shared/Money';
import { EmptyIllustration } from '../components/shared';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './CustomersPage.css';

/** Sort keys mirror the backend /customers sortBy whitelist (server-side sort). */
type CustomerTableFilters = {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

/** Numeric header cells right-align to match the .num body cells. Every other
 * header property (padding, background, case, tracking, sticky pinning) is the
 * shared record-table base. */
const thNumStyle: CSSProperties = { textAlign: 'right' };

type FilterKey = 'all' | 'locked' | 'active' | 'risk';

const STATUS_LABELS: Record<string, string> = {
  [CustomerStatus.ACTIVE]: 'Hoạt động',
  [CustomerStatus.LOCKED]: 'Tạm khoá',
};

const pairedFieldGridStyle = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: 12,
} as const;

function riskDot(debt: number | null, limit: number | null) {
  if (!debt || !limit || limit === 0) return 'low';
  const ratio = debt / limit;
  if (ratio > 0.8) return 'high';
  if (ratio >= 0.5) return 'med';
  return 'low';
}

export function buildCustomerDebtMap(entries: LedgerEntry[]): Map<number, number> {
  const map = new Map<number, number>();
  for (const entry of entries) {
    if (entry.entityType !== 'CUSTOMER') continue;
    const isCarrierPayable =
      entry.txnType === 'EXTERNAL_CARRIER_COST'
      || entry.txnType === 'VENDOR_PAYMENT'
      || (
        entry.txnType === 'UNLOCK_REVERSAL'
        && entry.note?.startsWith('Cước thuê ngoài')
      );
    if (isCarrierPayable) continue;

    const current = map.get(entry.entityId) ?? 0;
    map.set(
      entry.entityId,
      current + (Number(entry.debit ?? 0) || 0) - (Number(entry.credit ?? 0) || 0),
    );
  }
  return map;
}

// ─── Modal-based Form ────────────────────────────────────────────────────────
//
// Was an inline <tr> form that swapped in for the row. The row-replacement
// looked cramped (5 fields squeezed into one table cell) and made it easy to
// miss that edit mode had even opened. Modal gives proper breathing room.

export function CustomerFormModal({ item, saving, onsave, oncancel, isOpen }: {
  item?: Customer; saving: boolean; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean;
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || item?.name || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [contactInfo, setContactInfo] = useState(item?.contactInfo || '');
  const [accountantName, setAccountantName] = useState(item?.accountantName || '');
  const [accountantPhone, setAccountantPhone] = useState(item?.accountantPhone || '');
  const [agencyFeePaymentTermDays, setAgencyFeePaymentTermDays] = useState(
    item?.agencyFeePaymentTermDays != null ? String(item.agencyFeePaymentTermDays) : '',
  );
  const [freightPaymentTermDays, setFreightPaymentTermDays] = useState(
    item?.freightPaymentTermDays != null ? String(item.freightPaymentTermDays) : '',
  );

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || item?.name || '');
      setTaxCode(item?.taxCode || '');
      setContactPerson(item?.contactPerson || '');
      setPhone(item?.phone || '');
      setContactInfo(item?.contactInfo || '');
      setAccountantName(item?.accountantName || '');
      setAccountantPhone(item?.accountantPhone || '');
      setAgencyFeePaymentTermDays(item?.agencyFeePaymentTermDays != null ? String(item.agencyFeePaymentTermDays) : '');
      setFreightPaymentTermDays(item?.freightPaymentTermDays != null ? String(item.freightPaymentTermDays) : '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally re-sync only when the target customer ID changes, not on every prop update
  }, [isOpen, item?.id]);

  const handleSave = () => {
    if (!name.trim() || !shortName.trim()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim(),
      taxCode: taxCode.trim() || undefined,
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      contactInfo: contactInfo.trim() || undefined,
      accountantName: accountantName.trim() || undefined,
      accountantPhone: accountantPhone.trim() || undefined,
      agencyFeePaymentTermDays: agencyFeePaymentTermDays.trim() === '' ? null : Number(agencyFeePaymentTermDays),
      freightPaymentTermDays: freightPaymentTermDays.trim() === '' ? null : Number(freightPaymentTermDays),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? (item.shortName || item.name) : 'Thêm khách hàng'}
      subtitle={item ? 'Sửa khách hàng' : undefined}
      polished
      headerRight={
        item ? <ModalChipLive>Đang hoạt động</ModalChipLive> : undefined
      }
      onClose={oncancel}
      onConfirm={handleSave}
      footer={
        <>
          <p className="modal__hint"><span className="modal__req-mark">*</span> Trường bắt buộc</p>
          <button className="btn btn--ghost btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button className="btn btn--primary btn--sm" disabled={saving || !name.trim() || !shortName.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm khách hàng'}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-name" style={labelStyle}>Tên đầy đủ <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input id="cust-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Tên pháp lý dùng trên chứng từ, báo cáo" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="cust-short-name" style={labelStyle}>Tên ngắn <span style={{ color: 'var(--danger)' }}>*</span></label>
            <input id="cust-short-name" className="input" value={shortName} onChange={e => setShortName(e.target.value)} placeholder="Tên hiển thị trong vận hành" />
          </div>
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-tax" style={labelStyle}>Mã số thuế</label>
            <input id="cust-tax" className="input" value={taxCode} onChange={e => setTaxCode(e.target.value)} placeholder="0312…" />
          </div>
          <div className="field">
            <label htmlFor="cust-address" style={labelStyle}>Địa chỉ</label>
            <input id="cust-address" className="input" value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="Địa chỉ khách hàng" />
          </div>
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-contact" style={labelStyle}>Người liên hệ</label>
            <input id="cust-contact" className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Anh Tuấn · Kế toán" />
          </div>
          <div className="field">
            <label htmlFor="cust-phone" style={labelStyle}>SĐT Liên hệ</label>
            <input id="cust-phone" className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0912…" />
          </div>
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-director" style={labelStyle}>Giám đốc</label>
            <input id="cust-director" className="input" value={accountantName} onChange={e => setAccountantName(e.target.value)} placeholder="Tên giám đốc" />
          </div>
          <div className="field">
            <label htmlFor="cust-accountant-phone" style={labelStyle}>SĐT Kế toán</label>
            <input id="cust-accountant-phone" className="input" value={accountantPhone} onChange={e => setAccountantPhone(e.target.value)} placeholder="0912…" />
          </div>
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-agency-fee-term" style={labelStyle}>Hạn TT Chi hộ (ngày)</label>
            <input
              id="cust-agency-fee-term"
              className="input"
              type="number"
              min={0}
              max={3650}
              value={agencyFeePaymentTermDays}
              onChange={e => setAgencyFeePaymentTermDays(e.target.value)}
              placeholder="Ví dụ: 15"
            />
          </div>
          <div className="field">
            <label htmlFor="cust-freight-term" style={labelStyle}>Hạn TT Cước (ngày)</label>
            <input
              id="cust-freight-term"
              className="input"
              type="number"
              min={0}
              max={3650}
              value={freightPaymentTermDays}
              onChange={e => setFreightPaymentTermDays(e.target.value)}
              placeholder="Ví dụ: 30"
            />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const { toast } = useToast();
  const [filter, setFilter] = useState<FilterKey>('all');

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  // Row kebab menus join the global click-away / Escape dismissal layer.
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));
  const navigate = useNavigate();

  const table = useTableQueryState<Customer, CustomerTableFilters>({
    endpoint: (params) => configClient.getCustomers(
      params.page ?? 1,
      params.search ?? '',
      readTableSort(params.sortBy, params.sortDir),
    ),
    queryKey: qk.catalogs.customersTable,
    defaultPageSize: 10,
    debounceMs: 300,
  });
  const { page, setPage, pageSize, search, setSearch, rows: customers, total, isLoading: loading, error: queryError, setFilter: setSortFilter } = table;
  const error = queryError ? 'Không thể tải dữ liệu' : null;
  const refetchCustomers = table.query.refetch;

  // Server-side sorting: the sort pair rides the filters bag so setFilter's
  // built-in page reset applies (page 1 whenever the sort changes).
  const sort = readTableSort(table.filters.sortBy, table.filters.sortDir);
  const applySort = (key: string) => {
    const next = nextTableSort(sort, key);
    setSortFilter('sortBy', next.by);
    setSortFilter('sortDir', next.dir);
  };

  const { rootRef } = usePageAnimations({ ready: !loading });
  const { data: ledgerEntries } = useCustomerLedgerEntries();

  /**
   * Mutation failures must surface as a toast: the edit modal stays open and
   * would otherwise cover the table-slot error row below it. For the
   * pending-governance 409, point the user at the approval center where the
   * blocking request can be approved/rejected.
   */
  const toastMutationError = (e: unknown, fallback: string) => {
    const status = e instanceof ApiError ? e.status : null;
    const baseMessage = e instanceof Error && e.message ? e.message : fallback;
    const hint = status === 409
      ? ' Đang có yêu cầu chỉnh sửa khách hàng này chờ xử lý — kiểm tra Trung tâm phê duyệt trước khi sửa tiếp.'
      : '';
    toast({ kind: 'error', message: baseMessage + hint, duration: 7000 });
  };

  const debtMap = useMemo(() => {
    return buildCustomerDebtMap(ledgerEntries ?? []);
  }, [ledgerEntries]);

  const { activeCount, lockedCount, filtered } = useMemo(() => {
    const activeCount = customers.filter(c => c.status === CustomerStatus.ACTIVE).length;
    const lockedCount = customers.filter(c => c.status === CustomerStatus.LOCKED).length;
    const filtered = customers.filter(c => {
      if (filter === 'active') return c.status === CustomerStatus.ACTIVE;
      if (filter === 'locked') return c.status === CustomerStatus.LOCKED;
      if (filter === 'risk') {
        const debt = debtMap.get(c.id) ?? 0;
        const limit = Number(c.creditLimit || 0);
        if (debt <= 0) return false;
        // No credit limit + outstanding debt = unlimited risk exposure
        if (limit <= 0) return true;
        return debt / limit > 0.8;
      }
      return true;
    });
    return { activeCount, lockedCount, filtered };
  }, [customers, filter, debtMap]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function doCreate(body: Record<string, unknown>) {
    setSaving(true);
    try {
      // Customer create goes through PRICE_CONFIG_CHANGE governance because it
      // affects credit terms and AR aging. The API returns the governance
      // action, NOT the customer record. We must surface that to the user,
      // otherwise the modal closes and the customer "vanishes" from the list
      // (it actually exists as a PENDING_CHECK approval elsewhere).
      const result = await api.post<{ actionKind?: string; status?: string; reason?: string }>('/customers', body);
      if (result && typeof result === 'object' && 'actionKind' in result && result.actionKind === 'PRICE_CONFIG_CHANGE') {
        toast({
          kind: 'info',
          message: result.status === 'PENDING_CHECK'
            ? 'Yêu cầu tạo khách hàng đã gửi — đang chờ phê duyệt. Khách hàng sẽ xuất hiện trong danh sách sau khi được duyệt.'
            : 'Yêu cầu tạo khách hàng đã được ghi nhận và đang chờ kiểm tra.',
          duration: 7000,
        });
      } else {
        toast({ kind: 'success', message: 'Đã tạo khách hàng' });
      }
      setShowAddForm(false);
      await refetchCustomers();
    } catch (e: unknown) { toastMutationError(e, 'Lỗi lưu'); } finally { setSaving(false); }
  }

  async function doUpdate(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      // Edits to credit-bearing fields also go through PRICE_CONFIG_CHANGE
      // approval — same caveat as doCreate. Show a toast so the user knows
      // the change is pending, not silently lost.
      const result = await api.put<{ actionKind?: string; status?: string }>(`/customers/${id}`, body);
      if (result && typeof result === 'object' && 'actionKind' in result && result.actionKind === 'PRICE_CONFIG_CHANGE') {
        toast({
          kind: 'info',
          message: 'Yêu cầu cập nhật khách hàng đã gửi — đang chờ phê duyệt.',
          duration: 7000,
        });
      } else {
        toast({ kind: 'success', message: 'Đã cập nhật khách hàng' });
      }
      await refetchCustomers();
      setEditingId(null);
      setMenuOpenId(null);
    } catch (e: unknown) { toastMutationError(e, 'Lỗi cập nhật'); } finally { setSaving(false); }
  }

  async function doDelete(id: number) {
    setDeleting(id);
    try {
      await api.delete(`/customers/${id}`);
      setMenuOpenId(null);
      await refetchCustomers();
    } catch (e: unknown) { toastMutationError(e, 'Lỗi xóa'); } finally { setDeleting(null); }
  }

  return (
    <div className="customers-page" ref={rootRef}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>

      <Breadcrumbs
        className="customers-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Khách hàng' },
        ]}
      />
      <PageHeader
        title="Khách hàng"
        iconName="customer"
        description={`${total} khách hàng đang quản lý`}
        action={
          <>
            <button className="btn btn--secondary" onClick={async () => {
              const headers = ['Tên KH', 'MST', 'Người liên hệ', 'Điện thoại', 'Hạn mức TD', 'Trạng thái'];
              const rows = filtered.map(c => [
                c.name,
                c.taxCode || '',
                c.contactPerson || '',
                c.phone || '',
                c.creditLimit || '',
                STATUS_LABELS[c.status] || c.status,
              ]);
              await downloadCSV(`khach-hang-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
                title: 'DANH SÁCH KHÁCH HÀNG',
                subtitle: `${filtered.length} khách hàng đang quản lý`,
                columnTypes: ['text', 'text', 'text', 'text', 'currency', 'text'],
              });
            }}>
              <Download size={14} /> Xuất Excel
            </button>
            <button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}>
              <Plus size={14} /> Thêm khách hàng
            </button>
          </>
        }
      />

      {/* Summary rail */}
      <SummaryRail
        ariaLabel="Tóm tắt khách hàng"
        items={[
          { label: 'Tổng khách hàng', value: total },
          { label: 'Đang hoạt động', value: activeCount },
          { label: 'Tạm khoá', value: lockedCount, tone: lockedCount > 0 ? 'warning' : undefined },
        ]}
      />

      {/* Toolbar with filter pills */}
      <div className="toolbar">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>Tất cả · {total}</FilterPill>
        <FilterPill active={filter === 'risk'} onClick={() => setFilter('risk')}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--warning, #D97706)', display: 'inline-block', marginRight: 4 }} />
          Rủi ro cao
        </FilterPill>
        <FilterPill active={filter === 'active'} onClick={() => setFilter('active')}>
          <StatusDot status="ACTIVE" style={{ marginRight: 4 }} />
          Hoạt động · {activeCount}
        </FilterPill>
        <FilterPill active={filter === 'locked'} onClick={() => setFilter('locked')}>
          <StatusDot status="INACTIVE" style={{ marginRight: 4 }} />
          Tạm khoá · {lockedCount}
        </FilterPill>
        <div style={{ flex: 1 }} />
        <div style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
          <input
            type="text"
            name="customerSearch"
            aria-label="Tìm khách hàng theo tên hoặc mã số thuế"
            placeholder="Tìm theo tên, MST…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', minHeight: 44, padding: '10px 11px 10px 32px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, lineHeight: 1.35 }}
          />
        </div>
      </div>

      {/* ── Mobile card list (≤820px) ──────────────────────────────────── */}
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>Đang tải…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              illustration="/assets/illustrations/empty-clients.svg"
              title="Chưa có khách hàng"
              description="Thêm khách hàng đầu tiên để bắt đầu quản lý công nợ."
              action={<button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}><Plus size={14} /> Thêm khách hàng</button>}
            />
          ) : (
            filtered.map(c => (
              <ClickableCard key={c.id} className="m-card" style={{ position: 'relative' }} onClick={() => navigate(`/customers/${c.id}`)}>
                <StatusStrip status={c.status} />
                <div className="m-card__top">
                  <span className="m-card__title">
                    <span className={`risk-dot risk-dot--${riskDot(debtMap.get(c.id) ?? 0, Number(c.creditLimit || 0))}`} />
                    {c.shortName || c.name}
                    {c.linkedSupplierId && (
                      <Badge variant="success" style={{ marginLeft: 6 }}>2 chiều</Badge>
                    )}
                    {c.isCarrier && (
                      <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: 'var(--info-text)', background: 'var(--info-soft)', border: '1px solid color-mix(in srgb, var(--info) 22%, transparent)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', verticalAlign: 'middle', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Truck size={11} aria-hidden="true" /> Xe ngoài
                      </span>
                    )}
                  </span>
                  <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'danger'}>
                    {STATUS_LABELS[c.status] || c.status}
                  </StatusPill>
                </div>
                {c.taxCode && (
                  <div className="m-card__meta" style={{ fontFamily: 'var(--font-data)' }}>
                    MST {c.taxCode}
                  </div>
                )}
                {(c.contactPerson || c.phone) && (
                  <div className="m-card__meta">
                    {c.contactPerson}
                    {c.phone && <><span className="m-card__meta-sep">·</span>{c.phone}</>}
                  </div>
                )}
                {c.creditLimit && (
                  <div className="m-card__row">
                    <span className="m-card__row-label">Hạn mức tín dụng</span>
                    <span className="m-card__row-value">{formatCurrency(c.creditLimit)}</span>
                  </div>
                )}
                <div className="m-card__row">
                  <span className="m-card__row-label">Công nợ</span>
                  <span className="m-card__row-value" style={debtMap.get(c.id) ? { color: 'var(--danger)' } : undefined}>
                    <Money value={debtMap.get(c.id) ?? 0} />
                  </span>
                </div>
                <div className="m-card-edit-row">
                  <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setShowAddForm(false); }}>
                    Sửa
                  </button>
                </div>
              </ClickableCard>
            ))
          )}
        </div>
        <div className="table-foot">
          <span>Hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> khách hàng</span>
        </div>
      </div>

      {/* ── Desktop table (>640px) ──────────────────────────────────────── */}
      <div className="desktop-only table-wrap">
        <div className="record-table-wrap">
          <table className="record-table ops-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="Tên khách hàng" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã KH" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã số thuế" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                <SortHeader label="Giám đốc" sortKey="accountantName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="Hạn TT Chi hộ" sortKey="agencyFeePaymentTermDays" sort={sort} onSortChange={applySort} style={thNumStyle} />
                <SortHeader label="Hạn TT Cước" sortKey="freightPaymentTermDays" sort={sort} onSortChange={applySort} style={thNumStyle} />
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={9} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 13 }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={9} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchCustomers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <EmptyIllustration name="empty-clients" width={140} height={116} style={{ margin: '0 auto 8px', display: 'block' }} />
                  <div>Chưa có dữ liệu</div>
                </td></tr>
              )}
              {filtered.map((c, index) => (
                  <tr key={c.id} role="button" tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/customers/${c.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/customers/${c.id}`); } }}
                  >
                    <td data-label="Tên khách hàng" style={{ position: 'relative' }}>
                      <StatusStrip status={c.status} />
                      <span style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
                        {c.name}
                      </span>
                    </td>
                    <td data-label="Tên viết tắt">
                      {c.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td data-label="Mã KH">
                      {c.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td data-label="Mã số thuế">
                      {c.taxCode || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td data-label="Giám đốc">
                      {c.accountantName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td data-label="Người liên hệ">
                      {c.contactPerson || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="num" data-label="Hạn TT Chi hộ">
                      {c.agencyFeePaymentTermDays != null ? `${c.agencyFeePaymentTermDays} ngày` : '—'}
                    </td>
                    <td className="num" data-label="Hạn TT Cước">
                      {c.freightPaymentTermDays != null ? `${c.freightPaymentTermDays} ngày` : '—'}
                    </td>
                    <td data-label="" className="record-table__action" data-dropdown-root={menuOpenId === c.id ? '' : undefined} style={{ position: 'relative' }}>
                      <div className="row-actions">
                        <button className="row-action" aria-label={`Mở thao tác cho ${c.shortName || c.name}`} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}>
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
                            : { top: '100%' }),
                        }} onClick={(e) => e.stopPropagation()}>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                            onClick={() => { setEditingId(c.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
                            disabled={deleting === c.id}
                            onClick={() => doDelete(c.id)}>
                            {deleting === c.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
              ))}
            </tbody>
          </table>
        </div>

        <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} onChange={setPage} />
      </div>

      {/* Customer add/edit modal */}
      <CustomerFormModal
        key={editingId ?? (showAddForm ? 'add' : 'closed')}
        isOpen={showAddForm || editingId != null}
        saving={saving}
        item={editingId != null ? customers.find(c => c.id === editingId) : undefined}
        onsave={d => {
          if (editingId != null) doUpdate(editingId, d);
          else doCreate(d);
        }}
        oncancel={() => { setEditingId(null); setShowAddForm(false); }}
      />
    </div>
  );
}
