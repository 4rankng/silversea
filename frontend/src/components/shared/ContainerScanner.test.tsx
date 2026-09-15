import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerScanner } from './ContainerScanner';

afterEach(() => { vi.unstubAllGlobals(); });

describe('ContainerScanner lifecycle', () => {
  it('exposes a keyboard gallery action and closes with Escape without closing a parent dialog', () => {
    const onClose = vi.fn();
    const parentEscape = vi.fn();
    window.addEventListener('keydown', parentEscape);
    render(<ContainerScanner onCapture={vi.fn()} onClose={onClose} />);
    expect(screen.getByRole('dialog', { name: 'Chụp ảnh container hoặc seal' })).toBeInTheDocument();
    const close = screen.getByRole('button', { name: 'Đóng' });
    const gallery = screen.getByRole('button', { name: 'Chọn ảnh từ thư viện' });
    gallery.focus();
    fireEvent.keyDown(gallery, { key: 'Tab' });
    expect(close).toHaveFocus();
    parentEscape.mockClear();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(parentEscape).not.toHaveBeenCalled();
    window.removeEventListener('keydown', parentEscape);
  });

  it('releases a camera stream that resolves after the scanner was closed', async () => {
    let resolveStream!: (stream: MediaStream) => void;
    const pending = new Promise<MediaStream>((resolve) => { resolveStream = resolve; });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn(() => pending) } });
    const stop = vi.fn();
    const { unmount } = render(<ContainerScanner onCapture={vi.fn()} onClose={vi.fn()} />);
    unmount();
    await act(async () => { resolveStream({ getTracks: () => [{ stop }] } as unknown as MediaStream); await pending; });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
