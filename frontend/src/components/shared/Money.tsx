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
 * Money value — THE numeric law's rendering: the whole formatted amount
 * ("14.000.000 ₫", or "12.5 tr ₫" compact, sign prefixed) is ONE text node
 * inside one inline element, so a narrow cell can never break the number from
 * its unit and no rendering can stack them into two line-boxes (the QA v2
 * staging measurement that bounced this card twice traced to the retired
 * `.money__num` + `.money__unit` sibling-span split — a two-box mechanism no
 * CSS law could have fixed).
 *
 * Design tradeoff, recorded: the caption-sized unit retires INSIDE this
 * component — the unit renders in the same run as the digits at the
 * surrounding font size. The public API (value/compact/sign/noUnit/className)
 * is unchanged; compact keeps the "tr ₫" / "tỷ ₫" formatting.
 *
 * Note: for counter-animated hero values, keep the manual number + unit split
 * (the counter writes textContent directly and cannot target a sub-span).
 */
export function Money({ value, compact = false, sign, className, noUnit }: MoneyProps) {
  const { num, unit } = moneyParts(value, compact);
  return (
    <span className={`money${className ? ` ${className}` : ''}`}>
      {`${sign ?? ''}${num}${noUnit ? '' : ` ${unit}`}`}
    </span>
  );
}
