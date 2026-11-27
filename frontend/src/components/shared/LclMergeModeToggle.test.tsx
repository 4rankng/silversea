// SIL-1212 (audit 2026-11-27) — the merge-mode toggle's ACTIVE face is the
// "Thoát gộp hàng" exit button on /shipments-detail (and on every other
// grouping surface). The face class is what carries the fill the contrast
// contract in LclMergeModeToggle.contrast.styles.test.ts measures, so the DOM
// half is pinned here: the class rides the ON state, and the accessible name
// follows the label swap.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LclMergeModeToggle } from './LclMergeModeToggle';

describe('LclMergeModeToggle', () => {
  it('renders the OFF face: [Gộp hàng], unpressed, no active-face class', () => {
    render(<LclMergeModeToggle active={false} onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Gộp hàng' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.className).not.toContain('lcl-merge-toggle--active');
  });

  it('renders the ACTIVE face: [Thoát gộp hàng], pressed, with the active-face class', () => {
    render(<LclMergeModeToggle active onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Thoát gộp hàng' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('lcl-merge-toggle--active');
  });

  it('the active face keeps the house button shell', () => {
    render(<LclMergeModeToggle active onToggle={vi.fn()} />);
    const button = screen.getByRole('button', { name: 'Thoát gộp hàng' });
    expect(button.className).toContain('btn');
    expect(button.className).toContain('lcl-merge-toggle');
  });
});
