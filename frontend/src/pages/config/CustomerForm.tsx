import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Loader2, Truck } from 'lucide-react';
import { Modal } from '../../components/UI';
import { UuiSelectField } from '../../design-system';
import {
  buildCustomerDebitNoteModeOptions,
  describeCustomerDebitNoteMode,
  type EditableCustomerDebitNoteMode,
} from '../../lib/customerDebitNoteMode';
import { qk } from '../../api/keys';
import { configClient } from '../../api/configClient';
import type { Customer, DebitNoteTemplate } from '@tingting/shared';
import { CustomerStatus } from '@tingting/shared';

export function toThresholdPercent(value: string | null | undefined): string {
  if (!value) return '';
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return '';
  return String(Math.round(ratio * 10000) / 100);
}

export function fromThresholdPercent(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const ratio = parsed / 100;
  if (ratio < 0.01 || ratio > 0.99) return null;
  return Math.round(ratio * 10000) / 10000;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="field"><label>{label} {children}</label></div>;
}

export function CustomerForm({ saving, item, onsave, oncancel }: {
  saving: boolean; item?: Customer; onsave: (d: Record<string, unknown>) => void; oncancel: () => void;
}) {
  const [name, setName] = useState(item?.name || '');
  const [taxCode, setTaxCode] = useState(item?.taxCode || '');
  const [contactPerson, setContactPerson] = useState(item?.contactPerson || '');
  const [phone, setPhone] = useState(item?.phone || '');
  const [contactInfo, setContactInfo] = useState(item?.contactInfo || '');
  const [creditLimit, setCreditLimit] = useState(item?.creditLimit || '');
  const [creditWarningThreshold, setCreditWarningThreshold] = useState(toThresholdPercent(item?.creditWarningThreshold));
  const [status, setStatus] = useState(item?.status || 'ACTIVE');
  const [isCarrier, setIsCarrier] = useState(item?.isCarrier ?? false);
  const [debitNoteMode, setDebitNoteMode] = useState<Customer['debitNoteMode']>(item?.debitNoteMode ?? 'MONTHLY');
  const [debitNoteTemplateId, setDebitNoteTemplateId] = useState<number | null>(item?.debitNoteTemplateId ?? null);
  const { data: templates } = useQuery<DebitNoteTemplate[]>({
    queryKey: qk.catalogs.debitNoteTemplates,
    queryFn: () => configClient.getDebitNoteTemplates(),
    staleTime: 60_000,
  });

  const debitNoteModeOptions = buildCustomerDebitNoteModeOptions(debitNoteMode);
  const debitNoteModeDescription = describeCustomerDebitNoteMode(debitNoteMode);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Tên khách hàng *">
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Nhập tên…" required />
        </Field>
        <Field label="Mã số thuế">
          <input className="input" value={taxCode} onChange={e => setTaxCode(e.target.value)} placeholder="Nhập MST…" />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Người liên hệ">
          <input className="input" value={contactPerson} onChange={e => setContactPerson(e.target.value)} placeholder="Tên người liên hệ…" />
        </Field>
        <Field label="Số điện thoại">
          <input className="input" value={phone} onChange={e => setPhone(e.target.value)} placeholder="SĐT liên hệ…" />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Field label="Hạn mức tín dụng">
          <input className="input" type="number" value={creditLimit} onChange={e => setCreditLimit(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Cảnh báo công nợ (%)">
          <input
            className="input"
            type="number"
            min="1"
            max="99"
            step="0.01"
            value={creditWarningThreshold}
            onChange={e => setCreditWarningThreshold(e.target.value)}
            placeholder="Mặc định hệ thống"
          />
        </Field>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <UuiSelectField
          label="Trạng thái"
          value={status}
          onChange={e => setStatus(e.target.value as CustomerStatus)}
          options={[
            { value: 'ACTIVE', label: 'Hoạt động' },
            { value: 'LOCKED', label: 'Tạm khoá' },
          ]}
        />
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <UuiSelectField
            label="Chu kỳ giấy báo nợ"
            value={debitNoteMode}
            onChange={e => setDebitNoteMode(e.target.value as EditableCustomerDebitNoteMode)}
            options={debitNoteModeOptions.map((option) => ({
              value: option.value,
              label: option.label,
              disabled: option.disabled,
            }))}
          />
          {debitNoteModeDescription ? (
            <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.4, color: 'var(--ink-3)' }}>
              {debitNoteModeDescription}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
          <input
            type="checkbox"
            checked={isCarrier}
            onChange={e => setIsCarrier(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent)' }}
          />
          <Truck size={14} />
          <span>Nhà xe (đối tác vận tải ngoài)</span>
        </label>
      </div>

      <Field label="Thông tin liên hệ khác / Địa chỉ">
        <textarea className="input" value={contactInfo} onChange={e => setContactInfo(e.target.value)} placeholder="SĐT, email, địa chỉ khác…" rows={3} style={{ resize: 'vertical' }} />
      </Field>

      <UuiSelectField
        label="Mẫu giấy báo nợ"
        value={debitNoteTemplateId === null || debitNoteTemplateId === undefined ? '' : String(debitNoteTemplateId)}
        onChange={e => setDebitNoteTemplateId(e.target.value === '' ? null : Number(e.target.value))}
        options={[
          { value: '', label: 'Dùng mẫu mặc định' },
          ...(templates ?? []).map(t => ({
            value: String(t.id),
            label: `${t.name}${t.isDefault ? ' — mặc định' : ''}`,
          })),
        ]}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
        <button type="button" className="btn btn--secondary" onClick={oncancel} disabled={saving}>Hủy</button>
        <button type="button" className="btn btn--primary" onClick={() => {
          if (!name.trim()) return;
          const threshold = fromThresholdPercent(creditWarningThreshold);
          if (creditWarningThreshold.trim() && threshold == null) return;
          onsave({
            name: name.trim(),
            taxCode: taxCode.trim() || null,
            contactPerson: contactPerson.trim() || null,
            phone: phone.trim() || null,
            contactInfo: contactInfo.trim() || null,
            creditLimit: creditLimit ? String(creditLimit) : null,
            creditWarningThreshold: threshold,
            status,
            debitNoteMode,
            debitNoteTemplateId,
            isCarrier,
          });
        }} disabled={saving}>
          {saving && <Loader2 size={14} className="spin" style={{ marginRight: 6 }} />}
          {item ? 'Cập nhật' : 'Thêm mới'}
        </button>
      </div>
    </div>
  );
}
