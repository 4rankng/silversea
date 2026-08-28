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
  /**
   * Driver-app spec: photos captured on-site must carry a visible timestamp
   * ("gắn Timestamp vào ảnh lúc chụp"). When set, the capture moment is drawn
   * onto the image pixels (bottom-left chip) — surviving re-uploads, exports
   * and any viewer without EXIF support. Only applies to compressible images;
   * non-image files (PDF e-POD documents) pass through unchanged.
   */
  timestamp?: Date;
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
  const stamp = options.timestamp ?? null;

  try {
    const bitmap = await loadBitmap(file);
    try {
      const { width, height } = scaledSize(bitmap.width, bitmap.height, maxDimension);
      if (!stamp && width >= bitmap.width && height >= bitmap.height && file.type === 'image/jpeg') {
        // Already small enough and already a JPEG — re-encoding would only
        // burn battery/CPU for no size benefit. (A requested timestamp chip
        // still forces the re-encode: the stamp must land in the pixels.)
        return file;
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, width, height);
      if (stamp) drawTimestampChip(ctx, width, height, stamp);

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

/** dd/MM/yyyy HH:mm — the timestamp burned into driver photo pixels. */
export function formatPhotoTimestamp(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${dd}/${mo}/${date.getFullYear()} ${hh}:${mm}`;
}

/**
 * Opaque rounded chip, bottom-left: white pill, ink text, sized relative to
 * the image so it stays legible at 1600px (driver phone) and in thumbnails.
 */
function drawTimestampChip(ctx: CanvasRenderingContext2D, width: number, height: number, stamp: Date): void {
  const text = formatPhotoTimestamp(stamp);
  const fontSize = Math.max(14, Math.round(width / 26));
  const font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`;
  ctx.font = font;
  const textWidth = ctx.measureText(text).width;
  const padX = Math.round(fontSize * 0.6);
  const padY = Math.round(fontSize * 0.35);
  const margin = Math.round(fontSize * 0.5);
  const chipWidth = textWidth + padX * 2;
  const chipHeight = fontSize + padY * 2;
  const x = margin;
  const y = height - chipHeight - margin;

  ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
  const radius = chipHeight / 2;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, chipWidth, chipHeight, radius);
    ctx.fill();
  } else {
    // Older WebViews without roundRect — a square chip still carries the timestamp.
    ctx.fillRect(x, y, chipWidth, chipHeight);
  }
  ctx.fillStyle = 'rgba(16, 20, 24, 0.92)';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + padX, y + chipHeight / 2 + 1);
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
