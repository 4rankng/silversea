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

  it('QA-AUDIT-UI59 keeps icon-labelled header actions in a row and lets house Btn own its paint and density', () => {
    const shared = css.match(/\.ops-modal__head button\s*\{([^}]+)\}/)?.[1];
    expect(shared).toBeDefined();
    expect(shared).toContain('display: inline-flex');
    expect(shared).toContain('align-items: center');
    expect(shared).toContain('justify-content: center');
    // SVG + an anonymous text node must not become two implicit grid rows.
    expect(shared).not.toMatch(/inline-grid|place-items|background|border:|color:|padding|gap:|min-height|min-width/);
    const close = css.match(/\.ops-modal__head button:not\(\.btn\)\s*\{([^}]+)\}/)?.[1];
    expect(close).toBeDefined();
    expect(close).toContain('background: transparent');
    expect(close).toContain('border: none');
    expect(close).toContain('min-height: 36px');
    const own = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsSettlementsPanel.tsx'), 'utf8');
    const accountant = readFileSync(resolve(process.cwd(), 'src/features/ops/OpsAccountantTab.tsx'), 'utf8');
    for (const source of [own, accountant]) {
      expect(source).toContain('className="btn btn--secondary"');
      expect(source).toContain('aria-label="Đóng"');
      expect(source).toContain('downloadSettlementExport');
    }
    expect(own).toContain('<Download size={14} /> Excel');
    expect(own).toContain('<Printer size={14} /> In');
    expect(own).toContain('window.print()');
  });

  it('QA-AUDIT-UI59 self-owns header sibling spacing for a fresh accountant visit', () => {
    const group = css.match(/\.ops-modal__head-actions\s*\{([^}]+)\}/)?.[1];
    expect(group).toBeDefined();
    expect(group).toContain('display: inline-flex');
    expect(group).toContain('align-items: center');
    expect(group).toContain('gap: 8px');
    const wallet = readFileSync(resolve(process.cwd(), 'src/pages/OpsWalletPage.css'), 'utf8');
    expect(wallet).not.toContain('.ops-modal__head-actions');
  });

  it('OpsOrdersPage.css no longer carries the moved shell (moved, not copied)', () => {
    const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');
    expect(pageCss).not.toMatch(/\.ops-modal-backdrop/);
    expect(pageCss).not.toMatch(/\.ops-form-grid/);
  });
});
