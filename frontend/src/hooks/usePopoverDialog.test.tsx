import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { usePopoverDialog } from './usePopoverDialog';

/**
 * SIL-561 pin — a role=dialog popover claiming modal semantics must hold all
 * three legs (aria-modal + focus inside + inert background) and hand focus
 * back to the trigger on every close path.
 */
describe('usePopoverDialog modal popover semantics', () => {
  function Host({ open: initial = false }: { open?: boolean }) {
    const [open, setOpen] = useState(initial);
    const panelRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    usePopoverDialog(panelRef, triggerRef, open);
    return (
      <>
        <button ref={triggerRef} onClick={() => setOpen((v) => !v)}>Mở bộ lọc</button>
        <div id="background"><button>Nút nền</button></div>
        {open && (
          <div ref={panelRef} role="dialog" aria-label="Bộ lọc">
            <button onClick={() => setOpen(false)}>Áp dụng</button>
          </div>
        )}
      </>
    );
  }

  it('marks the open panel aria-modal, focuses inside, and inerts the background', () => {
    render(<Host />);
    const backgroundButton = screen.getByRole('button', { name: 'Nút nền' });
    expect(backgroundButton.closest('#background')!.hasAttribute('inert')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ lọc' }));

    const dialog = screen.getByRole('dialog', { name: 'Bộ lọc' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    // Focus lands inside the panel, never on <body>.
    expect(dialog.contains(document.activeElement)).toBe(true);
    // The background branch is inert while the dialog claims modal semantics.
    expect(backgroundButton.closest('#background')!.hasAttribute('inert')).toBe(true);
  });

  it('SIL-561 fail 29/10: EVERY background element carries inert — main and the opener chain included', () => {
    function PortaledHost() {
      const [open, setOpen] = useState(false);
      const panelRef = useRef<HTMLDivElement>(null);
      const triggerRef = useRef<HTMLButtonElement>(null);
      usePopoverDialog(panelRef, triggerRef, open);
      return (
        <main>
          <button ref={triggerRef} onClick={() => setOpen((v) => !v)}>Mở bộ lọc</button>
          <div id="background"><button>Nút nền</button></div>
          {open && createPortal(
            <div ref={panelRef} role="dialog" aria-label="Bộ lọc">
              <button onClick={() => setOpen(false)}>Áp dụng</button>
            </div>,
            document.body,
          )}
        </main>
      );
    }
    render(<PortaledHost />);
    const trigger = screen.getByRole('button', { name: 'Mở bộ lọc' });
    fireEvent.click(trigger);

    // QA's probe reads these exact elements: `main` carried neither inert nor
    // aria-hidden while the dialog claimed modal semantics ("chỉ vùng toast
    // là inert" — the old sweep exempted the opener's ancestor chain).
    expect(document.querySelector('main')!.hasAttribute('inert')).toBe(true);
    // Platform modal semantics inert the background INCLUDING the opener;
    // the close path un-inerts first (this hook's effect order), then
    // restores focus — a browser refuses to focus an inert element.
    expect(trigger.hasAttribute('inert')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(document.querySelector('main')!.hasAttribute('inert')).toBe(false);
    expect(trigger.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(trigger);
  });

  it('restores aria-modal + background and hands focus back to the trigger on close', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở bộ lọc' }));
    expect(screen.getByRole('dialog', { name: 'Bộ lọc' }).getAttribute('aria-modal')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: 'Áp dụng' }));

    expect(screen.queryByRole('dialog', { name: 'Bộ lọc' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Nút nền' }).closest('#background')!.hasAttribute('inert')).toBe(false);
    // No close path may drop the keyboard to <body>.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Mở bộ lọc' }));
  });

  it('keeps a background element the user moved focus to (close is not stranded)', () => {
    function OutsidePressHost() {
      const [open, setOpen] = useState(false);
      const panelRef = useRef<HTMLDivElement>(null);
      const triggerRef = useRef<HTMLButtonElement>(null);
      usePopoverDialog(panelRef, triggerRef, open);
      return (
        <>
          <button data-testid="bg" onClick={() => setOpen(false)}>Nền</button>
          <button ref={triggerRef} onClick={() => setOpen((v) => !v)}>Mở</button>
          {open && <div ref={panelRef} role="dialog" aria-label="Bảng"><button>Trong</button></div>}
        </>
      );
    }
    render(<OutsidePressHost />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    expect(screen.getByRole('dialog', { name: 'Bảng' })).toBeTruthy();
    // An outside press lands focus on the control that was clicked (real
    // browsers do this; jsdom needs the explicit focus) before it closes.
    const background = screen.getByRole('button', { name: 'Nền' });
    background.focus();
    fireEvent.click(background);
    expect(screen.queryByRole('dialog', { name: 'Bảng' })).toBeNull();
    expect(document.activeElement).toBe(background);
  });
});
