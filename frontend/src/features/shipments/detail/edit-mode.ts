/**
 * Shared edit-mode vocabulary for the CUS shipment detail surface. Lives in a
 * leaf module so ShipmentContainerLedger and ShipmentMissingFieldsSummary can
 * both depend on it without forming an import cycle.
 */
export type ShipmentDetailEditMode = 'identity' | 'documents' | 'container' | 'route' | 'schedule' | 'vehicle' | 'notes';

/** Human label for a jump-to-editor trigger, reusing the same cell vocabulary as the ledger cells. */
export function modeLabelForTrigger(mode: ShipmentDetailEditMode): string {
  if (mode === 'identity') return 'khách hàng và lộ trình';
  if (mode === 'documents') return 'chứng từ và hãng tàu';
  if (mode === 'container') return 'thông số container';
  if (mode === 'route') return 'điểm nâng hạ';
  if (mode === 'vehicle') return 'phân xe';
  if (mode === 'schedule') return 'lịch trình';
  return 'ghi chú';
}
