// Card 191026181942 — the shared name cell: wrap-never-clip plus the
// accessible full-name layer (title/aria-label always, focusable reveal on
// long names only, so a dense grid never floods the tab order).
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NameCell } from './NameCell';

describe('NameCell', () => {
  it('renders the operational (short) name with the full name as title and aria-label', () => {
    render(<NameCell name="LONG MINH" />);
    const cell = screen.getByText('LONG MINH');
    expect(cell.tagName).toBe('SPAN');
    expect(cell.getAttribute('title')).toBe('LONG MINH');
    expect(cell.getAttribute('aria-label')).toBe('LONG MINH');
  });

  it('a short name takes no tab stop — the full value is already visible', () => {
    render(<NameCell name="LONG MINH" />);
    expect(screen.getByText('LONG MINH').getAttribute('tabindex')).toBeNull();
  });

  it('a long name is focusable so keyboard users reach the full-name reveal', () => {
    const long = 'CÔNG TY CỔ PHẦN THƯƠNG MẠI DỊCH VỤ VẬN TẢI LONG MINH LOGISTICS VIỆT NAM';
    expect(long.length).toBeGreaterThan(60);
    render(<NameCell as="strong" name={long} />);
    expect(screen.getByText(long).getAttribute('tabindex')).toBe('0');
  });

  it('renders the requested element and no node for an empty name', () => {
    const { container } = render(<NameCell as="em" name="KCN Quế Võ" />);
    expect(container.querySelector('em')).toBeTruthy();
    const empty = render(<NameCell name="   " />);
    expect(empty.container.textContent).toBe('');
  });
});
