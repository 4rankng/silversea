import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner redesign 23/10 (spec A): the <640px phone surface is the dedicated
// card list (`DispatchPlanCardList`), replacing the squeezed table + td-grid
// hacks. Density contract:
// 1. One card per lô/tác vụ; header = customer + Bill/Booking + Loại + status
//    + the SINGLE ⋯ menu at the 44px touch floor.
// 2. Body lines are one-line ellipsized runs — the plate·driver·SĐT line
//    NEVER wraps per character; the note line truncates to one line.
// 3. The card's only primary action ("Phát lệnh"/"Hoàn thành") rides the foot.
// 4. No inline red delete — Xóa lô is the LAST ⋯ menu item (danger voice).

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('phone card list density (owner redesign 23/10, spec A)', () => {
  it('renders a dedicated card-list component under the wrapper--cards mode', () => {
    const gridTsx = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    expect(gridTsx).toContain('DispatchPlanCardList');
    expect(gridTsx).toContain("detailed-plan-grid__wrapper--cards");

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard-list\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.dpcard\s*\{[^}]*border-radius:\s*10px;/);
  });

  it('carries the SINGLE 44px ⋯ menu in the card header — no inline button sprawl', () => {
    const cardTsx = read('src/features/dispatch/detailed-plan/DispatchPlanCardList.tsx');
    expect(cardTsx).toContain('DispatchRowActionsMenu');
    // The card's action surface is the menu + the one primary — nothing else.
    expect(cardTsx).not.toContain('note-action--delete');

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu__trigger\s*\{[^}]*width:\s*var\(--control-touch-h,\s*44px\);/);
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu\s*\{[^}]*margin-left:\s*auto;/);
  });

  it('keeps SĐT/vehicle/plate runs on one line — never per-character wrap', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard__line\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.dpcard__line--vehicle\s*\{[^}]*font-family:\s*var\(--font-data/);
    expect(css).toMatch(/\.dpcard__note\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
    expect(css).not.toMatch(/\.dpcard[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it('rides the ONE primary action in the card foot at the ≤36px control ceiling', () => {
    const cardTsx = read('src/features/dispatch/detailed-plan/DispatchPlanCardList.tsx');
    expect(cardTsx).toContain('variant="labeled"');
    expect(cardTsx).toContain('dpcard__foot');

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard__foot \.detailed-plan-grid__note-action\s*\{[^}]*height:\s*36px;/);
    // The pre-redesign phone media band for the old note-action pill is gone.
    expect(css).not.toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.detailed-plan-grid__note-action/);
  });

  it('drops the squeezed-table card bands — the td-grid record hack is deleted', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).not.toContain('@container (max-width: 900px)');
    expect(css).not.toContain('@container (max-width: 640px)');
    expect(css).not.toContain('attr(data-label-short)');
    expect(css).not.toContain('.detailed-plan-grid__pair-btn');
    expect(css).not.toContain('.detailed-plan-grid__lcl-unmerge');
  });
});
