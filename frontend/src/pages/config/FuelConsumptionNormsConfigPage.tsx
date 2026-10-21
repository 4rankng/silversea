import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useVehicleSizeClasses } from '../../hooks/useCatalogQueries';
import type { VehicleSizeClass } from '@tingting/shared';
import { Alert } from '../../components/shared/Alert';
import { DateInput } from '../../design-system/forms/DateInput';

/**
 * Định mức dầu tính cước — `fuel_consumption_norms` (D lít/km theo loại xe,
 * CuocPhiPhuPhiDau.md §4): đầu vào Step 3 của động cơ tính cước tự động.
 * KHÔNG phải bảng định mức chi phí `/config/fuel-norms` (tuyến × xe,
 * lit/100km) — hai bảng phục hai phía doanh/chi khác nhau.
 */

interface FuelConsumptionNorm {
  id: number;
  vehicleSizeClassId: number;
  litersPerKm: string;
  effectiveDate: string;
  note: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Validate theo trường, tiếng Việt — mirrors fuelConsumptionNormSchema
 * (shared): loại xe bắt buộc, lít/km > 0, ngày hiệu lực bắt buộc. */
function validate(input: {
  vehicleSizeClassId: number;
  litersPerKm: string;
  effectiveDate: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!Number.isInteger(input.vehicleSizeClassId) || input.vehicleSizeClassId <= 0) {
    errors.vehicleSizeClassId = 'Chọn loại xe trước khi lưu';
  }
  const liters = Number(input.litersPerKm);
  if (!input.litersPerKm.trim() || Number.isNaN(liters) || liters <= 0) {
    errors.litersPerKm = 'Định mức lít/km phải lớn hơn 0';
  }
  if (!input.effectiveDate.trim()) {
    errors.effectiveDate = 'Ngày hiệu lực là bắt buộc';
  }
  return errors;
}

function FuelConsumptionNormForm({
  saving,
  item,
  onsave,
  oncancel,
  classes,
  classesError,
  classesLoading,
  onRetryClasses,
  onDelete,
  deleting,
}: {
  saving: boolean;
  item?: FuelConsumptionNorm;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  classes: VehicleSizeClass[];
  classesError?: boolean;
  classesLoading?: boolean;
  onRetryClasses?: () => void;
  onDelete?: () => Promise<void>;
  deleting?: boolean;
}) {
  const [vehicleSizeClassId, setVehicleSizeClassId] = useState(item?.vehicleSizeClassId ?? 0);
  const [litersPerKm, setLitersPerKm] = useState(item?.litersPerKm ?? '');
  const [effectiveDate, setEffectiveDate] = useState(
    item?.effectiveDate ? item.effectiveDate.split('T')[0] : todayISO(),
  );
  const [note, setNote] = useState(item?.note || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Live-clear an error once the field becomes valid; only show errors after
  // the user has tried to submit (avoids yelling on first keystroke).
  function fieldError(key: 'vehicleSizeClassId' | 'litersPerKm' | 'effectiveDate'): string | undefined {
    if (!submitted) return undefined;
    return errors[key];
  }

  function handleSave() {
    setSubmitted(true);
    const found = validate({ vehicleSizeClassId, litersPerKm, effectiveDate });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onsave({
      vehicleSizeClassId,
      litersPerKm,
      effectiveDate,
      note: note || null,
    });
  }

  return (
    <InlineForm colSpan={4}>
      {classesError && (
        <div style={{ flex: '1 1 100%', marginBottom: 8 }}>
          <Alert
            variant="error"
            style="soft"
            action={
              onRetryClasses ? (
                <button type="button" className="btn btn--sm" onClick={onRetryClasses}>
                  Thử lại
                </button>
              ) : undefined
            }
          >
            Không thể tải danh mục loại xe.
          </Alert>
        </div>
      )}
      <div style={{ flex: 1, minWidth: 180 }}>
        <UuiSelectField
          label="Loại xe"
          value={String(vehicleSizeClassId)}
          onChange={e => setVehicleSizeClassId(Number(e.target.value))}
          disabled={classesLoading || classesError}
          error={fieldError('vehicleSizeClassId')}
          options={[
            {
              value: '0',
              label: classesError
                ? 'Lỗi tải danh mục loại xe — thử lại'
                : classesLoading
                ? 'Đang tải danh mục loại xe…'
                : '-- Chọn loại xe --',
            },
            ...classes.map(c => ({ value: String(c.id), label: c.name || c.code })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Định mức (lít/km)">
          <input
            className="input"
            type="number"
            min="0"
            step="0.0001"
            value={litersPerKm}
            onChange={e => setLitersPerKm(e.target.value)}
            placeholder="Ví dụ: 0.35 (CONT40)"
          />
        </Field>
        {fieldError('litersPerKm') && (
          <div className="field-error" style={{ color: 'var(--danger, #c0392b)', fontSize: 'var(--text-caption-size)', marginTop: 4 }}>{fieldError('litersPerKm')}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 150 }}>
        <Field label="Ngày hiệu lực">
          <DateInput
            className="input"
            value={effectiveDate}
            onChange={setEffectiveDate}
          />
        </Field>
        {fieldError('effectiveDate') && (
          <div className="field-error" style={{ color: 'var(--danger, #c0392b)', fontSize: 'var(--text-caption-size)', marginTop: 4 }}>{fieldError('effectiveDate')}</div>
        )}
      </div>
      <div style={{ flex: 2, minWidth: 180 }}>
        <Field label="Ghi chú">
          <input
            className="input"
            type="text"
            value={note}
            maxLength={500}
            onChange={e => setNote(e.target.value)}
            placeholder="Nguồn: hợp đồng / khách xác nhận…"
          />
        </Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} ondelete={onDelete} deleting={deleting} onsave={handleSave} />
    </InlineForm>
  );
}

export default function FuelConsumptionNormsConfigPage() {
  const classesQuery = useVehicleSizeClasses();
  const { data: classes = [], isError: classesError, isLoading: classesLoading, refetch: refetchClasses } = classesQuery;
  const classMap = useMemo(() => {
    const m = new Map<number, string>();
    classes.forEach(c => m.set(c.id, c.name || c.code));
    return m;
  }, [classes]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<FuelConsumptionNorm>
        title="Định mức dầu tính cước"
        description="Định mức tiêu hao dầu theo loại xe (lít/km) — đầu vào của động cơ tính cước tự động (E = km khứ hồi × định mức)"
        endpoint="/fuel-consumption-norms" colSpan={4}
        pageSlug="fuel-consumption-norms"
        emptyTitle="Chưa có định mức dầu tính cước"
        emptyHint="Thêm định mức lít/km đầu tiên cho một loại xe."
        columns={[
          { header: 'Loại xe', render: (r) => (r.vehicleSizeClassId ? (classMap.get(r.vehicleSizeClassId) || 'Loại xe không còn trong danh mục') : '—') },
          { header: 'Lít/km', className: 'num', render: (r) => <span style={{ fontWeight: 600 }}>{Number(r.litersPerKm).toFixed(4)}</span> },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate ? r.effectiveDate.split('T')[0] : '—' },
          { header: 'Ghi chú', render: (r) => r.note ?? '—' },
        ]}
        renderForm={(p) => (
          <FuelConsumptionNormForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            classes={classes}
            classesError={classesError}
            classesLoading={classesLoading}
            onRetryClasses={() => void refetchClasses()}
            onDelete={p.onDelete}
            deleting={p.deleting}
          />
        )}
      />
    </div>
  );
}
