import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * KB Ch.10 §10.4.14 — the shared filter strip reads the fixed type scale at
 * every width. On the touch band `(max-width: 640px), (pointer: coarse)` the
 * SIL-558 zoom-safe floor swaps `--control-field-font-size` to 16px, which
 * leaked into the toolbar (QA 25/11 @390px: search placeholder, Bộ lọc
 * trigger and date fields computed 16px against 12px chips). These pins hold
 * the strip to the filter scale and keep the vw-free invariant.
 */
const barCss = readFileSync(resolve(process.cwd(), 'src/components/FilterBar.css'), 'utf8');
const listBarCss = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
const dropdownCss = readFileSync(resolve(process.cwd(), 'src/components/FilterDropdown.css'), 'utf8');
const tokensCss = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8');
const responsiveCss = readFileSync(resolve(process.cwd(), 'src/styles/responsive.css'), 'utf8');

const stripSheets: Array<[string, string]> = [
  ['FilterBar.css', barCss],
  ['ListFilterBar.css', listBarCss],
  ['FilterDropdown.css', dropdownCss],
];

describe('filter strip type scale (KB §10.4.14)', () => {
  it('không còn font-size tính bằng vw trong các sheet thanh toolbar', () => {
    for (const [name, css] of stripSheets) {
      const offenders = css.match(/font-size\s*:[^;{}]*\d*\.?\d+vw/g) ?? [];
      expect(offenders, `${name} declares vw-based font-size`).toEqual([]);
    }
  });

  it('the touch band re-pins the strip token to the filter scale, same media as the SIL-558 swap', () => {
    const band = barCss.split('@media (max-width: 640px), (pointer: coarse) {')[1]?.split('\n}')[0] ?? '';
    // The re-pin is scoped to the bar root so it beats the :root swap for the
    // bar's subtree only — every UUI control inside inherits 12px.
    expect(band).toContain('.filter-bar.list-filter-bar {');
    expect(band).toMatch(/--control-field-font-size:\s*var\(--filter-control-font-size\)/);
  });

  it('search and date inputs outrank the literal #root zoom guard with the ID-prefixed selector', () => {
    // responsive.css pins `#root input:not(...)` to the literal zoom-safe var
    // (specificity (1,2,1)) — the strip's pin needs the same #root prefix
    // plus the doubled bar class: (1,3,1).
    expect(responsiveCss).toMatch(
      /#root input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\)[^{}]*\{[^{}]*--control-zoom-safe-font-size/,
    );
    expect(barCss).toMatch(
      /#root \.filter-bar\.list-filter-bar \.filter-bar__search input,\s*#root \.filter-bar\.list-filter-bar \.date-range-fields input\s*\{\s*font-size:\s*var\(--filter-control-font-size\);/,
    );
    // ds-uui-select faces: the utility-classed trigger (0,1,0) and the native
    // select behind the `#root select` guard.
    expect(barCss).toMatch(
      /#root \.filter-bar\.list-filter-bar select,\s*#root \.filter-bar\.list-filter-bar \.ds-uui-select :is\(button, span, p\)\s*\{\s*font-size:\s*var\(--filter-control-font-size\);/,
    );
  });

  it('--filter-control-font-size resolves to the fixed 12px scale at every band', () => {
    // Desktop: compact control font. Phone band: the mobile control font.
    // Both aliases land on the 12px type scale — no viewport-relative size.
    expect(tokensCss).toContain('--control-compact-font-size: var(--text-control-compact-size)');
    expect(tokensCss).toContain('--control-mobile-font-size: var(--text-input-touch-size)');
    expect(tokensCss).toMatch(/--text-control-compact-size:\s*12px/);
    expect(tokensCss).toMatch(/--text-input-touch-size:\s*12px/);
    expect(tokensCss).toMatch(/--filter-control-font-size:\s*var\(--control-compact-font-size\)/);
    expect(tokensCss).toMatch(/--filter-control-font-size:\s*var\(--control-mobile-font-size\)/);
    // And the scale floor itself is fixed px, never vw.
    expect(tokensCss).not.toMatch(/--text-[a-z-]+-size:\s*[^;]*vw/);
  });
});
