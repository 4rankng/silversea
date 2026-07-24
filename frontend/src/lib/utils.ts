/**
 * Helper to combine class names in components.
 */
export function cn(...inputs: unknown[]): string {
  return inputs.flat(Infinity).filter(Boolean).join(' ');
}
