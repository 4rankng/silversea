import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useAllCustomers, useRoutesDropdown } from '../../hooks/useCatalogQueries';
import type { PricingTable, Customer, Route as RouteType } from '@tingting/shared';

function PricingForm({ saving, item, onsave, oncancel, customers, routes }: {
  saving: boolean; item?: PricingTable; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
  customers: Customer[]; routes: RouteType[];
}) {
  const [customerId, setCustomerId] = useState(item?.customerId || 0);
  const [routeId, setRouteId] = useState(item?.routeId || 0);
  const [price, setPrice] = useState(item?.price || '');
  return (
    <InlineForm colSpan={5}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Khách hàng">
          <select className="input" value={customerId} onChange={e => setCustomerId(Number(e.target.value))}>
            <option value={0}>-- Chọn --</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tuyến đường">
          <select className="input" value={routeId} onChange={e => setRouteId(Number(e.target.value))}>
            <option value={0}>-- Chọn --</option>
            {routes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Giá (đ)"><input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => { if (!customerId || !routeId || !price) return; onsave({ customerId: customerId, routeId: routeId, price: Number(price) }); }} />
    </InlineForm>
  );
}

export default function PricingTablesConfigPage() {
  const { data: customers = [] } = useAllCustomers();
  const { data: routes = [] } = useRoutesDropdown();
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
      title="Bảng giá cước" description="Đơn giá thỏa thuận theo Khách hàng × Tuyến đường — dùng khi tạo chuyến mới"
      endpoint="/pricing-tables" colSpan={5}
      pageSlug="pricing-tables"
      iconName="pricing-rate"
      emptyIllustration="empty-pricing.svg"
      emptyTitle="Chưa có bảng giá"
      emptyHint="Thêm đơn giá đầu tiên (Khách hàng × Tuyến) để hệ thống áp dụng tự động."
      columns={[
        { header: 'Khách hàng', render: (pt) => customerMap.get(pt.customerId) || '—' },
        { header: 'Tuyến đường', render: (pt) => routeMap.get(pt.routeId) || '—' },
        { header: 'Giá', className: 'num', render: (pt) => <span style={{ color: 'var(--fg-1)' }}>{formatCurrency(pt.price)}</span> },
      ]}
      renderForm={(p) => <PricingForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} customers={customers} routes={routes} />}
    />
    </div>
  );
}
