import { useState, useEffect, useMemo, useRef } from 'react'; // useEffect remains for the form modal's reset-on-open
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Download,
  Pencil, Trash2, X, Save, Loader2,
  Building2, Hash, Landmark, MapPin, User, Phone,
} from 'lucide-react';
import { api } from '../lib/api';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, StatusPill, Modal, Drawer, ModalChip, ModalChipLive, useConfirm } from '../components/UI';
import { Input } from '../components/untitled-ui/base/input/input';
import { EntityFormSection, RequiredHint } from '../components/shared/EntityFormParts';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination, useTableQueryState } from '../design-system';
import { useTableRowSelection } from '../hooks/useTableRowSelection';
import { CustomerFilters, type CustomerFilterKey } from '../features/customers/CustomerFilters';
import {
  customerDebtSummaryQuery,
  customerFreightMap,
  type CustomerDebtSummaryResponse,
} from '../features/customers/customer-debt-projection';
import { CustomerDrawerHistories } from '../features/customers/CustomerDrawerHistories';
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
import { StatusStrip } from '../components/shared/StatusStrip';
import { Money } from '../components/shared/Money';
import '../styles/record-table.css';
import '../styles/operational-table-typography.css';
import './CustomersPage.css';
import './config/customer-form.css';

/** Sort keys mirror the backend /customers sortBy whitelist (server-side sort). */
type CustomerTableFilters = {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

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
          <div className="col-span-full" />
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
  const [filter, setFilter] = useState<CustomerFilterKey>('all');
  // Card 20260928_177 — "Bỏ xe công ty". The tick's state IS the request: it
  // rides the projection's `excludeOwnFleet` param so the server drops the
  // company-vehicle lines from the freight figures (and the export matches).
  const [excludeOwnFleet, setExcludeOwnFleet] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);
  // Card _37: column visibility (optional detail columns hidden by default),
  // secondary debt filter, bulk selection and the row slide-over drawer.
  // Card 20260929_207: the row is the selection control — the checkbox column
  // is gone app-wide. The bulk bar below still reads the same set, so every
  // batch action (CSV, notify, lock) is unchanged.
  const selection = useTableRowSelection<number>();
  const selected = selection.selected;
  const rowProps = selection.rowProps;
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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const hasActiveFilters = Boolean(search.trim() || filter !== 'all' || excludeOwnFleet);

  // KBD: Meta/Ctrl+K focuses the customer search inside the shared bar.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
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

  // Server-side freight figures for the rows on screen. Keyed by the visible
  // customer ids so the projection stays bounded to the page the user sees —
  // the same rows the CSV export writes.
  const debtSummaryIds = customers.map((customer) => customer.id);
  const { data: debtSummary } = useQuery({
    queryKey: qk.customerDebtSummary(debtSummaryIds.join(','), excludeOwnFleet),
    enabled: debtSummaryIds.length > 0,
    queryFn: () => api.get<CustomerDebtSummaryResponse>(
      `/customers/debt-summary${customerDebtSummaryQuery(debtSummaryIds, excludeOwnFleet)}`,
    ),
  });
  const freightByCustomer = useMemo(() => customerFreightMap(debtSummary), [debtSummary]);

  // Concentration signal (card 20260926_60): the top-4 debtors' share of all
  // tracked debt — drives the ⚠️ badge in the strip; the popover breaks the
  // four down. Revenue-per-customer is not on this surface, so debt is the
  // honest basis here (noted for chief).
  const concentration = useMemo(() => {
    const rowsWithDebt = customers
      .map((c) => ({ id: c.id, name: c.shortName || c.name, debt: debtMap.get(c.id) ?? 0 }))
      .filter((row) => row.debt > 0)
      .sort((a, b) => b.debt - a.debt);
    const totalDebt = rowsWithDebt.reduce((sum, row) => sum + row.debt, 0);
    const top = rowsWithDebt.slice(0, 4).map((row) => ({ ...row, share: totalDebt > 0 ? Math.round((row.debt / totalDebt) * 100) : 0 }));
    const topShare = top.reduce((sum, row) => sum + row.share, 0);
    return { top, totalDebt, topShare, anyDebt: totalDebt > 0 };
  }, [customers, debtMap]);

  const filtered = useMemo(() => customers.filter(c => {
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
  }), [customers, filter, debtMap]);
  // Card 20260929_207: the page-wide select-all, scoped to the rows on screen.
  const allOnPageSelected = selection.allOfSelected(filtered.map((c) => c.id));
  const toggleAllOnPage = () => {
    if (allOnPageSelected) selection.clear();
    else selection.selectAll(filtered.map((c) => c.id));
  };

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
      selection.clear();
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

  /** The strip's Xuất Excel action: the button is `CustomerFilters`', the data
   *  (and the toast) stay on the page that owns the filtered rows. The three
   *  freight columns come from the server projection under the same
   *  `excludeOwnFleet` filter, so the sheet matches the screen. */
  async function exportCustomers() {
    const headers = ['Tên KH', 'MST', 'Người liên hệ', 'Điện thoại', 'Hạn mức TD', 'Trạng thái', 'Số chuyến', 'Cước thu', 'Cước trả'];
    const rows = filtered.map(c => {
      const freight = freightByCustomer.get(c.id);
      return [
        c.name,
        c.taxCode || '',
        c.contactPerson || '',
        c.phone || '',
        c.creditLimit || '',
        STATUS_LABELS[c.status] || c.status,
        freight?.tripCount ?? 0,
        freight?.freightRevenue ?? 0,
        freight?.freightPayable ?? 0,
      ];
    });
    await downloadCSV(`khach-hang-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
      title: 'DANH SÁCH KHÁCH HÀNG',
      subtitle: `${filtered.length} khách hàng đang quản lý${excludeOwnFleet ? ' · đã bỏ xe công ty' : ''}`,
      columnTypes: ['text', 'text', 'text', 'text', 'currency', 'text', 'number', 'currency', 'currency'],
    });
    toast({ kind: 'success', message: 'Đã xuất danh sách khách hàng' });
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
      {/* Page chrome is the shared `PageHeader`; the strip IS the shared
          `ListFilterBar` (card 20260927_152), rendered by `CustomerFilters` so
          this page declares no strip box, no search shell and no control width.
          The status axis keeps both of its controls (see the component). */}
      <PageHeader
        title="Khách hàng & Đối tác"
        onBack={() => navigate('/dashboard')}
      />
      <CustomerFilters
        search={search}
        onSearch={setSearch}
        searchInputRef={searchInputRef}
        filter={filter}
        onFilter={setFilter}
        total={total}
        resultCount={filtered.length}
        concentration={concentration}
        onExport={exportCustomers}
        onAdd={() => { setShowAddForm(true); setEditingId(null); }}
        onReset={() => { setSearch(''); setFilter('all'); setExcludeOwnFleet(false); }}
        hasActiveFilters={hasActiveFilters}
        excludeOwnFleet={excludeOwnFleet}
        onExcludeOwnFleetChange={setExcludeOwnFleet}
      />

      {/* ── Mobile card list (≤820px) ──────────────────────────────────── */}
      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>Đang tải…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              context="clients"
              title={search || filter !== 'all' ? 'Không có khách hàng phù hợp.' : 'Chưa có khách hàng'}
              description={search || filter !== 'all' ? 'Thử thay đổi từ khóa hoặc bộ lọc.' : 'Thêm khách hàng đầu tiên để bắt đầu quản lý công nợ.'}
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
                  </span>
                  <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'danger'}>
                    {STATUS_LABELS[c.status] || c.status}
                  </StatusPill>
                </div>
                {c.taxCode && (
                  <div className="m-card__meta" style={{ fontFamily: 'var(--font-data)' }}>
                    MST <span className="data-token">{c.taxCode}</span>
                  </div>
                )}
                {(c.contactPerson || c.phone) && (
                  <div className="m-card__meta">
                    {c.contactPerson}
                    {c.phone && <><span className="m-card__meta-sep">·</span><span className="data-token">{c.phone}</span></>}
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
                  <span className="m-card__row-value" style={debtMap.get(c.id) ? { color: 'var(--warning-text)' } : undefined}>
                    <Money value={debtMap.get(c.id) ?? 0} />
                  </span>
                </div>
                {/* Card 20260928_177 — the freight figures the "Bỏ xe công ty"
                    tick changes, read off the server projection. */}
                {(() => {
                  const freight = freightByCustomer.get(c.id);
                  if (!freight) return null;
                  return (
                    <div className="m-card__row">
                      <span className="m-card__row-label">Cước thu / trả</span>
                      <span className="m-card__row-value" style={{ fontFamily: 'var(--font-data)' }}>
                        <Money value={freight.freightRevenue} compact /> · <Money value={freight.freightPayable} compact />
                      </span>
                    </div>
                  );
                })()}
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
              const headers = ['Tên KH', 'Tên ngắn', 'MST', 'Người liên hệ', 'Điện thoại', 'Trạng thái', 'Số chuyến', 'Cước thu', 'Cước trả'];
              await downloadCSV(`khach-hang-chon-${new Date().toISOString().slice(0, 10)}.csv`, headers, chosen.map(c => {
                const freight = freightByCustomer.get(c.id);
                return [
                  c.name, c.shortName || '', c.taxCode || '', c.contactPerson || '', c.phone || '', STATUS_LABELS[c.status] || c.status,
                  freight?.tripCount ?? 0, freight?.freightRevenue ?? 0, freight?.freightPayable ?? 0,
                ];
              }), { title: 'KHÁCH HÀNG ĐÃ CHỌN' });
              toast({ kind: 'success', message: 'Đã xuất khách hàng đã chọn' });
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
          <button className="btn btn--ghost btn--sm" onClick={() => selection.clear()}>Bỏ chọn</button>
        </div>
      )}
      {/* Card 20260929_207: the select-all and the selection model live OUTSIDE
          the table, and the model is stated once. Row click picks; the customer
          NAME opens the record (PM decision). */}
      <div className="customers-selection-bar">
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={toggleAllOnPage}
          disabled={filtered.length === 0}
          title={allOnPageSelected ? 'Bỏ chọn các khách hàng đang hiện' : `Chọn ${filtered.length} khách hàng đang hiện trên trang này`}
        >
          {allOnPageSelected ? 'Bỏ chọn dòng trang này' : `Chọn cả trang này (${filtered.length})`}
        </button>
        <span className="customers-selection-bar__hint">
          Bấm vào một dòng để chọn · bấm vào tên khách hàng để mở hồ sơ
        </span>
      </div>

      {/* ── Desktop table (>640px) ──────────────────────────────────────── */}
      <div className="desktop-only table-wrap">
        <div className="record-table-wrap">
          <table className="record-table ops-table" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: 140 }} />
                <col />
                <col style={{ width: 120 }} />
                <col style={{ width: 200 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 158 }} />
                <col style={{ width: 80 }} />
              </colgroup>
              <thead>
                <tr>
                  <SortHeader label="Mã / Tên rút gọn" sortKey="shortName" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Tên doanh nghiệp" sortKey="name" sort={sort} onSortChange={applySort} />
                  <SortHeader label="MST" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                  <SortHeader label="Liên hệ & SĐT" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                  <th>Trạng thái</th>
                  <th>Cước thu / trả</th>
                  <th></th>
                </tr>
              </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 'var(--text-data-size)' }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchCustomers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <EmptyState variant="compact" context="clients" title={search || filter !== 'all' ? 'Không có khách hàng phù hợp.' : 'Chưa có dữ liệu'} />
                </td></tr>
              )}
              {filtered.map((c) => (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    data-selected={selected.has(c.id) || undefined}
                    aria-selected={selected.has(c.id)}
                    className="customers-row"
                    {...rowProps(c.id)}
                  >
                    <td data-label="Mã / Tên rút gọn" className="customers-code-cell">
                      {c.shortName || <span className="customers-muted">—</span>}
                    </td>
                    {/* Card 20260929_207 (PM decision): the row is the selection
                        control, so opening the customer moved to the name — the
                        cell that carries its identity. */}
                    <td data-label="Tên doanh nghiệp">
                      <button
                        type="button"
                        className="customers-name-open"
                        aria-label={`Mở hồ sơ ${c.name}`}
                        onClick={() => openCustomerDrawer(c.id)}
                      >
                        <span className="customers-name-cell" title={c.name}>{c.name}</span>
                      </button>
                    </td>
                    <td data-label="Mã số thuế" className="customers-mono-cell">
                      <span className="data-token">{c.taxCode || <span className="customers-muted">—</span>}</span>
                    </td>
                    <td data-label="Người liên hệ & SĐT">
                      <span className="customers-contact-stack">
                        <span>{c.contactPerson || '—'}</span>
                        {c.phone && (
                          <button
                            type="button"
                            className="customers-copy-phone"
                            title="Sao chép số điện thoại"
                            aria-label={`Sao chép số điện thoại ${c.phone}`}
                            onClick={async (e) => {
                              e.stopPropagation();
                              try {
                                await navigator.clipboard.writeText(c.phone as string);
                                toast({ kind: 'success', message: `Đã sao chép ${c.phone}` });
                              } catch { toast({ kind: 'error', message: 'Không sao chép được' }); }
                            }}
                          >
                            <span className="data-token">{c.phone}</span>
                          </button>
                        )}
                        {!c.phone && <span className="customers-muted">—</span>}
                      </span>
                    </td>
                    <td data-label="Trạng thái">
                      <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'warn'}>
                        {STATUS_LABELS[c.status] || c.status}
                      </StatusPill>
                    </td>
                    <td
                      data-label="Cước thu / trả"
                      className="customers-mono-cell"
                      title={freightByCustomer.get(c.id)
                        ? `${freightByCustomer.get(c.id)!.tripCount} chuyến · xe công ty: ${freightByCustomer.get(c.id)!.ownFleetTripCount} chuyến`
                        : undefined}
                    >
                      {(() => {
                        const freight = freightByCustomer.get(c.id);
                        if (!freight) return <span className="customers-muted">—</span>;
                        return (
                          <span className="customers-contact-stack">
                            <span>Thu <Money value={freight.freightRevenue} compact /></span>
                            <span>Trả <Money value={freight.freightPayable} compact /></span>
                          </span>
                        );
                      })()}
                    </td>
                    <td data-label="" className="record-table__action customers-actions-cell">
                      <div className="row-actions">
                        <button
                          className="row-action"
                          title="Sửa khách hàng"
                          aria-label={`Sửa khách hàng ${c.shortName || c.name}`}
                          onClick={(e) => { e.stopPropagation(); setEditingId(c.id); setShowAddForm(false); }}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="row-action"
                          title="Xoá khách hàng"
                          aria-label={`Xoá khách hàng ${c.shortName || c.name}`}
                          disabled={deleting === c.id}
                          onClick={(e) => { e.stopPropagation(); doDelete(c.id); }}
                        >
                          {deleting === c.id ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
                        </button>
                      </div>
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
                  <dd><span className="data-token">{c.taxCode || '—'}</span></dd>
                  <dt>Hạn mức tín dụng</dt>
                  <dd>{c.creditLimit != null ? formatCurrency(c.creditLimit) : '—'}</dd>
                  <dt>Công nợ hiện tại</dt>
                  <dd style={debt > 0 ? { color: 'var(--warning-text)' } : undefined}>
                    <Money value={debt} />
                  </dd>
                </dl>
                <dl className="customers-drawer__section">
                  <dt>Giám đốc</dt>
                  <dd>{c.accountantName || '—'}</dd>
                  <dt>Người liên hệ</dt>
                  <dd>{c.contactPerson || '—'}</dd>
                  <dt>Điện thoại</dt>
                  <dd><span className="data-token">{c.phone || '—'}</span></dd>
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
