// FB-045 (card 201026140000): the "Chi tiết container" drawer's GIỜ HẸN
// ĐÓNG/TRẢ column sheared mid-token at ≤1024px scroll width — the fixed
// table-layout's equal auto slice (118px) fell under the uppercase,
// letter-spaced header (~128px), and the global th nowrap clipped it.
//
// This styles contract pins the FB-063/R17 one-line-header law (card
// 181026021137) for THIS table the same way ClerkShipmentCreatePage.styles
// pins it for the create-form container table:
//   - the appointment column owns a 150px floor (header + "HH:mm DD/MM/YYYY"
//     value both one line);
//   - the thead pins nowrap/normal-wrap/normal-break explicitly, not via the
//     global table rule;
//   - lan 2 (the port selects painted over the value at every viewport): the
//     two port columns own 150px each and the table minimum keeps every
//     auto column ≥92px — since SIL-530 that minimum is 1050px (44px ordinal
//     + 3 × 150px fixed + 6 × ≥92px auto: the SỐ TỜ KHAI column joined).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchContainerDetailDrawer.css'), 'utf8');
const tsx = readFileSync(resolve(process.cwd(), 'src/features/dispatch/master-plan/DispatchContainerDetailDrawer.tsx'), 'utf8');

function rule(selector: string): string {
  const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} rule must exist`).toBeTruthy();
  return match?.[1] ?? '';
}

describe('DispatchContainerDetailDrawer appointment-column contract (FB-045, card 201026140000)', () => {
  it('gives the Giờ hẹn đóng/trả column an explicit 150px floor on header and body cells', () => {
    expect(rule('.dispatch-container-detail__appointment-column')).toMatch(/width:\s*150px/);
    // Both the header and the value cell carry the class — one width owner
    // for the whole column.
    expect(tsx).toMatch(/<th scope="col" className="dispatch-container-detail__appointment-column">Giờ hẹn đóng\/trả<\/th>/);
    expect(tsx).toMatch(/<td data-label="Giờ hẹn đóng\/trả" className="dispatch-container-detail__appointment-column">/);
  });

  it('pins the one-line header law on this table explicitly (FB-063/R17)', () => {
    const thead = rule('.dispatch-container-detail__table thead th');
    expect(thead).toMatch(/white-space:\s*nowrap/);
    expect(thead).toMatch(/overflow-wrap:\s*normal/);
    expect(thead).toMatch(/word-break:\s*normal/);
  });

  it('keeps the table minimum wide enough that no other label loses its line', () => {
    const table = rule('.dispatch-container-detail__table');
    expect(table).toMatch(/table-layout:\s*fixed/);
    // SIL-530: the SỐ TỜ KHAI column joined; SIL-555 (id 629): the THAO TÁC
    // rail joined — the floor rose from 1050px:
    // 1180 − 44 (ordinal) − 150 (appointment) − 2 × 150 (port columns) − 130
    // (thao tác) leaves ≥92px per remaining column (container / loại cont /
    // số tờ khai / điều vận / nhà xe / biển số); every header label
    // ("Container" ≈ 75px worst case) clears that floor, so nowrap can never
    // shear them either.
    expect(table).toMatch(/min-width:\s*1180px/);
  });

  it('owns the per-row XÓA CONT rail on the right edge (SIL-555, id 629)', () => {
    const actions = rule('.dispatch-container-detail__actions-column');
    expect(actions).toMatch(/width:\s*130px/);
    // Both the header and the button cell carry the class — one width owner
    // for the whole column.
    expect(tsx).toMatch(/<th scope="col" className="dispatch-container-detail__actions-column">Thao tác<\/th>/);
    expect(tsx).toMatch(/<td data-label="Thao tác" className="dispatch-container-detail__actions-column">/);
    // The labeled danger button keeps its one line inside the rail.
    expect(rule('.dispatch-container-detail__table tbody .dispatch-container-detail__actions-column')).toMatch(/white-space:\s*nowrap/);
  });

  it('lets no neighbor control paint over the appointment column (FB-045 lan 2)', () => {
    // The lan-1 clip that survived: the Nâng/Hạ port selects (min-width 140px)
    // overflowed their auto slices and covered the "HH:mm DD/MM/YYYY" value.
    // The port columns now own the selects' width and the value is pinned to
    // one line.
    const port = rule('.dispatch-container-detail__port-column');
    expect(port).toMatch(/width:\s*150px/);
    const select = rule('.dispatch-container-detail__port-select');
    expect(select).toMatch(/min-width:\s*132px/);
    const value = rule('.dispatch-container-detail__table tbody .dispatch-container-detail__appointment-column');
    expect(value).toMatch(/white-space:\s*nowrap/);
    // Both port columns carry the floor class on header AND body cell.
    expect(tsx).toMatch(/<th scope="col" className="dispatch-container-detail__port-column">Nâng<\/th>/);
    expect(tsx).toMatch(/<th scope="col" className="dispatch-container-detail__port-column">Hạ<\/th>/);
    expect(tsx).toMatch(/<td data-label="Nâng" className="dispatch-container-detail__port-column">/);
    expect(tsx).toMatch(/<td data-label="Hạ" className="dispatch-container-detail__port-column">/);
  });
});
