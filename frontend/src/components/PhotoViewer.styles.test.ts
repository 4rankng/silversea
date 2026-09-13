import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The viewer portals to <body> and is consumed from separate lazy route
// chunks (driver trip detail, e-POD, ops trip detail). If the stylesheet is
// only imported by some consumers, a session that never loads one of those
// chunks renders the overlay with NO css at all: no fixed positioning, no
// z-index, no backdrop paint — controls sit in normal flow under the app
// chrome and the viewer becomes mouse-unclosable (Esc still works, being
// pure JS). The css must therefore be owned by the component itself.
const componentSource = readFileSync(resolve(process.cwd(), 'src/components/PhotoViewer.tsx'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/components/PhotoViewer.css'), 'utf8');

describe('PhotoViewer stylesheet ownership', () => {
  it('the component imports its own stylesheet so every chunk renders it styled', () => {
    // Line-anchored: a commented-out `// import './PhotoViewer.css';` must
    // fail this lock, not satisfy it.
    expect(componentSource).toMatch(/^import\s+['"]\.\/PhotoViewer\.css['"]/m);
  });

  it('the overlay is fixed above the app chrome and the backdrop really paints', () => {
    expect(css).toMatch(/\.pv-overlay\s*\{[^}]*position:\s*fixed;/);
    // var(--z-modal) (300) outranks the app shell's sticky/overlay layers
    // (topbar 100/101, sidebar 200); the portal element is last in <body>,
    // so it also wins ties at equal z.
    expect(css).toMatch(/\.pv-overlay\s*\{[^}]*z-index:\s*var\(--z-modal\);/);
    expect(css).toMatch(/\.pv-backdrop\s*\{[^}]*position:\s*absolute;/);
  });
});
