// Settlement draft/delta math (split from ShipmentDebitTables.tsx at the
// structure guard's new-file ceiling): the CUS draft model, the pure delta
// builder, and the empty-delta predicate that gates the contextual save bar.
import type { ShipmentDebitDetail, ShipmentDebitEditsBody } from '../../../api/shipmentDebit';

/** CUS draft: per-expense sell/note edits, other-fee amount edits, and the
 * Phí khác add/remove lists. Pure delta — untouched cells never travel. */
export interface DraftState {
  freight: Record<string, { psActual: string; note: string }>;
  feeAmounts: Record<number, string>;
  addedFees: Array<{ key: string; tripId: number; name: string; amount: string }>;
  removedFeeIds: number[];
}

export const DRAFT_EMPTY: DraftState = { freight: {}, feeAmounts: {}, addedFees: [], removedFeeIds: [] };

export const buildDraft = (detail: ShipmentDebitDetail): DraftState => ({
  freight: Object.fromEntries(detail.freightRows.map((row) => [row.containerNumber, { psActual: row.psActual == null ? '' : String(row.psActual), note: row.psActualNote ?? '' }])),
  feeAmounts: Object.fromEntries(detail.chiHoRows.flatMap((row) => row.otherFees.map((fee) => [fee.id, fee.amount == null ? '' : String(fee.amount)]))),
  addedFees: [],
  removedFeeIds: [],
});

export const num = (value: string): number => {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** True when the draft carries no travel-worthy change — the contextual save
 *  bar hides while nothing would be sent. */
export const deltaIsEmpty = (delta: ShipmentDebitEditsBody): boolean =>
  (delta.edits?.length ?? 0) === 0
  && (delta.addOtherFees?.length ?? 0) === 0
  && (delta.removeExpenseIds?.length ?? 0) === 0
  && (delta.freightEdits?.length ?? 0) === 0;

export const buildDelta = (detail: ShipmentDebitDetail, draft: DraftState): ShipmentDebitEditsBody => {
  const edits: NonNullable<ShipmentDebitEditsBody['edits']> = [];
  const readOnlyIds = new Set<number>();
  for (const row of detail.chiHoRows) {
    for (const item of row.items) if (item.readOnly) readOnlyIds.add(item.id);
    for (const fee of row.otherFees) {
      if (fee.readOnly) { readOnlyIds.add(fee.id); continue; }
      const raw = draft.feeAmounts[fee.id];
      if (raw == null) continue;
      const amount = num(raw);
      if (amount !== (fee.amount ?? 0)) edits.push({ expenseId: fee.id, buyAmount: amount });
    }
  }
  const freightEdits: NonNullable<ShipmentDebitEditsBody['freightEdits']> = [];
  for (const row of detail.freightRows) {
    const key = row.containerNumber;
    if (key == null) continue;
    const cells = draft.freight[key];
    if (!cells) continue;
    const ps = cells.psActual.trim() === '' ? null : num(cells.psActual);
    const note = cells.note;
    const changed = ps !== (row.psActual ?? null) || note !== (row.psActualNote ?? '');
    if (changed) {
      const edit: NonNullable<ShipmentDebitEditsBody['freightEdits']>[number] = { containerNumber: key };
      if (ps !== (row.psActual ?? null)) edit.psActual = ps ?? undefined;
      if (note !== (row.psActualNote ?? '')) edit.note = note;
      freightEdits.push(edit);
    }
  }
  return {
    edits,
    addOtherFees: draft.addedFees.filter((fee) => fee.name.trim() !== '').map((fee) => ({ tripId: fee.tripId, name: fee.name.trim(), amount: num(fee.amount) })),
    removeExpenseIds: draft.removedFeeIds.filter(id => !readOnlyIds.has(id)),
    freightEdits,
  };
};
