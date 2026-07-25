import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';

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

function FuelNormForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: FuelNorm; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [loaded, setLoaded] = useState(item?.loadedLitersPer100Km || '');
  const [empty, setEmpty] = useState(item?.emptyLitersPer100Km || '');
  const [flatRate, setFlatRate] = useState(item?.flatRateLiters || '');
  const [note, setNote] = useState(item?.note || '');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Lit/100km (có hàng)"><input className="input" value={loaded} onChange={e => setLoaded(e.target.value)} placeholder="VD: 43" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Lit/100km (không hàng)"><input className="input" value={empty} onChange={e => setEmpty(e.target.value)} placeholder="VD: 25" /></Field>
      </div>
      <div style={{ flex: 1, minWidth: 100 }}>
        <Field label="Flat-rate (lit) — tuyến núi"><input className="input" value={flatRate} onChange={e => setFlatRate(e.target.value)} placeholder="VD: 80" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!loaded.trim() || !empty.trim()) return;
        onsave({ loadedLitersPer100Km: loaded, emptyLitersPer100Km: empty, flatRateLiters: flatRate || null, note: note || null });
      }} />
    </InlineForm>
  );
}

export default function FuelNormsConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<FuelNorm>
        title="Định mức nhiên liệu" description="Định mức tiêu hao nhiên liệu theo tuyến/xe (lit/100km)"
        endpoint="/fuel-norms" colSpan={4}
        pageSlug="fuel-norms"
        emptyTitle="Chưa có định mức nhiên liệu"
        emptyHint="Thêm định mức đầu tiên cho tuyến đường."
        columns={[
          { header: 'Có hàng (l/100km)', render: (r) => <span style={{ fontWeight: 600 }}>{r.loadedLitersPer100Km}</span> },
          { header: 'Không hàng', render: (r) => r.emptyLitersPer100Km },
          { header: 'Flat-rate', render: (r) => r.flatRateLiters ?? '—' },
          { header: 'Ngày hiệu lực', render: (r) => r.effectiveDate },
        ]}
        renderForm={(p) => <FuelNormForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
      />
    </div>
  );
}
