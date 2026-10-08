/**
 * Card 071026141600 — the numeric law (same contract as Money.tsx / card 386)
 * applied to the fleet-productivity screen: every percent or count token is
 * ONE text node inside ONE nowrap unit, so the QA-reported class — a percent
 * cell breaking between value and sign ("66.\n67%", "100\n%") — is impossible
 * by construction. The '%' sign is bound to its digits in the same text node
 * and the unit refuses every soft-wrap opportunity (`.fleet-num-unit` carries
 * `white-space: nowrap` in FleetProductivityPage.css); a cell may overflow
 * into the table's horizontal scroll, never into a mid-token line break.
 *
 * The pin contract lives in NumericUnit.test.tsx (DOM shape) and
 * FleetProductivityPage.styles.test.ts (the nowrap law).
 */

/** One percent token: value and sign in a single text node ("66.67%"). */
export function PctUnit({ value }: { value: number }) {
  return <span className="fleet-num-unit">{`${value}%`}</span>;
}

/** One count token, same unit law (sweep: count cells share the treatment). */
export function NumUnit({ value }: { value: number }) {
  return <span className="fleet-num-unit">{String(value)}</span>;
}
