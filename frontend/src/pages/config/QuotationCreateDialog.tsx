import { useId, useRef, useState, type FormEvent } from 'react';
import { quotationCreateSchema } from '@tingting/shared';
import { Btn } from '../../components/UI';
import { Alert } from '../../components/shared/Alert';
import { Modal, TextField, UuiSelectField, BufferedUuiDateInput } from '../../design-system';
import { useAllCustomers } from '../../hooks/useCatalogQueries';
import { useCreateQuotation } from '../../hooks/useQuotationQueries';

type FieldErrors = Partial<Record<'customerId' | 'templateName' | 'effectiveDate', string>>;

export function QuotationCreateDialog({ onClose, onCreated }: {
  onClose: () => void;
  onCreated: (id: number) => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const customers = useAllCustomers();
  const create = useCreateQuotation();
  const [customerId, setCustomerId] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [effectiveDate, setEffectiveDate] = useState('');
  const [rounding, setRounding] = useState('NONE');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const selectedCustomer = customers.data?.find(customer => String(customer.id) === customerId);
  const close = () => { if (!create.isPending) onClose(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (create.isPending) return;
    const parsed = quotationCreateSchema.safeParse({ customerId: Number(customerId), templateName, effectiveDate, surchargeRoundingMode: rounding, note });
    const validControls = formRef.current?.checkValidity();
    if (!parsed.success || !validControls) {
      const fields: FieldErrors = {};
      for (const issue of parsed.success ? [] : parsed.error.issues) {
        const field = issue.path[0];
        if (field === 'customerId') fields.customerId = 'Chọn khách hàng.';
        if (field === 'templateName') fields.templateName = templateName.trim() ? 'Tên mẫu báo giá tối đa 120 ký tự.' : 'Nhập tên mẫu báo giá.';
        if (field === 'effectiveDate') fields.effectiveDate = 'Chọn ngày hiệu lực hợp lệ.';
      }
      if (parsed.success && !validControls) fields.effectiveDate = 'Chọn ngày hiệu lực hợp lệ.';
      setErrors(fields);
      requestAnimationFrame(() => formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    setErrors({});
    try {
      const result = await create.mutateAsync(parsed.data);
      onCreated(result.id);
    } catch {
      // The mutation error is rendered below; retain the operator's draft.
    }
  }

  return (
    <Modal isOpen title="Tạo báo giá" onClose={close} backdropDismiss={false} polished
      footer={<><Btn onClick={close} disabled={create.isPending}>Hủy</Btn><Btn variant="primary" type="submit" form={formId} disabled={create.isPending || customers.isLoading || customers.isError}>{create.isPending ? 'Đang tạo…' : 'Tạo báo giá'}</Btn></>}
    >
      <form id={formId} ref={formRef} className="stack" onSubmit={submit} noValidate>
        {customers.isError && <Alert variant="error" style="soft">Không tải được danh sách khách hàng. <Btn size="sm" onClick={() => void customers.refetch()}>Thử lại</Btn></Alert>}
        {create.isError && <Alert variant="error" style="soft">{create.error.message}</Alert>}
        <UuiSelectField label="Khách hàng" value={customerId} required size="md" error={errors.customerId} hint={selectedCustomer?.name}
          disabled={create.isPending || customers.isLoading || customers.isError}
          options={[{ value: '', label: 'Chọn khách hàng' }, ...(customers.data ?? []).map(customer => ({ value: String(customer.id), label: customer.name }))]}
          onChange={event => { setCustomerId(event.target.value); setErrors(previous => ({ ...previous, customerId: undefined })); }} />
        <TextField label="Tên mẫu báo giá" value={templateName} required maxLength={120} error={errors.templateName} disabled={create.isPending} onChange={event => { setTemplateName(event.target.value); setErrors(previous => ({ ...previous, templateName: undefined })); }} />
        <BufferedUuiDateInput label="Ngày hiệu lực" value={effectiveDate} isRequired isInvalid={Boolean(errors.effectiveDate)} hint={errors.effectiveDate} isDisabled={create.isPending} onChange={value => { setEffectiveDate(value); setErrors(previous => ({ ...previous, effectiveDate: undefined })); }} />
        <UuiSelectField label="Làm tròn phụ phí dầu" value={rounding} size="md" disabled={create.isPending}
          options={[{ value: 'NONE', label: 'Không làm tròn' }, { value: 'THOUSAND', label: 'Đến hàng nghìn' }, { value: 'TEN_THOUSAND', label: 'Đến hàng chục nghìn' }]}
          onChange={event => setRounding(event.target.value)} />
        <TextField label="Ghi chú" value={note} maxLength={2000} disabled={create.isPending} onChange={event => setNote(event.target.value)} />
      </form>
    </Modal>
  );
}
