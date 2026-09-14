import { moneyParts } from '../../lib/format';
import './Money.css';

interface MoneyProps {
  /** Amount in VND. */
  value: number;
  /** Render short (e.g. "12,5 tr") instead of the full number (e.g. "12.500.000"). */
  compact?: boolean;
  /** Optional sign prefix shown before the number (e.g. "-", "+"). */
  sign?: string;
  /** Extra classes for the wrapper (color / sizing come from the parent context). */
  className?: string;
  /** Hide the currency unit entirely. */
  noUnit?: boolean;
}

/**
 * Money value with a subtitle-sized currency unit.
 *
 * The digits inherit the surrounding font-size/weight/color; the unit ("₫", or
 * "tr ₫" / "tỷ ₫" when compact) uses the shared readable caption scale.
 * The numeric value retains its table or metric context. Replaces inline
 * `{formatCurrency(x)}` wherever the unit was rendering at full size.
 *
 * Note: for counter-animated hero values, keep the manual number + unit split
 * (the counter writes textContent directly and cannot target a sub-span).
 */
export function Money({ value, compact = false, sign, className, noUnit }: MoneyProps) {
  const { num, unit } = moneyParts(value, compact);
  return (
    <span className={`money${className ? ` ${className}` : ''}`}>
      {sign && <span className="money__sign">{sign}</span>}
      <span className="money__num">{num}</span>
      {!noUnit && <span className="money__unit">{unit}</span>}
    </span>
  );
}
