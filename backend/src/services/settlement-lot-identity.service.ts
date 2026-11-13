/**
 * SIL-811 — lot container identity behind the settlement slip's group titles.
 *
 * The identity line of every per-lot expense group (customer shorthand ·
 * Bill/Booking + tờ khai · Số cont) needs the lot's container roll-call and
 * its per-cont tờ khai (card 261013200312: tờ khai is a CONTAINER attribute).
 * One batched loader + one pure attach serve every settlement reader (ops
 * settlement detail, the /my-settlements list, the advance-settlement detail)
 * so all slips print the same identity.
 */
import { asc, inArray } from 'drizzle-orm';
import type { Executor } from '../db';
import * as s from '../db/schema';

export interface LotContainerIdentity {
  /** The lot's container rows (id-asc): number + that cont's tờ khai. */
  containers: Array<{ containerNumber: string | null; declarationNumber: string | null }>;
  /** Named containers only (id-asc, deduped) — the merged roll-call source. */
  lotContainerNumbers: string[];
  /** Non-empty tờ khai across the lot's containers (id-asc, deduped). */
  lotDeclarationNumbers: string[];
}

/** Batch-fetch every shipment's container identity in ONE query. */
export async function loadLotContainerIdentities(
  executor: Executor,
  shipmentIds: readonly (number | null)[],
): Promise<Map<number, LotContainerIdentity>> {
  const identities = new Map<number, LotContainerIdentity>();
  const ids = [...new Set(shipmentIds.filter((id): id is number => id != null))];
  if (ids.length === 0) return identities;
  const rows = await executor
    .select({
      shipmentId: s.shipmentContainers.shipmentId,
      containerNumber: s.shipmentContainers.containerNumber,
      declarationNumber: s.shipmentContainers.declarationNumber,
    })
    .from(s.shipmentContainers)
    .where(inArray(s.shipmentContainers.shipmentId, ids))
    .orderBy(asc(s.shipmentContainers.id));
  for (const row of rows) {
    let identity = identities.get(row.shipmentId);
    if (!identity) {
      identity = { containers: [], lotContainerNumbers: [], lotDeclarationNumbers: [] };
      identities.set(row.shipmentId, identity);
    }
    identity.containers.push(row);
    const number = row.containerNumber?.trim();
    if (number && !identity.lotContainerNumbers.includes(number)) identity.lotContainerNumbers.push(number);
    const decl = row.declarationNumber?.trim();
    if (decl && !identity.lotDeclarationNumbers.includes(decl)) identity.lotDeclarationNumbers.push(decl);
  }
  return identities;
}

/**
 * Attach the lot identity fields to one expense row. The row's own tờ khai is
 * the one its CONTAINER carries (lot-wide rows carry none); the lot lists feed
 * the merged roll-call ('2 cont: …'). Attach AFTER any settlement-snapshot
 * override so the display matches the snapshot's container scope.
 */
export function withLotIdentity<T extends { containerNumber?: string | null }>(
  entry: T,
  identity: LotContainerIdentity | undefined,
): T & { declarationNumber: string | null; lotContainerNumbers: string[]; lotDeclarationNumbers: string[] } {
  const cont = entry.containerNumber?.trim();
  return {
    ...entry,
    declarationNumber: cont
      ? identity?.containers.find((row) => row.containerNumber?.trim() === cont)?.declarationNumber?.trim() || null
      : null,
    lotContainerNumbers: identity?.lotContainerNumbers ?? [],
    lotDeclarationNumbers: identity?.lotDeclarationNumbers ?? [],
  };
}
