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
const drawerStyles = readFileSync(resolve(process.cwd(), 'src/components/Drawer.css'), 'utf8');
const shipmentStyles = readFileSync(resolve(process.cwd(), 'src/pages/ShipmentsPage.css'), 'utf8');
const userStyles = readFileSync(resolve(process.cwd(), 'src/features/users/users.css'), 'utf8');
const operationalStyles = readFileSync(resolve(process.cwd(), 'src/styles/operational-density.css'), 'utf8');

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
    expect(drawerStyles).toMatch(/\.drawer__head\s*\{[^}]*padding:\s*calc\(12px \+ env\(safe-area-inset-top, 0px\)\) 16px 12px;/);
    expect(drawerStyles).toMatch(/\.drawer__foot\s*\{[^}]*padding:\s*8px 16px calc\(8px \+ env\(safe-area-inset-bottom, 0px\)\);/);
    expect(drawerStyles).toContain('padding: calc(10px + env(safe-area-inset-top, 0px)) 12px 10px;');
    expect(drawerStyles).toContain('padding: 8px 12px calc(8px + env(safe-area-inset-bottom, 0px));');
    expect(shipmentStyles).toContain('padding: calc(16px + env(safe-area-inset-top, 0px)) 18px 12px;');
    expect(userStyles).toContain('padding: max(12px, env(safe-area-inset-top, 0px)) max(12px, env(safe-area-inset-right, 0px)) 10px max(12px, env(safe-area-inset-left, 0px));');
    expect(userStyles).toContain('padding: 10px max(12px, env(safe-area-inset-right, 0px)) max(10px, env(safe-area-inset-bottom, 0px)) max(12px, env(safe-area-inset-left, 0px));');
  });

  it('replaces the desktop operational modal cap with safe-area-aware phone gutters', () => {
    expect(operationalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal\.modal--operational-density\s*\{[^}]*padding:\s*max\(8px, env\(safe-area-inset-top, 0px\)\)/);
    expect(operationalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal--operational-density \.modal__content\s*\{[^}]*max-width:\s*calc\(100vw - 16px\);[^}]*max-height:\s*calc\(100dvh - max\(8px, env\(safe-area-inset-top, 0px\)\) - max\(8px, env\(safe-area-inset-bottom, 0px\)\)\);/);
    expect(operationalStyles).toContain('.modal--operational-density .modal__body { padding: 12px; }');
    expect(operationalStyles).toContain('.modal--operational-density.modal--polished .modal__head { padding-right: 64px; }');
  });

  it('keeps dialog actions reachable with long content and respects reduced motion', () => {
    expect(modalStyles).toMatch(/\.modal__content\s*\{[^}]*max-height:\s*calc\(100dvh - 48px\);/);
    expect(modalStyles).toMatch(/\.modal__foot\s*\{[^}]*flex-wrap:\s*wrap;/);
    expect(modalStyles).toMatch(/\.modal__head > div:first-child\s*\{[^}]*min-width:\s*0;/);
    expect(modalStyles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none;/);
    expect(drawerStyles).toMatch(/\.drawer__body\s*\{[^}]*min-height:\s*0;/);
    expect(drawerStyles).not.toMatch(/padding:\s*20px 28px 100px;/);
    expect(drawerStyles).toContain('.drawer__close:focus-visible');
  });

  it('keeps shared dialog chrome compact without sacrificing mobile touch targets', () => {
    expect(modalStyles).toMatch(/\.modal__head\s*\{[^}]*padding:\s*8px 16px;/);
    expect(modalStyles).toMatch(/\.modal__foot\s*\{[^}]*padding:\s*8px 16px;/);
    expect(modalStyles).toMatch(/\.modal__close\.btn\s*\{[^}]*height:\s*36px;/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__head\s*\{[^}]*padding:\s*12px 16px 8px;/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__foot\s*\{[^}]*padding:\s*8px 16px max\(8px, env\(safe-area-inset-bottom\)\);/);
    expect(modalStyles).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal__close\.btn\s*\{[^}]*min-height:\s*44px;/);
    expect(responsiveStyles).not.toContain('.modal__head');
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
