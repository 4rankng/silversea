import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The ops modal shell (.ops-modal-backdrop/.ops-modal + form/button styles)
// is owned by the components that render it, not by any page stylesheet.
// History: the rules lived in OpsOrdersPage.css, so the same dialogs rendered
// UNSTYLED inline (no backdrop, no card, joined ĐóngLưu footer) on pages that
// never import that file — /fleet/vehicles' Ops-phụ-trách dialog and
// /ops/wallet on a fresh load. If a new component copies one of these modals
// without importing the shared stylesheet, this lock fails before the
// copy-paste hole ships.
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

  it.each(SHELL_COMPONENTS)('%s imports the shared shell stylesheet', (file) => {
    const source = readFileSync(resolve(process.cwd(), 'src/features/ops', file), 'utf8');
    expect(source).toMatch(/^import\s+'\.\/ops-modal\.css';/m);
  });

  it('the backdrop is fixed above the app topbar and the surface really paints', () => {
    // var(--z-modal) (300) outranks the topbar's var(--z-sticky) (100), so the
    // fixed page header can never cover a dialog's title or close control.
    expect(css).toMatch(/\.ops-modal-backdrop\s*\{[^}]*position:\s*fixed;/);
    expect(css).toMatch(/\.ops-modal-backdrop\s*\{[^}]*z-index:\s*var\(--z-modal\);/);
    expect(css).not.toMatch(/\.ops-modal-backdrop\s*\{[^}]*z-index:\s*\d/);
    // The dialog surface is opaque — an unstyled inline render fails this.
    // Stale-pin repair (red census 2026-09-23): a8c84bea (card 20260922_36,
    // F4 fill sweep) moved the surface fill to var(--surface) per law book
    // §3 — floating overlays are always --surface, never a canvas alias.
    expect(css).toMatch(/\.ops-modal\s*\{[^}]*background:\s*var\(--surface\)/);
  });

  it('OpsOrdersPage.css no longer carries the moved shell (moved, not copied)', () => {
    const pageCss = readFileSync(resolve(process.cwd(), 'src/pages/OpsOrdersPage.css'), 'utf8');
    expect(pageCss).not.toMatch(/\.ops-modal-backdrop/);
    expect(pageCss).not.toMatch(/\.ops-form-grid/);
  });

  it('the backdrop centers its surface on both axes so a dialog never hugs the top or shifts left (card 20260924_1, image10)', () => {
    // Image10: "Chi tiết chi hộ" showed off-centre — justify-content already
    // centers horizontally for the single surviving surface (card
    // 20260923_11 removed the second stacked surface); align-items must
    // center vertically so the dialog sits mid-viewport ("căn giữa
    // viewport"). The surface max-height (100dvh - 48px) always fits the
    // 24px-padded backdrop box, so centering never clips — the body scrolls.
    const backdrop = css.match(/\.ops-modal-backdrop\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(backdrop).toContain('justify-content: center');
    expect(backdrop).toContain('align-items: center');
  });
});
