// SIL-172 (FB-141 đuôi, CUS-05 họ hàng): pure resolvers that keep the Debit
// Note export's lot identity (BKS báo khách + loại xe tính cước THU) in sync
// with the LIVE lot. DB-free leaf on purpose — the unit suite must drive the
// value law without a connection, and the db-coupled loader in
// billing-export-shared.service composes these.
//
// FB-094's own law (shipment-cost-lock-lines.ts): the plate/class a Debit Note
// prints are "resolved by the caller from the live lot; never from the frozen
// money snapshot (a plate or class rename must not need a re-lock, and BKS is
// not a money value)". The frozen line renderData is a CACHE of that
// resolution, not the authority — re-export re-resolves it.
import { effectiveBillingPlate } from '@tingting/shared';
import type { BillingDocumentLine } from '@tingting/shared';

/** What the live lot says the note should print (loaded by the caller from
 *  `shipments` + the THU billing class catalog). */
export type DebitNoteLotBillingIdentity = {
  shipmentId: number;
  /** Claim key the frozen builder names the lot by (shipmentCode, else the id
   *  as a string — the loader guarantees a non-empty key). */
  lotCode: string;
  billingTruckNo: string | null;
  actualTruckNo: string | null;
  cargoMode: string | null;
  /** THU billing class (rev) — name, else code, else null. */
  vehicleType: string | null;
};

/** Claim keys a frozen line can name its lot by: the lot code the frozen
 *  builder stamps into the description, or the lot id. Mirrors the legacy
 *  repair's keying so both paths resolve identically. */
export type DebitNoteLotClaims = Map<number, Map<string, DebitNoteLotBillingIdentity>>;

const FROZEN_LOT_CODE_IN_DESCRIPTION = /— lô (\S+) \(chốt từ snapshot khóa lô\)\s*$/;

/** Resolve the live lot identity behind one frozen ADHOC line, or null when
 *  the claim is ambiguous (multi-lot note without a lot code in the
 *  description) or absent — never a guess. */
export function resolveDebitNoteLotIdentity(
  line: BillingDocumentLine,
  claims: DebitNoteLotClaims,
): DebitNoteLotBillingIdentity | null {
  const lots = line.documentId != null ? claims.get(Number(line.documentId)) : undefined;
  if (!lots) return null;
  const lotKeys = [...new Set(lots.keys())];
  if (lotKeys.length === 0) return null;
  const lotCode = FROZEN_LOT_CODE_IN_DESCRIPTION.exec(line.description ?? '')?.[1];
  if (lotCode) return lots.get(lotCode) ?? null;
  // No lot code in the description (single-lot note): only one lot can own it.
  return lots.size === 1 ? lots.get(lotKeys[0]!) ?? null : null;
}

/** The plate the note prints for this lot RIGHT NOW: BKS báo khách, else the
 *  ĐV-assigned BKS thực (LCL only), else blank — the exact law the freeze
 *  path stamped, re-read live at export time. */
export function liveReportedPlate(identity: DebitNoteLotBillingIdentity): string | null {
  return effectiveBillingPlate(identity);
}

/** Re-stamp a frozen ADHOC line's renderData with the LIVE lot identity.
 *  Post-FB-094 frozen lines carry renderData; their plate/class cells must
 *  reflect the current lot (cleared plate ⇒ blank/fallback, renamed plate ⇒
 *  new value) instead of the value cached at issue time. Money fields are
 *  untouched. Lines without a resolvable claim come back unchanged. */
export function applyLiveLotIdentityToFrozenLine(
  line: BillingDocumentLine,
  claims: DebitNoteLotClaims,
): BillingDocumentLine {
  if (line.sourceType !== 'ADHOC' || !line.renderData) return line;
  const identity = resolveDebitNoteLotIdentity(line, claims);
  if (!identity) return line;
  return {
    ...line,
    renderData: {
      ...line.renderData,
      truckPlate: liveReportedPlate(identity),
      vehicleType: identity.vehicleType,
    },
  };
}
