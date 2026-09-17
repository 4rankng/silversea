import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContainerScanner } from './ContainerScanner';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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


describe('UI-DC-23 capture metadata', () => {
  function prepareCamera() {
    const stop = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{ stop }], getVideoTracks: () => [{ stop, getCapabilities: () => ({}) }],
    }) } });
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,YQ==');
    vi.stubGlobal('Image', class {
      width = 1200; height = 900; onload?: () => void;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
  }
  it('supplies the live shutter instant, captured before image processing', async () => {
    prepareCamera();
    const onCapture = vi.fn();
    render(<ContainerScanner onCapture={onCapture} onClose={vi.fn()} />);
    const video = document.querySelector('video')!;
    Object.defineProperties(video, { videoWidth: { value: 1200 }, videoHeight: { value: 900 } });
    const button = await screen.findByRole('button', { name: 'Chụp ảnh' });
    await waitFor(() => expect(button).toBeEnabled());
    const before = Date.now();
    fireEvent.click(button);
    await waitFor(() => expect(onCapture).toHaveBeenCalledTimes(1));
    expect(onCapture.mock.calls[0][1]).toBeInstanceOf(Date);
    expect(onCapture.mock.calls[0][1].getTime()).toBeGreaterThanOrEqual(before);
    expect(onCapture.mock.calls[0][1].getTime()).toBeLessThanOrEqual(Date.now());
  });
  it('does not label gallery selection or file modification time as capture time', async () => {
    prepareCamera();
    const onCapture = vi.fn();
    render(<ContainerScanner onCapture={onCapture} onClose={vi.fn()} />);
    fireEvent.change(document.querySelector('input[type=file]')!, { target: { files: [
      new File(['gallery'], 'old-photo.jpg', { type: 'image/jpeg', lastModified: 1600000000000 }),
    ] } });
    await waitFor(() => expect(onCapture).toHaveBeenCalledExactlyOnceWith('data:image/jpeg;base64,YQ==', undefined));
  });
});
