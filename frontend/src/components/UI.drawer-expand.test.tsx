/**
 * SIL-483 — Drawer expand toggle + host header action.
 *
 * The lot drawer specced a Maximize2 ghost (32×32) beside the close button
 * that expands the panel over the full viewport, and — supplements 3+4 — a
 * header trash for Xóa lô riding the same head-actions cluster. Both are
 * opt-in Drawer props: hosts that don't pass them render exactly as before.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './UI';

function DrawerHarness({ expandable, headerAction, onClose }: {
  expandable?: boolean;
  headerAction?: React.ReactNode;
  onClose?: () => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      {open ? null : <button type="button" onClick={() => setOpen(true)}>Mở lại</button>}
      <Drawer
        isOpen={open}
        onClose={() => { onClose?.(); setOpen(false); }}
        title="Chi tiết lô hàng"
        expandable={expandable}
        headerAction={headerAction}
      >
        <p>Nội dung</p>
      </Drawer>
    </>
  );
}

describe('Drawer expand toggle (SIL-483)', () => {
  it('renders no expand button for hosts that do not opt in', () => {
    render(<DrawerHarness />);
    expect(screen.queryByRole('button', { name: 'Phóng to toàn màn hình' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thu về drawer' })).toBeNull();
    expect(document.querySelector('aside.drawer.drawer--expanded')).toBeNull();
  });

  it('toggles to the full viewport and flips the label/pressed state', async () => {
    render(<DrawerHarness expandable />);
    const drawer = screen.getByRole('dialog', { name: 'Chi tiết lô hàng' });
    expect(drawer.className).not.toContain('drawer--expanded');

    const expand = screen.getByRole('button', { name: 'Phóng to toàn màn hình' });
    expect(expand.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(expand);

    expect(drawer.className).toContain('drawer--expanded');
    const collapse = await screen.findByRole('button', { name: 'Thu về drawer' });
    expect(collapse.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(collapse);
    expect(drawer.className).not.toContain('drawer--expanded');
    expect(await screen.findByRole('button', { name: 'Phóng to toàn màn hình' })).toBeTruthy();
  });

  it('resets the expanded state on close — the next open is a fresh slide-in panel', async () => {
    const onClose = vi.fn();
    render(<DrawerHarness expandable onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Phóng to toàn màn hình' }));
    expect(screen.getByRole('dialog', { name: 'Chi tiết lô hàng' }).className).toContain('drawer--expanded');

    fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Mở lại' }));

    const reopened = await screen.findByRole('dialog', { name: 'Chi tiết lô hàng' });
    // The close effect clears the flag; the reopened panel starts compact.
    expect(reopened.className).not.toContain('drawer--expanded');
    expect(screen.getByRole('button', { name: 'Phóng to toàn màn hình' })).toBeTruthy();
  });

  it('renders the host header action inside the head-actions cluster', () => {
    render(<DrawerHarness expandable headerAction={(
      <button type="button" className="drawer__close cus-drawer-lot-delete" aria-label="Xóa lô">
        <svg data-testid="trash-glyph" />
      </button>
    )} />);
    const actions = document.querySelector('.drawer__head-actions');
    expect(actions).toBeTruthy();
    expect(actions!.querySelector('.cus-drawer-lot-delete')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Xóa lô' })).toBeTruthy();
    // Close keeps living in the same cluster.
    expect(screen.getByRole('button', { name: 'Đóng' })).toBeTruthy();
  });
});
