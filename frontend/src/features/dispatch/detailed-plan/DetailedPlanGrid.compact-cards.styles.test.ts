import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Owner redesign 23/10 (spec A) + issue #13 (card 3-dòng): the <640px phone
// surface is the dedicated card list (`DispatchPlanCardList`), replacing the
// squeezed table + td-grid hacks. Density contract:
// 1. One card per lô/tác vụ; header = customer + Bill/Booking + status chip
//    (dot-leading, góc phải) + the DYNAMIC ACTION SLOT — ≤1 visible button
//    per state (paper-plane khi chưa phát lệnh, ⋯ khi đã phát lệnh/chưa phân
//    xe, none khi hoàn thành) at the 44px touch floor.
// 2. Info = 3-dòng hierarchy: BKS semibold + Xe {class} · Tên · SĐT (SĐT is
//    a nowrap non-shrinking run — never truncated) · Loại lô · tuyến. Body
//    lines are one-line ellipsized runs; the note line truncates to one line.
// 3. Completed cards dim dòng 1-2 to the gray-500 band (spec C).

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('phone card list density (owner redesign 23/10 + issue #13 card 3-dòng)', () => {
  it('renders a dedicated card-list component under the wrapper--cards mode', () => {
    const gridTsx = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    expect(gridTsx).toContain('DispatchPlanCardList');
    expect(gridTsx).toContain("detailed-plan-grid__wrapper--cards");

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard-list\s*\{[^}]*display:\s*grid;/);
    expect(css).toMatch(/\.dpcard\s*\{[^}]*border-radius:\s*10px;/);
  });

  it('carries the dynamic action slot in the card header — ≤1 visible button per state, no inline button sprawl', () => {
    const cardTsx = read('src/features/dispatch/detailed-plan/DispatchPlanCardList.tsx');
    expect(cardTsx).toContain('DispatchRowActionsMenu');
    // The slot: paper-plane (icon) khi chưa phát lệnh; the ⋯ trigger stands in
    // otherwise; completed cards render no action at all.
    expect(cardTsx).toContain('dpcard__action');
    expect(cardTsx).toContain('variant="icon"');
    expect(cardTsx).toContain('{!completed && (');
    // The old foot band is deleted with its full-width pill.
    expect(cardTsx).not.toContain('dpcard__foot');
    expect(cardTsx).not.toContain('variant="labeled"');
    // The card's action surface is the slot + the card-tap menu — nothing else.
    expect(cardTsx).not.toContain('note-action--delete');

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu__trigger\s*\{[^}]*width:\s*var\(--control-touch-h,\s*44px\);/);
    expect(css).toMatch(/\.dpcard \.dispatch-row-menu\s*\{[^}]*margin-left:\s*auto;/);
    // The paper-plane keeps the same 44px card floor the ⋯ trigger had (GP-06).
    expect(css).toMatch(/\.dpcard__action \.detailed-plan-grid__note-action--icon\s*\{[^}]*width:\s*44px;[^}]*min-height:\s*44px;/);
    // The slot itself never gets squeezed.
    expect(css).toMatch(/\.dpcard__action\s*\{[^}]*flex:\s*none;/);
    expect(css).not.toMatch(/\.dpcard__foot/);
  });

  it('info block = 3 dòng: BKS semibold + Xe class / Tên · SĐT (không bao giờ truncate SĐT) / Loại lô · tuyến', () => {
    const cardTsx = read('src/features/dispatch/detailed-plan/DispatchPlanCardList.tsx');
    expect(cardTsx).toContain('formatPhoneGroups');
    expect(cardTsx).toContain('dpcard__info');
    expect(cardTsx).toContain('dpcard__plate');
    expect(cardTsx).toContain('dpcard__driver-phone');

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    // The joined plate·tên·SĐT one-line run is GONE (issue #13's defect).
    expect(css).not.toMatch(/\.dpcard__line--vehicle/);
    // Dòng 1: BKS semibold data-face, shrinks before the inline Xe class.
    expect(css).toMatch(/\.dpcard__plate\s*\{[^}]*font-weight:\s*var\(--fw-semibold,\s*600\);[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.dpcard__plate-class\s*\{[^}]*flex:\s*none;/);
    // Dòng 2: the NAME carries all the shrinking; the SĐT is nowrap + flex:none
    // — ellipsis can only ever eat the name, never the phone.
    expect(css).toMatch(/\.dpcard__driver-name\s*\{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.dpcard__driver-phone\s*\{[^}]*flex:\s*none;[^}]*white-space:\s*nowrap;/);
    // Dòng 3: muted one-line meta.
    expect(css).toMatch(/\.dpcard__info-meta\s*\{[^}]*color:\s*var\(--fg-3\);[^}]*text-overflow:\s*ellipsis;/);
    // The card-tap surface is a real button (tác vụ phụ qua tap card) with a
    // focus ring; completed rows read the same block as static text.
    expect(css).toMatch(/\.dpcard__info\s*\{[^}]*cursor:\s*pointer;/);
    expect(css).toMatch(/\.dpcard__info:focus-visible\s*\{/);
    expect(css).toMatch(/\.dpcard__info--static\s*\{[^}]*cursor:\s*default;/);
    // Body lines keep the one-line ellipsized contract; the note truncates.
    expect(css).toMatch(/\.dpcard__line\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
    expect(css).toMatch(/\.dpcard__note\s*\{[^}]*white-space:\s*nowrap;[^}]*text-overflow:\s*ellipsis;/);
    expect(css).not.toMatch(/\.dpcard[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
  });

  it('spec C: completed cards dim dòng 1-2 to the gray band — history reads after live work', () => {
    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.dpcard--completed \.dpcard__plate,/);
    expect(css).toMatch(/\.dpcard--completed \.dpcard__driver-phone\s*\{[^}]*color:\s*var\(--fg-3\);/);
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
