import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { useContainerTypes, usePorts } from '../../hooks/useCatalogQueries';
import { formatMoney } from '../../lib/format';

interface LiftPricing {
  id: number;
  portId: number;
  containerTypeId: number;
  direction: 'LIFT_UP' | 'LIFT_DOWN';
  loadState: 'LOADED' | 'EMPTY';
  unitPrice: string;
  effectiveDate: string;
}

const DIR_LABELS: Record<string, string> = { LIFT_UP: 'Nâng', LIFT_DOWN: 'Hạ' };

function LiftPricingForm({
  saving,
  item,
  onsave,
  oncancel,
  ports,
  portsError,
  portsLoading,
  onRetryPorts,
  containerTypes,
  containerTypesError,
  containerTypesLoading,
  onRetryContainerTypes,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: LiftPricing;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  ports: Array<{ id: number; name: string }>;
  portsError?: boolean;
  portsLoading?: boolean;
  onRetryPorts?: () => void;
  containerTypes: Array<{ id: number; code: string; name: string }>;
  containerTypesError?: boolean;
  containerTypesLoading?: boolean;
  onRetryContainerTypes?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [portId, setPortId] = useState(String(item?.portId ?? ''));
  const [containerTypeId, setContainerTypeId] = useState(String(item?.containerTypeId ?? ''));
  const [direction, setDirection] = useState<string>(item?.direction || 'LIFT_UP');
  const [loadState, setLoadState] = useState<string>(item?.loadState || 'LOADED');
  const [unitPrice, setUnitPrice] = useState(item?.unitPrice || '');

  return (
    <InlineForm colSpan={6}>
      {portsError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryPorts ? (
                <button type="button" className="btn btn--sm" onClick={onRetryPorts}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục cảng / bãi.
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
      <div style={{ flex: 1, minWidth: 180 }}>
        <UuiSelectField
          label="Cảng / bãi"
          value={portId}
          onChange={e => setPortId(e.target.value)}
          disabled={portsLoading || portsError}
          options={[
            {
              value: '',
              label: portsError
                ? 'Lỗi tải cảng — thử lại'
                : portsLoading
                ? 'Đang tải cảng…'
                : '— Chọn cảng —',
            },
            ...ports.map(port => ({ value: String(port.id), label: port.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 170 }}>
        <UuiSelectField
          label="Loại container"
          value={containerTypeId}
          onChange={e => setContainerTypeId(e.target.value)}
          disabled={containerTypesLoading || containerTypesError}
          options={[
            {
              value: '',
              label: containerTypesError
                ? 'Lỗi tải loại container — thử lại'
                : containerTypesLoading
                ? 'Đang tải loại container…'
                : '— Chọn loại —',
            },
            ...containerTypes.map(type => ({ value: String(type.id), label: `${type.code} — ${type.name}` })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <UuiSelectField
          label="Chiều"
          value={direction}
          onChange={e => setDirection(e.target.value)}
          options={[
            { value: 'LIFT_UP', label: 'Nâng' },
            { value: 'LIFT_DOWN', label: 'Hạ' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <UuiSelectField
          label="Trạng thái hàng"
          value={loadState}
          onChange={e => setLoadState(e.target.value)}
          options={[
            { value: 'LOADED', label: 'Hàng' },
            { value: 'EMPTY', label: 'Rỗng' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Đơn giá (₫)"><input className="input" value={unitPrice} onChange={e => setUnitPrice(e.target.value)} placeholder="1200000" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => {
        if (!portId || !containerTypeId || !unitPrice.trim()) return;
        onsave({ portId: Number(portId), containerTypeId: Number(containerTypeId), direction, loadState, unitPrice });
      }} />
    </InlineForm>
  );
}

export default function LiftPricingConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  const portsQuery = usePorts();
  const containerTypesQuery = useContainerTypes();
  const { data: ports = [], isError: portsError, isLoading: portsLoading, refetch: refetchPorts } = portsQuery;
  const { data: containerTypes = [], isError: containerTypesError, isLoading: containerTypesLoading, refetch: refetchContainerTypes } = containerTypesQuery;
  const portNames = new Map(ports.map((port) => [port.id, port.name]));
  const containerTypeNames = new Map(containerTypes.map((type) => [type.id, type.code]));
  return (
    <div ref={pageRef}>
      <CrudTable<LiftPricing>
        title="Bảng giá nâng/hạ container" description="Đơn giá theo cảng/bãi, loại container, chiều nâng/hạ và trạng thái hàng/rỗng"
        endpoint="/lift-pricing" colSpan={6}
        pageSlug="lift-pricing"
        emptyTitle="Chưa có bảng giá nâng/hạ"
        emptyHint="Thêm mức giá đầu tiên cho cảng."
        columns={[
          { header: 'Chiều', render: (r) => <span style={{ fontWeight: 600 }}>{DIR_LABELS[r.direction] ?? r.direction}</span> },
          { header: 'Đơn giá (₫)', render: (r) => formatMoney(Number(r.unitPrice)) },
          { header: 'Cảng', render: (r) => portNames.get(r.portId) ?? 'Cảng không còn trong danh mục' },
          { header: 'Loại container', render: (r) => containerTypeNames.get(r.containerTypeId) ?? 'Không còn trong danh mục' },
          { header: 'Hàng/Rỗng', render: (r) => r.loadState === 'EMPTY' ? 'Rỗng' : 'Hàng' },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate },
        ]}
        renderForm={(p) => (
          <LiftPricingForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            ports={ports}
            portsError={portsError}
            portsLoading={portsLoading}
            onRetryPorts={() => void refetchPorts()}
            containerTypes={containerTypes}
            containerTypesError={containerTypesError}
            containerTypesLoading={containerTypesLoading}
            onRetryContainerTypes={() => void refetchContainerTypes()}
            onDelete={p.onDelete}
            deleting={p.deleting}
          />
        )}
      />
    </div>
  );
}
