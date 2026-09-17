import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SummaryRail } from './SummaryRail';
import { readFileSync } from 'node:fs';

const items = [
  { label: 'Lô phù hợp', value: 1234 },
  { label: 'Chưa chốt lịch', value: 5, tone: 'warning' as const },
  { label: 'Chờ Kế toán', value: 2, tone: 'info' as const },
  { label: 'Đã xong', value: 0 },
];

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
