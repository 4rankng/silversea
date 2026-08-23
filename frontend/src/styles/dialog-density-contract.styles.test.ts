import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = resolve(process.cwd(), 'src');

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return collectTsxFiles(full);
    return entry.name.endsWith('.tsx') ? [full] : [];
  });
}

// CUS / điều vận surfaces are frozen (customer-approved 2026-08-23). Their
// selects keep the legacy wrapper until the freeze lifts; fix them and drop
// the entry here at the same time.
const FROZEN_WRAPPER_ALLOWLIST = [
  'features/dispatch/components/ReassignDialog.tsx',
  'features/dispatch/components/DispatchTripCard.tsx',
];

describe('dialog density contract', () => {
  it('renders every select as one labelled control — no .input double boundary outside frozen dispatch surfaces', () => {
    const offenders = collectTsxFiles(srcRoot)
      .map((file) => ({ rel: file.slice(srcRoot.length + 1), text: readFileSync(file, 'utf8') }))
      .filter(({ rel, text }) => text.includes('wrapperClassName="input"') && !FROZEN_WRAPPER_ALLOWLIST.includes(rel))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('keeps every owned overlay family on the shared modal backdrop (0.56 + 2px blur)', () => {
    // Modal.css itself is the contract source; these are the families that
    // must not drift from it.
    const overlayFiles = [
      'src/components/ConfirmDialog.css',
      'src/components/Drawer.css',
      'src/pages/TruckTiresPage.css',
    ];

    for (const file of overlayFiles) {
      const css = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(css, `${file} backdrop opacity`).toContain('rgba(10, 10, 10, 0.56)');
      expect(css, `${file} backdrop blur`).toContain('blur(2px)');
    }
  });
});
