// QA 28/11 F19 — the Users editor's Mã nhân viên field saved with HTTP 200
// while users.employee_code stayed null: the panels collected employeeCode,
// but useUserMutations built the wire bodies from scratch and silently
// dropped it (reopening showed the placeholder; the HR roster kept its dash,
// since its users→drivers COALESCE had nothing to fall back to). Pin: the
// hook must forward employeeCode on BOTH create and update, including the
// empty string that clears the code server-side.
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

vi.mock('../../../api/userClient', () => ({
  userClient: {
    getUsers: vi.fn(),
    getUser: vi.fn(),
    getHrRoster: vi.fn(),
    createUser: vi.fn(async () => ({})),
    updateUser: vi.fn(async () => ({})),
    deleteUser: vi.fn(async () => ({})),
  },
}));
vi.mock('../../../components/shared/Toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('../../../components/UI', () => ({
  useConfirm: () => ({ confirm: vi.fn(async () => true), dialog: null }),
}));

import { userClient } from '../../../api/userClient';
import { useUserMutations, type UserMutations } from './useUserMutations';
import type { CreateData, EditData } from '../utils';

let mutations: UserMutations;
function Harness() {
  mutations = useUserMutations(vi.fn());
  return null;
}

const EDIT: EditData = {
  fullName: 'Nguyễn Văn A',
  username: 'nva',
  email: '',
  employeeCode: 'QAPAY1128',
  role: Role.DRIVER,
  status: 'ACTIVE',
  password: '',
};

describe('QA 28/11 F19 — Mã nhân viên rides the Users editor payloads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    render(<Harness />);
  });

  it('doUpdate forwards employeeCode to PATCH /users/:id', async () => {
    let ok: boolean | undefined;
    await act(async () => { ok = await mutations.doUpdate(91, EDIT); });
    expect(ok).toBe(true);
    expect(userClient.updateUser).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(userClient.updateUser).mock.calls[0]!;
    expect((body as Record<string, unknown>).employeeCode).toBe('QAPAY1128');
  });

  it('doUpdate forwards the empty string so clearing the field clears the code', async () => {
    await act(async () => { await mutations.doUpdate(91, { ...EDIT, employeeCode: '' }); });
    const [, body] = vi.mocked(userClient.updateUser).mock.calls[0]!;
    expect((body as Record<string, unknown>).employeeCode).toBe('');
  });

  it('doCreate forwards employeeCode to POST /users', async () => {
    const createData: CreateData = {
      username: 'nva',
      email: '',
      phone: '0901234567',
      fullName: 'Nguyễn Văn A',
      employeeCode: 'QAPAY1128',
      role: Role.DRIVER,
      password: 'secret123',
    };
    await act(async () => { await mutations.doCreate(createData); });
    expect(userClient.createUser).toHaveBeenCalledTimes(1);
    const [body] = vi.mocked(userClient.createUser).mock.calls[0]!;
    expect((body as Record<string, unknown>).employeeCode).toBe('QAPAY1128');
  });
});
