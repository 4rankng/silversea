import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useShipmentReferenceDuplicateGuard } from './use-shipment-reference-duplicate-guard';
import type { ShipmentReferenceConflict } from '../../../api/shipmentDuplicateClient';

const { checkDuplicate, toast } = vi.hoisted(() => ({ checkDuplicate: vi.fn(), toast: vi.fn() }));
vi.mock('../../../api/shipmentDuplicateClient', () => ({ checkShipmentReferenceDuplicate: checkDuplicate }));
vi.mock('../../../components/shared/Toast', () => ({ useToast: () => ({ toast }) }));
const defaults = { blNumber: '', bookingRef: '', declarationNumber: '', tradeDirection: 'IMPORT' as const, debounceMs: 20 };
const conflict: ShipmentReferenceConflict = { shipmentId: 12, shipmentCode: 'SHP-12', field: 'blNumber', reference: 'BL-12345', createdBy: { id: 1, username: 'original-clerk', fullName: null }, createdAt: '2026-09-15T00:00:00Z' };

async function lookup() { await act(async () => { await vi.advanceTimersByTimeAsync(20); }); }

describe('VID-CUS-03 duplicate warnings', () => {
  beforeEach(() => { vi.useFakeTimers(); checkDuplicate.mockReset().mockResolvedValue([]); toast.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('matches the field and case-insensitive trimmed reference', async () => {
    checkDuplicate.mockResolvedValue([conflict]);
    const { result } = renderHook(() => useShipmentReferenceDuplicateGuard({ ...defaults, blNumber: ' bl-12345 ' }));
    await lookup();
    expect(result.current.getConflict('blNumber', ' bl-12345 ')).toEqual(conflict);
    expect(result.current.getConflict('declaration', 'BL-12345')).toBeUndefined();
  });

  it('checks a complete Bill while a declaration is still only one character', async () => {
    const { result } = renderHook(() => useShipmentReferenceDuplicateGuard({ ...defaults, blNumber: 'BL-12345', declarationNumber: 'T' }));
    checkDuplicate.mockResolvedValue([conflict]);
    await lookup();
    expect(checkDuplicate).toHaveBeenCalledWith({ blNumber: 'BL-12345', bookingRef: undefined, declarationNumber: undefined });
    expect(result.current.getConflict('blNumber', 'BL-12345')).toEqual(conflict);
  });

  it('does not restore an old warning when its request resolves after the field is cleared', async () => {
    let resolve!: (value: ShipmentReferenceConflict[]) => void;
    checkDuplicate.mockReturnValue(new Promise<ShipmentReferenceConflict[]>((done) => { resolve = done; }));
    const { result, rerender } = renderHook((props) => useShipmentReferenceDuplicateGuard(props), { initialProps: { ...defaults, blNumber: 'BL-12345' } });
    await lookup();
    rerender({ ...defaults, blNumber: '' });
    await act(async () => { resolve([conflict]); });
    expect(result.current.conflicts).toEqual([]);
  });
});
