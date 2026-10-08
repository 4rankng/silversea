/**
 * Supplier → carrier customer link ("Chọn nhà xe" visibility).
 *
 * Extracted from routes/config/config-helpers.ts (2026-10-03) so the
 * master-data import apply path can reach it without importing a route
 * module — the workbook's "Nhà xe" sheet lands here exactly like a supplier
 * written through the admin form does, and both paths must stay in lockstep.
 *
 * CONTRACT (2026-10-03, supersedes the 2026-09-09 "every supplier mirrors a
 * carrier" rule): a supplier is a carrier IFF `types` contains CARRIER. That
 * single discriminator decides whether a `customers.isCarrier` row exists, is
 * minted, or is retracted. Under the old unconditional rule every fuel
 * station, insurer and weighbridge was selectable as an external carrier and
 * leaked into the customer list.
 */
import { and, asc, eq, isNull, ne, or, sql } from 'drizzle-orm';
import * as s from '../db/schema';
import { normalizeTaxCode } from './legal-partner.service';
import { normalizeSupplierTypes, SupplierType } from './supplier-types.service';

import type { db as Db } from '../db';

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export interface CarrierLinkSupplier {
  id: number;
  name: string;
  shortName: string;
  status: string;
  taxCode: string | null;
  types?: readonly string[] | null;
}

/**
 * The one place carrier-ness is decided from a supplier. Three call sites must
 * agree — the supplier write hook, the import apply path, and the backfills —
 * so the normalization stays behind one name instead of four inline reads.
 */
export function isCarrierSupplier(types: unknown): boolean {
  return normalizeSupplierTypes(types).includes(SupplierType.CARRIER);
}

/**
 * Resolve (or create) the linked carrier customer and point
 * suppliers.linkedCustomerId at it. Returns the linked customer id, or null
 * when the supplier has no operational name — or when it is not a carrier. The
 * gate lives here rather than at the call sites so no caller can mint a nhà xe
 * for a non-carrier supplier by forgetting to check `types`.
 *
 * Link resolution order: explicit link → customer already back-linked to this
 * supplier → unique same-named live customer → unique tax-code holder → mint.
 * Never picks silently among 2+ same-name candidates.
 */
export async function ensureSupplierCarrierLink(
  tx: Tx,
  supplier: CarrierLinkSupplier,
  explicitCustomerId: number | null,
): Promise<number | null> {
  if (!isCarrierSupplier(supplier.types)) return null;
  const linkedCarrierId = await ensureLinkedCarrierCustomer(tx, supplier, explicitCustomerId);
  if (linkedCarrierId != null) {
    await tx.update(s.suppliers)
      .set({ linkedCustomerId: linkedCarrierId, updatedAt: new Date() })
      // ne() alone would skip NULL (fresh suppliers) — an IS NULL branch is
      // required for the new-link case.
      .where(and(
        eq(s.suppliers.id, supplier.id),
        or(isNull(s.suppliers.linkedCustomerId), ne(s.suppliers.linkedCustomerId, linkedCarrierId)),
      ));
  }
  return linkedCarrierId;
}

async function ensureLinkedCarrierCustomer(
  tx: Tx,
  supplier: CarrierLinkSupplier,
  explicitCustomerId: number | null,
): Promise<number | null> {
  const operationalName = supplier.shortName?.trim() || supplier.name.trim();
  if (!operationalName) return null;

  if (explicitCustomerId != null) {
    return explicitCustomerId;
  }

  const existingLink = await tx.select({ id: s.customers.id }).from(s.customers)
    // A soft-deleted customer is never selectable — drop it from the scan or
    // a deleted back-link would be "ensured" and keep the supplier invisible.
    .where(and(
      eq(s.customers.linkedSupplierId, supplier.id),
      isNull(s.customers.deletedAt),
    ))
    .orderBy(asc(s.customers.id))
    .limit(1);
  if (existingLink.length > 0) {
    const customerId = existingLink[0]!.id;
    await tx.update(s.customers)
      .set({
        name: supplier.name,
        shortName: operationalName,
        isCarrier: true,
        // Deactivating a supplier hides its carrier from the dropdowns too;
        // the customers enum has no INACTIVE — LOCKED is the dormant state.
        status: supplier.status === 'ACTIVE' ? 'ACTIVE' : 'LOCKED',
        updatedAt: new Date(),
      })
      .where(eq(s.customers.id, customerId));
    return customerId;
  }

  const sameName = await tx.select({ id: s.customers.id }).from(s.customers)
    // Same soft-delete rule as the back-link scan above: a deleted same-named
    // row must not be adopted (and must not count toward the ambiguity check
    // that decides mint-vs-adopt).
    .where(and(
      isNull(s.customers.deletedAt),
      sql`lower(btrim(${s.customers.name})) = lower(${operationalName})`,
    ))
    .orderBy(asc(s.customers.id))
    .limit(2);
  if (sameName.length === 1) {
    const customerId = sameName[0]!.id;
    await tx.update(s.customers)
      .set({
        linkedSupplierId: supplier.id,
        isCarrier: true,
        // Adopted billing customer: never null out its tax code, never flip
        // its lifecycle — only the carrier flag and the back-link change.
        updatedAt: new Date(),
      })
      .where(eq(s.customers.id, customerId));
    return customerId;
  }
  // 0 or 2+ same-name customers: ambiguous in the latter case, so never pick
  // one silently. Before minting, adopt the unique customer already holding
  // this supplier's tax code — the same legal entity — otherwise the mint
  // would mint a normalized duplicate that trips the customer tax-code
  // uniqueness guard on the next write (normalizeTaxCode strips ALL inner
  // whitespace and lowercases, unlike the raw btrim the unique index uses).
  let mintTaxCode = supplier.taxCode;
  const normalizedSupplierTaxCode = normalizeTaxCode(supplier.taxCode);
  if (normalizedSupplierTaxCode !== '') {
    const taxCodeHolders = await tx.select({ id: s.customers.id }).from(s.customers)
      .where(and(
        isNull(s.customers.deletedAt),
        sql`nullif(lower(regexp_replace(${s.customers.taxCode}, '\\s+', '', 'g')), '') = ${normalizedSupplierTaxCode}`,
      ))
      .limit(2);
    if (taxCodeHolders.length === 1) {
      const customerId = taxCodeHolders[0]!.id;
      await tx.update(s.customers)
        .set({
          linkedSupplierId: supplier.id,
          isCarrier: true,
          updatedAt: new Date(),
        })
        .where(eq(s.customers.id, customerId));
      return customerId;
    }
    // ≥2 holders can't exist under customers_active_tax_code_uniq_idx; if a
    // drifted dataset ever produces one, mint WITHOUT the code instead of
    // 500ing — the code can be set manually afterwards.
    if (taxCodeHolders.length >= 2) mintTaxCode = null;
  } else {
    // Whitespace-only or absent code: mint with NULL, not formatting garbage.
    mintTaxCode = null;
  }
  const [created] = await tx.insert(s.customers).values({
    name: supplier.name,
    shortName: operationalName,
    status: 'ACTIVE',
    isCarrier: true,
    linkedSupplierId: supplier.id,
    taxCode: mintTaxCode,
  }).returning({ id: s.customers.id });
  return created!.id;
}

/**
 * Withdraw the carrier flag a supplier granted before it was typed (2026-10-03:
 * fuel/insurance suppliers leaked into every "Chọn nhà xe" dropdown). Scoped
 * to this supplier's own back-linked rows, so a customer owned by a CARRIER
 * supplier keeps its flag.
 */
export async function retractCarrierLink(tx: Tx, supplierId: number): Promise<void> {
  await tx.update(s.customers)
    .set({ isCarrier: false, updatedAt: new Date() })
    .where(and(eq(s.customers.linkedSupplierId, supplierId), eq(s.customers.isCarrier, true)));
}
