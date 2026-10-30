// SIL-709 — the Gán xe nhóm popup's layout contract: one quiet grid, the lot
// line owns its numbering (an ol marker would print it twice), and the cước
// law is a caption-sized note. jsdom renders no list markers, so the marker
// ban is pinned on the stylesheet (house convention: *.styles.test.ts pins).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/detailed-plan/AssignTruckGroupDialog.css'), 'utf8');

describe('SIL-709 — AssignTruckGroupDialog layout contract', () => {
  it('lots list drops the marker: "Lô N ·" numbering lives in the line only', () => {
    expect(css).toMatch(/\.assign-truck-group__lots\s*\{[^}]*list-style:\s*none;/);
  });

  it('body is one grid rhythm and the single rule note is caption-sized', () => {
    expect(css).toMatch(/\.assign-truck-group\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.assign-truck-group__note\s*\{[^}]*font-size:\s*var\(--text-caption-size/);
    expect(css).toMatch(/\.assign-truck-group__hint\s*\{[^}]*font-size:\s*var\(--text-caption-size/);
  });
});
