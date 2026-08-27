/**
 * Client-side image compression before upload (driver-app spec: e-POD photos
 * must be auto-compressed before/during upload to keep mobile data usage and
 * upload time low on-site). Non-image files (e.g. PDF e-POD documents) pass
 * through unchanged — there is nothing to compress and re-encoding would
 * corrupt them.
 */

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.75;

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
}

function isCompressibleImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/**
 * Resizes to at most `maxDimension` on the longest side and re-encodes as
 * JPEG at `quality`. Falls back to the original file untouched if the
 * browser's canvas/image decode path fails for any reason (corrupt file,
 * unsupported format) — a failed compression must never block the e-POD
 * upload the driver is trying to complete on-site.
 */
export async function compressImageFile(file: File, options: CompressImageOptions = {}): Promise<File> {
  if (!isCompressibleImage(file)) return file;

  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const quality = options.quality ?? DEFAULT_QUALITY;

  try {
    const bitmap = await loadBitmap(file);
    try {
      const { width, height } = scaledSize(bitmap.width, bitmap.height, maxDimension);
      if (width >= bitmap.width && height >= bitmap.height && file.type === 'image/jpeg') {
        // Already small enough and already a JPEG — re-encoding would only
        // burn battery/CPU for no size benefit.
        return file;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);

      const blob = await canvasToBlob(canvas, quality);
      if (!blob || blob.size >= file.size) return file;

      const compressedName = file.name.replace(/\.\w+$/, '') + '.jpg';
      return new File([blob], compressedName, { type: 'image/jpeg', lastModified: file.lastModified });
    } finally {
      bitmap.close?.();
    }
  } catch {
    return file;
  }
}

async function loadBitmap(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

function scaledSize(width: number, height: number, maxDimension: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width, height };
  const scale = maxDimension / longest;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
