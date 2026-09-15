import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const files = [
  'pages/DriverTripsPage.css', 'pages/DriverTripDetailPage.css',
  'pages/DriverTripPodPage.css', 'pages/DriverEarningsPage.css',
  'pages/DriverPenaltyPage.css', 'pages/NotificationsPage.css',
  'pages/driver/DriverSecondaryPages.css', 'pages/portal/PortalPages.css',
  'pages/portal/CustomerPortalLayout.css', 'pages/FleetPage.css',
  'pages/TruckTiresPage.css', 'components/work-inbox/RoleWorkInbox.css',
  'components/DriverTripCard.css', 'components/TripHero.css',
  'components/EarningsHero.css', 'components/FuelAllocCard.css',
  'components/trip/DriverContainerCard.css',
  'components/trip/TripPodSubmission.css',
  'components/trip/ContainerInstancesCard.css',
];
const read = (file: string) => readFileSync(resolve(process.cwd(), 'src', file), 'utf8');

// TYPO-ROLE-01: local literals were bypassing the common scale, including
// 9–11px photo/status text and different title sizes at mobile breakpoints.
describe('driver, portal and fleet semantic typography', () => {
  it.each(files)('%s uses shared roles instead of a private font-size scale', (file) => {
    const declarations = [...read(file).matchAll(/font-size:\s*([^;{}]+);/g)];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, value] of declarations) {
      expect(value.trim()).toMatch(/^(?:var\(--text-[a-z-]+-size\)|inherit)(?:\s*!important)?$/);
    }
  });

  it.each([
    ['pages/portal/PortalPages.css', '.portal-page h1'],
    ['components/work-inbox/RoleWorkInbox.css', '.role-work-inbox h1'],
    ['pages/DriverTripDetailPage.css', '.driver-task-header__title'],
    ['pages/TruckTiresPage.css', '.ttp-header h1'],
  ])('%s keeps its page-title role at every breakpoint', (file, selector) => {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const declarations = [...read(file).matchAll(new RegExp(`${escaped}\\s*\\{([^}]+)}`, 'g'))];
    expect(declarations.length).toBeGreaterThan(0);
    for (const [, body] of declarations) {
      const size = body.match(/font-size:\s*([^;]+);/);
      if (size) expect(size[1]).toBe('var(--text-title-size)');
    }
  });
});
