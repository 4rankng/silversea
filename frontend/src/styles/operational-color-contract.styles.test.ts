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
    // The legacy variant maps must resolve only to the five semantic variants.
    // They used to pin `info: 'gray'` here, which contradicted this file's own
    // palette assertion: `--info` is a real semantic tone (#2E675E) and the
    // external-carrier badge below consumes `--info-text`. The pin asserted a
    // mapping literal, not behaviour; what actually matters is that a legacy
    // variant name can never leak a raw colour or an unknown variant into a
    // pill/badge (StatusText would then render unstyled).
    const legacyMaps = ui.match(/const (?:PILL|BADGE)_STATUS_VARIANT_MAP[^}]*\}/g) ?? [];
    expect(legacyMaps).toHaveLength(2);
    for (const map of legacyMaps) {
      expect(map).not.toMatch(/#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\(/);
      const resolved = map.match(/:\s*'([a-z]+)'/g) ?? [];
      expect(resolved.length).toBeGreaterThan(0);
      for (const value of resolved) {
        expect(['success', 'warning', 'danger', 'info', 'neutral']).toContain(value.replace(/:\s*'|'/g, ''));
      }
    }
    expect(masterPlan).not.toMatch(/color="(?:blue|orange|indigo)"/);
    expect(masterPlan.match(/color="gray"/g)).toHaveLength(3);
    expect(detailedPlan).not.toMatch(/(?:utility-blue|#eff6ff|#1d4ed8|warning-primary)/);
    expect(shipmentList).toMatch(/\.cus-direction-badge--import,[\s\S]*?\.cus-direction-badge--export\s*\{\s*background: var\(--surface-3\); color: var\(--ink-2\)/);
    expect(tripTable).not.toMatch(/#(?:1E40AF|3B82F6|10B981|EF4444|991B1B)/);
    expect(dispatchFilters).not.toMatch(/#(?:3B82F6|F59E0B)/);
    expect(externalCarrierBadge).toMatch(/color: 'var\(--info-text\)'/);
  });
});
