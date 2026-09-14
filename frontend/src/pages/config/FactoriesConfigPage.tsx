import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';

import { PageHeader, Modal } from '../../components/UI';
import { Alert } from '../../components/shared/Alert';
import { useToast } from '../../components/shared/Toast';
import { Field } from '../../components/config/Field';
import { FormActions } from '../../components/config/FormActions';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import { SortHeader } from '../../components/shared/SortHeader';
import { nextTableSort, sortClientSide, type TableSortState } from '../../lib/table-sort';
import { OperationalSiteCreateDialog } from '../../components/shipment/OperationalSiteCreateDialog';
import '../../styles/record-table.css';
import '../../styles/operational-table-typography.css';
import {
  listAdminOperationalSites,
  updateAdminOperationalSite,
  type AdminOperationalSite,
} from '../../api/shipmentClient';
import type { Route } from '@tingting/shared';
import './config-page.css';

type SiteDraft = {
  name: string;
  shortName: string;
  routeId: number | null;
  address: string;
  googleMapsUrl: string;
  contactName: string;
  contactPhone: string;
  warehouseContactInfo: string;
  liftInfo: string;
  dropInfo: string;
  cleaningInfo: string;
  strictRules: string;
  isActive: boolean;
};

function draftFrom(site: AdminOperationalSite): SiteDraft {
  return {
    name: site.name,
    shortName: site.shortName || '',
    routeId: site.routeId,
    address: site.address,
    googleMapsUrl: site.googleMapsUrl || '',
    contactName: site.contactName || '',
    contactPhone: site.contactPhone || '',
    warehouseContactInfo: site.warehouseContactInfo || '',
    liftInfo: site.liftInfo || '',
    dropInfo: site.dropInfo || '',
    cleaningInfo: site.cleaningInfo || '',
    strictRules: site.strictRules || '',
    isActive: site.isActive,
  };
}

export default function FactoriesConfigPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [sort, setSort] = useState<TableSortState | null>(null);
  const handleSort = (key: string) => setSort(current => nextTableSort(current, key));
  const [editing, setEditing] = useState<AdminOperationalSite | null>(null);
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sitesQuery = useQuery({
    queryKey: qk.catalogs.adminOperationalSites,
    queryFn: listAdminOperationalSites,
  });
  const routesQuery = useQuery({
    queryKey: qk.catalogs.adminSiteRoutes,
    queryFn: () => configClient.getRoutesList(),
  });
  // Full customer catalog for the create dialog's customer picker (the site
  // list itself only exposes customers that already have a site).
  const customersQuery = useQuery({
    queryKey: qk.catalogs.allCustomers,
    queryFn: () => configClient.getAllCustomers(),
  });
  const routes: Route[] = routesQuery.data ?? [];

  const sites = sitesQuery.data ?? [];
  const customers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const site of sites) seen.set(String(site.customerId), site.customerName);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [sites]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matched = sites.filter((site) => {
      if (customerFilter && String(site.customerId) !== customerFilter) return false;
      if (!needle) return true;
      return [site.code, site.name, site.shortName, site.address, site.customerName]
        .some((value) => (value || '').toLowerCase().includes(needle));
    });
    return sortClientSide(matched, sort, {
      customerName: s => s.customerName,
      code: s => s.code,
      name: s => s.name,
      address: s => s.address,
    }, (a, b) => a.id - b.id);
  }, [sites, search, customerFilter, sort]);

  function openEdit(site: AdminOperationalSite) {
    setEditing(site);
    setDraft(draftFrom(site));
    setError(null);
  }

  async function save() {
    if (!editing || !draft) return;
    setSaving(true);
    setError(null);
    try {
      await updateAdminOperationalSite(editing.id, {
        expectedVersion: editing.version,
        name: draft.name,
        shortName: draft.shortName || undefined,
        routeId: draft.routeId ?? null,
        address: draft.address,
        googleMapsUrl: draft.googleMapsUrl || null,
        contactName: draft.contactName || null,
        contactPhone: draft.contactPhone || null,
        warehouseContactInfo: draft.warehouseContactInfo || null,
        liftInfo: draft.liftInfo || null,
        dropInfo: draft.dropInfo || null,
        cleaningInfo: draft.cleaningInfo || null,
        strictRules: draft.strictRules || null,
        isActive: draft.isActive,
      });
      toast({ kind: 'success', message: 'Đã lưu nhà máy / kho.' });
      setEditing(null);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.adminOperationalSites });
    } catch (err) {
      setError((err as Error)?.message || 'Không thể lưu nhà máy / kho.');
    } finally {
      setSaving(false);
    }
  }

  const isFactory = editing?.siteType === 'FACTORY';

  return (
    <div className="cfg-page cfg-page--factories fade-up">
      <PageHeader
        title="Nhà máy / Kho"
        description="Danh mục nhà máy và kho lấy hàng của từng khách hàng. Tạo mới tại đây hoặc từ form nhận lô của CUS."
        onBack={() => navigate('/config')}
        iconName="company-profile"
      />
      <div className="table-wrap">
        <div className="toolbar">
          <input
            className="input"
            style={{ maxWidth: 280 }}
            placeholder="Tìm theo mã, tên, địa chỉ…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Tìm nhà máy / kho"
          />
          <div style={{ maxWidth: 240 }}>
            <UuiSelectField
              label="Khách hàng"
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              options={[
                { value: '', label: 'Tất cả khách hàng' },
                ...customers.map((customer) => ({ value: customer.id, label: customer.name })),
              ]}
            />
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn btn--primary" onClick={() => setCreateOpen(true)} disabled={customersQuery.isLoading}>
            <Plus size={14} /> Tạo mới
          </button>
          <span className="cfg-page__summary">
            <strong>{filtered.length}</strong> mục
            {sites.length !== filtered.length && ` / ${sites.length}`}
          </span>
        </div>
        <div className="table-scroll">
          <div className="record-table-wrap">
          <table className="record-table ops-table factories-table">
            <caption className="sr-only">Danh mục nhà máy / kho theo khách hàng</caption>
            <thead>
              <tr>
                <th className="num">STT</th>
                <SortHeader label="Khách hàng" sortKey="customerName" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Mã" sortKey="code" sort={sort} onSortChange={handleSort} />
                <SortHeader label="Tên" sortKey="name" sort={sort} onSortChange={handleSort} />
                <th>Loại</th>
                <th>Tuyến</th>
                <SortHeader label="Địa chỉ" sortKey="address" sort={sort} onSortChange={handleSort} />
                <th>Liên hệ</th>
                <th>Trạng thái</th>
                <th style={{ width: 56 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr className="cfg-empty-row">
                  <td colSpan={10} data-label="" style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--fg-3)' }}>
                    {sitesQuery.isLoading
                      ? 'Đang tải…'
                      : 'Chưa có nhà máy / kho nào. Dùng nút "Tạo mới" hoặc form nhận lô của CUS.'}
                  </td>
                </tr>
              )}
              {filtered.map((site, index) => (
                <tr key={site.id} style={site.isActive ? undefined : { opacity: 0.62 }}>
                  <td className="num" data-label="STT">{index + 1}</td>
                  <td data-label="Khách hàng">{site.customerName}</td>
                  <td data-label="Mã" style={{ color: 'var(--fg-2)' }}>{site.code}</td>
                  <td data-label="Tên"><div className="row-strong">{site.name}</div></td>
                  <td data-label="Loại">{site.siteType === 'FACTORY' ? 'Nhà máy' : 'Kho'}</td>
                  <td data-label="Tuyến" style={{ color: 'var(--fg-2)' }}>{site.siteType === 'FACTORY' ? (site.routeName ?? '—') : '—'}</td>
                  <td data-label="Địa chỉ" style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)' }}>{site.address || '—'}</td>
                  <td data-label="Liên hệ" style={{ color: 'var(--fg-2)', fontSize: 'var(--text-data-size)' }}>
                    {site.contactName || site.contactPhone
                      ? [site.contactName, site.contactPhone].filter(Boolean).join(' · ')
                      : '—'}
                  </td>
                  <td data-label="Trạng thái">
                    {site.isActive
                      ? <span style={{ color: 'var(--success)', fontWeight: 500 }}>Đang dùng</span>
                      : <span style={{ color: 'var(--fg-3)' }}>Đã ngưng</span>}
                  </td>
                  <td data-label="" className="record-table__action">
                    <div className="row-actions">
                      <button
                        className="row-action"
                        title="Sửa điểm vận hành"
                        onClick={() => openEdit(site)}
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      </div>

      <Modal
        isOpen={!!editing}
        title={editing ? `Chỉnh sửa ${editing.name}` : ''}
        subtitle="Điểm vận hành"
        polished
        onClose={() => { setEditing(null); setDraft(null); }}
        maxWidth={640}
      >
        {editing && draft && (
          <form onSubmit={(e) => e.preventDefault()}>
            {error && <Alert variant="error" style="soft">{error}</Alert>}
            <div className="cfg-form-columns">
              <div className="cfg-form-columns__full">
                <Field label="Tên điểm vận hành">
                  <input className="input" value={draft.name} required maxLength={255}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </Field>
              </div>
              <Field label="Tên ngắn">
                <input className="input" value={draft.shortName} maxLength={255}
                  onChange={(e) => setDraft({ ...draft, shortName: e.target.value })} />
              </Field>
              {isFactory ? (
                <UuiSelectField
                  label="Tuyến đường chuẩn"
                  value={draft.routeId == null ? '' : String(draft.routeId)}
                  onChange={(e) => setDraft({ ...draft, routeId: e.target.value ? Number(e.target.value) : null })}
                  options={[
                    { value: '', label: '— Chọn tuyến —' },
                    ...routes.map((route) => ({ value: String(route.id), label: route.name })),
                  ]}
                />
              ) : (
                <Field label="Loại">
                  <input className="input" value="Kho lấy hàng (không dùng tuyến)" disabled />
                </Field>
              )}
              <div className="cfg-form-columns__full">
                <Field label="Địa chỉ">
                  <input className="input" value={draft.address} required maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
                </Field>
              </div>
              <Field label="Người liên hệ">
                <input className="input" value={draft.contactName} maxLength={120}
                  onChange={(e) => setDraft({ ...draft, contactName: e.target.value })} />
              </Field>
              <Field label="Số điện thoại">
                <input className="input" value={draft.contactPhone} maxLength={30}
                  onChange={(e) => setDraft({ ...draft, contactPhone: e.target.value })} />
              </Field>
              <div className="cfg-form-columns__full">
                <Field label="Liên kết Google Maps">
                  <input className="input" value={draft.googleMapsUrl} maxLength={2000}
                    placeholder="https://maps.google.com/…"
                    onChange={(e) => setDraft({ ...draft, googleMapsUrl: e.target.value })} />
                </Field>
              </div>
              <div className="cfg-form-columns__full">
                <Field label="Thông tin liên hệ kho">
                  <textarea className="input" rows={2} value={draft.warehouseContactInfo} maxLength={2000}
                    placeholder="Nhiều liên hệ, SĐT trong một ô..."
                    onChange={(e) => setDraft({ ...draft, warehouseContactInfo: e.target.value })} />
                </Field>
              </div>
              <div className="cfg-form-columns__full">
                <Field label="Thông tin nâng/hạ">
                  <textarea className="input" rows={2} value={draft.liftInfo} maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, liftInfo: e.target.value })} />
                </Field>
              </div>
              <div className="cfg-form-columns__full">
                <Field label="Thông tin hạ">
                  <textarea className="input" rows={2} value={draft.dropInfo} maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, dropInfo: e.target.value })} />
                </Field>
              </div>
              <div className="cfg-form-columns__full">
                <Field label="Thông tin vệ sinh">
                  <textarea className="input" rows={2} value={draft.cleaningInfo} maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, cleaningInfo: e.target.value })} />
                </Field>
              </div>
              <div className="cfg-form-columns__full">
                <Field label="Quy định tại điểm làm hàng">
                  <textarea className="input" rows={3} value={draft.strictRules} maxLength={8000}
                    onChange={(e) => setDraft({ ...draft, strictRules: e.target.value })} />
                </Field>
              </div>
              <UuiSelectField
                label="Trạng thái"
                value={draft.isActive ? 'ACTIVE' : 'INACTIVE'}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.value === 'ACTIVE' })}
                options={[
                  { value: 'ACTIVE', label: 'Đang dùng' },
                  { value: 'INACTIVE', label: 'Đã ngưng (ẩn khỏi form tạo lô)' },
                ]}
              />
            </div>
            <FormActions
              saving={saving}
              isedit
              oncancel={() => { setEditing(null); setDraft(null); }}
              onsave={() => { void save(); }}
            />
          </form>
        )}
      </Modal>

      <OperationalSiteCreateDialog
        isOpen={createOpen}
        customers={(customersQuery.data ?? []).map((customer) => ({ id: customer.id, name: customer.name }))}
        defaultSiteType="FACTORY"
        routes={routes}
        onClose={() => setCreateOpen(false)}
        onCreated={async () => {
          setCreateOpen(false);
          toast({ kind: 'success', message: 'Đã tạo nhà máy / kho.' });
          await queryClient.invalidateQueries({ queryKey: qk.catalogs.adminOperationalSites });
        }}
        // Inline route creation must refresh the page's route catalog too — the
        // dialog's internal createdRoutes list is wiped on reopen, so without
        // this the next create session would not see the new route.
        onRouteCreated={() => {
          void queryClient.invalidateQueries({ queryKey: qk.catalogs.adminSiteRoutes });
        }}
      />
    </div>
  );
}
