import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userClient } from '../../api/userClient';
import { loadOpsOwnerOptions } from './ops-owner-options';
import type { UserRow } from '../users/utils';
import { Role } from '@tingting/shared';

vi.mock('../../api/userClient', () => ({ userClient: { getUsers: vi.fn() } }));
const staff = (id: number): UserRow => ({ id, username: `ops${id}`, fullName: `Nhân viên ${id}`, employeeCode: null, email: null, phone: null, role: Role.OPS, status: 'ACTIVE', createdAt: '2026-09-15T00:00:00Z', driverId: null, assignedTruckId: null, baseSalary: null, socialInsurance: null });

describe('Ops owner catalog loading', () => {
  beforeEach(() => vi.mocked(userClient.getUsers).mockReset());
  it('includes eligible staff beyond the first page', async () => {
    vi.mocked(userClient.getUsers)
      .mockResolvedValueOnce({ items: Array.from({ length: 100 }, (_, i) => staff(i + 1)), total: 101, businessUnits: [] })
      .mockResolvedValueOnce({ items: [staff(101)], total: 101, businessUnits: [] });
    const options = await loadOpsOwnerOptions();
    expect(options).toHaveLength(101);
    expect(options[100].id).toBe(101);
    expect(userClient.getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ role: 'OPS', page: 2 }));
  });
  it('rejects a partial result when a later page fails so the UI can retry', async () => {
    vi.mocked(userClient.getUsers)
      .mockResolvedValueOnce({ items: [staff(1)], total: 2, businessUnits: [] })
      .mockRejectedValueOnce(new Error('network'));
    await expect(loadOpsOwnerOptions()).rejects.toThrow('network');
  });
});
