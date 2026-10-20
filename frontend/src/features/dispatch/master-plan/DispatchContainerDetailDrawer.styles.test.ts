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
//   - the remaining columns still clear their labels inside the 900px table
//     minimum (44px ordinal + 150px appointment + 7 × ≥101px auto).
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
    expect(table).toMatch(/min-width:\s*900px/);
    // 900 − 44 (ordinal) − 150 (appointment) leaves ≥101px per remaining
    // column; every other header label ("Container" ≈ 75px worst case)
    // clears that floor, so nowrap can never shear them either.
  });
});
