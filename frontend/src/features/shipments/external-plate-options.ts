/** Card 20260925_6 — the external-vendor plate quick-select source: plates
 *  already used with THAT vendor, matched by name or short name (case- and
 *  trim-insensitive, exact). Empty until a name matches; free typing of a
 *  new plate always wins (the input stays a free-text field everywhere). */
export interface ExternalVendorPlateOption {
  value: string;
  label: string;
  searchText: string;
}

export function externalVendorPlateOptions(
  carriers: Array<{ id: number; name?: string | null; shortName?: string | null; label?: string }>,
  vehicles: Array<{ carrierId: number; licensePlate: string; label: string }>,
  newCarrierName: string,
): ExternalVendorPlateOption[] {
  const needle = newCarrierName.trim().toLowerCase();
  if (!needle) return [];
  const matched = new Set<number>();
  for (const carrier of carriers) {
    if ((carrier.name ?? '').trim().toLowerCase() === needle
      || (carrier.shortName ?? '').trim().toLowerCase() === needle) matched.add(carrier.id);
  }
  if (matched.size === 0) return [];
  const seen = new Set<string>();
  const options: ExternalVendorPlateOption[] = [];
  for (const vehicle of vehicles) {
    if (!matched.has(vehicle.carrierId) || seen.has(vehicle.licensePlate)) continue;
    seen.add(vehicle.licensePlate);
    options.push({ value: vehicle.licensePlate, label: vehicle.licensePlate, searchText: vehicle.licensePlate });
  }
  return options;
}
