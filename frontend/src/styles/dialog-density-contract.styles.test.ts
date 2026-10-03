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

describe('dialog density contract', () => {
  it('keeps phone text fields aligned with the shared phone select without collapsing notes', () => {
    const modal = readFileSync(resolve(process.cwd(), 'src/design-system/Modal.css'), 'utf8');
    expect(modal).toMatch(/\.modal__body \.field \.input:not\(textarea\)\s*\{[^}]*min-height:\s*var\(--control-mobile-h\)/);
    const ui = readFileSync(resolve(process.cwd(), 'src/components/UI.css'), 'utf8');
    expect(ui).toMatch(/\.field > \[data-label\]\s*\{[^}]*margin-bottom:\s*0/);
  });

  it('renders every select as one labelled control — no .input double boundary anywhere', () => {
    const offenders = collectTsxFiles(srcRoot)
      .map((file) => ({ rel: file.slice(srcRoot.length + 1), text: readFileSync(file, 'utf8') }))
      .filter(({ text }) => /wrapperClassName=\{?["']input["']\}?/.test(text))
      .map(({ rel }) => rel);

    expect(offenders).toEqual([]);
  });

  it('keeps every owned overlay family on the shared modal scrim token', () => {
    // Card 20261002_277 moved the dialog scrim to the one --scrim-modal token
    // (the 0.56 literals were hard-coded in five places and could drift);
    // dialog-scrim.styles.test.ts owns the token's darkness. This contract
    // keeps the owned overlay families ROUTED through that token — the blur
    // half stays per-family as before.
    const overlayFiles = [
      'src/components/ConfirmDialog.css',
      'src/components/Drawer.css',
      'src/pages/TruckTiresPage.css',
    ];

    for (const file of overlayFiles) {
      const css = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(css, `${file} backdrop token`).toContain('var(--scrim-modal)');
      expect(css, `${file} backdrop blur`).toContain('blur(2px)');
    }
  });
});
