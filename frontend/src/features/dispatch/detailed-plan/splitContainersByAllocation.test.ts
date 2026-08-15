import { describe, expect, it } from 'vitest';

import { splitContainersByAllocation } from './splitContainersByAllocation';

const container = (id: number, bucket: 20 | 40 | null, label: string, containerNumber: string) => ({
  id,
  containerNumber,
  bucket,
  containerTypeLabel: label,
});

describe('splitContainersByAllocation', () => {
  it('assigns every container when allocation is exact (multi-vendor)', () => {
    const rows = splitContainersByAllocation(
      [
        container(1, 40, '40HC', 'MSKU1'),
        container(2, 20, '20DC', 'MSKU2'),
        container(3, 40, '40HC', 'MSKU3'),
      ],
      [
        { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 1 },
        { carrierType: 'EXTERNAL', externalCarrierId: 77, carrierLabel: 'HÀ AN', count20: 0, count40: 1 },
      ],
    );

    // 20' bucket first: MSKU2 → SilverSea. Then 40' in stable order.
    expect(rows.map((row) => [row.containerNumber, row.carrierLabel])).toEqual([
      ['MSKU2', 'SilverSea'],
      ['MSKU1', 'SilverSea'],
      ['MSKU3', 'HÀ AN'],
    ]);
  });

  it('leaves uncovered containers unassigned on partial allocation', () => {
    const rows = splitContainersByAllocation(
      [
        container(1, 20, '20DC', 'A'),
        container(2, 20, '20DC', 'B'),
      ],
      [
        { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 1, count40: 0 },
      ],
    );

    expect(rows[0].carrierLabel).toBe('SilverSea');
    expect(rows[1].carrierLabel).toBeNull();
  });

  it('returns all rows unassigned with empty allocation groups', () => {
    const rows = splitContainersByAllocation([container(1, 40, '40HC', 'X')], []);
    expect(rows).toHaveLength(1);
    expect(rows[0].carrierLabel).toBeNull();
    expect(rows[0].carrierType).toBeNull();
  });

  it('handles empty container list', () => {
    expect(splitContainersByAllocation([], [
      { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 2, count40: 0 },
    ])).toEqual([]);
  });

  it('never gives a 20-slot a 40 container or vice versa', () => {
    const rows = splitContainersByAllocation(
      [container(1, 40, '40HC', 'BIG')],
      [
        { carrierType: 'OWN', externalCarrierId: null, carrierLabel: 'SilverSea', count20: 3, count40: 0 },
      ],
    );
    expect(rows[0].carrierLabel).toBeNull();
  });
});
