// SIL-994 — [+ Khai chi phí] broke onto two lines in the lot detail surfaces:
// the "+" glyph fell onto its own line.
//
// Cause: the icon was written INSIDE the button's children, so the shared
// button wrapped the children in its own <span data-text> label. Tailwind's
// preflight makes `svg { display: block }`, and that span is a flex item of
// the button (blockified) — so the icon became a block box on its own line
// and the text dropped below it.
//
// The button already owns the right slot for a leading glyph: `iconLeading`,
// which renders the icon as a SIBLING flex item of the label span. The icon
// must therefore live there, not inside the children.
//
// SIL-1307: the lot drawer keeps exactly ONE "Khai chi phí" — the sticky
// footer's. The Nhận diện lô card copy of SIL-748 was the duplicate and is
// gone, so the footer button is the single surface this pin covers.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CusLotDrawerFooter } from './CusLotDrawerFooter';

/** The icon must be a flex item of the button, never a block inside the label. */
function expectIconBesideLabel(button: HTMLElement): void {
  const label = button.querySelector('[data-text]');
  expect(label).toBeTruthy();
  expect(label?.querySelector('svg')).toBeNull();

  const icon = button.querySelector('svg');
  expect(icon).toBeTruthy();
  expect(icon?.parentElement).toBe(button);
  expect(icon?.getAttribute('data-icon')).toBe('leading');
}

describe('Khai chi phí button icon placement (SIL-994)', () => {
  it('keeps the "+" glyph on the button\'s own line in the drawer footer', () => {
    render(
      <CusLotDrawerFooter
        onOpenLedger={vi.fn()}
        onDeclareExpense={vi.fn()}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Khai chi phí' });
    expectIconBesideLabel(btn);
  });
});
