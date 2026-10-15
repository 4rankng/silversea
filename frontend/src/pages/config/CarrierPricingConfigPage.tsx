import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { DateInput } from '../../design-system/forms/DateInput';
import {
  useAllSuppliers,
  useRoutesDropdown,
  useVehicleSizeClasses,
} from '../../hooks/useCatalogQueries';
import type { CarrierRoutePricing, Route as RouteType, Supplier, VehicleSizeClass } from '@tingting/shared';

function CarrierPricingForm({
  saving,
  item,
  onsave,
  oncancel,
  routes,
  routesError,
  routesLoading,
  onRetryRoutes,
  vehicleClasses,
  vehicleClassesError,
  vehicleClassesLoading,
  onRetryVehicleClasses,
  suppliers,
  suppliersError,
  suppliersLoading,
  onRetrySuppliers,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: CarrierRoutePricing;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  routes: RouteType[];
  routesError?: boolean;
  routesLoading?: boolean;
  onRetryRoutes?: () => void;
  vehicleClasses: VehicleSizeClass[];
  vehicleClassesError?: boolean;
  vehicleClassesLoading?: boolean;
  onRetryVehicleClasses?: () => void;
  suppliers: Supplier[];
  suppliersError?: boolean;
  suppliersLoading?: boolean;
  onRetrySuppliers?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [routeId, setRouteId] = useState(item?.routeId || 0);
  const [vehicleSizeClassId, setVehicleSizeClassId] = useState(String(item?.vehicleSizeClassId ?? ''));
  const [supplierId, setSupplierId] = useState(String(item?.supplierId ?? ''));
  const [price, setPrice] = useState(item?.price || '');
  const [effectiveDate, setEffectiveDate] = useState(item?.effectiveDate || new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState(item?.note || '');

  const retryAlert = (
    errored: boolean | undefined,
    message: string,
    retry: (() => void) | undefined,
  ) => (errored ? (
    <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
      <Alert
        variant="error"
        style="soft"
        action={retry ? <button type="button" className="btn btn--sm" onClick={retry}>Thử lại</button> : undefined}
      >
        {message}
      </Alert>
    </div>
  ) : null);

  return (
    <InlineForm colSpan={6}>
      {retryAlert(routesError, 'Không thể tải danh mục tuyến đường.', onRetryRoutes)}
      {retryAlert(vehicleClassesError, 'Không thể tải danh mục loại xe.', onRetryVehicleClasses)}
      {retryAlert(suppliersError, 'Không thể tải danh sách nhà xe.', onRetrySuppliers)}
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
                ? 'Lỗi tải tuyến đường — thử lại'
                : routesLoading
                ? 'Đang tải tuyến đường…'
                : '-- Chọn --',
            },
            ...routes.map(r => ({ value: String(r.id), label: r.shortName || r.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <UuiSelectField
          label="Loại xe"
          value={vehicleSizeClassId}
          onChange={e => setVehicleSizeClassId(e.target.value)}
          disabled={vehicleClassesLoading || vehicleClassesError}
          options={[
            {
              value: '',
              label: vehicleClassesError
                ? 'Lỗi tải loại xe — thử lại'
                : vehicleClassesLoading
                ? 'Đang tải loại xe…'
                : '-- Chọn --',
            },
            ...vehicleClasses.map(cls => ({
              value: String(cls.id),
              label: `${cls.code} — ${cls.name}${cls.isContainer ? '' : ' (100% xe ngoài)'}`,
            })),
          ]}
        />
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Nhà xe"
          value={supplierId}
          onChange={e => setSupplierId(e.target.value)}
          disabled={suppliersLoading || suppliersError}
          options={[
            {
              value: '',
              label: 'Giá chung (mọi nhà xe)',
            },
            ...suppliers.map(sup => ({ value: String(sup.id), label: sup.shortName || sup.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 130 }}>
        <Field label="Cước trả nhà xe (đ)"><input className="input" type="number" value={price} onChange={e => setPrice(e.target.value)} placeholder="0" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 140 }}>
        <Field label="Hiệu lực từ"><DateInput className="input" value={effectiveDate} onChange={setEffectiveDate} /></Field>
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Ghi chú"><input className="input" value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Tùy chọn" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => {
        if (!routeId || !vehicleSizeClassId || !price || !effectiveDate) return;
        onsave({
          routeId,
          vehicleSizeClassId: Number(vehicleSizeClassId),
          supplierId: supplierId ? Number(supplierId) : null,
          price: Number(price),
          effectiveDate,
          note: note || null,
        });
      }} />
    </InlineForm>
  );
}

export default function CarrierPricingConfigPage() {
  const routesQuery = useRoutesDropdown();
  const vehicleClassesQuery = useVehicleSizeClasses();
  const suppliersQuery = useAllSuppliers();
  const { data: routes = [], isError: routesError, isLoading: routesLoading, refetch: refetchRoutes } = routesQuery;
  const { data: vehicleClasses = [], isError: vehicleClassesError, isLoading: vehicleClassesLoading, refetch: refetchVehicleClasses } = vehicleClassesQuery;
  const { data: suppliers = [], isError: suppliersError, isLoading: suppliersLoading, refetch: refetchSuppliers } = suppliersQuery;

  const routeMap = new Map(routes.map(r => [r.id, r.shortName || r.name] as const));
  const classMap = new Map(vehicleClasses.map(cls => [cls.id, cls] as const));
  const supplierMap = new Map(suppliers.map(sup => [sup.id, sup.shortName || sup.name] as const));

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<CarrierRoutePricing>
        title="Bảng giá cước trả nhà xe"
        description="Đơn giá trả nhà xe theo Tuyến × Loại xe. Chọn nhà xe cụ thể để đặt giá riêng; để trống ('Giá chung') áp cho mọi nhà xe chưa có giá riêng"
        endpoint="/carrier-route-pricing"
        colSpan={6}
        pageSlug="carrier-route-pricing"
        iconName="pricing-rate"
        emptyContext="pricing"
        emptyTitle="Chưa có bảng giá trả nhà xe"
        emptyHint="Thêm đơn giá trả nhà xe đầu tiên (Tuyến × Loại xe) để quy hoạch chi phí trả đối tác."
        columns={[
          { header: 'Tuyến đường', render: (row) => routeMap.get(row.routeId) || '—' },
          { header: 'Loại xe', render: (row) => {
            const cls = classMap.get(row.vehicleSizeClassId);
            return cls ? `${cls.code} — ${cls.name}` : `#${row.vehicleSizeClassId}`;
          } },
          { header: 'Nhà xe', render: (row) => row.supplierId == null
            ? <span className="data-token">Giá chung</span>
            : (supplierMap.get(row.supplierId) || `#${row.supplierId}`) },
          { header: 'Hiệu lực từ', render: (row) => row.effectiveDate || '—' },
          { header: 'Cước trả nhà xe', className: 'num', render: (row) => <span className="data-token" style={{ color: 'var(--fg-1)' }}>{formatCurrency(row.price)}</span> },
          { header: 'Ghi chú', render: (row) => row.note || '—' },
        ]}
        renderForm={(p) => (
          <CarrierPricingForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            routes={routes}
            routesError={routesError}
            routesLoading={routesLoading}
            onRetryRoutes={() => void refetchRoutes()}
            vehicleClasses={vehicleClasses}
            vehicleClassesError={vehicleClassesError}
            vehicleClassesLoading={vehicleClassesLoading}
            onRetryVehicleClasses={() => void refetchVehicleClasses()}
            suppliers={suppliers}
            suppliersError={suppliersError}
            suppliersLoading={suppliersLoading}
            onRetrySuppliers={() => void refetchSuppliers()}
            onDelete={p.onDelete}
            deleting={p.deleting}
          />
        )}
      />
    </div>
  );
}
