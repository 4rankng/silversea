/**
 * Frontend feature flags. Kill-switch style — explicit opt-in only, default
 * OFF — mirroring the backend's `parseFlag()` convention in
 * `backend/src/config/index.ts`: only the literal strings "true"/"1"/"yes"
 * enable a flag. Everything else (including unset) stays off.
 */
function parseFlag(raw: string | undefined): boolean {
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/**
 * Driver-app spec (260827): the "Nhập chi phí lô hàng" (shipment cost entry)
 * form is backend-ready but must stay hidden from real drivers until the
 * rollout is approved. Default OFF.
 */
export function isShipmentCostEntryEnabled(): boolean {
  return parseFlag(import.meta.env.VITE_FEATURE_SHIPMENT_COST_ENTRY);
}
