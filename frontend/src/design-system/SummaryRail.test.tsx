import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { SummaryRail } from './SummaryRail';
import { readFileSync } from 'node:fs';

const items = [
  { label: 'Lô phù hợp', value: 1234 },
  { label: 'Chưa chốt lịch', value: 5, tone: 'warning' as const },
  { label: 'Chờ Kế toán', value: 2, tone: 'info' as const },
  { label: 'Đã xong', value: 0 },
];

/** The link mode needs a router (react-router `Link`); inert items don't. */
function renderRail(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

describe('SummaryRail', () => {
  it('renders a labelled rail with one dt/dd pair per item, in order', () => {
    render(<SummaryRail items={items} ariaLabel="Tóm tắt ưu tiên xử lý" />);
    const rail = screen.getByRole('region', { name: 'Tóm tắt ưu tiên xử lý' });
    expect(rail.querySelector('dl')).not.toBeNull();
    const terms = rail.querySelectorAll('dt');
    const values = rail.querySelectorAll('dd');
    expect(terms).toHaveLength(4);
    expect(values).toHaveLength(4);
    expect(terms[0].textContent).toBe('Lô phù hợp');
    expect(terms[3].textContent).toBe('Đã xong');
  });

  it('localizes numeric values vi-VN like the workboard counts', () => {
    render(<SummaryRail items={items} ariaLabel="Tóm tắt" />);
    expect(screen.getByText('1.234')).not.toBeNull();
  });

  it('passes string values through untouched', () => {
    render(<SummaryRail items={[{ label: 'Ghi chú', value: '—' }]} ariaLabel="Tóm tắt" />);
    expect(screen.getByText('—')).not.toBeNull();
  });

  it('reserves a separate line for tablet values instead of squeezing money beside labels', () => {
    const css = readFileSync('src/design-system/SummaryRail.css', 'utf8');
    expect(css).toMatch(/@media \(min-width: 641px\) and \(max-width: 1100px\)[\s\S]*?flex-direction: column/);
    render(<SummaryRail items={[{ label: 'Lợi nhuận gộp', value: '25.580.000 ₫' }]} ariaLabel="Lợi nhuận" />);
    expect(screen.getByText('25.580.000 ₫').tagName).toBe('DD');
  });

  it('applies a tone class only to toned items', () => {
    render(<SummaryRail items={items} ariaLabel="Tóm tắt" />);
    const toned = screen.getByText('5').closest('.summary-rail__item');
    const plain = screen.getByText('1.234').closest('.summary-rail__item');
    expect(toned?.className).toContain('summary-rail__item--warning');
    expect(plain?.className).not.toContain('--');
  });
});

/**
 * Card 051026231511 — the `href` drill-down mode. An item with a destination
 * must be a real, focusable link; every other item must keep rendering exactly
 * as it did before the prop existed.
 */
describe('SummaryRail — href drill-down (card 051026231511)', () => {
  it('renders an item with href as a link carrying the exact destination', () => {
    renderRail(
      <SummaryRail
        ariaLabel="Chỉ số kế toán"
        items={[{ label: 'Khách hàng', value: 8, href: '/debt?asOf=2026-10-05' }]}
      />,
    );
    const link = screen.getByRole('link', { name: /Khách hàng/ });
    expect(link.getAttribute('href')).toBe('/debt?asOf=2026-10-05');
    // Same dt/dd anatomy as the inert item — the rail stays a decision rail.
    expect(link.querySelector('dt')?.textContent).toBe('Khách hàng');
    expect(link.querySelector('dd')?.textContent).toBe('8');
  });

  it('keeps a count that is still loading out of the link role', () => {
    // No href while the value is the em-dash placeholder: a loading count must
    // not present as a working destination.
    renderRail(
      <SummaryRail ariaLabel="Chỉ số kế toán" items={[{ label: 'Khách hàng', value: '—' }]} />,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—').closest('.summary-rail__item')?.tagName).toBe('DIV');
  });

  it('renders an item without href exactly as before — inert text, not a link', () => {
    renderRail(<SummaryRail items={items} ariaLabel="Tóm tắt" />);
    expect(screen.queryByRole('link')).toBeNull();
    for (const label of ['Lô phù hợp', 'Chưa chốt lịch', 'Chờ Kế toán', 'Đã xong']) {
      const row = screen.getByText(label).closest('.summary-rail__item');
      expect(row?.tagName).toBe('DIV');
    }
  });

  it('leaves the card _37 interactive mode untouched (button + aria-pressed)', () => {
    const onClick = vi.fn();
    renderRail(
      <SummaryRail
        ariaLabel="Tóm tắt"
        items={[{ label: 'Chưa chốt lịch', value: 5, onClick, pressed: true }]}
      />,
    );
    const button = screen.getByRole('button', { name: /Chưa chốt lịch/ });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('link')).toBeNull();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('mixes link and inert items in one rail without cross-contamination', () => {
    renderRail(
      <SummaryRail
        ariaLabel="Chỉ số kế toán"
        items={[
          { label: 'Khách hàng', value: 8, href: '/debt?asOf=2026-10-05' },
          { label: 'Lợi nhuận kỳ', value: '30.000.000 ₫' },
        ]}
      />,
    );
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(
      screen.getByText('Lợi nhuận kỳ').closest('.summary-rail__item')?.tagName,
    ).toBe('DIV');
  });

  it('styles the drill-down as a link in the rail, never as a filled card', () => {
    const css = readFileSync('src/design-system/SummaryRail.css', 'utf8');
    expect(css).toMatch(/\.summary-rail__item--link\s*\{[^}]*\}/);
    expect(css).toMatch(/\.summary-rail__item--link dd\s*\{[^}]*color:\s*var\(--brand\);/);
    expect(css).toMatch(/\.summary-rail__item--link:focus-visible\s*\{[^}]*outline:/);
    // The golden standard: a rail item is never a rounded, filled container.
    const link = css.match(/\.summary-rail__item--link\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(link).not.toMatch(/border-radius|background|box-shadow/);
    // Tone selectors still outrank the link colour on the number.
    const tone = css.indexOf('.summary-rail__item--warning dd');
    expect(tone).toBeGreaterThan(css.indexOf('.summary-rail__item--link dd'));
  });
});
