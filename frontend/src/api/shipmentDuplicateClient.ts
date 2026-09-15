// Pre-flight Bill/Booking/declaration duplicate guard. Customer feedback
// 2026-09-07 (BL `JJCTCHPDY260305`) — keep this surface in its own file so
// the main `shipmentClient.ts` stays under its frozen structure-guard
// ceiling. The create form calls this debounced; the server still
// validates at write time, so the read is purely advisory.
import { api } from '../lib/api';

export interface ShipmentReferenceConflict {
  shipmentId: number;
  shipmentCode: string | null;
  field: 'blNumber' | 'bookingRef' | 'declaration';
  reference: string;
  createdBy: {
    id: number | null;
    username: string | null;
    fullName: string | null;
  } | null;
  createdAt: string;
}

export interface ShipmentDuplicateCheckResponse {
  conflicts: ShipmentReferenceConflict[];
}

export async function checkShipmentReferenceDuplicate(params: {
  blNumber?: string;
  bookingRef?: string;
  declarationNumber?: string;
  /** When editing an existing shipment, exclude it from the lookup so
   *  submitting its own current value doesn't self-conflict. */
  excludeShipmentId?: number;
}): Promise<ShipmentReferenceConflict[]> {
  const query = new URLSearchParams();
  if (params.blNumber) query.set('blNumber', params.blNumber);
  if (params.bookingRef) query.set('bookingRef', params.bookingRef);
  if (params.declarationNumber) query.set('declarationNumber', params.declarationNumber);
  if (params.excludeShipmentId != null) {
    query.set('excludeShipmentId', String(params.excludeShipmentId));
  }
  if (query.size === 0) return [];
  const response = await api.get<ShipmentDuplicateCheckResponse>(
    `/shipments/duplicate-check?${query.toString()}`,
  );
  return response.conflicts;
}
