import { useState, useEffect, useMemo, type CSSProperties } from 'react'; // useEffect remains for the form modal's reset-on-open
import { useNavigate } from 'react-router-dom';
import {
  Plus, Download, Search,
  MoreHorizontal, Pencil, Trash2, X, Save, Loader2, Truck,
  Building2, Hash, Landmark, MapPin, User, Phone,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, FilterPill, StatusPill, Modal, Drawer, ModalChip, ModalChipLive, useConfirm } from '../components/UI';
import { Input } from '../components/untitled-ui/base/input/input';
import { EntityFormSection, RequiredHint } from '../components/shared/EntityFormParts';
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
import './config/customer-form.css';

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

// ─── Card _37 drawer histories (BE endpoints by the BE lane, 4607fa20) ──────

interface CustomerLogisticsItem {
  id: number; shipmentCode: string; blNumber: string | null; bookingRef: string | null;
  status: string; tradeDirection: string | null; expectedDeliveryDate: string | null; createdAt: string;
}
interface CustomerPaymentItem {
  id: number; timestamp: string; txnType: string; receiptId: number | null;
  credit: string | null; debit: string | null; balance: string | null; note: string | null;
}

/** Slide-over history sections for the row drawer. Wired against the BE
 * history endpoints (ADMIN/MANAGER/ACCOUNTANT only); numerics arrive as
 * drizzle strings and coerce on render. */
function CustomerDrawerHistories({ customerId }: { customerId: number }) {
  const [logistics, setLogistics] = useState<CustomerLogisticsItem[] | null>(null);
  const [payments, setPayments] = useState<CustomerPaymentItem[] | null>(null);
  const [outstanding, setOutstanding] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLogistics(null); setPayments(null); setOutstanding(null); setFailed(false);
    // lib/api resolves the parsed JSON body directly (no .data wrapper).
    api.get(`/customers/${customerId}/logistics-history?limit=5`).then(
      (r: unknown) => { if (alive) setLogistics((r as { items?: CustomerLogisticsItem[] })?.items ?? []); },
      () => { if (alive) setFailed(true); },
    );
    api.get(`/customers/${customerId}/payment-history?limit=5`).then(
      (r: unknown) => {
        if (!alive) return;
        const body = r as { items?: CustomerPaymentItem[]; outstanding?: string | number };
        setPayments(body?.items ?? []);
        setOutstanding(body?.outstanding != null ? Number(body.outstanding) : null);
      },
      () => { if (alive) setFailed(true); },
    );
    return () => { alive = false; };
  }, [customerId]);

  if (failed) return <p style={{ color: 'var(--ink-3)', margin: 0 }}>Không tải được lịch sử.</p>;
  return (
    <>
      <dl className="customers-drawer__section">
        <dt>Công nợ phải thu (AR)</dt>
        <dd style={outstanding != null && outstanding > 0 ? { color: 'var(--danger)' } : undefined}>
          {outstanding != null ? <Money value={outstanding} /> : '…'}
        </dd>
      </dl>
      <dl className="customers-drawer__section">
        <dt>Đơn logistics gần đây</dt>
        {logistics == null ? <dd>…</dd> : logistics.length === 0 ? <dd>—</dd> : logistics.map((item) => (
          <dd key={item.id} style={{ fontWeight: 400 }}>
            {item.shipmentCode}{item.blNumber ? ` · ${item.blNumber}` : ''} — {item.status}
            {item.expectedDeliveryDate ? ` · giao ${item.expectedDeliveryDate.slice(0, 10)}` : ''}
          </dd>
        ))}
      </dl>
      <dl className="customers-drawer__section">
        <dt>Thanh toán gần đây</dt>
        {payments == null ? <dd>…</dd> : payments.length === 0 ? <dd>—</dd> : payments.map((item) => (
          <dd key={item.id} style={{ fontWeight: 400 }}>
            {item.timestamp.slice(0, 10)} · {item.note || item.txnType} ·{' '}
            {Number(item.credit ?? 0) > 0 ? `+${Number(item.credit).toLocaleString('vi-VN')}` : `-${Number(item.debit ?? 0).toLocaleString('vi-VN')}`}
            {item.balance != null ? ` · còn lại ${Number(item.balance).toLocaleString('vi-VN')}` : ''}
          </dd>
        ))}
      </dl>
    </>
  );
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
  const [isCarrier, setIsCarrier] = useState(item?.isCarrier ?? false);

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
      setIsCarrier(item?.isCarrier ?? false);
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
      isCarrier,
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? (item.shortName || item.name) : 'Thêm khách hàng'}
      subtitle={item ? 'Sửa khách hàng' : undefined}
      polished
      ariaLabel={item ? `Sửa khách hàng ${item.shortName || item.name}` : 'Thêm khách hàng'}
      headerRight={
        !item ? undefined : item.status === CustomerStatus.LOCKED
          ? <ModalChip>Tạm khoá</ModalChip>
          : <ModalChipLive>Đang hoạt động</ModalChipLive>
      }
      maxWidth={620}
      onClose={oncancel}
      onConfirm={handleSave}
      footer={
        <>
          <RequiredHint />
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
      <div className="customer-form-modal flex flex-col gap-4">
        <EntityFormSection icon={Building2} label="Thông tin khách hàng">
          <Input
            size="sm"
            label="Tên đầy đủ"
            isRequired
            icon={Building2}
            value={name}
            onChange={setName}
            placeholder="Tên pháp lý dùng trên chứng từ, báo cáo"
            autoFocus
          />
          <Input
            size="sm"
            label="Tên ngắn"
            isRequired
            icon={Hash}
            value={shortName}
            onChange={setShortName}
            placeholder="Tên hiển thị trong vận hành"
          />
          <Input
            size="sm"
            label="Mã số thuế"
            icon={Landmark}
            value={taxCode}
            maxLength={20}
            onChange={setTaxCode}
            placeholder="0312…"
            inputClassName="tabular-nums"
          />
          <Input
            size="sm"
            label="Địa chỉ"
            icon={MapPin}
            value={contactInfo}
            onChange={setContactInfo}
            placeholder="Địa chỉ khách hàng"
          />
          <Input
            size="sm"
            label="Người liên hệ"
            icon={User}
            value={contactPerson}
            onChange={setContactPerson}
            placeholder="Anh Tuấn · Kế toán"
          />
          <Input
            size="sm"
            label="SĐT Liên hệ"
            icon={Phone}
            value={phone}
            onChange={setPhone}
            placeholder="0912…"
            inputClassName="tabular-nums"
          />
        </EntityFormSection>
        <EntityFormSection icon={Landmark} label="Kế toán &amp; điều khoản">
          <div className="col-span-full">
            <label className="flex items-center gap-2 cursor-pointer select-none text-sm" style={{ minHeight: 32 }}>
              <input
                type="checkbox"
                checked={isCarrier}
                onChange={(e) => setIsCarrier(e.target.checked)}
                style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
              />
              <Truck size={14} />
              <span>Nhà xe (đối tác vận tải ngoài)</span>
            </label>
          </div>
          <Input
            size="sm"
            label="Giám đốc"
            icon={User}
            value={accountantName}
            onChange={setAccountantName}
            placeholder="Tên giám đốc"
          />
          <Input
            size="sm"
            label="SĐT Kế toán"
            icon={Phone}
            value={accountantPhone}
            onChange={setAccountantPhone}
            placeholder="0912…"
            inputClassName="tabular-nums"
          />
        </EntityFormSection>
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
  // Card _37: column visibility (optional detail columns hidden by default),
  // secondary debt filter, bulk selection and the row slide-over drawer.
  const [extraCols, setExtraCols] = useState<{ shortName: boolean; taxCode: boolean; freightTerm: boolean }>(() => ({
    shortName: false, taxCode: false, freightTerm: false,
  }));
  const [colsOpen, setColsOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [drawerId, setDrawerId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const openCustomerDrawer = (id: number) => { setDrawerId(id); setDrawerOpen(true); };
  // Bulk-notify dialog state (BE bulk-notify endpoint, Idempotency-Key safe).
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyTitle, setNotifyTitle] = useState('');
  const [notifyMessage, setNotifyMessage] = useState('');
  const [notifySending, setNotifySending] = useState(false);
  const [bulkStatusBusy, setBulkStatusBusy] = useState(false);
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
   * would otherwise cover the table-slot error row below it.
   */
  const toastMutationError = (e: unknown, fallback: string) => {
    const baseMessage = e instanceof Error && e.message ? e.message : fallback;
    toast({ kind: 'error', message: baseMessage, duration: 7000 });
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
      await api.post('/customers', body);
      toast({ kind: 'success', message: 'Đã tạo khách hàng' });
      setShowAddForm(false);
      await refetchCustomers();
    } catch (e: unknown) { toastMutationError(e, 'Lỗi lưu'); } finally { setSaving(false); }
  }

  async function doUpdate(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.put(`/customers/${id}`, body);
      toast({ kind: 'success', message: 'Đã cập nhật khách hàng' });
      await refetchCustomers();
      setEditingId(null);
      setMenuOpenId(null);
    } catch (e: unknown) { toastMutationError(e, 'Lỗi cập nhật'); } finally { setSaving(false); }
  }

  const { confirm, dialog: confirmDialog } = useConfirm();

  async function doDelete(id: number) {
    if (!await confirm('Xóa khách hàng này?', { variant: 'danger', confirmLabel: 'Xóa' })) return;
    setDeleting(id);
    try {
      await api.delete(`/customers/${id}`);
      setMenuOpenId(null);
      await refetchCustomers();
    } catch (e: unknown) { toastMutationError(e, 'Lỗi xóa'); } finally { setDeleting(null); }
  }

  /** Card _37 bulk status flip (BE bulk-status endpoint): one idempotent
   * call serves both Khóa tài khoản and unlock — pass the target status. */
  async function doBulkStatus(status: 'LOCKED' | 'ACTIVE') {
    setBulkStatusBusy(true);
    try {
      const r = await api.post('/customers/bulk-status', { customerIds: [...selected], status }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const body = r as { updated?: number; skipped?: number };
      // Lead condition on the dropped-confirm acceptance: the toast must
      // surface the affected count so the action's scope stays visible.
      const action = status === 'LOCKED' ? 'khóa' : 'mở khóa';
      toast({ kind: 'success', message: `Đã ${action} ${body?.updated ?? 0} tài khoản${body?.skipped ? ` (bỏ qua ${body.skipped})` : ''}` });
      setSelected(new Set());
      await refetchCustomers();
    } catch (e: unknown) {
      toastMutationError(e, 'Lỗi khóa/mở khóa');
    } finally { setBulkStatusBusy(false); }
  }

  /** Card _37 bulk notify: idempotent BE dispatch to ACTIVE CUSTOMER-role
   * users linked to the selected customers. Idempotency-Key makes replays
   * return the same response with zero duplicates. */
  async function doBulkNotify() {
    if (!notifyTitle.trim() || !notifyMessage.trim()) return;
    setNotifySending(true);
    try {
      const ids = [...selected];
      const r = await api.post('/customers/bulk-notify', { customerIds: ids, title: notifyTitle.trim(), message: notifyMessage.trim() }, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      });
      const body = r as { notified?: number; matchedCustomers?: number };
      toast({ kind: 'success', message: `Đã gửi thông báo đến ${body?.notified ?? 0}/${body?.matchedCustomers ?? ids.length} người dùng liên quan` });
      setNotifyOpen(false);
      setNotifyTitle(''); setNotifyMessage('');
    } catch (e: unknown) {
      toastMutationError(e, 'Lỗi gửi thông báo');
    } finally { setNotifySending(false); }
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

      {/* Summary rail — status cards double as filters (card _37). */}
      <SummaryRail
        ariaLabel="Tóm tắt khách hàng"
        items={[
          { label: 'Tổng khách hàng', value: total },
          { label: 'Đang hoạt động', value: activeCount, onClick: () => setFilter(filter === 'active' ? 'all' : 'active'), pressed: filter === 'active' },
          { label: 'Tạm khoá', value: lockedCount, tone: lockedCount > 0 ? 'warning' : undefined, onClick: () => setFilter(filter === 'locked' ? 'all' : 'locked'), pressed: filter === 'locked' },
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
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            aria-expanded={colsOpen}
            aria-haspopup="true"
            onClick={() => setColsOpen(o => !o)}
          >
            Tùy chỉnh cột
          </button>
          {colsOpen && (
            <div className="customers-cols-popover" onClick={(e) => e.stopPropagation()}>
              {([
                ['shortName', 'Tên viết tắt'],
                ['taxCode', 'Mã số thuế'],
                ['freightTerm', 'Hạn TT Cước'],
              ] as const).map(([key, label]) => (
                <label key={key}>
                  <input
                    type="checkbox"
                    checked={extraCols[key]}
                    onChange={(e) => setExtraCols(prev => ({ ...prev, [key]: e.target.checked }))}
                  />
                  {label}
                </label>
              ))}
            </div>
          )}
        </div>
        <div style={{ position: 'relative', width: 240, maxWidth: '100%' }}>
          <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-3)' }} />
          <input
            type="text"
            name="customerSearch"
            aria-label="Tìm khách hàng theo tên hoặc mã số thuế"
            placeholder="Tìm theo tên, MST…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ width: '100%', minHeight: 'var(--control-compact-h)', padding: '4px 11px 4px 32px', background: 'var(--surface-2)', border: '1px solid var(--line)', borderRadius: 8, fontSize: 'var(--control-field-font-size)', lineHeight: 1.35 }}
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
                      <span style={{ marginLeft: 6, fontSize: 'var(--text-body-size)', fontWeight: 700, color: 'var(--info-text)', background: 'var(--info-soft)', border: '1px solid color-mix(in srgb, var(--info) 22%, transparent)', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', verticalAlign: 'middle', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
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

      {/* Card _37: bulk selection bar — CSV export (FE), bulk notify (BE
          endpoint live), bulk lock awaits its endpoint. */}
      {selected.size > 0 && (
        <div className="customers-bulkbar" role="status">
          <strong>Đã chọn {selected.size}</strong>
          <button
            className="btn btn--secondary btn--sm"
            onClick={async () => {
              const chosen = filtered.filter(c => selected.has(c.id));
              const headers = ['Tên KH', 'Tên ngắn', 'MST', 'Người liên hệ', 'Điện thoại', 'Trạng thái'];
              await downloadCSV(`khach-hang-chon-${new Date().toISOString().slice(0, 10)}.csv`, headers, chosen.map(c => [
                c.name, c.shortName || '', c.taxCode || '', c.contactPerson || '', c.phone || '', STATUS_LABELS[c.status] || c.status,
              ]), { title: 'KHÁCH HÀNG ĐÃ CHỌN' });
            }}
          >
            <Download size={14} /> Xuất CSV đã chọn
          </button>
          <button className="btn btn--secondary btn--sm" onClick={() => setNotifyOpen(true)}>
            Gửi thông báo
          </button>
          <button
            className="btn btn--secondary btn--sm"
            disabled={bulkStatusBusy}
            onClick={() => {
              const chosen = customers.filter(c => selected.has(c.id));
              const nextStatus = chosen.length > 0 && chosen.every(c => c.status === CustomerStatus.LOCKED) ? 'ACTIVE' : 'LOCKED';
              void doBulkStatus(nextStatus);
            }}
          >
            {bulkStatusBusy ? <Loader2 size={14} className="spin" /> : null}
            Khóa / Mở khóa
          </button>
          <button className="btn btn--ghost btn--sm" onClick={() => setSelected(new Set())}>Bỏ chọn</button>
        </div>
      )}

      {/* ── Desktop table (>640px) ──────────────────────────────────────── */}
      <div className="desktop-only table-wrap">
        <div className="record-table-wrap">
          <table className="record-table ops-table" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: 36 }} />
              <col style={{ width: '26%' }} />
              <col style={{ width: '18%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              {extraCols.shortName && <col style={{ width: '10%' }} />}
              {extraCols.taxCode && <col style={{ width: '12%' }} />}
              {extraCols.freightTerm && <col style={{ width: '10%' }} />}
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả khách hàng trên trang"
                    checked={filtered.length > 0 && selected.size === filtered.length}
                    onChange={(e) => {
                      setSelected(e.target.checked ? new Set(filtered.map(c => c.id)) : new Set());
                    }}
                  />
                </th>
                <SortHeader label="Đối tác" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="Giám đốc" sortKey="accountantName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Hạn TT Chi hộ" sortKey="agencyFeePaymentTermDays" sort={sort} onSortChange={applySort} style={thNumStyle} />
                {extraCols.shortName && <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={applySort} />}
                {extraCols.taxCode && <SortHeader label="Mã số thuế" sortKey="taxCode" sort={sort} onSortChange={applySort} />}
                {extraCols.freightTerm && <th>Hạn TT Cước</th>}
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5 + Number(extraCols.shortName) + Number(extraCols.taxCode) + Number(extraCols.freightTerm) + 2} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 'var(--text-data-size)' }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={5 + Number(extraCols.shortName) + Number(extraCols.taxCode) + Number(extraCols.freightTerm) + 2} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchCustomers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={5 + Number(extraCols.shortName) + Number(extraCols.taxCode) + Number(extraCols.freightTerm) + 2} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <EmptyIllustration name="empty-clients" width={140} height={116} style={{ margin: '0 auto 8px', display: 'block' }} />
                  <div>Chưa có dữ liệu</div>
                </td></tr>
              )}
              {filtered.map((c, index) => (
                  <tr key={c.id} role="button" tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => openCustomerDrawer(c.id)}
                    onKeyDown={e => {
                      if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                        e.preventDefault(); openCustomerDrawer(c.id);
                      }
                    }}
                  >
                    <td data-label="Chọn" style={{ width: 36 }} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${c.shortName || c.name}`}
                        checked={selected.has(c.id)}
                        onChange={(e) => {
                          setSelected(prev => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.id); else next.delete(c.id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td data-label="Đối tác" style={{ position: 'relative' }}>
                      <StatusStrip status={c.status} />
                      <span className="customers-clamp-2" style={{ fontWeight: 700, wordBreak: 'break-word', whiteSpace: 'normal' }}>
                        {c.name}
                      </span>
                      <span className="customers-cell-sub" title={c.taxCode || undefined}>
                        {c.shortName || c.name}
                        {c.taxCode ? ` · MST ${c.taxCode}` : ''}
                      </span>
                      <span style={{ display: 'inline-flex', marginTop: 4 }}>
                        <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'warn'}>
                          {STATUS_LABELS[c.status] || c.status}
                        </StatusPill>
                      </span>
                    </td>
                    <td data-label="Người liên hệ">
                      <span style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>{c.contactPerson || '—'}</span>
                      <span className="customers-cell-sub">{c.phone || ''}</span>
                    </td>
                    <td data-label="Giám đốc">
                      {c.accountantName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="num" data-label="Hạn TT Chi hộ">
                      {c.agencyFeePaymentTermDays != null ? `${c.agencyFeePaymentTermDays} ngày` : '—'}
                    </td>
                    {extraCols.shortName && <td data-label="Tên viết tắt">{c.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>}
                    {extraCols.taxCode && <td data-label="Mã số thuế">{c.taxCode || <span style={{ color: 'var(--ink-3)' }}>—</span>}</td>}
                    {extraCols.freightTerm && <td className="num" data-label="Hạn TT Cước">—</td>}
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
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                            onClick={() => { setEditingId(c.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
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
      {confirmDialog}

      {/* Card _37 bulk-notify dialog (BE endpoint, idempotent). */}
      <Modal
        isOpen={notifyOpen}
        title={`Gửi thông báo đến ${selected.size} khách hàng`}
        ariaLabel="Gửi thông báo hàng loạt"
        onClose={() => { if (!notifySending) setNotifyOpen(false); }}
        footer={
          <>
            <button className="btn btn--ghost btn--sm" disabled={notifySending} onClick={() => setNotifyOpen(false)}>
              <X size={14} /> Hủy
            </button>
            <button
              className="btn btn--primary btn--sm"
              disabled={notifySending || !notifyTitle.trim() || !notifyMessage.trim()}
              onClick={() => void doBulkNotify()}
            >
              {notifySending ? <Loader2 size={14} className="spin" /> : null}
              Gửi thông báo
            </button>
          </>
        }
      >
        <div className="customer-form-modal flex flex-col gap-4">
          <Input size="sm" label="Tiêu đề" isRequired value={notifyTitle} onChange={setNotifyTitle} maxLength={200} />
          <Input size="sm" label="Nội dung" isRequired value={notifyMessage} onChange={setNotifyMessage} maxLength={2000} />
          <p style={{ margin: 0, color: 'var(--ink-3)', fontSize: 'var(--text-caption-size)' }}>
            Thông báo vào ứng dụng cho người dùng khách hàng đang hoạt động liên quan các khách hàng đã chọn.
          </p>
        </div>
      </Modal>

      {/* Retain the selected customer while the shared drawer closes so it can
          animate out and restore keyboard focus to the row. */}
      {drawerId != null && (() => {
        const c = filtered.find(x => x.id === drawerId) ?? customers.find(x => x.id === drawerId);
        if (!c) return null;
        const debt = debtMap.get(c.id) ?? 0;
        return (
          <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title={`Chi tiết ${c.shortName || c.name}`}>
              <div className="customers-drawer__body">
                <dl className="customers-drawer__section">
                  <dt>Trạng thái</dt>
                  <dd>
                    <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'warn'}>
                      {STATUS_LABELS[c.status] || c.status}
                    </StatusPill>
                  </dd>
                  <dt>Tên đầy đủ</dt>
                  <dd>{c.name}</dd>
                  <dt>Tên ngắn</dt>
                  <dd>{c.shortName || '—'}</dd>
                  <dt>Mã số thuế</dt>
                  <dd>{c.taxCode || '—'}</dd>
                  <dt>Hạn mức tín dụng</dt>
                  <dd>{c.creditLimit ? formatCurrency(c.creditLimit) : '—'}</dd>
                  <dt>Công nợ hiện tại</dt>
                  <dd style={debt > 0 ? { color: 'var(--danger)' } : undefined}>
                    <Money value={debt} />
                  </dd>
                </dl>
                <dl className="customers-drawer__section">
                  <dt>Giám đốc</dt>
                  <dd>{c.accountantName || '—'}</dd>
                  <dt>Người liên hệ</dt>
                  <dd>{c.contactPerson || '—'}</dd>
                  <dt>Điện thoại</dt>
                  <dd>{c.phone || '—'}</dd>
                  <dt>Thông tin liên hệ khác</dt>
                  <dd>{c.contactInfo || '—'}</dd>
                </dl>
                <button className="btn btn--secondary btn--sm" onClick={() => navigate(`/customers/${c.id}`)}>
                  Mở trang đầy đủ
                </button>
                <CustomerDrawerHistories customerId={c.id} />
              </div>
          </Drawer>
        );
      })()}
    </div>
  );
}
