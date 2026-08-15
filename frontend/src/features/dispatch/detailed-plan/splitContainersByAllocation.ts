import type { ShipmentCarrierAllocationSummaryEntry } from '../../../api/shipmentClient';

export interface SplitContainerInput {
  id: number;
  containerNumber: string | null;
  /** Bucket derived from the container type (20' before 40'). */
  bucket: 20 | 40 | null;
  containerTypeLabel: string | null;
}

export interface SplitContainerRow {
  containerId: number;
  containerNumber: string | null;
  containerTypeLabel: string | null;
  bucket: 20 | 40 | null;
  /** null → container not covered by any allocation group yet. */
  carrierLabel: string | null;
  carrierType: 'OWN' | 'EXTERNAL' | null;
  externalCarrierId: number | null;
}

/**
 * Read-time auto-split (docx §5): walk containers in deterministic bucket
 * order (20' first, then 40', stable by input order) and assign each the next
 * allocation group's slot in array order. Purely derived — nothing persisted.
 * Containers beyond the allocated totals get carrierLabel null ("Chưa gán nhà xe").
 */
export function splitContainersByAllocation(
  containers: ReadonlyArray<SplitContainerInput>,
  allocationSummary: ReadonlyArray<ShipmentCarrierAllocationSummaryEntry>,
): SplitContainerRow[] {
  const ordered = [...containers].sort((a, b) => {
    const rank = (bucket: 20 | 40 | null) => (bucket === 20 ? 0 : bucket === 40 ? 1 : 2);
    return rank(a.bucket) - rank(b.bucket);
  });

  // Bucket-aware slot queues: a 20-slot can only take a 20' container. Groups
  // emit their 20' slots first, preserving group order within each bucket.
  const slotByBucket = new Map<20 | 40, Array<{
    carrierType: 'OWN' | 'EXTERNAL';
    externalCarrierId: number | null;
    carrierLabel: string;
  }>>();
  for (const group of allocationSummary) {
    for (let i = 0; i < group.count20; i += 1) {
      const list = slotByBucket.get(20) ?? [];
      list.push({ carrierType: group.carrierType, externalCarrierId: group.externalCarrierId, carrierLabel: group.carrierLabel });
      slotByBucket.set(20, list);
    }
    for (let i = 0; i < group.count40; i += 1) {
      const list = slotByBucket.get(40) ?? [];
      list.push({ carrierType: group.carrierType, externalCarrierId: group.externalCarrierId, carrierLabel: group.carrierLabel });
      slotByBucket.set(40, list);
    }
  }

  return ordered.map((container) => {
    const assigned = container.bucket != null ? slotByBucket.get(container.bucket)?.shift() ?? null : null;
    return {
      containerId: container.id,
      containerNumber: container.containerNumber,
      containerTypeLabel: container.containerTypeLabel,
      bucket: container.bucket,
      carrierLabel: assigned?.carrierLabel ?? null,
      carrierType: assigned?.carrierType ?? null,
      externalCarrierId: assigned?.externalCarrierId ?? null,
    };
  });
}
