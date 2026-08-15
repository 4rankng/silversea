import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('keyboard shortcut visibility', () => {
  it('does not render shortcut badges in global navigation or command results', () => {
    const topbar = source('src/components/layout/Topbar.tsx');
    const commandPalette = source('src/components/shared/CommandPalette.tsx');

    expect(topbar).not.toContain('<kbd');
    expect(topbar).not.toContain('⌘');
    expect(commandPalette).not.toContain('<kbd');
    expect(commandPalette).not.toContain('cmd-palette__shortcut');
  });

  it('keeps searchable controls shortcut-free by default', () => {
    const comboBox = source('src/components/untitled-ui/base/select/combobox.tsx');
    expect(comboBox).toContain('shortcut = false');
  });

  it('does not advertise editor keyboard combinations', () => {
    const containerLedger = source('src/features/shipments/detail/ShipmentContainerLedger.tsx');
    expect(containerLedger).not.toContain('Ctrl/Cmd');
    expect(containerLedger).not.toContain('escape-hint');
  });
});
