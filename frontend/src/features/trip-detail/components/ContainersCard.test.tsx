import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { useQueryMock } = vi.hoisted(() => ({
  useQueryMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}));

vi.mock('../../../lib/api', () => ({
  api: { get: vi.fn() },
}));

vi.mock('../../../lib/api/photo', () => ({
  photoSrc: (key: string) => key,
}));

vi.mock('../../../components/PhotoViewer', () => ({
  PhotoViewer: () => null,
}));

import { ContainersCard } from './ContainersCard';

describe('ContainersCard', () => {
  it('renders synthetic LCL scope without leaking sentinel notes or empty container fields', () => {
    useQueryMock.mockReturnValue({
      data: {
        items: [
          {
            id: 1,
            containerNumber: null,
            sealNumber: null,
            containerTypeCode: null,
            containerTypeName: null,
            cargoWeightKg: null,
            notes: '__fulfillment_lcl:1',
          },
        ],
        contPhotoKeys: [],
        sealPhotoKeys: [],
      },
      isLoading: false,
    });

    render(<ContainersCard tripId={2} />);

    expect(screen.getByText('Thông tin hàng lẻ')).toBeTruthy();
    expect(screen.getByText('Lô hàng lẻ')).toBeTruthy();
    expect(screen.queryByText(/1 lô/)).toBeNull();
    expect(screen.queryByText('Container & Seal')).toBeNull();
    expect(screen.queryByText('__fulfillment_lcl:1')).toBeNull();
    expect(screen.queryByText('Số seal')).toBeNull();
    expect(screen.queryByText('Loại cont')).toBeNull();
    expect(screen.queryByText('Trọng lượng')).toBeNull();
  });

  it('keeps real FCL container and seal details unchanged', () => {
    useQueryMock.mockReturnValue({
      data: {
        items: [
          {
            id: 2,
            containerNumber: 'MSKU1234567',
            sealNumber: 'SEAL-001',
            containerTypeCode: '40HC',
            containerTypeName: '40 feet cao',
            cargoWeightKg: '4200',
            notes: 'Hàng dễ vỡ',
          },
        ],
        contPhotoKeys: [],
        sealPhotoKeys: [],
      },
      isLoading: false,
    });

    render(<ContainersCard tripId={3} />);

    expect(screen.getByText(/1 cont/)).toBeTruthy();
    expect(screen.getByText('MSKU1234567')).toBeTruthy();
    expect(screen.getByText('SEAL-001')).toBeTruthy();
    expect(screen.getByText('40 feet cao (40HC)')).toBeTruthy();
    expect(screen.getByText('4.200 kg')).toBeTruthy();
    expect(screen.getByText('Hàng dễ vỡ')).toBeTruthy();
  });
});
