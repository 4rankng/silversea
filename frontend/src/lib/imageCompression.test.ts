import { afterEach, describe, expect, it, vi } from 'vitest';
import { compressImageFile } from './imageCompression';

function makeFile(name: string, type: string, sizeBytes: number): File {
  return new File([new Uint8Array(sizeBytes)], name, { type });
}

describe('compressImageFile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('passes non-image files (e.g. PDF) through unchanged', async () => {
    const pdf = makeFile('e-pod.pdf', 'application/pdf', 5000);
    const result = await compressImageFile(pdf);
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
