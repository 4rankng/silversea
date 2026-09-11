/**
 * Driver journey-board wire types (extracted from driverClient.ts for the
 * structure-guard split — driverClient was at its frozen LOC ceiling).
 *
 * 3a0bd5af: the card carries the trip's LAST-leg loadingType (ĐÓNG/TRẢ —
 * destination semantics, same rule the billing draft applies) and the
 * factory site address for the Tuyến line, alongside the existing fields.
 */

export type DriverJourneyBucket = 'NEW' | 'RUNNING' | 'HISTORY';

/** Raw fulfillment-owned classification (ĐƠN/KẸP/KẾT HỢP/LẺ labels). */
export type DriverJourneyClassification = 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL';

export interface DriverJourneyCard {
  fulfillmentId: number;
  tripId: number;
  shipmentId: number;
  tripCode: string | null;
  shipmentCode: string | null;
  bucket: DriverJourneyBucket;
  classification: DriverJourneyClassification;
  linked: boolean;
  scheduledAt: string | null;
  factoryName: string | null;
  factoryShortName: string | null;
  /** 3a0bd5af: factory site street address — Tuyến line prefers it. */
  factoryAddress: string | null;
  loadingPortName: string | null;
  routeName: string | null;
  dropPortName: string | null;
  containerNumber: string | null;
  containerTypeName: string | null;
  sealNumber: string | null;
  /** 3a0bd5af: last-leg ĐÓNG/TRẢ (loại hình pill on the card). */
  loadingType: string | null;
  contactName: string | null;
  contactPhone: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  operationalNotes: string | null;
}
