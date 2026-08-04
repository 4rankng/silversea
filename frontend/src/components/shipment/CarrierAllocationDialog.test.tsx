import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CarrierAllocationDialog } from './CarrierAllocationDialog';

describe('CarrierAllocationDialog', () => {
  const onClose = vi.fn();
  const onSave = vi.fn();

  beforeEach(() => {
    onClose.mockReset();
    onSave.mockReset();
  });

  it('keeps save disabled until the 20 and 40 totals match demand exactly', async () => {
    render(
      <CarrierAllocationDialog
        isOpen
        carrierOptions={[
          { key: 'OWN', label: 'Đội xe nội bộ SilverSea', carrierType: 'OWN', externalCarrierId: null, isActive: true },
          { key: 'EXTERNAL:7', label: 'Nhà xe Đông Hải', carrierType: 'EXTERNAL', externalCarrierId: 7, isActive: true },
        ]}
        demand={{ count20: 1, count40: 1 }}
        value={[]}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Nhà xe' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Nhà xe Đông Hải' }));
    fireEvent.change(screen.getByLabelText("20'"), { target: { value: '1' } });

    expect((screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("40'"), { target: { value: '1' } });
    const saveButton = screen.getByRole('button', { name: 'Lưu phân bổ' }) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);

    fireEvent.click(saveButton);
    expect(onSave).toHaveBeenCalledWith([
      {
        carrierType: 'EXTERNAL',
        externalCarrierId: 7,
        carrierLabel: 'Nhà xe Đông Hải',
        count20: 1,
        count40: 1,
      },
    ]);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('switches to the drawer shell on narrow mobile viewports', () => {
    window.innerWidth = 390;
    render(
      <CarrierAllocationDialog
        isOpen
        carrierOptions={[
          { key: 'OWN', label: 'Đội xe nội bộ SilverSea', carrierType: 'OWN', externalCarrierId: null, isActive: true },
        ]}
        demand={{ count20: 0, count40: 1 }}
        value={[]}
        onClose={onClose}
        onSave={onSave}
      />,
    );

    expect(document.querySelector('.drawer')).toBeTruthy();
    expect(document.querySelector('.modal')).toBeNull();
  });
});
