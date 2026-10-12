import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// The popover bails out until the anchor has been measured; jsdom has no
// layout, so pin the position instead of asserting on real geometry.
vi.mock('../../../hooks/usePopoverPosition', () => ({
  usePopoverPosition: () => ({ top: 10, left: 10, maxHeight: null }),
}));

import { FactoryDetailPopover } from './FactoryDetailPopover';
import { buildFactoryOptionSearchText } from './ShipmentCreateContainerRow.factorySearch';

// Card 111026175000 (FB-007): the shipment-create factory peek showed the
// address but never the phone, so a factory with complete contact data still
// looked unreachable from the create flow.
describe('FactoryDetailPopover contact phone', () => {
  const base = {
    name: 'Kho Biển Bạc - Long Biên',
    address: 'Số 1 Đường Vạn Xuân, Long Biên, Hà Nội',
    invoiceGroups: [],
    anchorRef: createRef<HTMLElement>(),
    open: true,
    onClose: () => {},
  };

  it('shows the factory phone when one is on file', () => {
    render(<FactoryDetailPopover {...base} phone="02253555555" />);
    expect(screen.getByText('02253555555')).toBeTruthy();
    expect(screen.getByText('Số điện thoại')).toBeTruthy();
  });

  it('omits the phone line entirely when the factory has none', () => {
    render(<FactoryDetailPopover {...base} phone="" />);
    expect(screen.queryByText('Số điện thoại')).toBeNull();
  });
});

describe('shipment-create factory picker search', () => {
  it('matches the factory by phone digits', () => {
    const text = buildFactoryOptionSearchText({
      code: 'ASKEY-1',
      name: 'ASKEY-1',
      shortName: 'ASKEY-1',
      address: 'KCN Thăng Long',
      contactPhone: '0900999888',
    });
    expect(text).toContain('0900999888');
  });
});