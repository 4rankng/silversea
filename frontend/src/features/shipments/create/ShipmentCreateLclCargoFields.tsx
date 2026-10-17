import { LCL_PACKAGE_TYPE_SUGGESTIONS } from '@tingting/shared';
import {
  USearchableField as SearchableField,
  UTextField as TextField,
} from './uui-fields';
import { shipmentCreateGridStyle } from './ShipmentCreateSections';
import type { ShipmentCreateFormState } from './shipment-create-model';

type FormState = ShipmentCreateFormState;

/** Round 19 ("để trưởng gọi ý giống nhà máy - sau thêm trường cố định"):
 *  the curated packaging suggestions live in shared
 *  (LCL_PACKAGE_TYPE_SUGGESTIONS) so the future fixed-catalog card and any
 *  sibling surface read one vocabulary. Suggestions only: any custom value
 *  still types through, preserving the 2026-09-06 free-text guarantee. */
const packageTypeOptions = LCL_PACKAGE_TYPE_SUGGESTIONS.map((label) => ({ value: label, label }));

export interface ShipmentCreateLclCargoFieldsProps {
  form: FormState;
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  saving: boolean;
  issueByField: Map<string, string>;
}

export function ShipmentCreateLclCargoFields({
  form,
  update,
  saving,
  issueByField,
}: ShipmentCreateLclCargoFieldsProps) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={shipmentCreateGridStyle}>
        <div data-field-id="shipment-package-type">
          {/* FB-079 (card 091026180800): suggestion combobox mirroring the
              Hãng tàu / nhà máy pickers — quick-pick the common formats, type
              anything else; custom values commit like before. openOnType so
              typing itself surfaces the suggestions (click still opens the
              full list). */}
          <SearchableField
            id="shipment-package-type"
            label="Quy cách đóng gói"
            required
            value={form.packageType}
            onChange={(value) => update('packageType', value)}
            allowsCustomValue
            openOnType
            options={packageTypeOptions}
            placeholder="Chọn hoặc nhập quy cách (Pallet, Roll, Carton…)"
            disabled={saving}
            error={issueByField.get('shipment-package-type')}
          />
        </div>
        <div data-field-id="shipment-package-count">
          <TextField
            id="shipment-package-count"
            label="Số lượng"
            required
            type="number"
            min="1"
            step="1"
            value={form.packageCount}
            onChange={(event) => update('packageCount', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-package-count')}
          />
        </div>
        <div data-field-id="shipment-cargo-weight">
          <TextField
            id="shipment-cargo-weight"
            label="Trọng lượng (kg)"
            required
            type="number"
            min="0"
            step="0.01"
            value={form.cargoWeightKg}
            onChange={(event) => update('cargoWeightKg', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-cargo-weight')}
          />
        </div>
        <div data-field-id="shipment-cargo-volume">
          {/* QA1-007: deliberately NOT `required` — CBM is optional for LCL
              (helpdesk 2026-10-13, ops Tiếp Vu); an entered value must only be
              > 0 (shipment-create-model readiness). The missing asterisk is
              the contract, not a gap. */}
          <TextField
            id="shipment-cargo-volume"
            label="Thể tích (CBM)"
            type="number"
            min="0"
            step="0.001"
            value={form.cargoVolumeCbm}
            onChange={(event) => update('cargoVolumeCbm', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-cargo-volume')}
          />
        </div>
      </div>
    </div>
  );
}
