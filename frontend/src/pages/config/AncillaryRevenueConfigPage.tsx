import { useState } from 'react';
import { usePageAnimations } from '../../hooks/animations';
import { UuiSelectField } from '../../design-system';
import { InlineForm } from '../../components/config/InlineForm';
import { FormActions } from '../../components/config/FormActions';
import { Field } from '../../components/config/Field';
import { CrudTable } from '../../components/config/CrudTable';

interface AncillaryRevenue {
  id: number;
  customerId: number;
  type: 'LCL' | 'CONSOLIDATION' | 'SERVICE_DIFF' | 'OTHER';
  amount: string;
  tax: string;
  date: string;
  documentRef: string | null;
  note: string | null;
}

const TYPE_LABELS: Record<string, string> = {
  LCL: 'LCL (ghép lẻ)',
  CONSOLIDATION: 'Gom hàng',
  SERVICE_DIFF: 'Chênh lệch dịch vụ',
  OTHER: 'Khác',
};

function AncillaryRevenueForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: AncillaryRevenue; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [type, setType] = useState<string>(item?.type || 'LCL');
  const [amount, setAmount] = useState(item?.amount || '');
  const [note, setNote] = useState(item?.note || '');

  return (
    <InlineForm colSpan={4}>
      <div style={{ flex: 1, minWidth: 140 }}>
        <UuiSelectField
          label="Loại"
          value={type}
          onChange={e => setType(e.target.value)}
          options={[
            { value: 'LCL', label: 'LCL (ghép lẻ)' },
            { value: 'CONSOLIDATION', label: 'Gom hàng' },
            { value: 'SERVICE_DIFF', label: 'Chênh lệch dịch vụ' },
            { value: 'OTHER', label: 'Khác' },
          ]}
        />
      </div>
      <div style={{ flex: 1, minWidth: 120 }}>
        <Field label="Số tiền (₫)"><input className="input" value={amount} onChange={e => setAmount(e.target.value)} placeholder="500000" /></Field>
      </div>
      <div style={{ flex: 2, minWidth: 150 }}>
        <Field label="Ghi chú (bắt buộc khi hoàn tiền)"><input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Lý do…" /></Field>
      </div>
      <FormActions saving={saving} isedit={!!item} oncancel={oncancel} onsave={() => {
        if (!amount.trim()) return;
        const amt = Number(amount);
        if (amt < 0 && !note.trim()) return; // refund requires note
        onsave({ type, amount: amt, note: note || null });
      }} />
    </InlineForm>
  );
}

export default function AncillaryRevenueConfigPage() {
  const { rootRef: pageRef } = usePageAnimations({ ready: true, selectors: ['.cfg-row'] });
  return (
    <div ref={pageRef}>
      <CrudTable<AncillaryRevenue>
        title="Doanh thu phi-vận-tải" description="Doanh thu ngoài cước (LCL, gom hàng, chênh lệch dịch vụ) — hoàn tiền dùng số âm"
        endpoint="/ancillary-revenue" colSpan={4}
        pageSlug="ancillary-revenue"
        emptyTitle="Chưa có khoản doanh thu phi-vận-tải"
        emptyHint="Thêm khoản đầu tiên cho khách hàng."
        columns={[
          { header: 'Loại', render: (r) => <span style={{ fontWeight: 600 }}>{TYPE_LABELS[r.type] ?? r.type}</span> },
          { header: 'Số tiền (₫)', render: (r) => {
            const v = Number(r.amount); const cls: React.CSSProperties = v < 0 ? { color: 'var(--danger)' } : {};
            return <span style={cls}>{v.toLocaleString('vi-VN')}</span>;
          } },
          { header: 'Ngày', render: (r) => r.date },
          { header: 'Ghi chú', render: (r) => r.note ?? '—' },
        ]}
        renderForm={(p) => <AncillaryRevenueForm saving={p.saving} item={p.item} onsave={p.onSave} oncancel={p.onCancel} />}
      />
    </div>
  );
}
