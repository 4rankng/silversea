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
    const phone = styles.slice(styles.indexOf('@media (max-width: 640px)'));
    const outer = /\.ds-uui-select--operational \.ds-uui-select__control > button,\s*\.ds-uui-select--operational \.ds-uui-select__control > \[role='group'\]\s*\{([^}]+)\}/;
    expect(phone.match(outer)?.[1]).toMatch(/min-height:\s*var\(--control-mobile-h\);/);
    expect(phone).toMatch(/\[data-combobox-value\]\s*\{[^}]*min-height:\s*calc\(var\(--control-mobile-h\) - 2px\);[^}]*padding-block:\s*4px;/);
    const comboboxStyles = read('src/components/untitled-ui/base/select/combobox.css');
    expect(read('src/components/untitled-ui/base/select/combobox.tsx')).toContain('import "./combobox.css"');
    expect(comboboxStyles).toContain('@media (max-width: 640px), (pointer: coarse)');
    const touchInputReset = comboboxStyles;
    expect(touchInputReset).toMatch(/#root \.uui-combobox \[data-combobox-value\] input\[role='combobox'\]\s*\{[^}]*min-height:\s*0;[^}]*height:\s*auto;[^}]*padding-block:\s*0;/);
    expect(comboboxStyles).toMatch(/\.uui-combobox\[data-size='sm'\] \[data-combobox-value\]\s*\{[^}]*min-height:\s*calc\(var\(--control-touch-h\) - 2px\);/);
    const coarse = styles.slice(styles.indexOf('@media (pointer: coarse)'), styles.indexOf('@media (max-width: 640px)'));
    expect(coarse.match(outer)?.[1]).toMatch(/min-height:\s*var\(--control-touch-h\);/);
    expect(coarse).toMatch(/\[data-combobox-value\]\s*\{[^}]*min-height:\s*calc\(var\(--control-touch-h\) - 2px\);/);
    expect(read('src/components/untitled-ui/base/select/select-shared.tsx')).toContain('max-md:min-h-11');
    expect(read('src/components/untitled-ui/base/select/select-item.tsx')).toContain('max-md:min-h-11');
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
