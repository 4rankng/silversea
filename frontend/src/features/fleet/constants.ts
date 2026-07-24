/**
 * Shared fleet status labels and constants.
 * Extracted from FleetPage.tsx during M5.2 migration.
 */

export const TRUCK_STATUS: Record<string, string> = {
  ACTIVE: 'Hoạt động', MAINTENANCE: 'Bảo trì', INACTIVE: 'Ngưng',
};

export const DRIVER_STATUS: Record<string, string> = {
  ACTIVE: 'Hoạt động', INACTIVE: 'Ngưng',
};

/**
 * Reusable inline styles shared across fleet components.
 * Kept as a typed constant object (matching original FleetPage pattern)
 * until a CSS-in-JS or design-token migration.
 */
export const fleetStyles = {
  emptyRow: { textAlign: 'center', padding: 32, color: 'var(--fg-3)' },
  centerAlign: { textAlign: 'center' },
  errorBanner: { textAlign: 'center', color: 'var(--danger)', padding: '8px 20px' },
  swatchSuccess: { background: 'var(--success)' },
  swatchWarning: { background: 'var(--warning)' },
  salaryMono: { fontFamily: 'var(--font-mono)', color: 'var(--ink)' },
  dotSep: { opacity: 0.5 },
  actionRow: { display: 'flex', gap: 8 },
  metaRow: { display: 'flex', alignItems: 'center', gap: 8 },
  dotSuccess: { width: 6, height: 6, borderRadius: '50%', background: 'var(--success)' },
  dotWarning: { width: 6, height: 6, borderRadius: '50%', background: 'var(--warning)' },
  textSuccess: { color: 'var(--success)', fontWeight: 600 },
  textWarning: { color: 'var(--warning)', fontWeight: 600 },
  textMuted: { opacity: 0.4 },
  fontMono: { fontFamily: 'var(--font-mono)' },
} as const;
