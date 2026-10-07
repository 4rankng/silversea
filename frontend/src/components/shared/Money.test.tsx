import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Money } from './Money';

/**
 * Card 386 rework v2 — the QA's staging DOM measurement: `.money` rendered
 * `.money__num` + `.money__unit` as SIBLING flex items, so the number and the
 * ₫ were two separate boxes that stacked into two line-boxes even under
 * `white-space: nowrap` (no text node ever contained the full "14.000.000 ₫").
 * The contract now: Money emits the WHOLE formatted amount as ONE text node
 * inside one inline element — the caption-sized unit split retires inside the
 * component (the unit renders in the same run as the digits). The public API
 * (value/compact/sign/noUnit/className) is unchanged.
 */

function moneyNode() {
  return document.querySelector('.money') as HTMLElement;
}

describe('Money — one text node, one inline element', () => {
  it('renders the full amount + unit as a single text node', () => {
    render(<Money value={14_000_000} />);
    const el = moneyNode();
    expect(el.textContent).toBe('14.000.000 ₫');
    const textNodes = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
    expect(textNodes).toHaveLength(1);
    expect(textNodes[0].textContent).toBe('14.000.000 ₫');
    expect(el.children).toHaveLength(0);
  });

  it('keeps the retired sub-span split out of the DOM', () => {
    render(<Money value={3_500_000} />);
    expect(document.querySelector('.money__num')).toBeNull();
    expect(document.querySelector('.money__unit')).toBeNull();
    expect(document.querySelector('.money__sign')).toBeNull();
  });

  it('prefixes the sign inside the same run', () => {
    render(<Money value={1_200_000} sign="-" />);
    expect(moneyNode().textContent).toBe('-1.200.000 ₫');
    const el = moneyNode();
    expect([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).toHaveLength(1);
  });

  it('keeps compact formatting in the same run — the scale marker is the unit, no doubled ₫ (card 071026141650)', () => {
    render(<Money value={12_500_000} compact />);
    // "19 tr ₫" doubled the unit: the scale marker ("tr"/"tỷ"/"k") IS the unit.
    expect(moneyNode().textContent).toBe('12.5 tr');
    // Unscaled compact numbers keep the ₫ ("Trả 0 ₫" in the report).
    const second = render(<Money value={0} compact />);
    expect(second.container.querySelector('.money')?.textContent).toBe('0 ₫');
  });

  it('noUnit drops the unit and keeps one node; className rides the span', () => {
    render(<Money value={14_000_000} noUnit className="ledger-value" />);
    const el = moneyNode();
    expect(el.textContent).toBe('14.000.000');
    expect(el).toHaveClass('ledger-value');
    expect(el).toHaveClass('money');
    expect([...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim())).toHaveLength(1);
  });

  it('stays readable to screen readers as one amount', () => {
    render(<Money value={3_500_000} />);
    expect(screen.getByText('3.500.000 ₫')).toBeTruthy();
  });
});
