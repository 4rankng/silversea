/**
 * LCL lot-grouping LAW, pure (spec 23/10 / 261023110000 + FB-092/093).
 *
 * Everything here is a pure decision the unit tree can exercise directly —
 * no db, no app boot (BE unit-only ruling 2026-10-19). The db-bound command
 * services (lcl-grouping.service.ts) build their row patches and validation
 * through these helpers so the two money dimensions' independence and the
 * same-customer merge law are testable behavior, not source text.
 */
import { ApiError } from '../errors';

// ─── Row patches — the two dimensions write COMPLETELY disjoint columns ────

export interface CostGroupMemberPatchArgs {
  /** The new/kept group id (uuid). */
  groupId: string;
  /** 1-based group order — 1 is the principal carrying 100% cước trả ĐV. */
  order: number;
  /** BKS thực — the group's one physical truck. */
  actualTruckNo: string;
  /** Loại xe tính cước trả ĐV — vehicle_size_classes.id. */
  costVehicleClassId: number;
  /** Spec 23/10 — the manual "Cước trả ĐVVC" (VND string) on Lô 1 only;
   *  null clears it (auto-trace). Omitted ⇒ column untouched. */
  costGroupFreightManual?: string | null;
  version: number;
  updatedBy: number;
  now: Date;
}

/**
 * The full shipment-column write of a COST ("trả ĐV") group membership.
 * NEVER contains a rev-side key — gộp ĐV không kéo CUS (and vice versa:
 * `revGroupMemberPatch` never contains a cost-side key).
 */
export function costGroupMemberPatch(args: CostGroupMemberPatchArgs): Record<string, unknown> {
  return {
    costGroupId: args.groupId,
    costGroupOrder: args.order,
    actualTruckNo: args.actualTruckNo,
    costVehicleClassId: args.costVehicleClassId,
    ...(args.costGroupFreightManual !== undefined
      ? { costGroupFreightManual: args.costGroupFreightManual }
      : {}),
    version: args.version,
    updatedBy: args.updatedBy,
    updatedAt: args.now,
  };
}

export interface RevGroupMemberPatchArgs {
  /** The new/kept group id (uuid). */
  groupId: string;
  /** 1-based group order — 1 is the principal carrying 100% cước thu. */
  order: number;
  /** Loại xe thu nhóm — vehicle_size_classes.id. */
  revVehicleClassId: number;
  /** BKS báo khách chung nhóm; undefined ⇒ every lot keeps its own value. */
  billingTruckNo?: string | null;
  version: number;
  updatedBy: number;
  now: Date;
}

/**
 * The full shipment-column write of a REV ("thu khách") group membership.
 * NEVER contains a cost-side key (costGroupId/costGroupOrder/
 * costVehicleClassId/costGroupFreightManual) nor BKS thực — the ĐV-assigned
 * truck identity is not CUS's to move.
 */
export function revGroupMemberPatch(args: RevGroupMemberPatchArgs): Record<string, unknown> {
  return {
    revGroupId: args.groupId,
    revGroupOrder: args.order,
    revVehicleClassId: args.revVehicleClassId,
    ...(args.billingTruckNo !== undefined ? { billingTruckNo: args.billingTruckNo } : {}),
    version: args.version,
    updatedBy: args.updatedBy,
    updatedAt: args.now,
  };
}

// ─── Rev merge — same customer only (spec 23/10 §4.2) ───────────────────────

export interface RevCustomerRow {
  id: number;
  customerId: number | null;
  /** Số Bill / Số Booking — display key, never the internal id. */
  reference: string;
}

export interface RevCustomerConflict {
  /** null = a lot carries no customer at all (also a conflict). */
  customerId: number | null;
  lotIds: number[];
}

/**
 * The pure part of "Chỉ cho phép tích gộp các lô của cùng 1 Khách hàng":
 * every lot must share one non-null customerId. Returns the offending
 * customer (and its lots) or null when the selection is mergeable.
 */
export function findRevCustomerConflict(rows: readonly RevCustomerRow[]): RevCustomerConflict | null {
  const first = rows[0];
  if (first == null) return null;
  const customerId = first.customerId;
  if (customerId == null) return { customerId: null, lotIds: [first.id] };
  const lotIds = rows.filter((row) => row.customerId !== customerId).map((row) => row.id);
  return lotIds.length > 0 ? { customerId, lotIds } : null;
}

/**
 * Throw the spec's 400 with a clear per-lot breakdown (Số Bill/Booking +
 * khách hàng). `customerNameById` is a plain map the caller resolved — kept
 * out of this module so the law stays pure and directly unit-testable.
 */
export function assertSameRevCustomer(
  rows: readonly RevCustomerRow[],
  customerNameById: ReadonlyMap<number, string> = new Map(),
): void {
  const conflict = findRevCustomerConflict(rows);
  if (conflict == null) return;
  const label = (row: RevCustomerRow): string => {
    const name = row.customerId != null
      ? customerNameById.get(row.customerId) ?? `ID ${row.customerId}`
      : 'Chưa có khách hàng';
    return `Lô ${row.reference} (Khách hàng: ${name})`;
  };
  // The breakdown names EVERY selected lot + its customer, so the operator
  // sees the whole conflict picture (matches the FB-093-era error copy).
  const details = rows.map(label).join(', ');
  throw new ApiError(
    400,
    `Chỉ cho phép ghép các lô của cùng một khách hàng (CÙNG 1 KHÁCH HÀNG) — phát hiện xung đột: ${details}`,
  );
}
