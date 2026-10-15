import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { useAllCustomers, useContainerTypes, useRoutesDropdown, useVehicleSizeClasses } from '../../hooks/useCatalogQueries';
import type { PricingTable, Customer, Route as RouteType, ContainerType, VehicleSizeClass } from '@tingting/shared';
import { DateInput } from '../../design-system/forms/DateInput';

function PricingForm({
  saving,
  item,
  onsave,
  oncancel,
  customers,
  customersError,
  customersLoading,
  onRetryCustomers,
  routes,
  routesError,
  routesLoading,
  onRetryRoutes,
  containerTypes,
  containerTypesError,
  containerTypesLoading,
  onRetryContainerTypes,
  vehicleClasses,
  vehicleClassesError,
  vehicleClassesLoading,
  onRetryVehicleClasses,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: PricingTable;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  customers: Customer[];
  customersError?: boolean;
  customersLoading?: boolean;
  onRetryCustomers?: () => void;
  routes: RouteType[];
  routesError?: boolean;
  routesLoading?: boolean;
  onRetryRoutes?: () => void;
  containerTypes: ContainerType[];
  containerTypesError?: boolean;
  containerTypesLoading?: boolean;
  onRetryContainerTypes?: () => void;
  vehicleClasses: VehicleSizeClass[];
  vehicleClassesError?: boolean;
  vehicleClassesLoading?: boolean;
  onRetryVehicleClasses?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  // FB-090: structured Loại xe selector replaces the free-text lớp giá for
  // vehicle-class rows. A legacy rate-key row preselects the class with the
  // same code (they resolve identically server-side); an unmatched legacy
  // key is preserved verbatim on save when no selector is chosen.
  const classIdByCode = useMemo(
    () => new Map(vehicleClasses.map(cls => [cls.code, cls.id] as const)),
    [vehicleClasses],
  );
  const initialVehicleClassId = item?.vehicleSizeClassId
    ?? (item?.rateKey ? classIdByCode.get(item.rateKey) ?? null : null);
  const [customerId, setCustomerId] = useState(item?.customerId || 0);
  const [routeId, setRouteId] = useState(item?.routeId || 0);
  const [price, setPrice] = useState(item?.price || '');
  const [containerTypeId, setContainerTypeId] = useState(String(item?.containerTypeId ?? ''));
  const [vehicleSizeClassId, setVehicleSizeClassId] = useState(String(initialVehicleClassId ?? ''));
  const [effectiveDate, setEffectiveDate] = useState(item?.effectiveDate || new Date().toISOString().slice(0, 10));
  const vehicleClassSelected = vehicleSizeClassId !== '';
  return (
    <InlineForm colSpan={7}>
      {customersError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryCustomers ? (
                <button type="button" className="btn btn--sm" onClick={onRetryCustomers}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh sách khách hàng.
          </Alert>
        </div>
      )}
      {routesError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryRoutes ? (
                <button type="button" className="btn btn--sm" onClick={onRetryRoutes}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục tuyến đường.
          </Alert>
        </div>
      )}
      {containerTypesError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryContainerTypes ? (
                <button type="button" className="btn btn--sm" onClick={onRetryContainerTypes}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục loại container.
          </Alert>
        </div>
      )}
      {vehicleClassesError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryVehicleClasses ? (
                <button type="button" className="btn btn--sm" onClick={onRetryVehicleClasses}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục loại xe.
          </Alert>
        </div>
      )}
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Khách hàng"
          value={String(customerId)}
          onChange={e => setCustomerId(Number(e.target.value))}
          disabled={customersLoading || customersError}
          options={[
            {
              value: '0',
              label: customersError
                ? 'Lỗi tải khách hàng — thử lại'
                : customersLoading
                ? 'Đang tải khách hàng…'
                : '-- Chọn --',
            },
            ...customers.map(c => ({ value: String(c.id), label: c.shortName || c.name })),
          ]}
        />
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Tuyến đường"
          value={String(routeId)}
          onChange={e => setRouteId(Number(e.target.value))}
          disabled={routesLoading || routesError}
          options={[
            {
              value: '0',
              label: routesError
                ? 'Lỗi tải danh mục tuyến đường — thử lại'
                : routesLoading
                ? 'Đang tải danh mục tuyến đường…'
                : '-- Chọn --',
            },
            ...routes.map(r => ({ value: String(r.id), label: r.shortName || r.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Cước thu khách (đ)"><input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <UuiSelectField
          label="Loại xe"
          value={vehicleSizeClassId}
          onChange={e => { setVehicleSizeClassId(e.target.value); if (e.target.value) setContainerTypeId(''); }}
          disabled={vehicleClassesLoading || vehicleClassesError}
          options={[
            {
              value: '',
              label: vehicleClassesError
                ? 'Lỗi tải loại xe — thử lại'
                : vehicleClassesLoading
                ? 'Đang tải loại xe…'
                : '— Không áp dụng —',
            },
            ...vehicleClasses.map((cls) => ({ value: String(cls.id), label: `${cls.code} — ${cls.name}` })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 160 }}>
        <UuiSelectField
          label="Loại container"
          value={containerTypeId}
          onChange={e => { setContainerTypeId(e.target.value); if (e.target.value) setVehicleSizeClassId(''); }}
          disabled={containerTypesLoading || containerTypesError}
          options={[
            {
              value: '',
              label: containerTypesError
                ? 'Lỗi tải loại container — thử lại'
                : containerTypesLoading
                ? 'Đang tải loại container…'
                : '— Không áp dụng —',
            },
            ...containerTypes.map((type) => ({ value: String(type.id), label: `${type.code} — ${type.name}` })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Hiệu lực từ"><DateInput className="input" value={effectiveDate} onChange={setEffectiveDate} /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => {
        if (!customerId || !routeId || !price || !effectiveDate) return;
        if (vehicleClassSelected && containerTypeId) return;
        onsave({
          customerId,
          routeId,
          price: Number(price),
          // The server denormalizes rate_key from the chosen class; a legacy
          // free-text key survives only when no selector is chosen.
          vehicleSizeClassId: vehicleClassSelected ? Number(vehicleSizeClassId) : null,
          rateKey: vehicleClassSelected || containerTypeId ? null : item?.rateKey ?? null,
          containerTypeId: containerTypeId ? Number(containerTypeId) : null,
          effectiveDate,
        });
      }} />
    </InlineForm>
  );
}

export default function PricingTablesConfigPage() {
  const customersQuery = useAllCustomers();
  const routesQuery = useRoutesDropdown();
  const containerTypesQuery = useContainerTypes();
  const vehicleClassesQuery = useVehicleSizeClasses();
  const { data: customers = [], isError: customersError, isLoading: customersLoading, refetch: refetchCustomers } = customersQuery;
  const { data: routes = [], isError: routesError, isLoading: routesLoading, refetch: refetchRoutes } = routesQuery;
  const { data: containerTypes = [], isError: containerTypesError, isLoading: containerTypesLoading, refetch: refetchContainerTypes } = containerTypesQuery;
  const { data: vehicleClasses = [], isError: vehicleClassesError, isLoading: vehicleClassesLoading, refetch: refetchVehicleClasses } = vehicleClassesQuery;
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
  const vehicleClassMap = useMemo(() => {
    const m = new Map<number, VehicleSizeClass>();
    vehicleClasses.forEach(cls => m.set(cls.id, cls));
    return m;
  }, [vehicleClasses]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<PricingTable>
      title="Bảng giá cước" description="Đơn giá cước thu khách theo Khách hàng × Tuyến × Loại xe (hoặc loại container), áp dụng tự động khi phát hành chuyến"
      endpoint="/pricing-tables" colSpan={7}
      pageSlug="pricing-tables"
      iconName="pricing-rate"
      emptyContext="pricing"
      emptyTitle="Chưa có bảng giá"
      emptyHint="Thêm đơn giá đầu tiên (Khách hàng × Tuyến × Loại xe) để hệ thống áp dụng tự động."
      columns={[
        { header: 'Khách hàng', render: (pt) => customerMap.get(pt.customerId) || '—' },
        { header: 'Tuyến đường', render: (pt) => routeMap.get(pt.routeId) || '—' },
        { header: 'Loại xe', render: (pt) => {
          if (pt.vehicleSizeClassId != null) {
            const cls = vehicleClassMap.get(pt.vehicleSizeClassId);
            return cls ? `${cls.code} — ${cls.name}` : `#${pt.vehicleSizeClassId}`;
          }
          if (pt.rateKey) {
            // Legacy free-text key: show the code (and the class name when it
            // maps to a catalog row).
            const cls = vehicleClasses.find(c => c.code === pt.rateKey);
            return cls ? `${pt.rateKey} — ${cls.name}` : pt.rateKey;
          }
          return 'Áp dụng chung';
        } },
        { header: 'Loại container', render: (pt) => containerTypes.find((type) => type.id === pt.containerTypeId)?.code || '—' },
        { header: 'Hiệu lực từ', render: (pt) => pt.effectiveDate || '—' },
        { header: 'Cước thu khách', className: 'num', render: (pt) => <span className="data-token" style={{ color: 'var(--fg-1)' }}>{formatCurrency(pt.price)}</span> },
      ]}
      renderForm={(p) => (
        <PricingForm
          saving={p.saving}
          item={p.item}
          onsave={p.onSave}
          oncancel={p.onCancel}
          customers={customers}
          customersError={customersError}
          customersLoading={customersLoading}
          onRetryCustomers={() => void refetchCustomers()}
          routes={routes}
          routesError={routesError}
          routesLoading={routesLoading}
          onRetryRoutes={() => void refetchRoutes()}
          containerTypes={containerTypes}
          containerTypesError={containerTypesError}
          containerTypesLoading={containerTypesLoading}
          onRetryContainerTypes={() => void refetchContainerTypes()}
          vehicleClasses={vehicleClasses}
          vehicleClassesError={vehicleClassesError}
          vehicleClassesLoading={vehicleClassesLoading}
          onRetryVehicleClasses={() => void refetchVehicleClasses()}
          onDelete={p.onDelete}
          deleting={p.deleting}
        />
      )}
    />
    </div>
  );
}
