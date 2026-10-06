import { round2dp } from './round';

/**
 * VAT for a debit settlement round's base amount (PRD QuyTrinhO2C §Kế toán
 * chốt debit, PM 24/09 law: `vatRate` 0/5/8/10 attaches to each round and the
 * VAT money auto-computes from the base). The chốt popup and the period
 * summary MUST share this single implementation so a round's stored preview
 * and every later total can never drift.
 *
 * The base is PRE-VAT: `totalAmount = amount + vatForAmount(amount, rate)`
 * (debit-settlement-rounds.service.ts convention since the popup landed).
 */
export function vatForAmount(amount: number | string, vatRate: number): number {
  return Math.round(Number(amount) * vatRate) / 100;
}

export interface DebitRoundVatInput {
  /** 'YYYY-MM' settlement period key. */
  periodKey: string;
  /** 'THU' (phải thu) | 'TRA' (phải trả). */
  direction: string;
  /** Pre-VAT base amount, VND. */
  amount: number | string;
  /** Recorded rate percent, one of 0/5/8/10. */
  vatRate: number;
}

export interface DebitPeriodVatTotals {
  /** False when the period carries no settlement rounds — callers keep their
   * honest '—' instead of reading a missing dimension as a computed zero. */
  hasRounds: boolean;
  thuBase: number;
  thuVat: number;
  traBase: number;
  traVat: number;
  /** round2dp'd combined VAT of the period (thu + tra). */
  totalVat: number;
}

/**
 * Period VAT totals over the recorded debit settlement rounds. `fromPeriod` /
 * `toPeriod` are inclusive 'YYYY-MM' bounds (the summary's Từ ngày/Đến ngày
 * collapse to their month keys). Direction values other than THU/TRA cannot
 * occur at the persistence layer; they are ignored defensively.
 */
export function debitRoundVatTotals(
  rounds: readonly DebitRoundVatInput[],
  fromPeriod: string,
  toPeriod: string,
): DebitPeriodVatTotals {
  const totals: DebitPeriodVatTotals = {
    hasRounds: false, thuBase: 0, thuVat: 0, traBase: 0, traVat: 0, totalVat: 0,
  };
  for (const round of rounds) {
    if (round.periodKey < fromPeriod || round.periodKey > toPeriod) continue;
    if (round.direction !== 'THU' && round.direction !== 'TRA') continue;
    totals.hasRounds = true;
    const base = Number(round.amount);
    const vat = vatForAmount(base, round.vatRate);
    if (round.direction === 'THU') {
      totals.thuBase += base;
      totals.thuVat += vat;
    } else {
      totals.traBase += base;
      totals.traVat += vat;
    }
  }
  totals.thuVat = round2dp(totals.thuVat);
  totals.traVat = round2dp(totals.traVat);
  totals.totalVat = round2dp(totals.thuVat + totals.traVat);
  return totals;
}
