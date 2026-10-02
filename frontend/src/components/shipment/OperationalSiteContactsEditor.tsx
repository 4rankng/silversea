import { useId } from 'react';
import type { OperationalSiteContact } from '@tingting/shared';
import { TextField } from '../../design-system';
import { Btn } from '../UI';
import './OperationalSiteContactsEditor.css';

export function OperationalSiteContactsEditor({ value, onChange, disabled = false }: {
  value: OperationalSiteContact[];
  onChange: (contacts: OperationalSiteContact[]) => void;
  disabled?: boolean;
}) {
  const radioName = useId();
  const update = (index: number, patch: Partial<OperationalSiteContact>) => onChange(value.map((contact, i) => i === index ? { ...contact, ...patch } : contact));
  return <fieldset className="site-contacts-editor" disabled={disabled}>
    <legend>Liên hệ nhà máy / kho</legend>
    {value.map((contact, index) => <div className="site-contacts-editor__row" key={index}>
      <TextField id={`${radioName}-name-${index}`} label={`Tên liên hệ ${index + 1}`} value={contact.name} maxLength={120} required disabled={disabled} onChange={event => update(index, { name: event.target.value })} />
      <TextField id={`${radioName}-phone-${index}`} label={`Số điện thoại ${index + 1}`} value={contact.phone} maxLength={30} required disabled={disabled} onChange={event => update(index, { phone: event.target.value })} />
      <label className="site-contacts-editor__default"><input type="radio" name={radioName} checked={contact.isDefault} onChange={() => onChange(value.map((entry, i) => ({ ...entry, isDefault: i === index })))} /> Mặc định</label>
      <Btn variant="ghost" size="sm" disabled={disabled} onClick={() => {
        const remaining = value.filter((_, i) => i !== index);
        if (remaining.length && !remaining.some(entry => entry.isDefault)) remaining[0] = { ...remaining[0], isDefault: true };
        onChange(remaining);
      }} aria-label={`Xóa liên hệ ${index + 1}`}>Xóa</Btn>
    </div>)}
    <Btn variant="secondary" size="sm" disabled={disabled || value.length >= 20} onClick={() => onChange([...value, { name: '', phone: '', isDefault: value.length === 0 }])}>Thêm liên hệ</Btn>
  </fieldset>;
}
