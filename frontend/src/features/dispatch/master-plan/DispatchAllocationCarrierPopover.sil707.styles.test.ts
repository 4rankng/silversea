// SIL-707: Popup chọn nhà xe nội bộ bị đè dòng, không cuộn.
// Fix: popup/max-height + overflow-y auto (8 lựa chọn ~max-height 320-400px),
// không đè dòng dưới kiểu che khuất — hoặc dùng popover có scroll.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const popoverCss = readFileSync(
  resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchAllocationPopover.css'),
  'utf8'
);

const selectCss = readFileSync(
  resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.css'),
  'utf8'
);

const comboboxCss = readFileSync(
  resolve(process.cwd(), 'src/components/untitled-ui/base/select/combobox.css'),
  'utf8'
);

function hasDeclaration(source: string, selector: string, prop: string, valueRegex: RegExp): boolean {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rulePattern = /([^{}]+)\{([^}]*)\}/g;
  for (const match of stripped.matchAll(rulePattern)) {
    const selectors = match[1].split(',').map((s) => s.trim());
    if (selectors.some((sel) => sel.includes(selector))) {
      const decls = match[2].split(';');
      for (const d of decls) {
        const [p, ...v] = d.split(':');
        if (p?.trim().toLowerCase() === prop.toLowerCase()) {
          if (valueRegex.test(v.join(':').trim())) return true;
        }
      }
    }
  }
  return false;
}

describe('SIL-707 — Popup chọn nhà xe nội bộ có max-height và scroll', () => {
  it('DispatchAllocationPopover.css declares max-height and overflow-y: auto on carrier dropdown', () => {
    expect(
      hasDeclaration(
        popoverCss,
        '.dispatch-allocation-popover__carrier-dropdown',
        'max-height',
        /360px/
      )
    ).toBe(true);

    expect(
      hasDeclaration(
        popoverCss,
        '.dispatch-allocation-popover__carrier-dropdown',
        'overflow-y',
        /auto/
      )
    ).toBe(true);
  });

  it('UuiSelectField.css declares max-height and overflow-y: auto on .ds-uui-select__popover', () => {
    expect(
      hasDeclaration(
        selectCss,
        '.ds-uui-select__popover',
        'max-height',
        /360px/
      )
    ).toBe(true);

    expect(
      hasDeclaration(
        selectCss,
        '.ds-uui-select__popover',
        'overflow-y',
        /auto/
      )
    ).toBe(true);
  });

  it('combobox.css declares max-height and overflow-y: auto for select popovers', () => {
    expect(
      hasDeclaration(
        comboboxCss,
        '.uui-select-popover',
        'max-height',
        /360px/
      )
    ).toBe(true);

    expect(
      hasDeclaration(
        comboboxCss,
        '.uui-select-popover',
        'overflow-y',
        /auto/
      )
    ).toBe(true);
  });
});
