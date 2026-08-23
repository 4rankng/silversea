import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, Plus, Download, Search,
  MoreHorizontal, Pencil, Trash2, X, Save, Loader2,
} from 'lucide-react';
import { useConfirm } from '../components/UI';
import { api } from '../lib/api';
import { labelStyle } from '../utils/formStyles';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, KPI, StatusPill, Modal } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { EmptyState, Pagination, UuiSelectField, useTableQueryState } from '../design-system';
import type { Supplier, Customer } from '@tingting/shared';
import { CONFIG, SUPPLIER_TYPES, SUPPLIER_TYPE_LABELS } from '@tingting/shared';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { useCatalogs } from '../hooks/useCatalogs';
import { usePayablesSummary } from '../hooks/useFinancialQueries';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Money } from '../components/shared/Money';
import { StatusStrip, StatusDot } from '../components/shared/StatusStrip';
import { usePageAnimations } from '../hooks/animations';
import { resolveEmptyIllustration } from '../lib/emptyIllustrations';
import '../styles/operational-table-typography.css';
import '../styles/record-table.css';
import './SupplierListPage.css';

type FilterKey = 'all' | 'active' | 'inactive';

/** Sort keys mirror the backend /suppliers sortBy whitelist (server-side sort). */
type SupplierTableFilters = {
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
};

/** Numeric header cells right-align to match the .num body cells. Every other
 * header property (padding, background, case, tracking, sticky pinning) is the
 * shared record-table base. */
const thMoneyStyle: CSSProperties = { textAlign: 'right' };

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Hoạt động',
  INACTIVE: 'Ngừng hoạt động',
};

export function SupplierFormModal({ item, saving, onsave, oncancel, isOpen, customers }: {
  item?: Supplier; saving: boolean; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean; customers: Customer[];
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [note, setNote] = useState(item?.note || '');
  const [status, setStatus] = useState<string>(item?.status || 'ACTIVE');
  const [linkedCustomerId, setLinkedCustomerId] = useState<number | null>(item?.linkedCustomerId ?? null);
  const [types, setTypes] = useState<string[]>(item?.types ?? []);
  const [primaryType, setPrimaryType] = useState<string>(item?.primaryType ?? '');
  const [chiHoDueDays, setChiHoDueDays] = useState<string>(item?.chiHoDueDays != null ? String(item.chiHoDueDays) : '');
  const [cuocDueDays, setCuocDueDays] = useState<string>(item?.cuocDueDays != null ? String(item.cuocDueDays) : '');

  useEffect(() => {
    if (isOpen) {
      setName(item?.name || '');
      setShortName(item?.shortName || '');
      setContactPerson(item?.contactPerson || '');
      setPhone(item?.phone || '');
      setTaxCode(item?.taxCode || '');
      setNote(item?.note || '');
      setStatus(item?.status || 'ACTIVE');
      setLinkedCustomerId(item?.linkedCustomerId ?? null);
      setTypes(item?.types ?? []);
      setPrimaryType(item?.primaryType ?? '');
      setChiHoDueDays(item?.chiHoDueDays != null ? String(item.chiHoDueDays) : '');
      setCuocDueDays(item?.cuocDueDays != null ? String(item.cuocDueDays) : '');
    }
    // Reset form fields only when the modal opens or switches item; field-level
    // deps intentionally omitted to avoid clobbering in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, item?.id]);

  const handleSave = () => {
    if (!name.trim()) return;
    onsave({
      name: name.trim(),
      shortName: shortName.trim() || name.trim(),
      contactPerson: contactPerson.trim() || undefined,
      phone: phone.trim() || undefined,
      taxCode: taxCode.trim() || undefined,
      note: note.trim() || undefined,
      status,
      linkedCustomerId: linkedCustomerId ?? null,
      types,
      primaryType: primaryType || null,
      chiHoDueDays: chiHoDueDays.trim() === '' ? null : Number(chiHoDueDays),
      cuocDueDays: cuocDueDays.trim() === '' ? null : Number(cuocDueDays),
    });
  };

  const toggleType = (type: string) => {
    setTypes((current) => {
      const next = current.includes(type)
        ? current.filter((itemType) => itemType !== type)
        : [...current, type];
      if (primaryType && !next.includes(primaryType)) {
        setPrimaryType('');
      }
      return next;
    });
  };
  return (
    <Modal
      isOpen={isOpen}
      title={item ? `Sửa nhà cung cấp — ${item.name}` : 'Thêm nhà cung cấp'}
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={960}
      footer={
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={oncancel}>
            <X size={14} /> Hủy
          </button>
          <button type="button" className="btn btn--primary btn--sm" disabled={saving || !name.trim()} onClick={handleSave}>
            {saving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
            {item ? 'Cập nhật' : 'Thêm nhà cung cấp'}
          </button>
        </>
      }
    >
      <div className="supplier-form">
        <div className="supplier-form__profile">
          <div className="field">
            <label htmlFor="supp-name" style={labelStyle}>
              Tên nhà cung cấp <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input id="supp-name" className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Ví dụ: Garage Auto 123" autoFocus />
          </div>
          <div className="field">
            <label htmlFor="supp-short-name" style={labelStyle}>
              Tên ngắn (mã nội bộ)
            </label>
            <input
              id="supp-short-name"
              className="input"
              value={shortName}
              onChange={e => setShortName(e.target.value)}
              placeholder="Để trống sẽ dùng tên đầy đủ"
            />
          </div>
          <div className="field">
            <label htmlFor="supp-tax" style={labelStyle}>Mã số thuế</label>
            <input id="supp-tax" className="input" value={taxCode} onChange={e => setTaxCode(e.target.value)} placeholder="Ví dụ: 0312…" />
          </div>
          <UuiSelectField
            id="supp-status"
            label="Trạng thái"
            value={status}
            onChange={e => setStatus(e.target.value)}
            options={Object.entries(STATUS_LABELS).map(([k, v]) => ({ value: k, label: v }))}
            wrapperClassName="field"
          />
          <div className="field">
            <label htmlFor="supp-contact" style={labelStyle}>Người liên hệ</label>
            <input id="supp-contact" className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Ví dụ: Anh Tuấn · Kế toán" />
          </div>
          <div className="field">
            <label htmlFor="supp-phone" style={labelStyle}>Điện thoại</label>
            <input id="supp-phone" className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="Ví dụ: 0912…" />
          </div>
          <UuiSelectField
            id="supp-linked-customer"
            label="Khách hàng liên quan"
            value={linkedCustomerId === null || linkedCustomerId === undefined ? '' : String(linkedCustomerId)}
            onChange={e => setLinkedCustomerId(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: '', label: '-- Không liên kết --' }, ...customers.map(c => ({ value: String(c.id), label: c.name }))]}
            wrapperClassName="field"
          />
        </div>
        <div className="supplier-form__services field">
          <label style={labelStyle}>Nhóm dịch vụ</label>
          <div className="supplier-form__service-grid">
            {SUPPLIER_TYPES.map((type) => (
              <label
                key={type}
                className="supplier-form__service-option"
              >
                <input
                  type="checkbox"
                  checked={types.includes(type)}
                  onChange={() => toggleType(type)}
                />
                <span>{SUPPLIER_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
        </div>
        <div className="supplier-form__terms">
          <div className="field">
            <label htmlFor="supp-chiho-due" style={labelStyle}>Hạn thanh toán Chi hộ (ngày)</label>
            <input
              id="supp-chiho-due"
              className="input"
              type="number"
              min={0}
              max={365}
              value={chiHoDueDays}
              onChange={e => setChiHoDueDays(e.target.value)}
              placeholder="Ví dụ: 15"
            />
          </div>
          <div className="field">
            <label htmlFor="supp-cuoc-due" style={labelStyle}>Hạn thanh toán Cước (ngày)</label>
            <input
              id="supp-cuoc-due"
              className="input"
              type="number"
              min={0}
              max={365}
              value={cuocDueDays}
              onChange={e => setCuocDueDays(e.target.value)}
              placeholder="Ví dụ: 30"
            />
          </div>
          <UuiSelectField
            id="supp-primary-type"
            label="Nhóm chính cho báo cáo"
            value={primaryType}
            onChange={(e) => setPrimaryType(e.target.value)}
            disabled={types.length === 0}
            options={[{ value: '', label: '-- Không chọn nhóm chính --' }, ...types.map((type) => ({ value: type, label: SUPPLIER_TYPE_LABELS[type as keyof typeof SUPPLIER_TYPE_LABELS] }))]}
            hint="Nhóm chính chỉ dùng cho mặc định và báo cáo; từng khoản chi vẫn giữ đúng nhóm thực tế."
            wrapperClassName="field"
          />
          <div className="field">
            <label htmlFor="supp-note" style={labelStyle}>Ghi chú</label>
            <textarea id="supp-note" className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Ghi chú thêm…" />
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default function SupplierListPage() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<FilterKey>('all');

  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<number | null>(null);
  const [menuOpenId, setMenuOpenId] = useState<number | null>(null);

  const { confirm, dialog: confirmDialog } = useConfirm();

  const table = useTableQueryState<Supplier, SupplierTableFilters>({
    endpoint: (params) => configClient.getSuppliers(
      params.page ?? 1,
      params.search ?? '',
      readTableSort(params.sortBy, params.sortDir),
    ),
    queryKey: qk.catalogs.suppliersTable,
    defaultPageSize: 10,
    debounceMs: 300,
  });
  const { page, setPage, pageSize, search, setSearch, rows: suppliers, total, isLoading: loading, error: queryError, setFilter: setSortFilter } = table;
  const refetchSuppliers = table.query.refetch;
  const { rootRef } = usePageAnimations({ ready: !loading });

  // Server-side sorting: the sort pair rides the filters bag so setFilter's
  // built-in page reset applies (page 1 whenever the sort changes).
  const sort = readTableSort(table.filters.sortBy, table.filters.sortDir);
  const applySort = (key: string) => {
    const next = nextTableSort(sort, key);
    setSortFilter('sortBy', next.by);
    setSortFilter('sortDir', next.dir);
  };

  // AP outstanding per supplier — fetched once from the payables summary.
  // Each PayableSummary item exposes a nested `supplier.id` + `totalOutstanding`.
  const { data: payablesData } = usePayablesSummary();
  const payableBySupplier = useMemo(() => {
    const map = new Map<number, number>();
    for (const item of payablesData?.items ?? []) {
      map.set(item.supplier.id, item.totalOutstanding);
    }
    return map;
  }, [payablesData]);
  // Use the bootstrap catalog for the full active-customer list (not the
  // paginated /customers endpoint which only returns page 1 by default).
  const { data: catalogData } = useCatalogs();
  const allCustomers = useMemo(() => catalogData?.customers ?? [], [catalogData]);
  const customerLookup = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of allCustomers) map.set(c.id, c.name);
    return map;
  }, [allCustomers]);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const error = queryError ? 'Không thể tải dữ liệu' : mutationError;

  const { activeCount, inactiveCount, filtered } = useMemo(() => {
    const activeCount = suppliers.filter(s => s.status === 'ACTIVE').length;
    const inactiveCount = suppliers.filter(s => s.status !== 'ACTIVE').length;
    const filtered = suppliers.filter(s => {
      if (filter === 'active') return s.status === 'ACTIVE';
      if (filter === 'inactive') return s.status !== 'ACTIVE';
      return true;
    });
    return { activeCount, inactiveCount, filtered };
  }, [suppliers, filter]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  async function doCreate(body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.post(CONFIG.SUPPLIERS, body);
      setShowAddForm(false);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi lưu'); } finally { setSaving(false); }
  }

  async function doUpdate(id: number, body: Record<string, unknown>) {
    setSaving(true);
    try {
      await api.put(CONFIG.SUPPLIER(id), body);
      setEditingId(null);
      setMenuOpenId(null);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi cập nhật'); } finally { setSaving(false); }
  }

  async function doDelete(id: number) {
    if (!await confirm('Bạn có chắc chắn muốn xóa?', { variant: 'danger' })) return;
    setDeleting(id);
    try {
      await api.delete(CONFIG.SUPPLIER(id));
      setMenuOpenId(null);
      await refetchSuppliers();
    } catch (e: unknown) { setMutationError(e instanceof Error ? e.message : 'Lỗi xóa'); } finally { setDeleting(null); }
  }

  return (
    <div ref={rootRef} className="suppliers-page">
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } .spin { animation: spin 0.8s linear infinite; }`}</style>

      <Breadcrumbs
        className="suppliers-page__crumbs"
        items={[
          { label: 'Tổng quan', to: '/dashboard' },
          { label: 'Nhà cung cấp' },
        ]}
      />
      <PageHeader
        title="Nhà cung cấp"
        iconName="supplier"
        description={`${total} nhà cung cấp đang quản lý`}
        action={
          <>
            <button className="btn btn--secondary" onClick={async () => {
              const headers = ['Tên NCC', 'Người liên hệ', 'Điện thoại', 'MST', 'Là nhà CC nhiên liệu', 'Trạng thái'];
              const rows = filtered.map(s => [
                s.name,
                s.contactPerson || '',
                s.phone || '',
                s.taxCode || '',
                s.isFuelSupplier ? 'Có' : 'Không',
                STATUS_LABELS[s.status] || s.status,
              ]);
              await downloadCSV(`nha-cung-cap-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows, {
                title: 'DANH SÁCH NHÀ CUNG CẤP',
                subtitle: `${filtered.length} nhà cung cấp đang quản lý`,
                columnTypes: ['text', 'text', 'text', 'text', 'text', 'text'],
                hideTotals: true,
              });
            }}>
              <Download size={14} /> Xuất Excel
            </button>
            <button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}>
              <Plus size={14} /> Thêm nhà cung cấp
            </button>
          </>
        }
      />

      <div className="kpi-grid">
        <KPI
          label="Tổng nhà cung cấp"
          value={total}
          icon={Users}
          assetIconName="supplier"
          meta={<span>{total} nhà cung cấp</span>}
        />
        <KPI
          label="Đang hoạt động"
          value={`${activeCount}`}
          unit={`/ ${total}`}
          variant="success"
          icon={UserCheck}
          assetIconName="active-supplier"
          meta={total > 0 ? `${activeCount}/${total} đang hoạt động` : ''}
        />
      </div>

      <div className="filter-bar">
        <button className={`filter-tab${filter === 'all' ? ' is-active' : ''}`} onClick={() => setFilter('all')}>Tất cả · {total}</button>
        <button className={`filter-tab${filter === 'active' ? ' is-active' : ''}`} onClick={() => setFilter('active')}>
          <StatusDot status="ACTIVE" style={{ marginRight: 4 }} />
          Hoạt động · {activeCount}
        </button>
        <button className={`filter-tab${filter === 'inactive' ? ' is-active' : ''}`} onClick={() => setFilter('inactive')}>
          <StatusDot status="INACTIVE" style={{ marginRight: 4 }} />
          Ngừng HĐ · {inactiveCount}
        </button>
        <div className="filter-bar__spacer" />
        <div className="filter-bar__search">
          <Search size={14} />
          <input
            type="text"
            name="supplierSearch"
            aria-label="Tìm nhà cung cấp theo tên"
            placeholder="Tìm theo tên…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="mobile-only mobile-table-wrap">
        <div className="m-card-list">
          {loading ? (
            <div style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--ink-3)' }}>Đang tải…</div>
          ) : filtered.length === 0 ? (
            <EmptyState
              illustration="/assets/illustrations/empty-clients.svg"
              title="Chưa có nhà cung cấp"
              description="Thêm nhà cung cấp đầu tiên để bắt đầu quản lý chi phí."
              action={<button className="btn btn--primary" onClick={() => { setShowAddForm(true); setEditingId(null); }}><Plus size={14} /> Thêm nhà cung cấp</button>}
            />
          ) : (
            filtered.map(s => (
              <ClickableCard key={s.id} className="m-card" style={{ position: 'relative' }} onClick={() => navigate(`/suppliers/${s.id}`)}>
                <StatusStrip status={s.status} />
                <div className="m-card__top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <span className="m-card__title">{s.shortName || s.name}</span>
                    {s.isFuelSupplier && (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--brand, #10B981)', background: 'var(--brand-soft, #E6FBF3)', border: '1px solid var(--brand-border, #A7F3D0)', borderRadius: 4, padding: '1px 5px' }}>
                        Nhiên liệu
                      </span>
                    )}
                  </div>
                  <StatusPill variant={s.status === 'ACTIVE' ? 'success' : 'danger'}>
                    {STATUS_LABELS[s.status] || s.status}
                  </StatusPill>
                </div>
                {s.contactPerson && (
                  <div className="m-card__meta">
                    {s.contactPerson}
                    {s.phone && <><span className="m-card__meta-sep">·</span>{s.phone}</>}
                  </div>
                )}
                <div className="m-card__meta" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>Công nợ</span>
                  <Money value={payableBySupplier.get(s.id) ?? 0} />
                </div>
                {s.taxCode && (
                  <div className="m-card__meta" style={{ fontFamily: 'var(--font-data)' }}>
                    MST {s.taxCode}
                  </div>
                )}
                <div className="m-card-edit-row">
                  <button className="btn btn--ghost btn--sm" onClick={(e) => { e.stopPropagation(); setEditingId(s.id); setShowAddForm(false); }}>
                    Sửa
                  </button>
                </div>
              </ClickableCard>
            ))
          )}
        </div>
        <div className="table-foot">
          <span>Hiển thị <strong style={{ fontFamily: 'var(--font-data)' }}>{filtered.length}</strong> nhà cung cấp</span>
        </div>
      </div>

      <div className="desktop-only table-wrap suppliers-page__workspace">
        <div className="record-table-wrap suppliers-page__grid-wrapper">
          <table className="record-table ops-table suppliers-page__grid">
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '15%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '13%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="Tên" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="SĐT" sortKey="phone" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã số thuế" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                <SortHeader label="KH liên kết" sortKey="linkedCustomer" sort={sort} onSortChange={applySort} />
                <SortHeader label="Công nợ" sortKey="payable" sort={sort} onSortChange={applySort} style={thMoneyStyle} />
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 13 }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchSuppliers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <img src={resolveEmptyIllustration('empty-clients')} alt="" aria-hidden="true" style={{ width: 140, height: 116, objectFit: 'contain', margin: '0 auto 8px', display: 'block' }} onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }} />
                  <div>Chưa có dữ liệu</div>
                </td></tr>
              )}
              {filtered.map((s, index) => (
                  <tr key={s.id} role="button" tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/suppliers/${s.id}`)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/suppliers/${s.id}`); } }}
                  >
                    <td className="suppliers-page__cell suppliers-page__cell--name" data-label="Tên" style={{ position: 'relative' }}>
                      <StatusStrip status={s.status} />
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, width: '100%', minWidth: 0, flexWrap: 'wrap' }}>
                        <span style={{ wordBreak: 'break-word', whiteSpace: 'normal', minWidth: 0 }}>
                          {s.shortName || s.name}
                        </span>
                        {s.isFuelSupplier && (
                          <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 700, color: 'var(--brand, #10B981)', background: 'var(--brand-soft, #E6FBF3)', border: '1px solid var(--brand-border, #A7F3D0)', borderRadius: 4, padding: '1px 5px', marginTop: 1 }}>
                            Nhiên liệu
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="suppliers-page__cell" data-label="Người liên hệ">
                      {s.contactPerson || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="SĐT">
                      {s.phone || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="Mã số thuế">
                      {s.taxCode || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--linked" data-label="KH liên kết">
                      {s.linkedCustomerId ? (
                        <span style={{ fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '100%' }}>
                          <span style={{ flexShrink: 0, color: '#16a34a', fontWeight: 700, background: '#dcfce7', border: '1px solid #bbf7d0', borderRadius: 4, padding: '1px 5px', letterSpacing: '0.02em', fontSize: 12 }}>2 chiều</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {customerLookup.get(s.linkedCustomerId) ?? 'Khách hàng không còn trong danh mục'}
                          </span>
                        </span>
                      ) : (
                        <span style={{ color: 'var(--ink-3)' }}>—</span>
                      )}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data suppliers-page__cell--money num" data-label="Công nợ">
                      <Money value={payableBySupplier.get(s.id) ?? 0} />
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--actions record-table__action" data-label="" style={{ position: 'relative' }}>
                      <div className="row-actions">
                        <button className="row-action" onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.id ? null : s.id); }}>
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                      {menuOpenId === s.id && (
                        <div style={{
                          position: 'absolute', right: 12, zIndex: 20,
                          background: '#fff', border: '1px solid var(--line)', borderRadius: 8,
                          boxShadow: '0 4px 14px rgba(10,10,10,0.06)', overflow: 'hidden', minWidth: 140,
                          ...(index >= filtered.length - 2 && filtered.length > 2
                            ? { bottom: '100%', marginBottom: 4 }
                            : { top: '100%' }),
                        }} onClick={(e) => e.stopPropagation()}>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                            onClick={() => { setEditingId(s.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 12.5, border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
                            disabled={deleting === s.id}
                            onClick={() => doDelete(s.id)}>
                            {deleting === s.id ? <Loader2 size={13} className="spin" /> : <Trash2 size={13} />} Xoá
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

      <SupplierFormModal
        key={editingId ?? (showAddForm ? 'add' : 'closed')}
        isOpen={showAddForm || editingId != null}
        saving={saving}
        item={editingId != null ? suppliers.find(s => s.id === editingId) : undefined}
        customers={allCustomers as unknown as Customer[]}
        onsave={d => {
          if (editingId != null) doUpdate(editingId, d);
          else doCreate(d);
        }}
        oncancel={() => { setEditingId(null); setShowAddForm(false); }}
      />
    {confirmDialog}
    </div>
  );
}
