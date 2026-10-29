import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const styles = read('src/styles/operational-density.css');
const modalSource = read('src/components/UI.tsx');
const selectSource = read('src/design-system/forms/UuiSelectField.tsx');
const tableStyles = read('src/design-system/DataTable.css');

describe('operational density contract', () => {
  it('scopes the new dialog and form rules away from frozen workspaces', () => {
    expect(styles).toContain('.modal--operational-density .modal__body');
    expect(styles).toContain('.drawer--operational-density .drawer__body');
    expect(styles).toContain('.app--operational-density .ops-form-grid');
    expect(modalSource).toContain('hasOperationalDensity(currentPathname())');
    expect(selectSource).toContain('ds-uui-select--operational');
  });

  it('keeps non-frozen comparison tables bounded at long-content widths', () => {
    expect(tableStyles).toMatch(/\.ds-table--operational\s*\{[^}]*table-layout:\s*fixed;/);
    expect(tableStyles).toMatch(/\.ds-table--operational th,[\s\S]*?overflow-wrap:\s*anywhere;/);
  });

  it('lets operational phone and tablet fields own one boundary without changing action targets', () => {
    const geometry = read('src/components/untitled-ui/base/control-geometry.css');
    const outer = /\.ds-uui-select--operational \.ds-uui-select__control > button,\s*\.ds-uui-select--operational \.ds-uui-select__control > \[role='group'\]\s*\{([^}]+)\}/;
    expect(styles).toMatch(outer);
    expect(styles.match(outer)?.[1]).not.toMatch(/(?:^|;)\s*(?:min-height|height|padding(?:-block)?)\s*:/);
    expect(geometry).toMatch(/\[data-uui-control\]\s*\{[^}]*min-height:\s*var\(--uui-control-h\);/);
    expect(geometry).toMatch(/@media \(max-width: 640px\)\s*\{\s*\[data-uui-control\]\[data-control-size='sm'\]\s*\{[^}]*--uui-control-h:\s*var\(--control-mobile-h\);/);
    expect(geometry).toMatch(/@media \(pointer: coarse\)\s*\{\s*\[data-uui-control\],\s*\[data-uui-control\]\[data-control-size\]\s*\{[^}]*--uui-control-h:\s*var\(--control-touch-h\);/);
    expect(geometry).toMatch(/\[data-uui-control='select'\] > \[data-uui-select-value\],\s*\[data-uui-control='combobox'\] > \[data-combobox-value\]\s*\{[^}]*min-height:\s*calc\(var\(--uui-control-h\) - 2px\);[^}]*padding-block:\s*4px;/);
    const comboboxStyles = read('src/components/untitled-ui/base/select/combobox.css');
    expect(read('src/components/untitled-ui/base/select/combobox.tsx')).toContain('import "./combobox.css"');
    expect(comboboxStyles).toContain('@media (max-width: 640px), (pointer: coarse)');
    // Contract (SIL-583 29/10, supersedes the 09-26 zeroing): the input stays
    // one boundary with the field (`height: 100%`, no second box) but its HIT
    // box floors at the WCAG 2.5.8 24px target — padding-block + equal
    // negative margins grow the measured target without moving the text or
    // changing the field height. The former `min-height: 0; padding-block: 0`
    // measured 21.6px in the phone band (QA fail 29/10).
    expect(comboboxStyles).toMatch(/#root \.uui-combobox \[data-combobox-value\] input\[role='combobox'\]\s*\{[^}]*min-height:\s*24px;[^}]*height:\s*100%;[^}]*padding-block:\s*4px;[^}]*margin-block:\s*-4px;/);
    expect(read('src/components/untitled-ui/base/select/select-shared.tsx')).toContain('import "../control-geometry.css"');
    expect(read('src/components/untitled-ui/base/select/select-item.tsx')).toContain('max-md:min-h-[calc(var(--control-max-h)-2px)]');
    expect(read('src/components/untitled-ui/base/buttons/button.tsx')).toContain('max-md:min-h-11');
  });

  it('does not wrap a UUI select in the legacy input boundary in repaired dialogs', () => {
    for (const path of [
      'src/features/fleet/TrailerFormModal.tsx',
      'src/features/penalties/components/PenaltyFormDrawer.tsx',
      'src/features/tires/tire-dialogs.tsx',
      'src/features/users/components/UserForm.tsx',
    ]) {
      expect(read(path)).not.toContain('wrapperClassName="input"');
    }
  });
});
