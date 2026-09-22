import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useAllCustomers, useContainerTypes, useRoutesDropdown } from '../../hooks/useCatalogQueries';
import type { PricingTable, Customer, Route as RouteType, ContainerType } from '@tingting/shared';
import { DateInput } from '../../design-system/forms/DateInput';

function PricingForm({ saving, item, onsave, oncancel, customers, routes, containerTypes, onDelete, deleting }: {
  saving: boolean; item?: PricingTable; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  customers: Customer[]; routes: RouteType[]; containerTypes: ContainerType[];
  onDelete?: () => Promise<void>; deleting?: boolean;
}) {
  const [customerId, setCustomerId] = useState(item?.customerId || 0);
  const [routeId, setRouteId] = useState(item?.routeId || 0);
  const [price, setPrice] = useState(item?.price || '');
  const [containerTypeId, setContainerTypeId] = useState(String(item?.containerTypeId ?? ''));
  const [rateKey, setRateKey] = useState(item?.rateKey || '');
  const [effectiveDate, setEffectiveDate] = useState(item?.effectiveDate || new Date().toISOString().slice(0, 10));
  return (
    <InlineForm colSpan={7}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Khách hàng"
          value={String(customerId)}
          onChange={e => setCustomerId(Number(e.target.value))}
          options={[
            { value: '0', label: '-- Chọn --' },
            ...customers.map(c => ({ value: String(c.id), label: c.shortName || c.name })),
          ]}
        />
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Tuyến đường"
          value={String(routeId)}
          onChange={e => setRouteId(Number(e.target.value))}
          options={[
            { value: '0', label: '-- Chọn --' },
            ...routes.map(r => ({ value: String(r.id), label: r.shortName || r.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Giá (đ)"><input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Lớp giá"><input className="input" value={rateKey} onChange={e => { setRateKey(e.target.value.toUpperCase()); if (e.target.value) setContainerTypeId(''); }} placeholder="Ví dụ: CONT20, 5T…" maxLength={32} /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <UuiSelectField
          label="Loại container"
          value={containerTypeId}
          onChange={e => { setContainerTypeId(e.target.value); if (e.target.value) setRateKey(''); }}
          options={[
            { value: '', label: '— Không áp dụng —' },
            ...containerTypes.map((type) => ({ value: String(type.id), label: `${type.code} — ${type.name}` })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Hiệu lực từ"><DateInput className="input" value={effectiveDate} onChange={setEffectiveDate} /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => { if (!customerId || !routeId || !price || !effectiveDate) return; onsave({ customerId, routeId, price: Number(price), rateKey: rateKey || null, containerTypeId: containerTypeId ? Number(containerTypeId) : null, effectiveDate }); }} />
    </InlineForm>
  );
}

export default function PricingTablesConfigPage() {
  const { data: customers = [] } = useAllCustomers();
  const { data: routes = [] } = useRoutesDropdown();
  const { data: containerTypes = [] } = useContainerTypes();
  const customerMap = useMemo(() => {
    const m = new Map<number, string>();
    customers.forEach(c => m.set(c.id, c.name));
    return m;
  }, [customers]);
  const routeMap = useMemo(() => {
    const m = new Map<number, string>();
    routes.forEach(r => m.set(r.id, r.name));
    return m;
  }, [routes]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<PricingTable>
      title="Bảng giá cước" description="Đơn giá theo Khách hàng × Tuyến × Lớp giá, áp dụng tự động khi phát hành chuyến"
      endpoint="/pricing-tables" colSpan={7}
      pageSlug="pricing-tables"
      iconName="pricing-rate"
      emptyContext="pricing"
      emptyTitle="Chưa có bảng giá"
      emptyHint="Thêm đơn giá đầu tiên (Khách hàng × Tuyến) để hệ thống áp dụng tự động."
      columns={[
        { header: 'Khách hàng', render: (pt) => customerMap.get(pt.customerId) || '—' },
        { header: 'Tuyến đường', render: (pt) => routeMap.get(pt.routeId) || '—' },
        { header: 'Lớp giá', render: (pt) => pt.rateKey || 'Áp dụng chung' },
        { header: 'Loại container', render: (pt) => containerTypes.find((type) => type.id === pt.containerTypeId)?.code || '—' },
        { header: 'Hiệu lực từ', render: (pt) => pt.effectiveDate || '—' },
        { header: 'Giá', className: 'num', render: (pt) => <span style={{ color: 'var(--fg-1)' }}>{formatCurrency(pt.price)}</span> },
      ]}
      renderForm={(p) => <PricingForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} customers={customers} routes={routes} containerTypes={containerTypes} onDelete={p.onDelete} deleting={p.deleting} />}
    />
    </div>
  );
}
