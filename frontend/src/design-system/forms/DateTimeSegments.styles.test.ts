import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Card 20260924_10 — date-segment padding asymmetry. The slash separators
 * sat equidistant to nothing: 'DD' glyphs (17.47px @12px) left ~2.07px slack
 * per side inside the shared 1.8em box while 'MM' (20.47px) left 0.57px, so
 * the rendered field read "DD /MM/ YYYY" — the slash hugging MM. The boxes
 * now carry per-segment widths (placeholder glyphs + equal slack each side,
 * 0.125em at the 12px base) and the separators carry symmetric margins, so
 * every slash sits centered between its neighbors' glyphs. */
describe('date segments read DD/MM/YYYY with even slash gaps (card 20260924_10)', () => {
  const css = readFileSync(resolve(process.cwd(), 'src/design-system/forms/DateTimeSegments.css'), 'utf8');

  it('sizes each segment box to its own glyphs plus equal slack', () => {
    const base = css.match(/\.date-seg-group \.date-seg-wrapper \.date-seg\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(base).toContain('text-align: center');
    expect(css).toContain(".date-seg[data-seg='dd'] { width: 1.59em; }");
    expect(css).toContain(".date-seg[data-seg='mm2'] { width: 1.84em; }");
    expect(css).toContain(".date-seg[data-seg='yyyy'] { width: 2.79em; }");
  });

  it('pins the TIME segments too, so the group never falls back to the native input width', () => {
    // Card 20260930: hh/mm had no width rule and inherited the native <input>
    // intrinsic width (~20ch ≈ 147px each). The time group measured ~307px —
    // three times its date sibling — and pushed SplitDateTimeField's
    // min-content to ~418px, past every narrow host (the CUS create-lot
    // "Ngày giờ đóng trả" cell clipped the whole date half).
    expect(css).toContain(".date-seg[data-seg='hh'] { width: 1.55em; }");
    expect(css).toContain(".date-seg[data-seg='mm'] { width: 1.92em; }");
  });

  it('renders the placeholder separator-tight: HH:mm / DD/MM/YYYY without phantom spaces (card 081026230520)', () => {
    // Round-8 retest measured real glyph gaps (Range rects, 16px Be Vietnam
    // Pro): the old box slack + 1px padding + 2px separator margin read as
    // "HH : mm" / "DD / MM / YYYY" — wider than a real space glyph (3.68px)
    // against a natural "HH:mm" inter-glyph gap of ~0. The separators must
    // carry no margin, the segments no padding, and each box must hug its
    // own placeholder glyphs (~2px total slack) so the gap collapses to the
    // glyphs' own side bearings.
    const sep = css.match(/\.date-sep\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(sep).not.toContain('margin-inline');
    const base = css.match(/\.date-seg-group \.date-seg-wrapper \.date-seg\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    // Explicit 0: omitting the declaration lets InputBase's px utility back
    // in and shaves the outer placeholder glyphs ('H'→'|', 'D'→'[').
    expect(base).toContain('padding-inline: 0');
    expect(css).toContain(".date-seg[data-seg='hh'] { width: 1.55em; }");
    expect(css).toContain(".date-seg[data-seg='mm'] { width: 1.92em; }");
    expect(css).toContain(".date-seg[data-seg='dd'] { width: 1.59em; }");
    expect(css).toContain(".date-seg[data-seg='mm2'] { width: 1.84em; }");
    expect(css).toContain(".date-seg[data-seg='yyyy'] { width: 2.79em; }");
  });

  it('marks the focused segment with a flat brand underline so an empty hand-off is visible', () => {
    // Auto-advance hands focus to an EMPTY segment whose placeholder looks
    // identical focused or not; the group outline is position-blind. The
    // focused slot must carry its own flat marker (inset underline, the same
    // mechanic as .date-seg--invalid — never a 3D elevation per the flat
    // surface ruling).
    const focus = css.match(/\.date-seg-group \.date-seg-wrapper \.date-seg:focus\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(focus).toContain('box-shadow: inset 0 -2px 0 var(--color-border-brand)');
  });
});
