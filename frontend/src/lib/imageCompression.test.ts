import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageFile, formatPhotoTimestamp } from './imageCompression';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('formatPhotoTimestamp', () => {
  it('formats the capture instant in Vietnam time regardless of the browser timezone', () => {
    expect(formatPhotoTimestamp(new Date('2026-08-28T02:05:00Z'))).toBe('2026-08-28 09:05:00');
    expect(formatPhotoTimestamp(new Date('2026-12-31T16:59:59Z'))).toBe('2026-12-31 23:59:59');
  });
});

describe('compressImageFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes non-image files (e.g. PDF) through unchanged', async () => {
    const pdf = makeFile('e-pod.pdf', 'application/pdf', 5000);
    const result = await compressImageFile(pdf, { timestamp: new Date() });
    expect(result).toBe(pdf);
  });

  it('compresses an image and returns a smaller re-encoded JPEG', async () => {
    const original = makeFile('photo.png', 'image/png', 50_000);
    const compressedBytes = new Uint8Array(10_000);
    const closeSpy = vi.fn();

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 4000,
      height: 3000,
      close: closeSpy,
    }));

    const ctx = { drawImage: vi.fn() };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([compressedBytes], { type: 'image/jpeg' }));
    });

    const result = await compressImageFile(original, { maxDimension: 1600, quality: 0.75 });

    expect(result).not.toBe(original);
    expect(result.type).toBe('image/jpeg');
    expect(result.size).toBeLessThan(original.size);
    expect(ctx.drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    expect(closeSpy).toHaveBeenCalled();
  });

  it('burns the capture timestamp into the image pixels when requested', async () => {
    const original = makeFile('photo.jpg', 'image/jpeg', 50_000);
    const compressedBytes = new Uint8Array(20_000);
    const stamp = new Date('2026-08-28T07:30:00Z');

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 2000,
      height: 1500,
      close: vi.fn(),
    }));
    const ctx = {
      drawImage: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 120 }),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([compressedBytes], { type: 'image/jpeg' }));
    });

    const result = await compressImageFile(original, { timestamp: stamp });

    expect(result).not.toBe(original);
    expect(result.type).toBe('image/jpeg');
    expect(ctx.fillText).toHaveBeenCalledWith('2026-08-28 14:30:00', expect.any(Number), expect.any(Number));
  });

  it('stamps even an already-small JPEG (stamp forces the re-encode)', async () => {
    const original = makeFile('small.jpg', 'image/jpeg', 5_000);
    const stamp = new Date('2026-08-28T01:00:00Z');

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 800,
      height: 600,
      close: vi.fn(),
    }));
    const ctx = {
      drawImage: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 120 }),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      roundRect: vi.fn(),
      fill: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(4_000)], { type: 'image/jpeg' }));
    });

    const result = await compressImageFile(original, { timestamp: stamp });
    expect(result).not.toBe(original);
    expect(ctx.fillText).toHaveBeenCalledWith('2026-08-28 08:00:00', expect.any(Number), expect.any(Number));
  });

  it('falls back to the original file if the browser cannot decode the image', async () => {
    const original = makeFile('corrupt.jpg', 'image/jpeg', 1000);
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('decode failed')));

    const result = await compressImageFile(original);
    expect(result).toBe(original);
  });

  it('keeps the original when the re-encoded blob is not actually smaller', async () => {
    const original = makeFile('tiny.png', 'image/png', 500);
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 100, close: vi.fn() }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((callback) => {
      callback(new Blob([new Uint8Array(600)], { type: 'image/jpeg' }));
    });

    const result = await compressImageFile(original);
    expect(result).toBe(original);
  });
});
