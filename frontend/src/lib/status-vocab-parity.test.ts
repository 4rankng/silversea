import { describe, expect, it } from 'vitest';
import {
  ADVANCE_REQUEST_STATUS_LABELS,
  ADVANCE_SETTLEMENT_STATUS_LABELS,
  APPROVAL_STATUS_LABELS,
  CARRIER_TYPE_LABELS,
  DRIVER_INCIDENTAL_COST_LABELS,
  DRIVER_PROGRESS_EVENT_LABELS,
  FUEL_MODE_LABELS,
  LOADING_TYPE_LABELS,
  NOTIFICATION_TYPE_LABELS,
  PENALTY_STATUS_LABELS,
  ROLE_LABELS,
  SETTLEMENT_METHOD_LABELS,
  SHIPMENT_CUS_BUCKET_LABELS,
  SHIPMENT_DOCUMENT_CUSTODY_LABELS,
  SHIPMENT_DOCUMENT_TYPE_LABELS,
  SHIPMENT_STATUS_LABELS,
  SUPPLIER_TYPE_LABELS,
  TIRE_STATUS_LABELS,
  TRAILER_STATUS_LABELS,
  TRAILER_TYPE_LABELS,
  TRIP_STATUS_LABELS,
  TRUCK_CAP_ROLE_LABELS,
  AdvanceRequestStatus,
  AdvanceSettlementStatus,
  ApprovalStatus,
  CarrierType,
  DriverIncidentalCostType,
  DriverProgressEventType,
  FuelMode,
  LoadingType,
  NotificationType,
  PenaltyStatus,
  Role,
  SettlementMethod,
  ShipmentCusBucket,
  ShipmentDocumentCustody,
  ShipmentDocumentType,
  ShipmentStatus,
  SupplierType,
  TrailerStatus,
  TrailerType,
  TripStatus,
  TruckCapRole,
} from '@tingting/shared';

/**
 * Status-vocabulary parity guard (frontend side).
 *
 * The canonical Vietnamese label for every workflow status lives in
 * `@tingting/shared` `*_LABELS`. `Record<Enum, string>` typing enforces
 * completeness at compile time — this runtime check is the belt against
 * future loosening (casts, `Record<string, string>` refactors, enum members
 * added behind a suppress) and living documentation of the contract.
 *
 * Known DIVERGENT wording pairs (surfaced 2026-09-01, awaiting a product
 * decision — do NOT unify silently under a behavior-identical wave):
 *   - TripPodStatus.SUBMITTED: review panel "Chờ duyệt" vs submission
 *     "Đã gửi duyệt"; ACCEPTED: "Đã duyệt" vs "Đã chấp nhận"
 *     (TripPodReviewPanel.tsx / TripPodSubmission.tsx)
 *   - container dispatchStatus: CUS workboard "Đang chạy"/"Hoàn thành"/
 *     "Chưa điều xe" vs master-plan drawer "Đang vận chuyển"/"Hoàn tất"/
 *     "Chờ phân xe" (cusUtils.dispatchStatusLabel /
 *     DispatchContainerDetailDrawer.DISPATCH_STATUS_LABELS)
 */
describe('shared status vocabulary — label maps cover their enums exactly', () => {
  const pairs: [label: string, enumObject: object, labels: Record<string, string>][] = [
    ['TRIP_STATUS_LABELS', TripStatus, TRIP_STATUS_LABELS],
    ['SHIPMENT_STATUS_LABELS', ShipmentStatus, SHIPMENT_STATUS_LABELS],
    ['SHIPMENT_CUS_BUCKET_LABELS', ShipmentCusBucket, SHIPMENT_CUS_BUCKET_LABELS],
    ['SHIPMENT_DOCUMENT_CUSTODY_LABELS', ShipmentDocumentCustody, SHIPMENT_DOCUMENT_CUSTODY_LABELS],
    ['SHIPMENT_DOCUMENT_TYPE_LABELS', ShipmentDocumentType, SHIPMENT_DOCUMENT_TYPE_LABELS],
    ['PENALTY_STATUS_LABELS', PenaltyStatus, PENALTY_STATUS_LABELS],
    ['TRAILER_STATUS_LABELS', TrailerStatus, TRAILER_STATUS_LABELS],
    ['TRAILER_TYPE_LABELS', TrailerType, TRAILER_TYPE_LABELS],
    ['TIRE_STATUS_LABELS', { IN_STOCK: 'IN_STOCK', IN_USE: 'IN_USE', DISPOSED: 'DISPOSED' }, TIRE_STATUS_LABELS],
    ['FUEL_MODE_LABELS', FuelMode, FUEL_MODE_LABELS],
    ['LOADING_TYPE_LABELS', LoadingType, LOADING_TYPE_LABELS],
    ['ROLE_LABELS', Role, ROLE_LABELS],
    ['CARRIER_TYPE_LABELS', CarrierType, CARRIER_TYPE_LABELS],
    ['SETTLEMENT_METHOD_LABELS', SettlementMethod, SETTLEMENT_METHOD_LABELS],
    ['APPROVAL_STATUS_LABELS', ApprovalStatus, APPROVAL_STATUS_LABELS],
    ['ADVANCE_REQUEST_STATUS_LABELS', AdvanceRequestStatus, ADVANCE_REQUEST_STATUS_LABELS],
    ['ADVANCE_SETTLEMENT_STATUS_LABELS', AdvanceSettlementStatus, ADVANCE_SETTLEMENT_STATUS_LABELS],
    ['NOTIFICATION_TYPE_LABELS', NotificationType, NOTIFICATION_TYPE_LABELS],
    ['SUPPLIER_TYPE_LABELS', SupplierType, SUPPLIER_TYPE_LABELS],
    ['TRUCK_CAP_ROLE_LABELS', TruckCapRole, TRUCK_CAP_ROLE_LABELS],
    ['DRIVER_PROGRESS_EVENT_LABELS', DriverProgressEventType, DRIVER_PROGRESS_EVENT_LABELS],
    ['DRIVER_INCIDENTAL_COST_LABELS', DriverIncidentalCostType, DRIVER_INCIDENTAL_COST_LABELS],
  ];

  it.each(pairs)('%s keys match its enum exactly', (_name, enumObject, labels) => {
    const enumValues = Object.values(enumObject as Record<string, string>).sort();
    const labelKeys = Object.keys(labels).sort();
    expect(labelKeys).toEqual(enumValues);
    for (const value of labelKeys) {
      expect(labels[value].trim().length, `label for ${value}`).toBeGreaterThan(0);
    }
  });
});
