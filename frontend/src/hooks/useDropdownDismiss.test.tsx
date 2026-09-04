import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDropdownDismiss } from './useDropdownDismiss';
import { isOverlayOpen } from '../lib/overlayState';

function Probe({ open, onClose }: { open: boolean; onClose: () => void }) {
  useDropdownDismiss(open, onClose);
  return (
    <div data-dropdown-root={open ? '' : undefined}>
      <button type="button">trigger</button>
      {open && <div role="menu">item</div>}
    </div>
  );
}

function renderAndOpen(onClose: () => void) {
  const view = render(<Probe open={false} onClose={onClose} />);
  view.rerender(<Probe open onClose={onClose} />);
  return view;
}

describe('useDropdownDismiss layer', () => {
  it('closes on a mousedown outside the dropdown root', () => {
    const onClose = vi.fn();
    renderAndOpen(onClose);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores mousedown inside the dropdown root so the trigger can toggle', () => {
    const onClose = vi.fn();
    const view = renderAndOpen(onClose);
    fireEvent.mouseDown(view.getByRole('button'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape and yields the back shortcut while open', () => {
    const onClose = vi.fn();
    renderAndOpen(onClose);
    expect(isOverlayOpen()).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('releases the overlay registry on close', () => {
    const onClose = vi.fn();
    const view = renderAndOpen(onClose);
    expect(isOverlayOpen()).toBe(true);
    view.unmount();
    expect(isOverlayOpen()).toBe(false);
  });

  it('does nothing from outside clicks while closed', () => {
    const onClose = vi.fn();
    render(<Probe open={false} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).not.toHaveBeenCalled();
  });
});
