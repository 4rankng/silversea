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

  // ── GP-05 (testplan/2026-10-23-gomhang-polish.md) — the card status badge
  // is ONE line (ellipsis + title tooltip) and never crowds the ⋯ menu.
  it('GP-05: status badge = max-width + 1-line ellipsis, giữ ≥8px khoảng cách với nút ⋯', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    // Head gap is the ≥8px law between the badge and the menu.
    expect(css).toMatch(/\.dpcard__head\s*\{[^}]*gap:\s*(8px|1[0-9]px)/);
    // The badge shrinks FIRST (never the ⋯): bounded + one ellipsized line.
    expect(css).toMatch(/\.dpcard__issue\s*\{[^}]*max-width:/);
    expect(css).toMatch(/\.dpcard__issue[^{]*\{[^}]*white-space:\s*nowrap;[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;/);
    // The menu is pinned to its 44px floor — never flexed under it.
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu\s*\{[^}]*flex:\s*none;/);
  });

  // ── GP-06 — ⋯/tick touch targets stay ≥44px on EVERY card, including the
  // compact merge-mode head where the extra tick squeezes the row.
  it('GP-06: ⋯ trigger giữ ≥44px cả khi head compact (flex: none + min 44px)', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu__trigger\s*\{[^}]*width:\s*var\(--control-touch-h,\s*44px\);[^}]*height:\s*var\(--control-touch-h,\s*44px\);[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;[^}]*flex-shrink:\s*0;/);
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu\s*\{[^}]*flex:\s*none;/);
  });

  it('GP-06: vùng chạm tick ≥44px trên card (visual box giữ 18px)', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    // The card-scoped tick is a 44px hit target; its painted box stays 18px.
    expect(css).toMatch(/\.dpcard \.ops-lcl-check\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
    expect(css).toMatch(/\.dpcard \.ops-lcl-check::before\s*\{[^}]*inset:\s*13px;/);
  });
});
