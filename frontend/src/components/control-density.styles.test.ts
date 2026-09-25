import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const filesUnder = (directory: string, extension: string): string[] => readdirSync(resolve(process.cwd(), directory), { withFileTypes: true }).flatMap((entry) => {
  const relativePath = join(directory, entry.name);
  if (entry.isDirectory()) return filesUnder(relativePath, extension);
  return entry.isFile() && entry.name.endsWith(extension) ? [relativePath] : [];
});
const cssFilesUnder = (directory: string) => filesUnder(directory, '.css');
const targetsUuiField = (selector: string) => /uui-(?:field|control|input|select)|\[data-input-(?:wrapper|size)/.test(selector.replace(/:not\([^)]*\)/g, ''));

describe('shared control density', () => {
  it('defines compact, default, and touch-safe control tokens', () => {
    const tokens = read('src/styles/tokens.css');

    expect(tokens).toMatch(/--control-compact-h:\s*30px;/);
    expect(tokens).toMatch(/--control-default-h:\s*34px;/);
    expect(tokens).toMatch(/--control-touch-h:\s*44px;/);
    expect(tokens).toMatch(/--control-mobile-h:\s*var\(--control-touch-h\);/);
    expect(tokens).toMatch(/--control-compact-font-size:\s*var\(--text-control-compact-size\);/);
    expect(tokens).toMatch(/--control-compact-line-height:\s*18px;/);
    // Touch values resolve through the chosen product typography scale.
    expect(tokens).toMatch(/--control-compact-touch-font-size:\s*var\(--text-input-touch-size\);/);
    expect(tokens).toMatch(/--control-compact-touch-line-height:\s*20px;/);
  });

  it('keeps the global native-control font reset below component utilities', () => {
    const base = read('src/styles/base.css');

    expect(base).toMatch(/@layer base\s*\{[\s\S]*?button\s*\{\s*font:\s*inherit;[\s\S]*?input, select, textarea\s*\{\s*font:\s*inherit;/);
  });

  it('keeps legacy small buttons compact instead of promoting them to medium', () => {
    const source = read('src/components/UI.tsx');
    const css = read('src/components/Button.css');

    expect(source).toContain("const BTN_SIZE_MAP = { sm: 'sm', md: 'md' } as const;");
    expect(css).toMatch(/\.btn--sm\s*\{[^}]*min-height:\s*var\(--control-compact-h\);/);
    expect(css).toMatch(/@media \(max-width:\s*640px\)[\s\S]*?\.btn--sm\s*\{[^}]*min-height:\s*var\(--control-touch-h\);/);
  });

  it('leaves dimensions to shared primitives instead of shipment page overrides', () => {
    const overview = read('src/pages/ShipmentsPage.css');
    const detail = read('src/pages/ShipmentContainersPage.css');
    const detailControlBlocks = [...detail.matchAll(/\.shipments-detail-filter input\s*\{([^}]*)\}/g)]
      .map((match) => match[1]);

    expect(overview).not.toMatch(/\.shipment-uui-control__input\s*\{[^}]*(?:height|min-height):/);
    expect(overview).not.toMatch(/\.cus-worksheet-toolbar__actions \.shipment-uui-button\s*\{[^}]*(?:height|min-height|font-size|padding):/);
    expect(detailControlBlocks).not.toHaveLength(0);
    expect(detailControlBlocks.every((block) => !/(?:^|[;\s])(?:height|min-height|font(?:-size)?|line-height|padding(?:-\w+)?)\s*:/.test(block))).toBe(true);
  });

  it('keeps compact field typography in shared primitives instead of page workarounds', () => {
    const input = read('src/components/untitled-ui/base/input/input.tsx');
    const nativeSelect = read('src/components/untitled-ui/base/select/select-native.tsx');
    const select = read('src/components/untitled-ui/base/select/select-shared.tsx');
    const textarea = read('src/components/untitled-ui/base/textarea/textarea.tsx');
    const bufferedDate = read('src/design-system/forms/BufferedUuiDateInput.tsx');
    const overview = read('src/pages/ShipmentsPage.css');
    const detail = read('src/pages/ShipmentContainersPage.css');
    const shipmentCreate = read('src/pages/clerk/ClerkShipmentCreatePage.css');

    for (const source of [input, nativeSelect, select, textarea]) {
      expect(source).toContain('fieldTextSizes');
      expect(source).not.toContain('max-md:text-sm');
    }
    expect(overview).not.toMatch(/\.shipment-uui-control__input\s*\{[^}]*font\s*:/);
    expect(detail).not.toMatch(/\.shipments-detail-filter input::placeholder\s*\{[^}]*font-size\s*:/);
    expect(shipmentCreate).not.toMatch(/\.csc-section textarea\s*\{[^}]*font\s*:/);
    for (const source of [input, select]) expect(source).toContain('control-geometry.css');
    const geometry = read('src/components/untitled-ui/base/control-geometry.css');
    expect(geometry).toMatch(/\[data-uui-control\]\[data-control-size='sm'\]\s*\{[^}]*--uui-control-h:\s*var\(--control-compact-h\)/);
    expect(geometry).toMatch(/@media \(pointer: coarse\)[\s\S]*--uui-control-h:\s*var\(--control-touch-h\)/);
    expect(nativeSelect).toContain('max-md:min-h-11');
    expect(bufferedDate).toContain('size={size}');
  });

  it('distinguishes excluded UUI descendants from selectors that actually style UUI fields', () => {
    expect(targetsUuiField('.form input:not([data-uui-control] > input)')).toBe(false);
    expect(targetsUuiField('.form .ds-uui-select input:not([type="hidden"])')).toBe(true);
    expect(targetsUuiField('.form [data-input-wrapper]')).toBe(true);
  });

  it('rejects UUI field dimensions from every page and feature stylesheet', () => {
    // Form-scoped conformance skins are sanctioned by the design guidelines
    // ("scope a local conformance skin (label + trigger metrics) to the form,
    // as the CUS quick-edit modal does" — docs/design-guidelines.md, Dense
    // dialogs & forms). Every entry must stay scoped to a named form surface:
    // a bare `.ds-uui-*` selector is never allowed here.
    const sanctionedConformanceScopes = [
      '.cus-quick-edit-modal__fields .ds-uui-select',
      '.shipments-detail-filters .ds-uui-select',
      '.cus-worksheet-toolbar .ds-uui-select',
      '.penalty-filter-bar .ds-uui-select',
      '.dispatch-allocation-popover__row .ds-uui-select',
      '.trip-list-page .filter-chip .ds-uui-select',
      // CUS /shipments/new local conformance skin — the shared UUI label
      // defaults vary per component (combobox vs text vs date), so the
      // form aligns them to the dense 12/18 semibold cadence. Scope is
      // the CUS form's own `.csc-uui-field` wrapper, not a bare `ds-uui-*`.
      '.csc-uui-field label',
      // Card 20260925_1 (CHIEF 25/09 09:46, 390px screenshot): the mobile
      // filter surfaces pin every UUI field to the chosen 44px height token
      // so search/date/select all read the same row height. Each scope is a
      // named filter surface (not a bare `ds-uui-*`), confined to the
      // page-owned filter skin that ships with the mobile pair layout.
      '.deposit-tracker-filters [data-input-wrapper]',
      '.deposit-tracker-filters [data-uui-control]',
      '.deposit-tracker-filters .ds-uui-select',
      '.ppc-filters input',
      '.ppc-filters [data-uui-control]',
      '.ppc-filter-actions [data-uui-control]',
    ];
    const isSanctioned = (selector: string) => sanctionedConformanceScopes.some((scope) => selector.includes(scope));

    const violations = cssFilesUnder('src/pages').concat(cssFilesUnder('src/features')).flatMap((path) => {
      const blocks = [...read(path).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      return blocks.flatMap(([, selector, declarations]) => {
        const ownsDimensions = /(?:^|;)\s*(?:height|min-height|font(?:-size)?|line-height)\s*:/.test(declarations);
        return targetsUuiField(selector) && ownsDimensions && !isSanctioned(selector) ? [`${path}: ${selector.trim()}`] : [];
      });
    });

    expect(violations).toEqual([]);
  });

  it('keeps controlClassName selectors honest — the class sits on the trigger button itself', () => {
    // UuiSelectField forwards controlClassName to the vendored Select's real
    // trigger <button> (triggerClassName), and no native <select> renders
    // anywhere (the ESLint guard bans it). A page selector like
    // `.foo > button` or `select.foo` therefore matches nothing — CSS that
    // lies about its own structure. Style the class directly.
    const controlClasses = new Set<string>();
    for (const path of filesUnder('src', '.tsx').filter((path) => !path.includes('.test.'))) {
      for (const match of read(path).matchAll(/controlClassName="([^"]+)"/g)) {
        for (const token of match[1].split(/\s+/)) controlClasses.add(token);
      }
    }
    expect(controlClasses.size).toBeGreaterThan(0);

    const stylesButtonElement = (selector: string) => /(?:^|[^.\w-])button(?![\w-])/.test(selector);
    const violations = cssFilesUnder('src/pages').concat(cssFilesUnder('src/features'), cssFilesUnder('src/components'), cssFilesUnder('src/styles'), cssFilesUnder('src/design-system')).flatMap((path) => {
      // Strip comments first: a selector capture would otherwise include the
      // comment text, and prose like "…lands on the button" false-positives.
      const blocks = [...read(path).replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)];
      return blocks.flatMap(([, selector]) =>
        selector.split(',').map((part) => part.trim()).filter((part) => {
          const controlClass = [...controlClasses].find((token) => new RegExp(`\\.${token}(?![\\w-])`).test(part));
          if (!controlClass) return false;
          return stylesButtonElement(part) || new RegExp(`(?:^|[\\s>+~])select\\.${controlClass}(?![\\w-])`).test(part);
        }).map((part) => `${path}: ${part}`));
    });

    expect(violations).toEqual([]);
  });
});
