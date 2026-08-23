import { describe, expect, it } from 'vitest';
import { hasOperationalDensity, isFrozenOperationalSurface } from './operational-density';

describe('operational density surface boundary', () => {
  it.each([
    '/shipments',
    '/shipments-detail',
    '/shipments/new',
    '/shipments-detail/42',
    '/dispatch',
    '/dispatch-detail',
    '/dispatch/plan/42',
  ])
  ('keeps the approved CUS and Dispatcher surface unchanged: %s', (pathname) => {
    expect(isFrozenOperationalSurface(pathname)).toBe(true);
    expect(hasOperationalDensity(pathname)).toBe(false);
  });

  it.each(['/dashboard', '/accounting', '/fleet', '/suppliers', '/config/routes', '/payables'])
  ('applies the density contract to an operational screen: %s', (pathname) => {
    expect(isFrozenOperationalSurface(pathname)).toBe(false);
    expect(hasOperationalDensity(pathname)).toBe(true);
  });

  it.each(['/dispatching', '/shipments-detail-old'])
  ('does not freeze a similarly named route: %s', (pathname) => {
    expect(isFrozenOperationalSurface(pathname)).toBe(false);
    expect(hasOperationalDensity(pathname)).toBe(true);
  });
});
