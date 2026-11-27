import { DISPATCH_CLASSIFICATION_LABELS, type DispatchClassification } from '@tingting/shared';
import type { ShipmentContainer } from '../../../api/shipmentClient';
import { billBookingReference } from '../../../lib/business-reference';
import { mergedGroupTag } from './merged-group-tag';

/**
 * SIL-1020 (KB Ch.3 §3.5 K3.40) — the chi tiết lô pair-facts rollup for the
 * post-create review page: one PHÂN LOẠI label plus the "tên lô ghép cùng"
 * of the lot's ACTIVE pair(s). The per-leg classifications ride the wire
 * derived ACTIVE-pair-first (the same law + DISPATCH_CLASSIFICATION_LABELS
 * vocabulary /dispatch-detail renders); this rollup is display-only — a lot
 * with several legs shows the strongest relation (a pair is never hidden) and
 * lists the distinct partner lots.
 */
export interface ShipmentPairFacts {
  /** The lot's PHÂN LOẠI label — 'Đơn' / 'Kẹp' / 'Kết hợp' / 'Lẻ' / 'Lấy Lẻ'. */
  classificationLabel: string;
  /** Distinct partner lot names ("tên lô ghép cùng") of the ACTIVE pairs the
   *  lot rides — [] when unpaired (the row never renders on absence). */
  partnerNames: string[];
  /** SIL-1166 (K3.79/K4.31) — the merged lot's "Ghép (k/N)" tag (cost side
   *  leads, rev side follows — the shared W3A helper), rendered as
   *  `label · tag`; null when the lot joined no merge group. */
  groupTag: string | null;
}

type PairFactLeg = Pick<ShipmentContainer, 'classification' | 'pairKind' | 'pairPartnerName'>;

export function shipmentPairFacts(
  legs: PairFactLeg[],
  lot: {
    cargoMode?: string | null;
    isCombined?: boolean | null;
    // SIL-1166 — the lot's merge-group facts (raw row columns ride the detail
    // wire; the member counts are computed read-side) feed the tag.
    costGroupId?: string | null;
    costGroupOrder?: number | null;
    costGroupMemberCount?: number | null;
    revGroupId?: string | null;
    revGroupOrder?: number | null;
    revGroupMemberCount?: number | null;
  } = {},
): ShipmentPairFacts {
  // The lot chain for legs the wire carries no derived label for (a lagging
  // deployment, or a container-less hàng lẻ lot) — the same fallback the
  // /shipments-detail ledger runs (hàng lẻ keeps Lẻ; Đóng kết hợp reads Kết hợp).
  const lotFallback: DispatchClassification = lot.cargoMode === 'LCL'
    ? 'LCL'
    : (lot.isCombined ? 'COMBINED' : 'SINGLE');
  const legLabel = (leg: PairFactLeg): DispatchClassification => {
    if (leg.classification) return leg.classification;
    // Wire lag: the ACTIVE pair kind is the K3.40 authority (KEP → Kẹp,
    // KET_HOP → Kết hợp) — the driver-app derivation, labels below.
    if (leg.pairKind === 'KEP') return 'DOUBLE';
    if (leg.pairKind === 'KET_HOP') return 'COMBINED';
    return lotFallback;
  };
  const labels = legs.map(legLabel);
  // A pair relation is never hidden: any Kẹp/Kết hợp leg outranks Đơn legs.
  // Lẻ labels only ever mix with each other (the LCL guard keeps clamp labels
  // off hàng lẻ legs), so the first non-Đơn label stands for the lot.
  const label = labels.includes('DOUBLE')
    ? 'DOUBLE'
    : labels.includes('COMBINED')
      ? 'COMBINED'
      : (labels.find((value) => value !== 'SINGLE') ?? labels[0] ?? lotFallback);
  const partnerNames = [...new Set(legs
    .filter((leg) => leg.pairKind === 'KEP' || leg.pairKind === 'KET_HOP')
    .map((leg) => billBookingReference(leg.pairPartnerName ?? null)))];
  return { classificationLabel: DISPATCH_CLASSIFICATION_LABELS[label], partnerNames, groupTag: mergedGroupTag(lot) };
}
