import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';
import type { CreateData, EditData } from '../utils';

const {
  createUserMock,
  updateUserMock,
  deleteUserMock,
  toastMock,
  confirmMock,
} = vi.hoisted(() => ({
  createUserMock: vi.fn(),
  updateUserMock: vi.fn(),
  deleteUserMock: vi.fn(),
  toastMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock('../../../api/userClient', () => ({
  userClient: {
    createUser: createUserMock,
    updateUser: updateUserMock,
    deleteUser: deleteUserMock,
  },
}));

vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock('../../../components/UI', () => ({
  useConfirm: () => ({ confirm: confirmMock, dialog: null }),
}));

import { useUserMutations } from './useUserMutations';

function makeCreateData(overrides: Partial<CreateData> = {}): CreateData {
  return {
    username: 'forwarder.user',
    email: 'forwarder@example.com',
    phone: '0900000000',
    fullName: 'Forwarder User',
    role: Role.OPS,
    password: 'Abc12345',
    ...overrides,
  };
}

function makeEditData(overrides: Partial<EditData> = {}): EditData {
  return {
    username: 'scope.user',
    email: 'scope@example.com',
    phone: '0900000000',
    fullName: 'Scope User',
    role: Role.OPS,
    status: 'ACTIVE',
    password: '',
    ...overrides,
  };
}

describe('useUserMutations shipment scope payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createUserMock.mockResolvedValue({ id: 1 });
    updateUserMock.mockResolvedValue({ id: 1 });
    deleteUserMock.mockResolvedValue(undefined);
    confirmMock.mockResolvedValue(true);
  });

  it('includes deduped positive shipmentIds when creating a FORWARDER user', async () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useUserMutations(refetch));

    await act(async () => {
      await result.current.doCreate(makeCreateData({
        shipmentIds: [14, 0, 14, -2, 19],
      }));
    });

    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({
      role: Role.OPS,
      shipmentIds: [14, 19],
    }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Tạo tài khoản thành công',
    });
  });

  it('includes deduped positive shipmentIds when updating a FORWARDER user', async () => {
    const refetch = vi.fn();
    const { result } = renderHook(() => useUserMutations(refetch));

    await act(async () => {
      await result.current.doUpdate(42, makeEditData({
        shipmentIds: [23, 23, 0, 7, -1],
      }));
    });

    expect(updateUserMock).toHaveBeenCalledWith(42, expect.objectContaining({
      role: Role.OPS,
      status: 'ACTIVE',
      shipmentIds: [23, 7],
    }));
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(toastMock).toHaveBeenCalledWith({
      kind: 'success',
      message: 'Cập nhật tài khoản thành công',
    });
  });

  it('sends no scope fields for CLERK — staff are not customer/shipment-scoped', async () => {
    const { result } = renderHook(() => useUserMutations(vi.fn()));

    await act(async () => {
      await result.current.doUpdate(7, makeEditData({
        role: Role.CUS,
        businessUnitIds: [5, 0, 5, 8],
        customerIds: [31, 31, -4],
        shipmentIds: [101, 0, 101, 103],
      }));
    });

    expect(updateUserMock).toHaveBeenCalledWith(7, expect.objectContaining({
      role: Role.CUS,
    }));
    const payload = updateUserMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(payload.customerIds).toBeUndefined();
    expect(payload.customerId).toBeUndefined();
    expect(payload.shipmentIds).toBeUndefined();
  });

  it('omits shipmentIds for roles outside FORWARDER and CLERK', async () => {
    const { result } = renderHook(() => useUserMutations(vi.fn()));

    await act(async () => {
      await result.current.doUpdate(9, makeEditData({
        role: Role.DRIVER,
        businessUnitIds: [6, 0, 6],
        shipmentIds: [200, 201],
      }));
    });

    const payload = updateUserMock.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(payload).toMatchObject({
      role: Role.DRIVER,
      businessUnitIds: [6],
    });
    // Driver-truck pairing left the Users surface — never part of the payload.
    expect(payload).not.toHaveProperty('assignedTruckId');
    expect(payload).not.toHaveProperty('shipmentIds');
  });
});
