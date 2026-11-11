// SIL-793 — the LỊCH TRÌNH column's container-demand line ("1 x 20DC").
// The detailed-plan schedule cell must print the same demand fact /dispatch's
// appointment blocks print (their containerSummary sub line): an FCL row IS
// one container, so the demand is the row's own type at count 1; an LCL lot
// owns no container and renders nothing — no surface invents a count.
import { describe, expect, it } from 'vitest';
import { detailedDemandLine } from './DispatchPlanCellValues';
import type { DispatchDetailPlanRow } from '../../../api/dispatchPlanningClient';

const row = (overrides: Partial<DispatchDetailPlanRow> = {}): DispatchDetailPlanRow => ({
  cargoMode: 'FCL',
  container: { containerNumber: 'MSCU1234567', containerTypeLabel: '20DC', cargoWeightKg: null },
  ...overrides,
} as DispatchDetailPlanRow);

describe('detailedDemandLine (SIL-793)', () => {
  it('prints the FCL row demand as "1 x <type>" — whitespace-trimmed, never a bare label', () => {
    expect(detailedDemandLine(row())).toBe('1 x 20DC');
    expect(detailedDemandLine(row({ container: { containerNumber: null, containerTypeLabel: ' 40HC ', cargoWeightKg: null } }))).toBe('1 x 40HC');
  });

  it('renders nothing when the container type is missing — an empty state, not a fake count', () => {
    expect(detailedDemandLine(row({ container: { containerNumber: null, containerTypeLabel: null, cargoWeightKg: null } }))).toBeNull();
    expect(detailedDemandLine(row({ container: { containerNumber: 'MSCU1234567', containerTypeLabel: '   ', cargoWeightKg: null } }))).toBeNull();
  });

  it('an LCL lot owns no container — the line stays empty (its cargo prints in CONTAINER)', () => {
    expect(detailedDemandLine(row({ cargoMode: 'LCL', container: { containerNumber: null, containerTypeLabel: '20DC', cargoWeightKg: null } }))).toBeNull();
  });
});
