/**
 * Driver journey-board wire types (extracted from driverClient.ts for the
 * structure-guard split — driverClient was at its frozen LOC ceiling).
 *
 * 3a0bd5af: the card carries the trip's LAST-leg loadingType (ĐÓNG/TRẢ —
 * destination semantics, same rule the billing draft applies) and the
 * factory site address separately from the configured route name.
 */

export type DriverJourneyBucket = 'NEW' | 'RUNNING' | 'HISTORY';

export interface DriverJourneyCardContainer {
  containerNumber: string | null;
  containerTypeName: string | null;
  sealNumber: string | null;
  /** Display-ready payload ("15000"), null when unentered. */
  cargoWeightKg: string | null;
}

/** Raw fulfillment-owned classification (ĐƠN/KẸP/KẾT HỢP/LẺ/LẤY LẺ labels). */
export type DriverJourneyClassification = 'SINGLE' | 'DOUBLE' | 'COMBINED' | 'LCL' | 'LCL_PICKUP';

export interface DriverJourneyCard {
  fulfillmentId: number;
  tripId: number;
  shipmentId: number;
  tripCode: string | null;
  shipmentCode: string | null;
  /** Số Bill (IMPORT) / Số Booking (EXPORT) — the display key per internal-ids law. */
  blNumber: string | null;
  bookingRef: string | null;
  /** Lệnh chạy ngoài (MDN §4.4) — drives the "Chạy ngoài" label on the card. */
  isAdHoc: boolean;
  bucket: DriverJourneyBucket;
  classification: DriverJourneyClassification;
  linked: boolean;
  /** ACTIVE trip-pair this card's trip belongs to (kẹp/kết-hợp grouping). */
  pairId: number | null;
  pairKind: 'KEP' | 'KET_HOP' | null;
  pairOrder: 1 | 2 | null;
  /**
   * KẾT HỢP sequencing lock (TC-GHEP-010): true on the second card while the
   * first order is still unfinished — the app shows it locked until Lệnh 1
   * completes.
   */
  pairLocked: boolean;
  scheduledAt: string | null;
  /** Optional during rollout; completion time for the selected history month. */
  historyAt?: string | null;
  factoryName: string | null;
  factoryShortName: string | null;
  /** 3a0bd5af: factory site street address, kept for detail; the card uses routeName. */
  factoryAddress: string | null;
  loadingPortName: string | null;
  routeName: string | null;
  dropPortName: string | null;
  /** Canonical container dropoff port for IMPORT, including same-place delivery;
   *  for other directions only a distinct return stage is exposed. */
  returnDepotName: string | null;
  containerNumber: string | null;
  containerTypeName: string | null;
  sealNumber: string | null;
  /** shipments_containers.cargo_weight_kg, display-ready ("15000") — the
   *  card renders "· 15.000 kg" (card 20261004_356); null when unweighted. */
  cargoWeightKg: string | null;
  /**
   * SIL-815 — the trip's OWN containers (trip_containers), the exact list the
   * Chi tiết lệnh screen renders; the card must match it 100%. First entry
   * mirrors containerNumber/containerTypeName/sealNumber/cargoWeightKg.
   * Optional for wire skew: an older cached board (no field) renders the
   * singular strip alone.
   */
  containers?: DriverJourneyCardContainer[];
  /** 3a0bd5af: last-leg ĐÓNG/TRẢ (loại hình pill on the card). */
  loadingType: string | null;
  /** shipments.trade_direction — drives the container-row 3rd column
   *  (EXPORT → ĐÓNG, IMPORT → TRẢ, null → '—'). NOT the loadingType axis. */
  tradeDirection: string | null;
  contactName: string | null;
  contactPhone: string | null;
  truckPlate: string | null;
  trailerPlate: string | null;
  operationalNotes: string | null;
}
