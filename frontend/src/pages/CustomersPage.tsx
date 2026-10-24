import { useState, useEffect, useMemo, useRef } from 'react'; // useEffect remains for the form modal's reset-on-open
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Download,
  Pencil, Trash2, X, Save, Loader2, MoreHorizontal,
  Building2, Hash, Landmark, MapPin, User, Phone,
} from 'lucide-react';
import { api } from '../lib/api';
import { actionErrorMessage } from '../lib/api/action-error';
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
import { CustomerMetricsRow } from '../features/customers/CustomerHeaderMetrics';
import {
  customerDebtSummaryQuery,
  customerFreightMap,
  type CustomerDebtSummaryResponse,
} from '../features/customers/customer-debt-projection';
import { CustomerDrawerHistories } from '../features/customers/CustomerDrawerHistories';
import { useToast } from '../components/shared/Toast';
import { formatCurrency, formatDateTimeVN, titleCaseVn } from '../lib/format';
import { financialClient, type CustomerAging } from '../api/financialClient';
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

/** SIL-169 — mirrors the server's aging risk rule (aging.service.ts
 * classifyAgingRisk) so the row dot, the "Rủi ro cao" tab and the header
 * metric count agree on one definition. Rows without an aging projection
 * fall back to the ledger-balance heuristic in `riskDot`. */
type RiskLevel = 'high' | 'med' | 'low';
function classifyAgingRisk(totalOutstanding: number, aging: { over90: number; d30: number; d60: number }): RiskLevel {
  if (totalOutstanding <= 0) return 'low';
  if (aging.over90 > 0 || totalOutstanding > 100_000_000) return 'high';
  if (aging.d30 > 0 || aging.d60 > 0) return 'med';
  return 'low';
}

/** SIL-169 metric ② — customers whose last CUSTOMER ledger activity is older
 * than 30 days (they stopped transacting; a customer with no entry at all has
 * nothing to "stop", so it does not count). The sub line carries the OLDEST
 * idle-since date ("từ dd/MM"). Pure derivation over the existing ledger
 * feed — no new endpoint. */
const IDLE_WINDOW_DAYS = 30;
function idleCustomerSummary(entries: LedgerEntry[] | undefined): { count: number; since: string | null } | null {
  if (!entries) return null;
  const lastByCustomer = new Map<number, string>();
  for (const entry of entries) {
    if (entry.entityType !== 'CUSTOMER') continue;
    const prev = lastByCustomer.get(entry.entityId);
    if (!prev || entry.timestamp > prev) lastByCustomer.set(entry.entityId, entry.timestamp);
  }
  const cutoff = Date.now() - IDLE_WINDOW_DAYS * 86_400_000;
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
  // Card 20261006_391 — export feedback contract (FinancePage pattern): the
  // CSV buttons report busy/success/failure; a failed download must not die
  // as an unhandled rejection. Keyed per handler; the two exports never run
  // concurrently from one user.
  const [exporting, setExporting] = useState<'all' | 'selected' | null>(null);
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
  // Card 071026141610: the status pills need WHOLE-dataset counts. The list is
  // paginated and its envelope carries no status breakdown, so the pills used
  // to show "Tất cả" alone and left the other two with no numeral. This
  // census is scoped exactly like the list (non-carrier, live rows), so the
  // per-status numbers reconcile with `total`.
  const { data: customersStatusCounts } = useQuery({
    queryKey: qk.catalogs.customersStatusCounts,
    queryFn: () => api.get<{ all: number; active: number; locked: number }>('/customers/status-counts'),
  });
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
   *
   * Card 071026212000 (lead ruling 2026-10-08): a permission toast fires only
   * for a genuine user-initiated denial and must name the action; aborted/
   * raced requests stay silent. `action` is the action name in the toast
   * policy's "Bạn không có quyền <action>." form.
   */
  const toastMutationError = (action: string, e: unknown, fallback: string) => {
    const message = actionErrorMessage(action, e, fallback);
    if (message === null) return;
    toast({ kind: 'error', message, duration: 7000 });
  };

  const debtMap = useMemo(() => {
    return buildCustomerDebtMap(ledgerEntries ?? []);
  }, [ledgerEntries]);

  // SIL-169 — the header metrics + per-row debt/overdue/risk read the
  // EXISTING receivables-aging projection (GET /reports/receivables-aging),
  // whose roles (ADMIN/MANAGER/ACCOUNTANT) are exactly this page's audience.
  // One un-searched snapshot covers the whole catalog: `totals` feeds the
  // inline metrics and the "Rủi ro cao" tab count, the rows carry each
  // customer's outstanding balance and contractual overdue span. While the
  // projection is unavailable the metrics read '—' and rows fall back to the
  // ledger debt map — never an invented number.
  const AGING_SNAPSHOT_LIMIT = 200;
  const { data: agingSnapshot } = useQuery({
    queryKey: qk.financial.customerAging({ limit: AGING_SNAPSHOT_LIMIT }),
    queryFn: () => financialClient.getCustomerAging({ limit: AGING_SNAPSHOT_LIMIT }),
    staleTime: 2 * 60 * 1000,
  });
  const agingByCustomer = useMemo(
    () => new Map((agingSnapshot?.customers ?? []).map((row: CustomerAging) => [row.customerId, row])),
    [agingSnapshot],
  );
  const agingTotals = agingSnapshot?.totals;
  const overdueAmount = agingTotals ? agingTotals.d30 + agingTotals.d60 + agingTotals.over90 : null;
  /** One risk answer per row: the aging rule first, ledger heuristic fallback. */
  const riskOf = (c: Customer): RiskLevel => {
    const row = agingByCustomer.get(c.id);
    if (row) return classifyAgingRisk(row.totalOutstanding, row.aging);
    return riskDot(debtMap.get(c.id) ?? 0, Number(c.creditLimit || 0));
  };
  const idle30 = useMemo(() => idleCustomerSummary(ledgerEntries), [ledgerEntries]);
  /** Display fields the 7-column contract (SIL-169 verdict b) derives per row. */
  const rowDetail = (c: Customer) => {
    const aging = agingByCustomer.get(c.id);
    const debt = aging ? aging.totalOutstanding : (debtMap.get(c.id) ?? 0);
    const overdueDays = aging?.maxOverdueDays ?? 0;
    const termDays = c.paymentTermDays != null ? Number(c.paymentTermDays)
      : c.agencyFeePaymentTermDays != null ? Number(c.agencyFeePaymentTermDays) : null;
    const termTitle = c.paymentTermDays != null ? 'Hạn thanh toán cước'
      : c.agencyFeePaymentTermDays != null ? 'Hạn thanh toán chi hộ' : undefined;
    return { aging, debt, overdueDays, termDays, termTitle };
  };

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
      // SIL-169: the "Rủi ro cao" tab filters by the SAME aging rule that
      // feeds the metric count and the row dot (previously the ledger-ratio
      // heuristic — a different definition than the count it sat beside).
      if (filter === 'risk') return riskOf(c) === 'high';
      return true;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- riskOf closes over agingByCustomer/debtMap, both of which are deps below
  }), [customers, filter, debtMap, agingByCustomer]);
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
    } catch (e: unknown) { toastMutationError('tạo khách hàng', e, 'Lỗi lưu'); } finally { setSaving(false); }
  }

  async function doUpdate(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.put(`/customers/${id}`, body);
      toast({ kind: 'success', message: 'Đã cập nhật khách hàng' });
      await refetchCustomers();
      setEditingId(null);
      setMenuOpenId(null);
    } catch (e: unknown) { toastMutationError('cập nhật khách hàng', e, 'Lỗi cập nhật'); } finally { setSaving(false); }
  }

  const { confirm, dialog: confirmDialog } = useConfirm();

  async function doDelete(id: number) {
    if (!await confirm('Xóa khách hàng này?', { variant: 'danger', confirmLabel: 'Xóa' })) return;
    setDeleting(id);
    try {
      await api.delete(`/customers/${id}`);
      setMenuOpenId(null);
      await refetchCustomers();
    } catch (e: unknown) { toastMutationError('xóa khách hàng', e, 'Lỗi xóa'); } finally { setDeleting(null); }
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
      toastMutationError('khóa hoặc mở khóa khách hàng', e, 'Lỗi khóa/mở khóa');
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
      toastMutationError('gửi thông báo khách hàng', e, 'Lỗi gửi thông báo');
    } finally { setNotifySending(false); }
  }

  /** The strip's Xuất Excel action: the button is `CustomerFilters`', the data
   *  (and the toast) stay on the page that owns the filtered rows. The three
   *  freight columns come from the server projection under the same
   *  `excludeOwnFleet` filter, so the sheet matches the screen. */
  async function exportCustomers() {
    if (exporting) return;
    setExporting('all');
    try {
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
    } catch {
      toast({ kind: 'error', message: 'Chưa xuất được danh sách khách hàng — vui lòng thử lại.' });
    } finally {
      setExporting(null);
    }
  }

  /** Card _37 bulk selection bar — same export contract as the strip export. */
  async function exportSelectedCustomers() {
    if (exporting) return;
    setExporting('selected');
    try {
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
    } catch {
      toast({ kind: 'error', message: 'Chưa xuất được danh sách đã chọn — vui lòng thử lại.' });
    } finally {
      setExporting(null);
    }
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
      {/* SIL-169 verdict (a): the page header is ONE 56px line — H1 on the
          left, the three inline metrics on the right (no card boxes, no
          88px KPI row, ~150px handed back to the table). The concentration
          signal (card 20260926_60) rides the same line as a compact warning
          chip with its popover — it is metric-family information, and moving
          it here is what keeps the toolbar to a single 44px row below. */}
      <PageHeader
        title="Khách hàng & Đối tác"
        onBack={() => navigate('/dashboard')}
        action={(
          <CustomerMetricsRow
            data={{
              overdueAmount,
              overdueCount: agingTotals?.overdueCount ?? null,
              idleCount: idle30?.count ?? null,
              idleSince: idle30?.since ?? null,
              riskCount: agingTotals?.highRiskCount ?? null,
            }}
            extra={concentration.anyDebt && (
              <div className="customers-strip__risk" tabIndex={0}>
                <span aria-hidden="true">⚠️</span> Top 4 KH chiếm {concentration.topShare}% công nợ
                <div className="customers-strip__risk-pop" role="tooltip">
                  <strong>Công nợ tập trung — top 4 khách hàng</strong>
                  {concentration.top.map((row) => (
                    <div key={row.id} className="customers-strip__risk-row">
                      <span>{row.name}</span>
                      <span className="customers-strip__risk-share">{row.share}% · {formatCurrency(row.debt)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          />
        )}
      />
      <CustomerFilters
        search={search}
        onSearch={setSearch}
        searchInputRef={searchInputRef}
        filter={filter}
        onFilter={setFilter}
        total={total}
        statusCounts={customersStatusCounts}
        riskCount={agingTotals?.highRiskCount}
        onExport={exportCustomers}
        exporting={exporting === 'all'}
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
            />
          ) : (
            filtered.map(c => {
              const { debt, overdueDays, termDays } = rowDetail(c);
              const addr = c.address || c.contactInfo;
              return (
              /* SIL-169 verdict (d): the mobile card is the same 7-column
                 contract stacked — dot + title-case name + chip header, a
                 label/value grid body, and the debt footer that goes red when
                 the aging projection says overdue. */
              <ClickableCard key={c.id} className="m-card cus-m-card" style={{ position: 'relative' }} onClick={() => navigate(`/customers/${c.id}`)}>
                <StatusStrip status={c.status} />
                <div className="cus-m-card__head">
                  <span className="cus-m-card__title">
                    <span className={`cus-dot cus-dot--${riskOf(c)}`} aria-hidden="true" />
                    {titleCaseVn(c.name)}
                    {c.shortName && c.shortName !== c.name && <span className="cus-chip">{c.shortName}</span>}
                    {c.linkedSupplierId && <Badge variant="success">2 chiều</Badge>}
                  </span>
                  <span className="cus-m-card__head-right">
                    <StatusPill variant={c.status === CustomerStatus.ACTIVE ? 'success' : 'danger'}>
                      {STATUS_LABELS[c.status] || c.status}
                    </StatusPill>
                    <button
                      type="button"
                      className="row-action"
                      aria-label={`Thao tác với ${c.shortName || c.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === c.id}
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                    >
                      <MoreHorizontal size={16} />
                    </button>
                  </span>
                </div>
                <div className="cus-m-card__grid">
                  {c.taxCode && (
                    <span className="cus-m-card__row"><span className="cus-m-card__label">MST</span><span className="data-token">{c.taxCode}</span></span>
                  )}
                  {addr && (
                    <span className="cus-m-card__row"><span className="cus-m-card__label">Địa chỉ</span><span className="cus-m-card__addr" title={addr}>{addr}</span></span>
                  )}
                  <span className="cus-m-card__row">
                    <span className="cus-m-card__label">Liên hệ</span>
                    <span className="cus-m-card__contact">
                      {c.contactPerson || '—'}{c.phone && <> · <span className="data-token">{c.phone}</span></>}
                      {(c.accountantName || c.accountantPhone) && (
                        <span className="cus-m-card__contact-sub">{[c.accountantName, c.accountantPhone].filter(Boolean).join(' · ')}</span>
                      )}
                    </span>
                  </span>
                  {termDays != null && (
                    <span className="cus-m-card__row"><span className="cus-m-card__label">Hạn TT</span><span className="cus-chip">{termDays} ngày</span></span>
                  )}
                </div>
                <div className="cus-m-card__foot">
                  <span className="cus-m-card__label">Công nợ</span>
                  <span className="cus-m-card__debt" data-overdue={overdueDays > 0 || undefined}>
                    <Money value={debt} compact />
                    {overdueDays > 0 && <span className="cus-debt-sub">quá hạn {overdueDays} ngày</span>}
                  </span>
                </div>
                {menuOpenId === c.id && (
                  <div className="cus-kebab-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                    <button type="button" role="menuitem" aria-label={`Sửa khách hàng ${c.shortName || c.name}`}
                      onClick={() => { setMenuOpenId(null); setEditingId(c.id); setShowAddForm(false); }}>
                      <Pencil size={13} /> Sửa
                    </button>
                    <button type="button" role="menuitem" className="cus-kebab-menu__danger" aria-label={`Xoá khách hàng ${c.shortName || c.name}`}
                      disabled={deleting === c.id}
                      onClick={() => { setMenuOpenId(null); void doDelete(c.id); }}>
                      {deleting === c.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
                    </button>
                  </div>
                )}
              </ClickableCard>
              );
            })
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
            onClick={() => void exportSelectedCustomers()}
            disabled={exporting !== null}
          >
            <Download size={14} /> {exporting === 'selected' ? 'Đang xuất…' : 'Xuất CSV đã chọn'}
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

      {/* ── Desktop table (≥641px per the SIL-169 verdict: cards are the
             <640 face) ─────────────────────────────────────────────────── */}
      <div className="desktop-only table-wrap">
        <div className="record-table-wrap">
          <table className="record-table ops-table cus-table" style={{ tableLayout: 'fixed' }}>
              {/* SIL-169 verdict (b): 9 visual columns collapsed to the 7 that
                  carry information — identity (dot + title-case name + chip +
                  code sub-line), MST, address, one merged contact column (both
                  contact lines), payment term, debt with the overdue signal,
                  and a single 32px kebab. Widths are the verdict's own budget
                  (260/110/180/180/96/120/32 ≈ 978px inside the 1008px content
                  box at 1280). Sort stays server-side on the endpoint's
                  whitelist keys (name, taxCode). */}
              <colgroup>
                <col style={{ width: 260 }} />
                <col style={{ width: 110 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 180 }} />
                <col style={{ width: 96 }} />
                <col style={{ width: 120 }} />
                {/* The kebab column rides a CSS class, not an inline width:
                    32px at fine pointers (the verdict's budget) and the
                    coarse-pointer floor when a touch hand needs the button —
                    an inline col width cannot answer a media query. */}
                <col className="cus-col-action" />
              </colgroup>
              <thead>
                <tr>
                  <SortHeader label="Khách hàng" sortKey="name" sort={sort} onSortChange={applySort} />
                  <SortHeader label="MST" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                  <th>Địa chỉ</th>
                  <th>Liên hệ</th>
                  <th>Hạn thanh toán</th>
                  <th className="cus-th-debt">Công nợ</th>
                  <th><span className="sr-only">Thao tác</span></th>
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
              {filtered.map((c, index) => {
                const { aging, debt, overdueDays, termDays, termTitle } = rowDetail(c);
                const addr = c.address || c.contactInfo;
                return (
                  <tr
                    key={c.id}
                    tabIndex={0}
                    data-selected={selected.has(c.id) || undefined}
                    aria-selected={selected.has(c.id)}
                    className="customers-row"
                    {...rowProps(c.id)}
                  >
                    {/* Card 20260929_207 (PM decision): the row is the selection
                        control, so opening the customer moved to the name — the
                        cell that carries its identity. The dot + chip + code
                        sub-line join it under the SIL-169 identity column. */}
                    <td data-label="Khách hàng">
                      <button
                        type="button"
                        className="customers-name-open"
                        aria-label={`Mở hồ sơ ${c.name}`}
                        onClick={() => openCustomerDrawer(c.id)}
                      >
                        <span className="cus-id">
                          <span className={`cus-dot cus-dot--${riskOf(c)}`} aria-hidden="true" />
                          <span className="customers-name-cell">{titleCaseVn(c.name)}</span>
                          {c.shortName && c.shortName !== c.name && <span className="cus-chip">{c.shortName}</span>}
                          {c.status === CustomerStatus.LOCKED && <span className="cus-chip cus-chip--locked">Tạm khoá</span>}
                        </span>
                        {c.code && <span className="cus-code-sub">{c.code}</span>}
                      </button>
                    </td>
                    <td data-label="Mã số thuế" className="customers-mono-cell">
                      <span className="data-token">{c.taxCode || <span className="customers-muted">—</span>}</span>
                    </td>
                    {/* Address is the one datum the verdict explicitly budgets
                        as a single ellipsized line — the full value rides the
                        title tooltip and the row drawer, so nothing is lost. */}
                    <td data-label="Địa chỉ" className="cus-addr-cell" title={addr || undefined}>
                      {addr || <span className="customers-muted">—</span>}
                    </td>
                    <td data-label="Liên hệ">
                      <span className="customers-contact-stack">
                        <span className="cus-contact-main">
                          {c.contactPerson || '—'}
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
                        </span>
                        {(c.accountantName || c.accountantPhone) && (
                          <span className="cus-contact-sub">{[c.accountantName, c.accountantPhone].filter(Boolean).join(' · ')}</span>
                        )}
                      </span>
                    </td>
                    <td data-label="Hạn thanh toán" className="cus-term-cell" title={termTitle ?? undefined}>
                      {termDays != null
                        ? <>{termDays} <span className="cus-term-unit">ngày</span></>
                        : <span className="customers-muted">—</span>}
                    </td>
                    <td
                      data-label="Công nợ"
                      className="cus-debt-cell"
                      title={aging ? undefined : 'Công nợ theo sổ cái (chưa có dữ liệu quá hạn)'}
                    >
                      <span className="customers-contact-stack">
                        <Money value={debt} compact />
                        {overdueDays > 0 && <span className="cus-debt-sub">quá hạn {overdueDays} ngày</span>}
                      </span>
                    </td>
                    <td
                      data-label=""
                      className="record-table__action customers-actions-cell"
                      style={{ position: 'relative' }}
                    >
                      <div className="row-actions">
                        <button
                          className="row-action"
                          title="Thao tác"
                          aria-label={`Thao tác với ${c.shortName || c.name}`}
                          aria-haspopup="menu"
                          aria-expanded={menuOpenId === c.id}
                          onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === c.id ? null : c.id); }}
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                      {menuOpenId === c.id && (
                        <div
                          role="menu"
                          className={`cus-kebab-menu${index >= filtered.length - 2 && filtered.length > 2 ? ' cus-kebab-menu--up' : ''}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button type="button" role="menuitem" aria-label={`Sửa khách hàng ${c.shortName || c.name}`}
                            onClick={() => { setMenuOpenId(null); setEditingId(c.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button type="button" role="menuitem" className="cus-kebab-menu__danger" aria-label={`Xoá khách hàng ${c.shortName || c.name}`}
                            disabled={deleting === c.id}
                            onClick={() => { setMenuOpenId(null); void doDelete(c.id); }}>
                            {deleting === c.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
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

        <Pagination page={page} totalPages={totalPages} totalItems={total} pageSize={pageSize} onChange={setPage} />
      </div>

      {/* SIL-169 verdict (d): on the mobile face the primary add action is a
          fixed 48px FAB, not a toolbar button fighting the full-width search. */}
      <button
        type="button"
        className="cus-fab"
        aria-label="Thêm khách hàng"
        onClick={() => { setShowAddForm(true); setEditingId(null); }}
      >
        <Plus size={20} />
      </button>

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
        const detail = rowDetail(c);
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
                  <dt>Địa chỉ</dt>
                  <dd>{c.address || c.contactInfo || '—'}</dd>
                  <dt>Hạn mức tín dụng</dt>
                  <dd>{c.creditLimit != null ? formatCurrency(c.creditLimit) : '—'}</dd>
                  <dt>Hạn thanh toán</dt>
                  <dd>{detail.termDays != null ? `${detail.termDays} ngày` : '—'}</dd>
                  <dt>Công nợ hiện tại</dt>
                  <dd style={detail.overdueDays > 0 ? { color: 'var(--overdue-text)' } : undefined}>
                    <Money value={detail.debt} />
                    {detail.overdueDays > 0 && <span className="cus-debt-sub">quá hạn {detail.overdueDays} ngày</span>}
                  </dd>
                  {/* FB-007 carry-over (card 061026172805): the last-updated
                      value moved here when the SIL-169 verdict retired the
                      Cập nhật column — the datum stays on the surface. */}
                  <dt>Cập nhật</dt>
                  <dd>{formatDateTimeVN(c.updatedAt)}</dd>
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
