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
  it('profit totals preserve sign-aware colors without blanket success overrides (UI75)', () => {
    const detail = source('src/pages/trip-detail/pnl-fuel.css');
    expect(detail).toMatch(/\.pl-total--loss\s*\{[^}]*--profit-tone: var\(--danger\)/);
    expect(detail).toMatch(/\.pl-total--profit\s*\{[^}]*--profit-tone: var\(--success-text\)/);
    expect(detail).toMatch(/\.pl-total\s*\{[^}]*--profit-tone: var\(--ink\)/);
    for (const path of ['src/components/trip/TripSummaryCard.css', 'src/pages/TripCreatePage.css']) {
      const css = source(path);
      const totalRules = [...css.matchAll(/([^{}]*\.tc-summary-row--total \.tc-summary-row__val)\s*\{([^}]+)\}/g)];
      if (path === 'src/components/trip/TripSummaryCard.css') expect(totalRules.length).toBeGreaterThan(0);
      for (const rule of totalRules) expect(rule[2], path).not.toMatch(/(?:^|;)\s*color:/);
    }
    const totals = source('src/components/trip/TotalsPanel.tsx');
    expect(totals).toContain("totals.grossProfit > 0 ? 'is-pos' : totals.grossProfit < 0 ? 'is-neg' : 'is-neutral'");
    expect(source('src/components/trip/TripSummaryCard.css')).toMatch(/\.tc-totals__profit-val\.is-neutral\s*\{[^}]*color: var\(--ink\)/);
  });

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
    // Card 20260930_215 deleted the master-plan pills — the Nhập/Xuất direction
    // marker and the carrier-allocation chip are plain text now — so the pin
    // that counted exactly three `color="gray"` Badge props went with them. The
    // promise it guarded ("categories stay neutral") is stronger without them:
    // the grid spends no badge colour at all, which the design-lock entries
    // `master-plan/*/no-pill-in-grid` measure in the browser.
    expect(masterPlan).not.toMatch(/color="(?:gray|blue|orange|indigo)"/);
    expect(detailedPlan).not.toMatch(/(?:utility-blue|#eff6ff|#1d4ed8|warning-primary)/);
    // Card 20260927_67 (5): the direction badge became an OUTLINED identifier
    // (Xuất/Nhập names a class of record, it is not a state), so this pin moved
    // off `background: var(--surface-3)` onto the behaviour the contract
    // actually protects — the same correction the note above already made for
    // the legacy maps. The contract is "keeps categories NEUTRAL and reserves
    // colour for real status", so what must be asserted is that the badge spends
    // no semantic colour at all, not which neutral surface it sits on. Asserting
    // the token would forbid the outline the card asks for while proving nothing
    // about colour discipline.
    const directionBadge = shipmentList.match(/\.cus-direction-badge--import,[\s\S]*?\.cus-direction-badge--export[\s\S]*?\{[^}]*\}/)?.[0] ?? '';
    expect(directionBadge).toContain('color: var(--ink-2)');
    expect(directionBadge).not.toMatch(/--(?:warning|danger|info|success|warn|err|ok)\b/);
    // Static classifications have no control border.
    expect(directionBadge).toMatch(/border:\s*0/);
    // The combined tag shared that peach fill once, spending the warning colour
    // on a category. Same discipline, same guarantee.
    const combinedTag = shipmentList.match(/\.cus-combined-tag\s*\{[^}]*\}/)?.[0] ?? '';
    expect(combinedTag).not.toMatch(/--(?:warning|danger|info|success|warn|err|ok)\b/);
    // Colour still has a home: the real status signal keeps it.
    expect(shipmentList).toMatch(/\.cus-signal--warning\s*\{[^}]*background:\s*var\(--warning-soft\)/);
    expect(tripTable).not.toMatch(/#(?:1E40AF|3B82F6|10B981|EF4444|991B1B)/);
    expect(dispatchFilters).not.toMatch(/#(?:3B82F6|F59E0B)/);
    expect(externalCarrierBadge).toMatch(/color: 'var\(--info-text\)'/);
  });
});
