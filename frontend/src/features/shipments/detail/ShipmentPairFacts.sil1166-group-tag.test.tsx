/**
 * SIL-1166 (KB K3.79/K4.31) — the chi tiết lô PHÂN LOẠI block shows the merged
 * lot's tag: the value reads "Lẻ · Ghép (k/N)". Unmerged lots keep the bare
 * label; the SIL-1020 pair labels (Kẹp/Đơn) are untouched.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { shipmentPairFacts } from './shipment-pair-facts';
import { ShipmentPairFacts } from './ShipmentPairFacts';

const revLot = {
  cargoMode: 'LCL',
  revGroupId: 'g-rev-1',
  revGroupOrder: 1,
  revGroupMemberCount: 2,
};

describe('shipmentPairFacts — SIL-1166 group tag', () => {
  it('a rev-merged LCL lot carries "Lẻ" + the Ghép (1/2) tag', () => {
    const facts = shipmentPairFacts([], revLot);
    expect(facts.classificationLabel).toBe('Lẻ');
    expect(facts.groupTag).toBe('Ghép (1/2)');
  });

  it('cost leads when the lot rides both dimensions', () => {
    const facts = shipmentPairFacts([], {
      ...revLot,
      costGroupId: 'g-cost-1',
      costGroupOrder: 2,
      costGroupMemberCount: 3,
    });
    expect(facts.groupTag).toBe('Ghép (2/3)');
  });

  it('an unmerged lot keeps groupTag null — the bare label renders alone', () => {
    const facts = shipmentPairFacts([], { cargoMode: 'LCL' });
    expect(facts.classificationLabel).toBe('Lẻ');
    expect(facts.groupTag).toBeNull();
  });
});

describe('ShipmentPairFacts — SIL-1166 value composition', () => {
  it('the PHÂN LOẠI value reads "Lẻ · Ghép (1/2)" for a merged lot', () => {
    render(<ShipmentPairFacts facts={shipmentPairFacts([], revLot)} />);
    expect(screen.getByText('Lẻ · Ghép (1/2)')).toBeTruthy();
  });

  it('an unmerged lot keeps the bare "Lẻ" value (K3.40 pair labels untouched)', () => {
    render(<ShipmentPairFacts facts={shipmentPairFacts([], { cargoMode: 'LCL' })} />);
    expect(screen.getByText('Lẻ')).toBeTruthy();
  });
});
