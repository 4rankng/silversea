import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Modal, TextField, UuiSelectField } from '../../design-system';
import { BufferedUuiDateInput } from '../../design-system/forms/BufferedUuiDateInput';
import { Btn } from '../../components/UI';
import { Alert } from '../../components/shared/Alert';
import { useQuotations } from '../../hooks/useQuotationQueries';
import { quotationClient } from '../../api/quotationClient';
import { qk } from '../../api/keys';
import { SURCHARGE_ROUNDING_MODES } from '@tingting/shared';
import type { QuotationCreateInput, SurchargeRoundingMode } from '@tingting/shared';

const ROUNDING_LABELS: Record<SurchargeRoundingMode, string> = {
  NONE: 'Không làm tròn',
  THOUSAND: 'Làm tròn 3 số (nghìn)',
  TEN_THOUSAND: 'Làm tròn 4 số (chục nghìn)',
};

/**
 * Tạo báo giá — the create dialog the config screen's "＋ Tạo báo giá"
 * action opens (card _56, previously a dead link). It builds the frame
 * payload the shared `quotationCreateSchema` governs: customer, template
 * name, effective date, the per-customer surcharge rounding rule and an
 * optional note. Cells and the Chi-phí-khác catalog start empty by design —
 * the created frame opens in the grid where the heSo cells and the fee
 * catalog are the editable surfaces.
 */
export function QuotationCreateDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const frames = useQuotations();
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [roundingMode, setRoundingMode] = useState<SurchargeRoundingMode>('NONE');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const customerOptions = useMemo(() => {
    const byId = new Map<number, string>();
    for (const frame of frames.data ?? []) {
      if (!byId.has(frame.customerId)) byId.set(frame.customerId, frame.customerName);
    }
    return [...byId.entries()]
      .sort(([, a], [, b]) => a.localeCompare(b))
      .map(([id, name]) => ({ value: String(id), label: name }));
  }, [frames.data]);

  const dateShapeOk = /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate);
  const canSave = customerId !== '' && templateName.trim() !== '' && dateShapeOk && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const body: QuotationCreateInput = {
      customerId: Number(customerId),
      templateName: templateName.trim(),
      effectiveDate,
      surchargeRoundingMode: roundingMode,
      note: note.trim() === '' ? null : note.trim(),
    };
    try {
      const { id } = await quotationClient.create(body);
      await queryClient.invalidateQueries({ queryKey: qk.catalogs.quotations });
      onCreated(id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không tạo được báo giá. Vui lòng thử lại.');
      setSaving(false);
    }
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Tạo báo giá"
      ariaLabel="Tạo báo giá"
      maxWidth={520}
      footer={<>
        <Btn size="sm" disabled={saving} onClick={onClose}>Hủy</Btn>
        <Btn size="sm" variant="primary" disabled={!canSave} onClick={() => void save()}>
          {saving ? 'Đang tạo…' : 'Tạo báo giá'}
        </Btn>
      </>}
    >
      <div className="stack">
        <UuiSelectField
          label="Khách hàng"
          value={customerId}
          onChange={(event) => setCustomerId(event.target.value)}
          options={[{ value: '', label: 'Chọn khách hàng' }, ...customerOptions]}
          disabled={frames.isPending}
          required
        />
        <TextField
          label="Tên biểu mẫu"
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
          placeholder="Ví dụ: Mẫu 1"
          required
        />
        <BufferedUuiDateInput
          label="Ngày hiệu lực"
          size="sm"
          value={effectiveDate}
          onChange={setEffectiveDate}
        />
        <UuiSelectField
          label="Làm tròn phụ phí"
          value={roundingMode}
          onChange={(event) => setRoundingMode(event.target.value as SurchargeRoundingMode)}
          options={SURCHARGE_ROUNDING_MODES.map((mode) => ({ value: mode, label: ROUNDING_LABELS[mode] }))}
        />
        <TextField
          label="Ghi chú"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Ghi chú cho biểu mẫu (không bắt buộc)"
        />
        <p className="quotation-status">
          Lưới hệ số và danh mục Chi phí khác tạo rỗng — chỉnh sửa ngay trên khung báo giá sau khi tạo.
        </p>
        {error && <Alert variant="error" style="soft">{error}</Alert>}
      </div>
    </Modal>
  );
}
