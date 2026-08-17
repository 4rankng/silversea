import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const tokens = source('src/styles/tokens.css');
const sharedConstants = source('../shared/src/constants/index.ts');
const ui = source('src/components/UI.tsx');
const masterPlan = source('src/features/dispatch/master-plan/MasterPlanGrid.tsx');
const detailedPlan = source('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
const tripTable = source('src/pages/trip-list/table.css');
const shipmentList = source('src/pages/ShipmentsPage.css');
const fleetGrid = source('src/features/dispatch/components/FleetGrid.tsx');
const dispatchFilters = source('src/features/dispatch/components/DispatchFilters.tsx');
const externalCarrierBadge = source('src/features/trips/XeNgoaiBadge.tsx');

describe('operational color contract', () => {
  it('uses a restrained forest, bronze, and oxblood semantic palette', () => {
    expect(tokens).toContain('--info: #2E675E;');
    expect(tokens).toContain('--warning: #A45D1C;');
    expect(tokens).toContain('--danger: #A0444E;');
    expect(sharedConstants).not.toMatch(/#3B82F6|#EF4444/);
  });

  it('keeps categories neutral and reserves color for real status', () => {
    expect(ui).toMatch(/info:\s*'gray'/);
    expect(masterPlan).not.toMatch(/color="(?:blue|orange|indigo)"/);
    expect(masterPlan.match(/color="gray"/g)).toHaveLength(3);
    expect(detailedPlan).not.toMatch(/(?:utility-blue|#eff6ff|#1d4ed8|warning-primary)/);
    expect(shipmentList).toMatch(/\.cus-direction-badge--import,[\s\S]*?\.cus-direction-badge--export\s*\{\s*background: var\(--surface-3\); color: var\(--ink-2\)/);
    expect(tripTable).not.toMatch(/#(?:1E40AF|3B82F6|10B981|EF4444|991B1B)/);
    expect(fleetGrid).not.toMatch(/#(?:3B82F6|F59E0B)/);
    expect(dispatchFilters).not.toMatch(/#(?:3B82F6|F59E0B)/);
    expect(externalCarrierBadge).toMatch(/color: 'var\(--info-text\)'/);
  });
});
