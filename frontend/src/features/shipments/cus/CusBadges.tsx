import {
  SHIPMENT_STATUS_LABELS,
  ShipmentCusBucket,
  type ShipmentCusWorkspaceListItem,
} from '@tingting/shared';

export function WorkflowBadge({ item }: { item: ShipmentCusWorkspaceListItem }) {
  // Card 20260922_27 (operator): status renders as TEXT ONLY in data cells —
  // the bucket icon turned the label into a decorative blob.
  // PENDING_LOCK groups completed operational work awaiting accounting
  // finalization; show its actual state instead of the generic bucket label.
  // Driver full-closed shipments are LOCKED (locked
  // tab) even before an accounting lock row exists; that tab keeps the
  // bucket label because it groups heterogeneous sub-states (an active
  // accounting lock and the unlocked full-closed aggregate).
  const useStatusLabel = item.bucket === ShipmentCusBucket.NEW
    || item.bucket === ShipmentCusBucket.PENDING_LOCK;
  const label = useStatusLabel ? SHIPMENT_STATUS_LABELS[item.status] : item.bucketLabel;
  return (
    <span className={`cus-workflow-badge cus-workflow-badge--${item.bucket.toLowerCase()}`}>{label}</span>
  );
}
