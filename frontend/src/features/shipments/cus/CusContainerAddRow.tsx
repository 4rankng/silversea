import type { KeyboardEvent } from 'react';
import { UuiSelectField } from '../../../design-system';
import { BufferedUuiDateTimeInput } from '../../../design-system/forms/BufferedUuiDateTimeInput';

/** The four fields the container-add API accepts; one add-row draft. */
export interface AddContainerFields {
  containerNumber: string;
  containerTypeId: string;
  cargoWeightKg: string;
  customerAppointmentAt: string;
}

export const EMPTY_ADD_FIELDS: AddContainerFields = {
  containerNumber: '',
  containerTypeId: '',
  cargoWeightKg: '',
  customerAppointmentAt: '',
};

/**
 * Drawer ledger's add-container row (card 20260923_9).
 *
 * Rendered as the ledger table's `<tfoot>` row so the fields ride the SAME
 * column grid as the container rows above: every control sits in its own
 * column's cell and every column without an input keeps an empty cell, so the
 * inputs' left edges line up with the column edges at every drawer width —
 * a free-floating flex form could not hold that promise (Chief 23/09 defect
 * "form thêm container không thẳng cột với bảng phía trên").
 *
 * Cell order MUST track the ledger's colgroup/thead:
 * Container · Loại cont · Tuyến · Điều vận · Nhà xe · Biển số · Nâng · Hạ ·
 * Trọng lượng (kg) · Giờ hẹn đóng/trả · Thao tác.
 */
export function CusContainerAddRow({
  fields,
  containerTypes,
  adding,
  onChange,
  onSubmit,
  onCancel,
}: {
  fields: AddContainerFields;
  containerTypes: Array<{ id: number; code: string }>;
  adding: boolean;
  onChange: (patch: Partial<AddContainerFields>) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  // Native implicit submission is gone with the <form> element (a form cannot
  // wrap a table row): Enter in the text fields submits the row, while the
  // house select keeps Enter for committing a typed option and the buttons
  // keep their own activation.
  const submitOnEnter = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLButtonElement) return;
    if (target.closest('.cus-container-ledger__add-select, [role="listbox"]')) return;
    event.preventDefault();
    onSubmit();
  };

  return (
    <tr className="cus-container-ledger__add-row" onKeyDown={submitOnEnter}>
      <th scope="row" data-label="Container" className="cus-container-cell cus-container-cell--identity">
        <input
          aria-label="Số container"
          placeholder="Số container"
          value={fields.containerNumber}
          onChange={(event) => onChange({ containerNumber: event.target.value })}
          autoFocus
          maxLength={50}
        />
      </th>
      <td data-label="Loại cont" className="cus-container-cell">
        <UuiSelectField
          label="Loại cont"
          hideLabel
          size="sm"
          wrapperClassName="cus-container-ledger__add-select"
          value={fields.containerTypeId}
          onChange={(event) => onChange({ containerTypeId: event.target.value })}
          options={[
            { value: '', label: 'Chưa chọn loại cont' },
            ...containerTypes.map((type) => ({ value: String(type.id), label: type.code })),
          ]}
        />
      </td>
      {/* Columns the add API does not fill keep an empty cell: the row covers
          every grid track so nothing upstream shifts (Chief 23/09). */}
      <td className="cus-container-ledger__add-blank" />
      <td className="cus-container-ledger__add-blank" />
      <td className="cus-container-ledger__add-blank" />
      <td className="cus-container-ledger__add-blank" />
      <td className="cus-container-ledger__add-blank" />
      <td className="cus-container-ledger__add-blank" />
      <td data-label="Trọng lượng (kg)" className="cus-container-cell">
        <input
          aria-label="Trọng lượng (kg)"
          placeholder="Trọng lượng (kg)"
          value={fields.cargoWeightKg}
          onChange={(event) => onChange({ cargoWeightKg: event.target.value })}
          inputMode="decimal"
        />
      </td>
      <td data-label="Giờ hẹn đóng/trả" className="cus-container-cell">
        <BufferedUuiDateTimeInput
          aria-label="Giờ hẹn đóng/trả"
          value={fields.customerAppointmentAt}
          onChange={(customerAppointmentAt) => onChange({ customerAppointmentAt })}
        />
      </td>
      <td data-label="Thao tác" className="cus-container-cell cus-container-cell--actions">
        <div className="cus-container-ledger__add-actions">
          <button type="button" className="btn btn--primary btn--sm" onClick={onSubmit} disabled={adding}>
            {adding ? 'Đang thêm…' : 'Thêm'}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={onCancel}>
            Hủy
          </button>
        </div>
      </td>
    </tr>
  );
}
