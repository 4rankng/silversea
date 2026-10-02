import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.css'), 'utf8');

// UI40 preserves intrinsic expansion for long options while the viewport cap
// wins. An unbounded max-content minimum made the390px driver menu458px wide.
describe('select popover preserves complete labels inside its viewport', () => {
  it('expands intrinsically but bounds both minimum and maximum by the viewport', () => {
    const rules = [...css.matchAll(/\.ds-uui-select__popover\s*\{([^}]*)\}/g)].map(match => match[1]).join('\n');
    expect(rules).toMatch(/width:\s*max-content/);
    expect(rules).toMatch(/min-width:\s*min\(max\(220px,\s*var\(--trigger-width,\s*220px\)\),\s*calc\(100vw - 32px\)\)/);
    expect(rules).toMatch(/max-width:\s*calc\(100vw - 32px\)/);
    expect(rules).not.toMatch(/min-width:\s*max-content/);
    const options = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/select/select-item.tsx'), 'utf8');
    expect(options).toMatch(/slot="label"[^>]*className=\{cx\("[^"]*min-w-0[^"]*whitespace-normal/);
    expect(options).not.toMatch(/slot="label"[^>]*(truncate|text-ellipsis)/);
  });

  it('accounts for both outer option pixels in the single-line touch budget without clipping labels', () => {
    const options = readFileSync(resolve(process.cwd(), 'src/components/untitled-ui/base/select/select-item.tsx'), 'utf8');
    expect(options).toContain('w-full py-px outline-hidden');
    expect(options).toContain('max-md:min-h-[calc(var(--control-max-h)-2px)]');
    expect(options).toContain('[@media(pointer:coarse)]:min-h-[calc(var(--control-max-h)-2px)]');
    expect(options).not.toContain('min-h-11');
    expect(options).not.toContain('root: "p-2.5');
    // md/lg's supported24px avatar also fits:24+6+6+2outer=38.
    expect(options).toContain('root: "py-1.5 pl-2 pr-2.5');
    expect(options).toContain('root: "px-2.5 py-1.5 pl-2');
    expect(options).toMatch(/slot="label"[^>]*whitespace-normal/);
    expect(options).not.toMatch(/(?:max-h-|overflow-hidden|line-clamp-|truncate)/);
  });

  it('keeps custom single, multi, inline and time option owners on the same current token', () => {
    const pickerFiles = [
      'src/design-system/forms/SearchableSelect.css',
      'src/design-system/forms/InlineLabelSelect.css',
      'src/design-system/forms/DateTimePickerPanels.css',
      'src/design-system/forms/DatePickerSurface.css',
      'src/components/shared/CommandPalette.css',
    ];
    for (const file of pickerFiles) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toMatch(/(?:min-height|height|width):\s*(?:42|44)px/);
      expect(source, file).toContain('var(--control-max-h)');
    }
    const multi = readFileSync(resolve(process.cwd(), 'src/design-system/forms/SearchableMultiSelect.tsx'), 'utf8');
    expect(multi).toContain('searchable-select__option');
  });

  it('does not retain obsolete coarse floors in alternate vendor option owners', () => {
    for (const file of [
      'src/components/untitled-ui/base/select/select-native.tsx',
      'src/components/ui/Select/Select.tsx',
      'src/components/ui/DropdownMenu/DropdownMenu.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source, file).not.toContain('min-h-11');
      expect(source, file).toContain('var(--control-max-h)');
    }
  });
});

describe('UuiSelectField leading icon (card 20260926_57)', () => {
  it('forwards the icon prop to both control branches', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.tsx'), 'utf8');
    // declared + destructured + forwarded to the ComboBox and the Select branch
    expect(src).toMatch(/icon\?: ReactNode/);
    expect(src.match(/icon=\{icon\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});

describe('UuiSelectField shared toolbar label/control/feedback anatomy', () => {
  const labelledToolbar = '.filter-bar .ds-uui-select:has(.ds-uui-select__control > [data-label])';
  function ownerBody(selector: string) {
    const start = css.indexOf(selector);
    return start < 0 ? '' : css.slice(start + selector.length).match(/^\s*\{([^}]*)\}/)?.[1] ?? '';
  }

  it('budgets the complete labelled toolbar field while retaining capped and stacked counterparts', () => {
    // UI63 native:98.25px label +8px gap +existing200px searchable floor
    // needed306.25px, but the old280px whole-field cap painted into its sibling.
    const field = ownerBody(labelledToolbar);
    expect(field).toMatch(/(?:^|;)\s*width:\s*fit-content\s*;/);
    expect(field).toMatch(/(?:^|;)\s*max-width:\s*100%\s*;/);
    expect(field).not.toMatch(/min-width:\s*max-content|overflow:\s*hidden|height:/);
    const trigger = ownerBody(`${labelledToolbar} .ds-uui-select__control > [data-uui-control]`);
    expect(trigger).toMatch(/max-width:\s*min\(280px,\s*100%\)/);
    expect(trigger).not.toMatch(/min-width:|height:|overflow:/);
    // The shared owner transfers only a visible bar label's budget. Existing
    // hidden-label/folded field caps and the searchable minimum stay intact.
    for (const file of ['src/pages/ShipmentContainersPage.css', 'src/pages/trip-list/filters.css']) {
      expect(readFileSync(resolve(process.cwd(), file), 'utf8')).toMatch(/:is\(\.filter-bar,\s*\.filter-dropdown__body\)[^{]+\.ds-uui-select\s*\{\s*max-width:\s*280px;\s*\}/);
    }
    const list = readFileSync(resolve(process.cwd(), 'src/components/ListFilterBar.css'), 'utf8');
    expect(list).toMatch(/\.list-filter-bar \[data-uui-control='combobox'\]\s*\{[^}]*min-width:\s*200px/);
  });

  it('wraps a complete inline label and control at the available boundary without clipping either', () => {
    const row = ownerBody(':is(.ds-uui-select--inline, .filter-bar .ds-uui-select) .ds-uui-select__control');
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    const label = ownerBody(':is(.ds-uui-select--inline, .filter-bar .ds-uui-select) [data-label]');
    expect(label).toMatch(/max-width:\s*100%/);
    expect(label).toMatch(/white-space:\s*normal/);
    expect(label).toMatch(/overflow-wrap:\s*normal/);
    expect(label).toMatch(/word-break:\s*normal/);
    expect(label).not.toMatch(/nowrap|ellipsis|overflow:\s*hidden/);
  });

  it('normalizes only the hosted inner control row while keeping its outer feedback stack', () => {
    const outer = css.match(/\.ds-uui-select\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(outer).toContain('display: grid');
    expect(outer).toContain('grid-template-columns: minmax(0, 1fr)');
    const row = css.match(/:is\(\.ds-uui-select--inline,\s*\.filter-bar \.ds-uui-select\) \.ds-uui-select__control\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(row).toContain('flex-direction: row');
    expect(row).toContain('align-items: center');
    expect(css).toMatch(/:is\(\.ds-uui-select--inline,\s*\.filter-bar \.ds-uui-select\) \[data-label\]/);
    const label = css.match(/:is\(\.ds-uui-select--inline,\s*\.filter-bar \.ds-uui-select\) \[data-label\]\s*\{([^}]*)\}/)?.[1] ?? '';
    // A mobile ListFilterBar stacked-label margin otherwise moves the inline
    // label centre two pixels above the control, despite align-items:center.
    expect(label).toMatch(/(?:^|;)\s*margin:\s*0\s*;/);
    expect(css).not.toMatch(/\.filter-bar \.ds-uui-select\s*\{[^}]*display:\s*flex/);
  });

  it('keeps ordinary form full-value wrapping separate from the toolbar row', () => {
    const stacked = [...css.matchAll(/([^{}]+)\{[^{}]*\}/g)].map(match => match[1]).filter(selector => selector.includes('.ds-uui-select:has([data-label])'));
    expect(stacked).toHaveLength(4);
    for (const selector of stacked) {
      expect(selector).toContain(':not(.ds-uui-select--inline)');
      expect(selector).toContain(':not(.ds-uui-select--content)');
      expect(selector).toContain(':not(.filter-bar .ds-uui-select)');
    }
    expect(css).toContain('white-space: normal');
    expect(css).toContain('text-overflow: clip');
    expect(css).toContain('overflow: visible');
  });
});
