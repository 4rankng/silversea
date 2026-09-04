import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Factory, Warehouse } from 'lucide-react';

import { PageHeader, Panel, Modal } from '../../components/UI';
import { Alert } from '../../components/shared/Alert';
import { useToast } from '../../components/shared/Toast';
import { Field } from '../../components/config/Field';
import { FormActions } from '../../components/config/FormActions';
import { UuiSelectField } from '../../design-system/forms/UuiSelectField';
import { configClient } from '../../api/configClient';
import { qk } from '../../api/keys';
import {
  listAdminOperationalSites,
  updateAdminOperationalSite,
  type AdminOperationalSite,
} from '../../api/shipmentClient';
import type { Route } from '@tingting/shared';
import './config-page.css';

/**
 * Draft for the edit modal — UpdateOperationalSiteBody's mutables with every
 * nullable coerced to '' so controlled inputs always hold a string; save()
 * converts empties back to null.
 */
type SiteDraft = {
  name: string;
  shortName: string;
  routeId: number | null;
  address: string;
  googleMapsUrl: string;
  contactName: string;
  contactPhone: string;
  liftFeeInvoiceName: string;
  liftFeeInvoiceAddress: string;
  liftFeeTaxCode: string;
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
    liftFeeInvoiceName: site.liftFeeInvoiceName || '',
    liftFeeInvoiceAddress: site.liftFeeInvoiceAddress || '',
    liftFeeTaxCode: site.liftFeeTaxCode || '',
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
  const [editing, setEditing] = useState<AdminOperationalSite | null>(null);
  const [draft, setDraft] = useState<SiteDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sitesQuery = useQuery({
    queryKey: qk.catalogs.adminOperationalSites,
    queryFn: listAdminOperationalSites,
  });
  // Route options for the FACTORY canonical-route link. Read-only lookup,
  // same source the intake dialog uses.
  const routesQuery = useQuery({
    queryKey: qk.catalogs.adminSiteRoutes,
    queryFn: () => configClient.getRoutesList(),
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
    return sites.filter((site) => {
      if (customerFilter && String(site.customerId) !== customerFilter) return false;
      if (!needle) return true;
      return [site.code, site.name, site.shortName, site.address, site.customerName]
        .some((value) => (value || '').toLowerCase().includes(needle));
    });
  }, [sites, search, customerFilter]);

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
        liftFeeInvoiceName: draft.liftFeeInvoiceName || null,
        liftFeeInvoiceAddress: draft.liftFeeInvoiceAddress || null,
        liftFeeTaxCode: draft.liftFeeTaxCode || null,
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
        description="Danh mục nhà máy và kho lấy hàng của từng khách hàng. Tạo mới diễn ra ngay trong form nhận lô hàng của CUS; trang này để quản trị xem, chỉnh và ngưng hoạt động."
        onBack={() => navigate('/config')}
        iconName="company-profile"
      />
      <Panel flush>
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
          <span className="cfg-page__summary">
            <strong>{filtered.length}</strong> mục
            {sites.length !== filtered.length && ` / ${sites.length}`}
          </span>
        </div>
        <div className="table-scroll">
          <table className="tt-table" style={{ minWidth: 1060 }}>
            <caption className="sr-only">Danh mục nhà máy / kho theo khách hàng</caption>
            <thead>
              <tr>
                <th style={{ width: 44 }}>STT</th>
                <th style={{ width: '10%' }}>Khách hàng</th>
                <th style={{ width: '7%' }}>Mã</th>
                <th style={{ width: '22%' }}>Tên</th>
                <th style={{ width: '8%' }}>Loại</th>
                <th style={{ width: '6%' }}>Tuyến</th>
                <th style={{ width: '23%' }}>Địa chỉ</th>
                <th style={{ width: '9%' }}>Liên hệ</th>
                <th style={{ width: '12%' }}>Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr className="cfg-empty-row">
                  <td colSpan={9} style={{ textAlign: 'center', padding: '28px 12px', color: 'var(--fg-3)' }}>
                    {sitesQuery.isLoading
                      ? 'Đang tải…'
                      : 'Chưa có nhà máy / kho nào. Nhà máy mới được tạo từ form nhận lô hàng của CUS.'}
                  </td>
                </tr>
              )}
              {filtered.map((site, index) => (
                <tr
                  key={site.id}
                  tabIndex={0}
                  role="button"
                  aria-label={`Chỉnh sửa ${site.name}`}
                  style={{ cursor: 'pointer', ...(site.isActive ? undefined : { opacity: 0.62 }) }}
                  onClick={() => openEdit(site)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openEdit(site);
                    }
                  }}
                >
                  <td className="num">{index + 1}</td>
                  <td data-label="Khách hàng">{site.customerName}</td>
                  <td data-label="Mã" style={{ color: 'var(--fg-2)' }}>{site.code}</td>
                  <td data-label="Tên" style={{ fontWeight: 600, color: 'var(--fg-1)' }}>{site.name}</td>
                  <td data-label="Loại">
                    {site.siteType === 'FACTORY'
                      ? <span className="badge badge--info"><Factory size={12} style={{ verticalAlign: -2 }} /> Nhà máy</span>
                      : <span className="badge"><Warehouse size={12} style={{ verticalAlign: -2 }} /> Kho</span>}
                  </td>
                  <td data-label="Tuyến" style={{ color: 'var(--fg-2)' }}>{site.siteType === 'FACTORY' ? (site.routeName ?? '—') : '—'}</td>
                  <td data-label="Địa chỉ" style={{ color: 'var(--fg-2)', fontSize: 13 }}>{site.address}</td>
                  <td data-label="Liên hệ" style={{ color: 'var(--fg-2)', fontSize: 13 }}>
                    {site.contactName || site.contactPhone
                      ? [site.contactName, site.contactPhone].filter(Boolean).join(' · ')
                      : '—'}
                  </td>
                  <td data-label="Trạng thái">
                    {site.isActive
                      ? <span className="cfg-pill cfg-pill--success">Đang dùng</span>
                      : <span className="cfg-pill cfg-pill--neutral">Đã ngưng</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Modal
        isOpen={!!editing}
        title={editing ? `Chỉnh sửa ${editing.name}` : ''}
        onClose={() => { setEditing(null); setDraft(null); }}
        maxWidth={640}
      >
        {/* Enter-key submits do nothing; the FormActions button is the single
            save trigger (it is type=submit, so an onSubmit save here would
            double-fire the patch). */}
        {editing && draft && (
          <form onSubmit={(e) => e.preventDefault()}>
            {error && <Alert variant="error" style="soft">{error}</Alert>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ gridColumn: 'span 2' }}>
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
              <div style={{ gridColumn: 'span 2' }}>
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
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Liên kết Google Maps">
                  <input className="input" value={draft.googleMapsUrl} maxLength={2000}
                    placeholder="https://maps.google.com/…"
                    onChange={(e) => setDraft({ ...draft, googleMapsUrl: e.target.value })} />
                </Field>
              </div>
              <Field label="Tên đơn vị xuất hóa đơn nâng hạ">
                <input className="input" value={draft.liftFeeInvoiceName} maxLength={255}
                  onChange={(e) => setDraft({ ...draft, liftFeeInvoiceName: e.target.value })} />
              </Field>
              <Field label="Mã số thuế nâng hạ">
                <input className="input" value={draft.liftFeeTaxCode} maxLength={40}
                  onChange={(e) => setDraft({ ...draft, liftFeeTaxCode: e.target.value })} />
              </Field>
              <div style={{ gridColumn: 'span 2' }}>
                <Field label="Địa chỉ xuất hóa đơn nâng hạ">
                  <input className="input" value={draft.liftFeeInvoiceAddress} maxLength={2000}
                    onChange={(e) => setDraft({ ...draft, liftFeeInvoiceAddress: e.target.value })} />
                </Field>
              </div>
              <div style={{ gridColumn: 'span 2' }}>
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
    </div>
  );
}
