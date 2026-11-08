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

/** SIL-707 r2 (QA verdict 07/11): the scroll fix alone still OVERLAPPED — the
 *  picker on row 1 covered row 2's combobox and escaped the dialog's bottom
 *  edge. The carrier picker now pins the overlay ABOVE the trigger
 *  (no-overlap doctrine), and the shared overlay measures the same side for
 *  its fit cap. */
describe('SIL-707 r2 — carrier picker opens ABOVE the trigger (no row-below overlap)', () => {
  const daySection = readFileSync(
    resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchAllocationDaySection.tsx'),
    'utf8',
  );
  const selectField = readFileSync(
    resolve(process.cwd(), 'src/design-system/forms/UuiSelectField.tsx'),
    'utf8',
  );
  const select = readFileSync(
    resolve(process.cwd(), 'src/components/untitled-ui/base/select/select.tsx'),
    'utf8',
  );
  const combobox = readFileSync(
    resolve(process.cwd(), 'src/components/untitled-ui/base/select/combobox.tsx'),
    'utf8',
  );
  const popover = readFileSync(
    resolve(process.cwd(), 'src/components/untitled-ui/base/select/popover.tsx'),
    'utf8',
  );

  it('the allocation row carrier field pins popoverPlacement="top"', () => {
    expect(daySection).toContain('popoverPlacement="top"');
  });

  it('UuiSelectField forwards popoverPlacement into both control variants', () => {
    expect(selectField).toContain('popoverPlacement?: PopoverProps["placement"]');
    expect(selectField.match(/popoverPlacement=\{popoverPlacement\}/g)?.length).toBe(2);
  });

  it('UUI Select + ComboBox hand the placement to the shared Popover', () => {
    expect(select).toContain('placement={rest.popoverPlacement}');
    expect(combobox).toContain('placement={otherProps.popoverPlacement}');
  });

  it('the Popover measures the side it opens on for the fit cap', () => {
    expect(popover).toContain('fitAboveMaxHeight');
    expect(popover).toMatch(/placement === "top"\s*\?\s*\n?\s*fitAboveMaxHeight/);
  });
});
