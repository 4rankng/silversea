import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Role } from '@tingting/shared';

import { EditPanel } from './UserForm';

// SIL-823 (id 952) — form 'Chỉnh sửa lái xe' (/users) renders no phone field,
// yet a stale `phone: ''` echo rode every save and silently cleared the bound
// driver's phone in the drivers table (Bùi Tiến Dũng lost 0986342975; restored
// by hand via /fleet). Pin: the edit payload must never carry a phone field at
// all — the backend PATCH treats absence as "leave users.phone and the bound
// drivers.phone untouched" (partial update).
const DRIVER_USER = {
  id: 91,
  username: 'bui.tien.dung',
  fullName: 'Bùi Tiến Dũng',
  email: null,
  phone: null, // users.phone empty — the driver's SĐT lives on drivers.phone
  employeeCode: null,
  role: Role.DRIVER,
  status: 'ACTIVE',
  createdAt: '2026-11-14T00:00:00.000Z',
};

const PROPS = {
  isOpen: true,
  customerList: [],
  businessUnits: [],
  shipmentOptions: [],
  saving: false,
  error: null,
  onClose: vi.fn(),
  isMe: false,
};

async function saveAndCapturePhonePresence(user: object) {
  const onSave = vi.fn(async (_id: number, _data: unknown) => true);
  render(<EditPanel {...PROPS} onSave={onSave} user={user as never} />);
  fireEvent.click(screen.getByRole('button', { name: /Lưu thay đổi/i }));
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  return 'phone' in (onSave.mock.calls[0]![1] as Record<string, unknown>);
}

describe('EditPanel partial update — no phone field (SIL-823)', () => {
  it('sends no phone key when the row has no phone (echo never wipes drivers.phone)', async () => {
    expect(await saveAndCapturePhonePresence(DRIVER_USER)).toBe(false);
  });

  it('sends no phone key even when the row itself carries a phone', async () => {
    expect(await saveAndCapturePhonePresence({ ...DRIVER_USER, phone: '0986342975' })).toBe(false);
  });
});
