/**
 * SIL-1039 (K5.18) — ô giá cos hạng nặng trống KHÔNG bị chặn 'Thiếu giá':
 * nó kế thừa giá hạng nhẹ và gắn nhãn 'kế thừa hạng nhẹ / giá tạm'.
 * Thiếu trọng tải mới là chặn (không thuộc lưới này); thiếu giá cả hàng nhẹ
 * lẫn hàng nặng thì vẫn 'Thiếu giá'.
 */
import { render, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RouteBlock, type RouteBlockData } from './QuotationRouteBlock';
import fixture from './QuotationRouteBlock.state.fixture.json';

const base = fixture.frames[0] as unknown as RouteBlockData;

function cellFor(code: string) {
  const cell = base.cells.find((c) => c.vehicleSizeClassCode === code);
  if (!cell) throw new Error(`no fixture cell ${code}`);
  return cell;
}

function rowFor(container: HTMLElement, title: string) {
  const row = Array.from(container.querySelectorAll('tbody tr'))
    .find((tr) => within(tr as HTMLElement).getByRole('rowheader').textContent?.includes(title));
  if (!row) throw new Error(`no row ${title}`);
  return row as HTMLElement;
}

describe('SIL-1039 — hạng nặng kế thừa giá hạng nhẹ (K5.18)', () => {
  it('shows the inherited Giá cos + the "kế thừa hạng nhẹ / giá tạm" label, and computes Tổng', () => {
    const light = cellFor('CONT20.LIGHT');
    const block: RouteBlockData = {
      ...base,
      cells: base.cells.map((cell) => (cell.vehicleSizeClassCode === 'CONT20.HEAVY'
        ? {
          ...cell,
          giaCos: light.giaCos,
          giaCosInherited: true,
          missingPrice: false,
          surcharge: 506714,
          total: (light.giaCos ?? 0) + 506714,
        }
        : cell)),
    };
    const { container } = render(<RouteBlock block={block} saving={false} onSaveHeSo={() => {}} />);
    const row = rowFor(container, 'Cont20 >20t');
    expect(within(row).queryByText('Thiếu giá')).toBeNull();
    expect(within(row).getByText('kế thừa hạng nhẹ / giá tạm')).toBeTruthy();
    const cells = within(row).getAllByRole('cell');
    // Giá cos = giá hạng nhẹ, Tổng = kế thừa + phụ phí (không còn '—').
    expect(cells[2].textContent).toContain('3.978.000');
    expect(cells[4].textContent).toContain('4.484.714');
  });

  it('a heavy cell with its OWN price shows it plainly — no inherit label', () => {
    const block: RouteBlockData = {
      ...base,
      cells: base.cells.map((cell) => (cell.vehicleSizeClassCode === 'CONT20.HEAVY'
        ? { ...cell, giaCos: 4100000, missingPrice: false, surcharge: 506714, total: 4606714 }
        : cell)),
    };
    const { container } = render(<RouteBlock block={block} saving={false} onSaveHeSo={() => {}} />);
    const row = rowFor(container, 'Cont20 >20t');
    expect(within(row).queryByText(/kế thừa/)).toBeNull();
    expect(within(row).getByText(/4\.100\.000/)).toBeTruthy();
    expect(within(row).queryByText('Thiếu giá')).toBeNull();
  });

  it('no light price to inherit → the heavy cell still says Thiếu giá (never a fabricated number)', () => {
    const block: RouteBlockData = {
      ...base,
      cells: base.cells.map((cell) => (cell.vehicleSizeClassCode.startsWith('CONT20')
        ? { ...cell, giaCos: null, giaCosInherited: false, missingPrice: true, surcharge: null, total: null }
        : cell)),
    };
    const { container } = render(<RouteBlock block={block} saving={false} onSaveHeSo={() => {}} />);
    const row = rowFor(container, 'Cont20 >20t');
    expect(within(row).getByText('Thiếu giá')).toBeTruthy();
    expect(within(row).queryByText(/kế thừa/)).toBeNull();
  });
});
