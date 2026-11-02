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
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={shipmentCreateGridStyle}>
        <div data-field-id="shipment-package-type">
          {/* FB-079 (card 091026180800): suggestion combobox mirroring the
              Hãng tàu / nhà máy pickers — quick-pick the common formats, type
              anything else; custom values commit like before. Card
              211026130415 (verify-fail "ẨN sau default"): the `searchable`
              focus-trigger variant — the dropdown opens with the curated
              suggestions the moment the field is on ("dropdown mở có gợi ý sẵn
              từ đầu"), never hidden behind the type-first/ArrowDown trick;
              typing filters and free text commits through onCustomValue. */}
          <SearchableField
            id="shipment-package-type"
            label="Quy cách đóng gói"
            required
            value={form.packageType}
            onChange={(value) => update('packageType', value)}
            allowsCustomValue
            searchable
            onCustomValue={(text) => update('packageType', text)}
            options={packageTypeOptions}
            placeholder="Gợi ý quy cách (chọn hoặc gõ)"
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
        <div data-field-id="shipment-lcl-declaration-number">
          {/* SIL-660 (owner ruling 02/11): the lot-level Số tờ khai input is
              BACK for the hàng lẻ tab only — SIL-521 retired the lot-level
              entry while the LCL tab has no container table, leaving no
              declaration input at all (the customer complaint). SIL-601: lẻ
              = 1 lô 1 cont, so one input covers the lot. Persisted through
              the shipment_declarations entity by the save workflow (not the
              root payload — SIL-521 stands). FCL keeps its per-cont column
              (SIL-600/SIL-701). Optional: an empty value reconciles to "no
              declaration yet", never a validation error. Untitled UI base
              `input` via the shared UTextField primitive — same house
              pattern as the sibling quantity fields; no page-local styling. */}
          <TextField
            id="shipment-lcl-declaration-number"
            label="Số tờ khai"
            value={form.declarationNumber}
            onChange={(event) => update('declarationNumber', event.target.value)}
            disabled={saving}
            error={issueByField.get('shipment-lcl-declaration-number')}
          />
        </div>
      </div>
    </div>
  );
}
