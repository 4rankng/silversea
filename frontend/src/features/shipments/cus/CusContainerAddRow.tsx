import type { KeyboardEvent } from 'react';
import { AlertTriangle } from 'lucide-react';
import { BufferedUuiDateTimeInput } from '../../../design-system/forms/BufferedUuiDateTimeInput';
// Card 191026100000 (chungtu-dieuvan A.6): the shared ISO 6346 pre-check —
// the same warning + one-tap correction the trip container card shows.
import { checkContainerNumber } from '../../../components/trip/container-instance-helpers';
// SIL-68 (CUS-04): the same type-to-open combobox the create flow's
// ContainerTypeCellPicker rides (20260921_1 law: gõ sau khi Tab sang ô Loại
// cont phải tự mở gợi ý). The house UUI combobox adapter is feature-owned by
// the create module — the detail ledger already imports it cross-feature, so
// this follows the established seam.
import { USearchableField } from '../create/uui-fields';

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
 * Cell order MUST track the ledger's SIL-483 grouped colgroup/thead:
 * Số tờ khai (blank) · Container (số + loại) · Tuyến · Nhà xe/BKS ·
 * Nâng/Hạ · Trọng lượng (kg) · Giờ hẹn đóng/trả · Thao tác.
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
  // combobox keeps Enter for committing a highlighted suggestion and the
  // buttons keep their own activation.
  const submitOnEnter = (event: KeyboardEvent<HTMLTableRowElement>) => {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target instanceof HTMLButtonElement) return;
    // The suggestion listbox lives in a portal — Enter inside it picks an
    // option, never submits the row. While the combobox's own menu is OPEN
    // (aria-expanded on its input), the combobox owns Enter: finishing a pick
    // must not also fire the add. With the menu closed the row's Enter-submit
    // law stands (SIL-68 kept the old select's contract: Enter in a resting
    // field still adds the row).
    if (target.closest('[role="listbox"], [role="option"]')) return;
    if (target.closest('[aria-expanded="true"]')) return;
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
      {/* The tờ khai column's add-row cell stays EMPTY — the add API carries
          no document fields; the lot's number rides the server-side
          lot-default inherit (A.1+A.6), so the new row reads the lot's tờ khai
          the moment it lands. The cell keeps the track so no upstream column
          shifts. */}
      <td className="cus-container-ledger__add-blank" />
      <th scope="row" data-label="Container" className="cus-container-cell cus-container-cell--identity">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            <input
              aria-label="Số container"
              placeholder="Số container"
              value={fields.containerNumber}
              onChange={(event) => onChange({ containerNumber: event.target.value })}
              autoFocus
              maxLength={50}
            />
          </div>
          <div className="cus-line cus-line--secondary">
            {/* SIL-68 (CUS-04): type-to-open suggestions. The native select
                showed no list until a mouse click; the combobox opens +
                prefix-filters ('2' → 20DC) the moment the operator types after
                Tab-ing in. The '' pseudo-option becomes the placeholder;
                clearing still commits '' through the shared onClear contract. */}
            <USearchableField
              label="Loại cont"
              hideLabel
              size="sm"
              openOnType
              className="cus-container-ledger__add-select"
              value={fields.containerTypeId}
              onChange={(value) => onChange({ containerTypeId: value })}
              options={containerTypes.map((type) => ({ value: String(type.id), label: type.code }))}
              placeholder="Chưa chọn loại cont"
              disabled={adding}
            />
          </div>
        </div>
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
      {/* Card 201026124500 (A.1): the copy-down columns SHOW their seeded
          values in the add row — Tuyến/Nhà xe/Nâng/Hạ read like the rows
          above before the operator ever submits. Điều vận (computed dispatch
          status) and Biển số (per-truck entry, ngoài danh sách A.1) keep an
          empty line; the row still covers every grid track so nothing
          upstream shifts (Chief 23/09). */}
      <td data-label="Tuyến" className="cus-container-cell">
        <strong>{fields.routeName || '—'}</strong>
      </td>
      <td data-label="Nhà xe/BKS" className="cus-container-cell cus-container-cell--carrier">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            <strong>{fields.carrierName || '—'}</strong>
          </div>
          <div className="cus-line cus-line--secondary">
            <span>—</span>
          </div>
        </div>
      </td>
      <td data-label="Nâng/Hạ" className="cus-container-cell cus-container-cell--num">
        <div className="cus-group">
          <div className="cus-line cus-line--primary">
            <strong>{fields.liftSiteName || '—'}</strong>
          </div>
          <div className="cus-line cus-line--secondary">
            <span>{fields.dropoffSiteName || '—'}</span>
          </div>
        </div>
      </td>
      <td data-label="Trọng lượng (kg)" className="cus-container-cell cus-container-cell--num">
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
