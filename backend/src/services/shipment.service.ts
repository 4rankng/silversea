// Shipment Service — compatibility barrel over the shipment service leaves.
//
// The core module was split along lifecycle/review/detail-reads seams
// (maintainability round 3). The mutation + read surfaces now live in:
//
//   - shipment-lifecycle.service.ts — create/update, status transitions,
//     completion recompute, accountant direct close, fulfillment cancel,
//     soft delete.
//   - shipment-review.service.ts — e-POD review, change-request review,
//     POD file download.
//   - shipment-detail-reads.service.ts — getShipment/listShipments, status
//     history, carrier assignments, and the detail assembler.
//   - shipment-shared.service.ts — cross-leaf helpers (authority→trip sync,
//     scalar normalizers, pending change-request read).
//
// This file remains the canonical import path for consumers: every former
// export resolves from here via named re-exports (star re-exports are
// banned), and the pre-existing sibling-leaf re-exports below are preserved
// verbatim.

export {
  formatShipmentCode,
  createShipment,
  createShipmentIdempotent,
  assertShipmentFactorySiteValid,
  updateShipment,
  transitionShipmentStatus,
  recomputeShipmentCompletion,
  completeShipmentDirect,
  cancelShipmentFulfillment,
  softDeleteShipment,
} from './shipment-lifecycle.service';
export type {
  CreateShipmentInput,
  ShipmentUpdateResult,
  CancelShipmentFulfillmentResult,
} from './shipment-lifecycle.service';

export {
  downloadShipmentPodFile,
} from './shipment-review.service';

export {
  getShipment,
  listShipments,
  getShipmentDetail,
  listShipmentStatusHistory,
  listShipmentCarrierAssignments,
} from './shipment-detail-reads.service';
export type {
  ShipmentDetail,
  ListShipmentsPaginatedResult,
} from './shipment-detail-reads.service';

export { listPendingShipmentChangeRequests } from './shipment-shared.service';
export type {
  ShipmentChangeRequestRow,
  ShipmentChangeRequestSummary,
} from './shipment-shared.service';

// ─── Facade re-exports (T3b compatibility surface) ──────────────────────────
//
// The container + document mutation surfaces and list aggregates moved to
// sibling services during the T3b split. Re-exporting them here keeps every
// existing importer (routes, seeds, 14 test files) on a single canonical
// import path; new code should import from the owning module directly.

export { snapshotContainersIntoTrip } from './shipment-containers.service';
export {
  batchUpsertShipmentContainers,
  reconcileShipmentContainersInTx,
} from './shipment-containers.service';
export {
  attachShipmentDocument,
  upsertShipmentDeclaration,
  deleteShipmentDeclaration,
  checkExpiredDocuments,
  getDispatchReadiness,
  replaceShipmentDocument,
} from './shipment-documents.service';
export type { DispatchReadiness } from './shipment-documents.service';
export { ALLOCATION_STATUSES } from './shipment-queries.service';
export type { AllocationStatus, ShipmentCarrierAllocationSummaryEntry } from './shipment-queries.service';
export {
  hasDispatchDate,
  isDirectlyEditableIntakeStatus,
  assertDispatcherCanMutateShipmentIntake,
  ensureReadyShipmentHandoff,
  normalizeShipmentDocumentType,
  normalizeShipmentDeclarationScope,
} from './shipment-intake.service';

export type {
  ShipmentContainerInput,
  ShipmentContainerMutationResult,
  ShipmentDeclarationMutationInput,
  UpdateShipmentInput,
} from './shipment-types';
export { listShipmentsPaginated } from './shipment-queries.service';
export type { ListShipmentsOptions } from './shipment-queries.service';
export type { ShipmentStatus } from './shipment-types';
