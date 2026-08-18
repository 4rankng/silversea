import { useState, useMemo } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';
import { useRoutesDropdown } from '../../hooks/useCatalogQueries';
import type { Route as RouteType } from '@tingting/shared';
import { DateInput } from '../../design-system/forms/DateInput';

interface FuelNorm {
  id: number;
  routeId: number | null;
  truckId: number | null;
  loadedLitersPer100Km: string;
  emptyLitersPer100Km: string;
  supplementLiters: string;
  flatRateLiters: string | null;
  effectiveDate: string;
  note: string | null;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

/** Validate the fuel-norm form. Returns a map of field → Vietnamese error,
 *  or an empty object when everything passes. Mirrors the rules in the spec
 *  for TC-M12-01-02 (effectiveDate required; loaded/empty required and > 0). */
function validate(input: {
  effectiveDate: string;
  loaded: string;
  empty: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!input.effectiveDate.trim()) {
    errors.effectiveDate = 'Ngày hiệu lực là bắt buộc';
  }
  const loadedNum = Number(input.loaded);
  if (!input.loaded.trim() || Number.isNaN(loadedNum) || loadedNum <= 0) {
    errors.loaded = 'Định mức có hàng phải lớn hơn 0';
  }
  const emptyNum = Number(input.empty);
  if (!input.empty.trim() || Number.isNaN(emptyNum) || emptyNum <= 0) {
    errors.empty = 'Định mức không hàng phải lớn hơn 0';
  }
  return errors;
}

function FuelNormForm({ saving, item, onsave, oncancel, routes }: {
  saving: boolean;
  item?: FuelNorm;
  onsave: (d: Record<string, unknown>) => void;
  oncancel: () => void;
  routes: RouteType[];
}) {
  const [routeId, setRouteId] = useState(item?.routeId ?? 0);
  const [loaded, setLoaded] = useState(item?.loadedLitersPer100Km || '');
  const [empty, setEmpty] = useState(item?.emptyLitersPer100Km || '');
  const [flatRate, setFlatRate] = useState(item?.flatRateLiters || '');
  const [effectiveDate, setEffectiveDate] = useState(
    item?.effectiveDate ? item.effectiveDate.split('T')[0] : todayISO(),
  );
  const [note] = useState(item?.note || '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitted, setSubmitted] = useState(false);

  // Live-clear an error once the field becomes valid; only show errors after
  // the user has tried to submit (avoids yelling at them on first keystroke).
  function fieldError(key: 'effectiveDate' | 'loaded' | 'empty'): string | undefined {
    if (!submitted) return undefined;
    return errors[key];
  }

  function handleSave() {
    setSubmitted(true);
    const found = validate({ effectiveDate, loaded, empty });
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    onsave({
      routeId: routeId || null,
      loadedLitersPer100Km: loaded,
      emptyLitersPer100Km: empty,
      flatRateLiters: flatRate || null,
      effectiveDate,
      note: note || null,
    });
  }

  return (
    <InlineForm colSpan={6}>
      <div style={{ flex: 2, minWidth: 180 }}>
        <UuiSelectField
          label="Tuyến đường"
          value={String(routeId)}
          onChange={e => setRouteId(Number(e.target.value))}
          options={[
            { value: '0', label: '-- Áp dụng chung --' },
            ...routes.map(r => ({ value: String(r.id), label: r.shortName || r.name })),
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 110 }}>
        <Field label="Lit/100km (có hàng)">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={loaded}
            onChange={e => setLoaded(e.target.value)}
            placeholder="VD: 30"
          />
        </Field>
        {fieldError('loaded') && (
          <div className="field-error" style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 4 }}>{fieldError('loaded')}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 110 }}>
        <Field label="Lit/100km (không hàng)">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={empty}
            onChange={e => setEmpty(e.target.value)}
            placeholder="VD: 25"
          />
        </Field>
        {fieldError('empty') && (
          <div className="field-error" style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 4 }}>{fieldError('empty')}</div>
        )}
      </div>
      <div style={{ flex: 1, minWidth: 110 }}>
        <Field label="Flat-rate (lit) — tuyến núi">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={flatRate}
            onChange={e => setFlatRate(e.target.value)}
            placeholder="VD: 40"
          />
        </Field>
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
          <div className="field-error" style={{ color: 'var(--danger, #c0392b)', fontSize: 12, marginTop: 4 }}>{fieldError('effectiveDate')}</div>
        )}
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={handleSave} />
    </InlineForm>
  );
}

export default function FuelNormsConfigPage() {
  const { data: routes = [] } = useRoutesDropdown();
  const routeMap = useMemo(() => {
    const m = new Map<number, string>();
    routes.forEach(r => m.set(r.id, r.name));
    return m;
  }, [routes]);

  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<FuelNorm>
        title="Định mức nhiên liệu" description="Định mức tiêu hao nhiên liệu theo tuyến/xe (lit/100km)"
        endpoint="/fuel-norms" colSpan={6}
        pageSlug="fuel-norms"
        emptyTitle="Chưa có định mức nhiên liệu"
        emptyHint="Thêm định mức đầu tiên cho tuyến đường."
        columns={[
          { header: 'Tuyến đường', render: (r) => (r.routeId ? (routeMap.get(r.routeId) || 'Tuyến đường không còn trong danh mục') : '— Áp dụng chung —') },
          { header: 'Có hàng (l/100km)', render: (r) => <span style={{ fontWeight: 600 }}>{r.loadedLitersPer100Km}</span> },
          { header: 'Không hàng', render: (r) => r.emptyLitersPer100Km },
          { header: 'Flat-rate', render: (r) => r.flatRateLiters ?? '—' },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate ? r.effectiveDate.split('T')[0] : '—' },
        ]}
        renderForm={(p) => (
          <FuelNormForm
            saving={p.saving}
            item={p.item}
            onsave={p.onSave}
            oncancel={p.onCancel}
            routes={routes}
          />
        )}
      />
    </div>
  );
}
