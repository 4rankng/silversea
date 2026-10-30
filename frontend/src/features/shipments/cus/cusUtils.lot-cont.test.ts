import { describe, expect, it } from 'vitest';

import { worksheetQuantity } from './cusUtils';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';

// SIL-601 (id 702, owner ruling 30/10/2026): one LCL lot ≡ 1-cont lot — the
// lot's quantity reads 1 cont whenever the wire count is the convention's 1
// (the backend workspace builder conforms it; see cus-workspace-builders).
// Composition stays on its own path: the cargo cell prints the lot's
// containerSummary ("5 PALLET") before this fallback (FB-091 law).
function item(operational: Partial<ShipmentCusWorkspaceListItem['operational']>): ShipmentCusWorkspaceListItem {
  return {
    id: 1,
    cargoMode: 'LCL',
    operational: {
      totalContainers: 0,
      ...operational,
    },
  } as ShipmentCusWorkspaceListItem;
}

describe('worksheetQuantity under the SIL-601 LCL count law', () => {
  it('an LCL lot counts as 1 cont — never 0, never "—"', () => {
    expect(worksheetQuantity(item({ totalContainers: 1 }))).toBe('1 cont');
  });

  it('a multi-cont FCL lot keeps its real count', () => {
    expect(worksheetQuantity({
      ...item({ totalContainers: 3 }),
      cargoMode: 'FCL',
    })).toBe('3 cont');
  });

  it('an FCL lot without rows falls back to package units, never fabricated', () => {
    const fcl = {
      ...item({ totalContainers: 0 }),
      cargoMode: 'FCL',
      packageCount: 5,
      packageType: 'PALLET',
    } as ShipmentCusWorkspaceListItem;
    expect(worksheetQuantity(fcl)).toBe('5 PALLET');
  });
});
