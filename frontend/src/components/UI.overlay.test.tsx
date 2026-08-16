import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Drawer, Modal } from './UI';

const animatedOverlaySource = readFileSync(
  resolve(process.cwd(), 'src/hooks/useAnimatedOverlay.ts'),
  'utf8',
);
const responsiveStyles = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');
const modalStyles = readFileSync(resolve(process.cwd(), 'src/components/Modal.css'), 'utf8');
const crudModalStyles = readFileSync(resolve(process.cwd(), 'src/design-system/forms/CrudFormModal.css'), 'utf8');
const shipmentStyles = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const userStyles = readFileSync(resolve(process.cwd(), 'src/features/users/users.css'), 'utf8');

function DrawerHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Mở chi tiết</button>
      <Drawer isOpen={open} onClose={() => setOpen(false)} title="Chi tiết lô hàng">
        <button type="button">Lưu thay đổi</button>
      </Drawer>
    </>
  );
}

function StackedOverlayHarness() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setDrawerOpen(true)}>Mở drawer</button>
      <Drawer isOpen={drawerOpen} onClose={() => setDrawerOpen(false)} title="Drawer cha">
        <button type="button" onClick={() => setModalOpen(true)}>Mở modal</button>
        <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title="Modal con">
          <button type="button">Hành động</button>
        </Modal>
      </Drawer>
    </>
  );
}

describe('Drawer keyboard focus', () => {
  it('initializes shared overlay entrance state in the layout phase', () => {
    expect(animatedOverlaySource).toMatch(
      /useLayoutEffect\(\(\) => \{\s*if \(!visible \|\| !wasOpen\) return;[\s\S]*?entranceRef\.current\(overlay, content, prefersReduced\);/,
    );
  });

  it('preserves safe-area clearance when compact drawer styles override shared padding', () => {
    expect(responsiveStyles).toContain('padding-top: calc(24px + env(safe-area-inset-top, 0px));');
    expect(shipmentStyles).toContain('padding: calc(16px + env(safe-area-inset-top, 0px)) 18px 12px;');
    expect(userStyles).toContain('padding: calc(16px + env(safe-area-inset-top, 0px)) 18px 12px;');
    expect(userStyles).toContain('padding: 10px 18px calc(10px + env(safe-area-inset-bottom, 0px));');
  });

  it('keeps shared dialog chrome compact without sacrificing mobile touch targets', () => {
    expect(modalStyles).toMatch(/\.modal__head\s*\{[^}]*padding:\s*12px 20px;/);
    expect(modalStyles).toMatch(/\.modal__foot\s*\{[^}]*padding:\s*12px 20px;/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__head\s*\{[^}]*padding:\s*12px 16px 8px;/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__foot\s*\{[^}]*padding:\s*8px 16px max\(8px, env\(safe-area-inset-bottom\)\);/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__close\.btn\s*\{[^}]*min-height:\s*44px;/);
    expect(responsiveStyles).not.toContain('.modal__head');
    expect(crudModalStyles).toMatch(/\.ds-crud-modal__head\s*\{[^}]*padding:\s*12px 16px;/);
    expect(crudModalStyles).toMatch(/\.ds-crud-modal__foot\s*\{[^}]*padding:\s*10px 16px;/);
  });

  it('moves focus into the drawer, traps it, and restores the opener after Escape', async () => {
    render(<DrawerHarness />);
    const opener = screen.getByRole('button', { name: 'Mở chi tiết' });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Chi tiết lô hàng' });
    const closeButton = screen.getByRole('button', { name: 'Đóng' });
    await waitFor(() => expect(document.activeElement).toBe(closeButton));

    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Lưu thay đổi' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('lets the topmost overlay own Escape while restoring focus to the nested trigger', async () => {
    render(<StackedOverlayHarness />);

    const opener = screen.getByRole('button', { name: 'Mở drawer' });
    opener.focus();
    fireEvent.click(opener);

    const drawer = await screen.findByRole('dialog', { name: 'Drawer cha' });
    const openModal = screen.getByRole('button', { name: 'Mở modal' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Đóng' })));

    // fireEvent.click does not apply the browser's native button-focus step,
    // so model the actual pointer/keyboard trigger before opening the modal.
    openModal.focus();
    fireEvent.click(openModal);
    const modal = await screen.findByRole('dialog', { name: 'Modal con' });
    expect(drawer).toBeTruthy();
    expect(modal).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Modal con' })).toBeNull());
    expect(screen.getByRole('dialog', { name: 'Drawer cha' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(openModal));

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
