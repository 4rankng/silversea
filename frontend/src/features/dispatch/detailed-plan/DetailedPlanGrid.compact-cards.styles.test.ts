import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Ticket 20261002_287 (Requirement R22): Compact dispatch cards layout
// 1. Reduce dispatch card height on /dispatch-detail by at least 25%–30% through
//    information grid reorganization and tighter spacing.
// 2. Pair related facts on the same line or compact pair:
//    - (Biển số & Lái xe) in .dispatch-assignment-cell__vehicle-group
//    - (Tuyến đường & Chiều) in .detailed-plan-grid__route-direction
// 3. Action buttons must be compact with heights not exceeding 36px.
// 4. Desktop and mobile views display more trips per screen without losing clarity.

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');

describe('compact dispatch cards layout (Requirement R22 / Ticket 20261002_287)', () => {
  it('pairs route and direction on the same line via .detailed-plan-grid__route-direction', () => {
    const tsx = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.tsx');
    expect(tsx).toContain('detailed-plan-grid__route-direction');

    const css = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    expect(css).toMatch(/\.detailed-plan-grid__route-direction\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.detailed-plan-grid__route-direction\s*\{[^}]*align-items:\s*baseline;/);
  });

  it('pairs plate and driver inline via .dispatch-assignment-cell__vehicle-group with middot separator', () => {
    const tsx = read('src/features/dispatch/detailed-plan/DispatchPlanEditorCell.tsx');
    expect(tsx).toContain('dispatch-assignment-cell__vehicle-group');

    const css = read('src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css');
    expect(css).toMatch(/\.dispatch-assignment-cell__vehicle-group\s*\{[^}]*display:\s*flex;/);
    expect(css).toMatch(/\.dispatch-assignment-cell__vehicle-group\s*\.dispatch-assignment-cell__driver::before\s*\{[^}]*content:\s*'·';/);
  });

  it('enforces action button heights not exceeding 36px ceiling', () => {
    const gridCss = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');
    const cellCss = read('src/features/dispatch/detailed-plan/DispatchPlanEditorCell.css');

    // Note action button ("Phát lệnh" / "Hoàn thành")
    expect(gridCss).toMatch(/\.detailed-plan-grid__note-action\s*\{[^}]*max-height:\s*36px;/);
    expect(gridCss).toMatch(/@media\s*\(max-width:\s*767px\)\s*\{[\s\S]*?\.detailed-plan-grid__note-action\s*\{[^}]*max-height:\s*36px;/);

    // Pair button ("Ghép chuyến")
    expect(gridCss).toMatch(/\.detailed-plan-grid__pair-btn\s*\{[^}]*max-height:\s*36px;/);

    // Dispatch assignment trigger button ("Điều phối" / "Phân xe")
    expect(cellCss).toMatch(/\.dispatch-assignment-cell__trigger\s*\{[^}]*max-height:\s*36px;/);
  });

  it('tightens desktop cell padding and mobile container spacing for vertical density', () => {
    const gridCss = read('src/features/dispatch/detailed-plan/DetailedPlanGrid.css');

    // Desktop table cell padding reduced from 12px to 8px 10px
    expect(gridCss).toMatch(/\.detailed-plan-grid td\s*\{[^}]*padding:\s*8px 10px;/);

    // Tablet container (900px) tightened to 4px 8px
    expect(gridCss).toMatch(/@container\s*\(max-width:\s*900px\)\s*\{[\s\S]*?td\.detailed-plan-grid__cell\s*\{[^}]*padding:\s*4px 8px;/);

    // Phone container (640px) tightened gap and cell padding
    expect(gridCss).toMatch(/@container\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.detailed-plan-grid tbody\s*\{[^}]*gap:\s*6px;/);
    expect(gridCss).toMatch(/@container\s*\(max-width:\s*640px\)\s*\{[\s\S]*?\.detailed-plan-grid__cell\s*\{[^}]*padding:\s*4px 8px;/);
  });
});
