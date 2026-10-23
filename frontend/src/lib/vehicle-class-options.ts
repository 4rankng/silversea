// FB-138 (card 231026162327, QA R39 + design direction 24/10 owner-approved)
// — ONE shared option builder for every "Loại xe" dropdown that reads the
// vehicle_size_classes catalog (ĐV "Gán xe nhóm" · CUS "Gộp xe thu khách" ·
// the per-lot "Loại xe tính cước thu khách" strip).
//
// The dropdown renders a grouped menu with two section headers — truck
// tonnage classes under "XE TẢI (TẤN)", container classes under "CONTAINER"
// — instead of one flat list where a 13-row catalog hides the 7 tonnage
// rungs (exactly how QA missed them on the R39 retest). Not a segmented
// control (owner ruling 24/10): a searchable grouped listbox.
import type { VehicleSizeClass } from '@tingting/shared';

export const VEHICLE_CLASS_SECTION_TRUCK = 'XE TẢI (TẤN)';
export const VEHICLE_CLASS_SECTION_CONTAINER = 'CONTAINER';

export interface VehicleClassOption {
  value: string;
  label: string;
  searchText: string;
  section: string;
}

/**
 * Maps the catalog (already filtered for deletedAt and sorted by sortOrder by
 * the caller) into sectioned combobox options. Container classes sort after
 * tonnage classes via the catalog's own sortOrder (1–7 tải, 8+ cont).
 */
export function vehicleClassSectionedOptions(classes: VehicleSizeClass[]): VehicleClassOption[] {
  return classes.map((vc) => ({
    value: String(vc.id),
    label: vc.name,
    searchText: vc.code,
    section: vc.isContainer ? VEHICLE_CLASS_SECTION_CONTAINER : VEHICLE_CLASS_SECTION_TRUCK,
  }));
}
