import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Supplier, Tire } from '@tingting/shared';
import { TireTable, DisposedTireTable } from './tire-tables';

function makeTire(overrides: Partial<Tire> = {}): Tire {
  return {
    id: 1,
    serial: 'SN-100',
    truckId: null,
    trailerId: null,
    position: 'Vị trí 1',
    size: '11R22.5',
    installedAt: '2026-08-01',
    removedAt: null,
    supplierId: null,
    cost: '0',
    purchasedAt: '2026-01-15',
    status: 'IN_USE',
    disposalReason: null,
    disposalDate: null,
    createdAt: '2026-01-15T00:00:00.000Z',
    updatedAt: '2026-01-15T00:00:00.000Z',
    ...overrides,
  } as Tire;
}

const suppliers: Supplier[] = [];

function serialsInRowOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('tbody tr'))
    .map((row) => row.querySelector('.ttp-serial')?.textContent?.replace(/^SN-/, '') ?? '');
}

describe('TireTable client-side sorting', () => {
  const tires = [
    makeTire({ id: 3, serial: 'SN-300' }),
    makeTire({ id: 1, serial: 'SN-100' }),
    makeTire({ id: 2, serial: 'SN-200' }),
  ];

  it('keeps the handed-in order until a header is used', () => {
    const { container } = render(
      <TireTable tires={tires} suppliers={suppliers} loading={false} emptyHint="" busy={false}
        onedit={() => {}} ondelete={() => {}} />,
    );
    expect(serialsInRowOrder(container)).toEqual(['300', '100', '200']);
  });

  it('sorts by serial asc on first click and desc on the second', () => {
    const { container } = render(
      <TireTable tires={tires} suppliers={suppliers} loading={false} emptyHint="" busy={false}
        onedit={() => {}} ondelete={() => {}} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Serial' }));
    expect(serialsInRowOrder(container)).toEqual(['100', '200', '300']);

    fireEvent.click(screen.getByRole('button', { name: 'Serial' }));
    expect(serialsInRowOrder(container)).toEqual(['300', '200', '100']);
  });
});

describe('DisposedTireTable client-side sorting', () => {
  const tires = [
    makeTire({ id: 2, serial: 'SN-200', status: 'DISPOSED', installedAt: null, disposalDate: '2026-08-02', disposalReason: 'Mòn hạn mức' }),
    makeTire({ id: 3, serial: 'SN-300', status: 'DISPOSED', installedAt: null, disposalDate: null, disposalReason: null }),
    makeTire({ id: 1, serial: 'SN-100', status: 'DISPOSED', installedAt: null, disposalDate: '2026-08-10', disposalReason: 'Nứt thành' }),
  ];

  it('sorts by disposal date with nulls last in both directions', () => {
    const { container } = render(<DisposedTireTable tires={tires} suppliers={suppliers} />);
    const rowSerials = () => Array.from(container.querySelectorAll('tbody tr'))
      .map((row) => row.querySelector('.ttp-serial')?.textContent ?? '');

    // Handed-in order first.
    expect(rowSerials()).toEqual(['SN-200', 'SN-300', 'SN-100']);

    fireEvent.click(screen.getByRole('button', { name: 'Ngày thanh lý' }));
    expect(rowSerials()).toEqual(['SN-200', 'SN-100', 'SN-300']); // 08-02 < 08-10, NULL last

    fireEvent.click(screen.getByRole('button', { name: 'Ngày thanh lý' }));
    expect(rowSerials()).toEqual(['SN-100', 'SN-200', 'SN-300']); // NULL still last on desc
  });
});
