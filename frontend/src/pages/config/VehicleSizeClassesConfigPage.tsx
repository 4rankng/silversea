import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { Alert } from '../../components/shared/Alert';
import { useVehicleSizeClasses } from '../../hooks/useCatalogQueries';
import { LCL_VEHICLE_SOURCING_LABELS, lclVehicleSourcingRule } from '@tingting/shared';
import type { VehicleSizeClass } from '@tingting/shared';

function VehicleClassForm({
  saving,
  item,
  onsave,
  oncancel,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: VehicleSizeClass;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [code, setCode] = useState(item?.code || '');
  const [name, setName] = useState(item?.name || '');
  const [isContainer, setIsContainer] = useState(item?.isContainer ? '1' : '0');
  const [sortOrder, setSortOrder] = useState(String(item?.sortOrder ?? 0));
  return (
    <InlineForm colSpan={5}>
      <div style={{ flex: 1, minWidth: 130 }}>
        <Field label="Mã loại xe"><input className="input" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="Ví dụ: 5T, CONT20" maxLength={20} disabled={!!item} /></Field>
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Tên hiển thị"><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="VD: Xe 5 tấn" maxLength={50} /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <UuiSelectField
          label="Nhóm"
          value={isContainer}
          onChange={e => setIsContainer(e.target.value)}
          options={[
            { value: '0', label: 'Xe tải (trọng tải)' },
            { value: '1', label: 'Container' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Thứ tự"><input className="input" type="number" value={sortOrder} onChange={e => setSortOrder(e.target.value)} placeholder="0" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={() => {
        if (!code || !name) return;
        onsave({ code, name, isContainer: isContainer === '1', sortOrder: Number(sortOrder) || 0 });
      }} />
    </InlineForm>
  );
}

export default function VehicleSizeClassesConfigPage() {
  // The list itself streams through CrudTable's own query — this hook only
  // feeds the edit form's error/retry surface.
  const { isError, isLoading, refetch } = useVehicleSizeClasses();
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<VehicleSizeClass>
        title="Loại xe"
        description="Danh mục loại xe dùng cho hàng lẻ (LCL): trọng tải xe tải (1.25T…15T) bên cạnh các loại container. Quy tắc nguồn xe: xe tải = 100% xe ngoài; container = xe nội bộ hoặc xe ngoài"
        endpoint="/vehicle-size-classes"
        colSpan={5}
        pageSlug="vehicle-size-classes"
        iconName="truck"
        emptyContext="config"
        emptyTitle="Chưa có loại xe"
        emptyHint="Thêm loại xe đầu tiên (trọng tải hoặc container) để cấu hình bảng giá cước theo loại xe."
        sortFn={(a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code)}
        columns={[
          { header: 'Mã', render: (cls) => <span className="data-token">{cls.code}</span> },
          { header: 'Tên hiển thị', render: (cls) => cls.name },
          { header: 'Nhóm', render: (cls) => (cls.isContainer ? 'Container' : 'Xe tải') },
          {
            header: 'Quy tắc nguồn xe (LCL)',
            render: (cls) => LCL_VEHICLE_SOURCING_LABELS[lclVehicleSourcingRule(cls.isContainer)],
          },
          { header: 'Thứ tự', className: 'num', render: (cls) => cls.sortOrder },
        ]}
        renderForm={(p) => (
          <>
            {isError && (
              <div style={{ marginBottom: 8 }}>
                <Alert
                  variant="error"
                  style="soft"
                  action={<button type="button" className="btn btn--sm" onClick={() => void refetch()}>Thử lại</button>}
                >
                  Không thể tải danh mục loại xe.
                </Alert>
              </div>
            )}
            <VehicleClassForm
              saving={p.saving}
              item={p.item}
              onsave={p.onSave}
              oncancel={p.onCancel}
              onDelete={p.onDelete}
              deleting={p.deleting}
            />
            {isLoading && <p style={{ margin: 0, fontSize: 'var(--text-data-size)', color: 'var(--fg-3)' }}>Đang tải…</p>}
          </>
        )}
      />
    </div>
  );
}
