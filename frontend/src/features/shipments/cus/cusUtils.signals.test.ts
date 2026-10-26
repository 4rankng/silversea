// Cards 191026181942 (cus-tongquan-an-cbm / hangle-wording) — the signal and
// empty-copy vocabulary shared by the CUS row and the drawer. Thin-cast fixture
// precedent: cusQuickEditModel.test.ts.
import { describe, expect, it } from 'vitest';
import type { ShipmentCusWorkspaceListItem } from '@tingting/shared';
import { deriveShipmentSignals, emptyDayCargoLabel } from './cusUtils';

function makeItem(
  operational: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): ShipmentCusWorkspaceListItem {
  return {
    id: 7,
    cargoMode: 'LCL',
    direction: 'IMPORT',
    operational: {
      scheduleReadiness: 'READY',
      vehicleReadiness: 'WAITING_CARRIER',
      totalContainers: 0,
      assignedContainers: 0,
      externalContainers: 0,
      plateAssignedContainers: 0,
      missingCarrierContainers: 0,
      missingPlateContainers: 0,
      orderIssuedContainers: 0,
      transportDateEditable: true,
      deletable: true,
      ...operational,
    },
    finance: { isLoss: false, hasPendingRecovery: false },
    documentCustody: { status: 'CUSTOMER' },
    accountingConfirmation: { status: 'PENDING' },
    action: { kind: 'NONE', enabled: false },
    debitNote: { available: true },
    ...overrides,
  } as unknown as ShipmentCusWorkspaceListItem;
}

describe('deriveShipmentSignals — zero-count vehicle signals are muted pending labels (card 191026181942)', () => {
  it('a containerless LCL lot waiting on its lot-level carrier reads "Chưa phân xe" (info), never "Thiếu nhà xe 0 cont"', () => {
    const signals = deriveShipmentSignals(makeItem({
      vehicleReadiness: 'WAITING_CARRIER',
      missingCarrierContainers: 0,
    }));
    const carrier = signals.find((signal) => signal.key === 'carrier');
    expect(carrier).toBeTruthy();
    expect(carrier!.label).toBe('Chưa phân xe');
    expect(carrier!.tone).toBe('info');
    expect(signals.map((signal) => signal.label)).not.toContain('Thiếu nhà xe 0 cont');
  });

  it('container rows still count: a missing carrier on 2 of N reads the counted warning', () => {
    const signals = deriveShipmentSignals(makeItem({
      vehicleReadiness: 'WAITING_CARRIER',
      totalContainers: 3,
      missingCarrierContainers: 2,
    }));
    const carrier = signals.find((signal) => signal.key === 'carrier');
    expect(carrier!.label).toBe('Thiếu nhà xe 2 cont');
    expect(carrier!.tone).toBe('warning');
  });

  it('the plate branch follows the same truth rule: zero missing plates reads "Chưa phân xe" (info)', () => {
    const signals = deriveShipmentSignals(makeItem({
      vehicleReadiness: 'WAITING_PLATE',
      missingPlateContainers: 0,
    }));
    const plate = signals.find((signal) => signal.key === 'plate');
    expect(plate!.label).toBe('Chưa phân xe');
    expect(plate!.tone).toBe('info');
    expect(signals.map((signal) => signal.label)).not.toContain('Thiếu BKS 0 cont');
  });

  it('a counted plate gap keeps its warning', () => {
    const signals = deriveShipmentSignals(makeItem({
      vehicleReadiness: 'WAITING_PLATE',
      totalContainers: 2,
      missingPlateContainers: 1,
    }));
    const plate = signals.find((signal) => signal.key === 'plate');
    expect(plate!.label).toBe('Thiếu BKS 1 cont');
    expect(plate!.tone).toBe('warning');
  });
});

describe('emptyDayCargoLabel — wording parameterized by cargoMode (card 191026181942; SIL-504 26/10)', () => {
  it('an LCL lot names hàng lẻ in the short one-line label', () => {
    expect(emptyDayCargoLabel('LCL')).toBe('Chưa chọn hàng lẻ');
  });

  it('a container lot keeps the cont wording', () => {
    expect(emptyDayCargoLabel('FCL')).toBe('Không có cont chạy ngày đã chọn');
  });
});
