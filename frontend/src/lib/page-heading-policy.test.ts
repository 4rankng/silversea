import { describe, expect, it } from 'vitest';
import { hasPageOwnHeading } from './page-heading-policy';

describe('hasPageOwnHeading', () => {
  it('claims /shipments, whose page prints its own <h1>', () => {
    expect(hasPageOwnHeading('/shipments')).toBe(true);
  });

  // The exact-match rule is the whole point of the helper. A prefix list would
  // match all four of these and strip the topbar title off pages that render no
  // heading of their own (card 20260928_161).
  it.each([
    ['/shipments/new', 'ClerkShipmentCreatePage'],
    ['/shipments-detail', 'ShipmentContainersPage'],
    ['/shipments-debit', 'ShipmentDebitPage'],
    ['/shipments/42', 'ShipmentDetailPage'],
  ])('leaves %s to the topbar fallback (%s)', (path) => {
    expect(hasPageOwnHeading(path)).toBe(false);
  });

  it('leaves every other phone route to the topbar fallback', () => {
    for (const path of ['/', '/dispatch', '/dispatch-detail', '/my-trips', '/accounting']) {
      expect(hasPageOwnHeading(path)).toBe(false);
    }
  });
});
