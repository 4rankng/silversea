import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserCheck, Plus, Download, Search,
  MoreHorizontal, Pencil, Trash2, X, Save, Loader2,
  Building2, Hash, User, Phone, Landmark, Clock, FileText,
} from 'lucide-react';
import { useConfirm } from '../components/UI';
import { api } from '../lib/api';
import { Input } from '../components/untitled-ui/base/input/input';
import { TextArea } from '../components/untitled-ui/base/textarea/textarea';
import { EntityFormSection, UnitInput, RequiredHint } from '../components/shared/EntityFormParts';
import { downloadCSV } from '../lib/csv';
import { nextTableSort, readTableSort } from '../lib/table-sort';
import { SortHeader } from '../components/shared/SortHeader';
import { PageHeader, KPI, StatusPill, Modal, ModalChip, ModalChipLive } from '../components/UI';
import { Breadcrumbs } from '../components/shared/Breadcrumbs';
import { useDropdownDismiss } from '../hooks/useDropdownDismiss';
import { EmptyState, Pagination, useTableQueryState } from '../design-system';
import type { Supplier } from '@tingting/shared';
import { CONFIG } from '@tingting/shared';
import { configClient } from '../api/configClient';
import { qk } from '../api/keys';
import { usePayablesSummary } from '../hooks/useFinancialQueries';
import { ClickableCard } from '../components/shared/ClickableCard';
import { Money } from '../components/shared/Money';
import { StatusStrip, StatusDot } from '../components/shared/StatusStrip';
import { usePageAnimations } from '../hooks/animations';
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

export function SupplierFormModal({ item, saving, onsave, oncancel, isOpen }: {
  item?: Supplier; saving: boolean; onsave: (d: Record<string, unknown>) => void; oncancel: () => void; isOpen: boolean;
}) {
  const [name, setName] = useState(item?.name || '');
  const [shortName, setShortName] = useState(item?.shortName || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [note, setNote] = useState(item?.note || '');
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
      setChiHoDueDays(item?.chiHoDueDays != null ? String(item.chiHoDueDays) : '');
      setCuocDueDays(item?.cuocDueDays != null ? String(item.cuocDueDays) : '');
    }
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
      chiHoDueDays: chiHoDueDays.trim() === '' ? null : Number(chiHoDueDays),
      cuocDueDays: cuocDueDays.trim() === '' ? null : Number(cuocDueDays),
    });
  };

  return (
    <Modal
      isOpen={isOpen}
      title={item ? item.name : 'Thêm nhà cung cấp'}
      subtitle={item ? 'Sửa nhà cung cấp' : undefined}
      polished
      ariaLabel={item ? `Sửa nhà cung cấp — ${item.name}` : 'Thêm nhà cung cấp'}
      headerRight={
        !item ? undefined : item.status === 'ACTIVE'
          ? <ModalChipLive>Đang hoạt động</ModalChipLive>
          : <ModalChip>Ngừng hoạt động</ModalChip>
      }
      onClose={oncancel}
      onConfirm={handleSave}
      maxWidth={960}
      footer={
        <>
          <RequiredHint />
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
      <div className="flex flex-col gap-4">
        <EntityFormSection icon={Building2} label="Thông tin nhà cung cấp">
          <Input
            size="sm"
            label="Tên nhà cung cấp"
            isRequired
            icon={Building2}
            value={name}
            onChange={setName}
            placeholder="Ví dụ: Garage Auto 123"
            autoFocus
          />
          <Input
            size="sm"
            label="Tên viết tắt"
            icon={Hash}
            value={shortName}
            onChange={setShortName}
            placeholder="Để trống sẽ dùng tên đầy đủ"
          />
          <Input
            size="sm"
            label="Mã số thuế"
            icon={Landmark}
            value={taxCode}
            maxLength={20}
            onChange={setTaxCode}
            placeholder="Ví dụ: 0312…"
            inputClassName="tabular-nums"
          />
          <Input
            size="sm"
            label="Người liên hệ"
            icon={User}
            value={contactPerson}
            onChange={setContactPerson}
            placeholder="Ví dụ: Anh Tuấn · Kế toán"
          />
          <Input
            size="sm"
            label="Điện thoại"
            icon={Phone}
            value={phone}
            onChange={setPhone}
            placeholder="Ví dụ: 0912…"
            inputClassName="tabular-nums"
          />
        </EntityFormSection>

        <EntityFormSection icon={Clock} label="Điều khoản thanh toán">
          <UnitInput
            size="sm"
            label="Hạn thanh toán Chi hộ"
            unit="ngày"
            icon={Clock}
            value={chiHoDueDays}
            onChange={setChiHoDueDays}
            min={0}
            max={365}
            placeholder="Ví dụ: 15"
          />
          <UnitInput
            size="sm"
            label="Hạn thanh toán Cước"
            unit="ngày"
            icon={Clock}
            value={cuocDueDays}
            onChange={setCuocDueDays}
            min={0}
            max={365}
            placeholder="Ví dụ: 30"
          />
        </EntityFormSection>

        <EntityFormSection icon={FileText} label="Ghi chú">
          <div className="col-span-full">
            <TextArea
              value={note}
              onChange={setNote}
              placeholder="Ghi chú thêm…"
              rows={3}
            />
          </div>
        </EntityFormSection>
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
  // Row kebab menus join the global click-away / Escape dismissal layer.
  useDropdownDismiss(menuOpenId !== null, () => setMenuOpenId(null));

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
              context="clients"
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
                      <span style={{ fontSize: 'var(--text-body-size)', fontWeight: 700, color: 'var(--brand, #10B981)', background: 'var(--brand-soft, #E6FBF3)', border: '1px solid var(--brand-border, #A7F3D0)', borderRadius: 4, padding: '1px 5px' }}>
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
          <table className="record-table ops-table suppliers-page__grid" style={{ tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: 60 }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="Tên nhà cung cấp" sortKey="name" sort={sort} onSortChange={applySort} />
                <SortHeader label="Tên viết tắt" sortKey="shortName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã NCC" sortKey="shortName" sort={sort} onSortChange={applySort} />
                <SortHeader label="Mã số thuế" sortKey="taxCode" sort={sort} onSortChange={applySort} />
                <SortHeader label="Người liên hệ" sortKey="contactPerson" sort={sort} onSortChange={applySort} />
                <SortHeader label="SĐT" sortKey="phone" sort={sort} onSortChange={applySort} />
                <SortHeader label="Công nợ" sortKey="payable" sort={sort} onSortChange={applySort} style={thMoneyStyle} />
                <th style={{ width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <Loader2 size={22} className="spin" style={{ display: 'inline-block', marginBottom: 8 }} />
                  <p style={{ fontSize: 'var(--text-data-size)' }}>Đang tải…</p>
                </td></tr>
              )}
              {error && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--danger)' }}>
                  <p>{error}</p>
                  <button className="btn btn--secondary btn--sm" style={{ marginTop: 8 }} onClick={() => refetchSuppliers()}>Thử lại</button>
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} data-label="" style={{ textAlign: 'center', padding: 32, color: 'var(--ink-3)' }}>
                  <EmptyState variant="compact" context="clients" title="Chưa có dữ liệu" />
                </td></tr>
              )}
              {filtered.map((s, index) => (
                  <tr key={s.id} role="button" tabIndex={0}
                    style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/suppliers/${s.id}`)}
                    onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); navigate(`/suppliers/${s.id}`); } }}
                  >
                    <td className="suppliers-page__cell suppliers-page__cell--name" data-label="Tên nhà cung cấp" style={{ position: 'relative' }}>
                      <StatusStrip status={s.status} />
                      <span style={{ wordBreak: 'break-word', whiteSpace: 'normal' }}>
                        {s.name}
                      </span>
                    </td>
                    <td className="suppliers-page__cell" data-label="Tên viết tắt">
                      {s.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell" data-label="Mã NCC">
                      {s.shortName || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="Mã số thuế">
                      {s.taxCode || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell" data-label="Người liên hệ">
                      {s.contactPerson || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data" data-label="SĐT">
                      {s.phone || <span style={{ color: 'var(--ink-3)' }}>—</span>}
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--data suppliers-page__cell--money num" data-label="Công nợ">
                      <Money value={payableBySupplier.get(s.id) ?? 0} />
                    </td>
                    <td className="suppliers-page__cell suppliers-page__cell--actions record-table__action" data-label="" data-dropdown-root={menuOpenId === s.id ? '' : undefined} style={{ position: 'relative' }}>
                      <div className="row-actions">
                        <button type="button" className="row-action" aria-label={`Tùy chọn nhà cung cấp ${s.name}`} aria-expanded={menuOpenId === s.id} onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === s.id ? null : s.id); }}>
                          <MoreHorizontal size={14} />
                        </button>
                      </div>
                      {menuOpenId === s.id && (
                        <div style={{
                          position: 'absolute', right: 12, zIndex: 20,
                          background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 8,
                          overflow: 'hidden', minWidth: 140,
                          ...(index >= filtered.length - 2 && filtered.length > 2
                            ? { bottom: '100%', marginBottom: 4 }
                            : { top: '100%' }),
                        }} onClick={(e) => e.stopPropagation()}>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--ink)' }}
                            onClick={() => { setEditingId(s.id); setShowAddForm(false); }}>
                            <Pencil size={13} /> Sửa
                          </button>
                          <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', fontSize: 'var(--text-data-size)', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', color: 'var(--danger)' }}
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
        isOpen={showAddForm || editingId != null}
        saving={saving}
        item={editingId != null ? suppliers.find(s => s.id === editingId) : undefined}
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
