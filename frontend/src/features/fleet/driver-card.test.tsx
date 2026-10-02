import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Driver } from '@tingting/shared';
import { DriverCard } from './driver-card';

// The CRUD hook is page-owned; the card only renders and calls actions —
// same stub shape as trailer-card.test.tsx.
const crudStub = {
  setShowAddForm: vi.fn(),
  cancelForm: vi.fn(),
  setEditingId: vi.fn(),
  doCreate: vi.fn(),
  doUpdate: vi.fn(),
  doDelete: vi.fn(),
  editingId: null,
  showAddForm: false,
  saving: false,
  deleting: null,
  error: null,
} as never;

const driver = (id: number, name: string, phone: string | null): Driver =>
  ({ id, name, phone, status: 'ACTIVE' } as unknown as Driver);

function renderCard(drivers: Driver[]) {
  return render(
    <DriverCard drivers={drivers} truckMap={new Map()} crud={crudStub} />,
  );
}

describe('DriverCard — shared ListFilterBar adoption', () => {
  it('renders the shared bar and filters by name substring', () => {
    renderCard([driver(1, 'Nguyễn Văn An', '0912345678'), driver(2, 'Trần Bình', '0987654321')]);

    expect(document.querySelector('.filter-bar.list-filter-bar')).not.toBeNull();
    expect(document.querySelector('.fleet-mini-search')).toBeNull();

    const input = screen.getByLabelText('Tìm lái xe theo tên hoặc số điện thoại');
    expect(screen.getAllByText('Hiển thị 2/2')).toHaveLength(2);

    fireEvent.change(input, { target: { value: 'văn an' } });
    expect(document.querySelectorAll('.desktop-only tbody tr')).toHaveLength(1);
    expect(screen.getAllByText('Hiển thị 1/2')).toHaveLength(2);

    fireEvent.change(input, { target: { value: '' } });
    expect(screen.getAllByText('Hiển thị 2/2')).toHaveLength(2);
  });
});
