import type { CSSProperties } from 'react';

/**
 * Shared inline styles for form <select> and <label> elements.
 *
 * Extracted from local consts duplicated across FuelSection, TripInfoCard,
 * TrailerFormModal, CustomersPage, SupplierListPage, and RoutesConfigPage.
 * Keep these visually byte-identical to the originals.
 *
 * - selectStyle          — base: custom caret, no explicit width. Use when the
 *                          parent .field / .input rule already sets width:100%.
 * - selectStyleFullWidth — base + width:100%.
 * - labelStyle           — form field label. --ink-2 is the canonical ink token
 *                          (it aliases --fg-2; both resolve to #535963), so
 *                          adopting it here changes no rendered color.
 */
export const selectStyle: CSSProperties = {
  appearance: 'none',
  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='none' stroke='%23A1A1AA' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m3 4.5 3 3 3-3'/%3E%3C/svg%3E")`,
  backgroundRepeat: 'no-repeat',
  backgroundPosition: 'right 12px center',
  paddingRight: 32,
};

export const selectStyleFullWidth: CSSProperties = {
  ...selectStyle,
  width: '100%',
};

export const labelStyle: CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-2)',
  marginBottom: 6,
};
