import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The ops modal SKIN (.ops-modal + form/button styles) is owned by the
// components that render it, not by any page stylesheet. History: these
// rules lived in OpsOrdersPage.css, so the same dialogs rendered UNSTYLED
// inline on pages that never imported that file — /fleet/vehicles'
// Ops-phụ-trách dialog and /ops/wallet on a fresh load. If a new component
// copies one of these modals without importing the shared stylesheet, this
// lock fails before the copy-paste hole ships.
//
// Card 20260930_227: the overlay MECHANICS (portal, scrim, z-index, Escape,
// focus, scroll lock) moved to the one design-system modal module, so this
// file no longer carries a backdrop — the pins below hold that boundary.
const SHELL_COMPONENTS = [
  'OpsExpenseFormModal.tsx',
  'OpsExpenseEditModal.tsx',
  'OpsExpensePhotosModal.tsx',
  'OpsAdvanceRequestModal.tsx',
  'AssignOpsDialog.tsx',
  'OpsSettlementsPanel.tsx',
  'OpsAccountantTab.tsx',
  'OpsExpenseHistory.tsx',
];

describe('ops modal shell stylesheet ownership', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/features/ops/ops-modal.css'), 'utf8');
  const moduleCss = readFileSync(resolve(process.cwd(), 'src/design-system/Modal.css'), 'utf8');

  it.each(SHELL_COMPONENTS)('%s imports the shared shell stylesheet', (file) => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/ops', file), 'utf8');
    expect(source).toMatch(/^import\s+'\.\/ops-modal\.css';/m);
  });

  it('no parallel backdrop: the overlay layer lives only in the design-system module', () => {
    // The module's overlay is fixed, above the app topbar (var(--z-modal)
    // outranks the topbar's var(--z-sticky)), and centers on both axes (card
    // 20260924_1 image10: the dialog sits mid-viewport).
    expect(css).not.toMatch(/\.ops-modal-backdrop/);
    expect(moduleCss).toMatch(/^\.modal\s*\{[^}]*position:\s*fixed;/m);
    expect(moduleCss).toMatch(/^\.modal\s*\{[^}]*z-index:\s*var\(--z-modal\);/m);
    expect(moduleCss).toMatch(/^\.modal\s*\{[^}]*align-items:\s*center;/m);
    expect(moduleCss).toMatch(/^\.modal\s*\{[^}]*justify-content:\s*center;/m);
    // The bare overlay keeps the centered shape on phones (the house
    // bottom-sheet alignment is house-chrome behavior only).
    expect(moduleCss).toMatch(/@media \(max-width: 640px\)[\s\S]*?\.modal--bare\s*\{[^}]*align-items:\s*center;/);
  });

  it('the ops surface really paints — opaque --surface fill per law §3', () => {
    expect(css).toMatch(/\.ops-modal\s*\{[^}]*background:\s*var\(--surface\)/);
  });

  it('OpsOrdersPage.css no longer carries the moved shell (moved, not copied)', () => {
    const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');
    expect(pageCss).not.toMatch(/\.ops-modal-backdrop/);
    expect(pageCss).not.toMatch(/\.ops-form-grid/);
  });
});
