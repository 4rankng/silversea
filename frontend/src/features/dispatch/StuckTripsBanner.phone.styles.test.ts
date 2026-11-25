import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/dispatch/StuckTripsBanner.css'),
  'utf8',
);

// SIL-1002 — at 390px the banner head squeezed its label into a ~50px column:
// "Chuyến kẹt quá 7 ngày (5)" broke into 4–5 lines ("Chuyến" / "kẹt quá" /
// "7 ngày" / "(5)") and the icon and the two buttons were crushed with it.
//
// Cause: all five parts are flex items on ONE row, so the long hint sentence
// takes the room and the label — the part that must be read — gives way.
//
// The phone band gives the label its own row (icon + label) and drops the hint
// with the two buttons to the next row; nothing is crushed.
const phoneBlocks = [...css.matchAll(/@media \(max-width: 640px\)\s*\{([\s\S]*?)\n\}/g)].map(
  (match) => match[1],
);

describe('stuck trips banner head on the phone (SIL-1002)', () => {
  it('wraps the head so the label keeps its own row', () => {
    const block = phoneBlocks.find((b) => b.includes('.stuck-trips-banner__head'));
    expect(block).toBeDefined();
    expect(block).toMatch(/\.stuck-trips-banner__head\s*\{[^}]*flex-wrap:\s*wrap;/);
  });

  it('never crushes the label, the icon or the buttons', () => {
    const block = phoneBlocks.find((b) => b.includes('.stuck-trips-banner__head'));
    expect(block).toMatch(
      /\.stuck-trips-banner__head > svg,\s*\n\s*\.stuck-trips-banner__head > strong,\s*\n\s*\.stuck-trips-banner__btn\s*\{[^}]*flex:\s*0 0 auto;/,
    );
    expect(block).toMatch(/\.stuck-trips-banner__hint\s*\{[^}]*flex:\s*1 1 60%;/);
  });

  it('keeps the desktop head on one row', () => {
    const base = css.match(/\.stuck-trips-banner__head\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(base).toMatch(/display:\s*flex;/);
    expect(base).not.toMatch(/flex-wrap:\s*wrap;/);
  });
});
