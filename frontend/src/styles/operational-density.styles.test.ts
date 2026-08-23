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
