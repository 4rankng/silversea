/**
 * SIL-811 — the identity title of a settlement-slip expense group.
 *
 * UAT KH 12/11: every per-lot expense group on the phiếu quyết toán must say
 * WHOSE shipment it is (customer shorthand — LONGMINH/ASKEY/YUANFANG), WHICH
 * shipment (Số Bill/Booking + Số tờ khai), and WHICH containers the money
 * touched — replacing the old 'Không rõ container' dead-end entirely.
 *
 * Pure display rules shared by the FE slip (card + print page) and the BE
 * sheet/export so every surface prints one identical title.
 */

/** Container identity of one group: named containers only.
 *  - 1 container → the bare number ("gán 1 cont thì hiện số cont đó").
 *  - 2+ → the merged roll-call ("cộng gộp", e.g. '2 cont: MSKU1, MSKU2').
 *  - none → null (the caller drops the segment; 'Không rõ container' is gone).
 */
export function mergedContainerLabel(containerNumbers: readonly string[]): string | null {
  const names = [...new Set(containerNumbers.map((name) => name.trim()).filter(Boolean))];
  if (names.length === 0) return null;
  if (names.length === 1) return names[0];
  return `${names.length} cont: ${names.join(', ')}`;
}

export interface SettlementLotIdentityInput {
  customerName?: string | null;
  /** Bill of lading (IMPORT) or booking reference (EXPORT). */
  billRef?: string | null;
  /** Decides the segment label: EXPORT reads 'Booking:', everything else 'Bill:'. */
  tradeDirection?: string | null;
  /** Tờ khai numbers of the containers the group covers (id-asc, deduped). */
  declarationNumbers?: readonly string[] | null;
  /** Container numbers the group covers — lot-wide groups pass the lot's list. */
  containerNumbers?: readonly string[] | null;
}

/** One expense row's container scope as the slip sees it. */
export interface SettlementIdentityRow {
  /** The assigned container (null = lot-wide 'Phí chung lô'). */
  containerNumber?: string | null;
  /** Tờ khai of THIS row's container (null on lot-wide rows). */
  declarationNumber?: string | null;
  /** Every named container of the lot (id-asc). */
  lotContainerNumbers?: readonly string[] | null;
  /** Every non-empty tờ khai of the lot's containers (id-asc, deduped). */
  lotDeclarationNumbers?: readonly string[] | null;
}

/**
 * The container/tờ khai set a group of rows COVERS: a per-cont row covers its
 * cont (and that cont's tờ khai); a lot-wide row covers every cont of the lot.
 * Feeds `settlementLotIdentityTitle` for both the FE blocks and the BE sheet.
 */
export function coveredSettlementIdentity(rows: readonly SettlementIdentityRow[]): {
  containerNumbers: string[];
  declarationNumbers: string[];
} {
  const containers = new Set<string>();
  const declarations = new Set<string>();
  for (const row of rows) {
    const cont = row.containerNumber?.trim();
    if (cont) {
      containers.add(cont);
      const decl = row.declarationNumber?.trim();
      if (decl) declarations.add(decl);
    } else {
      for (const name of row.lotContainerNumbers ?? []) {
        if (name.trim()) containers.add(name.trim());
      }
      for (const decl of row.lotDeclarationNumbers ?? []) {
        if (decl.trim()) declarations.add(decl.trim());
      }
    }
  }
  return { containerNumbers: [...containers], declarationNumbers: [...declarations] };
}

/**
 * `LONGMINH · Bill: R8B-472 · TK: 10859073650 · 2 cont: MSKU1234570, MSKU1234565`.
 * Empty segments are dropped; the Bill/Booking segment keeps its established
 * 'Chưa có số Bill/Booking' fallback so the line never invents a number.
 */
export function settlementLotIdentityTitle(input: SettlementLotIdentityInput): string {
  const segments: string[] = [];
  const customer = input.customerName?.trim();
  if (customer) segments.push(customer);
  const billLabel = input.tradeDirection === 'EXPORT' ? 'Booking' : 'Bill';
  segments.push(`${billLabel}: ${input.billRef?.trim() || 'Chưa có số Bill/Booking'}`);
  const declarations = [...new Set((input.declarationNumbers ?? []).map((value) => value.trim()).filter(Boolean))];
  if (declarations.length > 0) segments.push(`TK: ${declarations.join(', ')}`);
  const containers = mergedContainerLabel(input.containerNumbers ?? []);
  if (containers) segments.push(containers);
  return segments.join(' · ');
}
