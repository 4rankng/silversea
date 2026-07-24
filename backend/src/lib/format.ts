/**
 * Shared formatting and utility functions.
 * Consolidated from duplicated definitions across services and routes.
 */

/**
 * Format a number as Vietnamese currency string.
 * @param n - Amount to format
 * @param symbol - If true, append ₫ suffix
 */
export function formatVND(n: number, symbol = false): string {
  const safe = Number.isFinite(n) ? n : 0;
  return Math.round(safe).toLocaleString('vi-VN') + (symbol ? ' ₫' : '');
}

/**
 * Get current date as YYYY-MM-DD in local timezone.
 */
export function formatLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Escape HTML special characters to prevent XSS in generated HTML.
 */
export function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Format a YYYY-MM-DD date string as DD/MM/YYYY (Vietnamese format).
 * Parses the string directly to avoid UTC/local timezone off-by-one issues.
 */
export function formatDateVi(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

/**
 * Format a YYYY-MM-DD date string as DD/MM (short Vietnamese format).
 * Parses the string directly to avoid UTC/local timezone off-by-one issues.
 */
export function formatDateShort(dateStr: string): string {
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}/${parts[1]}`;
}

/**
 * Sniff image MIME type from file magic bytes.
 * Supports JPEG, PNG, WebP, and HEIC.
 */
export function sniffImageType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  // JPEG
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'image/png';
  }
  // WebP
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
    buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  // HEIC: ftypheic or ftypmsf1 at offset 4
  const brand = buffer.toString('ascii', 8, 12);
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70 &&
      (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1')) {
    return 'image/heic';
  }
  return null;
}
