import { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAnimatedOverlay } from './useAnimatedOverlay';
import { Drawer } from '../components/UI';

// Minimal overlay harness — stub entrance/exit, no animation. The class under
// test is the opener capture/restore shared by Modal, Drawer and ConfirmDialog.
function OverlayHarness({ openerRef }: { openerRef?: { current: HTMLElement | null } }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const { visible, handleClose } = useAnimatedOverlay({
    overlayRef,
    contentRef,
    isOpen,
    onClose: () => setIsOpen(false),
    entrance: (overlay) => {
      overlay.style.opacity = '1';
    },
    exit: (_overlay, _content, onDone) => onDone(),
    openerRef,
  });
  return (
    <>
      <button type="button" onClick={() => setIsOpen(true)}>Mở</button>
      {visible && (
        <div ref={overlayRef} data-testid="overlay">
          <div ref={contentRef}>
            <button type="button" onClick={handleClose}>Đóng</button>
          </div>
        </div>
      )}
    </>
  );
}

function DrawerHarness({ openerRef }: { openerRef: { current: HTMLElement | null } }) {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <div
        data-testid="row"
        onClick={(event) => {
          openerRef.current = event.currentTarget;
          setIsOpen(true);
        }}
      >
        Dòng kỷ luật
      </div>
      <Drawer isOpen={isOpen} onClose={() => setIsOpen(false)} openerRef={openerRef} title="Lập biên bản kỷ luật">
        <button type="button">Bên trong</button>
      </Drawer>
    </>
  );
}

// SIL-576: capture-order class — the hook used to snapshot document.activeElement
// at the isOpen transition, which is <body> for a mouse click on a non-focusable
// row/cell, and then "restored" that body after close.
describe('overlay focus return (SIL-576)', () => {
  it('restores focus to a non-focusable opener captured at interaction time', async () => {
    const cell = document.createElement('div');
    document.body.appendChild(cell);
    const openerRef = { current: cell as HTMLElement | null };
    render(<OverlayHarness openerRef={openerRef} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    expect(screen.getByTestId('overlay')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(document.activeElement).toBe(cell));
    expect(cell.getAttribute('tabindex')).toBe('-1');
  });

  it('falls back to the activeElement capture when no opener is known', async () => {
    render(<OverlayHarness />);
    const trigger = screen.getByRole('button', { name: 'Mở' });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('keeps the old no-op when neither opener nor focused element is known', async () => {
    render(<OverlayHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Mở' }));
    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByTestId('overlay')).toBeNull());
    expect(document.activeElement).toBe(document.body);
    expect(document.body.getAttribute('tabindex')).toBeNull();
  });

  it('Drawer Escape returns focus to the row/cell that opened it', async () => {
    const openerRef = { current: null as HTMLElement | null };
    render(<DrawerHarness openerRef={openerRef} />);
    fireEvent.click(screen.getByTestId('row'));
    expect(screen.getByRole('button', { name: 'Bên trong' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('row')));
    expect(screen.getByTestId('row').getAttribute('tabindex')).toBe('-1');
  });
});
