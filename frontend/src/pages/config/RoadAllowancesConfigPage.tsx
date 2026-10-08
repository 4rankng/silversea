import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { formatCurrency } from '../../lib/format';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { useRoutesDropdown } from '../../hooks/useCatalogQueries';
import type { RoadAllowance, Route as RouteType } from '@tingting/shared';
import { TrailerType } from '@tingting/shared';

const TRAILER_TYPE_LABELS: Record<string, string> = {
  [TrailerType.FT20]: '20ft', [TrailerType.FT40]: '40ft',
};

function RoadAllowanceForm({
  saving,
  item,
  onsave,
  oncancel,
  routes,
  routesError,
  routesLoading,
  onRetryRoutes,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: RoadAllowance;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  routes: RouteType[];
  routesError?: boolean;
  routesLoading?: boolean;
  onRetryRoutes?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [routeId, setRouteId] = useState(item?.routeId || 0);
  const [trailerType, setTrailerType] = useState(item?.trailerType || TrailerType.FT20);
  const [baseAmount, setBaseAmount] = useState(item?.baseAmount || '');
  return (
    <InlineForm colSpan={5}>
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
        <UuiSelectField
          label="Loại rơ-moóc"
          value={trailerType}
          onChange={e => setTrailerType(e.target.value as TrailerType)}
          options={Object.entries(TRAILER_TYPE_LABELS).map(([k, v]) => ({ value: k, label: v }))}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Mức cơ bản (đ)"><input className="input" type="number" value={baseAmount} onChange={e => setBaseAmount(e.target.value)} placeholder="0" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => { if (!routeId || !baseAmount) return; onsave({ routeId: routeId, trailerType: trailerType, baseAmount: Number(baseAmount) }); }} />
    </InlineForm>
  );
}

export default function RoadAllowancesConfigPage() {
  const routesQuery = useRoutesDropdown();
  const { data: routes = [], isError: routesError, isLoading: routesLoading, refetch: refetchRoutes } = routesQuery;
  const routeMap = useMemo(() => {
    const m = new Map<number, string>();
    routes.forEach(rt => m.set(rt.id, rt.name));
    return m;
  }, [routes]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
    <CrudTable<RoadAllowance>
      title="Tiền đi đường" description="Định mức tiền chuẩn theo Tuyến × Loại rơ-moóc — quy tắc: − vé QL5, + chuyến về có hàng, − phí trạm"
      endpoint="/road-allowances" colSpan={5}
      pageSlug="road-allowances"
      iconName="road-allowance"
      emptyContext="routes"
      emptyTitle="Chưa có định mức"
      emptyHint="Thêm tiền đi đường cho từng tuyến để hệ thống tính lương lái xe."
      columns={[
        { header: 'Tuyến đường', render: (ra) => routeMap.get(ra.routeId) || '—' },
        { header: 'Loại rơ-moóc', render: (ra) => <span className="badge badge-outline">{TRAILER_TYPE_LABELS[ra.trailerType] || ra.trailerType}</span> },
        { header: 'Mức cơ bản', className: 'num', render: (ra) => <span className="data-token" style={{ color: 'var(--fg-1)' }}>{formatCurrency(ra.baseAmount)}</span> },
      ]}
      renderForm={(p) => (
        <RoadAllowanceForm
          saving={p.saving}
          item={p.item}
          onsave={p.onSave}
          oncancel={p.onCancel}
          routes={routes}
          routesError={routesError}
          routesLoading={routesLoading}
          onRetryRoutes={() => void refetchRoutes()}
          onDelete={p.onDelete}
          deleting={p.deleting}
        />
      )}
    />
    </div>
  );
}
