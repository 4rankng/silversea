import { useState, useEffect, useMemo, type CSSProperties, type ReactNode } from 'react'; // useEffect remains for the form modal's reset-on-open
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, BarChart3, Lock, Plus, Download, Search,
  MoreHorizontal, Pencil, Trash2, X, Save, Loader2, Truck,
  ArrowDown, ArrowUp, ArrowUpDown,
} from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort, type TableSortState } from '../lib/table-sort';
import { labelStyle } from '../utils/formStyles';
import { PageHeader, KPI, FilterPill, StatusPill, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination, UuiSelectField, useTableQueryState } from '../design-system';
import { useToast } from '../components/shared/Toast';
import { formatCurrency, formatNumber } from '../lib/format';
import {
  buildCustomerDebitNoteModeOptions,
  describeCustomerDebitNoteMode,
  type EditableCustomerDebitNoteMode,
} from '../lib/customerDebitNoteMode';
import type { Customer, LedgerEntry, Supplier } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';
import { useCustomerLedgerEntries, useSuppliers } from '../hooks/useQueries';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { usePageAnimations } from '../hooks/animations';
import { ClickableCard } from '../components/shared/ClickableCard';
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

/** Sortable header cell — the shared table-sort button contract (table-sort.css),
 * so this bespoke table matches the DataTable/record-table sort affordance. */
function SortHeader({ label, sortKey, sort, onSortChange, style }: {
  label: ReactNode; sortKey: string; sort: TableSortState | null;
  onSortChange: (key: string) => void; style?: CSSProperties;
}) {
  const active = sort?.by === sortKey;
  return (
    <th style={style} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className="table-sort-button" onClick={() => onSortChange(sortKey)}>
        {label}
        {active
          ? (sort!.dir === 'asc'
            ? <ArrowUp size={13} aria-hidden="true" />
            : <ArrowDown size={13} aria-hidden="true" />)
          : <ArrowUpDown size={13} aria-hidden="true" className="table-sort-button__icon--idle" />}
      </button>
    </th>
  );
}

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

export function CustomerFormModal({ item, saving, onsave, oncancel, isOpen, suppliers }: {
  item?: Customer; saving: boolean; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean; suppliers: Supplier[];
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || item?.name || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [creditLimit, setCreditLimit] = useState(item?.creditLimit || '');
  const [paymentTermDays, setPaymentTermDays] = useState(
    item?.paymentTermDays != null ? String(item.paymentTermDays) : '30',
  );
  const [fuelSurchargeSharePct, setFuelSurchargeSharePct] = useState(
    item?.fuelSurchargeSharePct != null ? String(item.fuelSurchargeSharePct) : '',
  );
  const [paymentDatePolicy, setPaymentDatePolicy] = useState(
    item?.paymentDatePolicy ?? 'NEXT_BUSINESS_DAY',
  );
  const [status, setStatus] = useState<string>(item?.status || CustomerStatus.ACTIVE);
  const [isCarrier, setIsCarrier] = useState(item?.isCarrier ?? false);
  const [debitNoteMode, setDebitNoteMode] = useState<Customer['debitNoteMode']>(item?.debitNoteMode ?? 'MONTHLY');
  const [linkedSupplierId, setLinkedSupplierId] = useState<number | null>(item?.linkedSupplierId ?? null);

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || item?.name || '');
      setTaxCode(item?.taxCode || '');
      setContactPerson(item?.contactPerson || '');
      setPhone(item?.phone || '');
      setCreditLimit(item?.creditLimit || '');
      setPaymentTermDays(item?.paymentTermDays != null ? String(item.paymentTermDays) : '30');
      setFuelSurchargeSharePct(item?.fuelSurchargeSharePct != null ? String(item.fuelSurchargeSharePct) : '');
      setPaymentDatePolicy(item?.paymentDatePolicy ?? 'NEXT_BUSINESS_DAY');
      setStatus(item?.status || CustomerStatus.ACTIVE);
      setIsCarrier(item?.isCarrier ?? false);
      setDebitNoteMode(item?.debitNoteMode ?? 'MONTHLY');
      setLinkedSupplierId(item?.linkedSupplierId ?? null);
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
      creditLimit: creditLimit ? Number(creditLimit) : undefined,
      paymentTermDays: paymentTermDays ? Number(paymentTermDays) : null,
      fuelSurchargeSharePct: fuelSurchargeSharePct ? Number(fuelSurchargeSharePct) : null,
      paymentDatePolicy,
      status,
      isCarrier,
      debitNoteMode,
      linkedSupplierId: linkedSupplierId ?? null,
    });
  };
  const debitNoteModeOptions = buildCustomerDebitNoteModeOptions(debitNoteMode);
  const debitNoteModeDescription = describeCustomerDebitNoteMode(debitNoteMode);

  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa khách hàng — ${item.shortName || item.name}` : 'Thêm khách hàng'}
      onClose={oncancel}
      onConfirm={handleSave}
      footer={
        <>
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
          <UuiSelectField
            id="cust-status"
            label="Trạng thái"
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
          />
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-contact" style={labelStyle}>Người liên hệ</label>
            <input id="cust-contact" className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Anh Tuấn · Kế toán" />
          </div>
          <div className="field">
            <label htmlFor="cust-phone" style={labelStyle}>Điện thoại</label>
            <input id="cust-phone" className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="0912…" />
          </div>
        </div>
        <div className="field">
          <label htmlFor="cust-credit" style={labelStyle}>Hạn mức tín dụng (đ)</label>
          <input id="cust-credit" className="input" type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="0" />
        </div>
        <div style={pairedFieldGridStyle}>
          <div className="field">
            <label htmlFor="cust-payment-term" style={labelStyle}>Thời hạn thanh toán (ngày)</label>
            <input
              id="cust-payment-term"
              className="input"
              type="number"
              min={0}
              max={3650}
              value={paymentTermDays}
              onChange={e => setPaymentTermDays(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cust-fuel-share" style={labelStyle}>Tỷ lệ chia sẻ phụ phí xăng dầu (%)</label>
            <input
              id="cust-fuel-share"
              className="input"
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={fuelSurchargeSharePct}
              onChange={e => setFuelSurchargeSharePct(e.target.value)}
              placeholder="Để trống nếu không áp dụng"
            />
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
              Để trống nếu khách hàng không áp dụng phụ phí.
            </div>
          </div>
          <UuiSelectField
            id="cust-payment-date-policy"
            label="Ngày đến hạn rơi vào ngày nghỉ"
            value={paymentDatePolicy}
            onChange={e => setPaymentDatePolicy(e.target.value as 'NEXT_BUSINESS_DAY' | 'CALENDAR_DAY')}
            options={[
              { value: 'NEXT_BUSINESS_DAY', label: 'Chuyển sang ngày làm việc tiếp theo' },
              { value: 'CALENDAR_DAY', label: 'Giữ nguyên theo hợp đồng' },
            ]}
          />
        </div>
        <div style={pairedFieldGridStyle}>
          <UuiSelectField
            id="cust-debit-mode"
            label="Giấy báo nợ"
            value={debitNoteMode}
            onChange={e => setDebitNoteMode(e.target.value as EditableCustomerDebitNoteMode)}
            options={debitNoteModeOptions.map((option) => ({
              value: option.value,
              label: option.label,
              disabled: option.disabled,
            }))}
          />
          {debitNoteModeDescription && (
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
              {debitNoteModeDescription}
            </div>
          )}
          <div className="field" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', paddingBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isCarrier}
                onChange={e => setIsCarrier(e.target.checked)}
                style={{ width: 14, height: 14 }}
              />
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-2)' }}>Đối tác vận tải (xe ngoài)</span>
            </label>
          </div>
        </div>
        <UuiSelectField
          id="cust-linked-supplier"
          label="Nhà cung cấp liên quan"
          value={linkedSupplierId === null || linkedSupplierId === undefined ? '' : String(linkedSupplierId)}
          onChange={e => setLinkedSupplierId(e.target.value ? Number(e.target.value) : null)}
          options={[
            { value: '', label: '-- Không liên kết --' },
            ...suppliers.map(s => ({ value: String(s.id), label: s.name })),
          ]}
        />
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
  const { data: suppliersData } = useSuppliers(1, '');
  const allSuppliers = suppliersData?.items ?? [];

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

  const revenueMap = useMemo(() => {
    const map = new Map<number, number>();
    if (!ledgerEntries) return map;
    for (const entry of ledgerEntries) {
      if (entry.entityType === 'CUSTOMER' && entry.txnType === 'TRIP_REVENUE') {
        const current = map.get(entry.entityId) || 0;
        const amount = parseFloat(entry.debit || '0') || 0;
        map.set(entry.entityId, current + amount);
      }
    }
    return map;
  }, [ledgerEntries]);

  const top4Revenue = useMemo(() => {
    const customerRevenues = customers
      .map(c => ({ id: c.id, name: c.shortName || c.name, revenue: revenueMap.get(c.id) || 0 }))
      .filter(c => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 4);
    const totalRevenue = customerRevenues.reduce((s, c) => s + c.revenue, 0);
    return { customers: customerRevenues, total: totalRevenue };
  }, [customers, revenueMap]);

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

      {/* KPI strip */}
      <div className="kpi-grid">
        <KPI
          label="Tổng khách hàng"
          value={total}
          icon={Users}
          assetIconName="customer"
          meta={<span>{total} khách hàng</span>}
        />
        <KPI
          label="Đang hoạt động"
          value={`${activeCount}`}
          unit={`/ ${total}`}
          variant="success"
          icon={UserCheck}
          assetIconName="active-customer"
          meta={total > 0 ? `${Math.round((activeCount / total) * 100)}% hoạt động đều` : ''}
        />
        <KPI
          label="Top 4 KH / doanh thu"
          value={top4Revenue.total > 0 ? formatNumber(top4Revenue.total) : '—'}
          variant={top4Revenue.total > 0 ? 'success' : 'warn'}
          icon={BarChart3}
          assetIconName="profit"
          meta={top4Revenue.total > 0
            ? `${top4Revenue.customers.length} KH · ${formatNumber(top4Revenue.total)} ₫`
            : 'Chưa có dữ liệu doanh thu'
          }
        />
        <KPI
          label="Tạm khoá"
          value={lockedCount}
          variant="danger"
          icon={Lock}
          assetIconName="overdue"
          meta="Do nợ quá hạn"
        />
      </div>

      {/* Toolbar with filter pills */}
      <div className="toolbar">
        <FilterPill active={filter === 'all'} onClick={() => setFilter('all')}>Tất cả · {total}</FilterPill>
        <FilterPill active={filter === 'risk'} onClick={() => setFilter('risk')}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#D97706', display: 'inline-block', marginRight: 4 }} />
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
                      <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', verticalAlign: 'middle' }}>
                        2 chiều
                      </span>
                    )}
                    {/* TODO: extract a shared <Badge> component for "2 chiều" / "Xe ngoài" */}
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
              <col style={{ width: '44%' }} />
              <col style={{ width: '22%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="Khách hàng" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="Hạn mức TD" sortKey="creditLimit" sort={sort} onSortChange={applySort} style={thNumStyle} />
                <SortHeader label="Công nợ" sortKey="debt" sort={sort} onSortChange={applySort} style={thNumStyle} />
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 13 }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={5} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchCustomers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
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
                    <td data-label="Khách hàng" style={{ position: 'relative' }}>
                      <StatusStrip status={c.status} />
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%', minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ wordBreak: 'break-word', whiteSpace: 'normal', minWidth: 0 }}>
                          {c.shortName || c.name}
                        </span>
                        {c.linkedSupplierId && (
                          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: '#16a34a', background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', marginTop: 1 }}>
                            2 chiều
                          </span>
                        )}
                        {c.isCarrier && (
                          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--info-text)', background: 'var(--info-soft)', border: '1px solid color-mix(in srgb, var(--info) 22%, transparent)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', marginTop: 1, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                            <Truck size={11} aria-hidden="true" /> Xe ngoài
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-3)', marginTop: 2 }}>{c.name}</div>
                      {c.taxCode && <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-3)', marginTop: 2, fontFamily: 'var(--font-data)' }}>MST {c.taxCode}</div>}
                    </td>
                    <td data-label="Liên hệ">
                      {c.contactPerson && <div style={{ fontWeight: 600 }}>{c.contactPerson}</div>}
                      {(c.phone || c.contactInfo) && (
                        <div style={{ fontSize: 12, lineHeight: 1.35, color: 'var(--ink-3)', marginTop: 2, fontFamily: 'var(--font-data)' }}>
                          {c.phone || c.contactInfo}
                        </div>
                      )}
                      {!c.contactPerson && !c.phone && !c.contactInfo && <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="num" data-label="Hạn mức TD">
                      {c.creditLimit ? formatCurrency(c.creditLimit) : '—'}
                    </td>
                    <td className="num" data-label="Công nợ">
                      <span style={debtMap.get(c.id) ? { color: 'var(--danger)' } : { color: 'var(--ink-3)' }}>
                        <Money value={debtMap.get(c.id) ?? 0} />
                      </span>
                    </td>
                    <td data-label="" className="record-table__action" style={{ position: 'relative' }}>
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
        suppliers={allSuppliers}
        onsave={d => {
          if (editingId != null) doUpdate(editingId, d);
          else doCreate(d);
        }}
        oncancel={() => { setEditingId(null); setShowAddForm(false); }}
      />
    </div>
  );
}
