import { useMemo } from 'react';
import { LCL_PACKAGE_TYPE_SUGGESTIONS } from '@tingting/shared';
import {
  USearchableField as SearchableField,
  UTextAreaField as TextAreaField,
  UTextField as TextField,
} from './uui-fields';
import { shipmentCreateGridStyle } from './ShipmentCreateSections';
import { useVehicleSizeClasses } from '../../../hooks/useCatalogQueries';
import { vehicleClassSectionedOptions } from '../../../lib/vehicle-class-options';
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
  // SIL-846 — the Trọng tải select reads the LIVE vehicle_size_classes
  // catalog (same source the Bảng giá engine and the debit workspace use),
  // never a hardcoded list.
  const vehicleClasses = useVehicleSizeClasses();
  const sortedClasses = useMemo(
    () => [...(vehicleClasses.data ?? [])].filter((vc) => !vc.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder),
    [vehicleClasses.data],
  );
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
              typing filters and free text commits through onCustomValue.
              SIL-846 (KH 15/11): QUY CÁCH ĐÓNG GÓI KHÔNG CÒN BẮT BUỘC — no
              `required` (no *), the suggestions stay, and a blank value still
              saves the lot. */}
          <SearchableField
            id="shipment-package-type"
            label="Quy cách đóng gói"
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
        <div data-field-id="shipment-rev-vehicle-class">
          {/* SIL-846 (KH 15/11): 'Trọng tải (Loại xe tính cước)' — LCL's
              pricing-class pick. Same grouped menu as the debit/ĐV popups
              (FB-138: "XE TẢI (TẤN)" | "CONTAINER" sections) over the live
              catalog. The value is the căn cứ the hệ thống tra Bảng giá cước
              thu khách on (pricing.service: KH × tuyến × loại xe); optional —
              blank leaves the class for the debit workspace to settle. */}
          <SearchableField
            id="shipment-rev-vehicle-class"
            label="Trọng tải (Loại xe tính cước)"
            value={form.revVehicleClassId}
            onChange={(value) => update('revVehicleClassId', value)}
            options={vehicleClassSectionedOptions(sortedClasses)}
            placeholder="Chọn loại xe (trọng tải / cont)"
            hint="Căn cứ tra Bảng giá cước thu khách cho lô hàng lẻ."
            searchable
            disabled={saving}
            error={issueByField.get('shipment-rev-vehicle-class')}
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
            // Spec 24/11 (item 03, wiki §9.2): the LCL form takes weight in
            // TẤN — the label names the input unit and the model converts to
            // the kg storage unit before the API call.
            label="Trọng lượng (tấn)"
            required
            type="number"
            min="0"
            step="0.001"
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
      {/* SIL-1133 (KB Chương 3 §3.2.4): "Mô tả hàng hóa" — the LCL cargo
          description the spec keeps OPTIONAL ("không bắt buộc"), so no
          requiredMark and no readiness seat. It persists through the driver
          note under the machine prefix "Mô tả hàng hóa: " (create model) and
          parses back on edit prefill. */}
      <div data-field-id="shipment-cargo-description">
        <TextAreaField
          label="Mô tả hàng hóa"
          value={form.cargoDescription}
          onChange={(event) => update('cargoDescription', event.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Mô tả ngắn về loại hàng, cách đóng gói..."
          disabled={saving}
        />
      </div>
    </div>
  );
}
