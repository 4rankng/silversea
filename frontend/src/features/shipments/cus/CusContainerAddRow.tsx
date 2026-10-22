import type { KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { UuiSelectField } from '../../../design-system';
import { BufferedUuiDateTimeInput } from '../../../design-system/forms/BufferedUuiDateTimeInput';
// Card 191026100000 (chungtu-dieuvan A.6): the shared ISO 6346 pre-check —
// the same warning + one-tap correction the trip container card shows.
import { checkContainerNumber } from '../../../components/trip/container-instance-helpers';

/**
 * The add-row draft: the container-add wire fields plus the A.1 copy set.
 * Card 201026124500 (181026185900 A.1), REVERSED by card 221026173728
 * (owner ruling 22/10, hủy ruling 21/10 card 211026112600): "Thêm container"
 * copies EVERY field of the lot's existing rows TRỪ Số container VÀ Loại
 * cont — Tuyến, Nhà xe, Nâng, Hạ, Trọng lượng and Giờ hẹn ride the seed
 * (and the submit), so the new row reads like the rows above it end to end;
 * Loại cont stays "Chưa chọn" for the operator's own pick. `*Name` fields
 * are the display mirrors of their id twins (the seeded cells render them).
 */
export interface AddContainerFields {
  containerNumber: string;
  containerTypeId: string;
  routeId: string;
  routeName: string | null;
  liftSiteId: string;
  liftSiteName: string | null;
  dropoffSiteId: string;
  dropoffSiteName: string | null;
  carrierType: 'OWN' | 'EXTERNAL' | '';
  externalCarrierId: string;
  carrierName: string | null;
  cargoWeightKg: string;
  customerAppointmentAt: string;
}

export const EMPTY_ADD_FIELDS: AddContainerFields = {
  containerNumber: '',
  containerTypeId: '',
  routeId: '',
  routeName: null,
  liftSiteId: '',
  liftSiteName: null,
  dropoffSiteId: '',
  dropoffSiteName: null,
  carrierType: '',
  externalCarrierId: '',
  carrierName: null,
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

  // Card 191026100000 (chungtu-dieuvan A.6): the strict ISO 6346 gate stays
  // the server's call, but a failing number is almost always one mistyped
  // digit — surface the live warning and the closest valid number BEFORE the
  // submit, so "thêm cont → vẫn lỗi" ends at a one-tap fix instead of a
  // dead-end 400. Informational only: Enter/Thêm still ride the server.
  const numberHint = checkContainerNumber(fields.containerNumber);

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
        {numberHint.warning && (
          <div className="cus-container-ledger__add-hint" role="note">
            <AlertTriangle size={14} aria-hidden="true" />
            <span>{numberHint.warning}</span>
            {numberHint.suggestion && (
              <button
                type="button"
                className="btn btn--secondary btn--sm"
                onClick={() => onChange({ containerNumber: numberHint.suggestion! })}
              >
                Đổi thành {numberHint.suggestion}
              </button>
            )}
          </div>
        )}
      </th>
      {/* Card 261022095235a: the tờ khai column's add-row cell stays EMPTY —
          the add API carries no document fields; the lot's number rides the
          server-side lot-default inherit (A.1+A.6), so the new row reads the
          lot's tờ khai the moment it lands. The cell keeps the track so no
          upstream column shifts. */}
      <td className="cus-container-ledger__add-blank" />
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
      {/* Card 201026124500 (A.1): the copy-down columns SHOW their seeded
          values in the add row — Tuyến/Nhà xe/Nâng/Hạ read like the rows
          above before the operator ever submits. Điều vận (computed dispatch
          status) and Biển số (per-truck entry, ngoài danh sách A.1) keep an
          empty cell; the row still covers every grid track so nothing
          upstream shifts (Chief 23/09). */}
      <td data-label="Tuyến" className="cus-container-cell">
        <strong>{fields.routeName || '—'}</strong>
      </td>
      <td className="cus-container-ledger__add-blank" />
      <td data-label="Nhà xe" className="cus-container-cell cus-container-cell--carrier">
        <strong>{fields.carrierName || '—'}</strong>
      </td>
      <td className="cus-container-ledger__add-blank" />
      <td data-label="Nâng" className="cus-container-cell">
        <strong>{fields.liftSiteName || '—'}</strong>
      </td>
      <td data-label="Hạ" className="cus-container-cell">
        <strong>{fields.dropoffSiteName || '—'}</strong>
      </td>
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
