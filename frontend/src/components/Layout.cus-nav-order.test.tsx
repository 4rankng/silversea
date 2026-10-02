import { describe, expect, it } from 'vitest';
import { Role } from '@tingting/shared';
import { getNavItems } from './Layout';

// The user placed the settlement screen personally: nav item "Chi phí -
// Quyết toán" sits directly below "Chi tiết lô hàng" in the CUS rail.
describe('Layout — CUS nav order for the settlement screen', () => {
  it('places Chi phí - Quyết toán directly below Chi tiết lô hàng', () => {
    const items = getNavItems(Role.CUS);
    const labels = items.map((item) => item.label);
    const containers = labels.indexOf('Chi tiết lô hàng');
    const debit = labels.indexOf('Chi phí - Quyết toán');
    expect(containers).toBeGreaterThan(-1);
    expect(debit).toBe(containers + 1);
  });

  it('keeps the settlement screen inside the CUS document-ops section', () => {
    const items = getNavItems(Role.CUS);
    const debit = items.find((item) => item.label === 'Chi phí - Quyết toán');
    expect(debit?.section).toBe('document-ops');
  });
});
